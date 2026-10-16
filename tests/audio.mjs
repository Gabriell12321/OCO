import assert from 'node:assert/strict';
import { generateRoomAudioPCM, createRoomAudio, ROOM_AUDIO_LIMITS } from '../dist/audio/room-audio.js';

const pcm = generateRoomAudioPCM();
const repeated = generateRoomAudioPCM();
const report = {};
for (const [name, signal] of [['rain', pcm.rain], ['glass', pcm.glass], ...pcm.flickers.map((value, index) => [`flicker${index}`, value])]) {
  let sum = 0, squares = 0, peak = 0;
  for (const value of signal) {
    assert(Number.isFinite(value), `${name}: finite PCM`);
    sum += value;
    squares += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  const rms = Math.sqrt(squares / signal.length);
  assert(peak < .5 && rms > .001, `${name}: original signal has audible energy and ample headroom`);
  assert(Math.abs(sum / signal.length) < .002, `${name}: negligible DC offset`);
  if (name === 'rain' || name === 'glass') {
    assert(Math.abs(signal[0] - signal.at(-1)) < .000001, `${name}: seamless sample endpoint`);
    assert.deepEqual(signal, repeated[name], `${name}: deterministic generation`);
  } else {
    assert.equal(signal[0], 0, `${name}: silent attack endpoint`);
    assert.equal(signal.at(-1), 0, `${name}: silent release endpoint`);
  }
  report[name] = { rms: Number(rms.toFixed(5)), peak: Number(peak.toFixed(5)), seconds: signal.length / pcm.sampleRate };
}
assert.throws(() => generateRoomAudioPCM(0), RangeError);

class Events {
  handlers = new Map();
  dataset = {};
  attributes = {};
  addEventListener(name, handler) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(handler);
  }
  removeEventListener(name, handler) { this.handlers.get(name)?.delete(handler); }
  emit(name, values = {}) { for (const handler of this.handlers.get(name) || []) handler({ isTrusted: false, ...values }); }
  setAttribute(name, value) { this.attributes[name] = value; }
  get listenerCount() { return [...this.handlers.values()].reduce((count, set) => count + set.size, 0); }
}
class Parameter {
  value = 0;
  changes = 0;
  cancelAndHoldAtTime() {}
  setValueAtTime(value) { this.value = value; this.changes++; }
  linearRampToValueAtTime(value) { this.value = value; this.changes++; }
}
class AudioNode {
  connections = new Set();
  connect(target) { this.connections.add(target); return target; }
  disconnect(target) { if (target) this.connections.delete(target); else this.connections.clear(); }
}
class FakeContext {
  static instances = [];
  currentTime = 0;
  state = 'suspended';
  destination = new AudioNode();
  listener = Object.fromEntries(['positionX', 'positionY', 'positionZ', 'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ'].map(name => [name, new Parameter()]));
  bufferCount = 0;
  sources = [];
  panners = [];
  analysers = [];
  closeCount = 0;
  constructor() { FakeContext.instances.push(this); }
  createGain() { return Object.assign(new AudioNode(), { gain: new Parameter() }); }
  createDynamicsCompressor() {
    return Object.assign(new AudioNode(), Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map(name => [name, new Parameter()])));
  }
  createPanner() {
    const panner = Object.assign(new AudioNode(), { positionX: new Parameter(), positionY: new Parameter(), positionZ: new Parameter() });
    this.panners.push(panner);
    return panner;
  }
  createBiquadFilter() { return Object.assign(new AudioNode(), { frequency: new Parameter(), Q: new Parameter() }); }
  createBuffer(channels, length, rate) {
    this.bufferCount++;
    assert.equal(channels, 1);
    return { duration: length / rate, copyToChannel: data => assert.equal(data.length, length) };
  }
  createBufferSource() {
    const source = Object.assign(new AudioNode(), {
      started: false, stopped: false,
      start() { this.started = true; },
      stop() { this.stopped = true; this.onended?.(); },
      finish() { this.onended?.(); }
    });
    this.sources.push(source);
    return source;
  }
  createAnalyser() {
    const analyser = Object.assign(new AudioNode(), {
      getFloatTimeDomainData(data) { for (let i = 0; i < data.length; i++) data[i] = Math.sin(i * .1) * .02; }
    });
    this.analysers.push(analyser);
    return analyser;
  }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  async close() { this.closeCount++; this.state = 'closed'; }
}

const originalGlobals = Object.fromEntries(['document', 'window', 'navigator', 'AudioContext'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const page = Object.assign(new Events(), { hidden: false, hasFocus: () => true });
const host = new Events(), canvas = new Events(), button = new Events();
const navigator = { userActivation: { isActive: false } };
const settle = () => new Promise(resolve => setTimeout(resolve, 65));
try {
  for (const [name, value] of Object.entries({ document: page, window: host, navigator, AudioContext: FakeContext })) Object.defineProperty(globalThis, name, { value, configurable: true });
  const audio = createRoomAudio({ canvas, button, windowPosition: [0, 2, -3], lampPosition: { x: 1, y: 1.4, z: -2 } });
  assert.equal(await audio.unlock(), false);
  canvas.emit('pointerdown');
  host.emit('keydown', { code: 'KeyW' });
  assert.equal(FakeContext.instances.length, 0, 'no context, buffers or sound before genuine user activation');
  assert.equal(audio.triggerFlicker(), false, 'lighting may run silently before unlock');

  navigator.userActivation.isActive = true;
  assert.equal(await audio.unlock(), true);
  navigator.userActivation.isActive = false;
  const context = FakeContext.instances[0];
  assert.equal(context.bufferCount, 5, 'generate two loops and three effect variants exactly once');
  assert.equal(context.sources.length, 2);
  assert.equal(audio.snapshot().playingSources, 2);
  assert.equal(button.attributes['aria-pressed'], 'true');
  assert.equal(context.panners[0].panningModel, 'equalpower');
  assert.equal(context.panners[0].positionZ.value, -3);
  assert.equal(context.panners[1].positionY.value, 1.4);

  const camera = { position: { x: 2, y: 1.7, z: -1 }, quaternion: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 } };
  audio.update(camera, .04);
  assert.equal(context.listener.positionY.value, 1.7);
  assert(Math.abs(context.listener.forwardX.value + 1) < 1e-12, 'listener follows camera forward in Three.js convention');
  assert(Math.abs(context.listener.forwardZ.value) < 1e-12);
  const listenerChanges = context.listener.positionX.changes;
  audio.update(camera, .04);
  assert.equal(context.listener.positionX.changes, listenerChanges, 'stationary listener schedules no automation');
  camera.position.x = 3;
  audio.update(camera, .001);
  assert.equal(context.listener.positionX.value, 2, 'listener is throttled');
  audio.update(camera, .04);
  assert.equal(context.listener.positionX.value, 3);

  for (let i = 0; i < 100; i++) { context.currentTime += .05; audio.triggerFlicker(1); }
  assert.equal(audio.snapshot().activeVoices, ROOM_AUDIO_LIMITS.voices, 'burst cannot exceed voice budget');
  assert.equal(context.sources.length, 2 + ROOM_AUDIO_LIMITS.voices);
  assert.equal(context.bufferCount, 5, 'flicker reuses pre-generated PCM');
  context.sources[2].finish();
  assert.equal(audio.snapshot().activeVoices, 3);
  context.currentTime += .05;
  assert.equal(audio.triggerFlicker(.4), true);
  assert.equal(audio.snapshot().flickerEventsPlayed, 5);
  assert.equal(audio.triggerFlicker(1), false, 'back-to-back cues are bounded');

  const sample = await audio.sample();
  assert(sample.rms > .01 && sample.peak < 1);
  assert.equal(context.analysers[0].connections.size, 0, 'diagnostic analyser is temporary');
  audio.setMuted(true);
  await settle();
  assert.equal(context.state, 'suspended', 'mute releases audio processing');
  assert.equal(audio.snapshot().activeVoices, 0, 'short effects cannot resume out of sync after muting');
  assert.equal(audio.snapshot().playingSources, 0);
  assert.equal(audio.snapshot().activeLoops, 2, 'muting retains the original loop sources');
  assert.equal((await audio.sample()).rms, 0);
  assert.equal(audio.triggerFlicker(), false, 'no delayed flicker events while silent');
  audio.setMuted(false);
  await settle();
  assert.equal(context.state, 'running');
  assert.equal(context.bufferCount, 5);

  audio.setPaused(true);
  await settle();
  assert.equal(context.state, 'suspended');
  audio.setPaused(false);
  await settle();
  audio.setPaused(true);
  audio.setPaused(false);
  await settle();
  assert.equal(context.state, 'running', 'quick resume cancels pending suspend');
  page.hidden = true;
  page.emit('visibilitychange');
  await settle();
  assert.equal(context.state, 'suspended', 'background tab cannot keep playing');
  page.hidden = false;
  page.emit('visibilitychange');
  await settle();
  assert.equal(context.state, 'running', 'return resumes only previously unlocked sound');
  host.emit('blur');
  await settle();
  assert.equal(context.state, 'suspended', 'unfocused game window is silent');
  host.emit('focus');
  await settle();
  assert.equal(context.state, 'running');

  button.emit('click');
  assert.equal(audio.snapshot().muted, false, 'synthetic click cannot change sound state');
  button.emit('click', { isTrusted: true });
  assert.equal(audio.snapshot().muted, true);
  await audio.dispose();
  await audio.dispose();
  assert.equal(context.closeCount, 1);
  assert.equal(audio.snapshot().activeVoices, 0);
  assert.equal(audio.snapshot().playingSources, 0);
  assert.equal(audio.snapshot().activeLoops, 0);
  assert.equal(audio.snapshot().bufferCount, 0);
  assert.equal(canvas.listenerCount + button.listenerCount + page.listenerCount + host.listenerCount, 0);
  assert.equal(button.attributes['aria-pressed'], 'false');
  assert.equal(await audio.unlock(), false);
} finally {
  for (const [name, descriptor] of Object.entries(originalGlobals)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
}
console.log(JSON.stringify({ audio: 'PASS', pcm: report, lifecycle: 'gesture, spatial listener, bounded voices, mute/pause/background/resume/dispose', loops: ROOM_AUDIO_LIMITS.loops, voiceLimit: ROOM_AUDIO_LIMITS.voices }));
