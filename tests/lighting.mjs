import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'three') return { url: new URL('../dist/vendor/three.module.js', import.meta.url).href, shortCircuit: true };
  if (specifier.startsWith('three/addons/')) return { url: new URL('../dist/vendor/addons/' + specifier.slice(13), import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import('three');
const { createRoomLighting, sampleLampSignal } = await import('../dist/engine/room-lighting.js');
const scene = new THREE.Scene();
const shade = new THREE.MeshStandardMaterial({ emissiveIntensity: 1.25 });
const bulb = new THREE.MeshStandardMaterial({ emissiveIntensity: 2 });
let sounds = 0;
const lights = createRoomLighting(scene, { windowPosition: new THREE.Vector3(.4, 1.775, -3.18),
  lampPosition: new THREE.Vector3(.9, 1.075, -2.5), lampMaterials: { shade, bulb } }, { onFlicker: () => sounds++ });
const originalPositions = lights.shadowLights.map(light => light.position.toArray());
lights.shadowLights.forEach(light => { light.shadow.needsUpdate = false; });
let minimum = 1;
for (let i = 0; i <= 1920; i++) {
  const gain = lights.update(i / 60); minimum = Math.min(minimum, gain);
  assert.ok(gain >= .089 && gain <= 1);
  assert.equal(shade.emissiveIntensity, gain * 1.25);
  assert.equal(bulb.emissiveIntensity, gain * 2);
}
assert.equal(sounds, 3, 'Exactly one synchronized sound per brownout, not per frame');
assert.ok(minimum < .11, 'The lamp visibly dims');
assert.deepEqual(lights.shadowLights.map(light => light.position.toArray()), originalPositions);
assert.ok(lights.shadowLights.every(light => !light.shadow.needsUpdate), 'Flicker never invalidates the room shadow maps');
assert.equal(lights.update(6, { lampOverride: 1, emitEvents: false }), 1);
assert.equal(lights.update(6, { lampOverride: .2, emitEvents: false }), .2);
assert.equal(sounds, 3, 'Diagnostic overrides do not play a sound');
for (const quality of ['performance', 'balanced', 'quality', 'performance']) {
  lights.setQuality(quality);
  const visible = scene.children.filter(light => light.isLight && light.visible);
  assert.equal(visible.filter(light => light.isRectAreaLight).length, quality === 'quality' ? 2 : 0);
  assert.equal(visible.length, 6, 'Profile changes do not accumulate lighting');
}
for (const value of [NaN, Infinity, -4, 0, 32, 320000]) assert.ok(Number.isFinite(sampleLampSignal(value).gain));
for (let t = 0; t < 96; t += .1) assert.deepEqual(sampleLampSignal(t), sampleLampSignal(t));
lights.dispose(); assert.equal(scene.children.length, 0);
console.log(JSON.stringify({ lighting: 'synchronized bulb/shade/direct/bounce', flickerEventsPer32Seconds: sounds,
  minimumGain: minimum, staticShadowRedraws: 0, profiles: 'OK', disposal: 'OK' }));
