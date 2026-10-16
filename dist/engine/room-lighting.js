import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { sampleStormSignal } from './storm.js';
export { sampleStormSignal, stormEventTime, STORM_FIRST_FLASH_TIME, STORM_FLASH_ATTACK, STORM_FLASH_DURATION } from './storm.js';

export const LAMP_SHADOW = Object.freeze({ bias: -.0005, normalBias: .012, radius: 4.2 });
export const LAMP_SHADOW_SIZE = 1024;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const x = clamp(value); return x * x * (3 - 2 * x); };
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** A failing incandescent socket: separated brownouts with a warm recovery,
 * not random per-frame brightness. Sampling is deterministic at any frame rate. */
export function sampleLampSignal(time, result = {}) {
  const t = Math.max(0, Number.isFinite(time) ? time : 0);
  const cycle = Math.floor(t / 32), local = t - cycle * 32;
  const start = 5.6 + hash(cycle) * 1.1;
  const late = 19.1 + hash(cycle + 4) * 2;
  let gain = 1, event = -1, strength = 0;
  for (let i = 0; i < 3; i++) {
    const onset = i === 0 ? start : i === 1 ? start + 1.38 : late;
    const age = local - onset, duration = i === 0 ? .64 : i === 1 ? .38 : 1.08;
    if (age < 0 || age >= duration) continue;
    const depth = i === 0 ? .91 : i === 1 ? .76 : .67;
    const attack = smooth(age / .045), recovery = smooth((age - (i === 2 ? .34 : .12)) / (duration - (i === 2 ? .34 : .12)));
    gain = 1 - depth * attack * (1 - recovery);
    event = cycle * 3 + i; strength = depth;
    break;
  }
  result.gain = gain; result.event = event; result.strength = strength;
  return result;
}

/** Fixed emitters keep all seven room shadow views cached. Only light and
 * emissive uniforms change, together, when the electrical contact falters. */
export function createRoomLighting(scene, room, { onFlicker = () => {}, onThunder = () => {} } = {}) {
  RectAreaLightUniformsLib.init();
  const owned = [], full = [], efficient = [], warm = [];
  const add = light => { owned.push(light); scene.add(light); return light; };
  add(new THREE.HemisphereLight(0x899eaf, 0x30251d, .105));
  const windowLight = add(new THREE.RectAreaLight(0x9cb9d5, 1.12, 1.52, 1.42));
  windowLight.position.copy(room.windowPosition).add(new THREE.Vector3(0, 0, .17));
  windowLight.lookAt(-.5, 1.1, 1.7); full.push(windowLight);
  const windowFill = add(new THREE.PointLight(0x9cb9d5, .96, 7.5, 2));
  windowFill.position.copy(room.windowPosition).add(new THREE.Vector3(0, 0, .24));
  efficient.push(windowFill);
  const moon = add(new THREE.DirectionalLight(0xa2bbd4, .21));
  moon.position.set(-1, 4.2, -7.5); moon.target.position.set(.6, .2, 1.8); add(moon.target);
  moon.castShadow = true; moon.shadow.mapSize.set(1024, 1024);
  Object.assign(moon.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: .2, far: 20 });
  Object.assign(moon.shadow, { bias: -.00012, normalBias: .008, radius: 3 });
  const lamp = add(new THREE.PointLight(0xffd0a0, 5.8, 6, 2));
  lamp.position.copy(room.lampPosition); lamp.castShadow = true;
  lamp.shadow.mapSize.set(LAMP_SHADOW_SIZE, LAMP_SHADOW_SIZE);
  Object.assign(lamp.shadow.camera, { near: .04, far: 8 });
  Object.assign(lamp.shadow, LAMP_SHADOW); warm.push([lamp, lamp.intensity]);
  const bounce = add(new THREE.RectAreaLight(0xffd7ac, .58, .65, .45));
  bounce.position.copy(room.lampPosition).add(new THREE.Vector3(.05, .65, -.25));
  bounce.lookAt(-.4, 2.8, -1.8); full.push(bounce); warm.push([bounce, bounce.intensity]);
  const lampFill = add(new THREE.PointLight(0xffd7ac, .38, 4.5, 2));
  lampFill.position.copy(bounce.position); efficient.push(lampFill); warm.push([lampFill, lampFill.intensity]);
  const coolBounce = add(new THREE.PointLight(0x9db6cd, .32, 6, 2));
  coolBounce.position.set(1.1, 1.9, -.3);
  // The existing exterior directional emitter already has the room opening
  // and mullions in its cached depth map. Raising it gives a red shaft with
  // real frame shadows, rather than tinting the whole screen or adding a map.
  const stormLights = [[moon, 4.2], [windowLight, 3.3], [windowFill, 3], [coolBounce, .42]]
    .map(([light, extra]) => ({ light, color: light.color.clone(), intensity: light.intensity, extra }));
  const stormRed = new THREE.Color('#ff1836');
  const glassMaterial = room.windowGlass?.material;
  const glassEmission = glassMaterial?.emissive?.clone();
  const glassStormEmission = new THREE.Color(.45, .008, .016);
  const emissives = Object.values(room.lampMaterials || {}).map(material => [material, material.emissiveIntensity]);
  const sample = {}, storm = {};
  let lastEvent = -1, gain = 1, events = 0, time = 0;
  let lastThunderEvent = -1, thunderGain = 0, thunderEvents = 0;
  function update(seconds, { lampOverride = null, stormOverride = null, emitEvents = true } = {}) {
    time = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    sampleLampSignal(time, sample);
    gain = lampOverride === null ? sample.gain : clamp(Number(lampOverride) || 0);
    if (emitEvents && lampOverride === null && sample.event >= 0 && sample.event !== lastEvent) {
      events++; onFlicker(sample.strength);
    }
    lastEvent = sample.event;
    for (const [light, intensity] of warm) light.intensity = intensity * gain;
    for (const [material, intensity] of emissives) material.emissiveIntensity = intensity * gain;
    sampleStormSignal(time, storm);
    thunderGain = stormOverride === null ? storm.gain : clamp(Number(stormOverride) || 0);
    if (emitEvents && stormOverride === null && storm.event >= 0 && storm.event !== lastThunderEvent) {
      thunderEvents++; onThunder(storm.strength);
    }
    lastThunderEvent = storm.event;
    for (const source of stormLights) {
      source.light.color.copy(source.color).lerp(stormRed, thunderGain);
      source.light.intensity = source.intensity + source.extra * thunderGain;
    }
    // A faint local wet-glass response locates the flash outside. Actual room
    // illumination still comes from the fixed emitters above, not this pane.
    if (glassEmission) glassMaterial.emissive.copy(glassEmission).lerp(glassStormEmission, thunderGain);
    return gain;
  }
  return {
    shadowLights: [moon, lamp], update,
    getStormLevel: () => thunderGain,
    setQuality(quality) {
      const qualityMode = quality === 'quality';
      full.forEach(light => { light.visible = qualityMode; });
      efficient.forEach(light => { light.visible = !qualityMode; });
    },
    snapshot: () => ({ time, lampGain: gain, flickerEvents: events, event: sample.event ?? -1,
      thunderGain, thunderEvents, thunderEvent: storm.event ?? -1, staticShadowPassesPerThunder: 0,
      staticShadowPassesPerFlicker: 0, emitters: owned.filter(light => light.isLight).length,
      shadeGain: gain, lampIntensity: lamp.intensity }),
    dispose() { for (const object of owned) { object.removeFromParent(); object.dispose?.(); } },
  };
}
