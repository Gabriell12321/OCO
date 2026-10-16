/** Slow, hysteretic adaptation. The minimum pixel budget applies even in the
 * performance profile; previously that profile could never scale down. */
export class ResolutionGovernor {
  constructor() { this.reset(); }
  reset(now = 0) { this.scale = 1; this.slow = this.fast = 0; this.next = now + 5000; }
  update({ now, fps, gpuMs, pixels, enabled = true }) {
    if (!enabled || now < this.next || fps <= 0) return this.scale;
    this.next = now + 1000;
    const minimum = Math.min(1, Math.sqrt((640 * 360) / pixels));
    const hasGpu = Number.isFinite(gpuMs) && gpuMs > 0;
    const overloaded = fps < 50 || (hasGpu && gpuMs > 18);
    // Raising the pixel count must fit in the next frame as well. Stable FPS
    // at a reduced resolution alone is not evidence of spare GPU capacity.
    const spare = fps > 58 && (!hasGpu || gpuMs < 11.5);
    this.slow = overloaded ? this.slow + 1 : 0;
    this.fast = !overloaded && spare ? this.fast + 1 : 0;
    if (this.slow >= 3 && this.scale > minimum + .005) {
      this.scale = Math.max(minimum, this.scale * .9);
      this.slow = this.fast = 0; this.next = now + 3000;
    } else if (this.fast >= 10 && this.scale < .999) {
      this.scale = Math.min(1, this.scale / .9);
      this.slow = this.fast = 0; this.next = now + 3000;
    }
    return this.scale;
  }
}
