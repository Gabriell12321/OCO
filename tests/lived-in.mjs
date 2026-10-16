import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'three') return { url: new URL('../dist/vendor/three.module.js', import.meta.url).href, shortCircuit: true };
  if (specifier.startsWith('three/addons/')) return { url: new URL('../dist/vendor/addons/' + specifier.slice(13), import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const words = [];
const gradient = { addColorStop() {} };
const context = new Proxy({ createLinearGradient: () => gradient, fillText: text => words.push(text) }, { get: (object, key) => object[key] ?? (() => {}) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
const THREE = await import('three');
const { createLivedInDetails } = await import('../dist/bedroom/lived-in.js');
const result = createLivedInDetails();
const { group, stats } = result;
assert.ok(stats.triangles <= 7000, 'Two small clusters retain their fixed static geometry budget');
assert.ok(stats.meshes <= 6 && stats.materials <= 6, 'All props are merged by material');
assert.equal(stats.textureCount, 1); assert.equal(stats.atlasSize, 1024);
assert.equal(stats.animated, false); assert.equal(stats.clusters, 2);
assert.equal(group.userData.static, true);
assert.equal(group.animations.length, 0);
assert.ok(words.includes('Parei na página 84.') && words.includes('trocar a lâmpada'), 'Notes are meaningful readable text, not pseudo-writing');
const normal = new THREE.Vector3();
for (const mesh of group.children) {
  assert.equal(mesh.matrixAutoUpdate, false);
  for (const attribute of Object.values(mesh.geometry.attributes)) for (const value of attribute.array) assert.ok(Number.isFinite(value));
  const vertices = mesh.geometry.attributes.position.count;
  for (const index of mesh.geometry.index.array) assert.ok(index >= 0 && index < vertices);
  for (let i = 0; i < mesh.geometry.attributes.normal.count; i++) {
    normal.fromBufferAttribute(mesh.geometry.attributes.normal, i);
    assert.ok(normal.length() > .98 && normal.length() < 1.02, 'Paper and tiny curved frames retain normalized normals');
  }
}
const deskInverse = new THREE.Matrix4().compose(new THREE.Vector3(2.47, 0, -.65), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2), new THREE.Vector3(1, 1, 1)).invert();
const bedsideInverse = new THREE.Matrix4().compose(new THREE.Vector3(.54, .707, -2.45), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -.15), new THREE.Vector3(1, 1, 1)).invert();
const p = new THREE.Vector3();
let deskVertices = 0, bedsideVertices = 0;
for (const mesh of group.children) {
  const attribute = mesh.geometry.attributes.position;
  for (let i = 0; i < attribute.count; i++) {
    p.fromBufferAttribute(attribute, i);
    if (p.x > 1.5) {
      p.applyMatrix4(deskInverse); deskVertices++;
      assert.ok(Math.abs(p.x) < .70 && Math.abs(p.z) < .37, 'Desktop details stay on the desktop');
      assert.ok(p.y >= .803 && p.y < .85, 'Props remain above the desk and at believable stationery heights');
    } else {
      p.applyMatrix4(bedsideInverse); bedsideVertices++;
      assert.ok(Math.abs(p.x) < .084 && p.z > -.12 && p.z < .14, 'Glasses fit the reading book; bookmark may project at its lower edge');
      assert.ok(p.y > .012 && p.y < .031, 'Folded spectacles stay at the surface of the book');
    }
  }
}
assert.ok(deskVertices > 0 && bedsideVertices > 0);
const coverContact = stats.parts.find(part => part.name === 'Notebook cloth cover').min[1] - .813;
const penContact = stats.parts.find(part => part.name === 'Pen laid beside the current page').min[1] - .813;
const glassesContact = Math.min(...stats.parts.filter(part => part.name.startsWith('Folded spectacle')).map(part => part.min[1])) - .7215;
assert.ok(Math.abs(coverContact) < .00001, 'The notebook cover rests on the writing pad');
assert.ok(penContact > -.0001 && penContact < .0003, 'The pen touches the pad within a fraction of a millimetre');
assert.ok(glassesContact > -.0003 && glassesContact < .0005, 'Folded spectacles rest on the top book cover');
// Changing the placement transform must move the complete cluster, including
// the physical stain. This protects integration if the desk is later moved.
const moved = createLivedInDetails({}, { deskPosition: [0, 0, 0], deskRotation: 0 });
const oldDeskPart = stats.parts.find(part => part.name === 'Notebook cloth cover');
const movedDeskPart = moved.stats.parts.find(part => part.name === 'Notebook cloth cover');
assert.ok(oldDeskPart.min[0] > 2 && movedDeskPart.max[0] < .2);
const leaf = group.children.find(mesh => mesh.material.name.includes('Cream notebook'));
const ray = new THREE.Raycaster(new THREE.Vector3(2.422, 1, -.625), new THREE.Vector3(0, -1, 0), 0, .4);
assert.ok(ray.intersectObject(leaf, false).length > 0, 'The open notebook presents a real upward-facing surface');
console.log(JSON.stringify({ triangles: stats.triangles, vertices: stats.vertices, meshes: stats.meshes, textures: stats.textureCount,
  clusters: stats.clusters, deskVertices, bedsideVertices, notes: 'readable', footprints: 'OK',
  supportGapMM: { notebook: coverContact * 1000, pen: penContact * 1000, spectacles: glassesContact * 1000 }, animation: 'none' }));
