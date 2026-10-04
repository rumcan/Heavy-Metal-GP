// Perf: an on-screen frame meter for the race and Infinity. Press F3 (or open the game with ?fps in the address) to
// show it. It tells apart the two ways a game can be slow:
//   - "CPU" (physics + drawing commands) close to the frame time: the processor is the limit;
//   - frame time far above "CPU": the graphics card or the browser's compositor is the limit (pixels, effects).
// Nothing is stored; it is a diagnostic only.

const WINDOW_MS = 1000;

export class PerfMeter {
  enabled = typeof location !== 'undefined' && /[?&]fps\b/.test(location.search);
  private frames: number[] = [];
  private sums = { physics: 0, draw: 0, fx: 0, n: 0 };
  private shown = { fps: 0, frame: 0, worst: 0, physics: 0, draw: 0, fx: 0 };
  private windowStart = 0;
  private marks = { physics: 0, draw: 0, fx: 0 };

  toggle(): void { this.enabled = !this.enabled; }

  /** Time a phase of this frame. */
  time<T>(phase: 'physics' | 'draw' | 'fx', fn: () => T): T {
    if (!this.enabled) return fn();
    const a = performance.now();
    try { return fn(); } finally { this.marks[phase] += performance.now() - a; }
  }

  /** Call once per frame with the frame interval, then `draw` to paint the box. */
  frame(now: number, dt: number): void {
    if (!this.enabled) return;
    this.frames.push(dt);
    this.sums.physics += this.marks.physics; this.sums.draw += this.marks.draw; this.sums.fx += this.marks.fx; this.sums.n++;
    this.marks = { physics: 0, draw: 0, fx: 0 };
    if (now - this.windowStart >= WINDOW_MS) {
      const sorted = [...this.frames].sort((a, b) => a - b);
      const n = Math.max(1, this.sums.n);
      this.shown = {
        fps: this.frames.length * 1000 / Math.max(1, now - this.windowStart),
        frame: sorted[Math.floor(sorted.length / 2)] ?? 0,
        worst: sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0,
        physics: this.sums.physics / n, draw: this.sums.draw / n, fx: this.sums.fx / n,
      };
      this.frames = []; this.sums = { physics: 0, draw: 0, fx: 0, n: 0 }; this.windowStart = now;
    }
  }

  draw(ctx: CanvasRenderingContext2D, cssWidth: number, extra: string): void {
    if (!this.enabled) return;
    const s = this.shown;
    const cpu = s.physics + s.draw + s.fx;
    const lines = [
      `${s.fps.toFixed(0)} FPS   frame ${s.frame.toFixed(1)} ms (95%: ${s.worst.toFixed(1)})`,
      `CPU ${cpu.toFixed(1)} ms = physics ${s.physics.toFixed(1)} + draw ${s.draw.toFixed(1)}${s.fx ? ` + effects ${s.fx.toFixed(1)}` : ''}`,
      `${s.frame > cpu * 2 + 4 ? 'limit: graphics / browser' : 'limit: processor'}   ${extra}`,
    ];
    ctx.save();
    const dpr = ctx.getTransform().a || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '12px ui-monospace, Consolas, monospace';
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
    const x = Math.max(8, cssWidth - w - 8), y = 56;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(x, y, w, lines.length * 16 + 10);
    ctx.fillStyle = s.fps >= 55 ? '#86efac' : s.fps >= 40 ? '#fde68a' : '#fca5a5';
    lines.forEach((l, i) => ctx.fillText(l, x + 8, y + 18 + i * 16));
    ctx.restore();
  }
}
