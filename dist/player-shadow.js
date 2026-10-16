import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** A single, low-polygon articulated caster. It exists only in its own scene. */
export function createHumanShadowProxy() {
  const root = new THREE.Bone(), hips = new THREE.Bone(), torso = new THREE.Bone(), head = new THREE.Bone();
  root.add(hips); hips.position.y = .91; hips.add(torso); torso.position.y = .13;
  torso.add(head); head.position.y = .51;
  const bones = [root, hips, torso, head], parts = [];
  const limbs = { arms: [], legs: [] };
  function bone(parent, x, y, z = 0) {
    const value = new THREE.Bone(); value.position.set(x, y, z); parent.add(value); bones.push(value); return value;
  }
  function part(geometry, joint, x, y, z, sx = 1, sy = 1, sz = 1) {
    geometry.scale(sx, sy, sz); geometry.translate(x, y, z);
    const count = geometry.attributes.position.count;
    const indices = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
    const index = bones.indexOf(joint);
    for (let i = 0; i < count; i++) { indices[i * 4] = index; weights[i * 4] = 1; }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    parts.push(geometry);
  }
  const round = () => new THREE.SphereGeometry(1, 8, 6);
  const cylinder = (radius, length) => new THREE.CylinderGeometry(radius, radius * .9, length, 8, 1);
  part(round(), hips, 0, .94, 0, .19, .18, .12);
  part(round(), torso, 0, 1.245, 0, .235, .29, .135);
  part(cylinder(.055, .1), head, 0, 1.515, 0);
  part(new THREE.SphereGeometry(1, 10, 8), head, 0, 1.64, .005, .108, .14, .115);
  for (const sign of [-1, 1]) {
    const shoulder = bone(torso, sign * .258, .39);
    const elbow = bone(shoulder, 0, -.30), wrist = bone(elbow, 0, -.28);
    // Rounded deltoids and overlapping capsule ends avoid squared-off upper
    // arms in the enlarged wall silhouette, without another draw call.
    part(new THREE.SphereGeometry(1, 8, 4), shoulder, sign * .25, 1.425, 0, .078, .082, .068);
    part(new THREE.CapsuleGeometry(.055, .23, 2, 8), shoulder, sign * .258, 1.28, 0);
    part(cylinder(.043, .28), elbow, sign * .258, .99, 0);
    part(round(), wrist, sign * .258, .795, .01, .041, .075, .027);
    limbs.arms.push({ shoulder, elbow, sign });
    const thigh = bone(hips, sign * .112, 0);
    const knee = bone(thigh, 0, -.42), ankle = bone(knee, 0, -.40);
    part(cylinder(.077, .42), thigh, sign * .112, .70, 0);
    part(cylinder(.054, .40), knee, sign * .112, .29, 0);
    part(new THREE.BoxGeometry(.12, .105, .245), ankle, sign * .112, .055, .06);
    limbs.legs.push({ thigh, knee, sign });
  }
  const geometry = mergeGeometries(parts, false); parts.forEach(value => value.dispose());
  geometry.computeBoundingSphere();
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.FrontSide });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = 'Invisible human shadow caster'; mesh.frustumCulled = false;
  mesh.add(root); mesh.bind(new THREE.Skeleton(bones));
  return { mesh, root, hips, limbs, triangles: geometry.index.count / 3 };
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
 * One 512² map, one skinned draw (~1k triangles), no room or cube-map rerender.
 */
export function createPlayerShadow(renderer, lampPosition) {
  const proxy = createHumanShadowProxy(), casterScene = new THREE.Scene();
  casterScene.add(proxy.mesh);
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
  let phase = 0, amplitude = 0, previousYaw = Infinity, previousMoving = false;
  let updates = 0, lastUpdateMs = -Infinity, lastRenderCalls = 0;
  let enabled = true, mapReady = false;

  function update(controls, dt, now, force = false) {
    const moving = controls.moving;
    const changed = previous.distanceToSquared(controls.position) > .0000001 ||
      Math.abs(previousYaw - controls.yaw) > .002 || moving !== previousMoving;
    if (!force && !changed && !moving && amplitude < .002) { lastRenderCalls = 0; return false; }
    if (!force && now - lastUpdateMs < 1000 / 30 - .5) { lastRenderCalls = 0; return false; }
    const elapsed = Number.isFinite(lastUpdateMs) ? Math.min((now - lastUpdateMs) / 1000, .1) : dt;
    phase += Math.max(0, controls.speed) * elapsed * 7.5;
    amplitude = THREE.MathUtils.damp(amplitude, moving ? (controls.running ? .9 : .55) : 0, 14, elapsed);
    proxy.mesh.position.copy(controls.position);
    proxy.mesh.rotation.y = controls.yaw + Math.PI;
    proxy.hips.position.y = .91 + Math.abs(Math.sin(phase)) * amplitude * .022;
    for (const { shoulder, elbow, sign } of proxy.limbs.arms) {
      const swing = Math.sin(phase + (sign < 0 ? Math.PI : 0));
      shoulder.rotation.x = swing * amplitude * .8;
      shoulder.rotation.z = sign * -.04;
      elbow.rotation.x = -.10 - Math.max(0, -swing) * amplitude * .5;
    }
    for (const { thigh, knee, sign } of proxy.limbs.legs) {
      const swing = Math.sin(phase + (sign < 0 ? 0 : Math.PI));
      thigh.rotation.x = swing * amplitude;
      knee.rotation.x = Math.max(0, -swing) * amplitude * 1.1;
    }
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
      updateHz: 30, staticRoomRedraws: 0,
    };
  }

  function dispose() {
    target.dispose(); proxy.mesh.geometry.dispose(); proxy.mesh.material.dispose(); proxy.mesh.skeleton.dispose();
  }
  function setEnabled(value) {
    enabled = Boolean(value); uniforms.quartoPlayerShadowActive.value = enabled && mapReady ? 1 : 0;
    return enabled;
  }
  return { update, patchShader, snapshot, dispose, setEnabled };
}
