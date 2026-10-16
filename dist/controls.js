import * as THREE from 'three';

/** Metre-scaled first-person walking with a distance-driven, restrained human gait. */
export function createControls(camera, canvas, colliders = [], avatar = null, scene = null) {
  const spawn = new THREE.Vector3(1.5, 0, 1.2);
  const position = spawn.clone();
  const direction = new THREE.Vector3(-2.05, 0, -2.5).normalize();
  const startYaw = Math.atan2(-direction.x, -direction.z);
  const avatarObject = avatar?.object || avatar;
  const velocity = new THREE.Vector2();
  const keyboard = new Set(), touchKeys = new Set(), cleanups = [];
  const pressed = code => keyboard.has(code) || touchKeys.has(code);
  const movementCodes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
  const radius = .22;
  const eyeHeight = 1.62, walkSpeed = 1.12, runSpeed = 1.82;
  const minPitch = -1.42, maxPitch = 1.15;
  // One phase is a complete left/right stride. This shared clock drives both
  // the camera and the shadow: pushing against furniture cannot walk in place.
  const gait = { phase: 0, blend: 0, strideLength: 1.24, speed: 0, localX: 0, localZ: 0, runBlend: 0 };
  let swayX = 0, swayY = 0, swayRoll = 0;
  const cameraInputPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
  let cameraInputYaw = NaN, cameraInputPitch = NaN;
  let cameraInputSwayX = NaN, cameraInputSwayY = NaN, cameraInputRoll = NaN;
  const previousPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
  const previousCamera = new THREE.Vector3(Infinity, Infinity, Infinity);
  const previousQuaternion = new THREE.Quaternion();
  const orientation = new THREE.Euler(0, startYaw, 0, 'YXZ');
  let yaw = startYaw, pitch = -.12;
  let dragPointer = null, previousX = 0, previousY = 0, pointerLocked = false;
  let moving = false, running = false, speed = 0, changed = true;

  // Legacy callers may still pass an avatar. It never becomes visible here.
  if (avatarObject) avatarObject.visible = false;

  function listen(target, name, callback, options) {
    target?.addEventListener(name, callback, options);
    cleanups.push(() => target?.removeEventListener(name, callback, options));
  }

  function updateExploring() {
    document.body.classList.toggle('exploring', pointerLocked || dragPointer !== null);
  }

  function clearInput() {
    keyboard.clear(); touchKeys.clear(); velocity.set(0, 0);
    const pointer = dragPointer; dragPointer = null;
    if (pointer !== null && canvas.hasPointerCapture?.(pointer)) canvas.releasePointerCapture(pointer);
    moving = false; running = false; speed = 0;
    gait.phase = 0; gait.blend = 0; gait.strideLength = 1.24;
    gait.speed = 0; gait.localX = 0; gait.localZ = 0; gait.runBlend = 0;
    swayX = 0; swayY = 0; swayRoll = 0;
    updateExploring();
  }

  function applyLook(dx, dy, sensitivity = .0022) {
    yaw -= dx * sensitivity;
    pitch = THREE.MathUtils.clamp(pitch - dy * sensitivity, minPitch, maxPitch);
  }

  function requestMouseLook() {
    if (!canvas.requestPointerLock || pointerLocked) return;
    try { canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* Dragging remains available. */ }
  }

  listen(canvas, 'pointerdown', event => {
    if (event.button !== 0 || pointerLocked || dragPointer !== null) return;
    dragPointer = event.pointerId; previousX = event.clientX; previousY = event.clientY;
    canvas.setPointerCapture?.(event.pointerId); canvas.focus({ preventScroll: true }); updateExploring();
    if (!event.pointerType || event.pointerType === 'mouse') requestMouseLook();
  });
  listen(canvas, 'pointermove', event => {
    if (pointerLocked) { applyLook(event.movementX || 0, event.movementY || 0); return; }
    if (event.pointerId !== dragPointer) return;
    applyLook(event.clientX - previousX, event.clientY - previousY, event.pointerType === 'touch' ? .003 : .0022);
    previousX = event.clientX; previousY = event.clientY;
  });
  const endDrag = event => {
    if (event.pointerId !== dragPointer) return;
    dragPointer = null;
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    updateExploring();
  };
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(canvas, event, endDrag);
  listen(canvas, 'dblclick', requestMouseLook);
  listen(document, 'pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas;
    const captured = dragPointer; dragPointer = null;
    if (captured !== null && canvas.hasPointerCapture?.(captured)) canvas.releasePointerCapture(captured);
    updateExploring();
  });
  listen(document, 'keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || '')) return;
    if (!movementCodes.has(event.code)) return;
    event.preventDefault(); keyboard.add(event.code);
  });
  listen(document, 'keyup', event => keyboard.delete(event.code));
  listen(window, 'blur', clearInput);
  listen(document, 'visibilitychange', () => { if (document.hidden) clearInput(); });
  for (const button of document.querySelectorAll('[data-move]')) {
    listen(button, 'pointerdown', event => {
      event.preventDefault(); button.setPointerCapture?.(event.pointerId); touchKeys.add(button.dataset.move);
    });
    const release = () => touchKeys.delete(button.dataset.move);
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(button, event, release);
  }

  const fullscreenButton = document.getElementById('fullscreenBtn');
  listen(fullscreenButton, 'click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen?.();
    } catch { /* The full-window canvas remains usable. */ }
  });
  listen(document, 'fullscreenchange', () => {
    const active = Boolean(document.fullscreenElement);
    fullscreenButton?.setAttribute('aria-label', active ? 'Sair da tela cheia' : 'Entrar em tela cheia');
    fullscreenButton?.setAttribute('aria-pressed', String(active));
  });

  function collides(x, z) {
    for (const bounds of colliders) {
      const nearX = THREE.MathUtils.clamp(x, bounds.minX, bounds.maxX);
      const nearZ = THREE.MathUtils.clamp(z, bounds.minZ, bounds.maxZ);
      if ((x - nearX) ** 2 + (z - nearZ) ** 2 < radius ** 2) return true;
    }
    return false;
  }

  function updateCamera() {
    if (position.equals(cameraInputPosition) && yaw === cameraInputYaw && pitch === cameraInputPitch &&
        swayX === cameraInputSwayX && swayY === cameraInputSwayY && swayRoll === cameraInputRoll) return;
    cameraInputPosition.copy(position); cameraInputYaw = yaw;
    cameraInputPitch = pitch;
    cameraInputSwayX = swayX; cameraInputSwayY = swayY; cameraInputRoll = swayRoll;
    orientation.set(pitch, yaw, swayRoll, 'YXZ');
    camera.quaternion.setFromEuler(orientation);
    camera.position.copy(position);
    camera.position.x += Math.cos(yaw) * swayX;
    camera.position.z -= Math.sin(yaw) * swayX;
    camera.position.y = eyeHeight + swayY;
  }

  function updateGait(dt, dx, dz) {
    const distance = Math.hypot(dx, dz);
    gait.speed = speed;
    gait.runBlend = THREE.MathUtils.damp(gait.runBlend, running ? 1 : 0, 7, dt);
    gait.strideLength = THREE.MathUtils.lerp(1.24, 1.58, gait.runBlend);
    if (distance > 1e-8) {
      gait.phase = (gait.phase + distance / gait.strideLength * Math.PI * 2) % (Math.PI * 2);
      gait.localX = (Math.cos(yaw) * dx - Math.sin(yaw) * dz) / distance;
      gait.localZ = (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / distance;
    } else {
      gait.localX = 0; gait.localZ = 0;
    }
    const targetBlend = moving ? Math.min(1, speed / walkSpeed) : 0;
    gait.blend = THREE.MathUtils.damp(gait.blend, targetBlend, moving ? 9 : 14, dt);
    if (!moving && gait.blend < .0001) gait.blend = 0;
    if (!running && gait.runBlend < .0001) gait.runBlend = 0;
    const amplitude = gait.blend * THREE.MathUtils.lerp(1, 1.35, gait.runBlend);
    // Pelvis/eye stabilization leaves only millimetres of lateral sway and
    // about a centimetre of vertical travel. No continuous idle bobbing.
    const vertical = (.010 * Math.cos(gait.phase * 2) - .002 * Math.cos(gait.phase * 4)) * amplitude;
    const lateral = .006 * Math.sin(gait.phase) * amplitude;
    const roll = -.0011 * Math.sin(gait.phase) * amplitude;
    swayX = THREE.MathUtils.damp(swayX, lateral, 16, dt);
    swayY = THREE.MathUtils.damp(swayY, vertical, 16, dt);
    swayRoll = THREE.MathUtils.damp(swayRoll, roll, 16, dt);
    if (!gait.blend && Math.abs(swayX) < .00001 && Math.abs(swayY) < .00001 && Math.abs(swayRoll) < .00001) {
      swayX = 0; swayY = 0; swayRoll = 0;
    }
  }

  function reset() {
    clearInput(); position.copy(spawn); yaw = startYaw; pitch = -.12;
    direction.set(-2.05, 0, -2.5).normalize();
    updateCamera();
  }
  listen(document.getElementById('resetBtn'), 'click', reset);

  function update(delta) {
    const dt = Math.min(Math.max(delta, 0), .05);
    const localX = Number(pressed('KeyD') || pressed('ArrowRight')) - Number(pressed('KeyA') || pressed('ArrowLeft'));
    const localZ = Number(pressed('KeyS') || pressed('ArrowDown')) - Number(pressed('KeyW') || pressed('ArrowUp'));
    const inputLength = Math.hypot(localX, localZ) || 1;
    const requestedRun = pressed('ShiftLeft') || pressed('ShiftRight');
    const targetSpeed = requestedRun ? runSpeed : walkSpeed;
    const x = localX / inputLength * targetSpeed * .88;
    const z = localZ / inputLength * targetSpeed * (localZ > 0 ? .82 : 1);
    // A short weight transfer starts a step; braking settles sooner than
    // acceleration. Velocity remains in world space for gentle direction changes.
    const response = localX || localZ ? 8 : 12;
    velocity.x = THREE.MathUtils.damp(velocity.x, Math.cos(yaw) * x + Math.sin(yaw) * z, response, dt);
    velocity.y = THREE.MathUtils.damp(velocity.y, -Math.sin(yaw) * x + Math.cos(yaw) * z, response, dt);
    if (!localX && !localZ && velocity.lengthSq() < .0002) velocity.set(0, 0);
    const oldX = position.x, oldZ = position.z;
    const steps = velocity.lengthSq() > 0 && dt > 0 ? Math.max(1, Math.ceil(velocity.length() * dt / .055)) : 0;
    for (let step = 0; step < steps; step++) {
      const nextX = THREE.MathUtils.clamp(position.x + velocity.x * dt / steps, -2.75, 2.75);
      const nextZ = THREE.MathUtils.clamp(position.z + velocity.y * dt / steps, -2.9, 2.9);
      if (!collides(nextX, position.z)) position.x = nextX;
      else velocity.x = 0;
      if (!collides(position.x, nextZ)) position.z = nextZ;
      else velocity.y = 0;
    }
    const dx = position.x - oldX, dz = position.z - oldZ;
    speed = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
    moving = speed > .025; running = requestedRun && moving;
    if (moving) direction.set(dx, 0, dz).normalize();
    updateGait(dt, dx, dz);
    updateCamera();
    changed = position.distanceToSquared(previousPosition) > 1e-10 ||
      camera.position.distanceToSquared(previousCamera) > 1e-10 ||
      1 - Math.abs(camera.quaternion.dot(previousQuaternion)) > 1e-10;
    previousPosition.copy(position); previousCamera.copy(camera.position); previousQuaternion.copy(camera.quaternion);
  }

  function dispose() {
    clearInput(); cleanups.forEach(cleanup => cleanup());
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    document.body.classList.remove('exploring', 'first-person');
  }

  // The desktop's own diagnostics exercise the same camera/movement code.
  function diagnosticLook(dx, dy) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
    applyLook(dx, dy); updateCamera(); return true;
  }

  function setDiagnosticPose(pose) {
    const [x, z] = pose?.position || [];
    if (![x, z, pose?.yaw, pose?.pitch].every(Number.isFinite)) return false;
    if (x < -2.75 || x > 2.75 || z < -2.9 || z > 2.9 || collides(x, z)) return false;
    clearInput(); position.set(x, 0, z); yaw = pose.yaw;
    pitch = THREE.MathUtils.clamp(pose.pitch, minPitch, maxPitch);
    direction.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    updateCamera(); return true;
  }

  document.body.classList.toggle('first-person', true); reset();
  return {
    update, reset, dispose, diagnosticLook, setDiagnosticPose,
    get moving() { return moving; }, get running() { return running; }, get speed() { return speed; },
    get gait() { return gait; },
    get mode() { return 'first-person'; },
    get yaw() { return yaw; }, get pitch() { return pitch; },
    get changed() { return changed; }, get position() { return position; }, get direction() { return direction; }
  };
}
