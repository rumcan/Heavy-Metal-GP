// Perf: automatic render resolution. A phone or an old laptop that cannot draw the race at full sharpness in time
// drops frames, and dropped frames are what stutter feels like. This watches the real frame interval: when frames
// keep arriving late it renders a little softer (fewer pixels, scaled up smoothly by the browser), and when there is
// room again it goes back up. It never goes above the screen's own density (capped at 2) or below 60 % of it.
//
// It only steps in for a real slowdown (under ~45 frames a second, held for a while). An earlier version took the
// display's refresh from the SHORTEST frame gap it saw; browsers sometimes deliver two frames a couple of ms apart,
// so on a fast screen every normal frame then looked late, the game dropped itself to 60 % (blurry) and kept
// resizing its canvas (a hitch each time).

export const MIN_SCALE = 0.6;
const STEP = 0.15;
/** Frames this slow on average (ms) count as late: below ~45 FPS. */
const LATE_MS = 22;
/** Room to go back up: frames comfortably under 60 FPS pace. */
const EASY_MS = 15;
/** How long frames must be late (or easy) before the resolution moves. */
const SLOW_MS = 2000;
const FAST_MS = 6000;

export class RenderScale {
  /** Multiplier on the device pixel ratio (1 = full sharpness). */
  scale = 1;
  private avg = 1000 / 60;
  private slowFor = 0;
  private fastFor = 0;

  /**
   * Feed one frame interval (ms). Returns true when the scale changed (the caller resizes its canvas). Long gaps
   * (a background tab, a pause) are ignored.
   */
  observe(dt: number): boolean {
    if (!(dt > 0) || dt > 250) return false;
    this.avg += (dt - this.avg) * 0.05;
    this.slowFor = this.avg > LATE_MS ? this.slowFor + dt : 0;
    this.fastFor = this.avg < EASY_MS ? this.fastFor + dt : 0;
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
