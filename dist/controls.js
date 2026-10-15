import * as THREE from 'three';

/** Quiet first-person inspection controls; room dimensions and colliders use world units. */
export function createControls(camera, canvas, colliders = []) {
  const startPosition = camera.position.clone();
  const startQuaternion = camera.quaternion.clone();
  const orientation = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  const velocity = new THREE.Vector2();
  const keyboard = new Set();
  const touchKeys = new Set();
  const cleanups = [];
  const movementCodes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
  const radius = .18;
  let dragPointer = null;
  let previousX = 0;
  let previousY = 0;
  let pointerLocked = false;

  const listen = (target, name, callback, options) => {
    target?.addEventListener(name, callback, options);
    cleanups.push(() => target?.removeEventListener(name, callback, options));
  };

  function applyLook(dx, dy, sensitivity = .0022) {
    orientation.y -= dx * sensitivity;
    orientation.x = THREE.MathUtils.clamp(orientation.x - dy * sensitivity, -1.22, 1.22);
    camera.quaternion.setFromEuler(orientation);
  }

  function updateExploring() {
    document.body.classList.toggle('exploring', pointerLocked || dragPointer !== null);
  }

  function clearInput() {
    keyboard.clear();
    touchKeys.clear();
    velocity.set(0, 0);
    dragPointer = null;
    updateExploring();
  }

  listen(canvas, 'pointerdown', (event) => {
    if (event.button !== 0 || pointerLocked || dragPointer !== null) return;
    dragPointer = event.pointerId;
    previousX = event.clientX;
    previousY = event.clientY;
    canvas.setPointerCapture?.(event.pointerId);
    canvas.focus({ preventScroll: true });
    updateExploring();
  });

  listen(canvas, 'pointermove', (event) => {
    if (pointerLocked) {
      applyLook(event.movementX || 0, event.movementY || 0);
      return;
    }
    if (event.pointerId !== dragPointer) return;
    applyLook(event.clientX - previousX, event.clientY - previousY, event.pointerType === 'touch' ? .0032 : .0022);
    previousX = event.clientX;
    previousY = event.clientY;
  });

  const endDrag = (event) => {
    if (event.pointerId !== dragPointer) return;
    dragPointer = null;
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    updateExploring();
  };
  listen(canvas, 'pointerup', endDrag);
  listen(canvas, 'pointercancel', endDrag);
  listen(canvas, 'lostpointercapture', endDrag);

  listen(canvas, 'dblclick', () => {
    if (!canvas.requestPointerLock || pointerLocked) return;
    try {
      const request = canvas.requestPointerLock();
      request?.catch?.(() => {});
    } catch { /* Dragging remains available when pointer lock is unsupported. */ }
  });
  listen(document, 'pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas;
    dragPointer = null;
    updateExploring();
  });
  listen(document, 'keydown', (event) => {
    if (!movementCodes.has(event.code) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    event.preventDefault();
    keyboard.add(event.code);
  });
  listen(document, 'keyup', (event) => { keyboard.delete(event.code); });
  listen(window, 'blur', clearInput);
  listen(document, 'visibilitychange', () => { if (document.hidden) clearInput(); });

  for (const button of document.querySelectorAll('[data-move]')) {
    listen(button, 'pointerdown', (event) => {
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      touchKeys.add(button.dataset.move);
    });
    const release = () => touchKeys.delete(button.dataset.move);
    listen(button, 'pointerup', release);
    listen(button, 'pointercancel', release);
    listen(button, 'lostpointercapture', release);
  }

  function reset() {
    clearInput();
    camera.position.copy(startPosition);
    camera.quaternion.copy(startQuaternion);
    orientation.setFromQuaternion(startQuaternion, 'YXZ');
  }
  listen(document.getElementById('resetBtn'), 'click', reset);

  const fullscreenButton = document.getElementById('fullscreenBtn');
  listen(fullscreenButton, 'click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen?.();
    } catch { /* Keep the full-window scene usable if fullscreen is unavailable. */ }
  });
  listen(document, 'fullscreenchange', () => {
    const active = Boolean(document.fullscreenElement);
    fullscreenButton?.setAttribute('aria-label', active ? 'Sair da tela cheia' : 'Entrar em tela cheia');
    fullscreenButton?.setAttribute('aria-pressed', String(active));
  });

  function collides(x, z) {
    return colliders.some((bounds) => {
      const nearX = THREE.MathUtils.clamp(x, bounds.minX, bounds.maxX);
      const nearZ = THREE.MathUtils.clamp(z, bounds.minZ, bounds.maxZ);
      return (x - nearX) ** 2 + (z - nearZ) ** 2 < radius ** 2;
    });
  }

  function update(delta) {
    const dt = Math.min(Math.max(delta, 0), .05);
    const pressed = (code) => keyboard.has(code) || touchKeys.has(code);
    const localX = Number(pressed('KeyD') || pressed('ArrowRight')) - Number(pressed('KeyA') || pressed('ArrowLeft'));
    const localZ = Number(pressed('KeyS') || pressed('ArrowDown')) - Number(pressed('KeyW') || pressed('ArrowUp'));
    const length = Math.hypot(localX, localZ) || 1;
    const speed = 1.3;
    const x = localX / length * speed;
    const z = localZ / length * speed;
    const yaw = orientation.y;
    const targetX = Math.cos(yaw) * x + Math.sin(yaw) * z;
    const targetZ = -Math.sin(yaw) * x + Math.cos(yaw) * z;
    velocity.x = THREE.MathUtils.damp(velocity.x, targetX, 13, dt);
    velocity.y = THREE.MathUtils.damp(velocity.y, targetZ, 13, dt);
    const nextX = THREE.MathUtils.clamp(camera.position.x + velocity.x * dt, -2.8 + radius, 2.8 - radius);
    const nextZ = THREE.MathUtils.clamp(camera.position.z + velocity.y * dt, -3 + radius, 3 - radius);
    if (!collides(nextX, camera.position.z)) camera.position.x = nextX;
    else velocity.x = 0;
    if (!collides(camera.position.x, nextZ)) camera.position.z = nextZ;
    else velocity.y = 0;
    camera.position.y = 1.62;
  }

  function dispose() {
    clearInput();
    for (const cleanup of cleanups) cleanup();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }

  return { update, reset, dispose };
}
