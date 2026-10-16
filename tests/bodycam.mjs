import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'three') return { url: new URL('../dist/vendor/three.module.js', import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import('three');
const { createControls } = await import('../dist/controls.js');

class Surface extends EventTarget {
  constructor() { super(); this.classList = { toggle() {}, remove() {} }; }
}
function emit(target, type, values = {}) {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(values)) Object.defineProperty(event, key, { value });
  target.dispatchEvent(event);
}
function setup(colliders = []) {
  const document = new Surface(), window = new Surface(), canvas = new Surface();
  document.body = new Surface(); document.getElementById = () => null; document.querySelectorAll = () => [];
  globalThis.document = document; globalThis.window = window;
  const camera = new THREE.PerspectiveCamera(88, 1, .045, 30);
  const controls = createControls(camera, canvas, colliders);
  const key = (code, down = true) => emit(document, down ? 'keydown' : 'keyup', { code });
  const tick = (seconds, hz = 120) => { for (let i = 0; i < Math.round(seconds * hz); i++) controls.update(1 / hz); };
  const pose = (position = [0, 2.4], yaw = 0, pitch = -.12) => assert.equal(controls.setDiagnosticPose({ position, yaw, pitch }), true);
  const snapshot = () => ({ ...controls.bodycam, phase: controls.gait.phase, blend: controls.gait.blend,
    x: controls.position.x, z: controls.position.z, speed: controls.speed,
    cameraX: camera.position.x, cameraY: camera.position.y, cameraZ: camera.position.z,
    qx: camera.quaternion.x, qy: camera.quaternion.y, qz: camera.quaternion.z, qw: camera.quaternion.w });
  const settled = () => {
    assert.equal(controls.moving, false);
    assert.equal(controls.gait.blend, 0);
    assert.equal(controls.gait.speed, 0);
    assert.equal(camera.position.y, 1.45);
    for (const field of ['offsetX', 'offsetY', 'offsetZ', 'roll', 'pitch', 'yaw', 'stepImpact', 'accelerationX', 'accelerationZ']) {
      assert.equal(controls.bodycam[field], 0, `${field} settles without continuous idle noise`);
    }
  };
  return { camera, controls, document, window, key, tick, pose, snapshot, settled };
}

const limits = { offsetY: .034, horizontal: .025, roll: .038, pitch: .026, yaw: .0108 };
function bounded(sample) {
  for (const [key, value] of Object.entries(sample)) assert.ok(Number.isFinite(value), `${key} is finite`);
  for (const field of ['offsetY', 'roll', 'pitch', 'yaw']) assert.ok(Math.abs(sample[field]) <= limits[field] + 1e-12, `${field} stays within mount limit`);
  assert.ok(Math.hypot(sample.offsetX, sample.offsetZ) <= limits.horizontal, 'Mount never leaves its 25 mm horizontal envelope');
}

// Same real input schedule and real travelled path at three render rates.
// Compare every 1/30 s, including sprint transitions, mouse and stopping.
function sequence(hz) {
  const test = setup(), { controls, key, pose, snapshot } = test;
  pose();
  const motion = controls.bodycam, samples = [];
  for (let frame = 0; frame < 2 * hz; frame++) {
    if (frame === 0) key('KeyW');
    if (frame === .6 * hz) { key('ShiftLeft'); controls.diagnosticLook(48, -16); }
    if (frame === 1.2 * hz) { key('KeyW', false); key('KeyD'); }
    if (frame === 1.6 * hz) { key('KeyD', false); key('ShiftLeft', false); }
    controls.update(1 / hz);
    assert.equal(controls.bodycam, motion, 'Telemetry object is reused');
    const sample = snapshot(); bounded(sample);
    if ((frame + 1) % (hz / 30) === 0) samples.push(sample);
  }
  test.tick(1.5, hz); test.settled();
  controls.update(1 / hz); assert.equal(controls.changed, false, 'Idle frame becomes truly unchanged');
  controls.dispose(); return samples;
}
const rates = [30, 60, 120], runs = rates.map(sequence);
let maximumRateDifference = 0;
for (let run = 1; run < runs.length; run++) for (let sample = 0; sample < runs[0].length; sample++) {
  for (const field of Object.keys(runs[0][sample])) {
    const error = Math.abs(runs[run][sample][field] - runs[0][sample][field]);
    maximumRateDifference = Math.max(maximumRateDifference, error);
    assert.ok(error < 1e-9, `${field} agrees at ${rates[run]} and ${rates[0]} Hz`);
  }
}
assert.deepEqual(sequence(60), runs[1], 'Replay has no random camera drift');

// Contacts are distance events shared with the shadow, never key/time events.
{
  const test = setup([{ minX: -3, maxX: 3, minZ: 0, maxZ: .2 }]);
  const { controls, key, pose, tick } = test;
  pose([0, .43]); key('KeyW'); tick(2);
  const before = { phase: controls.gait.phase, count: controls.bodycam.stepCount };
  tick(3); test.settled();
  assert.equal(controls.gait.phase, before.phase, 'Phase stops at furniture');
  assert.equal(controls.bodycam.stepCount, before.count, 'Holding forward cannot repeat a foot contact');
  assert.ok(controls.position.z >= .42, 'Body stays outside furniture');
  pose(); key('KeyW'); tick(1.5);
  const distance = 2.4 - controls.position.z;
  assert.equal(controls.bodycam.stepCount, Math.floor(distance / (1.24 / 2)), 'Exactly two contacts per complete walked stride');
  assert.ok(Math.abs(controls.gait.phase - (distance / 1.24 * Math.PI * 2) % (Math.PI * 2)) < 1e-10);
  controls.dispose();
}

// Sprint has visibly more travel than walking. Acceleration and braking have
// opposite torso pitch, and a sidestep leans into its actual direction.
const amplitudes = {};
for (const running of [false, true]) {
  const test = setup(), { controls, key, pose, tick, snapshot } = test;
  pose(); key('KeyW'); if (running) key('ShiftLeft');
  const sampled = [];
  for (let frame = 0; frame < 216; frame++) { controls.update(1 / 120); const sample = snapshot(); bounded(sample); if (frame >= 60) sampled.push(sample); }
  amplitudes[running ? 'run' : 'walk'] = {
    verticalPeakToPeak: Math.max(...sampled.map(sample => sample.offsetY)) - Math.min(...sampled.map(sample => sample.offsetY)),
    rollPeakToPeak: Math.max(...sampled.map(sample => sample.roll)) - Math.min(...sampled.map(sample => sample.roll)),
  };
  pose(); key('KeyW'); tick(.1);
  assert.ok(controls.bodycam.accelerationZ < -1, 'Forward acceleration is derived from physical velocity');
  assert.ok(controls.bodycam.pitch < -.002, 'Mount tips forward while accelerating');
  tick(.5); key('KeyW', false); tick(.1);
  assert.ok(controls.bodycam.accelerationZ > 1, 'Braking has the opposite acceleration');
  assert.ok(controls.bodycam.pitch > .002, 'Mount rocks back during braking');
  pose(); key('KeyD'); tick(.1);
  assert.ok(controls.bodycam.accelerationX > 1 && controls.bodycam.roll < -.002, 'Sidestep leans right');
  controls.dispose();
}
assert.ok(amplitudes.walk.verticalPeakToPeak > .03, 'Walking has more than 3 cm of chest travel');
assert.ok(amplitudes.run.verticalPeakToPeak > amplitudes.walk.verticalPeakToPeak * 1.2, 'Sprint carries visibly more body movement');
assert.ok(amplitudes.walk.rollPeakToPeak > .018 && amplitudes.run.rollPeakToPeak > amplitudes.walk.rollPeakToPeak * 1.15);

// Mouse input remains direct; the short secondary movement cannot violate the
// floor/ceiling look limits or survive pause, blur, reset or a diagnostic pose.
{
  const test = setup(), { controls, camera, key, pose, tick, snapshot, settled } = test;
  pose([0, 1], 0, 0);
  const before = camera.quaternion.clone();
  assert.equal(controls.diagnosticLook(100, 0), true);
  assert.ok(Math.abs(controls.yaw + .22) < 1e-12, 'Yaw gets the complete mouse input immediately');
  assert.ok(camera.quaternion.angleTo(before) > .219, 'No low-pass lag on primary camera aim');
  const appliedYaw = controls.yaw;
  tick(.1); assert.equal(controls.yaw, appliedYaw);
  assert.ok(Math.abs(controls.bodycam.yaw) <= .006, 'Secondary mouse displacement remains bounded');
  tick(.65); settled();
  for (const dy of [-1e5, 1e5]) {
    controls.diagnosticLook(100, dy); tick(.05);
    const angles = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    assert.ok(angles.x >= -1.42 - 1e-12 && angles.x <= 1.15 + 1e-12, 'Final camera pitch, including secondary motion, is clamped');
  }
  key('KeyW'); key('ShiftLeft'); tick(.4); controls.diagnosticLook(200, 20);
  const pausedPosition = controls.position.clone(), pausedYaw = controls.yaw, pausedPitch = controls.pitch;
  controls.suspend(); settled();
  assert.ok(controls.position.equals(pausedPosition)); assert.equal(controls.yaw, pausedYaw); assert.equal(controls.pitch, pausedPitch);
  tick(1); assert.ok(controls.position.equals(pausedPosition), 'Pause clears held keys and momentum');
  key('KeyD'); tick(.2); emit(test.window, 'blur'); tick(.1); settled();
  key('KeyW'); tick(.2); test.document.hidden = true; emit(test.document, 'visibilitychange'); tick(.1); settled();
  pose(); assert.equal(controls.bodycam.stepCount, 0); settled();
  const valid = snapshot();
  for (const delta of [0, -1, NaN, Infinity]) { controls.update(delta); assert.deepEqual(snapshot(), valid, 'Invalid or empty frames cannot inject camera motion'); }
  assert.equal(controls.diagnosticLook(NaN, 0), false);
  controls.dispose();
}

console.log(JSON.stringify({ chestCameraHeight: 1.45, rates, maximumRateDifference,
  deterministicReplay: 'OK', contactByDistance: 'OK', noFootstepsAgainstFurniture: 'OK',
  accelerationBrakingStrafe: 'OK', immediateMouseAim: 'OK', finalPitchLimits: 'OK',
  pauseBlurVisibilityReset: 'OK', stationarySettles: 'OK', limits, amplitudes }));
