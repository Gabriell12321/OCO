import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const vector = (x, y, z) => new THREE.Vector3(x, y, z);
const lerp = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

function geometry(positions, indices, uvs, colors) {
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  result.setAttribute('color', new THREE.Float32BufferAttribute(colors || positions.map(() => 1), 3));
  result.setIndex(indices); result.computeVertexNormals();
  result.computeBoundingBox(); result.computeBoundingSphere();
  return result;
}

// A closed rounded rectangular section. The bevels have their own vertices;
// neither the legs nor the wide back slats are cylinders or sharp boxes.
function section(width, depth, bevel) {
  const r = Math.min(bevel, width * .42, depth * .42), points = [];
  for (let corner = 0; corner < 4; corner++) {
    const angle = corner * Math.PI / 2;
    const cx = [1, -1, -1, 1][corner] * (width / 2 - r);
    const cy = [1, 1, -1, -1][corner] * (depth / 2 - r);
    for (let i = 0; i <= 2; i++) {
      const a = angle + i * Math.PI / 4;
      points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return points;
}

function woodSweep({ points, segments = 16, width, depth, bevel = .004, across = [1, 0, 0], floorStart = false }) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => vector(...p)), false, 'centripetal');
  const positions = [], uvs = [], colors = [], indices = [], rings = [];
  const reference = vector(...across), count = 12, stride = count + 1;
  let distance = 0, previous;
  for (let row = 0; row <= segments; row++) {
    const t = row / segments, center = curve.getPoint(t), tangent = curve.getTangent(t).normalize();
    if (previous) distance += center.distanceTo(previous);
    previous = center.clone();
    const a = reference.clone().addScaledVector(tangent, -reference.dot(tangent)).normalize();
    const b = tangent.clone().cross(a).normalize();
    const w = typeof width === 'function' ? width(t) : width;
    const d = typeof depth === 'function' ? depth(t) : depth;
    const contour = section(w, d, bevel), ring = [];
    let perimeter = 0;
    for (let col = 0; col <= count; col++) {
      const [x, z] = contour[col % count];
      if (col) perimeter += Math.hypot(x - contour[(col - 1) % count][0], z - contour[(col - 1) % count][1]);
      const p = center.clone().addScaledVector(a, x).addScaledVector(b, z);
      if (floorStart && row === 0) p.y = .002;
      positions.push(p.x, p.y, p.z); uvs.push(distance, perimeter);
      // Restrained wear at the rounded arrises; no separate decal or shader.
      const corner = col % 3 === 1 ? 1 : .975;
      const wear = corner + Math.sin(t * 5.1 + x * 13) * .006;
      colors.push(wear, wear, wear); ring.push(p);
    }
    rings.push({ center, ring, contour, a, b, tangent });
  }
  for (let row = 0; row < segments; row++) for (let col = 0; col < count; col++) {
    const a = row * stride + col, b = a + 1, c = a + stride, d = c + 1;
    indices.push(a, b, c, b, d, c);
  }
  const sides = geometry(positions, indices, uvs, colors);
  // The texture seam has duplicate vertices but must share one smooth normal.
  const normal = sides.attributes.normal;
  for (let row = 0; row <= segments; row++) {
    const start = row * stride, end = start + count;
    const n = vector(normal.getX(start) + normal.getX(end), normal.getY(start) + normal.getY(end), normal.getZ(start) + normal.getZ(end)).normalize();
    normal.setXYZ(start, n.x, n.y, n.z); normal.setXYZ(end, n.x, n.y, n.z);
  }
  const capPositions = [], capUVs = [], capColors = [], capIndices = [];
  for (const [row, reverse] of [[0, true], [segments, false]]) {
    const { center, ring, contour } = rings[row], base = capPositions.length / 3;
    capPositions.push(center.x, floorStart && row === 0 ? .002 : center.y, center.z);
    capUVs.push(0, 0); capColors.push(.96, .96, .96);
    for (let i = 0; i < count; i++) {
      const p = ring[i]; capPositions.push(p.x, p.y, p.z);
      capUVs.push(...contour[i]); capColors.push(.96, .96, .96);
      const current = base + 1 + i, next = base + 1 + (i + 1) % count;
      capIndices.push(...(reverse ? [base, next, current] : [base, current, next]));
    }
  }
  return { sides, caps: geometry(capPositions, capIndices, capUVs, capColors), rows: segments + 1, stride, length: distance };
}

function cushionGeometry() {
  const columns = 32, rows = 26;
  const positions = [], uvs = [], indices = [], colors = [];
  const pulls = [
    ['front', -.112, .24, .090, .018, .0027],
    ['front', .094, -.20, .078, .019, .0023],
    ['left', -.064, .22, .087, .020, .0025],
    ['left', .104, -.18, .071, .018, .0022],
    ['right', .037, -.27, .095, .021, .0028],
    ['back', -.046, .17, .068, .019, .0021],
  ];
  function tension(u, v, x, z) {
    let height = 0;
    for (const [edge, anchor, drift, length, width, depth] of pulls) {
      const along = edge === 'front' ? (v + 1) * .199 : edge === 'back' ? (1 - v) * .199 : edge === 'left' ? (u + 1) * .202 : (1 - u) * .202;
      if (along >= length) continue;
      const across = (edge === 'front' || edge === 'back' ? x : z) - anchor - along * drift;
      const taper = smooth(along / .012) * (1 - smooth((along - .018) / (length - .018)));
      // Each gather spans at least two grid cells. The neighbouring shallow
      // crest and tapered trough read as tension, not a sharp isolated dent.
      height += (-Math.exp(-((across / width) ** 2)) + .27 * Math.exp(-(((across + width * 1.4) / (width * .85)) ** 2))) * depth * taper;
    }
    return height * smooth((1 - Math.abs(u)) / .045) * smooth((1 - Math.abs(v)) / .045);
  }
  function tint(u, v, p) {
    const wear = Math.exp(-(((p.x - .026) / .15) ** 2 + ((p.z + .032) / .13) ** 2));
    const edge = Math.exp(-Math.min(1 - Math.abs(u), 1 - Math.abs(v)) / .16);
    return .994 + .010 * wear - .017 * edge;
  }
  const contour = (u, v) => {
    const z = v * .199 - .008, halfWidth = lerp(.212, .193, (v + 1) / 2), radius = .042;
    const corner = Math.max(0, Math.abs(v * .199) - (.199 - radius));
    const rowWidth = halfWidth - radius + Math.sqrt(Math.max(0, radius * radius - corner * corner));
    return [u * rowWidth, z];
  };
  function point(u, v) {
    const [x, z] = contour(u, v);
    const inflation = Math.pow(Math.max(0, 1 - u * u), .48) * Math.pow(Math.max(0, 1 - v * v), .52);
    const depression = (.0054 * Math.exp(-(((x - .021) / .12) ** 2 + ((z + .026) / .113) ** 2))
      + .0010 * Math.exp(-(((x + .074) / .085) ** 2 + ((z - .026) / .095) ** 2))) * inflation;
    const y = .487 - v * .004 + .029 * inflation - depression + tension(u, v, x, z);
    return vector(x, y, z);
  }
  for (let row = 0; row <= rows; row++) for (let col = 0; col <= columns; col++) {
    const u = col / columns * 2 - 1, v = row / rows * 2 - 1, p = point(u, v);
    positions.push(p.x, p.y, p.z); uvs.push(p.x, p.z);
    const value = tint(u, v, p); colors.push(value, value, value);
  }
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const a = row * (columns + 1) + col, b = a + 1, c = a + columns + 1, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const points = [], seamTints = [];
  const perimeterPoint = (u, v) => { const p = point(u, v); points.push(p); seamTints.push(tint(u, v, p)); };
  for (let i = 0; i < 32; i++) perimeterPoint(-1 + i / 16, -1);
  for (let i = 0; i < 26; i++) perimeterPoint(1, -1 + i / 13);
  for (let i = 0; i < 32; i++) perimeterPoint(1 - i / 16, 1);
  for (let i = 0; i < 26; i++) perimeterPoint(-1, 1 - i / 13);
  // Upholstery is fixed around a flat seat base. The filled skirt closes the
  // space above the aprons; it is not the unsupported edge of a loose pillow.
  const skirtStart = positions.length / 3, skirtRows = [0, .22, .58, .86, 1], stride = points.length + 1;
  for (const f of skirtRows) {
    let along = 0, previous;
    for (let i = 0; i <= points.length; i++) {
      const p = points[i % points.length].clone(), inset = smooth(f);
      p.x *= 1 - .012 * inset; p.z = (p.z + .008) * (1 - .015 * inset) - .008;
      p.y = lerp(p.y, .460, f);
      if (previous) along += p.distanceTo(previous);
      previous = p.clone();
      positions.push(p.x, p.y, p.z); uvs.push(along, p.y - .460);
      const value = lerp(seamTints[i % points.length], .975, smooth(f)); colors.push(value, value, value);
    }
  }
  for (let row = 0; row < skirtRows.length - 1; row++) for (let col = 0; col < points.length; col++) {
    const a = skirtStart + row * stride + col, b = a + 1, c = a + stride, d = c + 1;
    indices.push(a, b, c, b, d, c);
  }
  const bottomStart = positions.length / 3;
  positions.push(0, .460, -.008); uvs.push(0, -.008); colors.push(.975, .975, .975);
  for (let i = 0; i < points.length; i++) {
    const p = points[i], x = p.x * .988, z = (p.z + .008) * .985 - .008;
    positions.push(x, .460, z); uvs.push(x, z); colors.push(.975, .975, .975);
    indices.push(bottomStart, bottomStart + 1 + i, bottomStart + 1 + (i + 1) % points.length);
  }
  const seam = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true, 'centripetal'), 128, .0015, 4, true);
  const seamUV = seam.attributes.uv, length = new THREE.CatmullRomCurve3(points, true, 'centripetal').getLength();
  for (let i = 0; i < seamUV.count; i++) seamUV.setXY(i, seamUV.getX(i) * length, seamUV.getY(i) * Math.PI * .003);
  seam.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(seam.attributes.position.count * 3).fill(1), 3));
  return { shell: geometry(positions, indices, uvs, colors), seam, topVertices: skirtStart, skirtStart, skirtVertices: stride * skirtRows.length, bottomStart };
}

/** Static vintage chair in local metres. Front is -Z; all four feet touch y=.002. */
export function createChair({ wood, woodEnd = wood, fabric, piping = fabric, detail = wood }) {
  if (!wood?.isMaterial || !fabric?.isMaterial) throw new TypeError('Chair requires wood and fabric materials');
  const group = new THREE.Group(); group.name = 'Vintage bent-back walnut chair';
  group.userData.static = true; group.userData.chair = true;
  const buckets = new Map(), parts = {};
  function add(name, part, geometry, material, extra = {}) {
    if (!buckets.has(material)) buckets.set(material, []);
    buckets.get(material).push({ name, part, geometry, extra });
  }
  function timber(name, options, part = name) {
    const { sides, caps, rows, stride, length } = woodSweep(options);
    add(name, part, sides, wood, { kind: 'wood-sweep', rows, stride, length, grainAxis: 'u', floorStart: !!options.floorStart });
    add(`${name}-endgrain`, part, caps, woodEnd, { kind: 'endgrain' });
    return sides;
  }

  for (const sign of [-1, 1]) {
    const side = sign < 0 ? 'left' : 'right';
    timber(`front-leg-${side}`, {
      points: [[sign * .213, .002, -.221], [sign * .202, .13, -.211], [sign * .184, .32, -.184], [sign * .184, .465, -.173]],
      segments: 18, width: t => lerp(.026, .041, smooth(t)), depth: t => lerp(.027, .039, smooth(t)), bevel: .0045, floorStart: true,
    }, 'front-leg');
    // One continuous rear leg / back post, with a mild backwards rake above
    // the seat. No floating upper stick or visible junction halfway up.
    timber(`rear-post-${side}`, {
      points: [[sign * .214, .002, .226], [sign * .198, .22, .191], [sign * .183, .46, .165], [sign * .181, .65, .180], [sign * .190, .84, .225], [sign * .196, 1.009, .253]],
      segments: 28, width: t => .029 + Math.sin(t * Math.PI) * .008, depth: t => .031 + Math.sin(t * Math.PI) * .007, bevel: .0045, floorStart: true,
    }, 'rear-post');
    timber(`side-apron-${side}`, {
      points: [[sign * .202, .433, -.185], [sign * .202, .431, -.03], [sign * .188, .433, .171]],
      segments: 14, width: .058, depth: .027, across: [0, 1, 0], bevel: .004,
    }, 'seat-frame');
    timber(`side-stretcher-${side}`, {
      points: [[sign * .202, .176, -.207], [sign * .200, .165, -.02], [sign * .200, .176, .201]],
      segments: 12, width: t => .021 + Math.sin(t * Math.PI) * .003, depth: .022, across: [1, 0, 0], bevel: .0055,
    }, 'lower-stretcher');
  }
  const frontApron = timber('front-apron', {
    points: [[-.202, .437, -.185], [0, .434, -.201], [.202, .437, -.185]],
    segments: 18, width: .055, depth: .028, across: [0, 1, 0], bevel: .0045,
  }, 'seat-frame');
  timber('rear-apron', {
    points: [[-.187, .437, .173], [0, .433, .179], [.187, .437, .173]],
    segments: 14, width: .053, depth: .027, across: [0, 1, 0], bevel: .004,
  }, 'seat-frame');
  timber('front-lower-stretcher', {
    points: [[-.204, .225, -.200], [0, .218, -.207], [.204, .225, -.200]],
    segments: 12, width: .023, depth: .023, across: [0, 1, 0], bevel: .0055,
  }, 'lower-stretcher');
  timber('rear-lower-stretcher', {
    points: [[-.201, .23, .191], [0, .224, .194], [.201, .23, .191]],
    segments: 12, width: .022, depth: .022, across: [0, 1, 0], bevel: .005,
  }, 'lower-stretcher');

  timber('arched-crown-rail', {
    points: [[-.196, .976, .253], [-.108, .991, .244], [0, .995, .239], [.108, .991, .244], [.196, .976, .253]],
    segments: 24, width: t => .062 + Math.sin(t * Math.PI) * .005, depth: .031, across: [0, 1, 0], bevel: .006,
  }, 'back-crown');
  timber('lumbar-rail', {
    points: [[-.182, .594, .175], [0, .586, .159], [.182, .594, .175]],
    segments: 18, width: .038, depth: .025, across: [0, 1, 0], bevel: .0045,
  }, 'back-rail');
  for (const [index, x] of [-.105, 0, .105].entries()) {
    timber(`curved-back-slat-${index + 1}`, {
      points: [[x, .590, .167 + Math.abs(x) * .06], [x * .98, .70, .166], [x * .97, .82, .192], [x, .969, .242]],
      segments: 22, width: t => .066 - Math.sin(t * Math.PI) * .012, depth: .017, bevel: .004,
    }, 'back-slat');
  }

  // Visible joinery: small flush wooden dowels at the front apron ends.
  const apronSurface = new THREE.Mesh(frontApron, wood);
  for (const sign of [-1, 1]) {
    const plug = new THREE.CylinderGeometry(.0034, .0034, .0018, 12, 1);
    const hit = new THREE.Raycaster(vector(sign * .157, .437, -.5), vector(0, 0, 1)).intersectObject(apronSurface, false)[0];
    const plugNormal = hit.face.normal.clone().normalize(), center = hit.point.clone().addScaledVector(plugNormal, -.0006);
    plug.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(vector(0, 1, 0), plugNormal));
    plug.translate(center.x, center.y, center.z);
    const p = plug.attributes.position, uv = plug.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getY(i));
    plug.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(p.count * 3).fill(.96), 3));
    add(`front-dowel-${sign}`, 'joinery', plug, detail, { kind: 'joinery' });
  }
  const upholstery = cushionGeometry();
  add('upholstered-seat', 'seat-cushion', upholstery.shell, fabric, {
    kind: 'cushion', uvUnits: 'metres', topVertices: upholstery.topVertices,
    skirtStart: upholstery.skirtStart, skirtVertices: upholstery.skirtVertices, bottomStart: upholstery.bottomStart,
  });
  add('sewn-seat-welt', 'seat-piping', upholstery.seam, piping, { kind: 'seam', uvUnits: 'metres' });

  let triangles = 0, vertices = 0;
  for (const [material, entries] of buckets) {
    let vertexStart = 0, indexStart = 0;
    const meshIndex = group.children.length;
    for (const entry of entries) {
      const count = entry.geometry.attributes.position.count, indexCount = entry.geometry.index.count;
      parts[entry.name] = { part: entry.part, meshIndex, vertexStart, vertexCount: count, indexStart, indexCount, triangles: indexCount / 3, ...entry.extra };
      vertexStart += count; indexStart += indexCount;
    }
    const combined = mergeGeometries(entries.map(entry => entry.geometry), false);
    entries.forEach(entry => entry.geometry.dispose());
    const mesh = new THREE.Mesh(combined, material);
    mesh.name = `Chair: ${entries.map(entry => entry.part).filter((part, index, list) => list.indexOf(part) === index).join(', ')}`;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.chairPart = entries[0].part;
    mesh.userData.static = true; group.add(mesh);
    triangles += combined.index.count / 3; vertices += combined.attributes.position.count;
  }
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  const stats = { triangles, vertices, meshes: group.children.length, materials: buckets.size, parts, animated: false, uvUnits: 'metres', woodGrainAxis: 'u' };
  group.userData.chairStats = stats;
  return { group, stats, bounds };
}
