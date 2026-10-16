// Local recordings with an original deterministic fallback. No frame-time synthesis.
export const ROOM_AUDIO_LIMITS = Object.freeze({ loops: 2, voices: 4, thunder: 1, sampleRate: 24000 });

function randomSequence(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export function createSeamlessLoop(samples, sampleRate, blendSeconds = .6) {
  // Fold the tail into the beginning and shorten the cycle by the overlap.
  // The wrap then crosses two ORIGINAL adjacent samples, without a DC ramp.
  const count = Math.min(Math.round(sampleRate * blendSeconds), samples.length >> 1);
  if (count < 2) return samples.slice();
  const output = new Float32Array(samples.length - count);
  for (let i = 0; i < count; i++) {
    const angle = i / (count - 1) * Math.PI * .5;
    output[i] = samples[samples.length - count + i] * Math.cos(angle) + samples[i] * Math.sin(angle);
  }
  output.set(samples.subarray(count, samples.length - count), count);
  return output;
}

export function generateRoomAudioPCM(sampleRate = ROOM_AUDIO_LIMITS.sampleRate, seed = 801) {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new RangeError('Invalid audio sample rate');
  const random = randomSequence(seed);
  let rain = new Float32Array(Math.round(sampleRate * 24));
  let low = 0, middle = 0;
  let gust = .85, gustTarget = .85, nextGust = 0;
  for (let i = 0; i < rain.length; i++) {
    const white = random() * 2 - 1;
    low += .015 * (white - low);
    middle += .23 * (white - middle);
    if (i >= nextGust) { gustTarget = .64 + random() * .3; nextGust = i + Math.round(sampleRate * (.7 + random() * 2.4)); }
    gust += (gustTarget - gust) / (sampleRate * .65);
    rain[i] = (.3 * middle + .45 * low + .025 * white) * gust;
  }
  rain = createSeamlessLoop(rain, sampleRate);

  let glass = new Float32Array(Math.round(sampleRate * 29));
  let hit = .17;
  while (hit < 28.7) {
    const start = Math.round(hit * sampleRate);
    const length = Math.round((.035 + random() * .075) * sampleRate);
    const amplitude = .045 + random() ** 2 * .105;
    const decayRate = 45 + random() * 75;
    let noise = 0, slow = 0;
    for (let j = 0; j < length && start + j < glass.length; j++) {
      const t = j / sampleRate;
      const attack = Math.min(1, j / (sampleRate * .0015));
      const decay = Math.exp(-t * decayRate) * Math.min(1, (length - j) / (sampleRate * .008));
      noise += .42 * (random() * 2 - 1 - noise);
      slow += .045 * (noise - slow);
      // A short, broad splash; no pitched sinusoid or repeated metallic ping.
      glass[start + j] += amplitude * attack * decay * (noise - slow * .35);
    }
    hit += .075 + random() ** 1.7 * .39;
  }
  glass = createSeamlessLoop(glass, sampleRate);

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
  const thunder = new Float32Array(Math.round(sampleRate * 6.2));
  const rolls = Array.from({ length: 5 }, (_, i) => ({
    time: .22 + i * .85 + random() * .5, width: .24 + random() * .38, strength: .2 + random() * .32
  }));
  let sub = 0, rumble = 0, crack = 0, peak = 0;
  const subCoefficient = 1 - Math.exp(-2 * Math.PI * 58 / sampleRate);
  const rumbleCoefficient = 1 - Math.exp(-2 * Math.PI * 210 / sampleRate);
  const crackCoefficient = 1 - Math.exp(-2 * Math.PI * 1150 / sampleRate);
  for (let i = 0; i < thunder.length; i++) {
    const t = i / sampleRate, white = random() * 2 - 1;
    sub += subCoefficient * (white - sub);
    rumble += rumbleCoefficient * (white - rumble);
    crack += crackCoefficient * (white - crack);
    let envelope = .85 * Math.exp(-t / 1.65);
    for (const roll of rolls) envelope += roll.strength * Math.exp(-(((t - roll.time) / roll.width) ** 2));
    const attack = Math.min(1, t / .028), release = Math.min(1, (6.2 - t) / .9);
    thunder[i] = attack * release * envelope * (sub * 2.1 + rumble * .85 + crack * .32 * Math.exp(-t / .4));
    peak = Math.max(peak, Math.abs(thunder[i]));
  }
  for (let i = 0; i < thunder.length; i++) thunder[i] *= .64 / Math.max(peak, .001);
  thunder[0] = thunder[thunder.length - 1] = 0;
  return { sampleRate, rain, glass, flickers, thunder };
}

export function findThunderRange(channels, sampleRate) {
  const length = channels[0]?.length || 0, hop = Math.max(1, Math.round(sampleRate * .01));
  const energies = new Float32Array(Math.ceil(length / hop));
  let maximum = 0;
  for (let frame = 0; frame < energies.length; frame++) {
    const start = frame * hop, end = Math.min(length, start + hop);
    let sum = 0;
    for (const signal of channels) for (let i = start; i < end; i++) sum += signal[i] ** 2;
    energies[frame] = Math.sqrt(sum / ((end - start) * channels.length));
    maximum = Math.max(maximum, energies[frame]);
  }
  const threshold = Math.max(.0015, maximum * .1);
  const onset = Math.max(0, energies.findIndex(value => value >= threshold)) * hop;
  const start = Math.max(0, onset - hop);
  return { start, end: Math.min(length, start + Math.round(sampleRate * 7)), onset,
    threshold, peakWindowRms: maximum };
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

export function createRoomAudio({ canvas, button, windowPosition, lampPosition, rainUrl = null, thunderUrl = null } = {}) {
  const page = globalThis.document;
  const host = globalThis.window;
  let context = null, master = null, compressor = null, windowPanner = null, lampPanner = null;
  let muted = false, paused = false, unlocked = false, disposed = false;
  let focused = page?.hasFocus?.() ?? true;
  let suspendTimer = null, meterPromise = null;
  let listenerElapsed = 1, lastFlicker = -Infinity, flickerNumber = 0;
  let thunderNumber = 0, activeThunder = null, thunderFilter = null;
  let preloadPromise = null, playbackPromise = null, decodedBytes = 0;
  let thunderTrimStart = 0, thunderDetectedOnset = 0, thunderAssetDuration = 0;
  let thunderAttackRms = 0, thunderAttackPeak = 0;
  const encoded = { rain: null, thunder: null };
  const assetSources = { rain: 'procedural-fallback', thunder: 'procedural-fallback' };
  const assetErrors = {};
  const lastListener = new Float64Array(7).fill(Infinity);
  let lastError = null, generatedBytes = 0;
  const loops = [], voices = new Set(), nodes = [], listeners = [];
  let buffers = null;
  const windowPoint = point(windowPosition, [.7, 1.8, -2.82]);
  const lampPoint = point(lampPosition, [.8, 1, -2.2]);

  const inBackground = () => Boolean(page?.hidden || !focused);
  const shouldPlay = () => unlocked && !muted && !paused && !inBackground() && !disposed;

  function preload() {
    if (preloadPromise) return preloadPromise;
    preloadPromise = Promise.all(['rain', 'thunder'].map(async kind => {
      const url = kind === 'rain' ? rainUrl : thunderUrl;
      if (!url || disposed) return false;
      const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 4000);
      try {
        const response = await fetch(url, { signal: abort.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        if (!bytes.byteLength || bytes.byteLength > 12 * 1024 * 1024) throw new Error('Invalid audio asset size');
        if (disposed) return false;
        encoded[kind] = bytes;
        return true;
      } catch (error) {
        assetErrors[kind] = error?.name || 'AudioAssetError';
        return false;
      } finally { clearTimeout(timeout); }
    })).then(([rain, thunder]) => ({ rain, thunder }));
    return preloadPromise;
  }

  function updateButton() {
    if (!button) return;
    const active = unlocked && !muted;
    button.dataset.sound = active ? 'on' : 'off';
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', active ? 'Silenciar chuva, trovões e efeitos sonoros' : 'Ativar chuva, trovões e efeitos sonoros');
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
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(destination);
    loops.push(source);
    nodes.push(source, filter, gain);
    source.start();
    ramp(gain.gain, gainValue, context.currentTime, .25);
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
    thunderFilter = context.createBiquadFilter();
    thunderFilter.type = 'lowpass'; thunderFilter.frequency.value = 1900; thunderFilter.Q.value = .55;
    thunderFilter.connect(windowPanner); nodes.push(thunderFilter);
    const pcm = generateRoomAudioPCM();
    buffers = {
      rain: makeBuffer(pcm.rain, pcm.sampleRate),
      glass: makeBuffer(pcm.glass, pcm.sampleRate),
      flickers: pcm.flickers.map(samples => makeBuffer(samples, pcm.sampleRate)),
      thunder: makeBuffer(pcm.thunder, pcm.sampleRate)
    };
    return true;
  }

  async function preparePlayback() {
    await preload();
    for (const kind of ['rain', 'thunder']) {
      if (!encoded[kind] || disposed) continue;
      try {
        let buffer = await context.decodeAudioData(encoded[kind]);
        if (disposed) return;
        if (!Number.isFinite(buffer.duration) || buffer.duration < 1 || buffer.duration > 90 || buffer.numberOfChannels > 2) throw new Error('Invalid decoded audio');
        if (kind === 'thunder') {
          thunderAssetDuration = buffer.duration;
          const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
          const range = findThunderRange(channels, buffer.sampleRate);
          thunderTrimStart = range.start / buffer.sampleRate;
          thunderDetectedOnset = range.onset / buffer.sampleRate;
          if ((range.end - range.start) / buffer.sampleRate < 1) throw new Error('Thunder recording has no usable tail');
          const trimmed = context.createBuffer(buffer.numberOfChannels, range.end - range.start, buffer.sampleRate);
          channels.forEach((signal, channel) => trimmed.copyToChannel(signal.subarray(range.start, range.end), channel));
          buffer = trimmed;
        }
        // Normalize the recording conservatively while preserving its natural dynamics.
        let squares = 0, peak = 0;
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const signal = buffer.getChannelData(channel);
          let sum = 0;
          for (const value of signal) { if (!Number.isFinite(value)) throw new Error('Invalid audio sample'); sum += value; }
          const mean = sum / signal.length;
          for (let i = 0; i < signal.length; i++) {
            signal[i] -= mean; squares += signal[i] ** 2; peak = Math.max(peak, Math.abs(signal[i]));
          }
        }
        const rms = Math.sqrt(squares / (buffer.length * buffer.numberOfChannels));
        if (rms < .00001) throw new Error('Silent audio asset');
        const gain = Math.min((kind === 'rain' ? .075 : .12) / rms, .7 / Math.max(peak, .001), 4);
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const signal = buffer.getChannelData(channel);
          for (let i = 0; i < signal.length; i++) signal[i] *= gain;
          if (kind === 'thunder') {
            const attack = Math.round(buffer.sampleRate * .012), release = Math.round(buffer.sampleRate * .25);
            for (let i = 0; i < attack; i++) signal[i] *= i / attack;
            for (let i = 0; i < release; i++) signal[signal.length - 1 - i] *= i / release;
          }
        }
        if (kind === 'rain') {
          const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => createSeamlessLoop(buffer.getChannelData(channel), buffer.sampleRate));
          const loop = context.createBuffer(buffer.numberOfChannels, channels[0].length, buffer.sampleRate);
          channels.forEach((signal, channel) => loop.copyToChannel(signal, channel));
          buffer = loop;
        }
        buffers[kind] = buffer;
        decodedBytes += buffer.length * buffer.numberOfChannels * 4;
        assetSources[kind] = 'local-recording';
      } catch (error) { assetErrors[kind] = error?.name || 'AudioDecodeError'; }
      encoded[kind] = null;
    }
    if (disposed) return;
    const thunder = buffers.thunder;
    const count = Math.min(thunder.length, Math.round(thunder.sampleRate * .2));
    let sum = 0, peak = 0;
    for (let channel = 0; channel < thunder.numberOfChannels; channel++) {
      const signal = thunder.getChannelData(channel);
      for (let i = 0; i < count; i++) { sum += signal[i] ** 2; peak = Math.max(peak, Math.abs(signal[i])); }
    }
    thunderAttackRms = Math.sqrt(sum / (count * thunder.numberOfChannels));
    thunderAttackPeak = peak;
    startLoop(buffers.rain, 1.08, 2250, windowPanner);
    startLoop(buffers.glass, .6, 3600, windowPanner);
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
      if (activeThunder && !activeThunder.stopping) {
        activeThunder.stopping = true;
        ramp(activeThunder.gain.gain, 0, context.currentTime, .022);
        activeThunder.source.stop(context.currentTime + .024);
      }
      ramp(master.gain, 0, context.currentTime, .035);
      suspendTimer = setTimeout(() => {
        suspendTimer = null;
        if (!shouldPlay() && context?.state === 'running') {
          // A device can stall its audio clock during startup. Finalize the
          // cancellation before suspend even when its scheduled stop has not run.
          for (const voice of voices) {
            voice.source.onended = null;
            try { voice.source.stop(); } catch { /* Already ended. */ }
            voice.source.disconnect(); voice.gain.disconnect();
          }
          voices.clear();
          if (activeThunder) {
            activeThunder.source.onended = null;
            try { activeThunder.source.stop(); } catch { /* Already ended. */ }
            activeThunder.source.disconnect(); activeThunder.gain.disconnect();
            activeThunder = null;
          }
          context.suspend().catch(error => { lastError = error?.name || 'AudioSuspendError'; });
        }
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
      const resumed = synchronize();
      if (!playbackPromise) playbackPromise = preparePlayback();
      await resumed;
      await playbackPromise;
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

  function triggerThunder(strength = 1) {
    if (!context || context.state !== 'running' || !shouldPlay() || !loops.length || activeThunder) return false;
    const amount = Math.max(0, Math.min(1, Number(strength) || 0));
    if (amount <= 0) return false;
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffers.thunder;
    gain.gain.setValueAtTime(.5 + amount * .6, context.currentTime);
    source.connect(gain).connect(thunderFilter);
    const voice = { source, gain };
    activeThunder = voice;
    source.onended = () => {
      if (activeThunder === voice) activeThunder = null;
      source.disconnect(); gain.disconnect();
    };
    source.start(context.currentTime);
    thunderNumber++;
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
      activeThunder: activeThunder ? 1 : 0, thunderLimit: ROOM_AUDIO_LIMITS.thunder,
      playingSources: context?.state === 'running' && shouldPlay() ? loops.length + voices.size + (activeThunder ? 1 : 0) : 0,
      voiceLimit: ROOM_AUDIO_LIMITS.voices, bufferCount: buffers ? 6 : 0,
      generatedBytes, decodedBytes, rainSource: assetSources.rain, thunderSource: assetSources.thunder, assetErrors: { ...assetErrors },
      thunderEventsPlayed: thunderNumber, thunderDuration: buffers?.thunder.duration || 0,
      thunderTrimStart, thunderDetectedOnset, thunderAssetDuration,
      thunderAttackRms, thunderAttackPeak,
      rainDuration: buffers?.rain.duration || 0,
      flickerEventsPlayed: flickerNumber, masterGain: master?.gain.value || 0, lastError
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
    if (activeThunder) {
      activeThunder.source.onended = null;
      try { activeThunder.source.stop(); } catch { /* Already stopped. */ }
      activeThunder.source.disconnect(); activeThunder.gain.disconnect();
      activeThunder = null;
    }
    for (const node of nodes) node.disconnect();
    buffers = null;
    encoded.rain = encoded.thunder = null;
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
  return { preload, unlock, update, triggerFlicker, triggerThunder, setMuted, setPaused, snapshot, sample, dispose };
}
