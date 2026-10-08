// The side-scrolling camera's height (Infinity and the races). Pure, so the tests can drive it.
//
// The camera stands on the track under it and holds it still on screen: nothing bobs with the bumps, and the foreground
// stays glued to the track. It does not lift for a ball high in the air or drop for a falling one: the owner's rule is
// that the scenery never moves vertically, so a high jump can take the ball off the top of the screen.

/** What the camera remembers between frames. */
export interface TrackCameraState {
  /** The camera's height on the track (the ground under it, 15 px above), or null before any ground was seen. */
  trackBase: number | null;
}

export function newTrackCamera(): TrackCameraState {
  return { trackBase: null };
}

/**
 * The camera's y this frame: the ground under it (`ground`; null where there is none near, so the last one holds). Before
 * any ground has been seen, 10 px below the ball.
 */
export function trackCameraY(state: TrackCameraState, ground: number | null, ballY: number): number {
  if (ground !== null) state.trackBase = ground - 15;
  else if (state.trackBase === null) state.trackBase = ballY + 10;
  return state.trackBase;
}
