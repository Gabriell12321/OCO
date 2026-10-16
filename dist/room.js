import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createBedding } from './bedroom/bed.js';
import { createChair } from './bedroom/chair.js';

// A quiet, occupied bedroom. All measurements are in metres.
export function createRoom(scene, materials) {
  const colliders = [];
  const room = new THREE.Group();
  room.name = 'The bedroom';
  scene.add(room);
  const mat = (name, fallback, roughness = .8) => materials[name] || new THREE.MeshStandardMaterial({ color: fallback, roughness });
  const M = {
    wall: mat('wall', '#a39c88'), ceiling: mat('ceiling', '#c1bda9'),
    trim: mat('trim', '#b1aa92'), floor: mat('floor', '#6a4831'),
    wood: mat('wood', '#573a26'), dark: mat('woodDark', '#28231b'),
    linen: mat('linen', '#c5bba3'), blanket: mat('blanket', '#726c58'),
    rug: mat('rug', '#554634'), curtain: mat('curtain', '#bcb6a2'),
    metal: mat('metal', '#383c38', .35), brass: mat('brass', '#8d7450', .4),
    paper: mat('paper', '#b9ac90'), glass: mat('glass', '#b2c9c1', .1)
  };
  const plainMaterials = new Map();
  const plain = (color, roughness = .8, extra = {}) => {
    const key = JSON.stringify([color, roughness, extra]);
    if (!plainMaterials.has(key)) plainMaterials.set(key, new THREE.MeshStandardMaterial({ color, roughness, ...extra }));
    return plainMaterials.get(key);
  };
  const cloneSurface = material => {
    const copy=material.clone();
    copy.onBeforeCompile=material.onBeforeCompile;
    copy.customProgramCacheKey=material.customProgramCacheKey;
    return copy;
  };
  const shadowMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: .22, map: contactTexture(), color: '#000000' });
  const softWood = M.wood.clone(); softWood.color.multiplyScalar(1.04);
  const darkEdge = M.dark.clone(); darkEdge.color.multiplyScalar(.73);
  const enamel = plain('#a29e8c', .45);
  const cottonStitch = plain('#a9a28d');
  const insideBlack = plain('#141613');

  // The same paint and timber texture keeps its real-world scale on every
  // length of wall and on every furniture part, including thin mouldings.
  function surfaceUV(geometry, material, x, y, z) {
    const architectural = material === M.wall || material === M.ceiling || material === M.trim || (material.map && material.map === M.trim.map);
    const timber = material.map && material.map === M.wood.map;
    if (!architectural && !timber) return;
    const p = geometry.attributes.position, n = geometry.attributes.normal, uv = geometry.attributes.uv;
    geometry.computeBoundingBox(); const size = new THREE.Vector3(); geometry.boundingBox.getSize(size);
    for (let i = 0; i < p.count; i++) {
      const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i));
      let u, v;
      if (nx > ny && nx > nz) {
        u = p.getZ(i); v = p.getY(i);
        if (timber && size.y > size.z) [u, v] = [v, u];
        if (architectural) { u += z; v += y; }
      } else if (ny > nz) {
        u = p.getX(i); v = p.getZ(i);
        if (timber && size.z > size.x) [u, v] = [v, u];
        if (architectural) { u += x; v += z; }
      } else {
        u = p.getX(i); v = p.getY(i);
        if (timber && size.y > size.x) [u, v] = [v, u];
        if (architectural) { u += x; v += y; }
      }
      uv.setXY(i, u / (architectural ? 2 : 1.15), v / (architectural ? 2 : .62));
    }
  }

  function mesh(geometry, material, x, y, z, parent = room) {
    const item = new THREE.Mesh(geometry, material);
    item.position.set(x, y, z);
    item.castShadow = true; item.receiveShadow = true;
    parent.add(item); return item;
  }
  function box(w, h, d, x, y, z, material, radius = 0, parent = room) {
    const geometry = radius > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d);
    surfaceUV(geometry, material, x, y, z);
    return mesh(geometry, material, x, y, z, parent);
  }
  function cylinder(top, bottom, height, x, y, z, material, segments = 24, parent = room) {
    return mesh(new THREE.CylinderGeometry(top, bottom, height, segments), material, x, y, z, parent);
  }
  function rod(a, b, r, material, parent = room) {
    const delta = new THREE.Vector3().subVectors(b, a);
    const result = mesh(new THREE.CylinderGeometry(r, r, delta.length(), 10), material, 0, 0, 0, parent);
    result.position.copy(a).add(b).multiplyScalar(.5);
    result.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    return result;
  }
  function point(x, y, z) { return new THREE.Vector3(x, y, z); }
  function contact(x, z, w, d, opacity = .22, y = .012) {
    const material = shadowMaterial.clone(); material.opacity = opacity;
    const result = mesh(new THREE.PlaneGeometry(w, d), material, x, y, z);
    result.rotation.x = -Math.PI / 2; result.castShadow = false;
    result.userData.excludeFromPathTrace = true;
    return result;
  }
  function block(x, z, w, d, margin = .08) {
    colliders.push({ minX: x - w / 2 - margin, maxX: x + w / 2 + margin, minZ: z - d / 2 - margin, maxZ: z + d / 2 + margin });
  }

  // Shell: the opening is geometry rather than a black rectangle over a wall.
  const floor = mesh(new THREE.PlaneGeometry(6, 6.4), M.floor, 0, .001, 0);
  floor.rotation.x = -Math.PI / 2;
  box(6.16, .14, 6.56, 0, -.077, 0, M.dark);
  box(6.18, .14, 6.55, 0, 3.07, 0, M.ceiling);
  box(.15, 3, 6.4, -3.075, 1.5, 0, M.wall);
  box(.15, 3, 6.4, 3.075, 1.5, 0, M.wall);
  box(6, 3, .15, 0, 1.5, 3.275, M.wall);
  const windowX = .4, windowWidth = 1.65, windowBottom = 1, windowTop = 2.55;
  const windowLeft = windowX - windowWidth / 2, windowRight = windowX + windowWidth / 2;
  box(windowLeft + 3, 3, .15, (-3 + windowLeft) / 2, 1.5, -3.275, M.wall);
  box(3 - windowRight, 3, .15, (3 + windowRight) / 2, 1.5, -3.275, M.wall);
  box(windowWidth, 1, .15, windowX, .5, -3.275, M.wall);
  box(windowWidth, .45, .15, windowX, 2.775, -3.275, M.wall);

  // Painted timber skirting, picture rail and fine crown moulding.
  const paneled = M.trim.clone(); paneled.color.multiplyScalar(.88);
  box(6, .11, .035, 0, .055, -3.18, M.trim, .008);
  box(6, .11, .035, 0, .055, 3.18, M.trim, .008);
  for (const side of [-1, 1]) {
    box(.035, .11, 6.4, side * 2.98, .055, 0, M.trim, .008);
    box(.032, .52, 6.4, side * 2.982, .38, 0, paneled);
    box(.052, .035, 6.4, side * 2.967, .675, 0, M.trim, .006);
    box(.035, .026, 6.4, side * 2.977, .635, 0, M.trim, .004);
    box(.076, .085, 6.4, side * 2.956, 2.925, 0, M.trim, .012);
    box(.105, .025, 6.4, side * 2.94, 2.977, 0, M.trim, .006);
    box(.038, .024, 6.4, side * 2.974, 2.865, 0, M.trim, .005);
    for (let z = -2.75; z < 3.1; z += .74) box(.039, .45, .024, side * 2.96, .38, z, M.trim, .004);
  }
  for (const z of [-3.18, 3.18]) {
    box(6, .52, .033, 0, .38, z, paneled);
    box(6, .035, .052, 0, .675, z + (z > 0 ? -.017 : .017), M.trim, .006);
    box(6, .026, .035, 0, .635, z + (z > 0 ? -.014 : .014), M.trim, .004);
    box(6, .085, .076, 0, 2.925, z + (z > 0 ? -.025 : .025), M.trim, .012);
    box(6, .025, .105, 0, 2.977, z + (z > 0 ? -.04 : .04), M.trim, .006);
    box(6, .024, .038, 0, 2.865, z, M.trim, .005);
    for (let x = -2.65; x < 3; x += .74) box(.024, .45, .039, x, .38, z + (z > 0 ? -.024 : .024), M.trim, .004);
  }
  // Small irregular losses in the old paint reveal timber at the skirting.
  // These are solid surface details, so they remain visible in the GI renderer.
  const paintLoss = plain('#776b51', .98, { side: THREE.DoubleSide });
  let paintSeed = 98412;
  const paintRandom = () => { paintSeed = (paintSeed * 1664525 + 1013904223) >>> 0; return paintSeed / 4294967296; };
  for (let i = 0; i < 38; i++) {
    const width = .003 + paintRandom() * .013, height = .0015 + paintRandom() * .005;
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2, -height * .3);
    shape.lineTo(-width * .35, height * .4);
    shape.lineTo(width * .13, height * .3);
    shape.lineTo(width * .4, height * .65);
    shape.lineTo(width / 2, -height * .2);
    shape.lineTo(0, -height * .5); shape.closePath();
    const along = -2.75 + paintRandom() * 5.5, y = .012 + paintRandom() * .085;
    const side = i % 4;
    const chip = mesh(new THREE.ShapeGeometry(shape), paintLoss, side < 2 ? along : (side === 2 ? -2.959 : 2.959), y, side < 2 ? (side === 0 ? -3.159 : 3.159) : along);
    chip.rotation.y = [0, Math.PI, Math.PI / 2, -Math.PI / 2][side];
    chip.castShadow = false; chip.name = 'Fine chipped paint on skirting';
  }

  // Window, deep reveals, old sash frame and a few realistic bevelled edges.
  const windowPaint = cloneSurface(M.trim); windowPaint.color.set('#b9b5a4'); windowPaint.roughness = .64;
  const frameShade = plain('#858879', .7);
  box(1.85, .055, .27, .4, .985, -3.145, windowPaint, .012);
  box(1.8, .055, .115, .4, .922, -3.15, windowPaint, .008);
  for (const x of [windowLeft - .045, windowRight + .045]) {
    box(.09, 1.75, .09, x, 1.775, -3.17, windowPaint, .008);
    box(.025, 1.64, .11, x + (x < .4 ? .06 : -.06), 1.775, -3.19, frameShade, .003);
  }
  box(1.85, .09, .09, .4, 2.59, -3.17, windowPaint, .008);
  box(1.6, .046, .055, .4, 1.78, -3.173, windowPaint, .005);
  box(.045, 1.49, .055, .4, 1.775, -3.173, windowPaint, .005);
  box(1.6, .035, .055, .4, 1.033, -3.173, windowPaint, .004);
  box(1.6, .035, .055, .4, 2.517, -3.173, windowPaint, .004);
  // Broad, restrained glass reflection; the room's approximate fill emitters
  // must not appear as several glowing white bulbs in the wet window.
  const glassMaterial = new THREE.MeshPhysicalMaterial({ color: '#9bafa9', roughness: .22, metalness: 0,
    specularIntensity: .22, transparent: true, opacity: .13, transmission: 0, side: THREE.FrontSide, depthWrite: false });
  const glass = mesh(new THREE.PlaneGeometry(1.54, 1.45), glassMaterial, .4, 1.775, -3.23); glass.castShadow = false;
  glass.name = 'Window glass'; glass.renderOrder = 2;
  box(.064, .022, .028, .4, 1.801, -3.128, M.brass, .006);
  cylinder(.009, .009, .025, .4, 1.814, -3.11, M.brass, 12).rotation.x = Math.PI / 2;
  // The exterior is the renderer's photographic night environment, seen only
  // through this physical opening rather than through an opaque backdrop.

  // Pleated curtains hang with varying depth and softly sagged hems.
  const curtainMaterial = cloneSurface(M.curtain); curtainMaterial.side = THREE.DoubleSide;
  for (const [cx, cw, phase] of [[-.67, .46, .4], [1.48, .47, 2.3]]) {
    const geo = new THREE.PlaneGeometry(cw, 2.2, 36, 58);
    const positions = geo.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i);
      const down = (1.1 - y) / 2.2;
      const pleat = Math.sin((x / cw + .5) * Math.PI * 11 + phase);
      positions.setXYZ(i, x * (.82 + down * .18) + Math.sin(down * 2.7 + phase) * .014,
        y + Math.sin((x / cw + .5) * 14) * .009 * down,
        pleat * (.026 + down * .025) + Math.sin(down * 3 + x * 5) * .013);
    }
    geo.computeVertexNormals(); mesh(geo, curtainMaterial, cx, 1.55, -3.03);
    for (let i = 0; i < 6; i++) {
      const ring = mesh(new THREE.TorusGeometry(.022, .0045, 5, 14), M.brass, cx - cw * .37 + i * cw * .15, 2.69, -3.03);
      ring.rotation.y = Math.PI / 2;
    }
    rod(point(cx - cw / 2, .456, -3.01), point(cx + cw / 2, .456, -3.01), .003, cottonStitch);
  }
  rod(point(-1, 2.705, -3.03), point(1.8, 2.705, -3.03), .014, M.dark);
  for (const x of [-1.03, 1.83]) mesh(new THREE.SphereGeometry(.036, 16, 12), M.dark, x, 2.705, -3.03);

  // Old panel radiator, valves and pipework below the window.
  box(1.28, .53, .075, .51, .37, -3.047, enamel, .018);
  for (let i = 0; i < 18; i++) box(.041, .48, .1, -.075 + i * .069, .37, -2.993, enamel, .014);
  box(1.3, .035, .13, .51, .65, -3.013, enamel, .008);
  for (const x of [-.17, 1.19]) {
    rod(point(x, .075, -3.06), point(x, .19, -3.06), .016, M.metal);
    rod(point(x, .19, -3.06), point(x + (x < 0 ? .065 : -.065), .19, -3.06), .016, M.metal);
    cylinder(.026, .026, .045, x, .255, -3.06, windowPaint, 16);
  }

  // Bed: a real layered silhouette, exposed frame and deliberately imperfect linens.
  const bedX = -.97, bedZ = -1.58, bedHead = bedZ - 1.243;
  const bedStart = room.children.length;
  block(bedX, bedZ, 1.96, 2.43, .07);
  contact(bedX, bedZ, 2.5, 2.95, .3);
  for (const x of [bedX - .79, bedX + .79]) for (const z of [bedZ - .93, bedZ + .93]) {
    const foot = box(.095, .22, .095, x, .12, z, darkEdge, .014);
    foot.rotation.y = .08 * Math.sign(x - bedX);
  }
  box(1.91, .21, 2.4, bedX, .285, bedZ, M.wood, .028);
  box(1.79, .13, 2.28, bedX, .42, bedZ, M.dark, .035);
  const mattress = box(1.86, .22, 2.31, bedX, .505, bedZ, M.linen, .075);
  mattress.name = 'Mattress with fitted cotton sheet'; mattress.userData.bedPart = 'mattress';
  const mattressPosition = mattress.geometry.attributes.position, mattressNormal = mattress.geometry.attributes.normal;
  const mattressUV = mattress.geometry.attributes.uv;
  for (let i = 0; i < mattressPosition.count; i++) {
    const nx = Math.abs(mattressNormal.getX(i)), ny = Math.abs(mattressNormal.getY(i)), nz = Math.abs(mattressNormal.getZ(i));
    const x = mattressPosition.getX(i), y = mattressPosition.getY(i), z = mattressPosition.getZ(i);
    mattressUV.setXY(i, nx > ny && nx > nz ? z : x, ny > nx && ny > nz ? z : y);
  }
  // Piping catches small highlights around the mattress.
  roundedOutline(1.866, 2.316, .07, bedX, .565, bedZ, .004, cottonStitch);
  roundedOutline(1.868, 2.316, .07, bedX, .452, bedZ, .004, cottonStitch);
  // Low walnut headboard with leather-like padded insert and frame moulding.
  box(2.02, .93, .11, bedX, .625, bedHead, M.wood, .035);
  box(1.81, .53, .045, bedX, .735, bedHead + .069, M.dark, .035);
  const paddedLeather = new THREE.MeshPhysicalMaterial({ color: '#474035', roughness: .88, normalMap: M.linen.normalMap, normalScale: new THREE.Vector2(.045, .045), sheen: .22, sheenColor: '#b5a28b', sheenRoughness: .82 });
  box(1.76, .48, .03, bedX, .735, bedHead + .1, paddedLeather, .04);
  box(2.08, .075, .14, bedX, 1.11, bedHead - .001, softWood, .014);
  for (const x of [bedX - .97, bedX + .97]) box(.07, .97, .13, x, .625, bedHead + .013, softWood, .012);
  for (const x of [bedX - .59, bedX, bedX + .59]) {
    const button = mesh(new THREE.SphereGeometry(.016, 12, 8), M.dark, x, .78, bedHead + .124); button.scale.z = .3;
  }
  const bedding = createBedding(room, M, bedX, bedZ);
  const bedMetrics = { ...bedding.metrics, textileTriangles: bedding.metrics.triangles, triangles: 0, meshes: 0 };
  for (const child of room.children.slice(bedStart)) child.traverse(object => {
    if (!object.isMesh) return;
    object.userData.bedPart ||= 'frame';
    object.name ||= 'Walnut bed frame and sewn mattress piping';
    bedMetrics.triangles += (object.geometry.index?.count || object.geometry.attributes.position.count) / 3;
    bedMetrics.meshes++;
  });

  // Bedside cabinet, three inset drawers, handles, a lamp, a book and drinking glass.
  const bedsideX = .4, bedsideZ = -2.58;
  block(bedsideX, bedsideZ, .62, .57);
  contact(bedsideX, bedsideZ, .88, .8, .25);
  box(.58, .57, .52, bedsideX, .355, bedsideZ, M.wood, .016);
  box(.65, .055, .6, bedsideX, .66, bedsideZ, softWood, .014);
  box(.61, .045, .55, bedsideX, .077, bedsideZ, M.dark, .008);
  for (const x of [bedsideX - .23, bedsideX + .23]) for (const z of [bedsideZ - .2, bedsideZ + .2]) box(.045, .12, .045, x, .07, z, M.wood, .006);
  for (let i = 0; i < 3; i++) {
    const y = .17 + i * .16;
    box(.51, .142, .035, bedsideX, y, bedsideZ + .274, M.wood, .008);
    box(.45, .098, .013, bedsideX, y, bedsideZ + .295, softWood, .005);
    cylinder(.018, .018, .03, bedsideX, y, bedsideZ + .317, M.brass, 16).rotation.x = Math.PI / 2;
  }
  const lampZ = bedsideZ - .015;
  cylinder(.095, .105, .018, bedsideX, .701, lampZ, M.brass, 48);
  cylinder(.052, .065, .04, bedsideX, .729, lampZ, darkEdge, 40);
  const lampStem = cylinder(.015, .025, .22, bedsideX, .85, lampZ, M.brass, 24);
  const bulbSocket = cylinder(.035, .035, .04, bedsideX, .977, lampZ, M.brass, 24);
  lampStem.castShadow = bulbSocket.castShadow = false;
  const shade = new THREE.MeshPhysicalMaterial({
    color: '#d9ccb0', map: M.linen.map, normalMap: M.linen.normalMap,
    normalScale: new THREE.Vector2(.065, .065), roughness: .93,
    transmission: .58, thickness: .0025, ior: 1.3,
    attenuationColor: '#f5deb0', attenuationDistance: .12,
    side: THREE.DoubleSide, sheen: .35, sheenRoughness: .95,
    emissive: '#d19b61', emissiveIntensity: .055,
  });
  shade.userData.lampEmission = lampEmissionTexture(M.linen.map?.image);
  const shadeGeo = new THREE.CylinderGeometry(.15, .225, .29, 144, 12, true);
  const shadeP = shadeGeo.attributes.position;
  for (let i = 0; i < shadeP.count; i++) {
    const x = shadeP.getX(i), z = shadeP.getZ(i), angle = Math.atan2(z, x);
    const pleat = 1 + Math.cos(angle * 48) * .012;
    shadeP.setXYZ(i, x * pleat, shadeP.getY(i), z * pleat);
  }
  shadeGeo.computeVertexNormals();
  const lampShade = mesh(shadeGeo, shade, bedsideX, 1.125, lampZ); lampShade.castShadow = false;
  lampShade.name = 'Fine pleated translucent linen lampshade';
  for (const [radius, y] of [[.151, 1.27], [.226, .98]]) {
    const ring = mesh(new THREE.TorusGeometry(radius, .004, 8, 80), plain('#9e8968'), bedsideX, y, lampZ);
    ring.rotation.x = Math.PI / 2;
    // A point emitter cannot represent the diffuse light of a real shade.
    // Its fine wire rims otherwise project implausible black rings overhead.
    ring.castShadow = false;
  }
  const filament = mesh(new THREE.SphereGeometry(.026, 24, 16), plain('#ffdc9b', .3, { emissive: '#ffbd63', emissiveIntensity: 2 }), bedsideX, 1.07, lampZ);
  filament.castShadow = false;
  rod(point(bedsideX, .71, bedsideZ - .1), point(bedsideX + .03, .69, bedsideZ - .26), .003, insideBlack);
  rod(point(bedsideX + .03, .69, bedsideZ - .26), point(bedsideX + .07, .02, bedsideZ - .27), .003, insideBlack);
  const bookGroup = book(.17, .025, .24, '#343d33');
  bookGroup.position.set(bedsideX + .14, .707, bedsideZ + .13); bookGroup.rotation.y = -.15;
  const glassMat = new THREE.MeshPhysicalMaterial({ color: '#c8ddd4', transparent: true, opacity: .22, roughness: .08, metalness: .02, side: THREE.DoubleSide, depthWrite: false });
  const tumbler = mesh(new THREE.CylinderGeometry(.038, .032, .105, 32, 1, true), glassMat, bedsideX - .22, .741, bedsideZ + .14);
  const rim = mesh(new THREE.TorusGeometry(.038, .0018, 6, 32), glassMat, bedsideX - .22, .793, bedsideZ + .14); rim.rotation.x = Math.PI / 2;
  const water = mesh(new THREE.CircleGeometry(.034, 32), new THREE.MeshPhysicalMaterial({ color: '#b4c9bd', transparent: true, opacity: .32, roughness: .03 }), bedsideX - .22, .742, bedsideZ + .14); water.rotation.x = -Math.PI / 2;

  // A restrained, worn Persian-inspired rug, with border and a little unevenness.
  const rugTexture = patternedRug(M.rug.map?.image);
  const rugMaterial = new THREE.MeshStandardMaterial({ map: rugTexture, roughness: 1, normalMap: M.rug.normalMap, normalScale: new THREE.Vector2(.3,.3), roughnessMap: M.rug.roughnessMap, bumpMap: rugTexture, bumpScale: .001 });
  const rugGeo = new THREE.PlaneGeometry(2.45, 2.03, 45, 40);
  const rugP = rugGeo.attributes.position;
  for (let i = 0; i < rugP.count; i++) {
    const x = rugP.getX(i), y = rugP.getY(i);
    rugP.setZ(i, Math.sin(x * 11 + y * 9) * .0009 + Math.max(0, (Math.abs(x) - 1.13) / .1) * .004 * Math.sin(y * 12));
  }
  rugGeo.computeVertexNormals();
  const rug = mesh(rugGeo, rugMaterial, -.64, .016, .56); rug.rotation.x = -Math.PI / 2; rug.rotation.z = -.025;
  for (const z of [-.48, 1.61]) for (let i = 0; i < 76; i++) {
    const x = -1.84 + i * .032;
    rod(point(x, .014, z), point(x + Math.sin(i * 4) * .005, .014, z + (z < 0 ? -.045 : .045)), .0018, plain('#8e7e63'));
  }

  // Tall walnut wardrobe along the left wall. Panelled doors and individual hinges.
  const wardrobe = new THREE.Group(); wardrobe.position.set(-2.66, 0, .7); wardrobe.rotation.y = Math.PI / 2; room.add(wardrobe);
  block(-2.66, .7, .64, 1.45, .09); contact(-2.64, .7, 1, 1.72, .32);
  box(1.43, 1.96, .57, 0, 1.1, 0, M.wood, .018, wardrobe);
  box(1.53, .085, .65, 0, 2.13, 0, softWood, .018, wardrobe);
  box(1.48, .04, .61, 0, 2.064, .01, softWood, .008, wardrobe);
  box(1.48, .105, .61, 0, .13, .01, M.wood, .013, wardrobe);
  for (const x of [-.57, .57]) for (const z of [-.2, .2]) box(.11, .18, .11, x, .095, z, M.wood, .017, wardrobe);
  for (const x of [-.351, .351]) {
    box(.683, 1.805, .045, x, 1.103, .309, M.wood, .009, wardrobe);
    for (const [y, h] of [[.61, .7], [1.5, .8]]) {
      box(.527, h, .012, x, y, .336, darkEdge, .008, wardrobe);
      box(.49, h - .04, .026, x, y, .349, softWood, .01, wardrobe);
      for (const dx of [-.27, .27]) box(.025, h + .025, .028, x + dx, y, .351, M.wood, .006, wardrobe);
      for (const dy of [-h / 2, h / 2]) box(.55, .025, .028, x, y + dy, .351, M.wood, .006, wardrobe);
    }
    const hx = x + (x < 0 ? .252 : -.252);
    rod(point(hx, 1.025, .378), point(hx, 1.155, .378), .009, M.brass, wardrobe);
    for (const y of [1.025, 1.155]) rod(point(hx, y, .341), point(hx, y, .378), .011, M.brass, wardrobe);
    for (const y of [.44, 1.1, 1.77]) box(.025, .075, .029, x + (x < 0 ? -.33 : .33), y, .34, M.brass, .006, wardrobe);
  }

  // Writing desk: slender legs, drawer, chair, a few purposeful personal objects.
  const desk = new THREE.Group(); desk.position.set(2.47, 0, -.65); desk.rotation.y = -Math.PI / 2; room.add(desk);
  block(2.47, -.65, .9, 1.48, .06); contact(2.48, -.65, 1.14, 1.7, .2);
  box(1.44, .055, .77, 0, .775, 0, M.wood, .014, desk);
  box(1.32, .12, .06, 0, .686, .32, M.wood, .006, desk);
  box(.065, .12, .65, -.62, .686, 0, M.wood, .006, desk);
  box(.065, .12, .65, .62, .686, 0, M.wood, .006, desk);
  for (const x of [-.625, .625]) for (const z of [-.29, .29]) {
    const leg = box(.055, .7, .055, x, .36, z, M.wood, .009, desk); leg.rotation.z = x * -.026;
  }
  box(.65, .12, .035, 0, .687, .36, softWood, .008, desk);
  for (const x of [-.08, .08]) rod(point(x, .687, .38), point(x, .687, .408), .007, M.brass, desk);
  rod(point(-.08, .687, .408), point(.08, .687, .408), .007, M.brass, desk);
  const deskLeather = cloneSurface(M.blanket);
  deskLeather.name = 'Worn olive leather writing pad'; deskLeather.color.set('#41443a');
  deskLeather.normalScale.set(.055, .055); deskLeather.roughness = .86;
  const deskPad = box(.61, .008, .41, .02, .809, .015, deskLeather, .02, desk);
  const loosePaper = box(.185, .0015, .26, -.04, .815, .015, stationery(), 0, desk); loosePaper.rotation.y = .09;
  const pen = rod(point(.04, .819, -.05), point(.13, .819, .07), .003, M.dark, desk);
  for (let i = 0; i < 3; i++) {
    const item = book(.2 + i * .012, .031 + i * .005, .28, ['#454a40', '#5d3b2d', '#736349'][i]);
    item.position.set(-.47, .828 + i * .036, -.17); item.rotation.y = .06 - i * .07; desk.add(item);
  }
  // Small ceramic cup with a visible inside and ring at its lip.
  const cupMat = plain('#9b9b83', .33);
  cylinder(.042, .033, .083, .48, .851, .13, cupMat, 32, desk);
  cylinder(.036, .031, .006, .48, .895, .13, plain('#382a1d', .25), 32, desk);
  const mugHandle = mesh(new THREE.TorusGeometry(.027, .008, 10, 22), cupMat, .535, .852, .13, desk); mugHandle.rotation.y = Math.PI / 2;
  // Shaped joinery and a sewn cushion replace the old box-and-stick chair.
  // Its materials share existing photographs and remain local to this prop.
  const chairWood = cloneSurface(M.wood);
  chairWood.name = 'Hand-worn walnut chair'; chairWood.color.set('#d7c3a2');
  chairWood.roughness = .82; chairWood.normalScale.set(.075, .075);
  chairWood.envMapIntensity = .42; chairWood.vertexColors = true;
  const chairFabric = cloneSurface(M.blanket);
  chairFabric.name = 'Faded sage upholstery'; chairFabric.color.set('#9b9b83');
  chairFabric.normalScale.set(.22, .22); chairFabric.roughness = .98;
  chairFabric.side = THREE.FrontSide; chairFabric.vertexColors = true;
  if (chairFabric.isMeshPhysicalMaterial) {
    chairFabric.sheen = .22; chairFabric.sheenColor.set('#b8b59b'); chairFabric.sheenRoughness = .94;
  }
  const chairPiping = cloneSurface(chairFabric);
  chairPiping.name = 'Upholstery seam binding'; chairPiping.color.set('#777b62');
  const chairDetail = cloneSurface(chairWood);
  chairDetail.name = 'Walnut joinery plugs'; chairDetail.color.multiplyScalar(.81); chairDetail.roughness = .95;
  const modeledChair = createChair({ wood: chairWood, fabric: chairFabric, piping: chairPiping, detail: chairDetail });
  const chair = modeledChair.group;
  chair.position.set(1.42, 0, -.62); chair.rotation.y = -Math.PI / 2 + .09; room.add(chair);
  chair.updateMatrixWorld(true);
  const chairWorldBounds = modeledChair.bounds.clone().applyMatrix4(chair.matrixWorld);
  const chairSize = chairWorldBounds.getSize(new THREE.Vector3()), chairCenter = chairWorldBounds.getCenter(new THREE.Vector3());
  block(chairCenter.x, chairCenter.z, chairSize.x, chairSize.z, .035);
  contact(1.42, -.62, .68, .69, .15, .0025);
  const { parts: chairParts, ...chairMetrics } = modeledChair.stats;
  chairMetrics.parts = {};
  for (const piece of Object.values(chairParts)) {
    chairMetrics.parts[piece.part] = (chairMetrics.parts[piece.part] || 0) + piece.triangles;
  }
  chairMetrics.worldSize = chairSize.toArray();

  // Raised-panel bedroom door, carefully scaled hardware and painted architrave.
  const doorX = 1.94;
  box(1.01, 2.17, .07, doorX, 1.085, 3.164, darkEdge, .008);
  box(.9, 2.085, .045, doorX, 1.065, 3.119, M.wood, .012);
  for (const x of [doorX - .52, doorX + .52]) box(.085, 2.25, .075, x, 1.125, 3.094, M.trim, .009);
  box(1.12, .092, .075, doorX, 2.22, 3.094, M.trim, .008);
  box(1.15, .025, .085, doorX, 2.275, 3.085, M.trim, .005);
  for (const [y, h] of [[.46, .59], [1.42, .96]]) for (const x of [doorX - .223, doorX + .223]) {
    box(.346, h, .018, x, y, 3.089, darkEdge, .008);
    box(.307, h - .045, .026, x, y, 3.075, M.wood, .008);
    for (const dx of [-.173, .173]) box(.018, h + .012, .025, x + dx, y, 3.069, softWood, .004);
    for (const dy of [-h / 2, h / 2]) box(.356, .018, .025, x, y + dy, 3.069, softWood, .004);
  }
  box(.05, .2, .009, doorX - .327, 1.035, 3.049, M.brass, .012);
  const doorHandle = cylinder(.023, .023, .045, doorX - .327, 1.075, 3.024, M.brass, 20); doorHandle.rotation.x = Math.PI / 2;
  rod(point(doorX - .327, 1.075, 3.002), point(doorX - .19, 1.075, 3.002), .012, M.brass);
  box(.009, .022, .002, doorX - .327, .986, 3.042, M.dark, .003);
  for (const y of [.32, 1.07, 1.86]) {
    const hinge = cylinder(.009, .009, .067, doorX + .453, y, 3.075, M.brass, 10); hinge.rotation.z = 0;
  }
  // Single period-correct light switch by the door.
  box(.081, .124, .009, 1.23, 1.22, 3.18, windowPaint, .007);
  box(.031, .057, .011, 1.23, 1.224, 3.17, windowPaint, .004);
  for (const y of [1.173, 1.267]) {
    const screw = cylinder(.0025, .0025, .0015, 1.23, y, 3.174, M.brass, 8);
    screw.rotation.x = Math.PI / 2; screw.castShadow = false;
    const slot = rod(point(1.2285, y, 3.1729), point(1.2315, y, 3.1729), .00022, M.dark);
    slot.castShadow = false;
  }
  box(.11, .075, .012, 2.02, .24, -3.182, windowPaint, .006);
  for (const x of [1.994, 2.047]) for (const dx of [-.006, .006]) box(.0028, .014, .002, x + dx, .242, -3.173, M.dark, .001);

  // Faded photographs in layered timber frames. No supernatural props or UI.
  picture(-2.974, 1.72, -1.58, .55, .73, Math.PI / 2, 1);
  picture(2.974, 1.85, 1.47, .62, .46, -Math.PI / 2, 2);
  return { colliders, bedMetrics, chairMetrics, lampPosition: new THREE.Vector3(bedsideX, 1.075, lampZ),
    lampMaterials: { shade, bulb: filament.material },
    windowPosition: new THREE.Vector3(.4, 1.775, -3.18), windowGlass: glass,
    windowBounds: { position: glass.position.clone(), width: 1.54, height: 1.45 }, updates: [] };

  function roundedOutline(width, depth, radius, cx, y, cz, thickness, material) {
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2 + radius, -depth / 2);
    shape.lineTo(width / 2 - radius, -depth / 2);
    shape.quadraticCurveTo(width / 2, -depth / 2, width / 2, -depth / 2 + radius);
    shape.lineTo(width / 2, depth / 2 - radius);
    shape.quadraticCurveTo(width / 2, depth / 2, width / 2 - radius, depth / 2);
    shape.lineTo(-width / 2 + radius, depth / 2);
    shape.quadraticCurveTo(-width / 2, depth / 2, -width / 2, depth / 2 - radius);
    shape.lineTo(-width / 2, -depth / 2 + radius);
    shape.quadraticCurveTo(-width / 2, -depth / 2, -width / 2 + radius, -depth / 2);
    const pts = shape.getPoints(100).map(p => new THREE.Vector3(p.x + cx, y, p.y + cz));
    const curve = new THREE.CatmullRomCurve3(pts, true);
    mesh(new THREE.TubeGeometry(curve, 100, thickness, 5, true), material, 0, 0, 0);
  }
  function book(width, height, depth, color) {
    const group = new THREE.Group(); room.add(group);
    const cover = plain(color, .78);
    box(width, .004, depth, 0, -height / 2, 0, cover, .001, group);
    box(width, .004, depth, 0, height / 2, 0, cover, .001, group);
    box(width - .008, height - .004, depth - .012, 0, 0, .002, M.paper, .001, group);
    box(.008, height + .003, depth, -width / 2 + .003, 0, 0, cover, .002, group);
    for (let i = 0; i < 3; i++) box(.012, .0015, depth * .8, -width / 2 + .014, height / 2 + .003, 0, M.brass, 0, group);
    return group;
  }
  function stationery() {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 720;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#c8bfa6'; ctx.fillRect(0, 0, 512, 720);
    const edge = ctx.createLinearGradient(0, 0, 512, 0);
    edge.addColorStop(0, 'rgba(113,96,65,.14)'); edge.addColorStop(.04, 'rgba(113,96,65,0)');
    edge.addColorStop(.95, 'rgba(113,96,65,0)'); edge.addColorStop(1, 'rgba(113,96,65,.12)');
    ctx.fillStyle = edge; ctx.fillRect(0, 0, 512, 720);
    ctx.strokeStyle = 'rgba(98,106,101,.17)'; ctx.lineWidth = 1;
    for (let y = 142; y < 664; y += 41) {
      ctx.beginPath(); ctx.moveTo(34, y); ctx.lineTo(478, y); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(53,57,48,.58)'; ctx.font = 'italic 22px Georgia, serif';
    ctx.fillText('Lembrar de comprar', 48, 100);
    ctx.font = 'italic 20px Georgia, serif';
    for (const [line, label] of ['café', 'pilhas', 'lâmpada 40 W', 'sabão'].entries()) {
      ctx.fillText(label, 62 + line % 2 * 4, 177 + line * 41);
      ctx.beginPath(); ctx.arc(46, 169 + line * 41, 2, 0, Math.PI * 2); ctx.fill();
    }
    // A slight fold and a dried cup ring give the existing small prop scale.
    ctx.strokeStyle = 'rgba(100,84,55,.08)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(377, 546, 74, .18, Math.PI * 1.82); ctx.stroke();
    ctx.strokeStyle = 'rgba(82,76,58,.06)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(257, 0); ctx.lineTo(253, 720); ctx.stroke();
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, M.floor.map?.anisotropy || 4);
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, color: '#dfd8c4' });
    material.name = 'Used cream notepaper with an ordinary shopping list';
    return material;
  }
  function picture(x, y, z, width, height, angle, seed) {
    const group = new THREE.Group(); group.position.set(x, y, z); group.rotation.y = angle; room.add(group);
    box(width, height, .035, 0, 0, 0, M.dark, .012, group);
    box(width - .033, height - .033, .011, 0, 0, .022, M.brass, .005, group);
    box(width - .05, height - .05, .012, 0, 0, .029, M.wood, .004, group);
    box(width - .075, height - .075, .01, 0, 0, .035, M.paper, .001, group);
    const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#797568'; ctx.fillRect(0, 0, 384, 512);
    const sky = ctx.createLinearGradient(0, 0, 0, 512); sky.addColorStop(0, '#b9b8a5'); sky.addColorStop(.55, '#777b6c'); sky.addColorStop(1, '#262b26'); ctx.fillStyle = sky; ctx.fillRect(0, 0, 384, 512);
    let rng = seed * 9187;
    const random = () => { rng = (rng * 1664525 + 1013904223) >>> 0; return rng / 4294967296; };
    if (seed === 1) {
      for (let i = 0; i < 29; i++) {
        const tx = random() * 430 - 20, h = 140 + random() * 280;
        ctx.strokeStyle = `rgba(28,36,29,${.15 + random() * .35})`; ctx.lineWidth = 2 + random() * 6;
        ctx.beginPath(); ctx.moveTo(tx, 512); ctx.lineTo(tx - 15 + random() * 30, 512 - h); ctx.stroke();
        for (let j = 0; j < 5; j++) { ctx.beginPath(); ctx.moveTo(tx, 480 - j * 35); ctx.lineTo(tx + (j % 2 ? 1 : -1) * (25 + random() * 40), 430 - j * 35); ctx.stroke(); }
      }
    } else {
      ctx.fillStyle = '#55584b'; ctx.beginPath(); ctx.moveTo(0, 310); ctx.lineTo(95, 201); ctx.lineTo(197, 302); ctx.lineTo(294, 163); ctx.lineTo(384, 260); ctx.lineTo(384, 512); ctx.lineTo(0, 512); ctx.fill();
      ctx.fillStyle = '#373d32'; ctx.fillRect(107, 302, 166, 109); ctx.beginPath(); ctx.moveTo(87, 305); ctx.lineTo(189, 232); ctx.lineTo(295, 305); ctx.fill();
      ctx.fillStyle = '#a7a087'; ctx.fillRect(140, 331, 28, 31); ctx.fillRect(209, 331, 28, 31); ctx.fillStyle = '#212a23'; ctx.fillRect(180, 357, 28, 54);
    }
    for (let i = 0; i < 16000; i++) { const c = random() > .5 ? 255 : 0; ctx.fillStyle = `rgba(${c},${c},${c},${random() * .075})`; ctx.fillRect(random() * 384, random() * 512, 1, 1); }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const art = mesh(new THREE.PlaneGeometry(width - .12, height - .12), new THREE.MeshStandardMaterial({ map: texture, roughness: .94 }), 0, 0, .042, group); art.castShadow = false;
    const photoGlass = mesh(new THREE.PlaneGeometry(width - .075, height - .075), new THREE.MeshPhysicalMaterial({ color: '#b5c5b5', roughness: .12, transparent: true, opacity: .035, metalness: .1, depthWrite: false }), 0, 0, .047, group); photoGlass.castShadow = false;
  }
}

function contactTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(0,0,0,.9)'); gradient.addColorStop(.45, 'rgba(0,0,0,.62)'); gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// Precompute the shade's transmitted glow once: the bulb is below the centre,
// while stitched rims and pleats absorb light. Runtime uses one emissive map.
function lampEmissionTexture(photographicWeave) {
  const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 384;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#5c4932'); gradient.addColorStop(.12, '#a88a5d');
  gradient.addColorStop(.50, '#e8cea0'); gradient.addColorStop(.77, '#f2dbb1');
  gradient.addColorStop(.94, '#c8a876'); gradient.addColorStop(1, '#6c5133');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (photographicWeave) {
    ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = .35;
    ctx.drawImage(photographicWeave, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  // A complete turn contains the same 48 folds as the actual shade geometry.
  for (let pleat = 0; pleat < 48; pleat++) {
    const x = pleat * canvas.width / 48;
    const fold = ctx.createLinearGradient(x, 0, x + canvas.width / 48, 0);
    fold.addColorStop(0, 'rgba(48,32,16,.20)');
    fold.addColorStop(.45, 'rgba(48,32,16,0)');
    fold.addColorStop(1, 'rgba(48,32,16,.20)');
    ctx.fillStyle = fold; ctx.fillRect(x, 0, canvas.width / 48, canvas.height);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.name = 'Baked warm linen shade transmission'; map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping; map.anisotropy = 4;
  return map;
}

function patternedRug(photographicWeave) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 1024;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4d4540'; ctx.fillRect(0, 0, 1024, 1024);
  ctx.fillStyle = '#706150'; ctx.fillRect(18, 18, 988, 988);
  ctx.fillStyle = '#453d36'; ctx.fillRect(30, 30, 964, 964);
  ctx.fillStyle = '#766956'; ctx.fillRect(47, 47, 930, 930);
  ctx.fillStyle = '#3c4240'; ctx.fillRect(108, 108, 808, 808);
  ctx.fillStyle = '#8b7c61'; ctx.fillRect(119, 119, 786, 786);
  ctx.fillStyle = '#64493e'; ctx.fillRect(131, 131, 762, 762);
  function diamond(x, y, r, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill(); }
  for (let i = 0; i < 21; i++) {
    const x = 66 + i * 44.5;
    for (const y of [78, 946]) { diamond(x, y, 18, '#3f4840'); diamond(x, y, 9, '#a18d6d'); }
    const y = 66 + i * 44.5;
    for (const x2 of [78, 946]) { diamond(x2, y, 18, '#3f4840'); diamond(x2, y, 9, '#a18d6d'); }
  }
  diamond(512, 512, 301, '#4b4c3e'); diamond(512, 512, 269, '#998264'); diamond(512, 512, 252, '#3b443e'); diamond(512, 512, 208, '#755440'); diamond(512, 512, 169, '#a08b6c'); diamond(512, 512, 139, '#3e4740'); diamond(512, 512, 94, '#77513b'); diamond(512, 512, 42, '#a29376');
  for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
    const x = 172 + col * 85, y = 172 + row * 85;
    if (Math.abs(x - 512) + Math.abs(y - 512) < 325) continue;
    diamond(x, y, 17, '#a18a67'); diamond(x, y, 9, '#3b463e');
    ctx.strokeStyle = '#a18a67'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y - 29); ctx.lineTo(x, y + 29); ctx.moveTo(x - 26, y); ctx.lineTo(x + 26, y); ctx.stroke();
  }
  if (photographicWeave) {
    ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = .5;
    ctx.drawImage(photographicWeave, 0, 0, 1024, 1024);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  }
  let seed = 4149; const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 90000; i++) { const v = random() > .5 ? 220 : 10; ctx.fillStyle = `rgba(${v},${v},${v},${.025 + random() * .1})`; ctx.fillRect(random() * 1024, random() * 1024, 1 + random() * 2, .7); }
  // Localised traffic wear interrupts the otherwise perfect printed motif.
  for (let i = 0; i < 45; i++) {
    const x = random() * 1024, y = random() * 1024, radius = 20 + random() * 110;
    const wear = ctx.createRadialGradient(x, y, 0, x, y, radius);
    wear.addColorStop(0, `rgba(191,178,145,${.025 + random() * .09})`); wear.addColorStop(1, 'rgba(191,178,145,0)');
    ctx.fillStyle = wear; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  ctx.globalAlpha = .08; ctx.strokeStyle = '#d4c8a6'; ctx.lineWidth = 1;
  for (let y = 0; y < 1024; y += 3) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1024, y); ctx.stroke(); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}
