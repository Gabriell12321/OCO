import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'three') return { url: new URL('../dist/vendor/three.module.js', import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import('three');
const { conditionFabricPixels, usePackedFabric } = await import('../dist/fabric.js');

// Known linear-light inputs detect premature 0/1 quantization and sRGB/data
// confusion. The channel carrying roughness must not change the normal RGB.
const gray = [32, 64, 128, 192];
const color = Uint8ClampedArray.from(gray.flatMap(value => [value, value, value, 17]));
const normal = Uint8ClampedArray.from(gray.flatMap(() => [150, 110, 239, 255]));
const roughness = Uint8ClampedArray.from([0, 85, 170, 255].flatMap(value => [99, value, 31, 255]));
const linear = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
const srgb = value => value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055;
const mean = gray.reduce((sum, value) => sum + linear(value / 255), 0) / gray.length;
conditionFabricPixels(color, normal, roughness);
for (let index = 0; index < gray.length; index++) {
  const i = index * 4;
  const expected = Math.round(srgb(Math.min(1, (mean + (linear(gray[index] / 255) - mean) * .72) * 1.7)) * 255);
  assert.ok(Math.abs(color[i] - expected) <= 1, 'Albedo is transformed in linear light and encoded once');
  assert.equal(color[i], color[i + 1]); assert.equal(color[i], color[i + 2]);
  assert.equal(color[i + 3], 255, 'Bedding remains opaque');
  assert.ok(normal[i + 3] >= 219 && normal[i + 3] <= 250, 'Cotton roughness remains within .86-.98');
  const magnitude = Math.hypot(...Array.from(normal.slice(i, i + 3), value => value / 127.5 - 1));
  assert.ok(Math.abs(magnitude - 1) < .008, 'Filtered normals are normalized');
  assert.deepEqual(normal.slice(i, i + 3), normal.slice(0, 3), 'Roughness never changes normal RGB');
  if (index) {
    assert.ok(color[i] > color[i - 4], 'Photographic luminance retains intermediate levels');
    assert.ok(normal[i + 3] > normal[i - 1], 'Roughness remains linear and monotonic');
  }
}
assert.throws(() => conditionFabricPixels(new Uint8ClampedArray(4), new Uint8ClampedArray(8), new Uint8ClampedArray(4)), /same RGBA dimensions/);

for (const Type of [THREE.MeshStandardMaterial, THREE.MeshPhysicalMaterial]) {
  const material = usePackedFabric(new Type(), true);
  const shader = { fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(shader);
  assert.equal((shader.fragmentShader.match(/texture2D\( normalMap,/g) || []).length, 1, 'Normal and roughness share exactly one texture fetch');
  assert.ok(!shader.fragmentShader.includes('#include <roughnessmap_fragment>'), 'There is no separate roughness sampler');
  assert.ok(shader.fragmentShader.includes('roughnessFactor *= quartoFabricTexel.a;'), 'Linear alpha controls roughness');
  assert.ok(shader.fragmentShader.includes('vec3 mapN = quartoFabricTexel.xyz * 2.0 - 1.0;'), 'Normal RGB uses that same sample');
  assert.ok(shader.fragmentShader.indexOf('vec4 quartoFabricTexel') < shader.fragmentShader.indexOf('vec3 mapN'), 'The sample is defined before normal use');
  assert.ok(shader.fragmentShader.includes('#include <lights_physical_fragment>'), 'Standard PBR lighting is retained');
  assert.equal(material.userData.packedFabric.textureLookups, 2);
}
const fallback = new THREE.MeshStandardMaterial();
const originalCompile = fallback.onBeforeCompile;
assert.equal(usePackedFabric(fallback, false).onBeforeCompile, originalCompile, 'Optional missing source maps leave the ordinary material intact');
console.log(JSON.stringify({ fabric: 'OK', albedo: [...color.filter((_, i) => i % 4 === 0)], roughness: [...normal.filter((_, i) => i % 4 === 3)], packedNormalFetches: 1, totalFabricFetches: 2 }));
