import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
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
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const monitor = new PerformanceMonitor();
let renderer, controls, room, scene, camera, frameHandle = 0;
let playerShadow, gpuTimer;
let qualityTarget = null, outputPass = null, displayTarget = null, fxaaPass = null;
const diagnosticQuery = Boolean(window.desktopDiagnostics) ? new URLSearchParams(location.search) : new URLSearchParams();
const useFXAA = diagnosticQuery.get('fxaa') !== '0';
let quality = 'performance', ready = false, desktopPaused = false;
let adaptiveScale = 1, lowWindows = 0, highWindows = 0;
let previousTick = 0, previousRender = 0, accumulator = 0, elapsed = 0;
let animationAccumulator = 0, nextAdaptation = 0;
const shadowLights = [];
const lightingProfiles = { full: [], efficient: [] };
const surfaceProfiles = new Map();
let gpuRenderer = '', gpuVendor = '', msaaSamples = 0;
const STEP_MS = 1000 / 60;

// Keep soft shadows while avoiding the stock 16 directional + 9 cube-map
// comparisons per fragment on integrated GPUs. The quality profile retains
// Three's full filter. Original functions are dead-code-eliminated by GLSL.
const efficientShadowChunk = THREE.ShaderChunk.shadowmap_pars_fragment
  .replace('float getShadow(', 'float getShadowFull(')
  .replace('float getPointShadow(', 'float getPointShadowFull(') + `
#ifdef USE_SHADOWMAP
float getShadow(sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity,
    float shadowBias, float shadowRadius, vec4 shadowCoord) {
  shadowCoord.xyz /= shadowCoord.w;
  shadowCoord.z += shadowBias;
  if (shadowCoord.x < 0.0 || shadowCoord.x > 1.0 || shadowCoord.y < 0.0 ||
      shadowCoord.y > 1.0 || shadowCoord.z > 1.0) return 1.0;
  vec2 o = vec2(.75) / shadowMapSize;
  float value = texture2DCompare(shadowMap, shadowCoord.xy + vec2(-o.x,-o.y), shadowCoord.z)
    + texture2DCompare(shadowMap, shadowCoord.xy + vec2(o.x,-o.y), shadowCoord.z)
    + texture2DCompare(shadowMap, shadowCoord.xy + vec2(-o.x,o.y), shadowCoord.z)
    + texture2DCompare(shadowMap, shadowCoord.xy + vec2(o.x,o.y), shadowCoord.z);
  return mix(1.0, value * .25, shadowIntensity);
}
float getPointShadow(sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity,
    float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar) {
  float distanceToLight = length(shadowCoord.xyz);
  if (distanceToLight < shadowCameraNear || distanceToLight > shadowCameraFar) return 1.0;
  float depth = (distanceToLight - shadowCameraNear) / (shadowCameraFar - shadowCameraNear) + shadowBias;
  vec3 direction = normalize(shadowCoord.xyz);
  float texel = 1.0 / (shadowMapSize.y * 2.0);
  float o = shadowRadius * texel;
  float value = texture2DCompare(shadowMap, cubeToUV(direction + vec3(-o,-o,o), texel), depth)
    + texture2DCompare(shadowMap, cubeToUV(direction + vec3(-o,o,-o), texel), depth)
    + texture2DCompare(shadowMap, cubeToUV(direction + vec3(o,-o,-o), texel), depth)
    + texture2DCompare(shadowMap, cubeToUV(direction + vec3(o,o,o), texel), depth);
  return mix(1.0, value * .25, shadowIntensity);
}
#endif
`;

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
        const chunk = quality === 'quality' ? THREE.ShaderChunk.shadowmap_pars_fragment : efficientShadowChunk;
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

function optimizeStaticGeometry() {
  scene.updateMatrixWorld(true);
  const groups = new Map(), obsolete = new Set();
  scene.traverse(object => {
    if (!object.isMesh || Array.isArray(object.material) || object.material.transparent) return;
    const key = object.material.uuid + ':' + object.castShadow + ':' + object.receiveShadow;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(object);
  });
  for (const objects of groups.values()) {
    if (objects.length < 3) continue;
    const geometries = objects.map(object => {
      const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
      geometry.applyMatrix4(object.matrixWorld);
      return geometry;
    });
    const combined = mergeGeometries(geometries, false);
    geometries.forEach(geometry => geometry.dispose());
    if (!combined) continue;
    combined.computeBoundingBox(); combined.computeBoundingSphere();
    const mesh = new THREE.Mesh(combined, objects[0].material);
    mesh.castShadow = objects[0].castShadow; mesh.receiveShadow = objects[0].receiveShadow;
    mesh.name = 'Static room surfaces'; scene.add(mesh);
    objects.forEach(object => { obsolete.add(object.geometry); object.removeFromParent(); });
  }
  // Some details share geometry. Free only resources no retained mesh uses.
  scene.traverse(object => { if (object.isMesh) obsolete.delete(object.geometry); });
  obsolete.forEach(geometry => geometry.dispose());
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
  lamp.shadow.mapSize.set(512, 512);
  lamp.shadow.camera.near = .04; lamp.shadow.camera.far = 8;
  lamp.shadow.normalBias = .006; lamp.shadow.bias = -.00012; lamp.shadow.radius = 4.2;
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

function dust() {
  const count = 32, positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = Math.sin(i * 127.1) * 2.7;
    positions[i * 3 + 1] = .2 + ((i * 47) % 97) / 97 * 2.5;
    positions[i * 3 + 2] = Math.cos(i * 311.7) * 2.7;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    color: 0xcbd1c4, size: .008, transparent: true, opacity: .16, depthWrite: false, sizeAttenuation: true,
  }));
  scene.add(points);
  return time => {
    if (reducedMotion) return;
    for (let i = 0; i < count; i++) positions[i * 3 + 1] = .25 + (((i * 47) % 97) / 97 * 2.5 + time * .008) % 2.5;
    geometry.attributes.position.needsUpdate = true;
  };
}

function resizeDrawingBuffer() {
  if (!renderer || !camera) return;
  const { width, height } = drawingSize(innerWidth, innerHeight, devicePixelRatio, quality, adaptiveScale);
  renderer.setPixelRatio(1); renderer.setSize(width, height, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  if (useFXAA || quality === 'quality') {
    if (!qualityTarget) {
      // Tone mapping must precede FXAA: its edge detector expects display
      // luminance. Keep the room linear HDR until OutputPass, with no MSAA.
      qualityTarget = new THREE.WebGLRenderTarget(width, height, {
        type: THREE.HalfFloatType, samples: useFXAA ? 0 : Math.min(4, renderer.capabilities.maxSamples),
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        depthBuffer: true, stencilBuffer: false, generateMipmaps: false,
      });
      qualityTarget.texture.name = useFXAA ? 'Room linear HDR before tone mapping' : 'Quality HDR multisample resolve';
      qualityTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
      outputPass = new OutputPass(); outputPass.renderToScreen = !useFXAA;
      if (useFXAA) {
        displayTarget = new THREE.WebGLRenderTarget(width, height, {
          type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
          depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
        });
        // OutputPass writes sRGB-encoded values here. NoColorSpace prevents
        // the next texture fetch from silently decoding them back to linear.
        displayTarget.texture.name = 'Display luminance for FXAA';
        displayTarget.texture.colorSpace = THREE.NoColorSpace;
        fxaaPass = new FXAAPass(); fxaaPass.renderToScreen = true;
      }
    } else qualityTarget.setSize(width, height);
    displayTarget?.setSize(width, height); fxaaPass?.setSize(width, height);
  } else if (qualityTarget) {
    renderer.setRenderTarget(null);
    qualityTarget.dispose(); outputPass.dispose(); displayTarget?.dispose(); fxaaPass?.dispose();
    qualityTarget = outputPass = displayTarget = fxaaPass = null;
  }
}

function renderRoom() {
  if (qualityTarget) {
    renderer.setRenderTarget(qualityTarget); renderer.render(scene, camera);
    outputPass.render(renderer, displayTarget, qualityTarget);
    if (fxaaPass) fxaaPass.render(renderer, null, displayTarget);
  } else {
    renderer.setRenderTarget(null); renderer.render(scene, camera);
  }
}

function cacheShadows() {
  // Furniture and lights never move. Their seven shadow views are computed only
  // at load/profile changes. The human uses its own tiny single-view depth map.
  renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
  const size = quality === 'quality' ? 2048 : 1024;
  for (const light of shadowLights) {
    const mapSize = light.isDirectionalLight ? size : 512;
    if (light.shadow.mapSize.x !== mapSize) {
      light.shadow.map?.dispose(); light.shadow.map = null;
      light.shadow.mapSize.set(mapSize, mapSize);
    }
    light.shadow.autoUpdate = false; light.shadow.needsUpdate = true;
  }
}

function setQuality(value) {
  if (!PROFILES[value]) return;
  quality = value; adaptiveScale = 1; lowWindows = highWindows = 0;
  nextAdaptation = performance.now() + 5000;
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
    ...stats, version: '0.6.0', ready, quality, qualityLabel: PROFILES[quality].label,
    character: false, firstPersonOnly: true,
    renderer: 'WebGL2', pathTracing: false, postprocessing: Boolean(qualityTarget), shadows: 'cached',
    gpuRenderer, gpuVendor, msaaSamples: qualityTarget ? qualityTarget.samples : msaaSamples,
    contextMsaaSamples: msaaSamples,
    renderTargetSamples: qualityTarget?.samples || 0,
    renderPath: fxaaPass ? 'hdr-output-fxaa' : qualityTarget ? 'hdr-msaa-output' : 'direct',
    colorPasses: fxaaPass ? 3 : qualityTarget ? 2 : 1,
    antialiasing: fxaaPass ? 'fxaa' : (qualityTarget?.samples || msaaSamples) > 0 ? 'msaa' : 'none',
    resolve: fxaaPass ? 'fxaa-after-tone-mapping' : qualityTarget ? 'hardware-msaa' : 'none',
    gpuTiming: gpuTimer?.snapshot() || null,
    playerShadow: playerShadow?.snapshot() || { active: false },
    shadowFilter: quality === 'quality' ? 'full-pcf' : 'four-tap-soft',
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
  if (now >= nextAdaptation && monitor.fps > 0) {
    lowWindows = monitor.fps < 48 ? lowWindows + 1 : 0;
    highWindows = monitor.fps > 58 ? highWindows + 1 : 0;
    const minimum = Math.min(1, Math.sqrt(PROFILES.performance.pixels / PROFILES[quality].pixels));
    if (lowWindows >= 2 && adaptiveScale > minimum + .01) {
      adaptiveScale = Math.max(minimum, adaptiveScale * .85);
      lowWindows = highWindows = 0; resizeDrawingBuffer();
    } else if (highWindows >= 10 && adaptiveScale < .99) {
      adaptiveScale = Math.min(1, adaptiveScale / .9);
      lowWindows = highWindows = 0; resizeDrawingBuffer();
    }
  }
  const metrics = getPerformanceSnapshot();
  if (qualityStatus) qualityStatus.textContent = `${Math.round(metrics.fps)} FPS · ${metrics.width} × ${metrics.height}`;
  window.desktopDiagnostics?.report?.(metrics);
}

function pause() {
  desktopPaused = true; cancelAnimationFrame(frameHandle); frameHandle = 0;
  monitor.suspend(); previousTick = previousRender = accumulator = animationAccumulator = 0;
}

function resume() {
  desktopPaused = false;
  if (ready && !document.hidden && !frameHandle) frameHandle = requestAnimationFrame(frame);
}

let updateDust = () => {};
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
  controls.update(dt); animationAccumulator += dt;
  if (animationAccumulator >= 1 / 30) {
    updateDust(elapsed); animationAccumulator = 0;
  }
  for (const update of room.updates || []) update(elapsed, dt);
  playerShadow.update(controls, dt, now);
  renderRoom();
  gpuTimer.end();
  if (monitor.record(now, frameTime, performance.now() - start)) updateDiagnostics(now);
}

window.Quarto01 = {
  version: '0.6.0', renderer: 'WebGL2', character: false, firstPersonOnly: true,
  get ready() { return ready; }, get quality() { return quality; }, get fps() { return monitor.fps; },
  get frameTimes() { return monitor.frameTimes.slice(); },
  get renderStats() { return renderer ? { ...renderer.info.render } : {}; },
  getPerformanceSnapshot, setQuality, pause, resume,
  getPerformanceTrace: () => ({ frameTimes: monitor.frameTimes.slice(), cpuTimes: monitor.cpuTimes.slice() }),
  diagnosticLook: (dx, dy) => controls?.diagnosticLook?.(dx, dy),
  setDiagnosticShadowEnabled: value => playerShadow?.setEnabled(value),
  setDiagnosticView: setDiagnosticView,
};

function setDiagnosticView(id) {
  if (!controls?.setDiagnosticPose) return false;
  const poses = {
    initial: { position: [1.5, 1.2], yaw: .6868176498, pitch: -.12 },
    shadow: { position: [1.5, -1.6], yaw: -2.299, pitch: 0 },
    feet: { position: [.7, -.8], yaw: -2.975, pitch: -1.38 },
    'feet-oblique': { position: [.7, -.8], yaw: -2.475, pitch: -1.38 },
    blanket: { position: [.85, .3], yaw: .77, pitch: -.4 },
  };
  if (!poses[id] || !controls.setDiagnosticPose(poses[id])) return false;
  playerShadow?.update(controls, 0, performance.now(), true);
  return true;
}

async function init() {
  // Desktop A/B can compare the same scene with ?fxaa=0 and optionally msaa=4.
  const diagnosticMSAA4 = !useFXAA && diagnosticQuery.get('msaa') === '4';
  renderer = new THREE.WebGLRenderer({ canvas, antialias: diagnosticMSAA4, powerPreference: 'high-performance', alpha: false });
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
  room = createRoom(scene, materials); simplifyMaterials(); optimizeStaticGeometry(); addLighting();
  playerShadow = createPlayerShadow(renderer, room.lampPosition);
  registerSurfaceProfiles(); applyLightingProfile();
  controls = createControls(camera, canvas, room.colliders);
  updateDust = dust();
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
      previousTick = previousRender = accumulator = animationAccumulator = 0;
    } else if (!desktopPaused && !frameHandle) frameHandle = requestAnimationFrame(frame);
  });
  window.addEventListener('quarto:pause', pause); window.addEventListener('quarto:resume', resume);
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); pause(); ready = false;
    showError('A renderização foi interrompida. Reabra o quarto para continuar.');
  });
  ready = true; monitor.start(performance.now()); nextAdaptation = performance.now() + 5000;
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
