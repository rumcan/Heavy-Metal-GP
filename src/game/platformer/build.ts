// P2-00 (#124): turn a course plan into a Track the engine races on. Physics stays plain vector shapes:
// every floor and bump is a static quad in its own depth lane (collision mask = that lane's bit only).
import Matter from 'matter-js';
import { CAT_SENSOR, CAT_WALL } from '../track';
import type { Track } from '../track';
import type { TrackTheme } from '../types';
import { laneCategory } from '../lanes';
import { makePath } from '../course-path';
import type { CoursePath } from '../course-path';
import { floorAt, planCourse, planOfficial, platformerCourse } from './course';
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
    const depth = Math.max(240, plan.height - Math.max(f.y0, f.y1));
    bodies.push(quad([{ x: f.x0, y: f.y0 }, { x: f.x1, y: f.y1 }, { x: f.x1, y: f.y1 + FLOOR_DEPTH }, { x: f.x0, y: f.y0 + FLOOR_DEPTH }], f.lane, 'floor', depth));
  }
  for (const b of plan.bumps) bodies.push(box(b.x, b.y, b.w, b.h + 20, b.lane as Lane, 'floor', b.h));
  // One-way ledges: their own collision category, so the engine can let a ball through from below.
  for (const l of plan.ledges ?? []) {
    const body = box(l.x, l.y, l.w, LEDGE_H, l.lane, 'floor', 0);
    body.collisionFilter.category = CAT_ONEWAY;
    body.plugin = { kind: 'ledge', lane: l.lane, depth: 0 };
    bodies.push(body);
  }
  // P2-21: loop rings and rope-bridge decks.
  for (const l of plan.loops ?? []) bodies.push(...buildLoopBodies(l));
  for (const br of plan.bridges ?? []) bodies.push(...buildBridgeBodies(br));
  // The classic map pieces, each in its own lane's collision layer.
  const itemBoxes: Matter.Body[] = [];
  const wreckers: Matter.Body[] = [];
  for (const b of plan.itemBoxes ?? []) {
    const body = Matter.Bodies.circle(b.x, b.y, 17, { isStatic: true, isSensor: true, label: 'itembox', collisionFilter: { category: CAT_SENSOR, mask: laneCategory(b.lane), group: 0 } });
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
    spinners: [],
    turnstiles: [],
    itemBoxes,
    ramps: [],
    buckets: [],
    targetBanks: [],
    pegCount: { orange: 0, total: 0 },
    gate,
    startY: plan.startY - 30,
    finishY: plan.finishY,
    theme,
    decor: [],
    wreckers,
    platformer: { plan, path: makePath(plan.path) },
  };
}
