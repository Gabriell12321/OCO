import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'three') return { url: new URL('../dist/vendor/three.module.js', import.meta.url).href, shortCircuit: true };
  if (specifier.startsWith('three/addons/')) return { url: new URL('../dist/vendor/addons/' + specifier.slice(13), import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import('three');
const { createRoomLighting, sampleLampSignal, sampleStormSignal, stormEventTime,
  STORM_FIRST_FLASH_TIME, STORM_FLASH_ATTACK, STORM_FLASH_DURATION } = await import('../dist/engine/room-lighting.js');
const scene = new THREE.Scene();
const shade = new THREE.MeshStandardMaterial({ emissiveIntensity: 1.25 });
const bulb = new THREE.MeshStandardMaterial({ emissiveIntensity: 2 });
const glass = new THREE.MeshPhysicalMaterial();
let sounds = 0, thunders = 0;
const lights = createRoomLighting(scene, { windowPosition: new THREE.Vector3(.4, 1.775, -3.18),
  lampPosition: new THREE.Vector3(.9, 1.075, -2.5), lampMaterials: { shade, bulb }, windowGlass: { material: glass } },
  { onFlicker: () => sounds++, onThunder: () => thunders++ });
const originalPositions = lights.shadowLights.map(light => light.position.toArray());
const originalEmitters = scene.children.filter(light => light.isLight);
const originalColors = originalEmitters.map(light => light.color.toArray());
const originalIntensity = originalEmitters.map(light => light.intensity);
lights.shadowLights.forEach(light => { light.shadow.needsUpdate = false; });
let minimum = 1;
for (let i = 0; i <= 1920; i++) {
  const gain = lights.update(i / 60); minimum = Math.min(minimum, gain);
  assert.ok(gain >= .089 && gain <= 1);
  assert.equal(shade.emissiveIntensity, gain * 1.25);
  assert.equal(bulb.emissiveIntensity, gain * 2);
}
assert.equal(sounds, 3, 'Exactly one synchronized sound per brownout, not per frame');
assert.equal(thunders, 1, 'First thunder starts at ten seconds and cannot repeat during its tail');
assert.ok(minimum < .11, 'The lamp visibly dims');
assert.deepEqual(lights.shadowLights.map(light => light.position.toArray()), originalPositions);
assert.ok(lights.shadowLights.every(light => !light.shadow.needsUpdate), 'Flicker never invalidates the room shadow maps');
assert.equal(lights.update(6, { lampOverride: 1, emitEvents: false }), 1);
assert.equal(lights.update(6, { lampOverride: .2, emitEvents: false }), .2);
assert.equal(sounds, 3, 'Diagnostic overrides do not play a sound');
lights.update(STORM_FIRST_FLASH_TIME + STORM_FLASH_ATTACK, { lampOverride: 1, stormOverride: 1, emitEvents: false });
assert.equal(lights.snapshot().thunderGain, 1);
assert.equal(lights.getStormLevel(), 1, 'Rain reads the shared envelope without allocating a diagnostic snapshot');
assert.equal(lights.snapshot().staticShadowPassesPerThunder, 0);
assert.equal(lights.shadowLights[0].intensity, .21 + 4.2, 'The exterior shadow-casting key becomes the flash');
assert.ok(lights.shadowLights[0].color.r > lights.shadowLights[0].color.g * 10, 'The flash is distinctly red');
assert.ok(glass.emissive.r > 0 && glass.emissive.r > glass.emissive.g * 10);
assert.deepEqual(lights.shadowLights.map(light => light.position.toArray()), originalPositions, 'Storm does not move cached shadow emitters');
assert.ok(lights.shadowLights.every(light => !light.shadow.needsUpdate), 'Storm never schedules a static shadow render');
assert.equal(scene.children.filter(light => light.isLight).length, originalEmitters.length, 'Thunder adds no emitter or per-fragment light');
assert.equal(thunders, 1, 'Visual overrides never play synthetic thunder');
lights.update(0, { lampOverride: 1, stormOverride: 0, emitEvents: false });
assert.deepEqual(originalEmitters.map(light => light.color.toArray()), originalColors, 'Normal colors restore after the flash');
assert.deepEqual(originalEmitters.map(light => light.intensity), originalIntensity, 'Normal intensities restore after the flash');
assert.deepEqual(glass.emissive.toArray(), [0, 0, 0]);
for (const quality of ['performance', 'balanced', 'quality', 'performance']) {
  lights.setQuality(quality);
  const visible = scene.children.filter(light => light.isLight && light.visible);
  assert.equal(visible.filter(light => light.isRectAreaLight).length, quality === 'quality' ? 2 : 0);
  assert.equal(visible.length, 6, 'Profile changes do not accumulate lighting');
}
for (const value of [NaN, Infinity, -4, 0, 32, 320000]) assert.ok(Number.isFinite(sampleLampSignal(value).gain));
for (let t = 0; t < 96; t += .1) assert.deepEqual(sampleLampSignal(t), sampleLampSignal(t));

assert.equal(STORM_FIRST_FLASH_TIME, 10);
assert.equal(sampleStormSignal(9.999).event, -1);
assert.equal(sampleStormSignal(10).event, 0);
assert.equal(sampleStormSignal(10 + STORM_FLASH_ATTACK).gain, 1);
assert.equal(sampleStormSignal(10 + STORM_FLASH_DURATION).gain, 0);
let previousGain = 0;
for (let i = 0; i <= 150; i++) {
  const gain = sampleStormSignal(10 + i / 1000).gain;
  assert.ok(gain + 1e-12 >= previousGain, 'One smooth attack, no sub-frame strobe');
  previousGain = gain;
}
for (let i = 151; i <= 1050; i++) {
  const gain = sampleStormSignal(10 + i / 1000).gain;
  assert.ok(gain <= previousGain + 1e-12, 'A continuous single tail, no rapid double flashes');
  previousGain = gain;
}
for (let event = 1; event < 500; event++) {
  const interval = stormEventTime(event) - stormEventTime(event - 1);
  assert.ok(interval >= 27 && interval <= 39, 'Storm events remain sparse over long sessions');
  const onset = stormEventTime(event);
  assert.equal(sampleStormSignal(onset + .1).event, event, 'Jittered events remain addressable without accumulated clock drift');
  assert.equal(sampleStormSignal(onset + STORM_FLASH_DURATION + .001).event, -1);
}
for (const value of [NaN, Infinity, -4, 0, 10, 320000, 1e300]) {
  const signal = sampleStormSignal(value);
  assert.ok(Number.isFinite(signal.gain) && signal.gain >= 0 && signal.gain <= 1);
}
lights.dispose(); assert.equal(scene.children.length, 0);
console.log(JSON.stringify({ lighting: 'synchronized bulb/shade/direct/bounce', flickerEventsPer32Seconds: sounds,
  thunderEventsFirst32Seconds: thunders, firstThunder: STORM_FIRST_FLASH_TIME, redFlashDuration: STORM_FLASH_DURATION,
  minimumGain: minimum, staticShadowRedraws: 0, profiles: 'OK', disposal: 'OK' }));
