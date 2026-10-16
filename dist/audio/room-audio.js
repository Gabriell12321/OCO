// Original, deterministic room sound. No network assets, audio worklet or frame-time synthesis.
export const ROOM_AUDIO_LIMITS = Object.freeze({ loops: 2, voices: 4, sampleRate: 24000 });

function randomSequence(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function sealLoop(samples, sampleRate) {
  // Blend the end into the beginning; the final sample meets the first without a click.
  const count = Math.min(Math.round(sampleRate * .12), samples.length >> 1);
  for (let i = 0; i < count; i++) {
    const t = (i + 1) / count;
    const weight = t * t * (3 - 2 * t);
    const index = samples.length - count + i;
    samples[index] = samples[index] * (1 - weight) + samples[i] * weight;
  }
  const endpoint = samples[0];
  const delta = samples.at(-1) - endpoint;
  for (let i = 0; i < count; i++) samples[samples.length - count + i] -= delta * ((i + 1) / count) ** 2;
}

export function generateRoomAudioPCM(sampleRate = ROOM_AUDIO_LIMITS.sampleRate, seed = 801) {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new RangeError('Invalid audio sample rate');
  const random = randomSequence(seed);
  const rain = new Float32Array(Math.round(sampleRate * 8));
  let low = 0, middle = 0;
  for (let i = 0; i < rain.length; i++) {
    const white = random() * 2 - 1;
    low += .015 * (white - low);
    middle += .23 * (white - middle);
    const time = i / sampleRate;
    const gust = .82 + .1 * Math.sin(time * Math.PI / 4) + .08 * Math.sin(time * Math.PI / 2);
    rain[i] = (.3 * middle + .45 * low + .025 * white) * gust;
  }
  sealLoop(rain, sampleRate);

  const glass = new Float32Array(Math.round(sampleRate * 13));
  let hit = .17;
  while (hit < 12.8) {
    const start = Math.round(hit * sampleRate);
    const length = Math.round((.018 + random() * .055) * sampleRate);
    const pitch = 950 + random() * 1550;
    const amplitude = .07 + random() ** 2 * .13;
    let noise = 0;
    for (let j = 0; j < length && start + j < glass.length; j++) {
      const t = j / sampleRate;
      const attack = Math.min(1, j / (sampleRate * .0008));
      const decay = Math.exp(-t * (85 + pitch / 100));
      noise += .48 * (random() * 2 - 1 - noise);
      glass[start + j] += amplitude * attack * decay * (.62 * noise + .32 * Math.sin(2 * Math.PI * pitch * t));
    }
    hit += .055 + random() ** 1.7 * .28;
  }
  sealLoop(glass, sampleRate);

  const flickers = [0, 1, 2].map(variant => {
    const duration = .15 + variant * .032;
    const samples = new Float32Array(Math.round(sampleRate * duration));
    let noise = 0;
    for (let i = 0; i < samples.length; i++) {
      const t = i / sampleRate, progress = i / (samples.length - 1);
      noise += .62 * (random() * 2 - 1 - noise);
      const attack = Math.min(1, t / .0015);
      const release = Math.min(1, (duration - t) / .018);
      const crackle = Math.exp(-t * 105) + .31 * Math.exp(-Math.abs(t - .041 - variant * .009) * 175);
      const buzz = Math.sin(2 * Math.PI * 120 * t) * .075 + Math.sin(2 * Math.PI * 240 * t) * .035;
      samples[i] = attack * release * (noise * crackle * .42 + buzz * (1 - progress) ** 2);
    }
    samples[0] = samples[samples.length - 1] = 0;
    return samples;
  });
  return { sampleRate, rain, glass, flickers };
}

function point(position, fallback) {
  return Array.isArray(position) ? position : position ? [position.x, position.y, position.z] : fallback;
}

function ramp(parameter, value, time, duration = .04) {
  if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(time);
  else {
    parameter.cancelScheduledValues(time);
    parameter.setValueAtTime(parameter.value, time);
  }
  parameter.linearRampToValueAtTime(value, time + duration);
}

export function createRoomAudio({ canvas, button, windowPosition, lampPosition } = {}) {
  const page = globalThis.document;
  const host = globalThis.window;
  let context = null, master = null, compressor = null, windowPanner = null, lampPanner = null;
  let muted = false, paused = false, unlocked = false, disposed = false;
  let focused = page?.hasFocus?.() ?? true;
  let suspendTimer = null, meterPromise = null;
  let listenerElapsed = 1, lastFlicker = -Infinity, flickerNumber = 0;
  const lastListener = new Float64Array(7).fill(Infinity);
  let lastError = null, generatedBytes = 0;
  const loops = [], voices = new Set(), nodes = [], listeners = [];
  let buffers = null;
  const windowPoint = point(windowPosition, [.7, 1.8, -2.82]);
  const lampPoint = point(lampPosition, [.8, 1, -2.2]);

  const inBackground = () => Boolean(page?.hidden || !focused);
  const shouldPlay = () => unlocked && !muted && !paused && !inBackground() && !disposed;

  function updateButton() {
    if (!button) return;
    const active = unlocked && !muted;
    button.dataset.sound = active ? 'on' : 'off';
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', active ? 'Silenciar chuva e efeitos sonoros' : 'Ativar chuva e efeitos sonoros');
    button.title = active ? 'Silenciar som' : 'Ativar som';
  }

  function listen(target, type, handler, options) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  }

  function createPanner(position, rolloff) {
    const panner = context.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1.6;
    panner.maxDistance = 12;
    panner.rolloffFactor = rolloff;
    if (panner.positionX) {
      panner.positionX.value = position[0];
      panner.positionY.value = position[1];
      panner.positionZ.value = position[2];
    } else panner.setPosition(...position);
    panner.connect(compressor);
    nodes.push(panner);
    return panner;
  }

  function makeBuffer(samples, sampleRate) {
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    generatedBytes += samples.byteLength;
    return buffer;
  }

  function startLoop(buffer, gainValue, lowpassFrequency, destination) {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpassFrequency;
    filter.Q.value = .55;
    const gain = context.createGain();
    gain.gain.value = gainValue;
    source.connect(filter).connect(gain).connect(destination);
    loops.push(source);
    nodes.push(source, filter, gain);
    source.start();
  }

  function initialize() {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) { lastError = 'Web Audio indisponível'; return false; }
    context = new AudioContextClass({ latencyHint: 'interactive' });
    master = context.createGain();
    master.gain.value = 0;
    compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -19;
    compressor.knee.value = 18;
    compressor.ratio.value = 4;
    compressor.attack.value = .003;
    compressor.release.value = .18;
    compressor.connect(master).connect(context.destination);
    nodes.push(compressor, master);
    windowPanner = createPanner(windowPoint, .32);
    lampPanner = createPanner(lampPoint, .4);
    const pcm = generateRoomAudioPCM();
    buffers = {
      rain: makeBuffer(pcm.rain, pcm.sampleRate),
      glass: makeBuffer(pcm.glass, pcm.sampleRate),
      flickers: pcm.flickers.map(samples => makeBuffer(samples, pcm.sampleRate))
    };
    startLoop(buffers.rain, 1.22, 1750, windowPanner);
    startLoop(buffers.glass, .9, 3400, windowPanner);
    return true;
  }

  async function synchronize() {
    if (!context || disposed) return false;
    if (suspendTimer !== null) clearTimeout(suspendTimer);
    suspendTimer = null;
    if (shouldPlay()) {
      try {
        if (context.state !== 'running') await context.resume();
        if (shouldPlay() && context.state === 'running') {
          ramp(master.gain, .72, context.currentTime, .07);
          return true;
        }
      } catch (error) { lastError = error?.name || 'AudioResumeError'; }
    }
    if (context.state === 'running') {
      // Do not resume an old electrical crackle after the window regains focus.
      for (const voice of voices) {
        if (voice.stopping) continue;
        voice.stopping = true;
        ramp(voice.gain.gain, 0, context.currentTime, .012);
        voice.source.stop(context.currentTime + .014);
      }
      ramp(master.gain, 0, context.currentTime, .035);
      suspendTimer = setTimeout(() => {
        suspendTimer = null;
        if (!shouldPlay() && context?.state === 'running') context.suspend().catch(error => { lastError = error?.name || 'AudioSuspendError'; });
      }, 50);
    }
    return false;
  }

  async function unlock(event) {
    if (disposed || inBackground()) return false;
    // Public callers also need a live user activation. A synthetic event cannot unlock sound.
    const gesture = event?.isTrusted === true || globalThis.navigator?.userActivation?.isActive === true;
    if (!unlocked && !gesture) return false;
    try {
      if (!context && !initialize()) { updateButton(); return false; }
      unlocked = true;
      updateButton();
      return await synchronize();
    } catch (error) {
      lastError = error?.name || 'AudioInitializationError';
      return false;
    }
  }

  function setMuted(value) {
    muted = Boolean(value);
    updateButton();
    void synchronize();
    return muted;
  }

  function setPaused(value) {
    paused = Boolean(value);
    void synchronize();
    return paused;
  }

  function triggerFlicker(strength = 1) {
    if (!context || context.state !== 'running' || !shouldPlay()) return false;
    const amount = Math.max(0, Math.min(1, Number(strength) || 0));
    const time = context.currentTime;
    if (amount <= 0 || time - lastFlicker < .038 || voices.size >= ROOM_AUDIO_LIMITS.voices) return false;
    lastFlicker = time;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffers.flickers[flickerNumber++ % buffers.flickers.length];
    gain.gain.setValueAtTime(.19 + amount * .43, time);
    source.connect(gain).connect(lampPanner);
    const voice = { source, gain };
    voices.add(voice);
    source.onended = () => {
      voices.delete(voice);
      source.disconnect();
      gain.disconnect();
    };
    source.start(time);
    return true;
  }

  function update(camera, dt = 0) {
    if (!context || context.state !== 'running' || !shouldPlay() || !camera) return;
    listenerElapsed += Math.max(0, Number(dt) || 0);
    if (listenerElapsed < 1 / 30) return;
    listenerElapsed = 0;
    // The room camera is unparented. Quaternion basis avoids importing Three.js or allocating vectors.
    const p = camera.position, q = camera.quaternion;
    if (!p || !q) return;
    if (Math.abs(lastListener[0] - p.x) + Math.abs(lastListener[1] - p.y) + Math.abs(lastListener[2] - p.z)
      + Math.abs(lastListener[3] - q.x) + Math.abs(lastListener[4] - q.y)
      + Math.abs(lastListener[5] - q.z) + Math.abs(lastListener[6] - q.w) < .00001) return;
    lastListener[0] = p.x; lastListener[1] = p.y; lastListener[2] = p.z;
    lastListener[3] = q.x; lastListener[4] = q.y; lastListener[5] = q.z; lastListener[6] = q.w;
    const fx = -2 * (q.x * q.z + q.w * q.y);
    const fy = -2 * (q.y * q.z - q.w * q.x);
    const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const ux = 2 * (q.x * q.y - q.w * q.z);
    const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
    const uz = 2 * (q.y * q.z + q.w * q.x);
    const listener = context.listener, time = context.currentTime;
    if (listener.positionX) {
      ramp(listener.positionX, p.x, time, .035);
      ramp(listener.positionY, p.y, time, .035);
      ramp(listener.positionZ, p.z, time, .035);
      ramp(listener.forwardX, fx, time, .035);
      ramp(listener.forwardY, fy, time, .035);
      ramp(listener.forwardZ, fz, time, .035);
      ramp(listener.upX, ux, time, .035);
      ramp(listener.upY, uy, time, .035);
      ramp(listener.upZ, uz, time, .035);
    } else {
      listener.setPosition(p.x, p.y, p.z);
      listener.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  async function sample() {
    if (meterPromise) return meterPromise;
    if (!context || context.state !== 'running' || disposed) return { rms: 0, peak: 0, channels: 1, durationMs: 0, contextState: context?.state || 'locked' };
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    const signal = new Float32Array(analyser.fftSize);
    master.connect(analyser);
    meterPromise = (async () => {
      let squareSum = 0, peak = 0, samples = 0;
      for (let frame = 0; frame < 6 && !disposed; frame++) {
        await new Promise(resolve => setTimeout(resolve, 35));
        analyser.getFloatTimeDomainData(signal);
        for (const value of signal) { squareSum += value * value; peak = Math.max(peak, Math.abs(value)); }
        samples += signal.length;
      }
      try { master.disconnect(analyser); } catch { /* Disposed while measuring. */ }
      analyser.disconnect();
      return { rms: samples ? Math.sqrt(squareSum / samples) : 0, peak, channels: 1, durationMs: 210, contextState: context?.state || 'closed' };
    })();
    try { return await meterPromise; } finally { meterPromise = null; }
  }

  function snapshot() {
    return {
      initialized: Boolean(context), unlocked, contextState: context?.state || 'locked',
      contextTime: context?.currentTime || 0, baseLatency: context?.baseLatency || 0,
      outputLatency: context?.outputLatency || 0,
      muted, paused, background: inBackground(), disposed,
      activeLoops: disposed ? 0 : loops.length, activeVoices: voices.size,
      playingSources: context?.state === 'running' && shouldPlay() ? loops.length + voices.size : 0,
      voiceLimit: ROOM_AUDIO_LIMITS.voices, bufferCount: buffers ? 5 : 0,
      generatedBytes, flickerEventsPlayed: flickerNumber, masterGain: master?.gain.value || 0, lastError
    };
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    unlocked = false;
    for (const remove of listeners) remove();
    listeners.length = 0;
    clearTimeout(suspendTimer);
    suspendTimer = null;
    for (const source of loops) { try { source.stop(); } catch { /* Already stopped. */ } }
    for (const voice of voices) {
      voice.source.onended = null;
      try { voice.source.stop(); } catch { /* Already stopped. */ }
      voice.source.disconnect();
      voice.gain.disconnect();
    }
    voices.clear();
    for (const node of nodes) node.disconnect();
    buffers = null;
    if (context && context.state !== 'closed') await context.close();
    updateButton();
  }

  listen(canvas, 'pointerdown', event => { void unlock(event); }, { passive: true });
  listen(host, 'keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || !/^(Key[WASD]|Arrow(Up|Down|Left|Right))$/.test(event.code)) return;
    void unlock(event);
  });
  listen(button, 'click', event => {
    if (!event.isTrusted) return;
    if (!unlocked) { setMuted(false); void unlock(event); }
    else setMuted(!muted);
  });
  listen(page, 'visibilitychange', () => { void synchronize(); });
  listen(host, 'blur', () => { focused = false; void synchronize(); });
  listen(host, 'focus', () => { focused = true; void synchronize(); });
  updateButton();
  return { unlock, update, triggerFlicker, setMuted, setPaused, snapshot, sample, dispose };
}
