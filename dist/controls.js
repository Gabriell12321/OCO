import * as THREE from 'three';

/** Metre-scaled first-person walking, with fixed eye height and no camera sway. */
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
  const cameraInputPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
  let cameraInputYaw = NaN, cameraInputPitch = NaN;
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
    updateExploring();
  }

  function applyLook(dx, dy, sensitivity = .0022) {
    yaw -= dx * sensitivity;
    pitch = THREE.MathUtils.clamp(pitch - dy * sensitivity, -1.15, 1.15);
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
    if (position.equals(cameraInputPosition) && yaw === cameraInputYaw && pitch === cameraInputPitch) return;
    cameraInputPosition.copy(position); cameraInputYaw = yaw;
    cameraInputPitch = pitch;
    orientation.set(pitch, yaw, 0, 'YXZ');
    camera.quaternion.setFromEuler(orientation);
    camera.position.copy(position); camera.position.y = 1.62;
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
    const targetSpeed = requestedRun ? 1.72 : 1.04;
    const x = localX / inputLength * targetSpeed, z = localZ / inputLength * targetSpeed;
    velocity.x = THREE.MathUtils.damp(velocity.x, Math.cos(yaw) * x + Math.sin(yaw) * z, 15, dt);
    velocity.y = THREE.MathUtils.damp(velocity.y, -Math.sin(yaw) * x + Math.cos(yaw) * z, 15, dt);
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
    pitch = THREE.MathUtils.clamp(pose.pitch, -1.15, 1.15);
    direction.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    updateCamera(); return true;
  }

  document.body.classList.toggle('first-person', true); reset();
  return {
    update, reset, dispose, diagnosticLook, setDiagnosticPose,
    get moving() { return moving; }, get running() { return running; }, get speed() { return speed; },
    get mode() { return 'first-person'; },
    get yaw() { return yaw; }, get pitch() { return pitch; },
    get changed() { return changed; }, get position() { return position; }, get direction() { return direction; }
  };
}
