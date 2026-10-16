import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Static cloth construction for the room renderer. Geometry follows the large
// folds; the material supplies the sub-millimetre weave. Distances and UVs are
// both in metres, so the fabric never changes scale at a mattress shoulder.
const smooth = value => {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};
const point = (x, y, z) => new THREE.Vector3(x, y, z);
const gaussian = x => Math.exp(-x * x);
function axis(parts) {
  const values = [];
  for (const [a, b, count] of parts) for (let i = 0; i < count; i++) values.push(a + (b - a) * i / count);
  values.push(parts.at(-1)[1]);
  return values;
}
function surface(xs, zs, sample, uvAt = (x, z) => [x, z], reverse = false) {
  const positions = [], uvs = [], indices = [];
  for (const z of zs) for (const x of xs) {
    const p = sample(x, z), uv = uvAt(x, z);
    positions.push(p.x, p.y, p.z); uvs.push(...uv);
  }
  for (let row = 0; row < zs.length - 1; row++) for (let col = 0; col < xs.length - 1; col++) {
    const a = row * xs.length + col, b = a + 1, c = a + xs.length, d = c + 1;
    indices.push(...(reverse ? [a, b, c, b, d, c] : [a, c, b, b, c, d]));
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  result.setIndex(indices); result.computeVertexNormals();
  result.computeBoundingBox(); result.computeBoundingSphere();
  return result;
}
function hem(xs, zs, sample, radius = .0024, segments = 144) {
  const points = [], xmin = xs[0], xmax = xs.at(-1), zmin = zs[0], zmax = zs.at(-1);
  for (let i = 0; i < 36; i++) points.push(sample(xmin + (xmax - xmin) * i / 36, zmin));
  for (let i = 0; i < 36; i++) points.push(sample(xmax, zmin + (zmax - zmin) * i / 36));
  for (let i = 0; i < 36; i++) points.push(sample(xmax - (xmax - xmin) * i / 36, zmax));
  for (let i = 0; i < 36; i++) points.push(sample(xmin, zmax - (zmax - zmin) * i / 36));
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true, 'centripetal'), segments, radius, 4, true);
}
function copyMaterial(material) {
  const result = material.clone();
  result.onBeforeCompile = material.onBeforeCompile;
  result.customProgramCacheKey = material.customProgramCacheKey;
  return result;
}

export function createBedding(parent, materials, cx, cz) {
  const meshes = [];
  function add(geometries, material, part, name, owner = parent) {
    const geometry = Array.isArray(geometries) ? mergeGeometries(geometries, false) : geometries;
    if (Array.isArray(geometries)) geometries.forEach(g => g.dispose());
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.name = name; mesh.userData.bedPart = part;
    owner.add(mesh); meshes.push(mesh); return mesh;
  }

  function pillow(x, y, z, angle, usedSide) {
    const group = new THREE.Group();
    group.position.set(x, y, z); group.rotation.set(-.07, angle, usedSide * .018);
    group.name = 'Sewn cotton pillow'; group.userData.bedPart = 'pillow'; parent.add(group);
    const xs = axis([[-1, -.8, 5], [-.8, .8, 28], [.8, 1, 5]]);
    const zs = axis([[-1, -.75, 4], [-.75, .75, 18], [.75, 1, 4]]);
    // Two actual cloth panels meet at a pinched seam. Unlike a deformed sphere,
    // this keeps an oblong silhouette and flat, sewn corners instead of poles.
    const contour = (u, v) => [u * .376 * (1 - .048 * Math.abs(v) ** 10), v * .224 * (1 - .055 * Math.abs(u) ** 10)];
    function panel(u, v, top) {
      const [x, z] = contour(u, v);
      const cushion = Math.pow(Math.max(0, 1 - u * u), .52) * Math.pow(Math.max(0, 1 - v * v), .54);
      const edge = Math.min(1 - Math.abs(u), 1 - Math.abs(v));
      const tuck = smooth(edge / .075);
      let height = (top ? .092 : -.062) * cushion;
      if (top) {
        height -= .027 * gaussian((x + usedSide * .055) / .12) * gaussian((z - .018) / .105) * tuck;
        // Short gathers originate at the side seam; none cross the entire face.
        for (const [start, end, amount] of [[-.13, -.07, .004], [.032, .11, -.0038], [.15, .09, .0045]]) {
          const along = 1 - Math.abs(u), center = start + (end - start) * smooth(along / .48);
          height += amount * gaussian((z - center) / (.014 + along * .025)) * gaussian(along / .32) * tuck;
        }
        height += .0022 * Math.sin(x * 11 + z * 8 + usedSide) * cushion;
      }
      return point(x, height - .006, z);
    }
    const top = surface(xs, zs, (u, v) => panel(u, v, true), contour);
    const bottom = surface(xs, zs, (u, v) => panel(u, v, false), contour, true);
    // A narrow Oxford flange and its stitched outer edge make the construction
    // visible even in silhouette. The flange remains a single static mesh.
    const ring = [];
    for (let i = 0; i < 24; i++) ring.push([-1 + i / 12, -1]);
    for (let i = 0; i < 16; i++) ring.push([1, -1 + i / 8]);
    for (let i = 0; i < 24; i++) ring.push([1 - i / 12, 1]);
    for (let i = 0; i < 16; i++) ring.push([-1, 1 - i / 8]);
    ring.push(ring[0]);
    const flangeSample = (index, out) => {
      const [u, v] = ring[Math.round(index)], [x, z] = contour(u, v);
      const ripple = .0018 * Math.sin(index * .63 + usedSide) + .001 * Math.sin(index * 1.17);
      return point(x * (1 + out * .047), -.006 + ripple * out + .0015 * Math.sin(out * Math.PI), z * (1 + out * .067));
    };
    const flange = surface(axis([[0, 80, 80]]), [0, .5, 1], flangeSample, (index, out) => {
      const p = flangeSample(index, out); return [p.x, p.z];
    });
    const seamPoints = ring.slice(0, -1).map((_, i) => flangeSample(i, .86));
    const seam = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(seamPoints, true, 'centripetal'), 88, .0015, 4, true);
    const material = copyMaterial(materials.linen); material.side = THREE.DoubleSide;
    add([top, bottom, flange, seam], material, 'pillow', 'Cotton pillow: depressed panels, seam gathers and narrow sewn flange', group);
  }
  pillow(cx - .46, .697, cz - .82, -.055, -1);
  pillow(cx + .41, .701, cz - .86, .09, 1);

  // Central samples are about three centimetres apart. Extra rows describe the
  // circular mattress shoulder, where silhouette curvature actually needs them.
  const xs = axis([[-1.25, -1.02, 5], [-1.02, -.84, 10], [-.84, .84, 60], [.84, 1.02, 10], [1.02, 1.25, 5]]);
  const zs = axis([[-.82, .99, 60], [.99, 1.25, 14], [1.25, 1.47, 8]]);
  const pulls = [
    [-.84, -.56, -.23, -.13, .052, .024, .4],
    [.82, -.48, .20, -.02, .061, .029, 1.9],
    [-.84, .25, -.28, .72, .053, .021, .8],
    [.85, .42, .27, .80, .060, .026, 2.2],
    [-.49, 1.10, -.24, .65, .045, .020, .3],
    [.45, 1.11, .15, .64, .050, .017, 1.5],
  ].map(([ax, az, bx, bz, width, height, phase]) => {
    const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz);
    return { ax, az, dx: dx / length, dz: dz / length, length, width, height, phase };
  });
  function folds(x, z) {
    let height = .011 * gaussian((x - .15) / .52) * gaussian((z - .21) / .63);
    height -= .006 * gaussian((x + .21) / .35) * gaussian((z + .28) / .34);
    for (const f of pulls) {
      const dx = x - f.ax, dz = z - f.az, along = (dx * f.dx + dz * f.dz) / f.length;
      if (along < -.12 || along > 1.1) continue;
      const taper = smooth((along + .12) / .26) * smooth((1.1 - along) / .34);
      const across = -dx * f.dz + dz * f.dx - Math.sin(along * 2.8 + f.phase) * .023;
      const width = f.width * (1.15 - smooth(along) * .32);
      // A narrow crest, adjacent compressed trough and tapered tip describe a
      // pull in fabric, rather than a repeated sinusoidal landscape.
      height += (gaussian(across / width) - .33 * gaussian((across + width * 1.2) / (width * .68))) * f.height * taper;
    }
    return height;
  }
  function sample(u, v) {
    const corner = .20, start = 1.47 - corner, end = Math.max(0, v - start);
    const rowWidth = v > start ? 1.25 - corner + Math.sqrt(Math.max(0, corner * corner - end * end)) : 1.25;
    let x = u / 1.25 * rowWidth;
    x += Math.sign(x) * Math.sin(v * 8.1 + .7) * .009 * smooth((Math.abs(x) - .78) / .43);
    const z = v + Math.sin(u * 7.2 + .8) * .011 * smooth((v - 1.04) / .4);
    const side = Math.max(0, Math.abs(x) - .84), foot = Math.max(0, z - 1.05);
    const distance = Math.hypot(side, foot), radius = .11;
    const nx = distance ? Math.sign(x) * side / distance : 0, nz = distance ? foot / distance : 0;
    const theta = Math.min(Math.PI / 2, distance / radius), hanging = Math.max(0, distance - Math.PI / 2 * radius);
    const hang = smooth(hanging / .15);
    const sidePleat = Math.sin(v * 14.8 + Math.sin(v * 4.2) + (x < 0 ? .5 : 2.1)) * .009 + Math.sin(v * 25 + .4) * .0025;
    const footPleat = Math.sin(x * 16.2 + .5) * .010 + Math.sin(x * 27.6 + 2.2) * .003;
    const y = .645 - radius * (1 - Math.cos(theta)) - hanging + folds(x, z) * (1 - smooth(distance / .24) * .82)
      + Math.sin(v * 7 + x * 4.3) * .005 * hang;
    const anchorX = THREE.MathUtils.clamp(x, -.84, .84), anchorZ = Math.min(z, 1.05);
    let outward = radius * Math.sin(theta) + (sidePleat * Math.abs(nx) + footPleat * nz) * (.2 + hang * .8) + hang * .016;
    // The lower fabric rests outside the timber rail, including both foot
    // corners. This is solved once, without a cloth simulation in the frame.
    const clearance = smooth((.54 - y) / .135);
    if (distance > 0 && clearance > 0) {
      const railDistance = r => {
        const qx = Math.abs(anchorX + nx * r) - .931, qz = Math.abs(anchorZ + nz * r) - 1.175;
        return Math.hypot(Math.max(0, qx), Math.max(0, qz)) + Math.min(Math.max(qx, qz), 0) - .042;
      };
      if (railDistance(outward) < 0) {
        let lo = outward, hi = .36;
        for (let i = 0; i < 9; i++) {
          const mid = (lo + hi) * .5;
          if (railDistance(mid) < 0) lo = mid; else hi = mid;
        }
        outward += (hi - outward) * clearance;
      }
    }
    return point(cx + anchorX + nx * outward, y, cz + anchorZ + nz * outward);
  }
  const linen = copyMaterial(materials.linen);
  linen.side = THREE.DoubleSide; linen.color.multiplyScalar(.98);
  linen.normalScale?.set(.11, .11); linen.roughness = .94;
  add([surface(xs, zs, sample), hem(xs, zs, sample)], linen, 'duvet', 'Cotton duvet: tension creases, round shoulder and gravity drape');

  const foldXs = axis([[-.97, -.81, 6], [-.81, .81, 46], [.81, .97, 6]]);
  const foldZs = axis([[0, .84, 10], [.84, 1, 8], [1, 1.10, 2]]);
  function foldSample(x, t) {
    const edgeZ = -.465 + x * .021 + Math.sin(x * 4.7 + .3) * .014 + gaussian((x + .35) / .19) * .007;
    // A duvet folds back onto its own support. Compress the rounded return,
    // especially at its loose ends, instead of suspending a cylindrical lip.
    const endCompression = 1 - smooth((Math.abs(x) - .75) / .22) * .42;
    const radius = (.0084 + .0010 * Math.sin(x * 3.1 + .3)) * endCompression;
    const contact = .003 + gaussian((x - .14) / .39) * .001;
    const crest = contact + 2 * radius;
    let z, offset;
    if (t < .84) {
      const f = t / .84;
      z = edgeZ - .32 * (1 - f);
      offset = contact + .003 + (crest - contact - .003) * smooth(f)
        + .0013 * Math.sin(x * 8.2 + f * 2.1) * Math.sin(f * Math.PI);
    } else if (t <= 1) {
      const a = (t - .84) / .16 * Math.PI;
      z = edgeZ + Math.sin(a) * radius; offset = contact + radius * (1 + Math.cos(a));
    } else {
      z = edgeZ - (t - 1) * .55; offset = contact;
    }
    const p = sample(x, z); p.y += offset;
    return p;
  }
  const folded = copyMaterial(linen); folded.color.multiplyScalar(1.025);
  add([surface(foldXs, foldZs, foldSample, (x, t) => [x, -.785 + t * .40]), hem(foldXs, foldZs, foldSample, .0018, 112)],
    folded, 'duvet-fold', 'Turned duvet with real rounded return, layered thickness and stitched edge');

  const throwXs = axis([[-1.22, -1.02, 4], [-1.02, -.84, 8], [-.84, .84, 46], [.84, 1.02, 8], [1.02, 1.22, 4]]);
  const throwZs = axis([[.76, .99, 10], [.99, 1.26, 13], [1.26, 1.41, 7]]);
  function throwSample(x, z) {
    const p = sample(x, z), side = smooth((Math.abs(x) - .8) / .34), foot = smooth((z - 1.04) / .3);
    const top = 1 - Math.max(side, foot) * .88;
    const lip = gaussian((z - .805 + x * .025 + Math.sin(x * 3) * .009) / .032) * .011;
    const gathered = gaussian((x - .44 + (z - .9) * .65) / .070) * gaussian((z - .98) / .30) * .014;
    p.y += .014 + (lip + gathered) * top;
    p.x += Math.sign(x) * side * .013; p.z += foot * .013;
    return p;
  }
  const wool = copyMaterial(materials.blanket);
  wool.color.multiplyScalar(.94); wool.side = THREE.DoubleSide;
  wool.roughness = .96; wool.normalScale?.set(.16, .16);
  const throwGeometry = [surface(throwXs, throwZs, throwSample), hem(throwXs, throwZs, throwSample, .0022, 128)];
  // All yarn ends are merged with the throw: no extra draw for the fringe.
  for (let i = 0; i < 35; i++) {
    const x = -1.205 + i * 2.41 / 34, start = throwSample(x, 1.41), end = throwSample(x, 1.447);
    end.y -= .005 + (1 + Math.sin(i * 2.1)) * .002; end.x += Math.sin(i * 2.7) * .002;
    const middle = start.clone().lerp(end, .55); middle.z += .002;
    throwGeometry.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([start, middle, end]), 3, .0014, 3, false));
  }
  add(throwGeometry, wool, 'throw', 'Woven foot blanket: supported folds, sewn hem and individual short yarn ends');

  const parts = {};
  for (const mesh of meshes) parts[mesh.userData.bedPart] = (parts[mesh.userData.bedPart] || 0) + mesh.geometry.index.count / 3;
  const metrics = { meshes: meshes.length, triangles: Object.values(parts).reduce((a, b) => a + b, 0), parts, uvUnits: 'metres', animated: false };
  return { metrics, sample, foldSample, throwSample, meshes };
}
