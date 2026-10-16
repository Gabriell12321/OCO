import * as THREE from 'three';
import humanData from './assets/player-shadow/human-data.js';

/** A real skinned human, reduced offline for the shadow's resolution.
 * The figure has continuous anatomy, curved shoes, hands, fingers and clothing.
 * No textures, GLTF loader or visible third-person body are loaded at runtime.
 */
export function createHumanShadowProxy() {
  const model = new THREE.ObjectLoader().parse(humanData.model);
  const object = new THREE.Group(); object.name = 'Human shadow only'; object.add(model);
  let mesh;
  model.traverse(child => { if (child.isSkinnedMesh) mesh = child; });
  mesh.name = 'Michelle shadow silhouette'; mesh.frustumCulled = false;
  const mixer = new THREE.AnimationMixer(model);
  const actions = Object.fromEntries(humanData.clips.map(json => {
    const clip = THREE.AnimationClip.parse(json);
    const action = mixer.clipAction(clip).play();
    action.paused = true;
    return [clip.name, action];
  }));
  const sample = (phase, blend, runBlend) => {
    const unit = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
    const motionWeight = blend * THREE.MathUtils.lerp(.8, .85, runBlend);
    actions.Idle.time = .25;
    actions.Walk.time = unit * actions.Walk.getClip().duration;
    actions.Run.time = unit * actions.Run.getClip().duration;
    actions.Idle.setEffectiveWeight(1 - motionWeight);
    actions.Walk.setEffectiveWeight(motionWeight * (1 - runBlend));
    actions.Run.setEffectiveWeight(motionWeight * runBlend);
    mixer.update(0);
    object.updateMatrixWorld(true);
  };
  sample(0, 0, 0);
  mesh.computeBoundingBox();
  const box = mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
  const scale = humanData.metadata.height / (box.max.y - box.min.y);
  model.scale.multiplyScalar(scale);
  model.position.y = -box.min.y * scale + .006;
  const baseY = model.position.y;
  object.updateMatrixWorld(true);

  // A few sole extremities are enough to prevent the retargeted shoes from
  // penetrating the floor. This avoids evaluating all 3k skinned vertices.
  const support = new Set(), point = new THREE.Vector3();
  const skinIndex = mesh.geometry.attributes.skinIndex;
  const skinWeight = mesh.geometry.attributes.skinWeight;
  for (const side of ['Left', 'Right']) {
    const footBones = new Set(mesh.skeleton.bones.map((bone, i) => ({ bone, i }))
      .filter(({ bone }) => bone.name.includes(side + 'Foot') || bone.name.includes(side + 'Toe')).map(({ i }) => i));
    const candidates = [];
    for (let i = 0; i < skinIndex.count; i++) {
      let influence = 0;
      for (let c = 0; c < 4; c++) if (footBones.has(skinIndex.array[i * 4 + c])) influence += skinWeight.array[i * 4 + c];
      if (influence < .5) continue;
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
      candidates.push({ index: i, point: point.clone() });
    }
    for (const dy of [.35, 1]) for (const dx of [-1, -.5, 0, .5, 1]) for (const dz of [-1, -.5, 0, .5, 1]) {
      let best = Infinity, index = -1;
      for (const candidate of candidates) {
        const value = dy * candidate.point.y + dx * candidate.point.x + dz * candidate.point.z;
        if (value < best) { best = value; index = candidate.index; }
      }
      if (index >= 0) support.add(index);
    }
  }
  const soleVertices = [...support];
  let phase = 0, lastPhase = 0, blend = 0, runBlend = 0, yawOffset = 0;
  let floorCorrection = 0, lowestSole = .006;
  function update(controls, elapsed) {
    const gait = controls.gait;
    blend = gait ? gait.blend : THREE.MathUtils.damp(blend, controls.moving ? 1 : 0, 14, elapsed);
    runBlend = gait ? gait.runBlend : THREE.MathUtils.damp(runBlend, controls.running ? 1 : 0, 7, elapsed);
    if (gait) {
      if (gait.phase === 0 && gait.blend === 0) phase = lastPhase = 0;
      const advance = THREE.MathUtils.euclideanModulo(gait.phase - lastPhase + Math.PI, Math.PI * 2) - Math.PI;
      phase += advance * (gait.localZ > .3 ? -1 : 1);
      lastPhase = gait.phase;
    } else phase += Math.max(0, controls.speed) * elapsed * Math.PI * 2 / (controls.running ? 1.58 : 1.24);
    // The upper body follows the view, while a side step turns the pelvis
    // partway toward its travel direction. Backward steps reverse the clip.
    const desiredYaw = gait ? -gait.localX * .65 * blend : 0;
    yawOffset = THREE.MathUtils.damp(yawOffset, desiredYaw, 12, elapsed);
    object.position.copy(controls.position);
    object.rotation.y = controls.yaw + Math.PI + yawOffset;
    model.position.y = baseY;
    sample(phase, blend, runBlend);
    let low = Infinity;
    for (const index of soleVertices) {
      mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld);
      low = Math.min(low, point.y - object.position.y);
    }
    // Walking has a support foot; running keeps the recorded flight interval.
    floorCorrection = THREE.MathUtils.lerp(.006 - low, Math.max(0, .006 - low), runBlend);
    model.position.y += floorCorrection;
    lowestSole = low + floorCorrection;
    object.updateMatrixWorld(true);
  }
  function dispose() {
    mixer.stopAllAction(); mixer.uncacheRoot(model);
    mesh.geometry.dispose(); mesh.material.dispose(); mesh.skeleton.dispose();
    object.removeFromParent();
  }
  return {
    object, mesh, update, dispose, triangles: mesh.geometry.index.count / 3,
    get settling() { return blend > .0001 || Math.abs(yawOffset) > .0001; },
    snapshot() { return { source: humanData.metadata.source, riggedHuman: true, bones: mesh.skeleton.bones.length,
      animation: blend < .01 ? 'Idle' : runBlend > .5 ? 'Run' : 'Walk', blend, phase,
      soleSamples: soleVertices.length, lowestSole, floorCorrection }; },
  };
}

const playerFilter = `
#ifdef USE_SHADOWMAP
float quartoHumanShadow() {
  if (quartoPlayerShadowActive < .5) return 1.0;
  vec3 coord = vQuartoPlayerShadowCoord.xyz / vQuartoPlayerShadowCoord.w;
  if (vQuartoPlayerShadowCoord.w <= 0.0 || coord.x <= 0.0 || coord.x >= 1.0 ||
      coord.y <= 0.0 || coord.y >= 1.0 || coord.z <= 0.0 || coord.z >= 1.0) return 1.0;
  coord.z -= .00008;
  vec2 pixel = vec2(1.15 / 512.0);
  float value = texture2DCompare(quartoPlayerShadowMap, coord.xy + vec2(-pixel.x,-pixel.y), coord.z)
    + texture2DCompare(quartoPlayerShadowMap, coord.xy + vec2(pixel.x,-pixel.y), coord.z)
    + texture2DCompare(quartoPlayerShadowMap, coord.xy + vec2(-pixel.x,pixel.y), coord.z)
    + texture2DCompare(quartoPlayerShadowMap, coord.xy + vec2(pixel.x,pixel.y), coord.z);
  return value * .25;
}
float getPointShadow(sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity,
    float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar) {
  float roomShadow = getPointShadowWithoutHuman(shadowMap, shadowMapSize, shadowIntensity,
    shadowBias, shadowRadius, shadowCoord, shadowCameraNear, shadowCameraFar);
  return roomShadow * mix(1.0, quartoHumanShadow(), shadowIntensity);
}
#endif
`;

/** Project the human into the lamp's lighting; static room occlusion stays intact.
 * One 512² map, one skinned draw (~6k triangles), no room or cube-map rerender.
 */
export function createPlayerShadow(renderer, lampPosition) {
  const proxy = createHumanShadowProxy(), casterScene = new THREE.Scene();
  // ObjectLoader does not restore MeshDepthMaterial.depthPacking from JSON.
  // BasicDepthPacking writes 1-z in grey; the receivers unpack RGBA depth.
  // Mixing those formats makes a distant human shadow surfaces in front of it
  // (the blanket beside the player). Keep the depth contract explicit here.
  proxy.mesh.material.depthPacking = THREE.RGBADepthPacking;
  proxy.mesh.material.blending = THREE.NoBlending;
  proxy.mesh.material.toneMapped = false;
  proxy.mesh.material.needsUpdate = true;
  casterScene.add(proxy.object);
  const shadowCamera = new THREE.PerspectiveCamera(45, 1, .075, 14);
  shadowCamera.position.copy(lampPosition);
  const target = new THREE.WebGLRenderTarget(512, 512, {
    format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: true, stencilBuffer: false, generateMipmaps: false,
  });
  target.texture.name = 'Articulated player shadow depth';
  target.texture.colorSpace = THREE.NoColorSpace;
  const matrix = new THREE.Matrix4();
  const bias = new THREE.Matrix4().set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1);
  const uniforms = {
    quartoPlayerShadowMatrix: { value: matrix }, quartoPlayerShadowMap: { value: target.texture },
    quartoPlayerShadowActive: { value: 0 },
  };
  const previous = new THREE.Vector3(Infinity, Infinity, Infinity), focus = new THREE.Vector3();
  const clearColor = new THREE.Color();
  let previousYaw = Infinity, previousMoving = false;
  let updates = 0, lastUpdateMs = -Infinity, lastRenderCalls = 0;
  let enabled = true, mapReady = false;

  function update(controls, dt, now, force = false) {
    const moving = controls.moving;
    const changed = previous.distanceToSquared(controls.position) > .0000001 ||
      Math.abs(previousYaw - controls.yaw) > .002 || moving !== previousMoving;
    if (!force && !changed && !moving && !proxy.settling) { lastRenderCalls = 0; return false; }
    if (!force && now - lastUpdateMs < 1000 / 30 - .5) { lastRenderCalls = 0; return false; }
    const elapsed = Number.isFinite(lastUpdateMs) ? Math.min((now - lastUpdateMs) / 1000, .1) : dt;
    proxy.update(controls, elapsed);
    focus.copy(controls.position); focus.y = .92;
    const distance = Math.max(.6, shadowCamera.position.distanceTo(focus));
    shadowCamera.fov = THREE.MathUtils.clamp(2 * Math.atan(1.15 / distance) * 180 / Math.PI, 20, 130);
    shadowCamera.lookAt(focus); shadowCamera.updateProjectionMatrix(); shadowCamera.updateMatrixWorld(true);
    matrix.copy(bias).multiply(shadowCamera.projectionMatrix).multiply(shadowCamera.matrixWorldInverse);
    const oldTarget = renderer.getRenderTarget(), oldShadowEnabled = renderer.shadowMap.enabled;
    const oldAlpha = renderer.getClearAlpha(); renderer.getClearColor(clearColor);
    try {
      renderer.shadowMap.enabled = false;
      renderer.setClearColor(0xffffff, 1); renderer.setRenderTarget(target);
      renderer.render(casterScene, shadowCamera);
    } finally {
      renderer.setRenderTarget(oldTarget); renderer.setClearColor(clearColor, oldAlpha);
      renderer.shadowMap.enabled = oldShadowEnabled;
    }
    mapReady = true; uniforms.quartoPlayerShadowActive.value = enabled ? 1 : 0;
    previous.copy(controls.position); previousYaw = controls.yaw; previousMoving = moving;
    updates++; lastUpdateMs = now; lastRenderCalls = 1;
    return true;
  }

  function patchShader(shader, roomShadowChunk) {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'uniform mat4 quartoPlayerShadowMatrix; varying vec4 vQuartoPlayerShadowCoord;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
#ifdef USE_SHADOWMAP
vQuartoPlayerShadowCoord = quartoPlayerShadowMatrix * worldPosition;
#else
vQuartoPlayerShadowCoord = vec4(0.0);
#endif`);
    const declarations = 'uniform sampler2D quartoPlayerShadowMap; uniform float quartoPlayerShadowActive; varying vec4 vQuartoPlayerShadowCoord;\n';
    const chunk = roomShadowChunk.replace('float getPointShadow(', 'float getPointShadowWithoutHuman(') + playerFilter;
    shader.fragmentShader = declarations + shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', chunk);
  }

  function snapshot() {
    return {
      active: uniforms.quartoPlayerShadowActive.value === 1, enabled, kind: 'human-depth-projection',
      meshCount: 1, triangles: proxy.triangles, mapSize: 512, updates,
      position: { x: previous.x, y: previous.y, z: previous.z }, moving: previousMoving,
      lastUpdateMs: Math.round(lastUpdateMs), lastRenderCalls, mainSceneBody: false,
      updateHz: 30, staticRoomRedraws: 0, human: proxy.snapshot(),
    };
  }

  function dispose() {
    target.dispose(); proxy.dispose();
  }
  function setEnabled(value) {
    enabled = Boolean(value); uniforms.quartoPlayerShadowActive.value = enabled && mapReady ? 1 : 0;
    return enabled;
  }
  return { update, patchShader, snapshot, dispose, setEnabled };
}
