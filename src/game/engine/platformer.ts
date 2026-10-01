// P2-00 (#124): the engine side of platformer courses: depth lanes, lane gates, progress along the
// course path, the finish line, falling off, and the baseline AI driver. Nothing here runs on a classic
// drop (every entry point checks `game.track.platformer`), so classic races stay byte-for-byte the same.
import Matter from 'matter-js';
import type { Game, Marble } from '../engine';
import { laneCategory, LANE_SWITCH_MS, LANE_MIDDLE } from '../lanes';
import { progressAlong, pointAt } from '../course-path';
import { floorAt } from '../platformer/course';
import type { Lane, LaneGate } from '../platformer/course';
import { CAT_WALL, CAT_SENSOR, CAT_FRAGILE, CAT_DANGER } from '../track';
import { CONTROL_TUNING, steerVelocity } from '../controls';
import { MARBLE_RADIUS } from '../types';

const { Body } = Matter;

/** Grid lanes by slot: spread the field over the three lanes so nobody starts boxed in. */
const GRID_LANES: Lane[] = [1, 0, 2, 1, 0, 2, 1, 0, 2, 1];
const GRID_GAP = 64;

/** Where a slot (1 = pole) lines up on a platformer grid, and in which lane. */
export function gridSpot(game: Game, slot: number): { x: number; y: number; lane: Lane } {
  const plan = game.track.platformer!.plan;
  const lane = GRID_LANES[(slot - 1) % GRID_LANES.length];
  const row = Math.floor((slot - 1) / 3);
  return { x: plan.startX - 40 - row * GRID_GAP - (slot % 2) * 14, y: plan.startY - MARBLE_RADIUS - 2, lane };
}

/** The collision filter for a marble in its lane: it meets its own lane's floors and rivals, and shared walls. */
export function applyLaneMask(game: Game, m: Marble): void {
  const lane = m.lane ?? LANE_MIDDLE;
  const ghost = m.ghostUntil > game.time;
  m.body.collisionFilter.category = laneCategory(lane);
  m.body.collisionFilter.mask = CAT_WALL | CAT_SENSOR | (ghost ? 0 : laneCategory(lane) | CAT_FRAGILE | CAT_DANGER);
}

/** Move a marble to another lane: a small hop, and the camera/skin dolly runs off `laneAt`. */
export function switchLane(game: Game, m: Marble, to: Lane): void {
  if ((m.lane ?? LANE_MIDDLE) === to) return;
  m.laneFrom = m.lane ?? LANE_MIDDLE;
  m.lane = to;
  m.laneAt = game.time;
  applyLaneMask(game, m);
  const v = Body.getVelocity(m.body);
  Body.setVelocity(m.body, { x: v.x, y: Math.min(v.y, -4) });
  if (m.info.isPlayer) game.sfx('spring', m, m.body.position.x, m.body.position.y);
}

/** Is this marble mid lane change (the dolly is still running)? */
export function switching(game: Game, m: Marble): boolean {
  return m.laneAt !== undefined && game.time - m.laneAt < LANE_SWITCH_MS;
}

function inside(g: LaneGate, m: Marble): boolean {
  const p = m.body.position;
  return (m.lane ?? LANE_MIDDLE) === g.lane && p.x >= g.x && p.x <= g.x + g.w && Math.abs(p.y - (g.y - MARBLE_RADIUS)) < 46;
}

/** The door this marble is standing in, if any. */
export function doorAt(game: Game, m: Marble): LaneGate | null {
  const info = game.track.platformer;
  if (!info || switching(game, m)) return null;
  return info.plan.gates.find((g) => g.kind === 'door' && inside(g, m)) ?? null;
}

/** A jump press inside a door goes through it instead of jumping. True when it did. */
export function tryDoor(game: Game, m: Marble): boolean {
  const door = doorAt(game, m);
  if (!door) return false;
  switchLane(game, m, door.to);
  return true;
}

/** Ramps: rolling through one on the ground takes you to its lane. */
export function laneGates(game: Game, m: Marble): void {
  const info = game.track.platformer;
  if (!info || switching(game, m) || m.grounded >= 5) return;
  for (const g of info.plan.gates) if (g.kind === 'ramp' && inside(g, m)) return switchLane(game, m, g.to);
}

/** Distance along the course path (a hint keeps it on its own stretch). */
export function updateProgress(game: Game, m: Marble): void {
  const info = game.track.platformer!;
  m.progress = progressAlong(info.path, m.body.position, m.progress);
}

/** Crossing the finish line, in any lane. */
export function crossedFinish(game: Game, m: Marble): boolean {
  const plan = game.track.platformer!.plan;
  return m.body.position.x >= plan.finishX && m.body.position.y < plan.finishY + 60;
}

/** Fell off (a gap, or out of the world) or stalled for too long: back onto the middle lane, a little behind. */
export function platformRecovery(game: Game, m: Marble, dt: number): void {
  if (!game.recoveryEnabled || m.finishedAt !== null || m.frozen) return;
  const info = game.track.platformer!;
  const p = m.body.position;
  const progress = m.progress ?? 0;
  const line = pointAt(info.path, progress);
  if ((m.progress ?? 0) > (m.bestProgress ?? -Infinity) + 20) {
    m.bestProgress = m.progress;
    m.motionAt = game.time;
  }
  const fell = !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.y > line.y + 420;
  // A person standing still is waiting on purpose; only a computer driver gets marshalled for stalling.
  const stalled = !game.isHuman(m) && game.time - m.motionAt > 6000;
  if (!fell && !stalled) return;
  // Back on solid middle-lane floor, a little behind where it went wrong.
  let d = Math.max(0, progress - (fell ? 140 : 0));
  let spot = pointAt(info.path, d);
  for (let i = 0; i < 40 && floorAt(info.plan, LANE_MIDDLE as Lane, spot.x) === null; i++) spot = pointAt(info.path, (d -= 30));
  const floor = floorAt(info.plan, LANE_MIDDLE as Lane, spot.x) ?? spot.y + 30;
  m.lane = LANE_MIDDLE;
  m.laneFrom = LANE_MIDDLE;
  m.laneAt = undefined;
  applyLaneMask(game, m);
  Body.setPosition(m.body, { x: spot.x, y: floor - MARBLE_RADIUS - 4 });
  Body.setVelocity(m.body, { x: 0, y: 0 });
  Body.setAngularVelocity(m.body, 0);
  m.trail = [];
  m.motionAt = game.time;
  m.progress = d;
  m.bestProgress = d;
  m.recoveries++;
  m.recoveryUntil = game.time + 1600;
  game.effects.push({ type: 'ring', x: spot.x, y: floor - MARBLE_RADIUS, ttl: 30, maxTtl: 30, color: '#d63e2e' });
  if (m.info.isPlayer) game.onEvent?.(fell ? 'Fell off: back on the middle lane' : 'Race marshal: back on track', '#d63e2e');
  void dt;
}

/**
 * Baseline AI driver (P2-16 makes it smart): roll right at its own pace, jump gaps, bumps and climbs,
 * and sometimes take a door. Returns the velocity to use this step.
 */
export function aiDrive(game: Game, m: Marble, v: Matter.Vector, s: number): Matter.Vector {
  const info = game.track.platformer!;
  const plan = info.plan;
  const lane = (m.lane ?? LANE_MIDDLE) as Lane;
  const p = m.body.position;
  const grounded = m.grounded < 5;
  const cap = 7 + m.info.stats.speed * 0.25;
  if (v.x < cap) v = { x: Math.min(cap, steerVelocity(v.x, 1, grounded, s)), y: v.y };

  if (!grounded || game.time < (m.aiJumpAt ?? 0)) return v;
  const here = floorAt(plan, lane, p.x);
  const look = 34 + Math.max(0, v.x) * 7;
  const ahead = floorAt(plan, lane, p.x + look);
  const bump = plan.bumps.some((b) => b.lane === lane && b.x > p.x && b.x - p.x < 20 + Math.max(0, v.x) * 5);
  const gap = ahead === null;
  const climb = here !== null && ahead !== null && ahead < here - 12;
  if (gap || bump || climb) {
    m.aiJumpAt = game.time + CONTROL_TUNING.jumpCooldownMs;
    return { x: v.x, y: Math.min(v.y, -CONTROL_TUNING.jumpSpeed) };
  }
  // Doors: decide once per door, from the race rng (deterministic on the host).
  const door = doorAt(game, m);
  if (door && m.doorSeen !== door.x) {
    m.doorSeen = door.x;
    if (game.rng() < 0.45) switchLane(game, m, door.to);
  }
  return v;
}
