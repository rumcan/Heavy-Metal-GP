// P2-00 (#124): the platformer course plan. Pure data, no Matter.js: a course is three lanes of floor
// (top edges as line segments), bumps to jump, gaps to clear, lane gates between lanes, a start and a finish.
// Deterministic from the seed (multiplayer and replays build the same course).
import { mulberry32 } from '../types';
import { LANE_BACK, LANE_FRONT, LANE_MIDDLE } from '../lanes';
import { FLOW_TUNING, planFlow } from './flow';
import { bridgeDeckAt } from './routes';
import type { BridgeSpot, LoopSpot } from './routes';

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
  { id: 'greenhollow', name: 'Greenhollow Run', blurb: 'A long green descent: jump ramps between the lanes, sky runs, vents and gold rings. The back lane is the shortcut if you can clear its gaps.', seed: 7, flow: true },
  { id: 'misty-ridge', name: 'Misty Ridge', blurb: 'Longer and busier: more jump ramps, fire rings, updrafts and geysers, and gold rings to collect.', seed: 23, length: 28000, flow: true },
  { id: 'training', name: 'Training Grounds', blurb: 'The short tutorial course: one crate, one gap, one ramp, one door, a slope and a climb.', seed: 1, tutorial: true },
];

/**
 * The championship calendar as platformer courses (the drop tracks are retired): one per Grand Prix, in calendar
 * order, getting longer through the season. Rolling coaster courses like Rolling Hills, each from its own seed.
 */
export const GP_COURSES: readonly PlatformerCourse[] = [
  { id: 'gp-marblehurst', name: 'Marblehurst Grand Prix', blurb: 'The season opener: gentle fairground hills, a few chasms and crates, room to learn your lines.', seed: 101, flow: true, length: 22000 },
  { id: 'gp-monte-pipo', name: 'Monte Pipo Street Circuit', blurb: 'Harbour switchbacks: short sharp drops, lane gates every few hundred metres, crates on the inside line.', seed: 211, flow: true, length: 24000 },
  { id: 'gp-silverpeg', name: 'Silverpeg Grand Prix', blurb: 'Fast rolling crests over silver chasms: carry speed and fly the gaps.', seed: 307, flow: true, length: 25000 },
  { id: 'gp-spa', name: 'Spa-Francoroll', blurb: 'A long forest descent: loops, rope bridges and the fastest downhill of the year.', seed: 419, flow: true, length: 27000 },
  { id: 'gp-suzuka', name: 'Suzuka Spiral', blurb: 'Canyon country: deep chasms, busy gates and crates in every lane.', seed: 523, flow: true, length: 28000 },
  { id: 'gp-yas', name: 'Yas Marble Finale', blurb: 'The longest course of the season: everything at once, all the way to the flag.', seed: 631, flow: true, length: 32000 },
];

/** Courses built in the Workshop, registered for the session under a key (`my-...`). A race looks them up like the official ones. */
const CUSTOM_COURSES = new Map<string, { course: PlatformerCourse; plan: CoursePlan }>();

/** Registers a Workshop course's plan and returns the quick-race pick id for it (`platformer:my-...`). */
export function registerCustomCourse(key: string, name: string, plan: CoursePlan): string {
  CUSTOM_COURSES.set(key, { course: { id: key, name, blurb: 'A course built in the Workshop.', seed: plan.seed }, plan });
  return PLATFORMER_PREFIX + key;
}

export function platformerCourse(id: string | null | undefined): PlatformerCourse {
  const key = id && id.startsWith(PLATFORMER_PREFIX) ? id.slice(PLATFORMER_PREFIX.length) : id;
  return CUSTOM_COURSES.get(key ?? '')?.course ?? PLATFORMER_COURSES.find((c) => c.id === key) ?? GP_COURSES.find((c) => c.id === key) ?? PLATFORMER_COURSES[0];
}

/** The plan for an official course. */
export function planOfficial(course: PlatformerCourse): CoursePlan {
  const custom = CUSTOM_COURSES.get(course.id);
  if (custom) return custom.plan;
  if (course.tutorial) return planTutorial();
  if (course.flow) return planFlow(course.seed, course.length ? { ...FLOW_TUNING, length: course.length } : FLOW_TUNING);
  // block courses are drawn in the painted coaster style like every other course (as 'blocks' they used the old pixel tiles)
  return { ...planCourse(course.seed, course.length ? { ...COURSE_TUNING, length: course.length } : COURSE_TUNING), style: 'flow' };
}

/** One stretch of floor: its top edge runs from (x0, y0) to (x1, y1). */
/** `hidden`: ground a classic Workshop piece (an ice rail) provides: drivers and the planner sense it, but it is built and drawn by that piece. */
export interface Floor { lane: Lane; x0: number; y0: number; x1: number; y1: number; hidden?: boolean }
/** A raised block on a floor: jump it (its top is `y`, it sits on the floor below). */
export interface Bump { lane: Lane; x: number; w: number; y: number; h: number; /** a classic block builds and draws it */ hidden?: boolean }
/**
 * A way between two lanes, `x`..`x + w` along the course.
 * - `ramp`: rolling through it on the ground takes you to `to` (jump over it to stay).
 * - `door`: press jump inside it to go through to `to`.
 */
/**
 * A ramp gate is a jump ramp: a wedge in its lane rising GATE_RAMP_H to a lip at the gate's end. Roll up it and the
 * lip throws you into the air, across onto the lane it leads to (engine/platformer.ts laneGates).
 */
export const GATE_RAMP_H = 56;
export interface LaneGate { kind: 'ramp' | 'door'; lane: Lane; to: Lane; x: number; w: number; y: number }
/** A spring pad on the floor (`x`..`x + SPRING_W`, top at `y`): rolling or landing on it launches you up. */
export interface Spring { lane: Lane; x: number; y: number }
/** A one-way ledge: jump up through it from below, land and roll on top (`y` is its top). */
/** `cloud` (an index into the cloud art) makes the ledge a cloud platform in the sky: the same one-way physics, drawn as a cloud. */
export interface Ledge { lane: Lane; x: number; w: number; y: number; cloud?: number }
/** A kicker: a short wooden ramp on the floor (`x`..`x + w`, rising `h` at its lip) that throws a fast ball into the air. */
export interface Kicker { lane: Lane; x: number; w: number; h: number }
export const SPRING_W = 60;
/** A power-up box hovering over the track (centre `x`, `y`): roll through it for an item (respawns, see the engine). */
export interface ItemBoxSpot { lane: Lane; x: number; y: number }
/** A wrecking ball swinging on a chain from a gantry over the track. */
export interface WreckerSpot { lane: Lane; x: number; pivotY: number; chain: number; amp: number; speed: number; phase: number }
/** A boost pad on the track (`x`..`x + w`): rolling over it pushes you along the slope. */
export interface BoostSpot { lane: Lane; x: number; w: number }

/** A gold ring to collect (Infinity): pays RING_CREDITS once; `id` is stable for the run. */
export interface RingSpot { id: string; lane: Lane; x: number; y: number }
/** Credits a ring pays (an orange peg pays the same). */
export const RING_CREDITS = 5;
/** A fire ring (Infinity): roll or fly through its hole (centre x, y; hole radius r) for a burst of speed. */
export interface HoopSpot { id: string; lane: Lane; x: number; y: number; r: number; air: boolean }
/** A smash crate (Infinity): no resistance, it bursts when a ball rolls through (centre x, standing on y). */
export interface SmashSpot { id: string; lane: Lane; x: number; y: number }
/** A vent on the track (Infinity): an updraft that carries a ball up, or a geyser that erupts now and then. */
export interface VentSpot { id: string; lane: Lane; kind: 'updraft' | 'geyser'; x: number; y: number; w: number; h: number }
/** A smash crate breaking: where, when (game time) and how fast the ball was going. */
export interface SmashBreak { id: string; lane: Lane; x: number; y: number; at: number; vx: number }
/**
 * A goblin stand's spot (Infinity): the level stretch of the back lane after km `id` (absolute), its track height `y`.
 * Every chunk that overlaps it carries it, so a stand never depends on which chunks are built or where the origin is.
 */
export interface StandSpot { id: number; lane: Lane; x: number; w: number; y: number }
export interface CoursePlan {
  /**
   * Infinity: where this plan's local origin is in the endless land (the world is shifted back every 40 km; local x +
   * originX is the absolute x). Scenery hashes and textures use absolute positions, so nothing changes at a shift.
   * Absent (0) on race courses.
   */
  originX?: number;
  originY?: number;
  /** Infinity: fire rings, smash crates (and the ones breaking right now), updraft and geyser vents. */
  hoops?: HoopSpot[];
  smashes?: SmashSpot[];
  smashFx?: SmashBreak[];
  vents?: VentSpot[];
  /** Infinity: the goblin stands' spots (else coaster.ts finds flat stretches itself). */
  stands?: StandSpot[];
  /** Gold rings to collect (Infinity only). */
  rings?: RingSpot[];
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
  /** The classic map pieces on a platformer course (absent = none). */
  itemBoxes?: ItemBoxSpot[];
  wreckers?: WreckerSpot[];
  boosts?: BoostSpot[];
  ledges?: Ledge[];
  /** P2-21: loops (a ring a fast ball rides over) and rope bridges over chasms (absent = none). */
  loops?: LoopSpot[];
  bridges?: BridgeSpot[];
  /** Kicker ramps (absent = none). */
  kickers?: Kicker[];
  /**
   * P2-26: every other Workshop piece (spinners, saws, cannons, flippers, pegs, fields, set pieces...), built by the
   * classic Builder exactly as on a drop track and placed in its lane's collision layer (absent = none).
   */
  extras?: { lane: Lane; piece: import('../trackdef').Piece; /** Index in the def's pieces (the Workshop's selection box). */ source?: number }[];
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
      // the owner: every lane change is a jump ramp (doors are only placed by hand, in the Workshop or the tutorial)
      rng(); // the roll stays, so the rest of the course is unchanged
      const kind = 'ramp' as const;
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
  // A rope bridge is floor over its chasm (the drivers see it as floor and roll across).
  for (const b of plan.bridges ?? []) if (b.lane === lane) { const deck = bridgeDeckAt(b, x); if (deck !== null) return deck; }
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
  // P2-13 lesson 5, the shortcut: a one-way ledge over the long slope. Jump up onto it from the
  // flat before the slope and it carries you past the slope AND the 50 px climb; the low road
  // down and back up is clearly the long way round.
  const ledges: Ledge[] = L.map((lane) => ({ lane, x: 4120, w: 900, y: y + 30 }));
  const path = [
    { x: 0, y: y - 30 }, { x: 2400, y: y - 30 }, { x: 2400, y: y + 60 }, { x: 4100, y: y + 60 },
    { x: 4900, y: y + 300 }, { x: 4900, y: y + 250 }, { x: 6600, y: y + 250 },
  ];
  // Drawn in the painted coaster style like every other course (as 'blocks' it fell back to the old pixel tiles).
  return { seed: 0, style: 'flow', width: 6600, height: y + 280 + 900, floors, bumps, gates, ledges, path, startX: 520, startY: y, finishX: 5900, finishY: y + 280 };
}
