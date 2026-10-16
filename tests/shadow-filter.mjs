import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'three') return { url: new URL('../dist/vendor/three.module.js', import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import('three');
const { createShadowChunk, receiverPlaneTapDistance, POINT_SHADOW_CORRECTION_LIMIT } = await import('../dist/engine/shadow-filter.js');
const offsets = [[-1,-1,1], [-1,1,-1], [1,-1,-1], [1,1,1]];
const radius = 4.2 / 1024, biasMetres = -.0005 * (8 - .04);
let samples = 0, legacyAcne = 0, correctedAcne = 0, realOcclusions = 0;

function checkPlane(receiver, normal) {
  const position = new THREE.Vector3(...receiver), n = new THREE.Vector3(...normal).normalize();
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, position);
  const direction = position.clone().normalize();
  for (const offset of offsets) {
    const tap = direction.clone().addScaledVector(new THREE.Vector3(...offset), radius);
    const ray = new THREE.Ray(new THREE.Vector3(), tap.clone().normalize());
    const hit = ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) continue;
    const storedDistance = hit.length(), baseDistance = position.length();
    const corrected = receiverPlaneTapDistance(receiver, normal, tap.toArray());
    assert.ok(Number.isFinite(corrected), 'Every tap depth stays finite');
    assert.ok(Math.abs(corrected - baseDistance) <= POINT_SHADOW_CORRECTION_LIMIT + 1e-9, 'Correction is bounded across edges');
    if (Math.abs(storedDistance - baseDistance) >= POINT_SHADOW_CORRECTION_LIMIT) continue;
    assert.ok(Math.abs(corrected - storedDistance) < 1e-8, 'Corrected tap meets the receiver plane, independently ray cast');
    if (baseDistance + biasMetres > storedDistance) legacyAcne++;
    if (corrected + biasMetres > storedDistance) correctedAcne++;
    // A real blocker six centimetres above the receiver must still cast.
    assert.ok(corrected + biasMetres > storedDistance - .06, 'Plane compensation does not erase a foreground occluder');
    samples++; realOcclusions++;
  }
}

// Grazing lamp rays across the bed, including small slopes of the blanket.
for (let x = -.35; x >= -2.75; x -= .15) for (let z = -.1; z <= 2.75; z += .15) {
  checkPlane([x, -.43, z], [0, 1, 0]);
  checkPlane([x, -.39, z], [.12, 1, -.08]);
}
// Ceiling, vertical walls, draped sides, and receivers close to the lamp.
for (const [point, normal] of [
  [[.8,1.925,.5], [0,-1,0]], [[-.4,1.925,2.7], [0,-1,0]],
  [[-3.4,.6,1], [1,0,0]], [[1.2,.2,3], [0,0,-1]],
  [[-1.3,-.7,1.5], [.98,.15,.04]], [[.07,-.04,.035], [0,1,0]],
]) checkPlane(point, normal);

// A degenerate projected triangle, tangent ray, opposite ray, or light-origin
// point cannot introduce NaN/infinity or an unbounded shadow offset.
for (const [point, normal, direction] of [
  [[1,-.4,2], [0,0,0], [1,0,1]],
  [[1,-.4,2], [0,1,0], [1,0,0]],
  [[1,-.4,2], [0,1,0], [1,1e-9,0]],
  [[1,-.4,2], [0,1,0], [-1,1,-1]],
  [[0,0,0], [0,1,0], [0,0,0]],
]) {
  const result = receiverPlaneTapDistance(point, normal, direction);
  assert.ok(Number.isFinite(result));
  assert.ok(Math.abs(result - Math.hypot(...point)) <= POINT_SHADOW_CORRECTION_LIMIT + 1e-9);
}
assert.ok(samples > 2000, 'Exercise a range of actual room positions');
assert.ok(legacyAcne > samples * .2, 'The previous constant-depth kernel reproduces self-shadow acne');
assert.equal(correctedAcne, 0, 'Receiver-plane correction removes planar self-shadow acne');
assert.equal(realOcclusions, samples);

// Integration contracts complement the numerical checks; desktop capture
// additionally compiles both profiles against the actual GPU implementation.
for (const full of [false, true]) {
  const chunk = createShadowChunk(full);
  assert.equal((chunk.match(/float getPointShadow\(/g) || []).length, 1);
  assert.equal((chunk.match(/float getShadow\(/g) || []).length, 1);
  assert.equal((chunk.match(/quartoReceiverPlaneTap\(shadowMap,/g) || []).length, full ? 9 : 4);
  assert.ok(chunk.includes('distanceToLight < shadowCameraNear || distanceToLight > shadowCameraFar'));
  assert.ok(chunk.indexOf('cross(dFdx(receiver), dFdy(receiver))') < chunk.indexOf('if (distanceToLight < shadowCameraNear'), 'Derivatives precede the local near/far branch');
  assert.ok(chunk.includes('return mix(1.0, value /'), 'Shadow intensity is preserved');
}
console.log(JSON.stringify({ receiverPlaneSamples: samples, legacyAcne, correctedAcne, foregroundOccluders: realOcclusions, correctionLimitMetres: POINT_SHADOW_CORRECTION_LIMIT, performanceTaps: 4, qualityTaps: 9 }));
