import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'three') return { url: new URL('../dist/vendor/three.module.js', import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import('three');
const { createPlayerShadow } = await import('../dist/player-shadow.js');

// Use the real animated mesh, camera, matrix and material. The ray query finds
// the closest surface a shadow texel represents; packing/compare below mirrors
// Three's RGBA shader and the actual unsigned-byte render target. Native image
// tests additionally exercise the WebGL implementation.
const lamp = new THREE.Vector3(.4, 1.075, -2.595);
const originalTarget = { name: 'main scene render target' };
const originalColor = new THREE.Color(.2, .3, .4);
let target = originalTarget, color = originalColor.clone(), alpha = .7;
let renderedMesh, renderedCamera, draws = 0;
const renderer = {
  shadowMap: { enabled: true }, getRenderTarget: () => target,
  setRenderTarget: value => { target = value; }, getClearAlpha: () => alpha,
  getClearColor: output => output.copy(color),
  setClearColor(value, opacity) { color.set(value); alpha = opacity; },
  render(scene, camera) {
    assert.equal(target.width, 512); assert.equal(target.height, 512);
    assert.equal(target.texture.type, THREE.UnsignedByteType);
    assert.equal(target.texture.colorSpace, THREE.NoColorSpace);
    assert.equal(color.getHex(), 0xffffff); assert.equal(alpha, 1, 'Unused texels encode the far plane');
    assert.equal(renderer.shadowMap.enabled, false, 'Do not rebuild static room shadows');
    const meshes = []; scene.traverse(child => { if (child.isMesh) meshes.push(child); });
    assert.equal(meshes.length, 1, 'The body remains a single draw');
    renderedMesh = meshes[0]; renderedCamera = camera;
    assert.equal(renderedMesh.material.depthPacking, THREE.RGBADepthPacking,
      'The depth writer must match texture2DCompare/unpackRGBAToDepth, even after JSON loading');
    assert.equal(renderedMesh.material.blending, THREE.NoBlending);
    assert.equal(renderedMesh.material.toneMapped, false);
    renderedMesh.computeBoundingSphere();
    draws++;
  },
};
const shadow = createPlayerShadow(renderer, lamp);
const shader = { uniforms: {}, vertexShader: '#include <worldpos_vertex>', fragmentShader: '#include <shadowmap_pars_fragment>' };
shadow.patchShader(shader, THREE.ShaderChunk.shadowmap_pars_fragment);
const matrix = shader.uniforms.quartoPlayerShadowMatrix.value;
assert.match(shader.fragmentShader, /getPointShadowWithoutHuman/);
assert.match(shader.fragmentShader, /roomShadow \* mix\(1\.0, quartoHumanShadow\(\), shadowIntensity\)/);
const controls = { position: new THREE.Vector3(), yaw: 0, moving: false, speed: 0, running: false,
  gait: { phase: 0, blend: 0, runBlend: 0, localX: 0, localZ: -1 } };
const raycaster = new THREE.Raycaster(), clip = new THREE.Vector4();
let now = 0;
function setPose(x, z, yaw = 0) {
  controls.position.set(x, 0, z); controls.yaw = yaw;
  now += 40;
  shadow.update(controls, 1 / 30, now);
  assert.equal(target, originalTarget); assert.ok(color.equals(originalColor)); assert.equal(alpha, .7);
  assert.equal(renderer.shadowMap.enabled, true);
  assert.deepEqual(shadow.snapshot().position, { x, y: 0, z }, 'The cached map follows the current player');
}
function project(point) {
  clip.set(point.x, point.y, point.z, 1).applyMatrix4(matrix);
  return { x: clip.x / clip.w, y: clip.y / clip.w, z: clip.z / clip.w, w: clip.w };
}
function rgbaDepth(depth) {
  if (depth <= 0) return [0, 0, 0, 0];
  if (depth >= 1) return [1, 1, 1, 1];
  const expanded = depth * 16777216;
  let whole = Math.floor(expanded);
  const a = expanded - whole;
  const b = (whole % 256) / 255; whole = Math.floor(whole / 256);
  const g = (whole % 256) / 255; whole = Math.floor(whole / 256);
  return [whole / 255, g, b, a].map(channel => Math.round(channel * 255) / 255);
}
function unpack([r, g, b, a]) {
  return r * 255 / 256 + g * 255 / 65536 + b * 255 / 16777216 + a / 16777216;
}
function sample(point, legacyGreyDepth = false) {
  const coord = project(point);
  if (coord.w <= 0 || coord.x <= 0 || coord.x >= 1 || coord.y <= 0 || coord.y >= 1 || coord.z <= 0 || coord.z >= 1) return 1;
  raycaster.set(lamp, point.clone().sub(lamp).normalize());
  const first = raycaster.intersectObject(renderedMesh, false)[0];
  if (!first) return 1;
  const depth = project(first.point).z;
  const stored = legacyGreyDepth ? [1 - depth, 1 - depth, 1 - depth, 1] : rgbaDepth(depth);
  return coord.z - .00008 <= unpack(stored) ? 1 : 0;
}

// Different body orientations and player positions around the bed. On a ray
// through the torso, a receiver before the human must stay illuminated; a
// receiver beyond the human must be in shadow. This catches the old packing
// mismatch, which shadowed both surfaces regardless of distance.
const poses = [[.85, .3, .77], [.7, -.8, -2.975], [1.5, -1.6, -2.299],
  [.95, 1.1, Math.PI], [-2.35, -.6, -Math.PI / 2], [-2.35, -2.1, 0]];
let depthChecks = 0;
for (const [x, z, yaw] of poses) {
  setPose(x, z, yaw);
  const chest = renderedMesh.skeleton.getBoneByName('mixamorigSpine2').getWorldPosition(new THREE.Vector3());
  const before = lamp.clone().lerp(chest, .5), beyond = lamp.clone().lerp(chest, 1.4);
  assert.equal(sample(before), 1, `A surface between lamp and human is lit at (${x},${z})`);
  assert.equal(sample(beyond), 0, `A surface behind the torso is shadowed at (${x},${z})`);
  assert.equal(sample(before, true), 0, 'The regression fixture reproduces the old impossible shadow');
  depthChecks += 2;
}

// At the foot/right of the bed, the entire top lies closer to the lamp than
// the human. The old depth format stamped upside-down legs onto this surface.
setPose(-.4, .3, .2);
let blanketSamples = 0, legacyFalseShadows = 0;
for (let x = -1.7; x <= .1; x += .1) for (let z = -2.5; z <= -.5; z += .1) {
  const blanket = new THREE.Vector3(x, .70, z);
  assert.equal(sample(blanket), 1, 'No human shadow can project backward onto the blanket');
  if (sample(blanket, true) === 0) legacyFalseShadows++;
  blanketSamples++;
}
assert.ok(legacyFalseShadows > 0, 'Real bed positions exercise the reported regression');

// A wall point that was behind the old player must become lit as soon as the
// player moves clear. Repeat a small 60 Hz walk to exercise the 30 Hz cache.
setPose(1.5, -1.6, -2.299);
const torso = renderedMesh.skeleton.getBoneByName('mixamorigSpine2').getWorldPosition(new THREE.Vector3());
const behindOldPlayer = lamp.clone().lerp(torso, 1.8);
assert.equal(sample(behindOldPlayer), 0);
setPose(.7, -.8, -2.975);
assert.equal(sample(behindOldPlayer), 1, 'Old shadow disappears when the player leaves');
const startDraws = draws;
controls.moving = true; controls.speed = 1.12; controls.gait.blend = 1;
for (let frame = 0; frame < 60; frame++) {
  controls.position.z += 1.12 / 60;
  controls.gait.phase += 1.12 / 60 / 1.24 * Math.PI * 2;
  now += 1000 / 60;
  shadow.update(controls, 1 / 60, now);
}
assert.ok(draws - startDraws >= 29 && draws - startDraws <= 30, 'Updates stay at 30 Hz while walking');
assert.ok(Math.abs(shadow.snapshot().position.z - controls.position.z) <= 1.12 / 60 + 1e-6);
shadow.setEnabled(false); assert.equal(shader.uniforms.quartoPlayerShadowActive.value, 0);
shadow.setEnabled(true); assert.equal(shader.uniforms.quartoPlayerShadowActive.value, 1);
const snapshot = shadow.snapshot();
shadow.dispose();
console.log(JSON.stringify({ depthFormat: 'RGBA / matching writer and reader', depthChecks,
  blanketSamples, legacyFalseShadows, movementClearsOldShadow: 'OK',
  triangles: snapshot.triangles, shadowBudget: 'one draw / 512x512 / 30 Hz', rendererState: 'restored' }));
