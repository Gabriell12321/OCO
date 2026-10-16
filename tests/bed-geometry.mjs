import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'three') return { url: new URL('../dist/vendor/three.module.js', import.meta.url).href, shortCircuit: true };
  if (specifier.startsWith('three/addons/')) return { url: new URL('../dist/vendor/addons/' + specifier.slice(13), import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import('three');
const { createBedding } = await import('../dist/bedroom/bed.js');
const parent = new THREE.Group(), cx = -.97, cz = -1.58;
const material = new THREE.MeshStandardMaterial({ color: '#c9c2ae' });
const bed = createBedding(parent, { linen: material, blanket: material }, cx, cz);
parent.updateMatrixWorld(true);
assert.equal(bed.metrics.meshes, 5, 'Pillows, duvet, turned edge and throw use five static meshes');
assert.ok(bed.metrics.triangles < 35000, 'Large folds and curved silhouettes fit the cloth budget');
assert.equal(bed.metrics.animated, false);
for (const mesh of bed.meshes) {
  const { position, normal, uv } = mesh.geometry.attributes;
  assert.ok(mesh.userData.bedPart);
  for (const index of mesh.geometry.index.array) assert.ok(index >= 0 && index < position.count);
  for (const array of [position.array, normal.array, uv.array]) for (const value of array) assert.ok(Number.isFinite(value), 'Cloth attributes stay finite');
}

// The denser reference sampler is independent of the rendered triangle grid.
// Rays check that the reduced mesh still follows the creases at close range.
const duvet = bed.meshes.find(mesh => mesh.userData.bedPart === 'duvet');
let maximumDeviation = 0;
for (let x = -.77; x < .78; x += .043) for (let z = -.68; z < .72; z += .047) {
  const expected = bed.sample(x, z);
  const ray = new THREE.Raycaster(new THREE.Vector3(expected.x, 1.2, expected.z), new THREE.Vector3(0, -1, 0), 0, 1);
  const hit = ray.intersectObject(duvet, false)[0];
  assert.ok(hit, 'No gaps in the top cloth grid');
  maximumDeviation = Math.max(maximumDeviation, Math.abs(hit.point.y - expected.y));
}
assert.ok(maximumDeviation < .004, `Crease deviation remains below 4 mm: ${maximumDeviation}`);

// Hem clearance catches the old triangular corner / frame penetration failure.
let minimumClearance = Infinity;
for (let u = -1.25; u <= 1.25; u += .025) for (let v = -.82; v <= 1.47; v += .025) {
  const p = bed.sample(u, v);
  assert.ok(p.y > .12 && p.y < .73, 'Duvet remains above the floor and on the mattress');
  if (p.y < .405) {
    const qx = Math.abs(p.x - cx) - .931, qz = Math.abs(p.z - cz) - 1.175;
    const distance = Math.hypot(Math.max(0, qx), Math.max(0, qz)) + Math.min(Math.max(qx, qz), 0) - .042;
    minimumClearance = Math.min(minimumClearance, distance);
    assert.ok(distance >= -.0001, 'Lower drape clears the rounded timber rail');
  }
}
for (let x = -.9; x <= .9; x += .05) {
  const upper = bed.foldSample(x, .84), lower = bed.foldSample(x, 1);
  assert.ok(upper.y - lower.y > .010 && upper.y - lower.y < .020, 'Compressed return remains a thin 10–20 mm fabric layer');
  const support = bed.sample(x, lower.z - cz);
  assert.ok(lower.y - support.y >= .0029 && lower.y - support.y <= .0041, 'Fold underside rests within 4 mm of its support');
  assert.ok(upper.y - support.y < .024, 'Fold cannot become a floating raised cord');
  for (let z = .76; z < 1.40; z += .035) assert.ok(bed.throwSample(x, z).y - bed.sample(x, z).y >= .0139, 'Throw remains separated from underlying duvet');
}

// Pillow panels must be solid in silhouette and have a real depressed top,
// rather than the tapered poles of the former spherical construction.
const pillows = bed.meshes.filter(mesh => mesh.userData.bedPart === 'pillow');
for (const pillow of pillows) {
  pillow.geometry.computeBoundingBox();
  const bounds = pillow.geometry.boundingBox;
  assert.ok(bounds.max.x - bounds.min.x > .74 && bounds.max.x - bounds.min.x < .81);
  assert.ok(bounds.max.z - bounds.min.z > .44 && bounds.max.z - bounds.min.z < .49);
  assert.ok(bounds.max.y - bounds.min.y > .12 && bounds.max.y - bounds.min.y < .17);
}
console.log(JSON.stringify({ ...bed.metrics, maximumCreaseDeviationMm: Number((maximumDeviation * 1000).toFixed(3)), minimumRailClearanceMm: Number((minimumClearance * 1000).toFixed(3)) }));
