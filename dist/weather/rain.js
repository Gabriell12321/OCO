import * as THREE from 'three';

// All motion runs in two small instanced vertex shaders. The glass occupies
// only the physical window; no screen-sized refraction pass or CPU particles.
export const RAIN_PROFILES = Object.freeze({
  performance: Object.freeze({ streaks: 620, drops: 220 }),
  balanced: Object.freeze({ streaks: 860, drops: 300 }),
  quality: Object.freeze({ streaks: 1100, drops: 380 }),
});

const streakVertex = /* glsl */`
  uniform float uTime;
  attribute vec4 aRain;
  attribute vec4 aShape;
  varying vec2 vUv;
  varying float vOpacity;
  void main() {
    // Each streak stays beyond the outer face of the glass. Different depths
    // give real parallax, while the room walls and mullions occlude normally.
    float phase = fract(aRain.w - uTime * aShape.x / 4.7);
    float y = -1.5 + phase * 4.7;
    float x = aRain.x + y * 0.12 + sin(uTime * .37 + aRain.w * 6.28) * .028;
    vec3 p = vec3(x, y, aRain.z);
    p.xy += vec2((uv.x - .5) * aShape.y + (uv.y - .5) * aShape.z * .12,
                 (uv.y - .5) * aShape.z);
    vUv = uv;
    // Fade the distant volume boundaries so a low viewing angle cannot reveal
    // the point where a streak wraps from the bottom back to the top.
    vOpacity = aShape.w * smoothstep(.0, .055, phase) * (1.0 - smoothstep(.945, 1.0, phase));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const streakFragment = /* glsl */`
  uniform float uIntensity;
  varying vec2 vUv;
  varying float vOpacity;
  void main() {
    // Analytic tapered film: the transparent quad never has a visible edge.
    vec2 q = vUv * 2.0 - 1.0;
    float core = max(0.0, 1.0 - q.x*q.x);
    float tip = pow(max(0.0, 1.0 - q.y*q.y), .7);
    float alpha = core * core * tip * vOpacity * uIntensity;
    if (alpha < .003) discard;
    gl_FragColor = vec4(vec3(.26, .36, .44), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const dropletVertex = /* glsl */`
  uniform float uTime;
  uniform vec2 uPane;
  attribute vec4 aDrop;
  attribute vec4 aFlow;
  varying vec2 vLocal;
  varying vec2 vPanePosition;
  varying vec4 vShape;
  varying float vAge;
  void main() {
    float phase = fract(aFlow.x + uTime / aFlow.y);
    float flowing = step(.5, aFlow.z) * (1.0 - step(1.5, aFlow.z));
    float y = mix(aDrop.y, uPane.y * .5 + .1 - phase * (uPane.y + .34), flowing);
    float x = aDrop.x + flowing * sin(phase * 9.0 + aFlow.x * 30.0) * .0022;
    float tail = aFlow.w;
    vec2 local = vec2((uv.x - .5) * 2.8 * aDrop.z,
      -aDrop.w * 1.35 + uv.y * (aDrop.w * 2.7 + tail));
    vLocal = local / aDrop.zw;
    vPanePosition = vec2(x, y) + local;
    vShape = vec4(tail / aDrop.w, aFlow.z, phase, aFlow.x);
    vAge = phase * aFlow.y;
    // The water is on the exterior, four millimetres behind the glass.
    gl_Position = projectionMatrix * modelViewMatrix * vec4(vPanePosition, -.004, 1.0);
  }
`;
const dropletFragment = /* glsl */`
  uniform vec2 uPane;
  uniform float uLamp;
  uniform float uIntensity;
  varying vec2 vLocal;
  varying vec2 vPanePosition;
  varying vec4 vShape;
  varying float vAge;
  void main() {
    if (any(greaterThan(abs(vPanePosition), uPane * .5))) discard;
    vec2 q = vLocal;
    // Water widens at its foot and narrows into the trail. A gentle asymmetry
    // avoids a grid of identical round sprites or an obvious square bitmap.
    q.x += .055 * sin(q.y * 2.1 + vShape.w * 18.0);
    float taper = .92 - .15 * clamp(q.y, -1.0, 1.0);
    vec2 bead = vec2(q.x / taper, q.y);
    float radius = length(bead);
    float aa = max(fwidth(radius), .035);
    float body = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, radius);
    float trailProgress = clamp(q.y / max(vShape.x, .001), 0.0, 1.0);
    float trailX = q.x - .095 * sin(q.y * 1.3 + vShape.w * 18.0);
    float trailWidth = mix(.19, .045, trailProgress);
    float trail = (1.0 - smoothstep(trailWidth, trailWidth + max(fwidth(q.x), .035), abs(trailX)))
      * smoothstep(.1, .7, q.y) * (1.0 - smoothstep(.70, 1.0, trailProgress)) * step(.1, vShape.x);
    float edge = smoothstep(.68, .99, radius) * body;
    vec3 normal = normalize(vec3(bead * .8, sqrt(max(.015, 1.0 - dot(bead, bead)))));
    float cool = pow(max(0.0, dot(normal, normalize(vec3(-.45, .65, .65)))), 24.0) * body;
    float warm = pow(max(0.0, dot(normal, normalize(vec3(.55, -.65, .51)))), 36.0) * body;
    // A tiny cool crescent and a warm lamp reflection surround a translucent
    // centre. This suggests refraction without sampling/copying the frame.
    float glint = cool * .52 + warm * .38 * uLamp;
    float alpha = (body * .065 + edge * .30 + trail * .12 + glint) * uIntensity;
    vec3 color = mix(vec3(.014, .023, .029), vec3(.35, .48, .56), clamp(glint * 3.6 + trail * .28, 0.0, 1.0));
    color += vec3(.38, .21, .075) * warm * uLamp;
    // Sparse new impacts spread for 90 ms and settle into a bead. They never
    // make screen-sized flashes or spawn droplets on the room side.
    if (vShape.y > 1.5) {
      float ring = (1.0 - smoothstep(.07, .18, abs(radius - (.18 + vAge * 12.0))))
        * (1.0 - smoothstep(.045, .09, vAge));
      alpha = alpha * smoothstep(.0, .025, vAge) * (1.0 - smoothstep(.65, 1.0, vShape.z)) + ring * .17;
      color += vec3(.09, .14, .18) * ring;
    }
    if (alpha < .002) discard;
    gl_FragColor = vec4(color, clamp(alpha, 0.0, .72));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function makeQuad() {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-.5,-.5,0, .5,-.5,0, .5,.5,0, -.5,.5,0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0,0, 1,0, 1,1, 0,1], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

export function createWindowRain(scene, {
  windowPosition = new THREE.Vector3(.4, 1.775, -3.23), width = 1.54, height = 1.45, seed = 811,
} = {}) {
  if (!(width > 0 && height > 0 && Number.isFinite(width + height))) throw new RangeError('Window dimensions must be finite and positive');
  if (!windowPosition?.isVector3 || ![windowPosition.x, windowPosition.y, windowPosition.z].every(Number.isFinite)) throw new TypeError('Window position must be a finite Vector3');
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const group = new THREE.Group(); group.name = 'Exterior rain and wet window'; group.position.copy(windowPosition);
  group.userData.dynamic = true; group.userData.noStaticBatch = true;
  const uniformTime = { value: 0 }, intensity = { value: 1 }, lamp = { value: 1 };
  const pane = { value: new THREE.Vector2(width, height) };
  const streakGeometry = makeQuad(), dropletGeometry = makeQuad();
  const rainData = new Float32Array(RAIN_PROFILES.quality.streaks * 4), shapes = new Float32Array(rainData.length);
  for (let i = 0; i < RAIN_PROFILES.quality.streaks; i++) {
    const depth = .13 + Math.pow(random(), 1.45) * 4.65;
    rainData.set([(random() - .5) * 5.7, 0, -depth, random()], i * 4);
    shapes.set([2.6 + random() * 2.0, .0017 + random() * .0035, .07 + random() * .16,
      (.14 + random() * .15) * (1 - depth / 7.5)], i * 4);
  }
  streakGeometry.setAttribute('aRain', new THREE.InstancedBufferAttribute(rainData, 4));
  streakGeometry.setAttribute('aShape', new THREE.InstancedBufferAttribute(shapes, 4));
  streakGeometry.boundingBox = new THREE.Box3(new THREE.Vector3(-3.3, -1.65, -4.8), new THREE.Vector3(3.3, 3.35, -.12));
  streakGeometry.boundingSphere = streakGeometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  const dropData = new Float32Array(RAIN_PROFILES.quality.drops * 4), flows = new Float32Array(dropData.length);
  for (let i = 0; i < RAIN_PROFILES.quality.drops; i++) {
    const kind = i % 10 < 2 ? 1 : i % 10 < 5 ? 2 : 0;
    // A small minority of coalesced beads carries the silhouette at the
    // 516-pixel performance buffer; most droplets remain millimetre-sized.
    const coalesced = i % 7 === 0;
    const radius = coalesced ? .006 + random() * .003 : .0023 + Math.pow(random(), 1.45) * (kind === 1 ? .0057 : .0045);
    const ry = radius * (kind === 1 ? 1.8 : 1.1 + random() * .75);
    dropData.set([(random() - .5) * (width - .02), (random() - .5) * (height - .02), radius, ry], i * 4);
    flows.set([random(), kind === 1 ? 12 + random() * 23 : 2.5 + random() * 5, kind,
      kind === 1 ? .035 + random() * .13 : 0], i * 4);
  }
  dropletGeometry.setAttribute('aDrop', new THREE.InstancedBufferAttribute(dropData, 4));
  dropletGeometry.setAttribute('aFlow', new THREE.InstancedBufferAttribute(flows, 4));
  dropletGeometry.boundingBox = new THREE.Box3(new THREE.Vector3(-width / 2 - .02, -height / 2 - .3, -.005),
    new THREE.Vector3(width / 2 + .02, height / 2 + .3, -.003));
  dropletGeometry.boundingSphere = dropletGeometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  const streakMaterial = new THREE.ShaderMaterial({ uniforms: { uTime: uniformTime, uIntensity: intensity },
    vertexShader: streakVertex, fragmentShader: streakFragment, transparent: true, depthWrite: false, side: THREE.FrontSide });
  const dropletMaterial = new THREE.ShaderMaterial({ uniforms: { uTime: uniformTime, uPane: pane, uLamp: lamp, uIntensity: intensity },
    vertexShader: dropletVertex, fragmentShader: dropletFragment, transparent: true, depthWrite: false, side: THREE.FrontSide });
  const streaks = new THREE.Mesh(streakGeometry, streakMaterial), droplets = new THREE.Mesh(dropletGeometry, dropletMaterial);
  streaks.name = 'Rain beyond the glass'; droplets.name = 'Beads impacts and rivulets on exterior glass';
  streaks.renderOrder = 1; droplets.renderOrder = 3;
  for (const mesh of [streaks, droplets]) {
    mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.userData.dynamic = true; mesh.userData.noStaticBatch = true;
    group.add(mesh);
  }
  scene.add(group);
  let quality = 'performance', enabled = true, disposed = false;
  function setQuality(value) {
    if (!RAIN_PROFILES[value]) return;
    quality = value;
    streakGeometry.instanceCount = RAIN_PROFILES[value].streaks;
    dropletGeometry.instanceCount = RAIN_PROFILES[value].drops;
  }
  function setTime(value) { if (Number.isFinite(value)) uniformTime.value = Math.max(0, value); }
  setQuality(quality);
  return {
    group,
    update(elapsed) { if (!disposed) setTime(elapsed); },
    setTime,
    setLampLevel(value) { if (Number.isFinite(value)) lamp.value = THREE.MathUtils.clamp(value, 0, 1.5); },
    setQuality,
    setEnabled(value) { enabled = Boolean(value); group.visible = enabled && !disposed; },
    snapshot() { return { enabled, quality, time: uniformTime.value, streaks: streakGeometry.instanceCount,
      drops: dropletGeometry.instanceCount, drawCalls: enabled && !disposed ? 2 : 0,
      triangles: (streakGeometry.instanceCount + dropletGeometry.instanceCount) * 2,
      lamp: lamp.value, shadowPasses: 0, textureUploadsPerFrame: 0, disposed }; },
    dispose() {
      if (disposed) return;
      disposed = true; group.removeFromParent();
      streakGeometry.dispose(); dropletGeometry.dispose(); streakMaterial.dispose(); dropletMaterial.dispose();
    },
  };
}
