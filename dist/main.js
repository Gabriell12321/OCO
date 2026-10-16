import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { createRenderPipeline } from './engine/render-pipeline.js';
import { compileStaticScene } from './engine/static-scene.js';
import { ResolutionGovernor } from './engine/resolution-governor.js';
import { createShadowChunk } from './engine/shadow-filter.js';
import { createMaterials } from './materials.js';
import { createRoom } from './room.js';
import { createControls } from './controls.js';
import { createPlayerShadow } from './player-shadow.js';
import { PROFILES, PerformanceMonitor, GpuTimer, drawingSize } from './performance.js';

const canvas = document.getElementById('scene');
const progress = document.getElementById('loadingProgress');
const label = document.getElementById('loadingText');
const qualityButton = document.getElementById('qualityBtn');
const qualityStatus = document.getElementById('qualityStatus');
const monitor = new PerformanceMonitor();
let renderer, controls, room, scene, camera, frameHandle = 0;
let playerShadow, gpuTimer;
let pipeline, staticSceneStats;
const resolutionGovernor = new ResolutionGovernor();
let diagnosticResolutionLock = false;
const diagnosticFabricState = new Map();
const diagnosticQuery = Boolean(window.desktopDiagnostics) ? new URLSearchParams(location.search) : new URLSearchParams();
const useFXAA = diagnosticQuery.get('fxaa') !== '0';
let quality = 'performance', ready = false, desktopPaused = false;
let adaptiveScale = 1;
let previousTick = 0, previousRender = 0, accumulator = 0, elapsed = 0;
const shadowLights = [];
const lightingProfiles = { full: [], efficient: [] };
const surfaceProfiles = new Map();
let gpuRenderer = '', gpuVendor = '', msaaSamples = 0;
const STEP_MS = 1000 / 60;
const LAMP_SHADOW = Object.freeze({ bias: -.0005, normalBias: .012, radius: 4.2 });
const LAMP_SHADOW_SIZE = 1024;

// OCO point-light filtering accounts for the receiver plane at each tap.
const efficientShadowChunk = createShadowChunk(false);
const fullShadowChunk = createShadowChunk(true);

function registerSurfaceProfiles() {
  scene.traverse(object => {
    if (!object.isMesh) return;
    for (const material of [object.material].flat()) {
      if (!material?.isMeshStandardMaterial || surfaceProfiles.has(material)) continue;
      surfaceProfiles.set(material, { sheen: material.sheen || 0 });
      const originalCompile = material.onBeforeCompile;
      const originalKey = material.customProgramCacheKey();
      material.onBeforeCompile = function (shader, context) {
        originalCompile.call(this, shader, context);
        const chunk = quality === 'quality' ? fullShadowChunk : efficientShadowChunk;
        if (playerShadow) playerShadow.patchShader(shader, chunk);
        else shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', chunk);
      };
      material.customProgramCacheKey = () => originalKey + '|quarto-human-shadow-v1-' + (quality === 'quality' ? 'full' : 'four');
    }
  });
}

function applyLightingProfile() {
  const full = quality === 'quality';
  lightingProfiles.full.forEach(light => { light.visible = full; });
  lightingProfiles.efficient.forEach(light => { light.visible = !full; });
  for (const [material, original] of surfaceProfiles) {
    if (material.isMeshPhysicalMaterial) material.sheen = full ? original.sheen : 0;
    material.needsUpdate = true;
  }
}

function simplifyMaterials() {
  const visited = new Set();
  scene.traverse(object => {
    if (!object.isMesh) return;
    for (const material of [object.material].flat()) {
      if (!material || visited.has(material)) continue;
      visited.add(material);
      if (material.transmission > 0) {
        // A transmitting shade triggers another full-scene render. Keep its
        // cloth normal map and use gentle emitted light for the warm fabric.
        material.transmission = 0; material.emissive?.set('#e9c697');
        material.emissiveMap = material.userData.lampEmission || material.map;
        material.emissiveIntensity = 1.25; material.needsUpdate = true;
      }
      for (const value of Object.values(material)) {
        if (value?.isTexture && value.anisotropy > 4) {
          value.anisotropy = 4; value.needsUpdate = true;
        }
      }
    }
  });
}

function addLighting() {
  RectAreaLightUniformsLib.init();
  scene.add(new THREE.HemisphereLight(0x9aa9ba, 0x27231e, .12));
  const windowLight = new THREE.RectAreaLight(0xa1b7cb, .85, 1.56, 1.48);
  windowLight.position.copy(room.windowPosition).add(new THREE.Vector3(0, 0, .17));
  windowLight.lookAt(-.5, 1.1, 1.7); scene.add(windowLight);
  lightingProfiles.full.push(windowLight);
  const windowFill = new THREE.PointLight(0xa1b7cb, .75, 8, 2);
  windowFill.position.copy(room.windowPosition).add(new THREE.Vector3(0, 0, .24));
  scene.add(windowFill); lightingProfiles.efficient.push(windowFill);
  const moon = new THREE.DirectionalLight(0xacc2d5, .16);
  moon.position.set(-1, 4.2, -7.5); moon.target.position.set(.6, .2, 1.8);
  moon.castShadow = true; moon.shadow.mapSize.set(1024, 1024);
  moon.shadow.camera.left = -5; moon.shadow.camera.right = 5;
  moon.shadow.camera.top = 5; moon.shadow.camera.bottom = -5;
  moon.shadow.camera.near = .2; moon.shadow.camera.far = 20;
  moon.shadow.bias = -.00012; moon.shadow.normalBias = .008; moon.shadow.radius = 3;
  scene.add(moon, moon.target);
  const lamp = new THREE.PointLight(0xffd1a0, 5.8, 6, 2);
  lamp.position.copy(room.lampPosition); lamp.castShadow = true;
  lamp.shadow.mapSize.set(LAMP_SHADOW_SIZE, LAMP_SHADOW_SIZE);
  lamp.shadow.camera.near = .04; lamp.shadow.camera.far = 8;
  Object.assign(lamp.shadow, LAMP_SHADOW);
  scene.add(lamp);
  shadowLights.push(moon, lamp);
  const bounce = new THREE.RectAreaLight(0xffd9b1, .55, .65, .45);
  bounce.position.copy(room.lampPosition).add(new THREE.Vector3(.05, .65, -.25));
  bounce.lookAt(-.4, 2.8, -1.8); scene.add(bounce);
  lightingProfiles.full.push(bounce);
  const lampFill = new THREE.PointLight(0xffd9b1, .40, 4.5, 2);
  lampFill.position.copy(bounce.position); scene.add(lampFill);
  lightingProfiles.efficient.push(lampFill);
  const coolBounce = new THREE.PointLight(0xa6b9c6, .42, 6, 2);
  coolBounce.position.set(1.1, 1.9, -.3); scene.add(coolBounce);
}

function resizeDrawingBuffer() {
  if (!renderer || !camera) return;
  const { width, height } = drawingSize(innerWidth, innerHeight, devicePixelRatio, quality, adaptiveScale);
  renderer.setPixelRatio(1); renderer.setSize(width, height, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  pipeline?.resize(width, height, quality);
}

function renderRoom() { pipeline.render(scene, camera); }

function cacheShadows() {
  // Furniture and lights never move. Their seven shadow views are computed only
  // at load/profile changes. The human uses its own tiny single-view depth map.
  renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
  const size = quality === 'quality' ? 2048 : 1024;
  for (const light of shadowLights) {
    const mapSize = light.isDirectionalLight ? size : LAMP_SHADOW_SIZE;
    if (light.shadow.mapSize.x !== mapSize) {
      light.shadow.map?.dispose(); light.shadow.map = null;
      light.shadow.mapSize.set(mapSize, mapSize);
    }
    light.shadow.autoUpdate = false; light.shadow.needsUpdate = true;
  }
}

function setQuality(value) {
  if (!PROFILES[value]) return;
  quality = value; adaptiveScale = 1;
  resolutionGovernor.reset(performance.now());
  if (qualityButton) {
    qualityButton.textContent = PROFILES[quality].label;
    qualityButton.setAttribute('aria-label', 'Qualidade: ' + PROFILES[quality].label + '. Clique para alternar.');
    qualityButton.removeAttribute('aria-pressed'); qualityButton.disabled = false;
  }
  document.body.dataset.quality = quality;
  resizeDrawingBuffer();
  applyLightingProfile();
  if (renderer && shadowLights.length) cacheShadows();
}

function getPerformanceSnapshot() {
  const stats = monitor.snapshot();
  const width = renderer?.domElement.width || 0, height = renderer?.domElement.height || 0;
  return {
    ...stats, version: '0.7.0', ready, quality, qualityLabel: PROFILES[quality].label,
    character: false, firstPersonOnly: true,
    renderer: 'WebGL2', pathTracing: false, shadows: 'cached',
    engine: 'OCO', engineBackend: 'Three.js / WebGL2', engineVersion: '0.1',
    staticScene: staticSceneStats || null, bed: room?.bedMetrics || null,
    gpuRenderer, gpuVendor,
    ...pipeline?.snapshot(msaaSamples),
    gpuTiming: gpuTimer?.snapshot() || null,
    playerShadow: playerShadow?.snapshot() || { active: false },
    shadowFilter: quality === 'quality' ? 'receiver-plane-nine-tap' : 'receiver-plane-four-tap',
    areaLights: quality === 'quality' ? 2 : 0,
    adaptiveScale: Math.round(adaptiveScale * 100) / 100,
    drawingBufferWidth: width, drawingBufferHeight: height, width, height,
    renderCalls: renderer?.info.render.calls || 0, triangles: renderer?.info.render.triangles || 0,
    renderStats: renderer ? { ...renderer.info.render } : {},
    playerPosition: controls ? { x: controls.position.x, y: controls.position.y, z: controls.position.z } : null,
    cameraPosition: camera ? { x: camera.position.x, y: camera.position.y, z: camera.position.z } : null,
    cameraQuaternion: camera ? camera.quaternion.toArray() : null,
    cameraYaw: controls?.yaw || 0, cameraPitch: controls?.pitch || 0,
    gait: controls?.gait ? { ...controls.gait } : null,
    view: 'first-person', moving: controls?.moving || false, running: controls?.running || false,
    staticSceneMatrices: 'cached',
    textures: renderer?.info.memory.textures || 0, geometries: renderer?.info.memory.geometries || 0,
    paused: document.hidden || desktopPaused,
  };
}

function updateDiagnostics(now) {
  const baseSize = drawingSize(innerWidth, innerHeight, devicePixelRatio, quality, 1);
  const scale = resolutionGovernor.update({ now, fps: monitor.fps,
    gpuMs: gpuTimer?.snapshot().recentMeanMs, pixels: baseSize.width * baseSize.height,
    enabled: !diagnosticResolutionLock });
  if (Math.abs(scale - adaptiveScale) > .001) {
    adaptiveScale = scale; resizeDrawingBuffer();
  }

  const metrics = getPerformanceSnapshot();
  if (qualityStatus) qualityStatus.textContent = `${Math.round(metrics.fps)} FPS · ${metrics.width} × ${metrics.height}`;
  window.desktopDiagnostics?.report?.(metrics);
}

function pause() {
  desktopPaused = true; cancelAnimationFrame(frameHandle); frameHandle = 0;
  monitor.suspend(); previousTick = previousRender = accumulator = 0;
}

function resume() {
  desktopPaused = false;
  if (ready && !document.hidden && !frameHandle) frameHandle = requestAnimationFrame(frame);
}

function frame(now) {
  frameHandle = 0;
  if (document.hidden || desktopPaused) return;
  frameHandle = requestAnimationFrame(frame);
  if (!previousTick) { previousTick = previousRender = now; return; }
  accumulator += Math.min(now - previousTick, 100); previousTick = now;
  if (accumulator + .5 < STEP_MS) return;
  accumulator = Math.max(0, accumulator - STEP_MS);
  if (accumulator >= STEP_MS) accumulator %= STEP_MS;
  const frameTime = now - previousRender;
  const dt = Math.min(frameTime / 1000, .05); previousRender = now; elapsed += dt;
  const start = performance.now();
  gpuTimer.poll(); gpuTimer.begin();
  renderer.info.reset();
  controls.update(dt);
  for (const update of room.updates || []) update(elapsed, dt);
  playerShadow.update(controls, dt, now);
  renderRoom();
  gpuTimer.end();
  if (monitor.record(now, frameTime, performance.now() - start)) updateDiagnostics(now);
}

window.Quarto01 = {
  version: '0.7.0', renderer: 'WebGL2', character: false, firstPersonOnly: true,
  get ready() { return ready; }, get quality() { return quality; }, get fps() { return monitor.fps; },
  get frameTimes() { return monitor.frameTimes.slice(); },
  get renderStats() { return renderer ? { ...renderer.info.render } : {}; },
  getPerformanceSnapshot, setQuality, pause, resume,
  getPerformanceTrace: () => ({ frameTimes: monitor.frameTimes.slice(), cpuTimes: monitor.cpuTimes.slice() }),
  diagnosticLook: (dx, dy) => controls?.diagnosticLook?.(dx, dy),
  setDiagnosticShadowEnabled: value => playerShadow?.setEnabled(value),
  setDiagnosticView: setDiagnosticView,
  setDiagnosticFabricMode: mode => {
    if (!window.desktopDiagnostics || !ready || !['base', 'normal-off', 'receive-shadow-off', 'shadow-bias', 'shadow-filter'].includes(mode)) return false;
    // Save every shared material's initial state before changing any instance.
    scene.traverse(object => {
      if (!object.isMesh || !object.material?.userData.packedFabric) return;
      if (!diagnosticFabricState.has(object)) diagnosticFabricState.set(object, {
        receiveShadow: object.receiveShadow, normalScale: object.material.normalScale.clone(),
      });
    });
    for (const [object, original] of diagnosticFabricState) {
      object.receiveShadow = mode === 'receive-shadow-off' ? false : original.receiveShadow;
      object.material.normalScale.copy(original.normalScale);
      if (mode === 'normal-off') object.material.normalScale.set(0, 0);
    }
    const lamp = shadowLights.find(light => light.isPointLight);
    Object.assign(lamp.shadow, LAMP_SHADOW);
    if (mode === 'shadow-filter') lamp.shadow.radius = 1.5;
    cacheShadows();
    return true;
  },
  setDiagnosticResolutionLock: value => {
    if (!window.desktopDiagnostics) return false;
    diagnosticResolutionLock = Boolean(value);
    resolutionGovernor.reset(performance.now()); adaptiveScale = 1; resizeDrawingBuffer();
    return true;
  },
};

function setDiagnosticView(id) {
  if (!controls?.setDiagnosticPose) return false;
  const poses = {
    initial: { position: [1.5, 1.2], yaw: .6868176498, pitch: -.12 },
    shadow: { position: [1.5, -1.6], yaw: -2.299, pitch: 0 },
    feet: { position: [.7, -.8], yaw: -2.975, pitch: -1.38 },
    'feet-oblique': { position: [.7, -.8], yaw: -2.475, pitch: -1.38 },
    blanket: { position: [.85, .3], yaw: .77, pitch: -.4 },
    'bed-right': { position: [.85, .3], yaw: .77, pitch: -.4 },
    'bed-foot': { position: [-.4, .3], yaw: .2, pitch: -.4 },
    'bed-left': { position: [-2.4, -1.25], yaw: -1.344, pitch: -.52 },
  };
  if (!poses[id] || !controls.setDiagnosticPose(poses[id])) return false;
  playerShadow?.update(controls, 0, performance.now(), true);
  return true;
}

async function init() {
  // Desktop A/B can compare the same scene with ?fxaa=0 and optionally msaa=4.
  const diagnosticMSAA4 = !useFXAA && diagnosticQuery.get('msaa') === '4';
  renderer = new THREE.WebGLRenderer({ canvas, antialias: diagnosticMSAA4, powerPreference: 'high-performance', alpha: false });
  pipeline = createRenderPipeline(renderer, { fxaa: useFXAA });
  const gl = renderer.getContext(), debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  gpuRenderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  gpuVendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
  msaaSamples = gl.getParameter(gl.SAMPLES);
  gpuTimer = new GpuTimer(gl);
  // Include the separate one-draw human map in per-frame render statistics.
  renderer.info.autoReset = false;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene(); scene.background = new THREE.Color('#293e4d');
  scene.fog = new THREE.FogExp2(0x20272c, .007);
  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, .045, 45);
  camera.position.set(2.15, 1.62, 2.55); camera.lookAt(-.55, 1.2, -1.3);
  setQuality('performance');
  const [materials, environment] = await Promise.all([
    createMaterials(renderer, value => {
      progress.style.width = Math.min(65, Math.round((value > 1 ? value / 100 : value) * 65)) + '%';
    }),
    new HDRLoader().loadAsync('./assets/moonlit_room_1k.hdr').catch(error => { console.warn('HDRI indisponível.', error); return null; }),
  ]);
  if (environment) {
    environment.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = environment; scene.environmentIntensity = .055;
    scene.background = environment; scene.backgroundIntensity = .025; scene.backgroundBlurriness = .025;
    scene.environmentRotation.y = scene.backgroundRotation.y = .7;
  }
  label.textContent = 'Preparando os materiais do quarto...'; progress.style.width = '72%';
  room = createRoom(scene, materials); simplifyMaterials();
  staticSceneStats = compileStaticScene(scene); addLighting();
  playerShadow = createPlayerShadow(renderer, room.lampPosition);
  registerSurfaceProfiles(); applyLightingProfile();
  controls = createControls(camera, canvas, room.colliders);
  scene.updateMatrixWorld(true);
  // This room's meshes, lamps and furniture never change transform. Walking
  // only updates the independent camera and shadow proxy, avoiding hundreds of
  // redundant matrix updates and allocations on every frame.
  scene.matrixWorldAutoUpdate = false;
  label.textContent = 'Preparando as sombras do quarto...'; progress.style.width = '90%';
  cacheShadows();
  playerShadow.update(controls, 0, performance.now(), true);
  await renderer.compileAsync(scene, camera);
  renderRoom();
  qualityButton?.addEventListener('click', () => {
    const ids = Object.keys(PROFILES); setQuality(ids[(ids.indexOf(quality) + 1) % ids.length]);
  });
  window.addEventListener('resize', resizeDrawingBuffer);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(frameHandle); frameHandle = 0; monitor.suspend();
      previousTick = previousRender = accumulator = 0;
    } else if (!desktopPaused && !frameHandle) frameHandle = requestAnimationFrame(frame);
  });
  window.addEventListener('quarto:pause', pause); window.addEventListener('quarto:resume', resume);
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); pause(); ready = false;
    showError('A renderização foi interrompida. Reabra o quarto para continuar.');
  });
  ready = true; monitor.start(performance.now()); resolutionGovernor.reset(performance.now());
  progress.style.width = '100%'; document.getElementById('loading').classList.add('hidden');
  document.body.classList.add('ready'); resume();
  window.desktopDiagnostics?.report?.(getPerformanceSnapshot());
}

function showError(message) {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('errorPanel').classList.remove('hidden');
  document.getElementById('errorText').textContent = message;
}
init().catch(error => {
  console.error(error);
  showError('Não foi possível abrir o quarto em 3D. Ative a aceleração gráfica e reabra o programa.');
});
