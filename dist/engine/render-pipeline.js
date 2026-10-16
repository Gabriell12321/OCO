import * as THREE from 'three';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { attachBodycamLens } from './bodycam-lens.js';

/** OCO's render pipeline owns its targets and the display-color boundary.
 * Geometry/materials stay in linear HDR until the single OutputPass. */
export function createRenderPipeline(renderer, { fxaa = true } = {}) {
  let hdr = null, display = null, output = null, aa = null, lens = null;
  let lensEnabled = true;
  function dispose() {
    renderer.setRenderTarget(null);
    hdr?.dispose(); display?.dispose(); output?.dispose(); aa?.dispose();
    hdr = display = output = aa = lens = null;
  }
  function resize(width, height, quality) {
    if (!fxaa && quality !== 'quality') { if (hdr) dispose(); return; }
    if (!hdr) {
      hdr = new THREE.WebGLRenderTarget(width, height, {
        type: THREE.HalfFloatType, samples: fxaa ? 0 : Math.min(4, renderer.capabilities.maxSamples),
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        depthBuffer: true, stencilBuffer: false, generateMipmaps: false,
      });
      hdr.texture.name = 'OCO scene / linear HDR';
      hdr.texture.colorSpace = THREE.LinearSRGBColorSpace;
      output = new OutputPass(); output.renderToScreen = !fxaa;
      lens = attachBodycamLens(output); lens.setEnabled(lensEnabled);
      if (fxaa) {
        display = new THREE.WebGLRenderTarget(width, height, {
          type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
          depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
        });
        // OutputPass already encodes sRGB. Do not decode it before FXAA.
        display.texture.name = 'OCO display / sRGB values';
        display.texture.colorSpace = THREE.NoColorSpace;
        aa = new FXAAPass(); aa.renderToScreen = true;
      }
    } else hdr.setSize(width, height);
    display?.setSize(width, height); aa?.setSize(width, height);
    lens?.resize(width, height);
  }
  function render(scene, camera) {
    if (!hdr) { renderer.setRenderTarget(null); renderer.render(scene, camera); return; }
    renderer.setRenderTarget(hdr); renderer.render(scene, camera);
    output.render(renderer, display, hdr);
    if (aa) aa.render(renderer, null, display);
  }
  return { resize, render, dispose,
    setBodycamEnabled(value) { lensEnabled = Boolean(value); lens?.setEnabled(lensEnabled); },
    snapshot(contextSamples = 0) {
    return {
      postprocessing: Boolean(hdr), msaaSamples: hdr ? hdr.samples : contextSamples,
      contextMsaaSamples: contextSamples, renderTargetSamples: hdr?.samples || 0,
      renderPath: aa ? 'hdr-output-fxaa' : hdr ? 'hdr-msaa-output' : 'direct',
      colorPasses: aa ? 3 : hdr ? 2 : 1,
      antialiasing: aa ? 'fxaa' : (hdr?.samples || contextSamples) > 0 ? 'msaa' : 'none',
      resolve: aa ? 'fxaa-after-tone-mapping' : hdr ? 'hardware-msaa' : 'none',
      bodycamLens: lens?.snapshot() || { enabled: false, extraPasses: 0, extraTargets: 0 },
    };
  } };
}
