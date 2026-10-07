// P2-00 (#124): turn a course plan into a Track the engine races on. Physics stays plain vector shapes:
// every floor and bump is a static quad in its own depth lane (collision mask = that lane's bit only).
import Matter from 'matter-js';
import { Builder, CAT_MARBLE, CAT_SENSOR, CAT_WALL } from '../track';
import type { Track, TargetBank } from '../track';
import type { Piece } from '../trackdef';
import type { TrackTheme } from '../types';
import { laneCategory } from '../lanes';
import { makePath } from '../course-path';
import type { CoursePath } from '../course-path';
import { GATE_RAMP_H, floorAt, planCourse, planOfficial, platformerCourse } from './course';
import { buildBridgeBodies, buildLoopBodies } from './routes';
import type { CoursePlan, Lane } from './course';

export interface PlatformerInfo {
  plan: CoursePlan;
  path: CoursePath;
}

/** One-way ledges collide in this category (a non-lane bit; the marble's mask lets it in only from above). */
export const CAT_ONEWAY = 0x0800;
/** A ledge's thickness. */
export const LEDGE_H = 18;
/** How deep a floor's physics block is below its top edge. Thick enough that nothing tunnels through. */
export const FLOOR_DEPTH = 70;
/** All three lanes' bits: walls every lane shares (the start gate, the end walls). */
export const ALL_LANES = laneCategory(0) | laneCategory(1) | laneCategory(2);

function quad(points: Matter.Vector[], lane: number | null, kind: 'floor' | 'wall' | 'gate', depth = 0): Matter.Body {
  const centre = Matter.Vertices.centre(points);
  const body = Matter.Bodies.fromVertices(centre.x, centre.y, [points], {
    isStatic: true,
    friction: 0.002,
    frictionStatic: 0,
    restitution: 0,
    collisionFilter: { category: CAT_WALL, mask: lane === null ? ALL_LANES : laneCategory(lane), group: 0 },
  });
  // fromVertices re-centres on the centre of mass; put the shape back exactly where it was planned.
  const now = Matter.Vertices.centre(body.vertices);
  Matter.Body.setPosition(body, { x: body.position.x + centre.x - now.x, y: body.position.y + centre.y - now.y });
  body.plugin = { kind, lane: lane ?? undefined, depth };
  return body;
}

function box(x: number, y: number, w: number, h: number, lane: number | null, kind: 'floor' | 'wall' | 'gate', depth = 0): Matter.Body {
  return quad([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], lane, kind, depth);
}

/** What the classic Builder made for a course's extra pieces: bodies plus the lists the engine steps. */
export interface ExtraBuild { bodies: Matter.Body[]; spinners: Matter.Body[]; turnstiles: Matter.Body[]; itemBoxes: Matter.Body[]; buckets: Matter.Body[]; wreckers: Matter.Body[]; targetBanks: TargetBank[]; pegCount: { orange: number; total: number } }

/**
 * P2-26: the classic pieces on a platformer course. Each is replayed through the drop track's own Builder (same
 * physics, same machines, same art), then moved into its lane: it only meets marbles in that lane, and is drawn with
 * that lane. Bodies are tagged `classic` so the platformer renderer hands them to the classic body drawer.
 */
/** Set by trackdef.ts when it loads (importing it here would be an import cycle through track.ts). */
// Kept on globalThis as well, so a dev-server hot reload of this module does not lose it.
type Replay = (b: Builder, piece: Piece) => void;
const REPLAY_KEY = '__hmgpPieceReplay';
let replay: Replay | null = (globalThis as Record<string, unknown>)[REPLAY_KEY] as Replay | undefined ?? null;
export function registerPieceReplay(fn: Replay): void { replay = fn; (globalThis as Record<string, unknown>)[REPLAY_KEY] = fn; }

export function buildExtras(plan: CoursePlan, seed: number): ExtraBuild {
  if (plan.extras?.length && !replay) throw new Error('platformer extras need trackdef.ts loaded');
  const b = new Builder(seed ^ 0x26c1a55);
  for (const { lane, piece, source } of plan.extras ?? []) {
    const first = b.bodies.length;
    replay!(b, piece);
    for (const body of b.bodies.slice(first)) {
      const f = body.collisionFilter;
      // Any lane bit or the classic marble bit becomes this lane's bit; other bits (walls, sensors) stay.
      f.mask = ((f.mask ?? 0xffff) & ~(ALL_LANES | CAT_MARBLE)) | laneCategory(lane);
      const md = body.plugin as { lane?: number; classic?: boolean; source?: number };
      md.lane = lane;
      md.classic = true;
      md.source = source;
    }
  }
  return { bodies: b.bodies, spinners: b.spinners, turnstiles: b.turnstiles, itemBoxes: b.itemBoxes, buckets: b.buckets, wreckers: b.wreckers, targetBanks: b.targetBanks, pegCount: b.pegCount };
}

/** Build the platformer Track: an official course by id, else a course planned from the seed. */
export function buildPlatformerTrack(seed: number, theme: TrackTheme, courseId?: string): Track {
  return trackFromPlan(courseId ? planOfficial(platformerCourse(courseId)) : planCourse(seed), seed, theme);
}

/**
 * The bodies of everything a plan describes, except the shared walls and the start gate. `trackFromPlan` builds a whole
 * course with it; Infinity mode builds one chunk of land at a time.
 */
export function planBodies(plan: CoursePlan): { bodies: Matter.Body[]; itemBoxes: Matter.Body[]; wreckers: Matter.Body[] } {
  const bodies: Matter.Body[] = [];
  for (const f of plan.floors) {
    if (f.hidden || f.noBody) continue;
    const depth = Math.max(240, plan.height - Math.max(f.y0, f.y1));
    bodies.push(quad([{ x: f.x0, y: f.y0 }, { x: f.x1, y: f.y1 }, { x: f.x1, y: f.y1 + FLOOR_DEPTH }, { x: f.x0, y: f.y0 + FLOOR_DEPTH }], f.lane, 'floor', depth));
  }
  // Crossing tracks: rails and crossing floors, one body per segment. A rail's body lies on the right-hand side of
  // travel (it can run upright or upside down); a floor's hangs straight down as above. Segments inside a crossing
  // collide in their passage's ply bit (engine/platformer.ts plyMask), all others as ordinary walls.
  (plan.tracks ?? []).forEach((line, li) => {
    for (let i = 0; i < line.pts.length - 1; i++) {
      const a = line.pts[i], b = line.pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.5) continue;
      const tx = (b.x - a.x) / len, ty = (b.y - a.y) / len;
      const n = line.rail ? { x: -ty, y: tx } : { x: 0, y: 1 };
      const depth = line.rail ? -1 : Math.max(240, plan.height - Math.max(a.y, b.y));
      const body = quad([a, b, { x: b.x + n.x * FLOOR_DEPTH, y: b.y + n.y * FLOOR_DEPTH }, { x: a.x + n.x * FLOOR_DEPTH, y: a.y + n.y * FLOOR_DEPTH }], line.lane, 'floor', depth);
      body.collisionFilter.category = line.cats[i] || CAT_WALL;
      body.plugin = { kind: 'floor', lane: line.lane, depth, line: li, seg: i, rail: line.rail, tx, ty, source: line.source };
      bodies.push(body);
    }
  });
  for (const b of plan.bumps) if (!b.hidden) bodies.push(box(b.x, b.y, b.w, b.h + 20, b.lane as Lane, 'floor', b.h));
  // One-way ledges: their own collision category, so the engine can let a ball through from below.
  for (const l of plan.ledges ?? []) {
    const body = box(l.x, l.y, l.w, LEDGE_H, l.lane, 'floor', 0);
    body.collisionFilter.category = CAT_ONEWAY;
    body.plugin = { kind: 'ledge', lane: l.lane, depth: 0 };
    bodies.push(body);
  }
  // P2-21: loop rings and rope-bridge decks.
  for (const l of plan.loops ?? []) bodies.push(...buildLoopBodies(l));
  for (const br of plan.bridges ?? []) if (!br.hidden) bodies.push(...buildBridgeBodies(br));
  // The classic map pieces, each in its own lane's collision layer.
  const itemBoxes: Matter.Body[] = [];
  const wreckers: Matter.Body[] = [];
  for (const b of plan.itemBoxes ?? []) {
    // as big as the drawn box (44 px): at 17 a ball rolling under a box 46 px up missed it by a pixel
    const body = Matter.Bodies.circle(b.x, b.y, 22, { isStatic: true, isSensor: true, label: 'itembox', collisionFilter: { category: CAT_SENSOR, mask: laneCategory(b.lane), group: 0 } });
    body.plugin = { kind: 'itembox', active: true, respawnAt: 0, lane: b.lane };
    bodies.push(body);
    itemBoxes.push(body);
  }
  for (const w of plan.wreckers ?? []) {
    const pivot = { x: w.x, y: w.pivotY };
    const angle = w.amp * Math.sin(w.phase);
    const body = Matter.Bodies.circle(pivot.x + Math.sin(angle) * w.chain, pivot.y + Math.cos(angle) * w.chain, 24, {
      isStatic: true, label: 'wrecker', restitution: 0.6, friction: 0.002, collisionFilter: { category: CAT_WALL, mask: laneCategory(w.lane), group: 0 },
    });
    body.plugin = { kind: 'wrecker', pivot, chain: w.chain, amp: w.amp, spin: w.speed, phase: w.phase, radius: 24, lane: w.lane };
    bodies.push(body);
    wreckers.push(body);
  }
  // Kickers: a wedge standing on the floor, its top rising to a lip (a floor body, so it is part of the lane's ground).
  for (const k of plan.kickers ?? []) {
    const y0 = floorAt(plan, k.lane, k.x) ?? 0, y1 = floorAt(plan, k.lane, k.x + k.w) ?? y0;
    const body = quad([{ x: k.x, y: y0 + 2 }, { x: k.x + k.w, y: y1 - k.h }, { x: k.x + k.w, y: y1 + 24 }, { x: k.x, y: y0 + 24 }], k.lane, 'floor', k.h);
    body.plugin = { kind: 'floor', lane: k.lane, depth: -1, kicker: true };
    bodies.push(body);
  }
  // Lane-change ramps: the same wedge as a kicker, GATE_RAMP_H high at the gate's end (the engine throws the ball
  // across to the gate's lane off its lip).
  for (const g of plan.gates) {
    if (g.kind !== 'ramp') continue;
    const y0 = floorAt(plan, g.lane, g.x) ?? g.y, y1 = floorAt(plan, g.lane, g.x + g.w) ?? y0;
    const body = quad([{ x: g.x, y: y0 + 2 }, { x: g.x + g.w, y: y1 - GATE_RAMP_H }, { x: g.x + g.w, y: y1 + 24 }, { x: g.x, y: y0 + 24 }], g.lane, 'floor', GATE_RAMP_H);
    body.plugin = { kind: 'floor', lane: g.lane, depth: -1, kicker: true };
    bodies.push(body);
  }
  for (const b of plan.boosts ?? []) {
    const y0 = floorAt(plan, b.lane, b.x) ?? 0, y1 = floorAt(plan, b.lane, b.x + b.w) ?? y0;
    const len = Math.hypot(b.w, y1 - y0);
    const dir = { x: b.w / len, y: (y1 - y0) / len };
    const body = Matter.Bodies.rectangle(b.x + b.w / 2, (y0 + y1) / 2 - 18, len, 36, {
      isStatic: true, isSensor: true, label: 'boost', angle: Math.atan2(y1 - y0, b.w), collisionFilter: { category: CAT_SENSOR, mask: laneCategory(b.lane), group: 0 },
    });
    body.plugin = { kind: 'boost', dir, lane: b.lane };
    bodies.push(body);
  }
  return { bodies, itemBoxes, wreckers };
}

/** The Track for any course plan (an official one, a generated one, or one made by hand in a test or the Workshop). */
export function trackFromPlan(plan: CoursePlan, seed: number, theme: TrackTheme): Track {
  const { bodies, itemBoxes, wreckers } = planBodies(plan);
  const extra = buildExtras(plan, seed);
  bodies.push(...extra.bodies);
  itemBoxes.push(...extra.itemBoxes);
  wreckers.push(...extra.wreckers);
  // Shared walls: behind the grid and after the run-out.
  bodies.push(box(-240, plan.startY - 1400, 40, 1400 + FLOOR_DEPTH, null, 'wall'));
  bodies.push(box(plan.width + 200, -400, 40, plan.height + 400, null, 'wall'));
  // The start gate: a wall across every lane in front of the grid, removed at lights out.
  const gate = box(plan.startX, plan.startY - 400, 24, 400, null, 'gate');
  bodies.push(gate);

  return {
    seed,
    bodies,
    height: plan.height,
    // Story sectors and the HUD read `segments`; a platformer course is one long sector for now.
    segments: [{ name: 'Course', y: 0, h: plan.height }],
    spinners: extra.spinners,
    turnstiles: extra.turnstiles,
    itemBoxes,
    ramps: [],
    buckets: extra.buckets,
    targetBanks: extra.targetBanks,
    pegCount: extra.pegCount,
    gate,
    startY: plan.startY - 30,
    finishY: plan.finishY,
    theme,
    decor: [],
    wreckers,
    platformer: { plan, path: makePath(plan.path) },
  };
}
