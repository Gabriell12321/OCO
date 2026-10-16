'use strict';

function createTimingGuard(room) {
  const started = performance.now(), events = [];
  const state = () => ({ paused: room.getPerformanceSnapshot().paused,
    hidden: document.hidden, focused: document.hasFocus() });
  const initial = state();
  const record = event => events.push({ type: event.type, elapsedMs: performance.now() - started, ...state() });
  for (const name of ['quarto:pause', 'blur']) window.addEventListener(name, record);
  document.addEventListener('visibilitychange', record);
  return {
    state,
    finish(frameTimes, elapsedMs, telemetry) {
      for (const name of ['quarto:pause', 'blur']) window.removeEventListener(name, record);
      document.removeEventListener('visibilitychange', record);
      const final = state(), accountedMs = frameTimes.reduce((sum, ms) => sum + ms, 0);
      const states = [initial, final, ...telemetry];
      const pauseSamples = states.filter(s => s.paused || s.hidden || !s.focused).length;
      const pauseEvents = events.filter(e => e.type !== 'visibilitychange' || e.hidden).length;
      const missingMs = elapsedMs - accountedMs;
      return { valid: pauseSamples === 0 && pauseEvents === 0 && Math.abs(missingMs) < 150,
        accountedMs, elapsedMs, missingMs, pauseSamples, pauseEvents, events, initial, final };
    },
  };
}

/** Executed only inside our packaged room by the Electron diagnostic CLI. */
async function runRendererBenchmark(requestedQuality) {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const deadline = performance.now() + 90000;
  while (!window.Quarto01?.ready || !document.body.classList.contains('ready')) {
    if (performance.now() > deadline) throw new Error('O quarto não terminou de carregar em 90 segundos.');
    if (!document.getElementById('errorPanel').classList.contains('hidden')) throw new Error(document.getElementById('errorText').textContent);
    await delay(250);
  }
  const room = window.Quarto01;
  for (const method of ['getPerformanceSnapshot', 'getPerformanceTrace', 'diagnosticLook', 'setDiagnosticView']) {
    if (typeof room[method] !== 'function') throw new Error('Diagnóstico obrigatório ausente: ' + method);
  }
  if (requestedQuality) room.setQuality(requestedQuality);
  await delay(5200);
  room.setDiagnosticAtmosphere?.({ time: 0, frozen: false, rain: true, lamp: null, thunder: null });

  const key = (type, code, keyName) => document.dispatchEvent(new KeyboardEvent(type, { code, key: keyName, bubbles: true }));
  const pressed = new Set();
  const keyNames = { KeyW: 'w', KeyS: 's', KeyA: 'a', KeyD: 'd', ShiftLeft: 'Shift' };
  function useKeys(codes) {
    for (const code of pressed) if (!codes.includes(code)) { key('keyup', code, keyNames[code]); pressed.delete(code); }
    for (const code of codes) if (!pressed.has(code)) { key('keydown', code, keyNames[code]); pressed.add(code); }
  }
  const snapshot = () => room.getPerformanceSnapshot();
  const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
  function statistics(frameTimes, cpuTimes, elapsedMs, frameCount) {
    const sorted = frameTimes.slice().sort((a, b) => a - b);
    const sum = frameTimes.reduce((a, b) => a + b, 0);
    const percentile = p => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : 0;
    return {
      renderedFPS: round(frameCount * 1000 / elapsedMs),
      meanFrameMs: round(sum / Math.max(1, frameTimes.length)),
      p95FrameMs: round(percentile(.95)), p99FrameMs: round(percentile(.99)),
      meanCpuMs: round(cpuTimes.reduce((a, b) => a + b, 0) / Math.max(1, cpuTimes.length)),
      frames: frameCount, measuredFrames: frameTimes.length, durationMs: round(elapsedMs),
    };
  }
  function sampleTelemetry(elapsedMs) {
    const s = snapshot();
    return {
      elapsedMs: round(elapsedMs), moving: Boolean(s.moving), running: Boolean(s.running),
      paused: s.paused, hidden: document.hidden, focused: document.hasFocus(),
      playerPosition: s.playerPosition, cameraDirection: s.cameraDirection,
      cameraQuaternion: s.cameraQuaternion, yaw: s.yaw, pitch: s.pitch,
      shadowUpdates: s.playerShadow?.updates, shadowPosition: s.playerShadow?.position,
      gait: s.gait,
    };
  }
  async function settle() {
    for (let i = 0; i < 5; i++) await nextFrame();
  }
  async function reset() {
    useKeys([]); await room.setDiagnosticView('initial'); await settle();
  }

  const plans = [
    { id: 'idle', duration: 4000, move: false, turn: false, run: false },
    { id: 'walk', duration: 7000, move: true, turn: false, run: false },
    { id: 'look', duration: 6000, move: false, turn: true, run: false },
    { id: 'walk-and-look', duration: 8000, move: true, turn: true, run: false },
    { id: 'run-and-look', duration: 10000, move: true, turn: true, run: true },
  ];
  const phases = [], interruptedAttempts = [];
  const allFrames = [], allCPU = [];
  const initialSnapshot = snapshot();
  try {
    for (let planIndex = 0; planIndex < plans.length; planIndex++) {
      const plan = plans[planIndex];
      const focusDeadline = performance.now() + 15000;
      while (snapshot().paused || document.hidden || !document.hasFocus()) {
        if (performance.now() > focusDeadline) throw new Error('O teste perdeu o foco por mais de 15 segundos.');
        await delay(100);
      }
      await reset();
      const before = snapshot(), telemetry = [sampleTelemetry(0)];
      const timingGuard = createTimingGuard(room);
      const phaseStart = performance.now();
      let lastYawOffset = 0, lastPitchOffset = 0, lastTelemetry = 0, lookInputs = 0;
      while (performance.now() - phaseStart < plan.duration) {
        const now = performance.now(), elapsedMs = now - phaseStart, t = elapsedMs / 1000;
        if (plan.move) {
          const forward = Math.floor(elapsedMs / 750) % 2 === 0;
          useKeys([forward ? 'KeyW' : 'KeyS', ...(plan.run ? ['ShiftLeft'] : [])]);
        }
        if (plan.turn) {
          const yawOffset = Math.sin(t * Math.PI / 2) * (plan.move ? .48 : 1.2);
          const pitchOffset = Math.sin(t * Math.PI / 2.8) * .14;
          room.diagnosticLook(-(yawOffset - lastYawOffset) / .0022, -(pitchOffset - lastPitchOffset) / .0022);
          lastYawOffset = yawOffset; lastPitchOffset = pitchOffset; lookInputs++;
        }
        if (elapsedMs - lastTelemetry >= 500) {
          telemetry.push(sampleTelemetry(elapsedMs)); lastTelemetry = elapsedMs;
        }
        await nextFrame();
      }
      const elapsedMs = performance.now() - phaseStart;
      const after = snapshot(), frameCount = after.totalFrames - before.totalFrames;
      const trace = room.getPerformanceTrace();
      if (!Array.isArray(trace.frameTimes) || !Array.isArray(trace.cpuTimes)) throw new Error('Trace de quadros incompleto.');
      if (trace.frameTimes.length < frameCount || trace.cpuTimes.length < frameCount) throw new Error('A fase não gerou uma amostra completa de quadros.');
      const frameTimes = frameCount > 0 ? trace.frameTimes.slice(-frameCount) : [], cpuTimes = frameCount > 0 ? trace.cpuTimes.slice(-frameCount) : [];
      telemetry.push(sampleTelemetry(elapsedMs));
      const timingIntegrity = timingGuard.finish(frameTimes, elapsedMs, telemetry);
      if (!timingIntegrity.valid) {
        useKeys([]);
        interruptedAttempts.push({ id: plan.id, timingIntegrity, before, after });
        if (interruptedAttempts.filter(attempt => attempt.id === plan.id).length >= 3) throw new Error('Três tentativas interrompidas na fase ' + plan.id);
        planIndex--; continue;
      }
      allFrames.push(...frameTimes); allCPU.push(...cpuTimes);
      const movingSamples = telemetry.filter(sample => sample.moving).length;
      const runningSamples = telemetry.filter(sample => sample.running).length;
      const directions = new Set(telemetry.map(sample => JSON.stringify(sample.cameraDirection || sample.cameraQuaternion || { yaw: sample.yaw, pitch: sample.pitch })));
      phases.push({
        id: plan.id, ...statistics(frameTimes, cpuTimes, elapsedMs, frameCount),
        timingIntegrity,
        intendedMovement: plan.move, intendedTurning: plan.turn, intendedRunning: plan.run,
        lookInputs, movingSamples, runningSamples, samples: telemetry.length,
        movingCoverage: round(movingSamples / telemetry.length),
        turningVerified: !plan.turn || directions.size > 3,
        before, after, telemetry, frameTimes, cpuTimes,
      });
      useKeys([]);
    }
  } finally { useKeys([]); }

  const finalSnapshot = snapshot();
  const walkingPhases = phases.filter(phase => phase.intendedMovement);
  const movingFrames = walkingPhases.flatMap(phase => phase.frameTimes);
  const movingCPU = walkingPhases.flatMap(phase => phase.cpuTimes);
  const movingTime = walkingPhases.reduce((sum, phase) => sum + phase.durationMs, 0);
  const movingCount = walkingPhases.reduce((sum, phase) => sum + phase.frames, 0);
  const movementVerified = walkingPhases.every(phase => phase.movingCoverage >= .25);
  const turningVerified = phases.every(phase => phase.turningVerified);
  const runningVerified = phases.find(phase => phase.intendedRunning).runningSamples > 2;
  const gaitVerified = walkingPhases.every(phase => {
    const active = phase.telemetry.filter(sample => sample.moving && sample.gait?.blend > .1);
    return active.length > 2 && new Set(active.map(sample => Math.round(sample.gait.phase * 100))).size > 2;
  });
  const shadowPositions = new Set(phases.flatMap(phase => phase.telemetry).map(sample => JSON.stringify(sample.shadowPosition)));
  const shadowMovementVerified = Boolean(finalSnapshot.playerShadow?.active) &&
    finalSnapshot.playerShadow.updates > (initialSnapshot.playerShadow?.updates || 0) && shadowPositions.size > 3;
  const gl = document.getElementById('scene').getContext('webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info');
  const activeWebGL = {
    vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    version: gl.getParameter(gl.VERSION),
  };
  await reset();
  const durationMs = phases.reduce((sum, phase) => sum + phase.durationMs, 0);
  const frameCount = phases.reduce((sum, phase) => sum + phase.frames, 0);
  const aggregate = statistics(allFrames, allCPU, durationMs, frameCount);
  return {
    version: room.version, test: '35-second-walk-look-run',
    renderedAverageFPS: aggregate.renderedFPS, aggregate,
    moving: statistics(movingFrames, movingCPU, movingTime, movingCount),
    idle: phases.find(phase => phase.id === 'idle'), phases,
    movementVerified, turningVerified, runningVerified, gaitVerified, shadowMovementVerified, activeWebGL,
    timingVerified: phases.every(phase => phase.timingIntegrity.valid), interruptedAttempts,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    startSnapshot: initialSnapshot, renderer: finalSnapshot,
    loadingVisible: !document.getElementById('loading').classList.contains('hidden'),
    errorVisible: !document.getElementById('errorPanel').classList.contains('hidden'),
  };
}

async function prepareBedBenchmark(quality) {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const deadline = performance.now() + 90000;
  while (!window.Quarto01?.ready || !document.body.classList.contains('ready')) {
    if (performance.now() > deadline) throw new Error('O quarto não terminou de carregar.');
    if (!document.getElementById('errorPanel').classList.contains('hidden')) throw new Error(document.getElementById('errorText').textContent);
    await delay(200);
  }
  const room = window.Quarto01;
  room.setQuality(quality || 'performance');
  if (typeof room.setDiagnosticResolutionLock === 'function') room.setDiagnosticResolutionLock(true);
  await delay(5200);
  const gl = document.getElementById('scene').getContext('webgl2');
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return { version: room.version, snapshot: room.getPerformanceSnapshot(),
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    activeWebGL: { renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR) } };
}

async function runBedPhase(plan) {
  const room = window.Quarto01, gl = document.getElementById('scene').getContext('webgl2');
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  function pose() {
    if (!room.setDiagnosticView(plan.view)) throw new Error('Pose inválida: ' + plan.view);
    if (plan.pitchInput) room.diagnosticLook(0, plan.pitchInput);
  }
  pose(); await delay(250);
  const before = room.getPerformanceSnapshot(), gpuTimes = [], telemetry = [];
  const timingGuard = createTimingGuard(room);
  const originalQuery = gl.getQueryParameter;
  // Observe the existing nonblocking timer only after its result is available.
  // No new GPU queries, gl.finish(), or query-result waits are introduced.
  gl.getQueryParameter = function(query, parameter) {
    const result = originalQuery.call(this, query, parameter);
    if (parameter === gl.QUERY_RESULT && typeof result === 'number' && result > 0 && result < 1e9) gpuTimes.push(result / 1e6);
    return result;
  };
  const started = performance.now();
  let lastYaw = 0, lastPitch = 0, lastSample = -Infinity, lookInputs = 0;
  try {
    while (performance.now() - started < plan.duration) {
      const elapsed = performance.now() - started;
      if (plan.turn) {
        const phase = elapsed / plan.duration * Math.PI * 2;
        const yaw = Math.sin(phase) * .24, pitch = Math.sin(phase * 2) * .055;
        room.diagnosticLook(-(yaw - lastYaw) / .0022, -(pitch - lastPitch) / .0022);
        lastYaw = yaw; lastPitch = pitch; lookInputs++;
      }
      if (elapsed - lastSample >= 500) {
        const s = room.getPerformanceSnapshot();
        telemetry.push({ elapsedMs: elapsed, width: s.drawingBufferWidth, height: s.drawingBufferHeight,
          adaptiveScale: s.adaptiveScale, cameraQuaternion: s.cameraQuaternion, playerPosition: s.playerPosition,
          ...timingGuard.state(),
          yaw: s.cameraYaw, pitch: s.cameraPitch });
        lastSample = elapsed;
      }
      await frame();
    }
  } finally { gl.getQueryParameter = originalQuery; }
  const elapsedMs = performance.now() - started, after = room.getPerformanceSnapshot();
  const count = after.totalFrames - before.totalFrames, trace = room.getPerformanceTrace();
  if (trace.frameTimes.length < count || trace.cpuTimes.length < count) throw new Error('Amostra incompleta da vista ' + plan.id);
  const frameTimes = count > 0 ? trace.frameTimes.slice(-count) : [], cpuTimes = count > 0 ? trace.cpuTimes.slice(-count) : [];
  const timingIntegrity = timingGuard.finish(frameTimes, elapsedMs, telemetry);
  const round = value => Math.round(value * 100) / 100;
  const summarize = values => {
    const sorted = values.slice().sort((a, b) => a - b);
    const at = p => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : 0;
    return { samples: values.length, meanMs: round(values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)),
      p95Ms: round(at(.95)), p99Ms: round(at(.99)) };
  };
  const fixedResolution = telemetry.every(s => s.width === before.drawingBufferWidth && s.height === before.drawingBufferHeight) &&
    after.drawingBufferWidth === before.drawingBufferWidth && after.drawingBufferHeight === before.drawingBufferHeight;
  const poseVerified = Math.hypot(after.playerPosition.x - before.playerPosition.x,
    after.playerPosition.z - before.playerPosition.z) < .001 &&
    Math.abs(after.cameraYaw - before.cameraYaw - lastYaw) < .002 &&
    Math.abs(after.cameraPitch - before.cameraPitch - lastPitch) < .002;
  const result = { id: plan.id, view: plan.view, version: room.version, durationMs: round(elapsedMs),
    frames: count, renderedFPS: round(count * 1000 / elapsedMs), frame: summarize(frameTimes),
    cpu: summarize(cpuTimes), gpu: { available: before.gpuTiming?.available === true, ...summarize(gpuTimes) },
    fixedResolution, poseVerified, timingIntegrity, lookInputs, turningVerified: !plan.turn || new Set(telemetry.map(s => JSON.stringify(s.cameraQuaternion))).size > 3,
    before, after, telemetry, frameTimes, cpuTimes, gpuTimes };
  // Every before/after screenshot uses the exact same camera, independent of
  // the number of frames rendered during the sweep.
  pose(); await delay(250);
  return result;
}

async function waitForAudioClock() {
  const room = window.Quarto01, started = performance.now();
  const initial = room.getPerformanceSnapshot().audio, samples = [];
  while (performance.now() - started < 3000) {
    const state = room.getPerformanceSnapshot().audio;
    samples.push({ wallMs: performance.now() - started, contextTime: state.contextTime,
      masterGain: state.masterGain, contextState: state.contextState, paused: state.paused,
      muted: state.muted, background: state.background });
    if (state.contextState === 'running' && !state.paused && !state.muted && !state.background &&
      state.masterGain >= .7 && state.contextTime - initial.contextTime >= .08) {
      return { ready: true, elapsedMs: performance.now() - started, initial, final: state, samples };
    }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return { ready: false, elapsedMs: performance.now() - started, initial, final: room.getPerformanceSnapshot().audio, samples };
}

async function runWeatherAudioCheck() {
  const room = window.Quarto01, delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const snapshot = () => room.getPerformanceSnapshot();
  const sampleState = async () => ({ sample: await room.diagnosticAudio('sample'), snapshot: snapshot().audio });
  const startup = await waitForAudioClock();
  const running = await sampleState();
  room.diagnosticAudio('mute', true); await delay(180);
  const muted = await sampleState();
  room.diagnosticAudio('mute', false); await delay(180);
  room.diagnosticAudio('pause', true); await delay(180);
  const paused = await sampleState();
  room.diagnosticAudio('pause', false); await delay(180);
  const resumed = await sampleState();
  room.pause(); await delay(180);
  const gamePaused = { ...await sampleState(), renderPaused: snapshot().paused };
  room.resume(); await delay(200);
  const gameResumed = { ...await sampleState(), renderPaused: snapshot().paused };
  room.setDiagnosticAtmosphere({ time: 5.3, frozen: false, rain: true, lamp: null });
  const beforeFlicker = snapshot(), samples = [], started = performance.now();
  while (performance.now() - started < 3000) {
    const s = snapshot();
    samples.push({ time: s.atmosphere.time, lampGain: s.atmosphere.light.lampGain,
      shadeGain: s.atmosphere.light.shadeGain, lightEvents: s.atmosphere.light.flickerEvents,
      soundEvents: s.audio.flickerEventsPlayed, voices: s.audio.activeVoices });
    await delay(50);
  }
  const afterFlicker = snapshot();
  const minimum = samples.reduce((a, b) => b.lampGain < a.lampGain ? b : a);
  const lightEvents = afterFlicker.atmosphere.light.flickerEvents - beforeFlicker.atmosphere.light.flickerEvents;
  const soundEvents = afterFlicker.audio.flickerEventsPlayed - beforeFlicker.audio.flickerEventsPlayed;
  const isAudible = state => state.snapshot.unlocked && state.snapshot.contextState === 'running' && state.sample.rms > .000001;
  const isSilent = state => state.sample.rms < .000001 && state.sample.peak < .000001 && state.snapshot.playingSources === 0;
  const passed = startup.ready && isAudible(running) && muted.snapshot.muted && isSilent(muted) &&
    paused.snapshot.paused && isSilent(paused) && isAudible(resumed) &&
    gamePaused.renderPaused && gamePaused.snapshot.paused && isSilent(gamePaused) &&
    !gameResumed.renderPaused && isAudible(gameResumed) &&
    lightEvents >= 2 && soundEvents >= 2 && minimum.lampGain < .3 &&
    samples.every(s => s.lampGain === s.shadeGain && s.voices <= afterFlicker.audio.voiceLimit) &&
    afterFlicker.atmosphere.light.staticShadowPassesPerFlicker === 0 && !afterFlicker.audio.lastError;
  room.diagnosticAudio('mute', true);
  return { passed, startup, running, muted, paused, resumed, gamePaused, gameResumed,
    flicker: { lightEvents, soundEvents, minimum, samples, before: beforeFlicker.atmosphere,
      after: afterFlicker.atmosphere, audio: afterFlicker.audio } };
}

async function runStormAudioCheck() {
  const room = window.Quarto01, delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const snapshot = () => room.getPerformanceSnapshot();
  const sampleState = async () => ({ sample: await room.diagnosticAudio('sample'), snapshot: snapshot().audio });
  const startup = await waitForAudioClock(), rain = await sampleState();
  room.setDiagnosticAtmosphere({ time: 0, frozen: false, rain: true, lamp: null, thunder: null });
  const before = snapshot(), timeline = [], soundSamples = [], pendingSamples = [];
  const started = performance.now();
  let sampledAttack = false, sampledTail = false;
  while (performance.now() - started < 11600) {
    const s = snapshot(), light = s.atmosphere.light;
    timeline.push({ wallMs: performance.now() - started, time: s.atmosphere.time,
      gain: light.thunderGain, event: light.thunderEvent, lightEvents: light.thunderEvents,
      soundEvents: s.audio.thunderEventsPlayed, activeThunder: s.audio.activeThunder,
      paused: s.paused, focused: document.hasFocus(), hidden: document.hidden });
    const attack = !sampledAttack && light.thunderGain > .3;
    const tail = sampledAttack && !sampledTail && s.atmosphere.time > 10.65;
    if (attack || tail) {
      if (attack) sampledAttack = true; else sampledTail = true;
      const time = s.atmosphere.time;
      pendingSamples.push(sampleState().then(state => soundSamples.push({ time, ...state })));
    }
    await delay(40);
  }
  await Promise.all(pendingSamples);
  const after = snapshot();

  // A muted event must be consumed by the shared timeline without being queued
  // for later playback. The real renderer keeps advancing during this check.
  room.diagnosticAudio('mute', true); await delay(180);
  const muted = await sampleState(), beforeMuted = snapshot();
  room.setDiagnosticAtmosphere({ time: 9.7, frozen: false, lamp: 1, thunder: null });
  await delay(1650);
  const afterMuted = snapshot();
  room.diagnosticAudio('mute', false);
  const unmuteStartup = await waitForAudioClock(); await delay(200);
  const afterUnmute = await sampleState();
  const noDelayedAfterMute = afterMuted.atmosphere.light.thunderEvents === beforeMuted.atmosphere.light.thunderEvents + 1 &&
    afterMuted.audio.thunderEventsPlayed === beforeMuted.audio.thunderEventsPlayed &&
    afterUnmute.snapshot.thunderEventsPlayed === afterMuted.audio.thunderEventsPlayed && afterUnmute.snapshot.activeThunder === 0;

  // Pause while a real thunder voice is active, then resume inside the same
  // flash. Old audio must not restart or appear as a newly triggered event.
  room.setDiagnosticAtmosphere({ time: 9.7, frozen: false, lamp: 1, thunder: null });
  const eventDeadline = performance.now() + 2500;
  while (!snapshot().audio.activeThunder && performance.now() < eventDeadline) await delay(20);
  const beforePause = snapshot();
  room.pause(); await delay(1300);
  const paused = { ...await sampleState(), render: snapshot() };
  room.resume();
  const resumeStartup = await waitForAudioClock(); await delay(200);
  const resumed = { ...await sampleState(), render: snapshot() };
  const noDelayedAfterPause = beforePause.audio.activeThunder === 1 && paused.render.paused &&
    Math.abs(paused.render.atmosphere.time - beforePause.atmosphere.time) < .03 &&
    paused.snapshot.activeThunder === 0 && resumed.snapshot.activeThunder === 0 &&
    resumed.snapshot.thunderEventsPlayed === beforePause.audio.thunderEventsPlayed;
  const lightEvents = after.atmosphere.light.thunderEvents - before.atmosphere.light.thunderEvents;
  const soundEvents = after.audio.thunderEventsPlayed - before.audio.thunderEventsPlayed;
  const firstLight = timeline.find(s => s.lightEvents > before.atmosphere.light.thunderEvents);
  const firstSound = timeline.find(s => s.soundEvents > before.audio.thunderEventsPlayed);
  const synchronized = Boolean(firstLight && firstSound && Math.abs(firstLight.time - firstSound.time) < .08);
  const attackMix = soundSamples[0]?.sample;
  const mixComparison = { rainRms: rain.sample.rms, attackRms: attackMix?.rms ?? 0,
    rmsRatio: (attackMix?.rms ?? 0) / Math.max(.000001, rain.sample.rms),
    rainPeak: rain.sample.peak, attackPeak: attackMix?.peak ?? 0 };
  const decodedThunder = { source: after.audio.thunderSource, trimStart: after.audio.thunderTrimStart,
    detectedOnset: after.audio.thunderDetectedOnset, assetDuration: after.audio.thunderAssetDuration,
    duration: after.audio.thunderDuration, attackRms: after.audio.thunderAttackRms,
    attackPeak: after.audio.thunderAttackPeak, attackDurationMs: 200 };
  const silence = state => state.sample.rms < .000001 && state.sample.peak < .000001 && state.snapshot.playingSources === 0;
  const audible = state => state.sample.rms > .000001 && state.sample.peak > .000001 && state.sample.peak <= 1;
  const timelineUninterrupted = timeline.every(s => !s.paused && !s.hidden && s.focused) && after.atmosphere.time >= 11.5;
  const passed = startup.ready && unmuteStartup.ready && resumeStartup.ready && audible(rain) &&
    timelineUninterrupted && synchronized && lightEvents === 1 && soundEvents === 1 &&
    timeline.filter(s => s.time < 10).every(s => s.gain === 0 && s.soundEvents === before.audio.thunderEventsPlayed) &&
    Math.max(...timeline.map(s => s.gain)) > .8 && after.atmosphere.light.thunderGain === 0 &&
    soundSamples.length === 2 && soundSamples.every(audible) && silence(muted) && silence(paused) &&
    noDelayedAfterMute && noDelayedAfterPause && audible(resumed) && !resumed.render.paused &&
    timeline.every(s => s.activeThunder <= 1) && after.atmosphere.light.staticShadowPassesPerThunder === 0 &&
    decodedThunder.attackRms > .0001 && decodedThunder.attackPeak > .001 &&
    Math.max(0, decodedThunder.detectedOnset - decodedThunder.trimStart) < .1 &&
    !after.audio.lastError && Object.keys(after.audio.assetErrors || {}).length === 0 &&
    after.audio.rainSource === 'local-recording' && after.audio.thunderSource === 'local-recording';
  return { passed, startup, rain, timelineUninterrupted, synchronized, lightEvents, soundEvents,
    firstLight, firstSound, mixComparison, decodedThunder, before, after, timeline, soundSamples, muted, beforeMuted, afterMuted,
    unmuteStartup, afterUnmute, noDelayedAfterMute, beforePause, paused, resumed, resumeStartup, noDelayedAfterPause };
}

module.exports = {
  buildBenchmarkScript(quality) {
    return '(() => { const createTimingGuard = ' + createTimingGuard.toString() + '; return (' + runRendererBenchmark.toString() + ')(' + JSON.stringify(quality) + '); })()';
  },
  buildBedPrepareScript(quality) {
    return '(' + prepareBedBenchmark.toString() + ')(' + JSON.stringify(quality) + ')';
  },
  buildBedPhaseScript(plan) {
    return '(() => { const createTimingGuard = ' + createTimingGuard.toString() + '; return (' + runBedPhase.toString() + ')(' + JSON.stringify(plan) + '); })()';
  },
  buildAudioReadyScript() { return '(' + waitForAudioClock.toString() + ')()'; },
  buildWeatherAudioScript() { return '(() => { const waitForAudioClock = ' + waitForAudioClock.toString() + '; return (' + runWeatherAudioCheck.toString() + ')(); })()'; },
  buildStormAudioScript() { return '(() => { const waitForAudioClock = ' + waitForAudioClock.toString() + '; return (' + runStormAudioCheck.toString() + ')(); })()'; },
};
