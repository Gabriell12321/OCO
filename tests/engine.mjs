import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'three') return { url: new URL('../dist/vendor/three.module.js', import.meta.url).href, shortCircuit: true };
  if (specifier.startsWith('three/addons/')) return { url: new URL('../dist/vendor/addons/' + specifier.slice(13), import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import('three');
const { compileStaticScene } = await import('../dist/engine/static-scene.js');
const { ResolutionGovernor } = await import('../dist/engine/resolution-governor.js');
const { createRenderPipeline } = await import('../dist/engine/render-pipeline.js');

const scene = new THREE.Scene(); scene.position.set(2, 1, -3);
const group = new THREE.Group(); group.rotation.y = .21; scene.add(group);
const shared = new THREE.BoxGeometry(.2, .2, .2), material = new THREE.MeshStandardMaterial();
let sharedDisposed = false; shared.addEventListener('dispose', () => { sharedDisposed = true; });
for (let i = 0; i < 8; i++) {
  const mesh = new THREE.Mesh(shared, material);
  mesh.position.set(i < 4 ? .3 + i * .3 : 5 + (i - 4) * .3, .2, .5);
  mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
}
const dynamic = new THREE.Mesh(shared, material); dynamic.userData.dynamic = true;
dynamic.position.set(2, 1, 2); group.add(dynamic);
scene.updateMatrixWorld(true);
const before = new THREE.Box3().setFromObject(scene), beforeTriangles = 9 * 12;
const stats = compileStaticScene(scene, { cellSize: 3 });
scene.updateMatrixWorld(true);
const after = new THREE.Box3().setFromObject(scene);
assert.ok(before.min.distanceTo(after.min) < 1e-6 && before.max.distanceTo(after.max) < 1e-6,
  'Batching preserves nested transforms, including a transformed scene root');
assert.ok(dynamic.parent === group && !sharedDisposed, 'Retained dynamic meshes keep their shared source geometry');
assert.ok(stats.batches >= 2 && stats.meshesAfter < stats.meshesBefore, 'Spatial batches remain separate and reduce draws');
let triangles = 0;
scene.traverse(object => {
  if (!object.isMesh) return;
  assert.ok(object.geometry.index, 'Indexed vertices are not expanded to triangle soup');
  triangles += object.geometry.index.count / 3;
  if (object.name === 'OCO static batch') {
    assert.ok(object.castShadow && object.receiveShadow);
    assert.ok(object.geometry.boundingSphere.radius < 2, 'A furniture batch remains locally cullable');
  }
});
assert.equal(triangles, beforeTriangles, 'Batching does not remove triangles');
assert.equal(stats.verticesAfter, stats.verticesBefore, 'Vertex indexing is preserved');

const governor = new ResolutionGovernor();
const sample = (now, fps = 40, gpuMs = 22, enabled = true) =>
  governor.update({ now, fps, gpuMs, pixels: 960 * 540, enabled });
assert.equal(sample(4000), 1, 'Startup does not change resolution');
sample(5000); sample(6000);
assert.equal(sample(7000), .9, 'Performance mode can reduce resolution after sustained overload');
for (let time = 10000; time < 30000; time += 1000) sample(time, 60, 15);
assert.equal(governor.scale, .9, 'A frame with no spare GPU budget does not trigger oscillation');
for (let time = 30000; time <= 40000; time += 1000) sample(time, 60, 9);
assert.equal(governor.scale, 1, 'Sustained GPU headroom restores native profile resolution');
governor.reset();
for (let time = 5000; time < 90000; time += 1000) sample(time);
assert.ok(Math.abs(governor.scale - 2 / 3) < 1e-9, 'The configured 360p pixel floor is respected');
governor.reset();
for (let time = 5000; time < 20000; time += 1000) sample(time, 10, 50, false);
assert.equal(governor.scale, 1, 'A benchmark resolution lock keeps A/B pixel counts identical');

const renderer = { capabilities: { maxSamples: 4 }, setRenderTarget() {} };
const pipeline = createRenderPipeline(renderer);
pipeline.resize(960, 540, 'performance');
assert.equal(pipeline.snapshot().renderPath, 'hdr-output-fxaa');
assert.equal(pipeline.snapshot().renderTargetSamples, 0);
pipeline.resize(1280, 720, 'balanced'); pipeline.dispose();
assert.equal(pipeline.snapshot().postprocessing, false, 'Disposed render targets are not reused');
const diagnostic = createRenderPipeline(renderer, { fxaa: false });
diagnostic.resize(1600, 900, 'quality'); assert.equal(diagnostic.snapshot().renderTargetSamples, 4);
diagnostic.resize(960, 540, 'performance'); assert.equal(diagnostic.snapshot().renderPath, 'direct');
diagnostic.dispose();
console.log(JSON.stringify({ indexedSpatialBatches: stats, transforms: 'preserved',
  triangleCount: triangles, adaptiveResolution: 'overload / recovery / floor / benchmark lock OK',
  pipelineLifecycle: 'HDR-FXAA / diagnostic MSAA / direct / disposal OK' }));
