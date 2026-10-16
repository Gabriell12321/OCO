import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Compile immutable meshes once. Keep vertex indices so shared vertices are
 * transformed once by the GPU, and bound furniture batches spatially. */
export function compileStaticScene(scene, { cellSize = 3 } = {}) {
  scene.updateMatrixWorld(true);
  const groups = new Map(), obsolete = new Set();
  const box = new THREE.Box3(), center = new THREE.Vector3(), size = new THREE.Vector3();
  const toScene = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  const transform = new THREE.Matrix4();
  const stats = { meshesBefore: 0, meshesAfter: 0, verticesBefore: 0, verticesAfter: 0,
    triangles: 0, batches: 0, cellSize };
  scene.traverse(object => {
    if (!object.isMesh) return;
    stats.meshesBefore++; stats.verticesBefore += object.geometry.attributes.position.count;
    stats.triangles += (object.geometry.index?.count || object.geometry.attributes.position.count) / 3;
    if (object.isSkinnedMesh || object.isInstancedMesh || Array.isArray(object.material) || object.material.transparent ||
        Object.keys(object.geometry.morphAttributes).length ||
        object.userData.dynamic || object.userData.noStaticBatch) return;
    object.geometry.computeBoundingBox();
    box.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld);
    box.getCenter(center); box.getSize(size);
    const cell = cellSize > 0 && Math.max(size.x, size.z) <= cellSize
      ? `${Math.floor(center.x / cellSize)},${Math.floor(center.z / cellSize)}` : 'shell';
    const attributes = Object.keys(object.geometry.attributes).sort().join(',');
    const key = [object.material.uuid, object.castShadow, object.receiveShadow,
      object.renderOrder, object.layers.mask, object.frustumCulled, cell, attributes].join(':');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(object);
  });
  for (const objects of groups.values()) {
    if (objects.length < 3) continue;
    const geometries = objects.map(object => {
      const geometry = object.geometry.clone();
      geometry.applyMatrix4(transform.multiplyMatrices(toScene, object.matrixWorld));
      if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.attributes.position.count }, (_, i) => i));
      return geometry;
    });
    const combined = mergeGeometries(geometries, false);
    geometries.forEach(geometry => geometry.dispose());
    if (!combined) continue;
    combined.computeBoundingBox(); combined.computeBoundingSphere();
    const mesh = new THREE.Mesh(combined, objects[0].material);
    mesh.castShadow = objects[0].castShadow; mesh.receiveShadow = objects[0].receiveShadow;
    mesh.renderOrder = objects[0].renderOrder; mesh.layers.mask = objects[0].layers.mask;
    mesh.frustumCulled = objects[0].frustumCulled;
    mesh.name = 'OCO static batch';
    mesh.userData.sourceMeshes = objects.length;
    scene.add(mesh); stats.batches++;
    objects.forEach(object => { obsolete.add(object.geometry); object.removeFromParent(); });
  }
  // A geometry may also belong to an unbatched transparent/dynamic mesh.
  scene.traverse(object => {
    if (!object.isMesh) return;
    obsolete.delete(object.geometry); stats.meshesAfter++;
    stats.verticesAfter += object.geometry.attributes.position.count;
  });
  obsolete.forEach(geometry => geometry.dispose());
  return Object.freeze(stats);
}
