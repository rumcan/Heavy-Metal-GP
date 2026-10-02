// P2-00 (#124): the platformer course plan. Pure data, no Matter.js: a course is three lanes of floor
// (top edges as line segments), bumps to jump, gaps to clear, lane gates between lanes, a start and a finish.
// Deterministic from the seed (multiplayer and replays build the same course).
import { mulberry32 } from '../types';
import { LANE_BACK, LANE_FRONT, LANE_MIDDLE } from '../lanes';
import { planFlow } from './flow';

export type Lane = 0 | 1 | 2;

/** Quick race picks a platformer course with an id like `platformer:greenhollow` (it stands in for a My tracks id). */
export const PLATFORMER_PREFIX = 'platformer:';
/** The default pick (the first official course). */
export const PLATFORMER_TRACK_ID = 'platformer:rolling-hills';
export const isPlatformerPick = (id: string | null | undefined): id is string => !!id && id.startsWith(PLATFORMER_PREFIX);

export interface PlatformerCourse {
  id: string;
  name: string;
  blurb: string;
  /** Planned from this seed with `length`; the tutorial is hand-built instead. */
  seed: number;
  length?: number;
  tutorial?: boolean;
  /** Rolling slopes (src/game/platformer/flow.ts) instead of blocks. */
  flow?: boolean;
}

/** The official platformer courses (owner playtest first, then the other calendar slots convert). */
export const PLATFORMER_COURSES: readonly PlatformerCourse[] = [
  { id: 'rolling-hills', name: 'Rolling Hills', blurb: 'Long rolling slopes: build speed on the descents, fly off the crests, jump the chasms and hop the crates. The ridges behind you are the other lanes.', seed: 11, flow: true },
  { id: 'greenhollow', name: 'Greenhollow Run', blurb: 'A long green descent with ten lane gates. The back lane is the shortcut if you can clear its gaps.', seed: 7 },
  { id: 'misty-ridge', name: 'Misty Ridge', blurb: 'Longer and busier: thirteen gates, more doors, and crates in every lane.', seed: 23, length: 28000 },
  { id: 'training', name: 'Training Grounds', blurb: 'The short tutorial course: one crate, one gap, one ramp, one door, a slope and a climb.', seed: 1, tutorial: true },
];

export function platformerCourse(id: string | null | undefined): PlatformerCourse {
  const key = id && id.startsWith(PLATFORMER_PREFIX) ? id.slice(PLATFORMER_PREFIX.length) : id;
  return PLATFORMER_COURSES.find((c) => c.id === key) ?? PLATFORMER_COURSES[0];
}

/** The plan for an official course. */
export function planOfficial(course: PlatformerCourse): CoursePlan {
  if (course.tutorial) return planTutorial();
  if (course.flow) return planFlow(course.seed);
  return planCourse(course.seed, course.length ? { ...COURSE_TUNING, length: course.length } : COURSE_TUNING);
}

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
/** A spring pad on the floor (`x`..`x + SPRING_W`, top at `y`): rolling or landing on it launches you up. */
export interface Spring { lane: Lane; x: number; y: number }
/** A one-way ledge: jump up through it from below, land and roll on top (`y` is its top). */
export interface Ledge { lane: Lane; x: number; w: number; y: number }
export const SPRING_W = 60;

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
  /** Spring pads and one-way ledges (absent = none). */
  springs?: Spring[];
  ledges?: Ledge[];
  /** P2-00: 'flow' = rolling slopes (src/game/platformer/flow.ts); absent = the block style. */
  style?: 'blocks' | 'flow';
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

/** Per-plan index: each lane's floors sorted by x (flow courses have thousands of short pieces). */
const floorIndex = new WeakMap<CoursePlan, Floor[][]>();

/** The floor height under `x` in `lane`, or null over a gap. */
export function floorAt(plan: CoursePlan, lane: Lane, x: number): number | null {
  let index = floorIndex.get(plan);
  if (!index) {
    index = [0, 1, 2].map((l) => plan.floors.filter((f) => f.lane === l).sort((a, b) => a.x0 - b.x0));
    floorIndex.set(plan, index);
  }
  const list = index[lane];
  // The last floor starting at or before x.
  let lo = 0, hi = list.length - 1, at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].x0 <= x) { at = mid; lo = mid + 1; } else hi = mid - 1;
  }
  for (let i = at; i >= 0 && i >= at - 1; i--) {
    const f = list[i];
    if (x >= f.x0 && x <= f.x1) return f.y0 + ((x - f.x0) / (f.x1 - f.x0)) * (f.y1 - f.y0);
  }
  return null;
}

/**
 * Training Grounds (P2-13's course): short and hand-built, one of each thing in the order you learn it.
 * Every lane has the same floor, so the only lane choices are the ramp and the door.
 */
export function planTutorial(): CoursePlan {
  const L: Lane[] = [0, 1, 2];
  const floors: Floor[] = [];
  const add = (x0: number, y0: number, x1: number, y1: number) => { for (const lane of L) floors.push({ lane, x0, y0, x1, y1 }); };
  const y = 600;
  add(-200, y, 1900, y);                // start, then a crate to jump at 1300
  add(2040, y, 2400, y);                // a gap (1900..2040) to jump
  add(2400, y + 90, 3500, y + 90);      // step down; the ramp to the back lane sits on this stretch
  add(3500, y + 90, 4100, y + 90);      // the door back to the middle lane
  add(4100, y + 90, 4900, y + 330);     // a long slope down
  add(4900, y + 280, 5500, y + 280);    // a short climb (50 px) to jump up
  add(5500, y + 280, 6800, y + 280);    // run-out to the finish
  const bumps: Bump[] = L.map((lane) => ({ lane, x: 1300, w: 60, y: y - 56, h: 56 }));
  const gates: LaneGate[] = [
    { kind: 'ramp', lane: 1, to: 0, x: 2900, w: 170, y: y + 90 },
    { kind: 'door', lane: 0, to: 1, x: 3700, w: 170, y: y + 90 },
  ];
  const path = [
    { x: 0, y: y - 30 }, { x: 2400, y: y - 30 }, { x: 2400, y: y + 60 }, { x: 4100, y: y + 60 },
    { x: 4900, y: y + 300 }, { x: 4900, y: y + 250 }, { x: 6600, y: y + 250 },
  ];
  return { seed: 0, width: 6600, height: y + 280 + 900, floors, bumps, gates, path, startX: 520, startY: y, finishX: 5900, finishY: y + 280 };
}
