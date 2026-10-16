'use strict';

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
  const phases = [];
  const allFrames = [], allCPU = [];
  const initialSnapshot = snapshot();
  try {
    for (const plan of plans) {
      await reset();
      const before = snapshot(), telemetry = [sampleTelemetry(0)];
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
      if (frameCount <= 0 || trace.frameTimes.length < frameCount || trace.cpuTimes.length < frameCount) throw new Error('A fase não gerou uma amostra completa de quadros.');
      const frameTimes = trace.frameTimes.slice(-frameCount), cpuTimes = trace.cpuTimes.slice(-frameCount);
      allFrames.push(...frameTimes); allCPU.push(...cpuTimes);
      telemetry.push(sampleTelemetry(elapsedMs));
      const movingSamples = telemetry.filter(sample => sample.moving).length;
      const runningSamples = telemetry.filter(sample => sample.running).length;
      const directions = new Set(telemetry.map(sample => JSON.stringify(sample.cameraDirection || sample.cameraQuaternion || { yaw: sample.yaw, pitch: sample.pitch })));
      phases.push({
        id: plan.id, ...statistics(frameTimes, cpuTimes, elapsedMs, frameCount),
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
          yaw: s.cameraYaw, pitch: s.cameraPitch });
        lastSample = elapsed;
      }
      await frame();
    }
  } finally { gl.getQueryParameter = originalQuery; }
  const elapsedMs = performance.now() - started, after = room.getPerformanceSnapshot();
  const count = after.totalFrames - before.totalFrames, trace = room.getPerformanceTrace();
  if (count <= 0 || trace.frameTimes.length < count || trace.cpuTimes.length < count) throw new Error('Amostra incompleta da vista ' + plan.id);
  const frameTimes = trace.frameTimes.slice(-count), cpuTimes = trace.cpuTimes.slice(-count);
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
    fixedResolution, poseVerified, lookInputs, turningVerified: !plan.turn || new Set(telemetry.map(s => JSON.stringify(s.cameraQuaternion))).size > 3,
    before, after, telemetry, frameTimes, cpuTimes, gpuTimes };
  // Every before/after screenshot uses the exact same camera, independent of
  // the number of frames rendered during the sweep.
  pose(); await delay(250);
  return result;
}

module.exports = {
  buildBenchmarkScript(quality) {
    return '(' + runRendererBenchmark.toString() + ')(' + JSON.stringify(quality) + ')';
  },
  buildBedPrepareScript(quality) {
    return '(' + prepareBedBenchmark.toString() + ')(' + JSON.stringify(quality) + ')';
  },
  buildBedPhaseScript(plan) {
    return '(' + runBedPhase.toString() + ')(' + JSON.stringify(plan) + ')';
  },
};
