import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'three') return { url: new URL('../dist/vendor/three.module.js', import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import('three');
const data = (await import('../dist/assets/player-shadow/human-data.js')).default;
const { createHumanShadowProxy } = await import('../dist/player-shadow.js');
const human = createHumanShadowProxy(), mesh = human.mesh;
const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
const seal = data.metadata.headSeal;
assert.ok(seal && seal.triangles > 0 && seal.triangles <= 300, 'The closed head interior fits the shadow budget');
assert.ok(human.triangles <= 6500, 'The complete person retains the one-draw budget');
const headIndex = mesh.skeleton.bones.findIndex(bone => bone.name === 'mixamorigHead');
const end = seal.firstVertex + seal.vertexCount;
const edges = new Map(), headIndices = [], coreIndices = [];
for (let i = 0; i < mesh.geometry.index.count; i += 3) {
  const ids = Array.from(mesh.geometry.index.array.slice(i, i + 3));
  if (ids.every(id => position.getY(id) > 1.34)) headIndices.push(...ids);
  if (ids.every(id => id >= seal.firstVertex && id < end)) {
    coreIndices.push(...ids);
    for (let e = 0; e < 3; e++) {
      const a = ids[e], b = ids[(e + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const edge = edges.get(key) ?? { count: 0, winding: 0 };
      edge.count++; edge.winding += a < b ? 1 : -1; edges.set(key, edge);
    }
  }
}
assert.equal(coreIndices.length / 3, seal.triangles);
for (const edge of edges.values()) {
  assert.equal(edge.count, 2, 'The head core is watertight: every edge has two faces');
  assert.equal(edge.winding, 0, 'Adjacent faces use consistent outward winding');
}
for (let i = seal.firstVertex; i < end; i++) {
  assert.equal(skinIndex.getX(i), headIndex);
  assert.equal(skinWeight.getX(i), 1, 'The seal moves rigidly with the skull through animation');
  assert.equal(skinWeight.getY(i) + skinWeight.getZ(i) + skinWeight.getW(i), 0);
}

// Ray samples cover the interior of the face/cranium rather than just checking
// total body bounds. A head can have correct bounds and still leak lamplight
// through the open eyes/scalp. Use front-face culling, as the real depth pass.
const baked = new THREE.BufferGeometry();
baked.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(position.count * 3), 3));
baked.setIndex(headIndices);
const target = new THREE.Mesh(baked, new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
target.updateMatrixWorld(true);
const ray = new THREE.Raycaster(), point = new THREE.Vector3(), origin = new THREE.Vector3();
const direction = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(), endPoint = new THREE.Vector3();
const headCenter = new THREE.Vector3().fromArray(seal.center), axis = new THREE.Vector3(0, 1, 0);
const headTransform = new THREE.Matrix4(), boneTransform = new THREE.Matrix4();
const directions = [];
for (const elevation of [-65, -35, 0, 35, 65]) for (let yaw = 0; yaw < 360; yaw += 45) {
  const e = THREE.MathUtils.degToRad(elevation), y = THREE.MathUtils.degToRad(yaw);
  directions.push({ name: `${yaw}/${elevation}`, light: new THREE.Vector3(Math.sin(y) * Math.cos(e), Math.sin(e), Math.cos(y) * Math.cos(e)) });
}
directions.push({ name: 'above', light: new THREE.Vector3(0, 1, .00001).normalize() },
  { name: 'below', light: new THREE.Vector3(0, -1, .00001).normalize() });
const samples = [];
for (let y = -6; y <= 6; y++) for (let x = -5; x <= 5; x++) {
  if ((x / 5.5) ** 2 + (y / 6.8) ** 2 <= 1) samples.push([x * .01, y * .01]);
}
const controls = { position: new THREE.Vector3(), yaw: 0, speed: 0, moving: false, running: false,
  gait: { phase: 0, blend: 0, runBlend: 0, localX: 0, localZ: -1 } };
let rays = 0, poses = 0, originalHeadLeaks = 0;
for (const [name, blend, runBlend] of [['idle', 0, 0], ['walk', 1, 0], ['run', 1, 1]]) {
  for (let frame = 0; frame < (name === 'idle' ? 1 : 8); frame++) {
    controls.gait.blend = blend; controls.gait.runBlend = runBlend;
    controls.gait.phase = frame / 8 * Math.PI * 2;
    controls.yaw = frame * .37;
    human.update(controls, 1 / 30);
    for (let i = 0; i < position.count; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
      baked.attributes.position.setXYZ(i, point.x, point.y, point.z);
    }
    baked.computeBoundingBox(); baked.computeBoundingSphere();
    boneTransform.multiplyMatrices(mesh.skeleton.bones[headIndex].matrixWorld, mesh.skeleton.boneInverses[headIndex]);
    headTransform.copy(mesh.matrixWorld).multiply(mesh.bindMatrixInverse).multiply(boneTransform).multiply(mesh.bindMatrix);
    // A negative control retains precisely the pre-fix face/scalp triangles.
    // It proves that these rays exercise the old leak, rather than only hitting
    // the safe middle of a head that was already opaque.
    const passes = name === 'idle' ? ['original', 'sealed'] : ['sealed'];
    for (const pass of passes) {
      baked.setIndex(pass === 'original' ? headIndices.filter(id => id < seal.firstVertex) : headIndices);
    for (const { name: view, light } of directions) {
      side.crossVectors(axis, light).normalize(); up.crossVectors(light, side).normalize();
      for (const [x, y] of samples) {
        endPoint.copy(headCenter).addScaledVector(side, x).addScaledVector(up, y);
        origin.copy(endPoint).add(light).applyMatrix4(headTransform);
        endPoint.applyMatrix4(headTransform); direction.subVectors(endPoint, origin).normalize();
        ray.set(origin, direction); ray.far = origin.distanceTo(endPoint) + .001;
        const hits = ray.intersectObject(target);
        if (pass === 'original') { if (hits.length === 0) originalHeadLeaks++; continue; }
        assert.ok(hits.length > 0, `No light may pass into the skull: ${name} frame ${frame}, view ${view}, sample ${x}/${y}`);
        rays++;
      }
    }
    }
    poses++;
  }
}
assert.ok(originalHeadLeaks > 0, 'The occlusion samples reproduce the previous face/scalp leak');
target.material.dispose(); baked.dispose(); human.dispose();
console.log(JSON.stringify({ closedHead: 'OK', watertight: 'OK', rigidHeadSkinning: 'OK', poses,
  lightDirections: directions.length, occlusionRays: rays, originalHeadLeaks,
  addedTriangles: seal.triangles, totalTriangles: data.metadata.triangles }));
