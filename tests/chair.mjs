import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'three') return { url: new URL('../dist/vendor/three.module.js', import.meta.url).href, shortCircuit: true };
  if (specifier.startsWith('three/addons/')) return { url: new URL('../dist/vendor/addons/' + specifier.slice(13), import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import('three');
const { createChair } = await import('../dist/bedroom/chair.js');
const wood = new THREE.MeshStandardMaterial({ side: THREE.FrontSide, vertexColors: true });
const fabric = new THREE.MeshStandardMaterial({ side: THREE.FrontSide });
const piping = fabric.clone(), detail = wood.clone();
const chair = createChair({ wood, fabric, piping, detail });
const { group, stats, bounds } = chair;
const size = bounds.getSize(new THREE.Vector3());
assert.ok(stats.triangles <= 18000, 'The static chair stays inside its geometry budget');
assert.ok(stats.triangles >= 5000, 'Curved wood and upholstery retain sufficient geometry at close range');
assert.ok(stats.materials <= 5 && stats.meshes <= 5, 'Geometry is merged by material');
assert.equal(stats.animated, false); assert.equal(group.animations.length, 0);
assert.equal(group.userData.static, true);
assert.ok(size.x <= .53 && size.z <= .56, 'Chair remains inside the agreed footprint');
assert.ok(bounds.max.y > 1.0 && bounds.max.y < 1.05, 'Adult chair has a 1.03 m back');
assert.ok(bounds.min.y >= .0019 && bounds.min.y <= .0021, 'Feet rest 1 mm above the room floor');

const center = new THREE.Vector3(), p = new THREE.Vector3(), normal = new THREE.Vector3();
for (const mesh of group.children) {
  const attributes = mesh.geometry.attributes;
  assert.ok(mesh.castShadow && mesh.receiveShadow);
  assert.ok(attributes.color, 'Every part supports the wood edge vertex colors');
  for (const name of ['position', 'normal', 'uv', 'color']) for (const number of attributes[name].array) assert.ok(Number.isFinite(number), `${name} is finite`);
  for (let i = 0; i < attributes.normal.count; i++) {
    normal.fromBufferAttribute(attributes.normal, i);
    assert.ok(normal.length() > .99 && normal.length() < 1.01, 'Normals stay normalized including seam vertices');
  }
  for (const index of mesh.geometry.index.array) assert.ok(index >= 0 && index < attributes.position.count);
}

let feet = 0;
for (const [name, part] of Object.entries(stats.parts)) {
  if (part.kind !== 'wood-sweep') continue;
  const mesh = group.children[part.meshIndex], { position, uv, normal: normals } = mesh.geometry.attributes;
  assert.equal(part.grainAxis, 'u');
  const u0 = uv.getX(part.vertexStart), u1 = uv.getX(part.vertexStart + (part.rows - 1) * part.stride);
  assert.ok(Math.abs(u0) < .00001 && Math.abs(u1 - part.length) < .00001, 'Grain U records physical piece length in metres');
  for (let row = 0; row < part.rows; row++) {
    const start = part.vertexStart + row * part.stride;
    center.set(0, 0, 0);
    for (let col = 0; col < part.stride - 1; col++) center.add(p.fromBufferAttribute(position, start + col));
    center.multiplyScalar(1 / (part.stride - 1));
    for (let col = 0; col < part.stride; col++) {
      assert.ok(Math.abs(uv.getX(start + col) - uv.getX(start)) < .00001, 'Fibres follow the sweep instead of each box face');
      normal.fromBufferAttribute(normals, start + col);
      p.fromBufferAttribute(position, start + col).sub(center);
      assert.ok(normal.dot(p) > .0001, `${name} has outward side normals`);
    }
  }
  if (part.floorStart) {
    feet++;
    for (let col = 0; col < part.stride; col++) assert.ok(Math.abs(position.getY(part.vertexStart + col) - .002) < .000001, 'Splayed feet have horizontal soles');
    const cap = stats.parts[`${name}-endgrain`], capNormal = group.children[cap.meshIndex].geometry.attributes.normal;
    for (let i = cap.vertexStart; i < cap.vertexStart + cap.vertexCount / 2; i++) assert.ok(capNormal.getY(i) < -.999, 'Closed foot caps point down towards the floor');
  }
}
assert.equal(feet, 4);
assert.equal(Object.values(stats.parts).filter(part => part.kind === 'wood-sweep' && part.part === 'back-slat').length, 3, 'Back uses three broad curved wooden slats');

function ray(origin, direction, mesh) {
  return new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction), 0, 2).intersectObject(mesh, false)[0];
}
const cushionPart = stats.parts['upholstered-seat'], cushion = group.children[cushionPart.meshIndex];
const top = ray([0, 1, 0], [0, -1, 0], cushion), underside = ray([0, 0, 0], [0, 1, 0], cushion);
assert.ok(top && underside, 'Closed upholstery is visible from above and below with FrontSide material');
const thickness = top.point.y - underside.point.y;
assert.ok(thickness > .04 && thickness < .065, 'Upholstery has padded thickness, rather than a thin flat slab');
assert.ok(ray([-.5, .488, -.008], [1, 0, 0], cushion), 'Left cushion seam is closed');
assert.ok(ray([.5, .488, -.008], [-1, 0, 0], cushion), 'Right cushion seam is closed');
const cushionUV = cushion.geometry.attributes.uv, cushionP = cushion.geometry.attributes.position;
const cushionColor = cushion.geometry.attributes.color;
let minFabricColor = Infinity, maxFabricColor = -Infinity;
for (let i = cushionPart.vertexStart; i < cushionPart.vertexStart + cushionPart.topVertices; i++) {
  assert.ok(Math.abs(cushionUV.getX(i) - cushionP.getX(i)) < .000001 && Math.abs(cushionUV.getY(i) - cushionP.getZ(i)) < .000001, 'Upholstery weave uses real metre UVs');
  const value = cushionColor.getX(i);
  assert.ok(value >= .97 && value <= 1.01, 'Fabric wear remains a subtle neutral modulation');
  assert.ok(value === cushionColor.getY(i) && value === cushionColor.getZ(i), 'Vertex wear does not tint the cloth');
  minFabricColor = Math.min(minFabricColor, value); maxFabricColor = Math.max(maxFabricColor, value);
}
assert.ok(maxFabricColor - minFabricColor > .015 && maxFabricColor - minFabricColor < .035, 'Pressure at the edge remains distinct without high contrast patches');
for (let i = cushionPart.vertexStart + cushionPart.skirtStart; i < cushionPart.vertexStart + cushionPart.skirtStart + cushionPart.skirtVertices; i++) {
  assert.ok(Math.abs(cushionUV.getY(i) - (cushionP.getY(i) - .460)) < .000001, 'Upholstery skirt has vertical metre UVs without stretched weave');
}
const timber = group.children[stats.parts['curved-back-slat-2'].meshIndex];
let maximumSupportGap = -Infinity, minimumSupportGap = Infinity;
for (const [x, z] of [[0, -.201], [-.199, 0], [.199, 0], [0, .177]]) {
  const base = ray([x, .3, z], [0, 1, 0], cushion);
  const support = ray([x, .55, z], [0, -1, 0], timber);
  assert.ok(base && support, 'Cushion base has a physical timber apron beneath each edge');
  const gap = base.point.y - support.point.y;
  maximumSupportGap = Math.max(maximumSupportGap, gap); minimumSupportGap = Math.min(minimumSupportGap, gap);
  assert.ok(gap >= -.004 && gap <= .002, 'Fixed upholstery meets its frame within 2 mm, without a floating pillow edge');
}
assert.ok(ray([0, .79, -.5], [0, 0, 1], timber), 'Curved back faces the sitter');
assert.ok(ray([0, .79, .7], [0, 0, -1], timber), 'Back is solid and shaded from behind');
const triangleParts = {};
for (const part of Object.values(stats.parts)) triangleParts[part.part] = (triangleParts[part.part] || 0) + part.triangles;
console.log(JSON.stringify({ triangles: stats.triangles, vertices: stats.vertices, meshes: stats.meshes, materials: stats.materials, parts: triangleParts, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() }, cushionThicknessMm: Number((thickness * 1000).toFixed(2)), supportGapMm: [minimumSupportGap, maximumSupportGap].map(value => Number((value * 1000).toFixed(3))), floorContact: 'four flat soles', winding: 'front/side/back/underside PASS', uvUnits: stats.uvUnits }));
