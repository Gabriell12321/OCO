/** A restrained wide-angle sensor, folded into the existing HDR output pass.
 * The radial map stays inside the source image at every aspect ratio. There
 * is no extra render target, image history, random grain or per-frame upload. */
export function attachBodycamLens(output) {
  const uniforms = {
    bodycamEnabled: { value: 1 },
    bodycamAspect: { value: 1 },
    bodycamDistortion: { value: .18 },
  };
  Object.assign(output.uniforms, uniforms);
  const sample = 'gl_FragColor = texture2D( tDiffuse, vUv );';
  if (!output.material.fragmentShader.includes(sample)) throw new Error('The HDR output sampling boundary has changed.');
  output.material.name = 'OCO bodycam / AgX display';
  output.material.fragmentShader = output.material.fragmentShader
    .replace('varying vec2 vUv;', `varying vec2 vUv;
      uniform float bodycamEnabled;
      uniform float bodycamAspect;
      uniform float bodycamDistortion;`)
    .replace(sample, `
      vec2 sensorUV = vUv;
      float radiusSquared = 0.0;
      if (bodycamEnabled > 0.5) {
        vec2 centred = vUv * 2.0 - 1.0;
        vec2 lensPlane = centred * vec2(bodycamAspect, 1.0);
        radiusSquared = dot(lensPlane, lensPlane) / (bodycamAspect * bodycamAspect + 1.0);
        float radialScale = (1.0 + bodycamDistortion * radiusSquared) / (1.0 + bodycamDistortion);
        sensorUV = 0.5 + 0.5 * centred * radialScale;
      }
      gl_FragColor = texture2D(tDiffuse, sensorUV);
      if (bodycamEnabled > 0.5) {
        // Subpixel colour separation belongs to the optical periphery only.
        // Fade it out before the source boundary instead of stretching edges.
        float edgeDistance = min(min(sensorUV.x, sensorUV.y), min(1.0 - sensorUV.x, 1.0 - sensorUV.y));
        float fringe = 0.0009 * radiusSquared * radiusSquared * smoothstep(0.0, 0.012, edgeDistance);
        vec2 split = (sensorUV - 0.5) * fringe;
        gl_FragColor.r = texture2D(tDiffuse, sensorUV + split).r;
        gl_FragColor.b = texture2D(tDiffuse, sensorUV - split).b;
        gl_FragColor.rgb *= 1.0 - 0.22 * smoothstep(0.18, 1.0, radiusSquared);
      }
    `);
  output.material.needsUpdate = true;
  return {
    resize(width, height) {
      uniforms.bodycamAspect.value = width / height;
    },
    setEnabled(enabled) { uniforms.bodycamEnabled.value = enabled ? 1 : 0; },
    snapshot() {
      return { enabled: Boolean(uniforms.bodycamEnabled.value), distortion: uniforms.bodycamDistortion.value,
        chromaticFringe: 'subpixel-periphery', vignette: .22, extraPasses: 0, extraTargets: 0 };
    },
  };
}
