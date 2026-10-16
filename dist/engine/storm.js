// A sparse, reproducible storm clock. A single smooth envelope drives the
// window lighting, wet-glass reflections and the matching thunder event.
export const STORM_FIRST_FLASH_TIME = 10;
export const STORM_FLASH_ATTACK = .15;
export const STORM_FLASH_DURATION = 1.05;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const x = clamp(value); return x * x * (3 - 2 * x); };
const hash = value => { const x = Math.sin(value * 127.1 + 17.19) * 43758.5453; return x - Math.floor(x); };

export function stormEventTime(index) {
  const event = Math.max(0, Math.floor(Number.isFinite(index) ? index : 0));
  // Independent bounded jitter gives 27–39 seconds between adjacent strikes,
  // without accumulating a schedule or iterating over past events each frame.
  return STORM_FIRST_FLASH_TIME + event * 33 + (event === 0 ? 0 : (hash(event) - .5) * 6);
}

export function sampleStormSignal(seconds, result = {}) {
  const time = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  let gain = 0, event = -1, strength = 0, age = -1;
  const estimate = Math.floor((time - STORM_FIRST_FLASH_TIME) / 33);
  for (let offset = -1; offset <= 1; offset++) {
    const candidate = estimate + offset;
    if (candidate < 0) continue;
    const local = time - stormEventTime(candidate);
    if (local < 0 || local >= STORM_FLASH_DURATION) continue;
    strength = candidate === 0 ? 1 : .82 + hash(candidate + 38) * .18;
    const attack = smooth(local / STORM_FLASH_ATTACK);
    const tail = 1 - smooth((local - STORM_FLASH_ATTACK) / (STORM_FLASH_DURATION - STORM_FLASH_ATTACK));
    gain = strength * attack * tail;
    event = candidate; age = local;
    break;
  }
  result.gain = gain; result.event = event; result.strength = strength; result.age = age;
  return result;
}
