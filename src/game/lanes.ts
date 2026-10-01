export const LANE_BACK = 0;
export const LANE_MIDDLE = 1;
export const LANE_FRONT = 2;

export interface LaneLook {
  name: string;
  scale: number;
  parallax: number;
  fog: number;
  blur: number;
}

export const LANES: readonly LaneLook[] = [
  { name: 'back', scale: 0.75, parallax: 0.7, fog: 0.35, blur: 3 },
  { name: 'middle', scale: 1, parallax: 1, fog: 0, blur: 0 },
  { name: 'front', scale: 1.25, parallax: 1.35, fog: 0, blur: 0 },
];

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

export function laneBlend(
  from: number,
  to: number,
  t: number,
): { scale: number; parallax: number; fog: number; blur: number } {
  const start = LANES[from];
  const end = LANES[to];
  const clampedT = Math.max(0, Math.min(1, t));
  const easedT = clampedT * clampedT * (3 - 2 * clampedT);

  return {
    scale: start.scale + (end.scale - start.scale) * easedT,
    parallax: start.parallax + (end.parallax - start.parallax) * easedT,
    fog: start.fog + (end.fog - start.fog) * easedT,
    blur: start.blur + (end.blur - start.blur) * easedT,
  };
}

interface Pt {
  x: number;
  y: number;
}

export function projectToScreen(
  world: Pt,
  lane: number,
  cam: { x: number; y: number; scale: number },
  view: { w: number; h: number },
): { x: number; y: number; scale: number } {
  const look = LANES[lane];
  return {
    x: view.w / 2 + (world.x - cam.x) * cam.scale * look.parallax,
    y: view.h / 2 + (world.y - cam.y) * cam.scale * look.parallax,
    scale: cam.scale * look.scale,
  };
}

export function laneAlpha(lane: number, playerLane: number): number {
  if (lane === playerLane) return 1;
  return lane > playerLane ? 0.85 : 0.6;
}

export function drawOrder(): number[] {
  return [LANE_BACK, LANE_MIDDLE, LANE_FRONT];
}