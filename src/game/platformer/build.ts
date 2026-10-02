// P2-00 (#124): turn a course plan into a Track the engine races on. Physics stays plain vector shapes:
// every floor and bump is a static quad in its own depth lane (collision mask = that lane's bit only).
import Matter from 'matter-js';
import { CAT_WALL } from '../track';
import type { Track } from '../track';
import type { TrackTheme } from '../types';
import { laneCategory } from '../lanes';
import { makePath } from '../course-path';
import type { CoursePath } from '../course-path';
import { planCourse, planOfficial, platformerCourse } from './course';
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
  const plan = courseId ? planOfficial(platformerCourse(courseId)) : planCourse(seed);
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
    itemBoxes: [],
    ramps: [],
    buckets: [],
    targetBanks: [],
    pegCount: { orange: 0, total: 0 },
    gate,
    startY: plan.startY - 30,
    finishY: plan.finishY,
    theme,
    decor: [],
    wreckers: [],
    platformer: { plan, path: makePath(plan.path) },
  };
}
