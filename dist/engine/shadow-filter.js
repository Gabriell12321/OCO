import * as THREE from 'three';

// A local receiver plane is reliable inside the filter footprint, not across
// arbitrary geometry discontinuities. Bound its correction in world metres.
export const POINT_SHADOW_CORRECTION_LIMIT = .12;
const DENOMINATOR_EPSILON = .0001;

/** CPU reference for the shader's bounded ray/receiver-plane intersection. */
export function receiverPlaneTapDistance(receiver, planeNormal, tapDirection) {
  const length = Math.hypot(...receiver), directionLength = Math.hypot(...tapDirection);
  const normalLength = Math.hypot(...planeNormal);
  if (directionLength < 1e-6 || normalLength < 1e-10) return length;
  const normal = planeNormal.map(value => value / normalLength);
  const direction = tapDirection.map(value => value / directionLength);
  const denominator = normal.reduce((sum, value, i) => sum + value * direction[i], 0);
  const planeDistance = normal.reduce((sum, value, i) => sum + value * receiver[i], 0);
  if (Math.abs(denominator) < DENOMINATOR_EPSILON || planeDistance * denominator <= 0) return length;
  return length + Math.max(-POINT_SHADOW_CORRECTION_LIMIT, Math.min(POINT_SHADOW_CORRECTION_LIMIT, planeDistance / denominator - length));
}

const directionalFourTap = `
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
}`;

const receiverPlaneTap = `
float quartoReceiverPlaneTap(sampler2D shadowMap, vec3 tap, float texel,
    vec3 receiverNormal, float receiverPlaneDistance, float receiverDistance,
    float shadowCameraNear, float inverseShadowRange, float shadowBias) {
  vec3 ray = tap * inversesqrt(max(dot(tap, tap), 1e-12));
  float denominator = dot(receiverNormal, ray);
  float safeDenominator = mix(-1.0, 1.0, step(0.0, denominator)) * max(abs(denominator), ${DENOMINATOR_EPSILON});
  float valid = step(.5, dot(receiverNormal, receiverNormal))
    * step(${DENOMINATOR_EPSILON}, abs(denominator))
    * step(1e-12, receiverPlaneDistance * denominator);
  float correction = clamp(receiverPlaneDistance / safeDenominator - receiverDistance,
    -${POINT_SHADOW_CORRECTION_LIMIT}, ${POINT_SHADOW_CORRECTION_LIMIT}) * valid;
  float depth = (receiverDistance + correction - shadowCameraNear) * inverseShadowRange + shadowBias;
  return texture2DCompare(shadowMap, cubeToUV(tap, texel), depth);
}`;

const perfOffsets = ['vec3(-o,-o,o)', 'vec3(-o,o,-o)', 'vec3(o,-o,-o)', 'vec3(o,o,o)'];
const fullOffsets = [
  'vec3(-o,o,o)', 'vec3(o,o,o)', 'vec3(-o,o,-o)', 'vec3(o,o,-o)', 'vec3(0.0)',
  'vec3(-o,-o,o)', 'vec3(o,-o,o)', 'vec3(-o,-o,-o)', 'vec3(o,-o,-o)',
];

/** Keep Three's public shadow function signatures for the dynamic human map. */
export function createShadowChunk(full = false) {
  let original = THREE.ShaderChunk.shadowmap_pars_fragment
    .replace('float getPointShadow(', 'float getPointShadowLegacy(');
  if (!full) original = original.replace('float getShadow(', 'float getShadowLegacy(');
  const offsets = full ? fullOffsets : perfOffsets;
  const samples = offsets.map(offset => `quartoReceiverPlaneTap(shadowMap, direction + ${offset}, texel,
      receiverNormal, planeDistance, distanceToLight, shadowCameraNear, inverseShadowRange, shadowBias)`).join('\n    + ');
  return original + `
#ifdef USE_SHADOWMAP
${full ? '' : directionalFourTap}
${receiverPlaneTap}
float getPointShadow(sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity,
    float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar) {
  vec3 receiver = shadowCoord.xyz;
  // Evaluate screen derivatives before any near/far branch. They describe the
  // actual geometric receiver, without the fabric's micro-normal perturbation.
  vec3 plane = cross(dFdx(receiver), dFdy(receiver));
  vec3 receiverNormal = plane * inversesqrt(max(dot(plane, plane), 1e-20));
  float distanceToLight = length(receiver);
  if (distanceToLight < shadowCameraNear || distanceToLight > shadowCameraFar) return 1.0;
  vec3 direction = receiver / max(distanceToLight, 1e-6);
  float planeDistance = dot(receiverNormal, receiver);
  float inverseShadowRange = 1.0 / max(shadowCameraFar - shadowCameraNear, 1e-6);
  float texel = 1.0 / (shadowMapSize.y * 2.0);
  float o = shadowRadius * texel;
  float value = ${samples};
  return mix(1.0, value / ${offsets.length}.0, shadowIntensity);
}
#endif
`;
}
