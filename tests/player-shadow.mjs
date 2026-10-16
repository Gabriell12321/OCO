import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'three') return { url: new URL('../dist/vendor/three.module.js', import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import('three');
const { createHumanShadowProxy, createPlayerShadow } = await import('../dist/player-shadow.js');

const human = createHumanShadowProxy();
const { position, skinIndex, skinWeight } = human.mesh.geometry.attributes;
assert.equal(human.object.children.length, 1);
assert.ok(human.triangles > 3000 && human.triangles <= 6500, 'A detailed silhouette fits the shadow budget');
assert.equal(position.count, skinIndex.count);
assert.equal(position.count, skinWeight.count);
for (let i = 0; i < skinIndex.count; i++) {
  let sum = 0;
  for (let c = 0; c < 4; c++) {
    const index = skinIndex.array[i * 4 + c], weight = skinWeight.array[i * 4 + c];
    assert.ok(index >= 0 && index < human.mesh.skeleton.bones.length, 'Every influence references a real joint');
    assert.ok(Number.isFinite(weight) && weight >= 0 && weight <= 1);
    sum += weight;
  }
  assert.ok(Math.abs(sum - 1) < .00001, 'Skinning weights remain normalized');
}
for (const index of human.mesh.geometry.index.array) assert.ok(index >= 0 && index < position.count);
let toeCenter = -Infinity, toeEdge = -Infinity;
for (let i = 0; i < position.count; i++) {
  const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
  if (x <= 0 || y > .045 || z < .12) continue;
  const width = Math.abs(x - .109);
  if (width < .015) toeCenter = Math.max(toeCenter, z);
  if (width > .045) toeEdge = Math.max(toeEdge, z);
}
assert.ok(toeCenter - toeEdge > .018, 'The toe/sole has a rounded cap instead of a rectangular edge');

const controls = { position: new THREE.Vector3(), yaw: 0, moving: false, running: false, speed: 0,
  gait: { phase: 0, blend: 0, runBlend: 0, localX: 0, localZ: -1 } };
human.update(controls, 1 / 30);
human.mesh.computeBoundingBox();
const rest = human.mesh.boundingBox.clone().applyMatrix4(human.mesh.matrixWorld);
assert.ok(rest.max.y > 1.70 && rest.max.y < 1.82, 'Neutral pose has an adult human height');
assert.ok(rest.min.y >= -.001 && rest.min.y < .012, 'Shoes contact the floor while standing');
assert.ok(rest.max.z - rest.min.z < .45, 'Neutral feet do not retain a large walking stance');
const point = new THREE.Vector3(), hand = human.mesh.skeleton.getBoneByName('mixamorigLeftHand');
const restingHand = hand.getWorldPosition(new THREE.Vector3());
let minimumFloor = Infinity, handTravel = 0, poses = 0;
for (const [blend, runBlend] of [[1, 0], [.5, .5], [1, 1]]) {
  controls.gait.blend = blend; controls.gait.runBlend = runBlend;
  for (let frame = 0; frame < 60; frame++) {
    controls.gait.phase = frame / 60 * Math.PI * 2;
    human.update(controls, 1 / 30);
    human.mesh.computeBoundingBox();
    const box = human.mesh.boundingBox.clone().applyMatrix4(human.mesh.matrixWorld);
    assert.ok([...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite), 'Animated skinning remains finite');
    assert.ok(box.min.y >= -.001, 'No shoe penetrates the floor during the stride');
    assert.ok(box.max.y > 1.60 && box.max.y < 1.95, 'The body retains its scale during animation');
    minimumFloor = Math.min(minimumFloor, box.min.y);
    handTravel = Math.max(handTravel, hand.getWorldPosition(point).distanceTo(restingHand));
    poses++;
  }
}
assert.ok(handTravel > .15, 'Recorded walk/run clips move the limbs');
human.dispose();

// Scheduling is tested without a graphics driver; native tests measure GPU FPS.
let renderCalls = 0, target = null;
const renderer = { shadowMap: { enabled: true }, getRenderTarget: () => target,
  setRenderTarget: value => { target = value; }, getClearAlpha: () => 1,
  getClearColor: color => color.set(0x000000), setClearColor() {}, render() { renderCalls++; } };
const shadow = createPlayerShadow(renderer, new THREE.Vector3(.4, 1.2, -2.6));
controls.gait.phase = controls.gait.blend = controls.gait.runBlend = 0;
shadow.update(controls, 1 / 60, 0, true);
for (let frame = 1; frame <= 120; frame++) shadow.update(controls, 1 / 60, frame * 1000 / 60);
assert.equal(renderCalls, 1, 'Stationary human depth is cached');
controls.moving = true; controls.speed = 1.12; controls.gait.blend = 1;
for (let frame = 121; frame <= 300; frame++) {
  controls.position.z -= 1.12 / 60;
  controls.gait.phase = (controls.gait.phase + 1.12 / 60 / 1.24 * Math.PI * 2) % (Math.PI * 2);
  shadow.update(controls, 1 / 60, frame * 1000 / 60);
}
assert.ok(renderCalls >= 85 && renderCalls <= 92, 'Human depth updates at most thirty times per second');
const snapshot = shadow.snapshot();
assert.equal(snapshot.meshCount, 1); assert.equal(snapshot.mapSize, 512);
assert.equal(snapshot.mainSceneBody, false); assert.equal(snapshot.staticRoomRedraws, 0);
assert.equal(renderer.shadowMap.enabled, true); assert.equal(target, null, 'Renderer state is restored');
shadow.dispose();
console.log(JSON.stringify({ riggedHuman: 'OK', skinning: 'OK', poses, feetContact: 'OK',
  minimumFloor: Number(minimumFloor.toFixed(4)), triangles: snapshot.triangles,
  shadowBudget: 'one draw / 512² / 30 Hz', stationaryCache: 'OK', firstPersonOnly: 'OK' }));
