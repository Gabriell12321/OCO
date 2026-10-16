'use strict';

const { app, BrowserWindow, Menu, protocol, session, ipcMain, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildBenchmarkScript, buildBedPrepareScript, buildBedPhaseScript, buildWeatherAudioScript, buildAudioReadyScript } = require('./benchmark-renderer.cjs');

const NO_MSAA_BENCHMARK = process.argv.includes('--benchmark-no-msaa');
const FORCE_MSAA4_BENCHMARK = process.argv.includes('--benchmark-msaa4');
const NO_FXAA_BENCHMARK = process.argv.includes('--benchmark-no-fxaa') || process.argv.includes('--fxaa=0') || NO_MSAA_BENCHMARK || FORCE_MSAA4_BENCHMARK;
const diagnosticQuery = new URLSearchParams();
if (NO_FXAA_BENCHMARK) diagnosticQuery.set('fxaa', '0');
if (FORCE_MSAA4_BENCHMARK) diagnosticQuery.set('msaa', '4');
const APP_URL = 'app://quarto/index.html' + (diagnosticQuery.size ? '?' + diagnosticQuery : '');
const CONTENT_ROOT = path.resolve(__dirname, 'dist');
const QUALITY_STEADY_PROBE = process.argv.includes('--quality-steady-probe');
const SMOKE_PROFILE_CYCLE = process.argv.includes('--smoke-profile-cycle') || QUALITY_STEADY_PROBE;
const CAPTURE_VIEWS_ONLY = process.argv.includes('--capture-views-only');
const BED_BENCHMARK = process.argv.includes('--benchmark-bed');
const BED_SURFACE_BASE_ONLY = process.argv.includes('--capture-bed-base');
const BED_SURFACES = process.argv.includes('--capture-bed-surfaces') || BED_SURFACE_BASE_ONLY;
const WEATHER_BENCHMARK = process.argv.includes('--benchmark-weather');
const AUDIO_PROBE = process.argv.includes('--probe-audio');
const BENCHMARK = process.argv.includes('--benchmark') || SMOKE_PROFILE_CYCLE || CAPTURE_VIEWS_ONLY || BED_BENCHMARK || BED_SURFACES || WEATHER_BENCHMARK || AUDIO_PROBE;
const requestedQualityArgument = process.argv.find(arg => arg.startsWith('--benchmark-quality='));
const requestedQuality = requestedQualityArgument?.slice('--benchmark-quality='.length);
const BENCHMARK_QUALITY = ['performance', 'balanced', 'quality'].includes(requestedQuality) ? requestedQuality : null;
app.setName('Quarto 01');
const benchmarkDirArgument = process.argv.find(arg => arg.startsWith('--benchmark-dir='));
const RESULTS_DIR = benchmarkDirArgument
  ? path.resolve(benchmarkDirArgument.slice('--benchmark-dir='.length))
  : path.join(app.getPath('userData'), 'benchmark');
const ERRORS = [];
let mainWindow = null;
let latestRendererReport = null;

app.setAppUserModelId('br.quarto01.desktop');
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.hdr': 'application/octet-stream', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};
const indexHTML = fs.readFileSync(path.join(CONTENT_ROOT, 'index.html'), 'utf8');
const inlineHashes = [...indexHTML.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => "'sha256-" + crypto.createHash('sha256').update(match[1]).digest('base64') + "'");
const reloadHash = "'sha256-" + crypto.createHash('sha256').update('window.location.reload()').digest('base64') + "'";
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-hashes' " + [...inlineHashes, reloadHash].join(' '),
  "style-src 'self' 'unsafe-inline'", // The loading bar updates inline styles.
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' blob:", // Only packaged files and local blob resources.
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-src 'none'",
].join('; ');

function localPath(requestURL) {
  const url = new URL(requestURL);
  if (url.protocol !== 'app:' || url.hostname !== 'quarto' || url.port || url.username || url.password) return null;
  const decoded = decodeURIComponent(url.pathname);
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const destination = path.resolve(CONTENT_ROOT, '.' + (decoded === '/' ? '/index.html' : decoded));
  const relative = path.relative(CONTENT_ROOT, destination);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return destination;
}

async function serveLocal(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('', { status: 405 });
  let target;
  try { target = localPath(request.url); } catch { return new Response('', { status: 400 }); }
  if (!target) return new Response('', { status: 403 });
  try {
    const stat = await fs.promises.stat(target);
    if (!stat.isFile()) return new Response('', { status: 404 });
    const headers = {
      'Content-Type': mime[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Content-Length': String(stat.size),
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
    };
    // Assets are small and local. No server or network is involved.
    const content = request.method === 'HEAD' ? null : await fs.promises.readFile(target);
    return new Response(content, { status: 200, headers });
  } catch {
    ERRORS.push({ kind: 'missing-asset', url: request.url });
    return new Response('', { status: 404 });
  }
}

function writeResult(result) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const filename = path.join(RESULTS_DIR, 'latest.json');
  fs.writeFileSync(filename, JSON.stringify(result, null, 2), 'utf8');
  // Full traces belong in the result file, not thousands of console lines.
  console.log(JSON.stringify({ benchmarkFile: filename, success: result.success,
    test: result.test || result.metrics?.test, moving: result.metrics?.moving,
    renderPath: result.metrics?.renderer?.renderPath, errors: result.errors || [] }));
}

// This test executes only inside our packaged room and never generates system
// input. V must remain inert, and the removed character must not load assets.
const INSPECT_FIRST_PERSON = `(async () => {
  const before = window.Quarto01.getPerformanceSnapshot();
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', key: 'v', bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyV', key: 'v', bubbles: true }));
  await new Promise(resolve => requestAnimationFrame(resolve));
  const after = window.Quarto01.getPerformanceSnapshot();
  const characterResources = performance.getEntriesByType('resource')
    .map(entry => entry.name).filter(url => /\\/assets\\/character\\/|\\/avatar\\.js(?:[?#]|$)|\\/Michelle\\.glb(?:[?#]|$)/i.test(url));
  const hasViewButton = Boolean(document.getElementById('viewBtn'));
  const characterAbsent = window.Quarto01.character === false && after.character === false;
  const firstPersonOnly = window.Quarto01.firstPersonOnly === true && after.firstPersonOnly === true;
  return {
    passed: before.view === 'first-person' && after.view === 'first-person' &&
      !hasViewButton && characterAbsent && firstPersonOnly && characterResources.length === 0,
    beforeView: before.view, afterView: after.view, hasViewButton,
    characterAbsent, firstPersonOnly, characterResources,
  };
})()`;

// Native diagnostics own their temporary test window. Ignore physical room
// controls while measuring, but preserve the synthetic inputs under test and
// the operating-system window controls (the user can still close the window).
const INSTALL_DIAGNOSTIC_INPUT_GUARD = `(() => {
  const ignorePhysicalInput = event => {
    if (!event.isTrusted) return;
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  };
  for (const name of ['keydown', 'keyup', 'mousedown', 'mouseup', 'mousemove',
    'pointerdown', 'pointerup', 'pointermove', 'touchstart', 'touchmove', 'touchend',
    'click', 'dblclick', 'wheel']) {
    window.addEventListener(name, ignorePhysicalInput, { capture: true, passive: false });
  }
})()`;

async function captureDiagnosticView(win, view) {
  await focusDiagnosticWindow(win);
  const snapshot = await win.webContents.executeJavaScript(`(async () => {
    const room = window.Quarto01;
    if (typeof room.setDiagnosticView !== 'function') throw new Error('Poses de diagnóstico ausentes.');
    const firstFrame = room.getPerformanceSnapshot().totalFrames;
    if (await room.setDiagnosticView(${JSON.stringify(view)}) === false) throw new Error('Pose de diagnóstico inválida.');
    const deadline = performance.now() + 20000;
    while (room.getPerformanceSnapshot().totalFrames < firstFrame + 12) {
      if (performance.now() > deadline) throw new Error('A vista de diagnóstico não terminou de renderizar.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await new Promise(resolve => requestAnimationFrame(resolve));
    return room.getPerformanceSnapshot();
  })()`);
  const filename = path.join(RESULTS_DIR, view + '.png');
  fs.writeFileSync(filename, (await win.webContents.capturePage()).toPNG());
  return { view, filename, snapshot };
}

async function captureShadowRegression(win) {
  const hasAtmosphere = await win.webContents.executeJavaScript(`(() => {
    if (typeof window.Quarto01.setDiagnosticAtmosphere !== 'function') return false;
    window.Quarto01.setDiagnosticAtmosphere({ time: 0, frozen: true, rain: false, lamp: 1 });
    return true;
  })()`);
  try {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const comparisons = [];
  for (const view of ['shadow', 'bed-right', 'bed-foot', 'bed-left']) {
    await captureDiagnosticView(win, view);
    const captures = [], images = [];
    for (const enabled of [true, false]) {
      const snapshot = await win.webContents.executeJavaScript(`(async () => {
        const room = window.Quarto01, firstFrame = room.getPerformanceSnapshot().totalFrames;
        room.setDiagnosticShadowEnabled(${JSON.stringify(enabled)});
        const deadline = performance.now() + 20000;
        while (room.getPerformanceSnapshot().totalFrames < firstFrame + 12) {
          if (performance.now() > deadline) throw new Error('A sombra não terminou de renderizar.');
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        await new Promise(resolve => setTimeout(resolve, 300));
        await new Promise(resolve => requestAnimationFrame(resolve));
        return { ...room.getPerformanceSnapshot(),
          loadingVisible: !document.getElementById('loading').classList.contains('hidden') };
      })()`);
      const image = await win.webContents.capturePage();
      const filename = path.join(RESULTS_DIR, view + (enabled ? '-on.png' : '-off.png'));
      fs.writeFileSync(filename, image.toPNG()); images.push(image);
      captures.push({ enabled, filename, snapshot });
    }
    const size = images[0].getSize(1), on = images[0].toBitmap({ scaleFactor: 1 }), off = images[1].toBitmap({ scaleFactor: 1 });
    if (on.length !== size.width * size.height * 4 || off.length !== on.length) throw new Error('Tamanhos de captura incompatíveis.');
    let pixels = 0, darkenedPixels = 0, brightenedPixels = 0, deltaSum = 0;
    for (let y = Math.floor(size.height * .15); y < size.height * .85; y++) {
      for (let x = Math.floor(size.width * .05); x < size.width * .95; x++) {
        const i = (y * size.width + x) * 4;
        const darkness = off[i] + off[i + 1] + off[i + 2] - on[i] - on[i + 1] - on[i + 2];
        deltaSum += Math.abs(off[i] - on[i]) + Math.abs(off[i + 1] - on[i + 1]) + Math.abs(off[i + 2] - on[i + 2]);
        pixels++; if (darkness > 12) darkenedPixels++; if (darkness < -12) brightenedPixels++;
      }
    }
    await win.webContents.executeJavaScript('window.Quarto01.setDiagnosticShadowEnabled(true)');
    const cameraUnchanged = JSON.stringify(captures[0].snapshot.cameraPosition) === JSON.stringify(captures[1].snapshot.cameraPosition) &&
      JSON.stringify(captures[0].snapshot.cameraQuaternion) === JSON.stringify(captures[1].snapshot.cameraQuaternion);
    const difference = { cameraUnchanged, comparedPixels: pixels, darkenedPixels, brightenedPixels,
      meanAbsoluteChannelDelta: Math.round(deltaSum * 1000 / Math.max(1, pixels * 3)) / 1000 };
    const projectionFollows = captures.every(({ snapshot }) => {
      const player = snapshot.playerPosition, shadow = snapshot.playerShadow.position;
      return Math.hypot(player.x - shadow.x, player.z - shadow.z) < .02;
    });
    const noParticles = captures.every(({ snapshot }) => snapshot.renderStats?.points === 0);
    const passed = captures[0].snapshot.playerShadow.active && !captures[1].snapshot.playerShadow.active &&
      captures.every(capture => !capture.snapshot.loadingVisible) && cameraUnchanged && projectionFollows && noParticles &&
      (view !== 'shadow' || darkenedPixels - brightenedPixels > 500);
    comparisons.push({ view, passed, projectionFollows, noParticles, captures, difference });
  }
  // Exercise the real movement controller near the bed, then return to the
  // original wall pose. These images also catch stale maps after relocating.
  const movementStart = await captureDiagnosticView(win, 'bed-right');
  const movement = await win.webContents.executeJavaScript(`(async () => {
    const room = window.Quarto01, samples = [];
    const sample = () => {
      const s = room.getPerformanceSnapshot();
      samples.push({ player: s.playerPosition, shadow: s.playerShadow.position,
        updates: s.playerShadow.updates, active: s.playerShadow.active, moving: s.moving });
    };
    const key = (type, code) => document.dispatchEvent(new KeyboardEvent(type,
      { code, key: code === 'KeyW' ? 'w' : 's', bubbles: true }));
    for (const code of ['KeyW', 'KeyS']) {
      key('keydown', code);
      try {
        for (let i = 0; i < 6; i++) {
          await new Promise(resolve => setTimeout(resolve, 150)); sample();
        }
      } finally { key('keyup', code); }
      await new Promise(resolve => setTimeout(resolve, 250)); sample();
    }
    return samples;
  })()`);
  const movementEndFile = path.join(RESULTS_DIR, 'bed-right-after-walk.png');
  fs.writeFileSync(movementEndFile, (await win.webContents.capturePage()).toPNG());
  const returnedWall = await captureDiagnosticView(win, 'shadow');
  const movedDistance = Math.max(...movement.map(sample => Math.hypot(
    sample.player.x - movementStart.snapshot.playerPosition.x,
    sample.player.z - movementStart.snapshot.playerPosition.z)));
  const maximumShadowLag = Math.max(...movement.map(sample => Math.hypot(
    sample.player.x - sample.shadow.x, sample.player.z - sample.shadow.z)));
  const movementPassed = movedDistance > .15 && maximumShadowLag < .15 &&
    movement.some(sample => sample.moving) && movement.every(sample => sample.active) &&
    movementStart.snapshot.playerShadow.active && returnedWall.snapshot.playerShadow.active &&
    returnedWall.snapshot.playerShadow.updates > movementStart.snapshot.playerShadow.updates;
  return { success: comparisons.every(result => result.passed) && movementPassed,
    comparisons, movement: { passed: movementPassed, movedDistance, maximumShadowLag,
      samples: movement, start: movementStart, endFilename: movementEndFile, returnedWall } };
  } finally {
    if (hasAtmosphere) await win.webContents.executeJavaScript('window.Quarto01.setDiagnosticAtmosphere({ frozen: false, rain: true, lamp: null })');
  }
}

async function runShadowCapture(win) {
  try {
    await win.webContents.executeJavaScript(`(async () => {
      const deadline = performance.now() + 90000;
      while (!window.Quarto01?.ready || !document.body.classList.contains('ready')) {
        if (performance.now() > deadline) throw new Error('O quarto não terminou de carregar.');
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (typeof window.Quarto01.setDiagnosticShadowEnabled !== 'function') throw new Error('Toggle de sombra de diagnóstico ausente.');
      await new Promise(resolve => setTimeout(resolve, 2500));
    })()`);
    const regression = await captureShadowRegression(win);
    const detailCaptures = [];
    for (const view of ['initial', 'blanket', 'feet', 'feet-oblique']) detailCaptures.push(await captureDiagnosticView(win, view));
    const passed = regression.success && !ERRORS.some(error => error.kind !== 'console-warning');
    writeResult({ success: passed, test: 'shadow-wall-bed-and-movement', regression, detailCaptures, errors: ERRORS });
    app.exit(passed ? 0 : 1);
  } catch (error) {
    writeResult({ success: false, test: 'shadow-on-off-same-camera', message: String(error), errors: ERRORS });
    app.exit(1);
  }
}

async function runBenchmark(win) {
  try {
    await win.webContents.executeJavaScript(`(async () => {
      const deadline = performance.now() + 90000;
      while (!window.Quarto01?.ready) {
        if (performance.now() > deadline) throw new Error('O quarto não terminou de carregar.');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    })()`);
    await focusDiagnosticWindow(win);
    const audioUnlocked = await win.webContents.executeJavaScript("window.Quarto01.diagnosticAudio?.('unlock') ?? null", true);
    const audioStartup = audioUnlocked === null ? null : await win.webContents.executeJavaScript(buildAudioReadyScript());
    const audioSample = audioUnlocked === null ? null : await win.webContents.executeJavaScript("window.Quarto01.diagnosticAudio('sample')");
    const metrics = await win.webContents.executeJavaScript(buildBenchmarkScript(BENCHMARK_QUALITY));
    const firstPersonInspection = await win.webContents.executeJavaScript(INSPECT_FIRST_PERSON);
    const gpu = await app.getGPUInfo('basic');
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const screenshotPath = path.join(RESULTS_DIR, 'latest.png');
    const image = await win.webContents.capturePage();
    fs.writeFileSync(screenshotPath, image.toPNG());
    const captures = [];
    for (const view of ['shadow', 'blanket', 'feet']) captures.push(await captureDiagnosticView(win, view));
    const shadowRegression = await captureShadowRegression(win);
    const realAudioWorkload = audioUnlocked === null || (audioUnlocked === true && audioStartup.ready && audioSample.rms > .000001 &&
      metrics.startSnapshot.audio?.playingSources >= 2 && metrics.renderer.audio?.playingSources >= 2);
    const passed = firstPersonInspection.passed && metrics.timingVerified && realAudioWorkload && metrics.movementVerified && metrics.turningVerified &&
      metrics.runningVerified && metrics.gaitVerified && metrics.shadowMovementVerified && shadowRegression.success &&
      metrics.renderer.version === app.getVersion() &&
      metrics.startSnapshot.view === 'first-person' && metrics.renderer.view === 'first-person' &&
      !metrics.errorVisible && !metrics.loadingVisible &&
      !metrics.renderer.paused && metrics.renderer.benchmarkSamples >= 100 &&
      !ERRORS.some(error => error.kind !== 'console-warning');
    writeResult({ success: passed, date: new Date().toISOString(), electron: process.versions.electron,
      chromium: process.versions.chrome, gpuFeatureStatus: app.getGPUFeatureStatus(), gpu,
      metrics, audioUnlocked, audioStartup, audioSample, realAudioWorkload, firstPersonInspection, screenshotPath, captures, shadowRegression, rendererReport: latestRendererReport, errors: ERRORS });
    app.exit(passed ? 0 : 1);
  } catch (error) {
    writeResult({ success: false, date: new Date().toISOString(), message: String(error), errors: ERRORS });
    app.exit(1);
  }
}

async function runBedBenchmark(win) {
  try {
    const initial = await win.webContents.executeJavaScript(buildBedPrepareScript(BENCHMARK_QUALITY || 'performance'));
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const plans = [
      { id: 'initial-control', view: 'initial', duration: 3000, turn: false },
      { id: 'bed-right', view: 'bed-right', duration: 5000, turn: false },
      { id: 'bed-foot', view: 'bed-foot', duration: 5000, turn: true },
      { id: 'bed-left', view: 'bed-left', duration: 5000, turn: true },
      { id: 'blanket-close', view: 'blanket', pitchInput: 100, duration: 5000, turn: true },
    ];
    const views = [];
    for (const plan of plans) {
      const measured = await measureDiagnosticView(win, plan);
      const filename = path.join(RESULTS_DIR, plan.id + '.png');
      fs.writeFileSync(filename, (await win.webContents.capturePage()).toPNG());
      views.push({ ...measured, filename });
    }
    const firstPersonInspection = await win.webContents.executeJavaScript(INSPECT_FIRST_PERSON);
    const fixedResolution = views.every(view => view.fixedResolution &&
      view.before.drawingBufferWidth === initial.snapshot.drawingBufferWidth &&
      view.before.drawingBufferHeight === initial.snapshot.drawingBufferHeight);
    const passed = firstPersonInspection.passed && fixedResolution &&
      views.every(view => view.timingIntegrity.valid && view.frames > 30 && view.turningVerified && view.poseVerified && !view.after.paused &&
        (!view.gpu.available || view.gpu.samples > 4)) &&
      !ERRORS.some(error => error.kind !== 'console-warning');
    writeResult({ success: passed, test: 'bed-fixed-resolution-five-views', date: new Date().toISOString(),
      initial, fixedResolution, views, firstPersonInspection, errors: ERRORS });
    app.exit(passed ? 0 : 1);
  } catch (error) {
    writeResult({ success: false, test: 'bed-fixed-resolution-five-views', message: String(error), errors: ERRORS });
    app.exit(1);
  }
}

async function runBedSurfaceCapture(win) {
  try {
    const initial = await win.webContents.executeJavaScript(buildBedPrepareScript(BENCHMARK_QUALITY || 'performance'));
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const captures = [];
    const views = BED_SURFACE_BASE_ONLY ? ['bed-left', 'bed-foot', 'bed-right', 'shadow'] : ['bed-left', 'bed-foot'];
    const modes = BED_SURFACE_BASE_ONLY ? ['base'] : ['base', 'normal-off', 'receive-shadow-off', 'shadow-bias', 'shadow-filter'];
    for (const view of views) {
      await win.webContents.executeJavaScript('window.Quarto01.setDiagnosticView(' + JSON.stringify(view) + ')');
      for (const mode of modes) {
        const snapshot = await win.webContents.executeJavaScript(`(async () => {
          const room = window.Quarto01, firstFrame = room.getPerformanceSnapshot().totalFrames;
          if (room.setDiagnosticFabricMode(${JSON.stringify(mode)}) !== true) throw new Error('Modo de tecido indisponível.');
          const deadline = performance.now() + 20000;
          while (room.getPerformanceSnapshot().totalFrames < firstFrame + 12) {
            if (performance.now() > deadline) throw new Error('O tecido não terminou de renderizar.');
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          await new Promise(resolve => setTimeout(resolve, 300));
          return room.getPerformanceSnapshot();
        })()`);
        const filename = path.join(RESULTS_DIR, view + '-' + mode + '.png');
        fs.writeFileSync(filename, (await win.webContents.capturePage()).toPNG());
        captures.push({ view, mode, filename, snapshot });
      }
    }
    await win.webContents.executeJavaScript("window.Quarto01.setDiagnosticFabricMode('base')");
    const cameraUnchanged = views.every(view => {
      const frames = captures.filter(item => item.view === view);
      const camera = JSON.stringify([frames[0].snapshot.cameraPosition, frames[0].snapshot.cameraQuaternion]);
      return frames.every(item => JSON.stringify([item.snapshot.cameraPosition, item.snapshot.cameraQuaternion]) === camera);
    });
    const passed = captures.length === views.length * modes.length && captures.every(item => item.snapshot.ready && !item.snapshot.paused) &&
      cameraUnchanged && !ERRORS.some(error => error.kind !== 'console-warning');
    writeResult({ success: passed, test: BED_SURFACE_BASE_ONLY ? 'bed-and-wall-base-views' : 'bed-surface-same-camera-five-modes', initial, cameraUnchanged, captures, errors: ERRORS });
    app.exit(passed ? 0 : 1);
  } catch (error) {
    writeResult({ success: false, test: 'bed-surface-same-camera-five-modes', message: String(error), errors: ERRORS });
    app.exit(1);
  }
}

async function captureAtmosphereView(win, view, label, options) {
  await focusDiagnosticWindow(win);
  const snapshot = await win.webContents.executeJavaScript(`(async () => {
    const room = window.Quarto01, firstFrame = room.getPerformanceSnapshot().totalFrames;
    if (!room.setDiagnosticView(${JSON.stringify(view)}) || !room.setDiagnosticAtmosphere(${JSON.stringify(options)})) throw new Error('Vista climática inválida.');
    const deadline = performance.now() + 20000;
    while (room.getPerformanceSnapshot().totalFrames < firstFrame + 12) {
      if (performance.now() > deadline) throw new Error('O clima não terminou de renderizar.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    return room.getPerformanceSnapshot();
  })()`);
  const image = await win.webContents.capturePage(), filename = path.join(RESULTS_DIR, label + '.png');
  fs.writeFileSync(filename, image.toPNG());
  return { view, label, filename, snapshot, image };
}

async function focusDiagnosticWindow(win) {
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  await win.webContents.executeJavaScript(`(async () => {
    const deadline = performance.now() + 15000;
    while (document.hidden || !document.hasFocus() || window.Quarto01.getPerformanceSnapshot().paused) {
      if (performance.now() > deadline) throw new Error('O diagnóstico precisa da janela visível e em foco.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  })()`);
}

async function measureDiagnosticView(win, plan) {
  const interruptedAttempts = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    await focusDiagnosticWindow(win);
    const result = await win.webContents.executeJavaScript(buildBedPhaseScript(plan));
    if (result.timingIntegrity.valid) return { ...result, attempt, interruptedAttempts };
    interruptedAttempts.push(result);
    if (attempt === 3) return { ...result, attempt, interruptedAttempts };
  }
}

function compareDiagnosticImages(first, second) {
  const size = first.getSize(1), a = first.toBitmap({ scaleFactor: 1 }), b = second.toBitmap({ scaleFactor: 1 });
  if (a.length !== b.length) throw new Error('Tamanhos das capturas não coincidem.');
  let changedPixels = 0, secondDarkerPixels = 0, delta = 0, count = 0;
  for (let y = Math.floor(size.height * .08); y < size.height * .9; y++) {
    for (let x = Math.floor(size.width * .05); x < size.width * .95; x++) {
      const i = (y * size.width + x) * 4;
      const difference = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      if (difference > 6) changedPixels++;
      if (a[i] + a[i + 1] + a[i + 2] - b[i] - b[i + 1] - b[i + 2] > 12) secondDarkerPixels++;
      delta += difference; count++;
    }
  }
  return { changedPixels, secondDarkerPixels, meanAbsoluteChannelDelta: delta / Math.max(1, count * 3) };
}

async function runWeatherBenchmark(win) {
  try {
    const initial = await win.webContents.executeJavaScript(buildBedPrepareScript(BENCHMARK_QUALITY || 'performance'));
    const sourceOff = !initial.snapshot.audio.initialized && !initial.snapshot.audio.unlocked && initial.snapshot.audio.contextState === 'locked';
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    await win.webContents.executeJavaScript(`(async () => {
      window.Quarto01.setDiagnosticView('window-close');
      window.Quarto01.setDiagnosticAtmosphere({ time: 0, frozen: false, rain: true, lamp: 1 });
      await new Promise(resolve => setTimeout(resolve, 1000));
    })()`);
    const phases = [], captures = [], rainPairs = [];
    for (const view of ['window', 'window-close']) {
      const images = [];
      for (const rain of [false, true]) {
        const label = view + (rain ? '-rain' : '-dry');
        await win.webContents.executeJavaScript('window.Quarto01.setDiagnosticAtmosphere(' + JSON.stringify({ time: 0, frozen: false, rain, lamp: 1 }) + ')');
        const phase = await measureDiagnosticView(win, { id: label, view, duration: 4000, turn: false });
        phases.push({ ...phase, rain });
        const capture = await captureAtmosphereView(win, view, label, { time: 2.5, frozen: true, rain, lamp: 1 });
        images.push(capture.image);
        const { image: _image, ...record } = capture; captures.push(record);
      }
      const last = captures.slice(-2);
      const cameraUnchanged = JSON.stringify([last[0].snapshot.cameraPosition, last[0].snapshot.cameraQuaternion]) ===
        JSON.stringify([last[1].snapshot.cameraPosition, last[1].snapshot.cameraQuaternion]);
      rainPairs.push({ view, cameraUnchanged, ...compareDiagnosticImages(images[0], images[1]) });
    }
    const stable = await captureAtmosphereView(win, 'initial', 'lamp-stable', { time: 0, frozen: true, rain: true, lamp: 1 });
    const dim = await captureAtmosphereView(win, 'initial', 'lamp-dim', { time: 0, frozen: true, rain: true, lamp: .12 });
    const lightDifference = compareDiagnosticImages(stable.image, dim.image);
    for (const capture of [stable, dim]) { const { image: _image, ...record } = capture; captures.push(record); }
    await win.webContents.executeJavaScript('window.Quarto01.setDiagnosticAtmosphere({ time: 0, frozen: true, rain: true, lamp: 1 })');
    const unlocked = await win.webContents.executeJavaScript("window.Quarto01.diagnosticAudio('unlock')", true);
    const audio = await win.webContents.executeJavaScript(buildWeatherAudioScript());
    const flicker = await captureAtmosphereView(win, 'initial', 'lamp-flicker',
      { time: audio.flicker.minimum.time, frozen: true, rain: true, lamp: null });
    { const { image: _image, ...record } = flicker; captures.push(record); }
    await win.webContents.executeJavaScript("window.Quarto01.setQuality('quality')");
    const qualityClose = await captureAtmosphereView(win, 'window-close', 'window-close-rain-quality',
      { time: 2.5, frozen: true, rain: true, lamp: 1 });
    { const { image: _image, ...record } = qualityClose; captures.push(record); }
    await win.webContents.executeJavaScript("window.Quarto01.setQuality('performance')");
    await win.webContents.executeJavaScript('window.Quarto01.setDiagnosticAtmosphere({ frozen: false, rain: true, lamp: null })');
    const fixedResolution = phases.every(phase => phase.fixedResolution &&
      phase.before.drawingBufferWidth === initial.snapshot.drawingBufferWidth &&
      phase.before.drawingBufferHeight === initial.snapshot.drawingBufferHeight);
    const noInteriorPoints = phases.every(phase => phase.after.renderStats.points === 0);
    const rainStateVerified = phases.every(phase => phase.after.atmosphere.rain.enabled === phase.rain &&
      phase.after.atmosphere.rain.drawCalls === (phase.rain ? 2 : 0) && phase.after.atmosphere.rain.shadowPasses === 0);
    const passed = sourceOff && unlocked === true && audio.passed && fixedResolution && noInteriorPoints && rainStateVerified &&
      phases.every(phase => phase.timingIntegrity.valid && phase.poseVerified && phase.frames > 30 && (!phase.gpu.available || phase.gpu.samples > 4)) &&
      rainPairs.every(pair => pair.cameraUnchanged && pair.changedPixels > 50) && lightDifference.secondDarkerPixels > 500 &&
      !ERRORS.some(error => error.kind !== 'console-warning');
    writeResult({ success: passed, test: 'weather-rain-light-and-audio', initial, sourceOff, unlocked, fixedResolution,
      noInteriorPoints, rainStateVerified, phases, rainPairs, captures, lightDifference, audio, errors: ERRORS });
    app.exit(passed ? 0 : 1);
  } catch (error) {
    writeResult({ success: false, test: 'weather-rain-light-and-audio', message: String(error), errors: ERRORS });
    app.exit(1);
  }
}

async function runAudioProbe(win) {
  try {
    const initial = await win.webContents.executeJavaScript(buildBedPrepareScript('performance'));
    await focusDiagnosticWindow(win);
    const sourceOff = !initial.snapshot.audio.initialized && !initial.snapshot.audio.unlocked;
    const unlocked = await win.webContents.executeJavaScript("window.Quarto01.diagnosticAudio('unlock')", true);
    const audio = await win.webContents.executeJavaScript(buildWeatherAudioScript());
    const passed = sourceOff && unlocked === true && audio.passed && !ERRORS.some(error => error.kind !== 'console-warning');
    writeResult({ success: passed, test: 'audio-startup-clock-mute-pause-and-flicker', initial, sourceOff, unlocked, audio, errors: ERRORS });
    app.exit(passed ? 0 : 1);
  } catch (error) {
    writeResult({ success: false, test: 'audio-startup-clock-mute-pause-and-flicker', message: String(error), errors: ERRORS });
    app.exit(1);
  }
}

async function runQualitySmoke(win) {
  try {
    await win.webContents.executeJavaScript(`(async () => {
      const deadline = performance.now() + 90000;
      while (!window.Quarto01?.ready || !document.body.classList.contains('ready')) {
        if (performance.now() > deadline) throw new Error('O quarto não terminou de carregar.');
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      await new Promise(resolve => setTimeout(resolve, 2500));
    })()`);
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const snapshots = [];
    const firstPersonInspections = [];
    const qualityOrder = QUALITY_STEADY_PROBE ? ['quality', 'performance'] : ['performance', 'balanced', 'quality', 'performance'];
    for (const quality of qualityOrder) {
      await focusDiagnosticWindow(win);
      const snapshot = await win.webContents.executeJavaScript(`(async () => {
        const firstFrame = window.Quarto01.getPerformanceSnapshot().totalFrames;
        window.Quarto01.setQuality(${JSON.stringify(quality)});
        const deadline = performance.now() + 20000;
        while (window.Quarto01.getPerformanceSnapshot().totalFrames < firstFrame + 12) {
          if (performance.now() > deadline) throw new Error('O perfil não terminou de renderizar.');
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        await new Promise(resolve => setTimeout(resolve, 350));
        await new Promise(resolve => requestAnimationFrame(resolve));
        let steadyProbe = null;
        if (${JSON.stringify(QUALITY_STEADY_PROBE)}) {
          await new Promise(resolve => setTimeout(resolve, 1500));
          const started = performance.now(), before = window.Quarto01.getPerformanceSnapshot().totalFrames;
          await new Promise(resolve => setTimeout(resolve, 3000));
          const elapsed = performance.now() - started;
          const count = window.Quarto01.getPerformanceSnapshot().totalFrames - before;
          const trace = window.Quarto01.getPerformanceTrace(), times = trace.frameTimes.slice(-count);
          const cpu = trace.cpuTimes.slice(-count), sorted = times.slice().sort((a, b) => a - b);
          const percentile = p => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
          steadyProbe = { durationMs: elapsed, frames: count, renderedFPS: count * 1000 / elapsed,
            p95FrameMs: percentile(.95), p99FrameMs: percentile(.99),
            meanCpuMs: cpu.reduce((a, b) => a + b, 0) / cpu.length, frameTimes: times, cpuTimes: cpu };
        }
        return {
          ...window.Quarto01.getPerformanceSnapshot(),
          steadyProbe,
          loadingVisible: !document.getElementById('loading').classList.contains('hidden'),
          errorVisible: !document.getElementById('errorPanel').classList.contains('hidden'),
        };
      })()`);
      snapshots.push(snapshot);
      firstPersonInspections.push(await win.webContents.executeJavaScript(INSPECT_FIRST_PERSON));
      fs.writeFileSync(path.join(RESULTS_DIR, quality + '.png'), (await win.webContents.capturePage()).toPNG());
    }
    const passed = snapshots.every((snapshot, index) => snapshot.quality === qualityOrder[index]) &&
      snapshots.every(snapshot => snapshot.ready && !snapshot.paused && !snapshot.loadingVisible && !snapshot.errorVisible) &&
      snapshots.every(snapshot => snapshot.contextMsaaSamples === 0 && (!NO_FXAA_BENCHMARK
        ? snapshot.renderTargetSamples === 0 && snapshot.antialiasing === 'fxaa' && snapshot.postprocessing && snapshot.colorPasses === 3
        : snapshot.quality === 'quality'
          ? snapshot.renderTargetSamples === 4 && snapshot.postprocessing && snapshot.colorPasses === 2
          : snapshot.renderTargetSamples === 0 && !snapshot.postprocessing && snapshot.colorPasses === 1)) &&
      (!QUALITY_STEADY_PROBE || snapshots.every(snapshot => snapshot.steadyProbe?.frames > 10)) &&
      firstPersonInspections.every(inspection => inspection.passed) &&
      !ERRORS.some(error => error.kind !== 'console-warning');
    writeResult({ success: passed, test: QUALITY_STEADY_PROBE ? 'quality-steady-three-second-probe' : 'three-quality-profiles-and-return-smoke', snapshots, firstPersonInspections, errors: ERRORS });
    app.exit(passed ? 0 : 1);
  } catch (error) {
    writeResult({ success: false, test: QUALITY_STEADY_PROBE ? 'quality-steady-three-second-probe' : 'three-quality-profiles-and-return-smoke', message: String(error), errors: ERRORS });
    app.exit(1);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 720, minWidth: 900, minHeight: 600,
    title: BENCHMARK ? 'Quarto 01 — Teste automático' : 'Quarto 01', backgroundColor: '#11110f', show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
      backgroundThrottling: true, spellcheck: false,
    },
  });
  const win = mainWindow;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, destination) => {
    if (destination !== APP_URL) event.preventDefault();
  });
  win.webContents.on('will-redirect', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.on('before-input-event', (event, input) => {
    if (BENCHMARK) { event.preventDefault(); return; }
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault(); win.setFullScreen(!win.isFullScreen());
    }
    if (input.type === 'keyDown' && input.key === 'Escape' && win.isFullScreen()) win.setFullScreen(false);
  });
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error' || details.level === 'warning') {
      ERRORS.push({ kind: details.level === 'error' ? 'console-error' : 'console-warning', message: details.message });
    }
  });
  win.webContents.on('preload-error', (_event, _preloadPath, error) => ERRORS.push({ kind: 'preload-error', message: String(error) }));
  win.webContents.on('did-fail-load', (_event, code, message) => ERRORS.push({ kind: 'load-error', code, message }));
  win.webContents.on('render-process-gone', (_event, details) => {
    ERRORS.push({ kind: 'renderer-crash', reason: details.reason });
    if (BENCHMARK) { writeResult({ success: false, errors: ERRORS }); app.exit(1); }
  });
  win.once('ready-to-show', () => win.show());
  const notifyVisibility = paused => {
    if (!win.isDestroyed()) win.webContents.send('quarto:visibility', paused);
  };
  win.on('blur', () => notifyVisibility(true));
  win.on('minimize', () => notifyVisibility(true));
  win.on('focus', () => notifyVisibility(false));
  win.on('restore', () => notifyVisibility(false));
  win.on('closed', () => { mainWindow = null; });
  win.loadURL(APP_URL).then(async () => {
    if (BENCHMARK) {
      await win.webContents.executeJavaScript(INSTALL_DIAGNOSTIC_INPUT_GUARD);
      win.setTitle('Quarto 01 — Teste automático');
    }
    if (AUDIO_PROBE) runAudioProbe(win);
    else if (WEATHER_BENCHMARK) runWeatherBenchmark(win);
    else if (BED_SURFACES) runBedSurfaceCapture(win);
    else if (BED_BENCHMARK) runBedBenchmark(win);
    else if (CAPTURE_VIEWS_ONLY) runShadowCapture(win);
    else if (SMOKE_PROFILE_CYCLE) runQualitySmoke(win);
    else if (BENCHMARK) runBenchmark(win);
  });
}

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) {
  if (BENCHMARK) {
    writeResult({ success: false, message: 'Feche a outra instância do Quarto 01 antes de executar o benchmark.' });
    app.exit(2);
  } else app.quit();
}
else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    // Every runtime request must stay in the packaged room. No HTTP, remote
    // models, analytics, login, updates, or browser extensions are needed.
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = details.url.startsWith('app://quarto/') || details.url.startsWith('data:') || details.url.startsWith('blob:');
      callback({ cancel: !allowed });
    });
    const ownPage = contents => Boolean(contents && contents.getURL().startsWith('app://quarto/'));
    const localPermissions = new Set(['pointerLock', 'fullscreen']);
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(ownPage(contents) && localPermissions.has(permission)));
    session.defaultSession.setPermissionCheckHandler((contents, permission) => ownPage(contents) && localPermissions.has(permission));
    protocol.handle('app', serveLocal);
    ipcMain.on('quarto:diagnostics', (event, json) => {
      if (event.sender !== mainWindow?.webContents || typeof json !== 'string' || json.length >= 65536) return;
      try { latestRendererReport = JSON.parse(json); } catch { /* Invalid optional report. */ }
    });
    createWindow();
    if (BENCHMARK) {
      setTimeout(() => {
        writeResult({ success: false, message: 'O benchmark ultrapassou o limite de 130 segundos.', errors: ERRORS });
        app.exit(1);
      }, 130000).unref();
    }
  }).catch(error => {
    if (BENCHMARK) writeResult({ success: false, message: String(error), errors: ERRORS });
    else dialog.showErrorBox('Quarto 01', 'Não foi possível abrir o quarto.\n' + String(error));
    app.exit(1);
  });
  app.on('window-all-closed', () => app.quit());
}
