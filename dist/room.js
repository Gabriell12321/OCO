import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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
  const glassMaterial = new THREE.MeshPhysicalMaterial({ color: '#9bafa9', roughness: .13, metalness: .05, transparent: true, opacity: .13, transmission: 0, side: THREE.DoubleSide, depthWrite: false });
  const glass = mesh(new THREE.PlaneGeometry(1.54, 1.45), glassMaterial, .4, 1.775, -3.23); glass.castShadow = false;
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
  block(bedX, bedZ, 1.96, 2.43, .07);
  contact(bedX, bedZ, 2.5, 2.95, .3);
  for (const x of [bedX - .79, bedX + .79]) for (const z of [bedZ - .93, bedZ + .93]) {
    const foot = box(.095, .22, .095, x, .12, z, darkEdge, .014);
    foot.rotation.y = .08 * Math.sign(x - bedX);
  }
  box(1.91, .21, 2.4, bedX, .285, bedZ, M.wood, .028);
  box(1.79, .13, 2.28, bedX, .42, bedZ, M.dark, .035);
  box(1.86, .22, 2.31, bedX, .505, bedZ, M.linen, .075);
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
  // Irregular pillows are sewn closed, slightly sunken and asymmetrically placed.
  pillow(bedX - .46, .687, bedZ - .82, -.055);
  pillow(bedX + .41, .69, bedZ - .86, .09);
  // Top surface and dropped sides are connected so the blanket never reads as a cuboid.
  const bedding = duvet(bedX, bedZ);
  wovenThrow(bedding);

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
  const chair = new THREE.Group(); chair.position.set(1.42, 0, -.62); chair.rotation.y = -Math.PI / 2 + .09; room.add(chair);
  block(1.42, -.62, .52, .56, .04); contact(1.42, -.62, .77, .8, .2);
  box(.46, .055, .44, 0, .455, 0, M.wood, .022, chair);
  const chairFabric = cloneSurface(M.blanket);
  chairFabric.name = 'Faded olive woven seat cushion'; chairFabric.color.set('#8e8b74');
  chairFabric.normalScale.set(.20, .20); chairFabric.roughness = 1;
  box(.418, .048, .397, 0, .494, 0, chairFabric, .035, chair);
  for (const x of [-.18, .18]) for (const z of [-.16, .16]) {
    const leg = box(.036, .43, .036, x, .233, z, M.wood, .007, chair); leg.rotation.z = x * -.18;
  }
  for (const x of [-.195, .195]) box(.035, .59, .035, x, .729, .189, M.wood, .007, chair);
  box(.43, .115, .04, 0, .991, .189, M.wood, .012, chair);
  for (const x of [-.09, 0, .09]) box(.025, .33, .025, x, .779, .19, M.wood, .006, chair);
  rod(point(-.19, .22, -.17), point(-.19, .22, .17), .011, M.wood, chair);
  rod(point(.19, .22, -.17), point(.19, .22, .17), .011, M.wood, chair);

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
  return { colliders, lampPosition: new THREE.Vector3(bedsideX, 1.075, lampZ), windowPosition: new THREE.Vector3(.4, 1.775, -3.18), updates: [] };

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
  function pillow(x, y, z, angle) {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = angle; room.add(g);
    const geometry = new THREE.SphereGeometry(1, 64, 40);
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const nx = p.getX(i), ny = p.getY(i), nz = p.getZ(i);
      // Superellipse profile: rounded corners, broad flattened sleeping surface.
      const px = Math.sign(nx) * Math.pow(Math.abs(nx), .46) * .38;
      const pz = Math.sign(nz) * Math.pow(Math.abs(nz), .49) * .235;
      const depression = Math.exp(-((px + .025) ** 2 / .018 + (pz - .025) ** 2 / .009)) * .026 * Math.max(0, ny);
      const seamGather = Math.exp(-((Math.abs(px) - .315) ** 2) / .0012);
      const wrinkles = (Math.sin(pz * 79 + px * 7) + Math.sin(pz * 43 - px * 13) * .5) * .0023 * seamGather;
      const subtleCrumple = Math.sin(px * 14 + pz * 23) * .002 * Math.max(0, ny);
      p.setXYZ(i, px, ny * .085 - depression + wrinkles + subtleCrumple, pz);
    }
    geometry.computeVertexNormals(); mesh(geometry, M.linen, 0, 0, 0, g);
    const seamPoints = [];
    for (let i = 0; i <= 90; i++) {
      const a = i / 90 * Math.PI * 2;
      seamPoints.push(point(Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), .46) * .381, -.004, Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), .49) * .236));
    }
    const curve = new THREE.CatmullRomCurve3(seamPoints, true);
    mesh(new THREE.TubeGeometry(curve, 90, .0023, 4, true), cottonStitch, 0, 0, 0, g);
    g.rotation.x = -.09;
  }
  function smooth01(value) {
    const t = THREE.MathUtils.clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }
  function sampleAxis(parts) {
    const result = [];
    for (const [start, end, segments] of parts) {
      for (let i = 0; i < segments; i++) result.push(start + (end - start) * i / segments);
    }
    result.push(parts[parts.length - 1][1]);
    return result;
  }
  function clothGrid(xs, zs, sample, uvSize = 2.1, restUV = (x, z) => [x, z]) {
    const positions = [], uvs = [], indices = [];
    for (const z of zs) for (const x of xs) {
      const p = sample(x, z);
      positions.push(p.x, p.y, p.z);
      // Rest-space UVs keep the linen weave the same size over curved edges.
      const [restX, restZ] = restUV(x, z);
      uvs.push((restX + 1.25) / uvSize, (restZ + .82) / uvSize);
    }
    const stride = xs.length;
    for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < stride - 1; i++) {
      const a = j * stride + i, b = a + 1, c = a + stride, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    return geometry;
  }
  function clothHem(xs, zs, sample, radius = .0032) {
    const points = [], xmin = xs[0], xmax = xs[xs.length - 1], zmin = zs[0], zmax = zs[zs.length - 1];
    for (let i = 0; i < 64; i++) points.push(sample(xmin + (xmax - xmin) * i / 64, zmin));
    for (let i = 0; i < 64; i++) points.push(sample(xmax, zmin + (zmax - zmin) * i / 64));
    for (let i = 0; i < 64; i++) points.push(sample(xmax - (xmax - xmin) * i / 64, zmax));
    for (let i = 0; i < 64; i++) points.push(sample(xmin, zmax - (zmax - zmin) * i / 64));
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true, 'centripetal'), 288, radius, 5, true);
  }
  function joinedCloth(geometry, hem, material, name) {
    // Sewn border and cloth share one draw call. Neither needs per-frame work.
    const combined = mergeGeometries([geometry, hem], false);
    geometry.dispose(); hem.dispose();
    const result = mesh(combined, material, 0, 0, 0); result.name = name;
    return result;
  }
  function duvet(cx, cz) {
    // Extra samples are concentrated on the rounded mattress shoulder and
    // the foot. The large, gently inflated central surface stays inexpensive.
    const xs = sampleAxis([[-1.25, -1.02, 12], [-1.02, -.84, 20], [-.84, .84, 88], [.84, 1.02, 20], [1.02, 1.25, 12]]);
    const zs = sampleAxis([[-.82, .99, 100], [.99, 1.25, 32], [1.25, 1.47, 14]]);
    const tension = [
      [-.84, -.59, -.26, -.05, .081, .038, .8],
      [.77, -.71, .16, -.08, .098, .044, 2.1],
      [-.86, .26, -.23, .65, .073, .039, 1.2],
      [.83, .36, .23, .82, .088, .047, 2.8],
      [-.45, 1.12, -.21, .58, .065, .031, .3],
      [.49, 1.14, .11, .78, .071, .035, 1.5],
      [-.37, -.67, -.08, -.27, .054, .021, 2.4],
    ].map(([ax, az, bx, bz, width, height, phase]) => {
      const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz);
      return { ax, az, dx: dx / length, dz: dz / length, length, width, height, phase };
    });
    function surfaceFolds(x, z) {
      let height = .005 * Math.sin(x * 4.1 + z * 2.7) + .003 * Math.sin(z * 6.8 - x * 3.2);
      height += .014 * Math.exp(-(((x - .25) / .45) ** 2 + ((z - .31) / .62) ** 2));
      height -= .008 * Math.exp(-(((x + .13) / .39) ** 2 + ((z + .37) / .30) ** 2));
      for (const f of tension) {
        const dx = x - f.ax, dz = z - f.az;
        const along = (dx * f.dx + dz * f.dz) / f.length;
        if (along < -.1 || along > 1.1) continue;
        const taper = smooth01((along + .1) / .28) * smooth01((1.1 - along) / .36);
        const bend = Math.sin(along * Math.PI * 1.4 + f.phase) * .023;
        const across = -dx * f.dz + dz * f.dx - bend;
        const width = f.width * (1.13 - smooth01(along) * .28);
        height += (Math.exp(-((across / width) ** 2)) - .21 * Math.exp(-(((across + width * 1.5) / (width * 1.2)) ** 2))) * f.height * taper;
      }
      return height;
    }
    function sample(u, v) {
      // The far corners are rounded in rest space. This removes the long,
      // triangular points produced by dropping a rectangular grid vertically.
      const corner = .20, start = 1.47 - corner;
      const end = Math.max(0, v - start);
      const rowHalfWidth = v > start ? 1.25 - corner + Math.sqrt(Math.max(0, corner * corner - end * end)) : 1.25;
      let x = u / 1.25 * rowHalfWidth;
      const scallop = smooth01((Math.abs(x) - .78) / .43);
      x += Math.sign(x) * Math.sin(v * 8.1 + .7) * .012 * scallop;
      const footWaver = Math.sin(u * 7.2 + .8) * .014 * smooth01((v - 1.04) / .4);
      const z = v + footWaver;
      const side = Math.max(0, Math.abs(x) - .84), foot = Math.max(0, z - 1.05);
      const distance = Math.hypot(side, foot), radius = .11;
      const nx = distance ? Math.sign(x) * side / distance : 0;
      const nz = distance ? foot / distance : 0;
      const arcLength = Math.PI * .5 * radius;
      const theta = Math.min(Math.PI * .5, distance / radius);
      const hanging = Math.max(0, distance - arcLength);
      const curve = radius * Math.sin(theta);
      const hangWeight = smooth01(hanging / .15);
      const sidePleat = Math.sin(v * 14.8 + Math.sin(v * 4.2) + (x < 0 ? .5 : 2.1)) * .012 + Math.sin(v * 27 + .4) * .0035;
      const footPleat = Math.sin(x * 17.2 + .5) * .012 + Math.sin(x * 29.6 + 2.2) * .004;
      const billow = (sidePleat * Math.abs(nx) + footPleat * nz) * (.2 + hangWeight * .8);
      const hemSway = Math.sin(v * 7 + x * 4.3) * .007 * hangWeight;
      const topWeight = 1 - smooth01(distance / .24) * .82;
      // A circular shoulder transitions to gravity-driven vertical cloth.
      // Texture detail is reserved for the weave; folds exist in the mesh.
      const y = .645 - radius * (1 - Math.cos(theta)) - hanging + surfaceFolds(x, z) * topWeight + hemSway;
      const anchorX = THREE.MathUtils.clamp(x, -.84, .84), anchorZ = Math.min(z, 1.05);
      let outward = curve + billow + hangWeight * .016;
      // Below the mattress the cloth must clear the slightly wider timber
      // rail, including its rounded foot corners. Preserve the folds above
      // it; only ease the lower drape out onto this supporting silhouette.
      const clearance = smooth01((.54 - y) / .135);
      if (distance > 0 && clearance > 0) {
        const railDistance = r => {
          const qx = Math.abs(anchorX + nx * r) - .931;
          const qz = Math.abs(anchorZ + nz * r) - 1.175;
          return Math.hypot(Math.max(0, qx), Math.max(0, qz)) + Math.min(Math.max(qx, qz), 0) - .042;
        };
        if (railDistance(outward) < 0) {
          let lo = outward, hi = .36;
          for (let iteration = 0; iteration < 8; iteration++) {
            const mid = (lo + hi) * .5;
            if (railDistance(mid) < 0) lo = mid; else hi = mid;
          }
          outward += (hi - outward) * clearance;
        }
      }
      const px = anchorX + nx * outward;
      const pz = anchorZ + nz * outward;
      return point(cx + px, y, cz + pz);
    }
    const material = cloneSurface(M.linen);
    material.side = THREE.DoubleSide; material.color.multiplyScalar(.96);
    material.normalScale?.set(.095, .095); material.roughness = 1;
    joinedCloth(clothGrid(xs, zs, sample), clothHem(xs, zs, sample), material,
      'Ivory duvet: rounded mattress shoulder, organic tension folds and sewn hem');

    // The turned-back edge rests on the actual folded surface below it.
    // Its gently rolled lip has no straight diagonal slab at either end.
    const foldXs = sampleAxis([[-.94, -.78, 14], [-.78, .78, 72], [.78, .94, 14]]);
    const foldZs = sampleAxis([[0, 1, 26]]);
    const foldSample = (x, t) => {
      const z = -.735 + t * .30 + x * .025;
      const p = sample(x, z);
      const rolledLip = Math.sin(t * Math.PI) * .026 + Math.exp(-(((t - .91) / .11) ** 2)) * .008;
      p.y += .009 + rolledLip + Math.sin(x * 10.1 + t * 1.6) * .003;
      return p;
    };
    const foldMaterial = cloneSurface(material); foldMaterial.color.multiplyScalar(1.02);
    joinedCloth(clothGrid(foldXs, foldZs, foldSample, 2.1, (x, t) => [x, -.735 + t * .30 + x * .025]), clothHem(foldXs, foldZs, foldSample, .0022), foldMaterial,
      'Soft turned-back duvet edge with a rolled sewn lip');
    return { sample };
  }
  function wovenThrow(bedding) {
    const material = cloneSurface(M.blanket); material.color.multiplyScalar(.89);
    material.side = THREE.DoubleSide; material.roughness = .98;
    material.normalScale?.set(.19, .19);
    const xs = sampleAxis([[-1.22, -1.02, 12], [-1.02, -.84, 18], [-.84, .84, 80], [.84, 1.02, 18], [1.02, 1.22, 12]]);
    const zs = sampleAxis([[.77, .99, 24], [.99, 1.26, 30], [1.26, 1.41, 14]]);
    const sample = (x, z) => {
      const p = bedding.sample(x, z);
      const side = smooth01((Math.abs(x) - .8) / .34), foot = smooth01((z - 1.04) / .3);
      const topWeight = 1 - Math.max(side, foot) * .88;
      const softFold = Math.exp(-(((z - .91 + x * .043 + Math.sin(x * 3) * .012) / .042) ** 2)) * .023;
      const crumple = Math.exp(-(((x - .41 + (z - .9) * .6) / .079) ** 2 + ((z - .98) / .35) ** 2)) * .022;
      p.y += .016 + (softFold + crumple + Math.sin(x * 8 + z * 3) * .0035) * topWeight;
      p.x += Math.sign(x) * side * .014;
      p.z += foot * .014;
      return p;
    };
    joinedCloth(clothGrid(xs, zs, sample, 1.8), clothHem(xs, zs, sample, .0026), material,
      'Heavy woven throw following the duvet and rounded bed corners');
    // Forty-one short yarn tassels are one mesh, rather than forty-one draws.
    const fringeGeometry = [];
    for (let i = 0; i < 41; i++) {
      const x = -1.205 + i * 2.41 / 40;
      const start = sample(x, 1.41), end = sample(x, 1.452);
      end.y -= .004 + (1 + Math.sin(i * 2.1)) * .003;
      end.x += Math.sin(i * 2.7) * .002;
      const middle = start.clone().lerp(end, .55); middle.z += .002;
      fringeGeometry.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([start, middle, end]), 4, .0016, 4, false));
    }
    const fringe = mesh(mergeGeometries(fringeGeometry, false), material, 0, 0, 0);
    fringe.name = 'Fine irregular woven fringe, single static mesh';
    fringeGeometry.forEach(geometry => geometry.dispose());
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
