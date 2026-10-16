import * as THREE from 'three';

const FABRIC_SIZE = 1024;
const FABRIC_REPEAT = 2; // The bed uses metres in its rest-space UVs: a 50 cm tile.
const linear = Float32Array.from({ length: 256 }, (_, index) => {
  const value = index / 255;
  return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
});
const srgb = value => value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055;

/** Condition an already filtered scan. Alpha belongs to roughness, never opacity. */
export function conditionFabricPixels(color, normal, roughness) {
  if (color.length !== normal.length || normal.length !== roughness.length || color.length % 4) {
    throw new Error('Fabric maps must have the same RGBA dimensions');
  }
  let mean = 0;
  for (let i = 0; i < color.length; i += 4) {
    mean += .2126 * linear[color[i]] + .7152 * linear[color[i + 1]] + .0722 * linear[color[i + 2]];
  }
  mean /= color.length / 4 || 1;
  for (let i = 0; i < color.length; i += 4) {
    const luminance = .2126 * linear[color[i]] + .7152 * linear[color[i + 1]] + .0722 * linear[color[i + 2]];
    // Preserve the photographed yarn and slubs, but reduce dark speckling.
    // This changes albedo in linear light, not the lighting of the room.
    const value = Math.max(0, Math.min(1, (mean + (luminance - mean) * .72) * 1.7));
    color[i] = color[i + 1] = color[i + 2] = Math.round(srgb(value) * 255);
    color[i + 3] = 255;

    // Downsampling averages normal vectors. Normalize once before upload;
    // runtime normalScale retains the material's physical relief strength.
    const nx = normal[i] / 127.5 - 1, ny = normal[i + 1] / 127.5 - 1;
    const nz = Math.max(.05, normal[i + 2] / 127.5 - 1);
    const length = Math.hypot(nx, ny, nz);
    normal[i] = Math.round((nx / length * .5 + .5) * 255);
    normal[i + 1] = Math.round((ny / length * .5 + .5) * 255);
    normal[i + 2] = Math.round((nz / length * .5 + .5) * 255);
    // Woven cotton has broad matte highlights, including its darker threads.
    normal[i + 3] = Math.round((.86 + roughness[i + 1] / 255 * .12) * 255);
  }
}

function raster(texture) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = FABRIC_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(texture.image, 0, 0, FABRIC_SIZE, FABRIC_SIZE);
  return { canvas, context, image: context.getImageData(0, 0, FABRIC_SIZE, FABRIC_SIZE) };
}

/** Two shared mipmapped textures replace three independent bedding textures. */
export function createFabricMaps(source, anisotropy) {
  if (!source.map?.image || !source.normalMap?.image || !source.roughnessMap?.image) return source;
  const color = raster(source.map), normal = raster(source.normalMap), roughness = raster(source.roughnessMap);
  conditionFabricPixels(color.image.data, normal.image.data, roughness.image.data);
  color.context.putImageData(color.image, 0, 0);
  const map = new THREE.CanvasTexture(color.canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.name = 'Filtered neutral cotton photograph, 50 cm tile';
  // A DataTexture keeps normal RGB independent of alpha premultiplication.
  const normalMap = new THREE.DataTexture(new Uint8Array(normal.image.data.buffer), FABRIC_SIZE, FABRIC_SIZE, THREE.RGBAFormat);
  normalMap.flipY = true;
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.name = 'Cotton tangent normal RGB + linear roughness A';
  for (const texture of [map, normalMap]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(FABRIC_REPEAT, FABRIC_REPEAT);
    texture.anisotropy = anisotropy;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
  }
  return { map, normalMap, roughnessMap: null, packedRoughness: true };
}

/** Reuse the normal lookup for roughness; keep the standard PBR lighting. */
export function usePackedFabric(material, packed = false) {
  if (!packed) return material;
  const lookup = 'texture2D( normalMap, vNormalMapUv ).xyz';
  if (!THREE.ShaderChunk.normal_fragment_maps.includes(lookup)) {
    throw new Error('The renderer normal-map chunk changed; update packed fabric support');
  }
  const normalChunk = THREE.ShaderChunk.normal_fragment_maps.replaceAll(lookup, 'quartoFabricTexel.xyz');
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <roughnessmap_fragment>', `
float roughnessFactor = roughness;
#ifdef USE_NORMALMAP
  vec4 quartoFabricTexel = texture2D( normalMap, vNormalMapUv );
  roughnessFactor *= quartoFabricTexel.a;
#endif`)
      .replace('#include <normal_fragment_maps>', normalChunk);
  };
  material.customProgramCacheKey = () => 'quarto-packed-fabric-v1';
  material.userData.packedFabric = { size: FABRIC_SIZE, tileMetres: .5, textureLookups: 2 };
  return material;
}
