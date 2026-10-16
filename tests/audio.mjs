import assert from 'node:assert/strict';
import { generateRoomAudioPCM, createSeamlessLoop, findThunderRange, createRoomAudio, ROOM_AUDIO_LIMITS } from '../dist/audio/room-audio.js';

const pcm = generateRoomAudioPCM();
const repeated = generateRoomAudioPCM();
const report = {};
for (const [name, signal] of [['rain', pcm.rain], ['glass', pcm.glass], ['thunder', pcm.thunder], ...pcm.flickers.map((value, index) => [`flicker${index}`, value])]) {
  let sum = 0, squares = 0, peak = 0;
  for (const value of signal) {
    assert(Number.isFinite(value), `${name}: finite PCM`);
    sum += value;
    squares += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  const rms = Math.sqrt(squares / signal.length);
  assert(peak < .7 && rms > .001, `${name}: original signal has audible energy and ample headroom`);
  assert(Math.abs(sum / signal.length) < .002, `${name}: negligible DC offset`);
  if (name === 'rain' || name === 'glass') {
    assert.deepEqual(signal, repeated[name], `${name}: deterministic generation`);
  } else {
    assert.equal(signal[0], 0, `${name}: silent attack endpoint`);
    assert.equal(signal.at(-1), 0, `${name}: silent release endpoint`);
  }
  report[name] = { rms: Number(rms.toFixed(5)), peak: Number(peak.toFixed(5)), seconds: signal.length / pcm.sampleRate };
}
assert.throws(() => generateRoomAudioPCM(0), RangeError);
const loopInput = new Float32Array(24000 * 3);
let seed = 42;
for (let i = 0; i < loopInput.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; loopInput[i] = (seed / 4294967296 - .5) * .2; }
const loopOutput = createSeamlessLoop(loopInput, 24000), overlap = 14400;
assert.equal(loopOutput.length, loopInput.length - overlap);
assert.equal(loopOutput[0], loopInput[loopInput.length - overlap], 'wrap begins at the original sample after its last sample');
assert.equal(loopOutput.at(-1), loopInput[loopInput.length - overlap - 1], 'wrap preserves original noise continuity');
assert.equal(loopOutput[overlap - 1], loopInput[overlap - 1], 'crossfade reaches the original head without a DC correction');
assert.equal(loopOutput[overlap], loopInput[overlap], 'end of crossfade joins adjacent original samples');
const statistics = signal => ({ mean: signal.reduce((sum, value) => sum + value, 0) / signal.length,
  rms: Math.sqrt(signal.reduce((sum, value) => sum + value * value, 0) / signal.length) });
const mixed = statistics(loopOutput.subarray(0, overlap)), original = statistics(loopInput);
assert(Math.abs(mixed.mean) < .002, 'crossfade does not introduce a slow DC thump');
assert(mixed.rms / original.rms > .93 && mixed.rms / original.rms < 1.07, 'equal-power overlap preserves noise energy');
assert(pcm.thunder.length / pcm.sampleRate >= 4 && pcm.thunder.length / pcm.sampleRate <= 7, 'rolling thunder lasts four to seven seconds');
const energy = (signal, start, end) => signal.subarray(Math.round(start * pcm.sampleRate), Math.round(end * pcm.sampleRate)).reduce((sum, value) => sum + value * value, 0);
assert(energy(pcm.thunder, .02, .12) > .05, 'thunder begins with the flash, without a deliberately silent lead-in');
assert(energy(pcm.thunder, 3, 5) > .1, 'thunder retains an audible rolling tail');
let lowThunder = 0, lowEnergy = 0, fullEnergy = 0;
for (const value of pcm.thunder) { lowThunder += .05 * (value - lowThunder); lowEnergy += lowThunder ** 2; fullEnergy += value ** 2; }
assert(lowEnergy / fullEnergy > .5, 'thunder is dominated by low-frequency rumble');
const delayedThunder = new Float32Array(pcm.thunder.length + pcm.sampleRate);
delayedThunder.set(pcm.thunder, pcm.sampleRate);
const range = findThunderRange([delayedThunder], pcm.sampleRate);
assert(range.start >= pcm.sampleRate * .99 && range.start < pcm.sampleRate * 1.05, 'asset onset detection preserves at most ten milliseconds of silent lead-in');
assert(range.onset - range.start <= pcm.sampleRate * .011, 'trim retains no more than one frame before audible onset');
assert((range.end - range.start) / pcm.sampleRate <= 7, 'asset thunder has a bounded tail');
const lateThunder = new Float32Array(pcm.sampleRate * 5);
lateThunder.set(pcm.thunder.subarray(0, pcm.sampleRate), pcm.sampleRate * 4);
const lateRange = findThunderRange([lateThunder], pcm.sampleRate);
assert(lateRange.start >= pcm.sampleRate * 3.99, 'late onset cannot pull seconds of silence back into the trimmed recording');

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
  static decodeFails = false;
  static decodeGate = null;
  static stallScheduledStop = false;
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
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { duration: length / rate, length, sampleRate: rate, numberOfChannels: channels,
      copyToChannel: (signal, channel) => data[channel].set(signal), getChannelData: channel => data[channel] };
  }
  async decodeAudioData(bytes) {
    if (FakeContext.decodeGate) await FakeContext.decodeGate;
    if (FakeContext.decodeFails) throw new Error('Decode failure');
    const thunder = new Uint8Array(bytes)[0] === 2;
    const signal = thunder ? delayedThunder : pcm.rain;
    const buffer = this.createBuffer(1, signal.length, pcm.sampleRate);
    buffer.copyToChannel(signal, 0);
    return buffer;
  }
  createBufferSource() {
    const source = Object.assign(new AudioNode(), {
      started: false, stopped: false,
      start() { this.started = true; },
      stop(time) { this.stopped = true; if (!FakeContext.stallScheduledStop || time === undefined) this.onended?.(); },
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

const originalGlobals = Object.fromEntries(['document', 'window', 'navigator', 'AudioContext', 'fetch'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
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
  assert.equal(context.bufferCount, 6, 'generate two loops, three electrical effects and thunder exactly once');
  assert.equal(context.sources.length, 2);
  assert.equal(audio.snapshot().playingSources, 2);
  assert(audio.snapshot().thunderAttackRms > .01 && audio.snapshot().thunderAttackPeak > .05, 'fallback exposes real thunder attack energy');
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
  assert.equal(context.bufferCount, 6, 'flicker reuses pre-generated PCM');
  context.sources[2].finish();
  assert.equal(audio.snapshot().activeVoices, 3);
  context.currentTime += .05;
  assert.equal(audio.triggerFlicker(.4), true);
  assert.equal(audio.snapshot().flickerEventsPlayed, 5);
  assert.equal(audio.triggerFlicker(1), false, 'back-to-back cues are bounded');
  assert.equal(audio.triggerThunder(1), true);
  const thunderSource = context.sources.at(-1);
  assert.equal(audio.snapshot().activeThunder, 1);
  assert.equal(audio.snapshot().thunderEventsPlayed, 1);
  assert.equal(audio.snapshot().playingSources, 7, 'two loops, four electrical voices and one thunder are bounded independently');
  for (let i = 0; i < 100; i++) assert.equal(audio.triggerThunder(1), false, 'thunder cannot accumulate voices');
  assert.equal(audio.snapshot().thunderEventsPlayed, 1);

  const sample = await audio.sample();
  assert(sample.rms > .01 && sample.peak < 1);
  assert.equal(context.analysers[0].connections.size, 0, 'diagnostic analyser is temporary');
  audio.setMuted(true);
  await settle();
  assert.equal(context.state, 'suspended', 'mute releases audio processing');
  assert.equal(audio.snapshot().activeVoices, 0, 'short effects cannot resume out of sync after muting');
  assert.equal(audio.snapshot().activeThunder, 0, 'muting cancels thunder rather than freezing a stale strike');
  assert(thunderSource.stopped);
  assert.equal(audio.snapshot().playingSources, 0);
  assert.equal(audio.snapshot().activeLoops, 2, 'muting retains the original loop sources');
  assert.equal((await audio.sample()).rms, 0);
  assert.equal(audio.triggerFlicker(), false, 'no delayed flicker events while silent');
  audio.setMuted(false);
  await settle();
  assert.equal(context.state, 'running');
  assert.equal(context.bufferCount, 6);
  assert.equal(audio.snapshot().activeThunder, 0, 'unmuting never restarts the old thunder');
  assert.equal(audio.triggerThunder(.6), true);

  audio.setPaused(true);
  await settle();
  assert.equal(context.state, 'suspended');
  assert.equal(audio.snapshot().activeThunder, 0, 'pausing cancels active thunder');
  audio.setPaused(false);
  await settle();
  audio.setPaused(true);
  audio.setPaused(false);
  await settle();
  assert.equal(context.state, 'running', 'quick resume cancels pending suspend');
  assert.equal(audio.triggerThunder(.6), true);
  page.hidden = true;
  page.emit('visibilitychange');
  await settle();
  assert.equal(context.state, 'suspended', 'background tab cannot keep playing');
  assert.equal(audio.snapshot().activeThunder, 0);
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

  let fetches = 0;
  globalThis.fetch = async url => {
    fetches++;
    return { ok: true, arrayBuffer: async () => new Uint8Array([url.includes('thunder') ? 2 : 1]).buffer };
  };
  const recorded = createRoomAudio({ canvas, button, rainUrl: './rain.mp3', thunderUrl: './thunder.mp3' });
  assert.deepEqual(await recorded.preload(), { rain: true, thunder: true });
  await recorded.preload();
  assert.equal(fetches, 2, 'preloading requests each local file once');
  assert.equal(FakeContext.instances.length, 1, 'preloading encoded assets creates no audio context');
  assert.equal(recorded.snapshot().unlocked, false);
  navigator.userActivation.isActive = true;
  assert.equal(await recorded.unlock(), true);
  navigator.userActivation.isActive = false;
  assert.equal(recorded.snapshot().rainSource, 'local-recording');
  assert.equal(recorded.snapshot().thunderSource, 'local-recording');
  assert.equal(recorded.snapshot().activeLoops, 2);
  assert(recorded.snapshot().decodedBytes > 0);
  assert(recorded.snapshot().thunderTrimStart >= .99 && recorded.snapshot().thunderTrimStart < 1.05);
  assert(recorded.snapshot().thunderDuration <= 7);
  assert(recorded.snapshot().thunderAttackRms > .01 && recorded.snapshot().thunderAttackPeak > .05, 'recorded thunder metrics measure its own buffer after trim');
  assert(recorded.snapshot().rainDuration < pcm.rain.length / pcm.sampleRate, 'recording loop removes the overlap instead of inserting a DC ramp');
  assert.equal(recorded.triggerThunder(), true);
  FakeContext.stallScheduledStop = true;
  recorded.setPaused(true);
  await settle();
  assert.equal(recorded.snapshot().activeThunder, 0, 'cancellation finishes even when the audio clock stalls before the scheduled stop');
  FakeContext.stallScheduledStop = false;
  await recorded.dispose();

  FakeContext.decodeFails = true;
  const offline = createRoomAudio({ canvas, rainUrl: './broken.mp3', thunderUrl: './broken-thunder.mp3' });
  await offline.preload();
  navigator.userActivation.isActive = true;
  assert.equal(await offline.unlock(), true, 'bad recording does not prevent the original offline fallback');
  navigator.userActivation.isActive = false;
  assert.equal(offline.snapshot().rainSource, 'procedural-fallback');
  assert.equal(offline.snapshot().thunderSource, 'procedural-fallback');
  assert.equal(offline.snapshot().activeLoops, 2);
  assert.equal(offline.snapshot().thunderDuration, 6.2);
  assert.equal(offline.triggerThunder(), true);
  assert.deepEqual(Object.keys(offline.snapshot().assetErrors).sort(), ['rain', 'thunder']);
  await offline.dispose();

  FakeContext.decodeFails = false;
  let releaseDecode;
  FakeContext.decodeGate = new Promise(resolve => { releaseDecode = resolve; });
  const pending = createRoomAudio({ canvas, rainUrl: './rain.mp3', thunderUrl: './thunder.mp3' });
  await pending.preload();
  navigator.userActivation.isActive = true;
  const pendingUnlock = pending.unlock();
  navigator.userActivation.isActive = false;
  await new Promise(resolve => setTimeout(resolve, 0));
  const pendingContext = FakeContext.instances.at(-1);
  await pending.dispose();
  releaseDecode();
  assert.equal(await pendingUnlock, false, 'dispose during asynchronous decoding cannot reactivate sound');
  assert.equal(pendingContext.state, 'closed');
  assert.equal(pendingContext.sources.length, 0, 'a late decoder result creates no playback sources after disposal');
  assert.equal(pending.snapshot().activeLoops, 0);
  FakeContext.decodeGate = null;
} finally {
  for (const [name, descriptor] of Object.entries(originalGlobals)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
}
console.log(JSON.stringify({ audio: 'PASS', pcm: report, lifecycle: 'gesture, spatial listener, bounded voices, mute/pause/background/resume/dispose', loops: ROOM_AUDIO_LIMITS.loops, voiceLimit: ROOM_AUDIO_LIMITS.voices }));
