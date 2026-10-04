// Perf: automatic render resolution. A phone or an old laptop that cannot draw the race at full sharpness in time
// drops frames, and dropped frames are what stutter feels like. This watches the real frame interval: when frames
// keep arriving late it renders a little softer (fewer pixels, scaled up smoothly by the browser), and when there is
// room again it goes back up. It never goes above the screen's own density (capped at 2) or below 60 % of it.

export const MIN_SCALE = 0.6;
const STEP = 0.15;
/** How long frames must be late (or comfortably on time) before the resolution moves. */
const SLOW_MS = 1200;
const FAST_MS = 4000;

export class RenderScale {
  /** Multiplier on the device pixel ratio (1 = full sharpness). */
  scale = 1;
  private refresh = 1000 / 60;
  private avg = 1000 / 60;
  private slowFor = 0;
  private fastFor = 0;

  /**
   * Feed one frame interval (ms). Returns true when the scale changed (the caller resizes its canvas). Long gaps
   * (a background tab, a pause) are ignored.
   */
  observe(dt: number): boolean {
    if (!(dt > 0) || dt > 250) return false;
    // The display's own refresh interval: the shortest interval seen lately (drifts up slowly so a 120 Hz screen that
    // drops to 60 Hz on battery is followed).
    this.refresh = Math.min(dt, this.refresh * 1.0005 + 0.0005);
    this.avg += (dt - this.avg) * 0.1;
    const late = this.avg > this.refresh * 1.35;
    const easy = this.avg < this.refresh * 1.08;
    this.slowFor = late ? this.slowFor + dt : 0;
    this.fastFor = easy ? this.fastFor + dt : 0;
    if (this.slowFor > SLOW_MS && this.scale > MIN_SCALE) {
      this.scale = Math.max(MIN_SCALE, Math.round((this.scale - STEP) * 100) / 100);
      this.slowFor = 0;
      return true;
    }
    if (this.fastFor > FAST_MS && this.scale < 1) {
      this.scale = Math.min(1, Math.round((this.scale + STEP) * 100) / 100);
      this.fastFor = 0;
      return true;
    }
    return false;
  }

  /** The canvas pixel ratio to use for this screen. */
  ratio(devicePixelRatio: number): number {
    return Math.max(0.75, Math.min(2, devicePixelRatio || 1) * this.scale);
  }
}
