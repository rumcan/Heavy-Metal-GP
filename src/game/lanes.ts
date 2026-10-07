// P2-00 (#124): three depth lanes (2.5D). Each lane is a flat 2D layer; depth is faked on screen.
//
// Presentation rules (approved from the prototype):
// - The camera always "stands" on the lane you are on: that lane draws at scale 1, sharp, no fog.
// - Only lanes BEHIND you are drawn. Lanes in front of you are never drawn over the player.
// - Lanes behind are a little smaller, a little higher, hazed and blurred (one STEP per lane).
// - Changing lane is a camera dolly: the camera's depth ("focus") eases from one lane to the next,
//   so the lane you leave forward swells and fades out, and the lane you dive into sharpens.

export const LANE_BACK = 0;
export const LANE_MIDDLE = 1;
export const LANE_FRONT = 2;
export const LANE_NAMES = ['back', 'middle', 'front'] as const;

/**
 * Which lanes a course has (the owner: build one lane at a time, a course has 1, 2 or 3): the main (middle) lane
 * always; a second lane is the back one (seen behind you from the main lane); a third the front one.
 */
export const LANE_SETS: Record<1 | 2 | 3, readonly number[]> = { 1: [1], 2: [0, 1], 3: [0, 1, 2] };
export function lanesOf(count: number | undefined): readonly number[] {
  return LANE_SETS[(count === 1 || count === 2 ? count : 3) as 1 | 2 | 3];
}

/**
 * Each lane behind you is drawn this much smaller, so it also slides past this much slower: depth (the owner: every
 * layer, near to far, at its own speed; the far track clearly slower).
 */
export const LANE_STEP = 0.72;
/** Each lane behind you sits this many world px higher (before zoom). */
export const LANE_LIFT = 38;
/** Fog added per lane behind you, capped at FOG_MAX. */
export const LANE_FOG = 0.55;
export const FOG_MAX = 0.85;
/** Blur (screen px) per lane behind you. */
export const LANE_BLUR = 0; // the owner wants distant tracks sharp: depth is size, height and blue haze
/** How fast a lane in front of the camera fades out (alpha lost per lane of depth). */
export const FRONT_FADE = 1.5;
/** A lane in front of the camera swells past it: extra scale per lane of depth (sells the dolly). */
export const FRONT_SWELL = 0.8;
/** A lane change takes this long. */
export const LANE_SWITCH_MS = 750;

export interface LaneView {
  scale: number;
  lift: number;
  fog: number;
  blur: number;
  alpha: number;
}

export const NON_LANE_MASK = 0x0fff;

export function laneCategory(lane: number): number {
  if (lane !== LANE_BACK && lane !== LANE_MIDDLE && lane !== LANE_FRONT) {
    throw new Error(`Invalid lane: ${lane}`);
  }
  return 0x1000 << lane;
}

export function laneMask(lane: number): number {
  return NON_LANE_MASK | laneCategory(lane);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Ease in-out cubic: slow start, fast middle, soft landing (the camera dolly). */
export function dollyEase(t: number): number {
  const c = clamp(t, 0, 1);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

/** Camera depth during a lane change: `from` at t=0, `to` at t=1. */
export function laneFocus(from: number, to: number, t: number): number {
  return from + (to - from) * dollyEase(t);
}

/** How a lane looks from a camera standing at depth `focus` (a lane index, fractional mid-change). */
export function laneView(lane: number, focus: number): LaneView {
  const rel = focus - lane; // > 0: the lane is behind you
  return {
    scale: Math.pow(LANE_STEP, rel) * (rel < 0 ? 1 - rel * FRONT_SWELL : 1),
    lift: -rel * LANE_LIFT,
    fog: clamp(rel * LANE_FOG, 0, FOG_MAX),
    blur: Math.max(0, rel * LANE_BLUR),
    alpha: rel >= 0 ? 1 : Math.max(0, 1 + rel * FRONT_FADE),
  };
}

/** Lanes to draw, back to front: everything behind the camera, plus a lane still fading out in front. */
export function visibleLanes(focus: number): number[] {
  return [LANE_BACK, LANE_MIDDLE, LANE_FRONT].filter((l) => laneView(l, focus).alpha > 0.01);
}

interface Pt {
  x: number;
  y: number;
}

/** World point in `lane` to screen. The camera point of the focused lane is the screen centre. */
export function projectToScreen(
  world: Pt,
  lane: number,
  cam: { x: number; y: number; zoom: number; focus: number },
  view: { w: number; h: number },
): { x: number; y: number; scale: number } {
  const v = laneView(lane, cam.focus);
  const s = cam.zoom * v.scale;
  return {
    x: view.w / 2 + (world.x - cam.x) * s,
    y: view.h / 2 + (world.y - cam.y) * s + v.lift * cam.zoom,
    scale: s,
  };
}

/**
 * Crossing tracks: each way through a crossing (a passage) collides in its own category, one of these eight bits. A ball
 * inside a crossing keeps only its own passage's bit in its mask; outside crossings it keeps all of them (every track is
 * solid). The bits sit above the lane bits (0x1000..0x4000) and every other category in track.ts.
 */
export const PLY_COUNT = 8;
export const CAT_PLY0 = 0x10000;
export const ALL_PLY = 0xff0000;
export const plyBit = (k: number): number => CAT_PLY0 << Math.max(0, Math.min(PLY_COUNT - 1, k));
