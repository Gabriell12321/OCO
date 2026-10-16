// Budgets count actual drawing-buffer pixels, independent of Windows scaling.
export const PROFILES = Object.freeze({
  performance: { label: 'DESEMPENHO', pixels: 960 * 540 },
  balanced: { label: 'EQUILIBRADO', pixels: 1280 * 720 },
  quality: { label: 'QUALIDADE', pixels: 1600 * 900 },
});

export function drawingSize(viewWidth, viewHeight, dpr = 1, profile = 'balanced', adaptiveScale = 1) {
  const width = Math.max(1, viewWidth), height = Math.max(1, viewHeight);
  const budget = (PROFILES[profile] || PROFILES.balanced).pixels;
  const ratio = Math.min(Math.max(1, dpr), 1.25, Math.sqrt(budget / (width * height))) * adaptiveScale;
  return { width: Math.max(2, Math.floor(width * ratio / 2) * 2), height: Math.max(2, Math.floor(height * ratio / 2) * 2) };
}

export class PerformanceMonitor {
  constructor() {
    this.frameTimes = []; this.cpuTimes = []; this.fps = 0;
    this.totalFrames = 0; this.windowFrames = 0; this.windowStart = 0;
    this.warmupUntil = Infinity; this.started = 0;
  }
  start(now) {
    this.started = now; this.windowStart = now; this.warmupUntil = now + 5000;
    this.frameTimes.length = this.cpuTimes.length = 0; this.totalFrames = this.windowFrames = 0;
  }
  suspend() { this.windowStart = 0; this.windowFrames = 0; this.fps = 0; }
  record(now, frameMs, cpuMs) {
    if (!this.windowStart) this.windowStart = now;
    this.windowFrames++; this.totalFrames++;
    if (now >= this.warmupUntil && frameMs > 0) {
      this.frameTimes.push(frameMs); this.cpuTimes.push(cpuMs);
      if (this.frameTimes.length > 1800) { this.frameTimes.shift(); this.cpuTimes.shift(); }
    }
    const interval = now - this.windowStart;
    if (interval < 1000) return false;
    this.fps = this.windowFrames * 1000 / interval;
    this.windowFrames = 0; this.windowStart = now;
    return true;
  }
  snapshot() {
    const count = this.frameTimes.length;
    const sum = this.frameTimes.reduce((total, value) => total + value, 0);
    const sorted = this.frameTimes.slice().sort((a, b) => a - b);
    const percentile = p => count ? sorted[Math.min(count - 1, Math.ceil(count * p) - 1)] : 0;
    const sortedCpu = this.cpuTimes.slice().sort((a, b) => a - b);
    const cpuPercentile = p => count ? sortedCpu[Math.min(count - 1, Math.ceil(count * p) - 1)] : 0;
    return {
      fps: Math.round(this.fps * 10) / 10,
      meanFPS: count && sum ? Math.round(count * 10000 / sum) / 10 : 0,
      meanFrameMs: count ? Math.round(sum / count * 100) / 100 : 0,
      p95FrameMs: Math.round(percentile(.95) * 100) / 100,
      p99FrameMs: Math.round(percentile(.99) * 100) / 100,
      meanCpuMs: count ? Math.round(this.cpuTimes.reduce((a, b) => a + b, 0) / count * 100) / 100 : 0,
      p95CpuMs: Math.round(cpuPercentile(.95) * 100) / 100,
      p99CpuMs: Math.round(cpuPercentile(.99) * 100) / 100,
      framesOver25Ms: this.frameTimes.filter(value => value > 25).length,
      framesOver50Ms: this.frameTimes.filter(value => value > 50).length,
      benchmarkSamples: count, totalFrames: this.totalFrames, warmupSeconds: 5,
    };
  }
}

/** GPU time is read only after the driver reports a completed query. It never
 * calls finish(), waits for a frame, or treats CPU submit time as GPU time.
 */
export class GpuTimer {
  constructor(gl) {
    this.gl = gl; this.extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.pending = []; this.samples = []; this.current = null; this.counter = 0;
  }
  begin() {
    this.counter++;
    if (!this.extension || this.counter % 15 || this.pending.length > 3 || this.gl.isContextLost()) return;
    this.current = this.gl.createQuery();
    this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, this.current);
  }
  end() {
    if (!this.current) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.pending.push(this.current); this.current = null;
  }
  poll() {
    if (!this.extension || !this.pending.length) return;
    const gl = this.gl;
    if (gl.getParameter(this.extension.GPU_DISJOINT_EXT)) {
      this.pending.forEach(query => gl.deleteQuery(query)); this.pending.length = 0;
      return;
    }
    while (this.pending.length && gl.getQueryParameter(this.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const query = this.pending.shift(), ms = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(query);
      if (ms > 0 && ms < 1000) { this.samples.push(ms); if (this.samples.length > 120) this.samples.shift(); }
    }
  }
  snapshot() {
    const sorted = this.samples.slice().sort((a, b) => a - b), count = sorted.length;
    return {
      available: Boolean(this.extension), samples: count,
      meanMs: count ? Math.round(sorted.reduce((a, b) => a + b, 0) / count * 100) / 100 : null,
      p95Ms: count ? Math.round(sorted[Math.ceil(count * .95) - 1] * 100) / 100 : null,
    };
  }
}
