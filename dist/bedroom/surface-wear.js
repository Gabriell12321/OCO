import * as THREE from 'three';

/** Settled traces of use, deliberately placed where contact or water occurs.
 * Soft vertex-alpha patches share one static mesh; there are no dust sprites,
 * image uploads, decals projected every frame or geometry in the walking path. */
export function createSurfaceWear() {
  const positions = [], normals = [], colors = [], indices = [];
  const parts = [];
  function patch(name, center, u, v, width, height, color, opacity, phase) {
    const start = positions.length / 3, segments = 20;
    const normal = new THREE.Vector3().crossVectors(new THREE.Vector3(...u), new THREE.Vector3(...v)).normalize();
    const shade = new THREE.Color(color);
    for (const [radius, alpha] of [[0, opacity], [.48, opacity * .62], [1, 0]]) {
      for (let i = 0; i <= segments; i++) {
        const angle = i / segments * Math.PI * 2;
        const irregular = 1 + .12 * Math.sin(angle * 3 + phase) + .07 * Math.cos(angle * 5 - phase);
        const x = Math.cos(angle) * width * .5 * radius * irregular;
        const y = Math.sin(angle) * height * .5 * radius * irregular;
        positions.push(center[0] + u[0] * x + v[0] * y,
          center[1] + u[1] * x + v[1] * y, center[2] + u[2] * x + v[2] * y);
        normals.push(normal.x, normal.y, normal.z);
        colors.push(shade.r, shade.g, shade.b, alpha);
      }
    }
    // Center fan, then a ring. Avoid degenerate center triangles.
    for (let i = 0; i < segments; i++) {
      const inner = start + segments + 1 + i, outer = inner + segments + 1;
      indices.push(start, inner, inner + 1, inner, outer, inner + 1, inner + 1, outer, outer + 1);
    }
    parts.push({ name, center, opacity, width, height });
  }
  const frontU = [1, 0, 0], frontV = [0, -1, 0];
  patch('Hand wear around the light switch', [1.225, 1.222, 3.1994], frontU, frontV,
    .215, .27, '#81786a', .11, .4);
  patch('Thumb contact beside the switch', [1.279, 1.228, 3.1991], frontU, frontV,
    .037, .085, '#6b6458', .085, 2.1);
  patch('Old water trace below the sill', [1.17, .876, -3.1994], [1, 0, 0], [0, 1, 0],
    .12, .158, '#837c65', .13, 1.8);
  patch('Dried lower end of the water trace', [1.184, .777, -3.1991], [1, 0, 0], [0, 1, 0],
    .034, .10, '#877e63', .065, .2);
  // Short, differently oriented chair marks follow the direction of movement.
  for (const [x, z, angle, width, phase] of [[1.21, -.23, .09, .18, 1], [1.63, -.20, -.05, .22, 2], [1.32, .02, .18, .13, 3]]) {
    const u = [Math.cos(angle), 0, Math.sin(angle)], v = [Math.sin(angle), 0, -Math.cos(angle)];
    patch('Chair contact on floor', [x, .0024, z], u, v, width, .018, '#514438', .09, phase);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1,
    vertexColors: true, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  material.name = 'Localized hand, water and floor wear';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Surface traces of everyday use'; mesh.castShadow = false; mesh.receiveShadow = true;
  mesh.userData.static = true;
  return { mesh, stats: { patches: parts.length, triangles: indices.length / 3,
    meshes: 1, textures: 0, animated: false, parts } };
}
