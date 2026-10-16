import * as THREE from 'three';

/** First-person chest camera. One distance clock drives its steps and the human shadow. */
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
  const mountHeight = 1.45, walkSpeed = 1.12, runSpeed = 1.82;
  const minPitch = -1.42, maxPitch = 1.15;
  // One phase is a complete left/right stride. This shared clock drives both
  // the camera and the shadow: pushing against furniture cannot walk in place.
  const gait = { phase: 0, blend: 0, strideLength: 1.24, speed: 0, localX: 0, localZ: 0, runBlend: 0 };
  // Public, allocation-free telemetry. Offsets are metres in the body's local
  // right/up/back axes; secondary angles are radians, separate from mouse aim.
  const bodycam = { mountHeight, offsetX: 0, offsetY: 0, offsetZ: 0,
    roll: 0, pitch: 0, yaw: 0, stepImpact: 0, stepCount: 0, accelerationX: 0, accelerationZ: 0 };
  const motionKeys = ['offsetX', 'offsetY', 'offsetZ', 'roll', 'pitch', 'yaw', 'accelerationX', 'accelerationZ'];
  let lookYaw = 0, lookPitch = 0, lookRoll = 0;
  let actualVelocityX = 0, actualVelocityZ = 0, impactAge = 1, impactStrength = 0;
  const cameraInputPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
  let cameraInputYaw = NaN, cameraInputPitch = NaN;
  const cameraInputMotion = { offsetX: NaN, offsetY: NaN, offsetZ: NaN, roll: NaN, pitch: NaN, yaw: NaN };
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
    for (const key of Object.keys(bodycam)) if (key !== 'mountHeight') bodycam[key] = 0;
    lookYaw = 0; lookPitch = 0; lookRoll = 0;
    actualVelocityX = 0; actualVelocityZ = 0; impactAge = 1; impactStrength = 0;
    updateExploring();
  }

  function applyLook(dx, dy, sensitivity = .0022) {
    const yawDelta = -dx * sensitivity, oldPitch = pitch;
    yaw += yawDelta;
    pitch = THREE.MathUtils.clamp(pitch - dy * sensitivity, minPitch, maxPitch);
    // The full input changes aim immediately. Only this small, bounded mount
    // accommodation settles afterwards; there is no filtered mouse target.
    lookYaw = THREE.MathUtils.clamp(lookYaw - yawDelta * .035, -.006, .006);
    lookPitch = THREE.MathUtils.clamp(lookPitch - (pitch - oldPitch) * .025, -.004, .004);
    lookRoll = THREE.MathUtils.clamp(lookRoll - yawDelta * .065, -.014, .014);
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
        bodycam.offsetX === cameraInputMotion.offsetX && bodycam.offsetY === cameraInputMotion.offsetY &&
        bodycam.offsetZ === cameraInputMotion.offsetZ && bodycam.roll === cameraInputMotion.roll &&
        bodycam.pitch === cameraInputMotion.pitch && bodycam.yaw === cameraInputMotion.yaw) return;
    cameraInputPosition.copy(position); cameraInputYaw = yaw;
    cameraInputPitch = pitch;
    Object.assign(cameraInputMotion, bodycam);
    orientation.set(THREE.MathUtils.clamp(pitch + bodycam.pitch, minPitch, maxPitch), yaw + bodycam.yaw, bodycam.roll, 'YXZ');
    camera.quaternion.setFromEuler(orientation);
    camera.position.copy(position);
    camera.position.x += Math.cos(yaw) * bodycam.offsetX + Math.sin(yaw) * bodycam.offsetZ;
    camera.position.z += -Math.sin(yaw) * bodycam.offsetX + Math.cos(yaw) * bodycam.offsetZ;
    camera.position.y = mountHeight + bodycam.offsetY;
  }

  function updateGait(dt, dx, dz) {
    const distance = Math.hypot(dx, dz);
    gait.speed = speed;
    gait.runBlend = THREE.MathUtils.damp(gait.runBlend, running ? 1 : 0, 7, dt);
    gait.strideLength = THREE.MathUtils.lerp(1.24, 1.58, gait.runBlend);
    if (distance > 1e-8) {
      const nextPhase = gait.phase + distance / gait.strideLength * Math.PI * 2;
      // A contact only happens after actual travel. A held key against a wall
      // cannot generate impacts, even while movement velocity is being clamped.
      if (Math.floor(nextPhase / Math.PI) > Math.floor(gait.phase / Math.PI)) {
        impactAge = 0; impactStrength = Math.min(1, speed / walkSpeed);
        bodycam.stepCount++;
      }
      gait.phase = nextPhase % (Math.PI * 2);
      gait.localX = (Math.cos(yaw) * dx - Math.sin(yaw) * dz) / distance;
      gait.localZ = (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / distance;
    } else {
      gait.localX = 0; gait.localZ = 0;
    }
    const targetBlend = moving ? Math.min(1, speed / walkSpeed) : 0;
    gait.blend = THREE.MathUtils.damp(gait.blend, targetBlend, moving ? 9 : 14, dt);
    if (!moving && gait.blend < .0001) gait.blend = 0;
    if (!running && gait.runBlend < .0001) gait.runBlend = 0;
    const nextVelocityX = dt > 0 ? dx / dt : 0, nextVelocityZ = dt > 0 ? dz / dt : 0;
    const accelerationX = dt > 0 ? (nextVelocityX - actualVelocityX) / dt : 0;
    const accelerationZ = dt > 0 ? (nextVelocityZ - actualVelocityZ) / dt : 0;
    actualVelocityX = nextVelocityX; actualVelocityZ = nextVelocityZ;
    const localAccelerationX = Math.cos(yaw) * accelerationX - Math.sin(yaw) * accelerationZ;
    const localAccelerationZ = Math.sin(yaw) * accelerationX + Math.cos(yaw) * accelerationZ;
    bodycam.accelerationX = THREE.MathUtils.damp(bodycam.accelerationX, THREE.MathUtils.clamp(localAccelerationX, -8, 8), 14, dt);
    bodycam.accelerationZ = THREE.MathUtils.damp(bodycam.accelerationZ, THREE.MathUtils.clamp(localAccelerationZ, -8, 8), 14, dt);
    lookYaw = THREE.MathUtils.damp(lookYaw, 0, 24, dt);
    lookPitch = THREE.MathUtils.damp(lookPitch, 0, 24, dt);
    lookRoll = THREE.MathUtils.damp(lookRoll, 0, 20, dt);
    impactAge += dt;
    bodycam.stepImpact = impactAge < .25 ? Math.sin(impactAge * 46) * Math.exp(-impactAge * 23) *
      THREE.MathUtils.lerp(.008, .012, gait.runBlend) * impactStrength : 0;
    const amplitude = gait.blend * THREE.MathUtils.lerp(1, 1.35, gait.runBlend);
    const stride = gait.phase;
    // The chest follows the torso more than an eye camera does. The low
    // frequency stride carries weight; short contacts add a restrained dip.
    const vertical = (.020 * Math.cos(stride * 2) - .003 * Math.cos(stride * 4)) * amplitude - bodycam.stepImpact;
    const lateral = .013 * Math.sin(stride) * amplitude;
    const longitudinal = -.005 * Math.sin(stride * 2) * amplitude + bodycam.accelerationZ * .0012;
    const roll = -.012 * Math.sin(stride) * amplitude - .009 * gait.localX * gait.blend -
      bodycam.accelerationX * .004 + lookRoll;
    const tilt = (.006 * Math.sin(stride * 2) - .0025 * Math.cos(stride)) * amplitude +
      bodycam.accelerationZ * .004 + gait.localZ * gait.blend * THREE.MathUtils.lerp(.004, .009, gait.runBlend) + lookPitch;
    const pan = .0035 * Math.sin(stride) * amplitude + lookYaw;
    bodycam.offsetX = THREE.MathUtils.damp(bodycam.offsetX, lateral, 24, dt);
    bodycam.offsetY = THREE.MathUtils.damp(bodycam.offsetY, THREE.MathUtils.clamp(vertical, -.034, .034), 28, dt);
    bodycam.offsetZ = THREE.MathUtils.damp(bodycam.offsetZ, longitudinal, 20, dt);
    bodycam.roll = THREE.MathUtils.damp(bodycam.roll, THREE.MathUtils.clamp(roll, -.038, .038), 20, dt);
    bodycam.pitch = THREE.MathUtils.damp(bodycam.pitch, THREE.MathUtils.clamp(tilt, -.026, .026), 20, dt);
    bodycam.yaw = THREE.MathUtils.damp(bodycam.yaw, pan, 24, dt);
    if (!moving && !gait.blend) {
      for (const key of motionKeys) {
        if (Math.abs(bodycam[key]) < .00001) bodycam[key] = 0;
      }
      if (Math.abs(lookYaw) < .00001) lookYaw = 0;
      if (Math.abs(lookPitch) < .00001) lookPitch = 0;
      if (Math.abs(lookRoll) < .00001) lookRoll = 0;
    }
  }

  function reset() {
    clearInput(); position.copy(spawn); yaw = startYaw; pitch = -.12;
    direction.set(-2.05, 0, -2.5).normalize();
    updateCamera();
  }
  listen(document.getElementById('resetBtn'), 'click', reset);

  function integrate(dt) {
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
  }

  function update(delta) {
    const dt = Number.isFinite(delta) ? Math.min(Math.max(delta, 0), .05) : 0;
    // Shared fixed-size subdivisions keep the step/impact/weight response
    // stable at 30, 60 and 120 Hz, without a second clock or catch-up backlog.
    const steps = dt > 0 ? Math.max(1, Math.ceil(dt * 120 - 1e-8)) : 0;
    for (let step = 0; step < steps; step++) integrate(dt / steps);
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

  function suspend() {
    clearInput(); updateCamera();
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
    update, reset, dispose, suspend, diagnosticLook, setDiagnosticPose,
    get moving() { return moving; }, get running() { return running; }, get speed() { return speed; },
    get gait() { return gait; },
    get bodycam() { return bodycam; },
    get mode() { return 'first-person'; },
    get yaw() { return yaw; }, get pitch() { return pitch; },
    get changed() { return changed; }, get position() { return position; }, get direction() { return direction; }
  };
}
