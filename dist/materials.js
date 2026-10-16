import * as THREE from 'three';

// Locally bundled photographic PBR maps. Source and CC0 license: ../ASSETS.md.
const SETS = {
  floor: { id: 'old_wood_floor', diffuseResolution: '2k', repeat: [2, 2] },
  plaster: { id: 'white_plaster_02', diffuseResolution: '2k', normalResolution: '2k', repeat: [1, 1] },
  timber: { id: 'dark_wood', diffuseResolution: '2k', normalResolution: '2k', repeat: [1, 1] },
  linen: { id: 'rough_linen', diffuseResolution: '2k', normalResolution: '2k', repeat: [3, 3] },
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
      texture(`${set.id}_nor_gl_${set.normalResolution || '1k'}.jpg`, set.repeat, false),
      texture(`${set.id}_rough_1k.jpg`, set.repeat, false),
    ]);
    return [key, { map, normalMap, roughnessMap }];
  }));
  const maps = Object.fromEntries(entries);

  // Tone photographs once at upload time. The room keeps its measured grain
  // and wear, without the red/orange varnish of the original timber sample.
  // No color-grading shader or extra render pass is needed while exploring.
  function photograph(source, { saturation = 1, gain = 1, warmth = [1, 1, 1], range } = {}) {
    if (!source?.image) return source;
    const canvas = document.createElement('canvas');
    canvas.width = source.image.width; canvas.height = source.image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(source.image, 0, 0);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = image.data;
    const linear = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const v = i / 255; linear[i] = v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
    }
    const toSRGB = value => value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055;
    for (let i = 0; i < pixels.length; i += 4) {
      if (range) {
        // Roughness is linear data. Real old surfaces stay matte even where
        // their scanned map contains a very dark polished speck.
        const value = Math.round((range[0] + pixels[i + 1] / 255 * (range[1] - range[0])) * 255);
        pixels[i] = pixels[i + 1] = pixels[i + 2] = value;
      } else {
        const luminance = linear[pixels[i]] * .2126 + linear[pixels[i + 1]] * .7152 + linear[pixels[i + 2]] * .0722;
        for (let channel = 0; channel < 3; channel++) {
          const value = (luminance + (linear[pixels[i + channel]] - luminance) * saturation) * gain * warmth[channel];
          pixels[i + channel] = Math.round(toSRGB(Math.max(0, Math.min(1, value))) * 255);
        }
      }
    }
    context.putImageData(image, 0, 0);
    const result = new THREE.CanvasTexture(canvas);
    result.name = `${range ? 'Matte' : 'Toned'} ${source.name}`;
    result.colorSpace = range ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    result.wrapS = result.wrapT = THREE.RepeatWrapping;
    result.repeat.copy(source.repeat); result.anisotropy = anisotropy;
    return result;
  }

  maps.timber.map = photograph(maps.timber.map, { saturation: .22, gain: 1.10, warmth: [1.04, 1.02, .94] });
  maps.floor.map = photograph(maps.floor.map, { saturation: .55, gain: 1.03, warmth: [1.03, 1.02, .98] });
  maps.plaster.map = photograph(maps.plaster.map, { saturation: .12, gain: 1.15 });
  maps.timber.roughnessMap = photograph(maps.timber.roughnessMap, { range: [.66, .91] });
  maps.floor.roughnessMap = photograph(maps.floor.roughnessMap, { range: [.57, .86] });
  maps.plaster.roughnessMap = photograph(maps.plaster.roughnessMap, { range: [.85, .99] });

  function patina(source, strength, seed) {
    if (!source?.image) return source;
    const canvas = document.createElement('canvas');
    canvas.width = source.image.width; canvas.height = source.image.height;
    const context = canvas.getContext('2d');
    context.drawImage(source.image, 0, 0);
    const size = canvas.width;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    context.globalCompositeOperation = 'multiply';
    for (let i = 0; i < 35; i++) {
      const x = random() * size, y = random() * size, radius = size * (.012 + random() * .14);
      const stain = context.createRadialGradient(x, y, radius * .06, x, y, radius);
      stain.addColorStop(0, `rgba(116,106,80,${strength * (.25 + random() * .75)})`);
      stain.addColorStop(1, 'rgba(116,106,80,0)');
      context.fillStyle = stain; context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    context.globalCompositeOperation = 'source-over';
    const map = new THREE.CanvasTexture(canvas); map.name = `Weathered ${source.name}`;
    map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.copy(source.repeat); map.anisotropy = anisotropy;
    return map;
  }

  function liningPaper(source) {
    const aged = patina(source, .045, 18429);
    if (!aged?.image) return aged;
    const context = aged.image.getContext('2d');
    const size = aged.image.width;
    // A two-metre texture tile contains four half-metre drops. These barely
    // visible joins make the wall read as old painted lining paper, rather
    // than a noisy masonry surface. The photographed patina remains intact.
    context.lineWidth = Math.max(.7, size / 2048);
    for (let drop = 0; drop < 4; drop++) {
      const x = (drop + .17) / 4 * size;
      context.strokeStyle = 'rgba(65,62,48,.075)';
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, size); context.stroke();
      context.strokeStyle = 'rgba(233,225,202,.095)';
      context.beginPath(); context.moveTo(x + size / 1200, 0); context.lineTo(x + size / 1200, size); context.stroke();
    }
    aged.name = 'Faded painted lining paper with quiet vertical joins';
    aged.needsUpdate = true;
    return aged;
  }

  function surface(name, mapsForSurface, options = {}) {
    const Material = options.sheen === undefined ? THREE.MeshStandardMaterial : THREE.MeshPhysicalMaterial;
    const material = new Material({
      ...mapsForSurface,
      roughness: 0.84,
      metalness: 0,
      normalScale: new THREE.Vector2(0.30, 0.30),
      ...options,
    });
    material.name = name;
    return material;
  }

  // Neutralize the photographic linen before uploading it. Both the raster
  // renderer and the progressive path tracer therefore see the same fabric.
  function neutralLinen(material, gain = 1.75) {
    if (!material.map?.image) return material;
    const source = material.map;
    const canvas = document.createElement('canvas');
    canvas.width = source.image.width; canvas.height = source.image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(source.image, 0, 0);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    const linear = new Float32Array(256);
    for (let value = 0; value < 256; value++) {
      const v = value / 255; linear[value] = v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
    }
    const toSRGB = v => v <= .0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - .055;
    for (let i = 0; i < data.length; i += 4) {
      const luminance = .2126 * linear[data[i]] + .7152 * linear[data[i + 1]] + .0722 * linear[data[i + 2]];
      const value = Math.round(toSRGB(Math.min(1, luminance * gain)) * 255);
      data[i] = data[i + 1] = data[i + 2] = value;
    }
    context.putImageData(image, 0, 0);
    const map = new THREE.CanvasTexture(canvas);
    map.name = `Neutral ${source.name}`; map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.copy(source.repeat); map.anisotropy = anisotropy;
    material.map = map;
    return material;
  }

  const floor = surface('Worn oak floor', maps.floor, {
    color: 0xd0c8ba,
    roughness: 1,
    normalScale: new THREE.Vector2(0.34, 0.34),
    envMapIntensity: 0.38,
  });
  const wall = surface('Faded putty lining paper over plaster', maps.plaster, {
    map: liningPaper(maps.plaster.map),
    color: 0xd2d0bd,
    roughness: 1,
    normalScale: new THREE.Vector2(0.10, 0.10),
  });
  const ceiling = surface('Warm plaster ceiling', maps.plaster, {
    color: 0xded9c8,
    roughness: 1,
    normalScale: new THREE.Vector2(0.06, 0.06),
  });
  const wood = surface('Aged walnut', maps.timber, {
    color: 0xc9c0ae,
    roughness: 1,
    normalScale: new THREE.Vector2(0.09, 0.09),
    envMapIntensity: 0.38,
  });
  const woodDark = surface('Dark walnut edges', maps.timber, {
    color: 0x777164,
    roughness: 1,
    normalScale: new THREE.Vector2(0.08, 0.08),
    envMapIntensity: 0.3,
  });
  const linen = neutralLinen(surface('Ivory linen', maps.linen, {
    color: 0xdbd4c4,
    roughness: 1,
    normalScale: new THREE.Vector2(0.13, 0.13),
    sheen: .18, sheenColor: 0xd0c5ad, sheenRoughness: .95,
  }), 1.65);

  // Give the duvet a larger weave, independently of pillow and curtain UVs.
  const blanketMaps = Object.fromEntries(Object.entries(maps.linen).map(([key, map]) => {
    if (!map) return [key, null];
    const copy = map.clone();
    copy.repeat.set(2, 2);
    copy.needsUpdate = true;
    return [key, copy];
  }));
  const blanket = neutralLinen(surface('Weathered tobacco woven throw', blanketMaps, {
    color: 0x898371,
    roughness: 0.97,
    normalScale: new THREE.Vector2(0.28, 0.28),
    side: THREE.DoubleSide,
    sheen: .23, sheenColor: 0xb9b29a, sheenRoughness: .98,
  }), 1.7);
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
    color: 0x81775a,
    metalness: 0.76,
    roughness: 0.62,
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
    color: 0xcec9b9,
    roughness: 0.98,
    normalScale: new THREE.Vector2(0.16, 0.16),
    side: THREE.DoubleSide,
    sheen: .17, sheenColor: 0xe2d4bc, sheenRoughness: .96,
  }), 1.55);
  const trim = surface('Worn ivory painted trim', maps.plaster, {
    map: patina(maps.plaster.map, .035, 7742),
    color: 0xc6c0ad,
    roughness: .92,
    normalScale: new THREE.Vector2(0.04, 0.04),
  });
  const paper = surface('Aged book paper', {}, {
    color: 0xc1b18c,
    roughness: 0.99,
  });

  return { floor, wall, ceiling, wood, woodDark, linen, blanket, rug, metal, brass, glass, curtain, trim, paper };
}
