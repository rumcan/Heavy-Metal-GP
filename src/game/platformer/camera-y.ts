// The side-scrolling camera's height (Infinity and the races). Pure, so the tests can drive it.
//
// The camera stands on the track under it: it holds the track still on screen, so nothing bobs with the bumps, and the
// foreground stays glued to the track. It lifts (eased) only to keep a ball high in the air on screen, and drops (eased)
// to keep a falling one, so a jump never pushes the track or the trees up and down (the owner: nothing bobbing).

/** What the camera remembers between frames. */
export interface TrackCameraState {
  /** The camera's height on the track (the track under it, 15 px above), or null before any ground was seen. */
  trackBase: number | null;
  /** How far the camera is lifted (or dropped) to keep the ball on screen. */
  airLift: number;
}

export function newTrackCamera(): TrackCameraState {
  return { trackBase: null, airLift: 0 };
}

/**
 * The camera's y this frame: the ground under it (`ground`, null where there is none near: the last one holds), and the
 * ball's height. `framed`: false on the first frame, so the camera starts at its place instead of easing into it.
 */
export function trackCameraY(state: TrackCameraState, opts: { ground: number | null; ballY: number; height: number; scale: number; dtMs: number; framed: boolean }): number {
  const { ground, ballY, height, scale, dtMs, framed } = opts;
  if (ground !== null) state.trackBase = ground - 15;
  else if (state.trackBase === null) state.trackBase = ballY + 10;
  const trackBase = state.trackBase;
  const room = (height * 0.38) / scale;
  const lift = Math.max(ballY - room, Math.min(ballY + room, trackBase)) - trackBase;
  state.airLift = framed ? state.airLift + (lift - state.airLift) * (1 - Math.exp(-dtMs / 260)) : lift;
  return trackBase + state.airLift;
}
