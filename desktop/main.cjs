'use strict';

const { app, BrowserWindow, Menu, protocol, session, ipcMain, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildBenchmarkScript } = require('./benchmark-renderer.cjs');

const NO_MSAA_BENCHMARK = process.argv.includes('--benchmark-no-msaa');
const FORCE_MSAA4_BENCHMARK = process.argv.includes('--benchmark-msaa4');
const APP_URL = 'app://quarto/index.html' + (FORCE_MSAA4_BENCHMARK ? '?msaa=4' : NO_MSAA_BENCHMARK ? '?msaa=0' : '');
const CONTENT_ROOT = path.resolve(__dirname, 'dist');
const QUALITY_STEADY_PROBE = process.argv.includes('--quality-steady-probe');
const SMOKE_PROFILE_CYCLE = process.argv.includes('--smoke-profile-cycle') || QUALITY_STEADY_PROBE;
const CAPTURE_VIEWS_ONLY = process.argv.includes('--capture-views-only');
const BENCHMARK = process.argv.includes('--benchmark') || SMOKE_PROFILE_CYCLE || CAPTURE_VIEWS_ONLY;
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
  console.log(JSON.stringify({ benchmarkFile: filename, ...result }));
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

async function captureDiagnosticView(win, view) {
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

async function runShadowCapture(win) {
  try {
    await win.webContents.executeJavaScript(`(async () => {
      const deadline = performance.now() + 90000;
      while (!window.Quarto01?.ready || !document.body.classList.contains('ready')) {
        if (performance.now() > deadline) throw new Error('O quarto não terminou de carregar.');
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (typeof window.Quarto01.setDiagnosticShadowEnabled !== 'function') throw new Error('Toggle de sombra de diagnóstico ausente.');
      // Let Chromium present the removal of the loading overlay before the
      // first comparison. Capturing its stale compositor layer biases the diff.
      await new Promise(resolve => setTimeout(resolve, 2500));
      window.Quarto01.setDiagnosticView('shadow');
    })()`);
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
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
      const filename = path.join(RESULTS_DIR, enabled ? 'shadow-on.png' : 'shadow-off.png');
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
    const passed = captures[0].snapshot.playerShadow.active && !captures[1].snapshot.playerShadow.active &&
      captures.every(capture => !capture.snapshot.loadingVisible) &&
      cameraUnchanged && darkenedPixels - brightenedPixels > 500 && !ERRORS.some(error => error.kind !== 'console-warning');
    writeResult({ success: passed, test: 'shadow-on-off-same-camera', captures, difference, errors: ERRORS });
    app.exit(passed ? 0 : 1);
  } catch (error) {
    writeResult({ success: false, test: 'shadow-on-off-same-camera', message: String(error), errors: ERRORS });
    app.exit(1);
  }
}

async function runBenchmark(win) {
  try {
    const metrics = await win.webContents.executeJavaScript(buildBenchmarkScript(BENCHMARK_QUALITY));
    const firstPersonInspection = await win.webContents.executeJavaScript(INSPECT_FIRST_PERSON);
    const gpu = await app.getGPUInfo('basic');
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const screenshotPath = path.join(RESULTS_DIR, 'latest.png');
    const image = await win.webContents.capturePage();
    fs.writeFileSync(screenshotPath, image.toPNG());
    const captures = [];
    for (const view of ['shadow', 'blanket']) captures.push(await captureDiagnosticView(win, view));
    const passed = firstPersonInspection.passed && metrics.movementVerified && metrics.turningVerified &&
      metrics.runningVerified && metrics.shadowMovementVerified &&
      metrics.renderer.version === app.getVersion() &&
      metrics.startSnapshot.view === 'first-person' && metrics.renderer.view === 'first-person' &&
      !metrics.errorVisible && !metrics.loadingVisible &&
      !metrics.renderer.paused && metrics.renderer.benchmarkSamples >= 100 &&
      !ERRORS.some(error => error.kind !== 'console-warning');
    writeResult({ success: passed, date: new Date().toISOString(), electron: process.versions.electron,
      chromium: process.versions.chrome, gpuFeatureStatus: app.getGPUFeatureStatus(), gpu,
      metrics, firstPersonInspection, screenshotPath, captures, rendererReport: latestRendererReport, errors: ERRORS });
    app.exit(passed ? 0 : 1);
  } catch (error) {
    writeResult({ success: false, date: new Date().toISOString(), message: String(error), errors: ERRORS });
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
      snapshots.every(snapshot => snapshot.contextMsaaSamples === 0 && (snapshot.quality === 'quality'
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
    title: 'Quarto 01', backgroundColor: '#11110f', show: false,
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
  win.loadURL(APP_URL).then(() => {
    if (CAPTURE_VIEWS_ONLY) runShadowCapture(win);
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
