// P2-22: a platformer course made in the Workshop is an ordinary TrackDef (`mode: 'platformer'`), so My tracks, drafts,
// undo, groups, templates, share codes and publishing all work on it. This module turns such a def into the CoursePlan
// the race already knows how to build and drive, and keeps the pieces sitting on their floors.
//
// What a piece means on a platformer course (each has a `lane`: 0 back, 1 middle (absent), 2 front):
//   ramp / ice / curve  a floor (a curve is cut into 12 straight slabs)       pad      a spring
//   boost               a boost strip (x is its middle, len its width)        itembox  a power-up box
//   wrecker             a wrecking ball on a chain                            block    a crate to jump
//   bridge              a rope bridge over a chasm                            loop     a loop (x = where the ride starts)
//   gate                a lane gate (ramp or door)                            ledge    a one-way ledge
// The start platform and the finish run-out are not pieces: they are added here, like the classic editor adds its
// start and finish stubs, so the builder only works on the middle of the course.
import type { Piece, TrackDef } from '../trackdef';
import { SPRING_W } from './course';
import type { BoostSpot, Bump, CoursePlan, Floor, ItemBoxSpot, Kicker, Lane, LaneGate, Ledge, Spring, WreckerSpot } from './course';
import { LOOP_R, PLANK_H } from './routes';
import type { BridgeSpot, LoopSpot } from './routes';
import { lanesOf } from '../lanes';
import { curvePoints, ridePoints, trackPlanOf } from './crossings';
export { curvePoints } from './crossings';

/** The y of the flat start platform. A platformer def is built downwards from here, with room above it to climb. */
export const PF_START_Y = 800;
/** Where the start platform ends (all three lanes are flat up to here). */
export const PF_START_END = 900;
/** The finish line stands this far from the right end of the course. */
export const PF_FINISH_FROM_END = 500;
/** The run-out floor under the finish starts this far before the line. */
const RUN_OUT_BEFORE = 300;
/** A new course's length, and the Length buttons' step. */
export const PF_DEFAULT_WIDTH = 12000;
export const PF_WIDTH_STEP = 2000;

const LANES: readonly Lane[] = [0, 1, 2];
const laneOf = (p: Piece): Lane => (p.lane ?? 1) as Lane;

/** A fresh, empty platformer course: just the start platform and the finish. */
export function newPlatformerDef(name: string, width = PF_DEFAULT_WIDTH, theme: TrackDef['theme'] = 'classic'): TrackDef {
  return { v: 1, name, theme, height: PF_START_Y + 900, mode: 'platformer', width, pieces: [] };
}

export const isPlatformerDef = (def: Pick<TrackDef, 'mode'> | null | undefined): boolean => def?.mode === 'platformer';

/** A quadratic Bézier cut into straight floor slabs. */
function curveFloors(lane: Lane, a: [number, number], c: [number, number], b: [number, number], n: number): Floor[] {
  const pts = curvePoints(a, c, b, n);
  const out: Floor[] = [];
  for (let i = 1; i < pts.length; i++) out.push(...slab(lane, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y).map((f) => ({ ...f, noBeam: true })));
  return out;
}

/** One floor from (ax, ay) to (bx, by), left to right; a vertical one is no floor at all. */
function slab(lane: Lane, ax: number, ay: number, bx: number, by: number): Floor[] {
  if (Math.abs(bx - ax) < 1) return [];
  return ax < bx ? [{ lane, x0: ax, y0: ay, x1: bx, y1: by }] : [{ lane, x0: bx, y0: by, x1: ax, y1: ay }];
}

/** The floors the def's own pieces make (not the start platform or the run-out). */
export function pieceFloors(def: TrackDef): Floor[] {
  const tp = trackPlanOf(def, lanesOf(def.lanes));
  const out: Floor[] = [];
  def.pieces.forEach((p, i) => {
    if (p.t !== 'ramp' && p.t !== 'ice' && p.t !== 'curve') return;
    if (p.t !== 'ice' && tp.rails.has(i)) {
      // A rail: only its stretches that run to the right like ground are floor (for springs, the drivers, the safety
      // net). They are hidden: the rail's own line builds its body and its beam paints it.
      const r = ridePoints(p)!;
      for (let k = 1; k < r.pts.length; k++) {
        const a = r.pts[k - 1], b = r.pts[k];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len > 0.5 && (b.x - a.x) / len >= 0.5) out.push({ lane: laneOf(p), x0: a.x, y0: a.y, x1: b.x, y1: b.y, hidden: true, noCliff: true });
      }
      return;
    }
    const float = (floors: Floor[]) => ((p.t === 'ramp' || p.t === 'curve') && p.cliff === false ? floors.map((f) => ({ ...f, noCliff: true })) : floors);
    // A floor in a crossing: drawn and measured as before, but its body is built from its line and it never has a cliff.
    const crossing = (floors: Floor[]) => (p.t !== 'ice' && tp.crossing.has(i) ? floors.map((f) => ({ ...f, noBody: true, noBeam: true, noCliff: true })) : floors);
    if (p.t === 'ramp' || p.t === 'ice') out.push(...crossing(float(slab(laneOf(p), p.a[0], p.a[1], p.b[0], p.b[1]))));
    else out.push(...crossing(float(curveFloors(laneOf(p), p.a, p.c, p.b, p.n ?? 12))));
  });
  return out;
}

/** The y of a lane's floor at x among `floors`, or null where there is none (a gap). The highest surface wins. */
export function floorYAt(floors: readonly Floor[], lane: Lane, x: number): number | null {
  let best: number | null = null;
  for (const f of floors) {
    if (f.lane !== lane || x < f.x0 || x > f.x1) continue;
    const y = f.y0 + ((x - f.x0) / (f.x1 - f.x0)) * (f.y1 - f.y0);
    if (best === null || y < best) best = y;
  }
  return best;
}

/**
 * The floor at x nearest to height y (where tracks cross, a spring or crate stays on the track it was put on), or
 * null over a gap. Ties go to the higher surface, so where floors do not overlap it is exactly floorYAt.
 */
export function floorYNear(floors: readonly Floor[], lane: Lane, x: number, y: number): number | null {
  let best: number | null = null;
  for (const f of floors) {
    if (f.lane !== lane || x < f.x0 || x > f.x1) continue;
    const fy = f.y0 + ((x - f.x0) / (f.x1 - f.x0)) * (f.y1 - f.y0);
    if (best === null) { best = fy; continue; }
    const d = Math.abs(fy - y), bd = Math.abs(best - y);
    if (d < bd - 0.5 || (Math.abs(d - bd) <= 0.5 && fy < best)) best = fy;
  }
  return best;
}

/** The finish line's x for a course of this width. */
export const finishXOf = (width: number): number => width - PF_FINISH_FROM_END;

/** The fixed floors: the flat start platform and the run-out under the finish, on every lane. */
function fixedFloors(def: TrackDef, own: readonly Floor[]): Floor[] {
  const width = def.width ?? PF_DEFAULT_WIDTH;
  const runX = finishXOf(width) - RUN_OUT_BEFORE;
  const runY = floorYAt(own, 1, runX) ?? PF_START_Y;
  const out: Floor[] = [];
  for (const lane of lanesOf(def.lanes) as Lane[]) {
    out.push({ lane, x0: -200, y0: PF_START_Y, x1: PF_START_END, y1: PF_START_Y });
    out.push({ lane, x0: runX, y0: runY, x1: width, y1: runY });
  }
  return out;
}

/**
 * Keeps floor-bound pieces (springs, crates, gates) standing on the floor of their lane. Floating things (item boxes,
 * wreckers, bridges, ledges, loops and boosts) are left where the builder put them. Returns the same def object if
 * nothing moved, so it costs nothing on every edit.
 */
export function settle(def: TrackDef): TrackDef {
  if (!isPlatformerDef(def)) return def;
  const floors = [...pieceFloors(def), ...fixedFloors(def, pieceFloors(def))];
  let changed = false;
  const pieces = def.pieces.map((p): Piece => {
    const lane = laneOf(p);
    const snap = (x: number, y: number): number => floorYNear(floors, lane, x, y) ?? y;
    if (p.t === 'pad') { const y = snap(p.x, p.y); if (y !== p.y) { changed = true; return { ...p, y }; } }
    else if (p.t === 'gate') { const y = snap(p.x + p.w / 2, p.y); if (y !== p.y) { changed = true; return { ...p, y }; } }
    else if (p.t === 'block') {
      const y = snap(p.x, p.y + p.h / 2) - p.h / 2;
      if (Math.abs(y - p.y) > 0.5) { changed = true; return { ...p, y }; }
    }
    return p;
  });
  return changed ? { ...def, pieces } : def;
}

/** The CoursePlan a platformer def describes: what the race builds, the AI reads and the editor draws. */
export function planFromTrackDef(def: TrackDef): CoursePlan {
  const width = def.width ?? PF_DEFAULT_WIDTH;
  const active = lanesOf(def.lanes);
  const own = pieceFloors(def).filter((f) => active.includes(f.lane)); // only the lanes this course has
  const floors: Floor[] = [...fixedFloors(def, own), ...own];
  const bumps: Bump[] = [], gates: LaneGate[] = [], ledges: Ledge[] = [], springs: Spring[] = [];
  const itemBoxes: ItemBoxSpot[] = [], wreckers: WreckerSpot[] = [], boosts: BoostSpot[] = [];
  const loops: LoopSpot[] = [], bridges: BridgeSpot[] = [];
  const kickers: Kicker[] = [];
  const extras: NonNullable<CoursePlan['extras']> = [];
  // Each Workshop curve's beam, painted whole along its shape (coaster.ts); a rail's or a crossing piece's beam follows
  // its track line (in ride order, on its solid side). Beams are drawn in piece order: a later piece is in front.
  const tp = trackPlanOf(def, active);
  const lineOf = new Map(tp.tracks.map((l) => [l.source, l]));
  const beams: NonNullable<CoursePlan['beams']> = [];
  def.pieces.forEach((p, source) => {
    if ((p.t !== 'curve' && p.t !== 'ramp') || !active.includes(laneOf(p))) return;
    const line = lineOf.get(source);
    if (line) beams.push({ lane: line.lane, pts: line.pts, oriented: line.rail, source });
    else if (p.t === 'curve') beams.push({ lane: laneOf(p), pts: curvePoints(p.a, p.c, p.b, p.n ?? 12), source });
  });
  def.pieces.forEach((p, source) => {
    const lane = laneOf(p);
    if (!active.includes(lane)) return; // a lane the course does not have
    switch (p.t) {
      // Floors and the two lane pieces are the platformer's own. Every other piece is the drop-track piece itself, built
      // by the classic Builder with its own art and behaviour (P2-26), exactly as on a pinball-style track. The drivers
      // still need to know about some of them, so those leave a hidden note in the plan (sensed, never built or drawn).
      case 'ramp': case 'curve': break; // floors (pieceFloors)
      case 'gate': gates.push({ kind: p.kind, lane, to: p.to, x: p.x, w: p.w, y: p.y }); break;
      case 'ledge': ledges.push({ lane, x: p.x, w: p.w, y: p.y, ...(p.cloud !== undefined ? { cloud: p.cloud } : {}) }); break;
      case 'kicker': kickers.push({ lane, x: p.x, w: p.w, h: p.h }); break;
      case 'ice':
        floors.push(...slab(lane, p.a[0], p.a[1], p.b[0], p.b[1]).map((f) => ({ ...f, hidden: true })));
        extras.push({ lane, piece: p, source });
        break;
      case 'block':
        bumps.push({ lane, x: p.x - p.w / 2, w: p.w, y: p.y - p.h / 2, h: p.h, hidden: true });
        extras.push({ lane, piece: p, source });
        break;
      case 'bridge': {
        const [ax, ay] = p.a[0] <= p.b[0] ? p.a : p.b, [bx, by] = p.a[0] <= p.b[0] ? p.b : p.a;
        bridges.push({ lane, x0: ax, y0: ay + PLANK_H / 2, x1: bx, y1: by + PLANK_H / 2, planks: p.planks, slack: p.slack, hidden: true });
        extras.push({ lane, piece: p, source });
        break;
      }
      default: extras.push({ lane, piece: p, source }); break; // the classic piece
    }
  });
  // The race line (progress is measured along it): above the middle lane's floor, holding its last height over gaps.
  const path: { x: number; y: number }[] = [];
  let lastY = PF_START_Y;
  for (let x = 0; x <= width; x += 200) {
    lastY = floorYAt(floors, 1, x) ?? lastY;
    path.push({ x, y: lastY - 30 });
  }
  const finishX = finishXOf(width);
  const finishY = floorYAt(floors, 1, finishX) ?? lastY;
  let maxY = PF_START_Y;
  for (const f of floors) maxY = Math.max(maxY, f.y0, f.y1);
  const height = Math.max(def.height, maxY + 900);
  return {
    seed: def.seed ?? 0, style: 'flow', width, height, floors, bumps, gates, path, ...(extras.length ? { extras } : {}),
    ...(beams.length ? { beams } : {}),
    ...(tp.tracks.length ? { tracks: tp.tracks } : {}),
    ...(tp.crossings.length ? { crossings: tp.crossings } : {}),
    ...(def.lanes ? { lanes: active } : {}),
    startX: 520, startY: PF_START_Y, finishX, finishY,
    springs, ledges, itemBoxes, wreckers, boosts, loops, bridges, ...(kickers.length ? { kickers } : {}),
  };
}

/** One thing wrong with a course, in plain words, and where to look. */
export interface PlatformerIssue { message: string; x: number; y: number; piece?: number }

/** Problems that stop a course being raced (empty = fine). The headless AI race is the other half of validation. */
export function platformerIssues(def: TrackDef): PlatformerIssue[] {
  const out: PlatformerIssue[] = [];
  const width = def.width ?? PF_DEFAULT_WIDTH;
  const floors = [...pieceFloors(def), ...fixedFloors(def, pieceFloors(def))];
  const finishX = finishXOf(width);
  const at = (x: number) => Math.round(x);
  for (const [i, p] of def.pieces.entries()) {
    const lane = laneOf(p);
    const name = `${p.t} #${i + 1}`;
    const here = (() => {
      switch (p.t) {
        case 'ramp': case 'ice': return { x: p.a[0], y: p.a[1] };
        case 'curve': return { x: p.a[0], y: p.a[1] };
        case 'bridge': return { x: p.a[0], y: p.a[1] };
        case 'wrecker': return { x: p.pivot[0], y: p.pivot[1] };
        case 'loop': return { x: p.x, y: p.bottom };
        default: return { x: 'x' in p ? (p as { x: number }).x : 0, y: 'y' in p ? (p as { y: number }).y : PF_START_Y };
      }
    })();
    const add = (message: string) => out.push({ message, x: here.x, y: here.y, piece: i });
    const active = lanesOf(def.lanes);
    const LANE_WORD = ['back', 'main', 'front'];
    if (!active.includes(lane)) add(`${name} is in the ${LANE_WORD[lane]} lane, which this course does not have: add the lane or move it.`);
    if (p.t === 'gate' && !active.includes(p.to)) add(`${name} at x ${at(p.x)} leads to the ${LANE_WORD[p.to]} lane, which this course does not have.`);
    if (p.t === 'gate') {
      if (p.to === lane) add(`${name} at x ${at(p.x)} leads to its own lane (back, middle or front): pick another lane to go to.`);
      if (floorYAt(floors, lane, p.x + p.w / 2) === null) add(`${name} at x ${at(p.x)} has no floor under it in its lane.`);
      if (floorYAt(floors, p.to, p.x + p.w / 2) === null) add(`${name} at x ${at(p.x)} sends you to a lane with no floor there.`);
    }
    if (p.t === 'pad' && floorYAt(floors, lane, p.x) === null) add(`${name} at x ${at(p.x)} floats: there is no floor under it in its lane.`);
    if (p.t === 'block' && floorYAt(floors, lane, p.x) === null) add(`${name} at x ${at(p.x)} floats: there is no floor under it in its lane.`);
    if (p.t === 'loop' && floorYAt(floors, lane, p.x) === null) add(`${name} at x ${at(p.x)} has no floor to start the ride on.`);
    const xs = (() => {
      switch (p.t) {
        case 'ramp': case 'ice': return [p.a[0], p.b[0]];
        case 'curve': return [p.a[0], p.c[0], p.b[0]];
        case 'bridge': return [p.a[0], p.b[0]];
        case 'wrecker': return [p.pivot[0]];
        case 'gate': case 'ledge': return [p.x, p.x + p.w];
        default: return 'x' in p ? [(p as { x: number }).x] : [];
      }
    })();
    if (xs.some((x) => x > finishX + 400)) add(`${name} stands beyond the finish line (x ${at(finishX)}): move it back or make the course longer.`);
  }
  // A floor under the middle lane from the start to the finish, except where a bridge or a jump crosses a gap.
  let gap = 0;
  for (let x = PF_START_END; x < finishX; x += 50) {
    const bridged = (def.pieces as Piece[]).some((p) => p.t === 'bridge' && laneOf(p) === 1 && x >= Math.min(p.a[0], p.b[0]) && x <= Math.max(p.a[0], p.b[0]));
    if (floorYAt(floors, 1, x) === null && !bridged) {
      gap += 50;
      if (gap > 300) { out.push({ message: `The middle lane has a gap near x ${Math.round(x)} that is too wide to jump (over 300): add a floor, a bridge or another route.`, x, y: PF_START_Y }); break; }
    } else gap = 0;
  }
  return out;
}

/** The same problems as plain sentences. */
export const platformerProblems = (def: TrackDef): string[] => platformerIssues(def).map((i) => i.message);

/**
 * A copy of a course plan as a platformer def, to start the Workshop from an official course. Each lane's floors are
 * joined into curves of up to 8 slabs (so a course is a few hundred pieces to edit, not a few thousand); the springs,
 * crates, gates, ledges, boxes, wreckers, boosts, loops and bridges become the matching pieces. The result is close to
 * the original, not identical: a curve passes through its middle slab's start.
 */
export function defFromPlan(plan: CoursePlan, name: string, theme: TrackDef['theme'] = 'classic'): TrackDef {
  const dy = PF_START_Y - plan.startY;
  const r = Math.round;
  const lanePart = (lane: Lane): { lane?: Lane } => (lane === 1 ? {} : { lane });
  const pieces: Piece[] = [];
  const runX = plan.finishX - RUN_OUT_BEFORE;
  for (const lane of LANES) {
    const floors = plan.floors.filter((f) => f.lane === lane && f.x1 > PF_START_END && f.x0 < runX).sort((a, b) => a.x0 - b.x0)
      .map((f) => {
        // Clip to the part the builder owns: after the start platform and before the run-out.
        const at = (x: number) => f.y0 + ((x - f.x0) / (f.x1 - f.x0)) * (f.y1 - f.y0);
        const x0 = Math.max(f.x0, PF_START_END), x1 = Math.min(f.x1, runX);
        return { x0, y0: at(x0) + dy, x1, y1: at(x1) + dy };
      });
    let run: typeof floors = [];
    const flush = () => {
      for (let i = 0; i < run.length; i += 8) {
        const part = run.slice(i, i + 8);
        const a = part[0], b = part[part.length - 1];
        const A: [number, number] = [r(a.x0), r(a.y0)], B: [number, number] = [r(b.x1), r(b.y1)];
        if (part.length === 1) { pieces.push({ t: 'ramp', a: A, b: B, ...lanePart(lane) }); continue; }
        const mid = part[Math.floor(part.length / 2)];
        const C: [number, number] = [r(2 * mid.x0 - (A[0] + B[0]) / 2), r(2 * mid.y0 - (A[1] + B[1]) / 2)];
        pieces.push({ t: 'curve', a: A, c: C, b: B, n: Math.min(12, Math.max(2, part.length)), ...lanePart(lane) });
      }
      run = [];
    };
    for (const f of floors) {
      if (run.length && Math.abs(f.x0 - run[run.length - 1].x1) > 1) flush();
      run.push(f);
    }
    flush();
  }
  for (const s of plan.springs ?? []) pieces.push({ t: 'pad', x: r(s.x + SPRING_W / 2), y: r(s.y + dy), w: SPRING_W, dir: 1, ...lanePart(s.lane) });
  for (const b of plan.bumps) pieces.push({ t: 'block', x: r(b.x + b.w / 2), y: r(b.y + b.h / 2 + dy), w: r(b.w), h: r(b.h), ...lanePart(b.lane) });
  for (const g of plan.gates) pieces.push({ t: 'gate', kind: g.kind, to: g.to, x: r(g.x), y: r(g.y + dy), w: r(g.w), ...lanePart(g.lane) });
  for (const l of plan.ledges ?? []) pieces.push({ t: 'ledge', x: r(l.x), y: r(l.y + dy), w: r(l.w), ...(l.cloud !== undefined ? { cloud: l.cloud } : {}), ...lanePart(l.lane) });
  for (const k of plan.kickers ?? []) pieces.push({ t: 'kicker', x: r(k.x), y: r((floorYAt(plan.floors, k.lane, k.x) ?? plan.startY) + dy), w: r(k.w), h: r(k.h), ...lanePart(k.lane) });
  for (const b of plan.itemBoxes ?? []) pieces.push({ t: 'itembox', x: r(b.x), y: r(b.y + dy), ...lanePart(b.lane) });
  for (const w of plan.wreckers ?? []) pieces.push({ t: 'wrecker', pivot: [r(w.x), r(w.pivotY + dy)], chain: r(w.chain), amp: Math.round(w.amp * 100) / 100, speed: Math.round(w.speed * 10000) / 10000, phase: Math.round(w.phase * 100) / 100, ...lanePart(w.lane) });
  for (const b of plan.boosts ?? []) {
    const y = floorYAt(plan.floors, b.lane, b.x + b.w / 2);
    pieces.push({ t: 'boost', x: r(b.x + b.w / 2), y: r((y ?? plan.startY) + dy), len: r(b.w), thick: 20, dir: [1, 0], ...lanePart(b.lane) });
  }
  for (const l of plan.loops ?? []) pieces.push({ t: 'loop', x: r(l.x), bottom: r(l.y + dy), r: LOOP_R, ...lanePart(l.lane) });
  for (const b of plan.bridges ?? []) pieces.push({ t: 'bridge', a: [r(b.x0), r(b.y0 - PLANK_H / 2 + dy)], b: [r(b.x1), r(b.y1 - PLANK_H / 2 + dy)], planks: b.planks, slack: b.slack, ...lanePart(b.lane) });
  const width = r(plan.finishX + PF_FINISH_FROM_END);
  let maxY = PF_START_Y;
  for (const p of pieces) { const ys = 'a' in p ? [p.a[1], p.b[1]] : 'y' in p ? [(p as { y: number }).y] : []; for (const y of ys) maxY = Math.max(maxY, y); }
  return { v: 1, name, theme, height: Math.max(PF_START_Y + 900, maxY + 900), mode: 'platformer', width, pieces };
}
