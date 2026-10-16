import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'three') return { url: new URL('../dist/vendor/three.module.js', import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import('three');
const { createWindowRain, RAIN_PROFILES } = await import('../dist/weather/rain.js');
const scene = new THREE.Scene();
const position = new THREE.Vector3(.4, 1.775, -3.23);
const rain = createWindowRain(scene, { windowPosition: position, seed: 811 });
assert.equal(scene.children.length, 1);
assert.deepEqual(rain.group.position.toArray(), position.toArray());
assert.equal(rain.group.children.length, 2, 'Rain is two instanced batches, independent of drop count');
const [streaks, drops] = rain.group.children;
for (const mesh of rain.group.children) {
  assert.equal(mesh.castShadow, false, 'Moving rain never invalidates static shadow caches');
  assert.equal(mesh.receiveShadow, false);
  assert.equal(mesh.material.depthWrite, false);
  assert.equal(mesh.material.side, THREE.FrontSide, 'Transparent geometry does not trigger a second backside pass');
  assert.ok(mesh.userData.noStaticBatch);
  assert.ok(mesh.geometry.isInstancedBufferGeometry);
  for (const attribute of Object.values(mesh.geometry.attributes))
    for (const value of attribute.array) assert.ok(Number.isFinite(value), 'All seeded geometry is finite');
  assert.ok(Number.isFinite(mesh.geometry.boundingSphere.radius));
}

// Check the actual generated distribution and culling bounds at the extremes
// of its swept volume, not just the seed-independent constants.
const rainData = streaks.geometry.attributes.aRain;
const shapes = streaks.geometry.attributes.aShape;
const bounds = streaks.geometry.boundingBox;
for (let i = 0; i < rainData.count; i++) {
  const z = rainData.getZ(i);
  assert.ok(z <= -.12, 'Airborne rain remains at least 12 cm outside the glass');
  assert.ok(z >= -4.8);
  const halfLength = shapes.getZ(i) / 2;
  const halfWidth = shapes.getY(i) / 2 + halfLength * .12;
  for (const y of [-1.5, 3.2]) for (const direction of [-1, 1]) {
    const x = rainData.getX(i) + y * .12 + direction * (.028 + halfWidth);
    assert.ok(bounds.containsPoint(new THREE.Vector3(x, y + direction * halfLength, z)), 'Frustum bounds include each full streak at both wrap edges');
  }
}
const dropData = drops.geometry.attributes.aDrop;
const flowData = drops.geometry.attributes.aFlow;
const kinds = [0, 0, 0];
for (let i = 0; i < dropData.count; i++) {
  kinds[flowData.getZ(i)]++;
  assert.ok(Math.abs(dropData.getX(i)) < .77 && Math.abs(dropData.getY(i)) < .725);
  assert.ok(dropData.getZ(i) > 0 && dropData.getZ(i) < .0091, 'Even coalesced droplet radii remain below one centimetre');
  assert.ok(dropData.getW(i) > 0 && dropData.getW(i) < .017);
  assert.ok(flowData.getY(i) >= 2.5, 'Impact loops do not flicker every frame');
}
assert.ok(kinds.every(count => count > 50), 'Beads, flowing rivulets, and fresh impacts are all represented');

const originalBuffers = rain.group.children.flatMap(mesh => Object.values(mesh.geometry.attributes).map(attribute => [attribute, attribute.version, attribute.array]));
for (const profile of Object.keys(RAIN_PROFILES)) {
  rain.setQuality(profile);
  const value = rain.snapshot();
  assert.equal(value.streaks, RAIN_PROFILES[profile].streaks);
  assert.equal(value.drops, RAIN_PROFILES[profile].drops);
  assert.equal(value.drawCalls, 2);
  assert.equal(value.shadowPasses, 0);
  assert.ok(value.triangles <= 3000, 'Highest quality weather stays below 3000 triangles');
}
for (let frame = 0; frame < 10000; frame++) rain.update(frame / 60, 1 / 60);
for (const [attribute, version, array] of originalBuffers) {
  assert.equal(attribute.version, version, 'Motion does not re-upload vertex buffers');
  assert.equal(attribute.array, array);
}
rain.setTime(12.5);
assert.equal(streaks.material.uniforms.uTime.value, 12.5);
assert.equal(drops.material.uniforms.uTime.value, 12.5, 'Impacts and airborne rain share the same deterministic clock');
rain.setTime(NaN); rain.update(Infinity);
assert.equal(rain.snapshot().time, 12.5);
rain.setLampLevel(-1); assert.equal(rain.snapshot().lamp, 0);
rain.setLampLevel(2); assert.equal(rain.snapshot().lamp, 1.5);
rain.setStormLevel(1);
assert.equal(streaks.material.uniforms.uStorm.value, 1);
assert.equal(drops.material.uniforms.uStorm.value, 1, 'Rain and wet-glass glints share the exact flash level');
rain.setStormLevel(-1); assert.equal(rain.snapshot().storm, 0);
rain.setStormLevel(5); assert.equal(rain.snapshot().storm, 1);
rain.setStormLevel(NaN); assert.equal(rain.snapshot().storm, 1);
rain.setEnabled(false); assert.equal(rain.group.visible, false); assert.equal(rain.snapshot().drawCalls, 0);
rain.setEnabled(true); assert.equal(rain.group.visible, true);

const identical = createWindowRain(new THREE.Scene(), { seed: 811 });
assert.deepEqual(identical.group.children[0].geometry.attributes.aRain.array, rainData.array, 'Seed produces repeatable weather for visual comparisons');
identical.dispose();
let disposed = 0;
for (const mesh of rain.group.children) for (const item of [mesh.geometry, mesh.material]) item.addEventListener('dispose', () => disposed++);
rain.dispose(); rain.dispose();
assert.equal(disposed, 4, 'Each owned GPU resource is released exactly once');
assert.equal(scene.children.length, 0);
assert.equal(rain.snapshot().drawCalls, 0);
rain.setEnabled(true); assert.equal(rain.group.visible, false, 'Disposed weather cannot be re-enabled');
assert.throws(() => createWindowRain(scene, { width: 0 }), RangeError);
assert.throws(() => createWindowRain(scene, { windowPosition: new THREE.Vector3(NaN, 1, 2) }), TypeError);
console.log('PASS window rain: 2 draw calls, exterior-only volume, finite deterministic instances, zero per-frame buffer uploads, quality budgets and disposal');
