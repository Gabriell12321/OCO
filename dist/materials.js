import * as THREE from 'three';

// Locally bundled photographic PBR maps. Source and CC0 license: ../ASSETS.md.
const SETS = {
  floor: { id: 'old_wood_floor', diffuseResolution: '2k', repeat: [2, 2] },
  plaster: { id: 'white_plaster_02', repeat: [2, 1] },
  timber: { id: 'dark_wood', repeat: [1, 1] },
  linen: { id: 'rough_linen', repeat: [3, 3] },
  carpet: { id: 'dirty_carpet', repeat: [1, 1] },
};

/** Load real surface detail once; material variants share their GPU textures. */
export async function createMaterials(renderer, onProgress = () => {}) {
  const loader = new THREE.TextureLoader();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const mapCount = Object.keys(SETS).length * 3;
  let complete = 0;

  async function texture(path, repeat, isColor) {
    try {
      const map = await loader.loadAsync(new URL(`./assets/${path}`, import.meta.url).href);
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(...repeat);
      map.anisotropy = anisotropy;
      map.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      map.name = path;
      return map;
    } catch (error) {
      // A missing optional map should not prevent the room from opening.
      console.warn(`Surface map unavailable: ${path}`, error);
      return null;
    } finally {
      complete += 1;
      onProgress(complete / mapCount);
    }
  }

  const entries = await Promise.all(Object.entries(SETS).map(async ([key, set]) => {
    const [map, normalMap, roughnessMap] = await Promise.all([
      texture(`${set.id}_diff_${set.diffuseResolution || '1k'}.jpg`, set.repeat, true),
      texture(`${set.id}_nor_gl_1k.jpg`, set.repeat, false),
      texture(`${set.id}_rough_1k.jpg`, set.repeat, false),
    ]);
    return [key, { map, normalMap, roughnessMap }];
  }));
  const maps = Object.fromEntries(entries);

  function surface(name, mapsForSurface, options = {}) {
    const material = new THREE.MeshStandardMaterial({
      ...mapsForSurface,
      roughness: 0.84,
      metalness: 0,
      normalScale: new THREE.Vector2(0.30, 0.30),
      ...options,
    });
    material.name = name;
    return material;
  }

  // The source is blue linen. Reusing its photographic luminance yields natural
  // ivory pillows and curtains without tinting away the weave or fabric wear.
  function neutralLinen(material, gain = 1.75) {
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        #ifdef USE_MAP
          float weaveLuminance = dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          diffuseColor.rgb = diffuse * clamp(vec3(weaveLuminance * ${gain.toFixed(3)}), vec3(0.0), vec3(1.0));
        #endif`,
      );
    };
    material.customProgramCacheKey = () => `neutral-photographic-linen-${gain}`;
    return material;
  }

  const floor = surface('Worn oak floor', maps.floor, {
    color: 0xd4c5ad,
    roughness: 0.80,
    normalScale: new THREE.Vector2(0.45, 0.45),
    envMapIntensity: 0.5,
  });
  const wall = surface('Aged sage plaster', maps.plaster, {
    color: 0xc6c8ad,
    roughness: 0.95,
    normalScale: new THREE.Vector2(0.22, 0.22),
  });
  const ceiling = surface('Warm plaster ceiling', maps.plaster, {
    color: 0xe7dfca,
    roughness: 0.96,
    normalScale: new THREE.Vector2(0.12, 0.12),
  });
  const wood = surface('Aged walnut', maps.timber, {
    color: 0xc7ae8f,
    roughness: 0.65,
    normalScale: new THREE.Vector2(0.17, 0.17),
    envMapIntensity: 0.65,
  });
  const woodDark = surface('Dark walnut edges', maps.timber, {
    color: 0x6b5b4b,
    roughness: 0.72,
    normalScale: new THREE.Vector2(0.14, 0.14),
  });
  const linen = neutralLinen(surface('Ivory linen', maps.linen, {
    color: 0xe9e1cc,
    roughness: 0.98,
    normalScale: new THREE.Vector2(0.24, 0.24),
  }));

  // Give the duvet a larger weave, independently of pillow and curtain UVs.
  const blanketMaps = Object.fromEntries(Object.entries(maps.linen).map(([key, map]) => {
    if (!map) return [key, null];
    const copy = map.clone();
    copy.repeat.set(2, 2);
    copy.needsUpdate = true;
    return [key, copy];
  }));
  const blanket = surface('Dusty blue woven duvet', blanketMaps, {
    color: 0x8c9a9a,
    roughness: 0.97,
    normalScale: new THREE.Vector2(0.34, 0.34),
    side: THREE.DoubleSide,
  });
  const rug = surface('Worn charcoal rug', maps.carpet, {
    color: 0xcec2a5,
    roughness: 0.99,
    normalScale: new THREE.Vector2(0.46, 0.46),
  });
  const metal = surface('Blackened steel', {}, {
    color: 0x272829,
    metalness: 0.75,
    roughness: 0.66,
  });
  const brass = surface('Tarnished brass', {}, {
    color: 0x8a7040,
    metalness: 0.82,
    roughness: 0.46,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    name: 'Old window glass',
    color: 0x91a7b2,
    transparent: true,
    opacity: 0.12,
    transmission: 0,
    roughness: 0.19,
    metalness: 0.08,
    ior: 1.46,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const curtain = neutralLinen(surface('Aged ivory curtain', maps.linen, {
    color: 0xd7ccb4,
    roughness: 0.98,
    normalScale: new THREE.Vector2(0.16, 0.16),
    side: THREE.DoubleSide,
  }), 1.55);
  const trim = surface('Worn ivory painted trim', maps.plaster, {
    color: 0xd5c9ad,
    roughness: 0.76,
    normalScale: new THREE.Vector2(0.07, 0.07),
  });
  const paper = surface('Aged book paper', {}, {
    color: 0xc1b18c,
    roughness: 0.99,
  });

  return { floor, wall, ceiling, wood, woodDark, linen, blanket, rug, metal, brass, glass, curtain, trim, paper };
}
