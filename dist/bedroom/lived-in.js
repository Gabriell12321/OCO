import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ATLAS_SIZE = 1024;
const TILES = {
  left: [16, 16, 480, 624], right: [528, 16, 480, 624],
  envelope: [16, 672, 480, 320], ring: [592, 704, 288, 288],
  edge: [512, 672, 32, 320]
};

// Actual notes, with room left for another day. One canvas serves both paper
// and the small contact stain; there is no animated dirt or random scribble.
function makeAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ATLAS_SIZE;
  const c = canvas.getContext('2d');
  for (const [key, tile] of Object.entries(TILES)) {
    if (key === 'ring') continue;
    const [x, y, w, h] = tile;
    c.fillStyle = key === 'envelope' ? '#c9bba0' : '#e3dcca';
    c.fillRect(x, y, w, h);
    if (key === 'edge') {
      c.strokeStyle = 'rgba(116,99,73,.19)'; c.lineWidth = 1;
      for (let py = y + 3; py < y + h; py += 12) {
        c.beginPath(); c.moveTo(x, py); c.lineTo(x + w, py); c.stroke();
      }
    }
  }
  for (const key of ['left', 'right']) {
    const [x, y, w, h] = TILES[key];
    const edge = c.createLinearGradient(x, 0, x + w, 0);
    edge.addColorStop(0, key === 'right' ? 'rgba(89,69,47,.16)' : 'rgba(125,98,63,.04)');
    edge.addColorStop(.12, 'rgba(89,69,47,0)');
    edge.addColorStop(.85, 'rgba(89,69,47,0)');
    edge.addColorStop(1, key === 'left' ? 'rgba(89,69,47,.15)' : 'rgba(125,98,63,.04)');
    c.fillStyle = edge; c.fillRect(x, y, w, h);
    c.strokeStyle = 'rgba(92,113,116,.14)'; c.lineWidth = 1;
    for (let line = 0; line < 10; line++) {
      const py = y + 155 + line * 41;
      c.beginPath(); c.moveTo(x + 35, py); c.lineTo(x + w - 30, py); c.stroke();
    }
  }
  const note = (tile, text, x, y, size = 22) => {
    c.font = `${size}px "Segoe Print", "Comic Sans MS", cursive`;
    c.fillStyle = '#59615c';
    c.fillText(text, TILES[tile][0] + x, TILES[tile][1] + y);
  };
  note('left', 'Antes de dormir', 42, 90, 28);
  note('left', 'Terminar este capítulo.', 42, 149);
  note('left', 'Amanhã devolvo o livro', 45, 190);
  note('left', 'para a Ana.', 43, 231);
  note('left', 'Parei na página 84.', 44, 313);
  note('right', 'Amanhã', 40, 90, 28);
  note('right', 'comprar café', 62, 149);
  note('right', 'ligar para mãe', 61, 190);
  note('right', 'trocar a lâmpada', 63, 231);
  for (let row = 0; row < 3; row++) {
    c.strokeStyle = 'rgba(73,85,79,.64)'; c.lineWidth = 1.4;
    c.strokeRect(565, 150 + row * 41, 10, 10);
  }
  const [ex, ey, ew, eh] = TILES.envelope;
  c.strokeStyle = 'rgba(100,80,53,.17)'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(ex + 2, ey + 8); c.lineTo(ex + ew / 2, ey + eh * .69); c.lineTo(ex + ew - 2, ey + 8); c.stroke();
  c.beginPath(); c.moveTo(ex + 2, ey + eh - 2); c.lineTo(ex + ew * .27, ey + eh * .49); c.moveTo(ex + ew - 2, ey + eh - 2); c.lineTo(ex + ew * .73, ey + eh * .49); c.stroke();
  c.font = '24px "Segoe Print", cursive'; c.fillStyle = '#726d5e';
  c.fillText('Ana', ex + 36, ey + eh - 42);
  // Deliberately incomplete dried ring where a cup was put down before moving.
  // Alpha-tested, rather than a broad transparent quad over the desk.
  const [rx, ry, rw] = TILES.ring;
  for (let pass = 0; pass < 3; pass++) {
    c.strokeStyle = ['rgba(77,49,23,.18)', 'rgba(101,70,36,.12)', 'rgba(117,83,45,.08)'][pass];
    c.lineWidth = [4, 2, 6][pass];
    c.beginPath(); c.arc(rx + rw / 2, ry + rw / 2, 93 + pass * 2, .15, 5.25); c.stroke();
  }
  c.fillStyle = 'rgba(87,61,33,.14)'; c.beginPath(); c.ellipse(rx + 64, ry + 231, 5, 3, -.4, 0, Math.PI * 2); c.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'Reading notes, folded envelope and one dried cup ring';
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}

function tileUV(tile, u, v) {
  const [x, y, w, h] = TILES[tile];
  return [(x + 2 + u * (w - 4)) / ATLAS_SIZE, 1 - (y + 2 + v * (h - 4)) / ATLAS_SIZE];
}

function surface(width, depth, tile, elevation, nx = 14, nz = 12) {
  const positions = [], uvs = [], indices = [];
  for (let row = 0; row <= nz; row++) for (let col = 0; col <= nx; col++) {
    const u = col / nx, v = row / nz;
    positions.push((u - .5) * width, elevation(u, v), (v - .5) * depth);
    uvs.push(...tileUV(tile, u, v));
  }
  for (let row = 0; row < nz; row++) for (let col = 0; col < nx; col++) {
    const a = row * (nx + 1) + col, b = a + 1, c = a + nx + 1, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  result.setIndex(indices); result.computeVertexNormals();
  return result;
}

function mapTile(geometry, tile) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, ...tileUV(tile, uv.getX(i), uv.getY(i)));
  return geometry;
}

/** Two authored, static reading/writing clusters in the current bedroom.
 * Remove the old loosePaper and desk pen; keep the books, cup and desk pad.
 * Optional world transforms make relocation explicit without per-frame work.
 */
export function createLivedInDetails(materials = {}, {
  deskPosition = [2.47, 0, -.65], deskRotation = -Math.PI / 2,
  bedsideBookPosition = [.54, .707, -2.45], bedsideBookRotation = -.15
} = {}) {
  const atlas = makeAtlas();
  const paper = new THREE.MeshStandardMaterial({ map: atlas, color: '#f7f2df', roughness: .98, side: THREE.DoubleSide });
  paper.name = 'Cream notebook paper with real evening notes';
  const cover = new THREE.MeshStandardMaterial({ color: '#555a4a', roughness: .92 });
  cover.name = 'Soft worn cloth notebook cover';
  const metal = materials.brass?.clone() || new THREE.MeshStandardMaterial({ color: '#77715d', metalness: .55, roughness: .43 });
  metal.name = 'Dull reading glasses wire'; metal.color.set('#857e65'); metal.roughness = .45;
  const dark = new THREE.MeshStandardMaterial({ color: '#343b35', roughness: .66 });
  dark.name = 'Used green pen and spectacle earpieces';
  const stain = new THREE.MeshStandardMaterial({ map: atlas, color: '#b8a282', roughness: 1,
    transparent: true, alphaTest: .035, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  stain.name = 'Single dried cup contact mark';
  const group = new THREE.Group(); group.name = 'An evening interrupted: notebook and reading glasses'; group.userData.static = true;
  const buckets = new Map(), parts = [];
  const transform = (position, yaw = 0) => new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
  const desk = transform(deskPosition, deskRotation), bedside = transform(bedsideBookPosition, bedsideBookRotation);
  const notebook = desk.clone().multiply(transform([-.025, .8142, .048], -.13));
  const add = (name, geometry, material, parent, position = [0, 0, 0], yaw = 0) => {
    geometry.applyMatrix4(parent.clone().multiply(transform(position, yaw)));
    geometry.computeBoundingBox();
    const list = buckets.get(material) || []; list.push(geometry); buckets.set(material, list);
    parts.push({ name, triangles: (geometry.index?.count || geometry.attributes.position.count) / 3,
      min: geometry.boundingBox.min.toArray(), max: geometry.boundingBox.max.toArray() });
  };
  const box = (name, dims, material, parent, pos, yaw = 0, tile = null) => {
    const geo = new THREE.BoxGeometry(...dims);
    if (tile) mapTile(geo, tile);
    add(name, geo, material, parent, pos, yaw);
  };
  const tube = (name, points, radius, material, parent, segments = 20, closed = false) => {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), closed, 'centripetal');
    add(name, new THREE.TubeGeometry(curve, segments, radius, 5, closed), material, parent);
  };
  const coverGeometry = new THREE.BoxGeometry(.352, .0024, .246, 12, 1, 10);
  const coverPositions = coverGeometry.attributes.position;
  for (let i = 0; i < coverPositions.count; i++) {
    const x = coverPositions.getX(i), z = coverPositions.getZ(i);
    // The rear-left corner flexes over the tucked envelope. The other edges
    // still touch the writing pad rather than floating as one rigid box.
    const lift = .0018 * Math.pow(THREE.MathUtils.clamp((-x + .06) / .23, 0, 1), 1.3)
      * Math.pow(THREE.MathUtils.clamp((-z + .035) / .155, 0, 1), 1.4);
    coverPositions.setY(i, coverPositions.getY(i) + lift);
  }
  coverGeometry.computeVertexNormals();
  add('Notebook cloth cover', coverGeometry, cover, notebook);
  // Thin page blocks make the raised leaf physically supported at its edges.
  for (const side of [-1, 1]) {
    box(`Notebook page block ${side}`, [.166, .004, .232], paper, notebook, [side * .085, .003, 0], 0, 'edge');
    const elevation = (u, v) => {
      const across = side < 0 ? 1 - u : u;
      return .0051 + Math.sin(across * Math.PI) * .0055 + Math.pow(across, 8) * Math.pow(1 - v, 7) * .0026;
    };
    add(`Curved written leaf ${side}`, surface(.166, .232, side < 0 ? 'left' : 'right', elevation), paper, notebook, [side * .085, 0, 0]);
  }
  tube('Cloth spine at the open fold', [[0, .003, -.12], [0, .0036, 0], [0, .003, .12]], .0014, cover, notebook, 10);
  // The envelope tucks under the upper-left corner and follows the pad height.
  const envelope = desk.clone().multiply(transform([-.178, .814, -.107], .21));
  box('Envelope folded thickness', [.174, .0008, .108], paper, envelope, [0, 0, 0], 0, 'edge');
  add('Envelope folded face', surface(.174, .108, 'envelope', (u, v) => .00055 + Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * .0007, 6, 4), paper, envelope);
  const penStart = new THREE.Vector3(.215, .816, .018), penEnd = new THREE.Vector3(.284, .816, .135);
  const delta = penEnd.clone().sub(penStart), length = delta.length();
  const penGeometry = new THREE.CylinderGeometry(.0029, .0029, length, 10);
  penGeometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize()));
  add('Pen laid beside the current page', penGeometry, dark, desk, penStart.clone().add(penEnd).multiplyScalar(.5).toArray());
  const nib = new THREE.ConeGeometry(.0027, .008, 8);
  nib.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize()));
  add('Pen tip', nib, metal, desk, penEnd.clone().addScaledVector(delta.clone().normalize(), .004).toArray());
  // A restrained ring lives on bare wood, not on the writing pad.
  add('Old cup position on the desktop', surface(.122, .122, 'ring', () => .8033, 1, 1), stain, desk, [.455, 0, .12]);
  // Frames lie on the bedside book. Clear, thin lenses need no extra glass pass.
  const spectacles = bedside.clone().multiply(transform([.002, .0138, -.006], .18));
  for (const side of [-1, 1]) {
    const lensPoints = Array.from({ length: 24 }, (_, i) => {
      const angle = i / 24 * Math.PI * 2;
      return [side * .030 + Math.cos(angle) * .025, .0038 + Math.sin(angle) * .0007, Math.sin(angle) * .018];
    });
    tube(`Reading frame ${side}`, lensPoints, .00115, metal, spectacles, 30, true);
    // Folded temples rest on the book and cross gently behind the frames.
    tube(`Folded spectacle temple ${side}`, [[side * .055, .0038, -.002], [side * .058, .0035, -.023], [side * .024, .0021, -.073], [-side * .015, .0018, -.091]], .00105, metal, spectacles, 18);
    tube(`Spectacle earpiece ${side}`, [[-side * .013, .0018, -.088], [-side * .021, .002, -.096], [-side * .031, .0021, -.093]], .0015, dark, spectacles, 8);
  }
  tube('Reading glasses bridge', [[-.006, .004, -.001], [0, .007, -.003], [.006, .004, -.001]], .0011, metal, spectacles, 8);
  // A bookmark left in the existing book ties the writing and reading together.
  box('Faded cloth bookmark', [.011, .0007, .096], cover, bedside, [.047, .0148, .086], -.06);
  let triangles = 0, vertices = 0;
  for (const [material, geometries] of buckets) {
    const merged = mergeGeometries(geometries, false);
    merged.computeBoundingBox(); merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = material.name; mesh.castShadow = material !== stain; mesh.receiveShadow = true;
    mesh.userData.static = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    group.add(mesh); triangles += merged.index.count / 3; vertices += merged.attributes.position.count;
    for (const geometry of geometries) geometry.dispose();
  }
  const bounds = new THREE.Box3().setFromObject(group);
  return { group, bounds, stats: { triangles, vertices, meshes: group.children.length, materials: buckets.size,
    textureCount: 1, atlasSize: ATLAS_SIZE, animated: false, clusters: 2, parts } };
}
