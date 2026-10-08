// The time the motion runs on, per frame (the Infinity and race loops). Pure, so the tests can drive it.
//
// A browser's frames come at uneven intervals (a busy frame, a GC pause, 16 then 33 ms). Run straight, every camera ease
// and every physics step each frame moved the picture by that frame's own uneven amount: the judder at top speed (on a
// steady 60 Hz timing the camera moved within 1% from frame to frame; with +-2 ms of jitter, by 13 to 18%). So the frame
// interval is smoothed over a few frames (exponential, 1 - exp(-raw / tau), so frame-rate independent). Over any
// stretch the total is still the real time: the filter only spreads the jitter out. A stall, a frame that comes far off
// the last one, is real time and is taken as it is (smoothing it would leave the game behind the clock).

/** A 60 Hz frame: the filter's weight per frame is fixed, so it adds up to the real time (a weight that grew with each frame's own length would lean toward the long ones). */
const NOMINAL_MS = 1000 / 60;

/**
 * The smoothed frame interval (ms). `prev` is the last one (null on the first frame). `raw` is this frame's interval,
 * already clamped by the caller. Smoothed over about `tauMs`; a frame that comes `stallMs` or more off the last one is
 * taken as it is, so after a stall the picture is back at the frame rate on the next frame, with no lag.
 */
export function smoothFrameMs(prev: number | null, raw: number, tauMs = 90, stallMs = 25): number {
  if (prev === null || Math.abs(raw - prev) > stallMs) return raw;
  return prev + (raw - prev) * (1 - Math.exp(-NOMINAL_MS / tauMs));
}
