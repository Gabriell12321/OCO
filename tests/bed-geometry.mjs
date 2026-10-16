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
let minimumFoldGap = Infinity, maximumFoldGap = -Infinity;
for (let x = -.9; x <= .9; x += .05) {
  const upper = bed.foldSample(x, .84), lower = bed.foldSample(x, 1);
  assert.ok(upper.y - lower.y > .010 && upper.y - lower.y < .020, 'Compressed return remains a thin 10–20 mm fabric layer');
  const support = new THREE.Raycaster(new THREE.Vector3(lower.x, 1.2, lower.z), new THREE.Vector3(0, -1, 0), 0, 1).intersectObject(duvet, false)[0];
  assert.ok(support, 'The pulled fold remains over connected duvet geometry');
  const gap = lower.y - support.point.y;
  minimumFoldGap = Math.min(minimumFoldGap, gap); maximumFoldGap = Math.max(maximumFoldGap, gap);
  assert.ok(gap >= -.0005 && gap <= .007, 'Fold underside remains supported after the asymmetric pull');
  assert.ok(upper.y - support.point.y < .027, 'Fold cannot become a floating raised cord');
  for (let z = .76; z < 1.40; z += .035) {
    const [u, v] = bed.throwRest(x, z);
    assert.ok(v < 1.47 && Math.abs(u) < 1.25, 'Skewed throw stays on the duvet support domain');
    assert.ok(bed.throwSample(x, z).y - bed.sample(u, v).y >= .0139, 'Throw remains separated from the actual underlying duvet');
  }
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
const [leftPillow, rightPillow] = pillows;
assert.ok(rightPillow.parent.position.z - leftPillow.parent.position.z > .14, 'The used right pillow is visibly pulled towards the foot');
assert.ok(rightPillow.parent.rotation.y - leftPillow.parent.rotation.y > .23, 'Pillows no longer share a matching placement');
const leftEdge = bed.sample(-.65, -.82), rightEdge = bed.sample(.65, -.82);
assert.ok(rightEdge.z - leftEdge.z > .22, 'Right duvet head edge exposes a visible area of the real sheet');
const sheetProbe = x => new THREE.Raycaster(new THREE.Vector3(cx + x, 1.2, cz - .70), new THREE.Vector3(0, -1, 0), 0, .8).intersectObject(duvet, false);
assert.equal(sheetProbe(.65).length, 0, 'The opened right area is uncovered sheet, not a second fake fold on top of the duvet');
assert.ok(sheetProbe(-.65).length > 0, 'The orderly left sleeping place remains covered');
const leftThrow = bed.throwSample(-.65, .76), rightThrow = bed.throwSample(.65, .76);
assert.ok(rightThrow.z - leftThrow.z > .15, 'Foot blanket has one pulled corner and a visibly diagonal top edge');

// Check actual rendered underside vertices against their sheet/duvet support.
// The selected triangles face down before each pillow's world transform.
let minimumPillowGap = Infinity;
for (const pillow of pillows) {
  const positions = pillow.geometry.attributes.position, normal = pillow.geometry.attributes.normal;
  let contactGap = Infinity;
  for (let i = 0; i < positions.count; i++) {
    if (normal.getY(i) >= -.6 || positions.getY(i) > -.020) continue;
    const p = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(pillow.matrixWorld);
    const gap = p.y - bed.supportHeight(p.x - cx, p.z - cz);
    minimumPillowGap = Math.min(minimumPillowGap, gap); contactGap = Math.min(contactGap, gap);
  }
  assert.ok(contactGap >= -.002 && contactGap < .004, `Each pillow contacts its support without cutting through it: ${contactGap}`);
}
console.log(JSON.stringify({ ...bed.metrics, maximumCreaseDeviationMm: Number((maximumDeviation * 1000).toFixed(3)), minimumRailClearanceMm: Number((minimumClearance * 1000).toFixed(3)), foldGapMm: [minimumFoldGap, maximumFoldGap].map(value => Number((value * 1000).toFixed(3))), minimumPillowGapMm: Number((minimumPillowGap * 1000).toFixed(3)), openedRightCoverCm: Number(((rightEdge.z - leftEdge.z) * 100).toFixed(1)), throwSkewCm: Number(((rightThrow.z - leftThrow.z) * 100).toFixed(1)) }));
