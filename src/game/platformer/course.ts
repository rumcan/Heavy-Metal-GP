// P2-00 (#124): the platformer course plan. Pure data, no Matter.js: a course is three lanes of floor
// (top edges as line segments), bumps to jump, gaps to clear, lane gates between lanes, a start and a finish.
// Deterministic from the seed (multiplayer and replays build the same course).
import { mulberry32 } from '../types';
import { LANE_BACK, LANE_FRONT, LANE_MIDDLE } from '../lanes';

export type Lane = 0 | 1 | 2;

/** Quick race's pick for the platformer preview (stands in for a My tracks id). */
export const PLATFORMER_TRACK_ID = 'platformer-preview';

/** One stretch of floor: its top edge runs from (x0, y0) to (x1, y1). */
export interface Floor { lane: Lane; x0: number; y0: number; x1: number; y1: number }
/** A raised block on a floor: jump it (its top is `y`, it sits on the floor below). */
export interface Bump { lane: Lane; x: number; w: number; y: number; h: number }
/**
 * A way between two lanes, `x`..`x + w` along the course.
 * - `ramp`: rolling through it on the ground takes you to `to` (jump over it to stay).
 * - `door`: press jump inside it to go through to `to`.
 */
export interface LaneGate { kind: 'ramp' | 'door'; lane: Lane; to: Lane; x: number; w: number; y: number }

export interface CoursePlan {
  seed: number;
  /** World size: the course runs from x = 0 to `width`, top at y = 0. */
  width: number;
  height: number;
  floors: Floor[];
  bumps: Bump[];
  gates: LaneGate[];
  /** The race line (above the middle lane's floor, through its gaps): progress is measured along it. */
  path: { x: number; y: number }[];
  /** Where the start wall stands; the grid lines up behind it. */
  startX: number;
  startY: number;
  /** Crossing this x (on any lane) finishes the race. */
  finishX: number;
  finishY: number;
}

export const COURSE_TUNING = {
  length: 22000,
  startY: 600,
  startLen: 900,
  finishLen: 1000,
  sectionMin: 560,
  sectionMax: 1240,
  /** Chance per section and lane of a gap. Middle is the safe line; the outer lanes are riskier. */
  gapChance: [0.32, 0.16, 0.38] as readonly number[],
  gapMin: 90,
  gapMax: 170,
  bumpChance: [0.3, 0.22, 0.34] as readonly number[],
  gateChance: 0.55,
  gateW: 170,
};

const LANES: Lane[] = [LANE_BACK, LANE_MIDDLE, LANE_FRONT] as Lane[];
const snap = (v: number) => Math.round(v / 10) * 10;

type Shape = 'flat' | 'slope' | 'stepDown' | 'stepUp';

/** Plan a platformer course from a seed. */
export function planCourse(seed: number, tuning = COURSE_TUNING): CoursePlan {
  const rng = mulberry32(seed ^ 0x51ed27);
  const roll = (a: number, b: number) => a + rng() * (b - a);
  const floors: Floor[] = [];
  const bumps: Bump[] = [];
  const gates: LaneGate[] = [];
  const path: { x: number; y: number }[] = [];
  const startY = tuning.startY;

  // Start: one long flat stretch in every lane.
  let x = 0;
  let y = startY;
  for (const lane of LANES) floors.push({ lane, x0: -200, y0: y, x1: tuning.startLen, y1: y });
  path.push({ x: 0, y: y - 30 }, { x: tuning.startLen, y: y - 30 });
  x = tuning.startLen;
  const startX = 520;

  const end = tuning.length - tuning.finishLen;
  let lastShape = 'flat' as Shape;
  while (x < end) {
    const w = snap(Math.min(roll(tuning.sectionMin, tuning.sectionMax), end - x < tuning.sectionMin * 2 ? end - x : Infinity));
    const r = rng();
    // Mostly downhill: the course is a slow descent. Never two climbs in a row.
    const shape: Shape = r < 0.34 ? 'flat' : r < 0.66 ? 'slope' : r < 0.88 || lastShape === 'stepUp' ? 'stepDown' : 'stepUp';
    lastShape = shape;
    const y0 = shape === 'stepDown' ? y + snap(roll(50, 130)) : shape === 'stepUp' ? y - snap(roll(40, 70)) : y;
    const y1 = shape === 'slope' ? y0 + snap(roll(90, 260)) : y0;

    // Per lane: one optional gap and one optional bump, never overlapping, kept off the section ends.
    const holes = new Map<Lane, [number, number]>();
    const blocks = new Map<Lane, [number, number]>();
    for (const lane of LANES) {
      if (w >= 500 && rng() < tuning.gapChance[lane]) {
        const gw = snap(roll(tuning.gapMin, tuning.gapMax));
        const gx = snap(x + roll(160, w - 160 - gw));
        holes.set(lane, [gx, gx + gw]);
      }
      if (w >= 500 && shape !== 'slope' && rng() < tuning.bumpChance[lane]) {
        const bw = snap(roll(70, 160));
        const bx = snap(x + roll(140, w - 140 - bw));
        const hole = holes.get(lane);
        if (!hole || bx + bw < hole[0] - 120 || bx > hole[1] + 120) blocks.set(lane, [bx, bx + bw]);
      }
    }
    const at = (px: number) => y0 + ((px - x) / w) * (y1 - y0);

    for (const lane of LANES) {
      const hole = holes.get(lane);
      if (hole) {
        floors.push({ lane, x0: x, y0: at(x), x1: hole[0], y1: at(hole[0]) });
        floors.push({ lane, x0: hole[1], y0: at(hole[1]), x1: x + w, y1: y1 });
      } else floors.push({ lane, x0: x, y0, x1: x + w, y1 });
      const block = blocks.get(lane);
      if (block) {
        const h = snap(roll(40, 70));
        bumps.push({ lane, x: block[0], w: block[1] - block[0], y: Math.min(at(block[0]), at(block[1])) - h, h });
      }
    }

    // A lane gate between two neighbouring lanes, where both have clear floor.
    if (w >= 600 && rng() < tuning.gateChance) {
      const lane = LANES[Math.floor(rng() * 3)];
      const to = (lane === LANE_MIDDLE ? (rng() < 0.5 ? LANE_BACK : LANE_FRONT) : LANE_MIDDLE) as Lane;
      const kind = rng() < 0.5 ? 'ramp' : 'door';
      for (let tries = 0; tries < 6; tries++) {
        const gx = snap(x + roll(80, w - 80 - tuning.gateW));
        const clear = (l: Lane) => {
          const hole = holes.get(l);
          const block = blocks.get(l);
          const free = (span?: [number, number]) => !span || gx + tuning.gateW < span[0] - 40 || gx > span[1] + 40;
          return free(hole) && free(block);
        };
        if (clear(lane) && clear(to)) {
          gates.push({ kind, lane, to, x: gx, w: tuning.gateW, y: at(gx + tuning.gateW / 2) });
          break;
        }
      }
    }

    path.push({ x, y: y0 - 30 }, { x: x + w, y: y1 - 30 });
    x += w;
    y = y1;
  }

  // Finish: a flat run-out in every lane, then the end wall.
  for (const lane of LANES) floors.push({ lane, x0: x, y0: y, x1: tuning.length + 200, y1: y });
  path.push({ x, y: y - 30 }, { x: tuning.length, y: y - 30 });
  const finishX = x + 360;
  const height = y + 900;

  return { seed, width: tuning.length, height, floors, bumps, gates, path, startX, startY, finishX, finishY: y };
}

/** The floor height under `x` in `lane`, or null over a gap. */
export function floorAt(plan: CoursePlan, lane: Lane, x: number): number | null {
  for (const f of plan.floors) {
    if (f.lane !== lane || x < f.x0 || x > f.x1) continue;
    return f.y0 + ((x - f.x0) / (f.x1 - f.x0)) * (f.y1 - f.y0);
  }
  return null;
}
