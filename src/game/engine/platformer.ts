// P2-00 (#124): the engine side of platformer courses: depth lanes, lane gates, progress along the
// course path, the finish line, falling off, and the baseline AI driver. Nothing here runs on a classic
// drop (every entry point checks `game.track.platformer`), so classic races stay byte-for-byte the same.
import { personalityOf } from '../ai-personality';
import Matter from 'matter-js';
import type { Game, Marble } from '../engine';
import { ALL_PLY, laneCategory, LANE_SWITCH_MS, LANE_MIDDLE } from '../lanes';
import { progressAlong, pointAt } from '../course-path';
import { GATE_RAMP_H, floorAt, SPRING_W } from '../platformer/course';
import { CAT_ONEWAY } from '../platformer/build';
import type { CoursePlan, Lane, LaneGate } from '../platformer/course';
import type { CrossPassage, CrossZone } from '../platformer/course';
import { CAT_WALL, CAT_SENSOR, CAT_FRAGILE, CAT_DANGER, CAT_LOOP_UP, CAT_LOOP_CLOSE, meta } from '../track';
import { PLANK_H, bridgeLineAt, inLoopBox } from '../platformer/routes';
import type { LoopSpot } from '../platformer/routes';
import { CONTROL_TUNING, steerVelocity } from '../controls';
import { SAMPLE_STEP, decide } from '../ai-brain';
import type { Difficulty, Sense } from '../ai-brain';
import { MARBLE_RADIUS, ITEM_TYPES } from '../types';
import type { ItemType } from '../types';
import { SKILLS } from '../skills/catalog';

const { Body } = Matter;

/** Grid lanes by slot: spread the field over the three lanes so nobody starts boxed in. */
const GRID_LANES: Lane[] = [1, 0, 2, 1, 0, 2, 1, 0, 2, 1];
/** Cannons in one lane stand this far apart (pole furthest forward). */
const CANNON_GAP = 150;

// ---- The cannon start: every racer starts loaded in a cannon of their own, aims during the countdown and
// fires once the lights are out (a person presses jump; the AI fires straight away; nobody stays in forever).
/** Barrel length from the pivot to the muzzle, where the loaded ball sits. */
export const CANNON_LEN = 44;
/** Launch speed out of the muzzle. */
export const CANNON_SPEED = 13;
/** Aim limits, radians above the horizon (aimed forward, to the right). */
export const CANNON_MIN = 0.12;
export const CANNON_MAX = 1.25;
/** A person who has not fired this long after lights out is fired anyway. */
export const CANNON_AUTOFIRE_MS = 2500;

export interface Cannon { x: number; y: number; lane: Lane; angle: number; fired: boolean; fireAt: number }

/** Where a slot's cannon stands (1 = pole) and in which lane. */
export function gridSpot(game: Game, slot: number): { x: number; y: number; lane: Lane } {
  const plan = game.track.platformer!.plan;
  if (plan.lanes && plan.lanes.length < 3) {
    // a course with fewer lanes: the grid shares them out, rows closer together so ten cannons still fit
    const lanes = plan.lanes as Lane[];
    const lane = lanes[(slot - 1) % lanes.length];
    const row = Math.floor((slot - 1) / lanes.length);
    const gap = lanes.length === 1 ? 64 : 110;
    return { x: plan.startX - 60 - row * gap, y: plan.startY - 20, lane };
  }
  const lane = GRID_LANES[(slot - 1) % GRID_LANES.length];
  const row = Math.floor((slot - 1) / 3);
  return { x: plan.startX - 60 - row * CANNON_GAP, y: plan.startY - 20, lane };
}

/** The muzzle of a cannon aimed at `angle`. */
export function muzzle(c: Cannon): Matter.Vector {
  return { x: c.x + Math.cos(c.angle) * CANNON_LEN, y: c.y - Math.sin(c.angle) * CANNON_LEN };
}

/** Load a marble into its cannon at the grid. The AI's aim is rolled from the race seed. */
export function loadCannon(game: Game, m: Marble, spot: { x: number; y: number }): void {
  const angle = game.isHuman(m) ? 0.6 : 0.3 + game.rng() * 0.55;
  m.cannon = { x: spot.x, y: spot.y, lane: (m.lane ?? LANE_MIDDLE) as Lane, angle, fired: false, fireAt: Infinity };
  holdInCannon(m);
}

function holdInCannon(m: Marble): void {
  const c = m.cannon!;
  Body.setPosition(m.body, muzzle(c));
  Body.setVelocity(m.body, { x: 0, y: 0 });
  Body.setAngularVelocity(m.body, 0);
  m.body.collisionFilter.mask = 0; // nothing touches a ball inside a barrel
}

/** Lights out: everyone gets a fuse. People have CANNON_AUTOFIRE_MS to fire; the AI goes within half a second. */
export function armCannons(game: Game): void {
  for (const m of game.marbles) {
    if (!m.cannon || m.cannon.fired) continue;
    m.cannon.fireAt = game.time + (game.isHuman(m) ? CANNON_AUTOFIRE_MS : 120 + game.rng() * 480);
  }
}

/** A step for a marble still in its cannon: aim (people steer it with left/right), hold the ball, fire. */
export function cannonStep(game: Game, m: Marble, s: number): void {
  const c = m.cannon!;
  const guest = game.humanInput.get(m.info.id);
  const local = m === game.player && m.info.isPlayer;
  const nudge = guest ? guest.nudge : local ? game.nudge : 0;
  // Jump is the trigger. A press during the countdown is used up, so it cannot fire the instant the lights go.
  let pull = false;
  if (guest) { pull = guest.jump === true; guest.jump = false; }
  else if (local) { pull = game.jumpPressed; game.jumpPressed = false; }
  // Right flattens the shot (further, lower), left lifts it (higher, shorter).
  if (nudge !== 0) c.angle = Math.max(CANNON_MIN, Math.min(CANNON_MAX, c.angle - nudge * 0.022 * s));
  holdInCannon(m);
  if (!game.gateOpen || !(pull || game.time >= c.fireAt)) return;
  c.fired = true;
  applyLaneMask(game, m);
  Body.setVelocity(m.body, { x: Math.cos(c.angle) * CANNON_SPEED, y: -Math.sin(c.angle) * CANNON_SPEED });
  m.motionAt = game.time;
  const p = muzzle(c);
  game.sfx('bang', m, p.x, p.y);
  game.effects.push({ type: 'ring', x: p.x, y: p.y, ttl: 18, maxTtl: 18, color: 'rgba(255,220,160,0.9)' });
  game.effects.push({ type: 'debris', x: p.x, y: p.y, ttl: 22, maxTtl: 22, color: '#9ca3af', particles: game.makeParticles(p.x, p.y, 8, 2.2) });
}

/** The collision filter for a marble in its lane: it meets its own lane's floors and rivals, and shared walls. */
export function applyLaneMask(game: Game, m: Marble): void {
  const lane = m.lane ?? LANE_MIDDLE;
  const ghost = m.ghostUntil > game.time;
  m.body.collisionFilter.category = laneCategory(lane);
  // P2-08: a Drill passes through the floor (only sensors are felt for its second)
  if ((m.fx?.drillUntil ?? 0) > game.time) { m.body.collisionFilter.mask = CAT_SENSOR; return; }
  // P2-21: a loop ring is two halves on their own bits; a marble meets the half it is riding (see loopStep).
  const loopBit = game.track.platformer?.plan.loops?.length ? ((m.loopPhase ?? 0) === 1 ? CAT_LOOP_CLOSE : CAT_LOOP_UP) : 0;
  m.body.collisionFilter.mask = CAT_WALL | CAT_SENSOR | (ghost ? 0 : laneCategory(lane) | CAT_FRAGILE | CAT_DANGER) | loopBit | (onLedgeSide(game, m) ? CAT_ONEWAY : 0) | plyMask(game, m);
}

// ---- Crossing tracks (Workshop): a ball rides the track it last touched; where tracks cross, the others are not there
// for it. Outside crossings every track is solid (all ply bits); inside one, only its own passage's bit.

/** How close (px, ball centre to track) a passage must be for a ball with no track of its own to be caught by it. */
const PASS_REACH = 80;

function segDist(p: Matter.Vector, a: Matter.Vector, b: Matter.Vector): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function passageDistance(game: Game, P: CrossPassage, p: Matter.Vector): number {
  const tracks = game.track.platformer!.plan.tracks!;
  let best = Infinity;
  for (const [li, s0, s1] of P.runs) { const pts = tracks[li].pts; for (let i = s0; i <= s1; i++) best = Math.min(best, segDist(p, pts[i], pts[i + 1])); }
  return best;
}

/** The passage of zone `z` this marble rides: its last touched track, else (rolling) the nearest, (in the air) the front one. */
function choosePassage(game: Game, m: Marble, z: CrossZone): CrossPassage | null {
  const tracks = game.track.platformer!.plan.tracks!;
  const t = m.track;
  if (t && tracks[t.line]) {
    // the passage holding the segment it touched, else the nearest run of that track, else of a track joined to it
    for (const lines of [[t.line], tracks[t.line].joins]) {
      let best: CrossPassage | null = null, bestGap = Infinity;
      for (const P of z.passages) {
        for (const [li, s0, s1] of P.runs) {
          if (!lines.includes(li)) continue;
          const gap = li === t.line ? (t.seg < s0 ? s0 - t.seg : t.seg > s1 ? t.seg - s1 : 0) : 0;
          if (gap < bestGap) { bestGap = gap; best = P; }
        }
      }
      if (best) return best;
    }
  }
  const p = m.body.position;
  const near = z.passages.map((P) => ({ P, d: passageDistance(game, P, p) })).filter((x) => x.d <= PASS_REACH);
  if (!near.length) return null;
  if (m.grounded < 5) return near.reduce((a, b) => (b.d < a.d - 4 || (Math.abs(b.d - a.d) <= 4 && b.P.depth > a.P.depth) ? b : a)).P;
  return near.reduce((a, b) => (b.P.depth > a.P.depth ? b : a)).P;
}

/** The ply bits of this marble's mask (and its `passage`, for the renderer). */
export function plyMask(game: Game, m: Marble): number {
  m.passage = undefined;
  const zones = game.track.platformer?.plan.crossings;
  if (!zones?.length) return ALL_PLY;
  const lane = m.lane ?? LANE_MIDDLE, p = m.body.position, pad = MARBLE_RADIUS;
  for (let zi = 0; zi < zones.length; zi++) {
    const z = zones[zi];
    if (z.lane !== lane || p.x < z.x0 - pad || p.x > z.x1 + pad || p.y < z.y0 - pad || p.y > z.y1 + pad) continue;
    const P = choosePassage(game, m, z);
    if (!P) return ALL_PLY; // nothing of its own and nothing near: every track solid, the first touch decides
    m.passage = { zone: zi, id: P.id };
    const zoneBits = z.passages.reduce((bits, q) => bits | q.bit, 0);
    return (ALL_PLY & ~zoneBits) | P.bit;
  }
  return ALL_PLY;
}

/** Called for every marble-floor contact: remember the Workshop track it touched (any other floor forgets it). */
export function noteTrackContact(game: Game, m: Marble, other: Matter.Body): void {
  const md = meta(other);
  if (!md || (md.kind !== 'floor' && md.kind !== 'ledge')) return;
  if (md.line === undefined || md.seg === undefined) { m.track = undefined; return; }
  m.track = { line: md.line, seg: md.seg, at: game.time };
  if (md.rail) {
    m.rail = { tx: md.tx ?? 1, ty: md.ty ?? 0, at: game.time };
    m.grounded = 0; // on a rail at any angle a ball can steer and jump (off the track's face)
  }
}

/** The rail this marble is on right now, if it runs steep or upside down there (else null: ordinary steering). */
export function onSteepRail(game: Game, m: Marble): { tx: number; ty: number } | null {
  const r = m.rail;
  if (!r || game.time - r.at > 40) return null;
  return r.tx < 0.5 ? r : null;
}

/**
 * Steering. On a steep or upside-down rail it pushes along the track (right = forward, the rail's direction of travel;
 * left = back); there is no grip: a ball that runs out of speed falls. Anywhere else it is the usual sideways push.
 */
export function railSteer(game: Game, m: Marble, v: Matter.Vector, nudge: number, grounded: boolean, s: number): Matter.Vector {
  const r = onSteepRail(game, m);
  if (!r) return { x: steerVelocity(v.x, nudge, grounded, s), y: v.y };
  const along = v.x * r.tx + v.y * r.ty;
  if ((nudge > 0 && along >= CONTROL_TUNING.maxSteerVx) || (nudge < 0 && along <= -CONTROL_TUNING.maxSteerVx)) return v;
  const push = CONTROL_TUNING.steerGround * nudge * s;
  return { x: v.x + r.tx * push, y: v.y + r.ty * push };
}

/** A jump. On a steep or upside-down rail it pushes off the track's running face; anywhere else straight up as always. */
export function railJump(game: Game, m: Marble, v: Matter.Vector): Matter.Vector {
  const r = onSteepRail(game, m);
  if (!r) return { x: v.x, y: Math.min(v.y, -CONTROL_TUNING.jumpSpeed) };
  return { x: v.x + r.ty * CONTROL_TUNING.jumpSpeed, y: v.y - r.tx * CONTROL_TUNING.jumpSpeed };
}

const inBox = (b: { x0: number; y0: number; x1: number; y1: number }, p: Matter.Vector, pad: number) =>
  p.x >= b.x0 - pad && p.x <= b.x1 + pad && p.y >= b.y0 - pad && p.y <= b.y1 + pad;

/** Is this marble in or near a rail (pad px) of its lane? */
export function inRailBox(game: Game, m: Marble, pad = 40): boolean {
  const plan = game.track.platformer?.plan;
  const lane = m.lane ?? LANE_MIDDLE, p = m.body.position;
  return !!plan?.tracks?.some((l) => l.rail && l.lane === lane && inBox(l.box, p, pad));
}

/** Is this marble in or near a crossing (pad px) of its lane? */
function inCrossing(game: Game, m: Marble, pad = 40): boolean {
  const plan = game.track.platformer?.plan;
  const lane = m.lane ?? LANE_MIDDLE, p = m.body.position;
  return !!plan?.crossings?.some((z) => z.lane === lane && inBox(z, p, pad));
}

/** A rail of this marble's lane up to `reach` px ahead (the computer driver commits: full push, no hop). */
export function railAhead(game: Game, m: Marble, reach = 420): boolean {
  const plan = game.track.platformer?.plan;
  if (!plan?.tracks?.length) return false;
  const lane = m.lane ?? LANE_MIDDLE, p = m.body.position;
  return plan.tracks.some((l) => l.rail && l.lane === lane && p.x > l.box.x0 - reach && p.x < l.box.x1 + 20 && p.y > l.box.y0 - 200 && p.y < l.box.y1 + 200);
}

/**
 * Loops (P2-21): which half of the ring a marble rides. It starts on the climb; once it is up high and past the top
 * (left of the ring's middle) it is on the way back down, until it is out past the exit or leaves the ring's box.
 * A marble that runs out of speed on the climb never passes the top, so it falls back down the climb and out the way
 * it came; one that falls off inside the ring after the top lands on the way down and rolls out the exit.
 */
export function loopStep(game: Game, m: Marble): void {
  const loops = game.track.platformer?.plan.loops;
  if (!loops?.length) return;
  const lane = m.lane ?? LANE_MIDDLE;
  const p = m.body.position;
  let phase = 0;
  for (const l of loops) {
    if (l.lane !== lane || !inLoopBox(l, p)) continue;
    const top = l.x + l.pitch / 2;
    if ((m.loopPhase ?? 0) === 1) phase = p.x > l.x + l.pitch + 24 ? 0 : 1;
    // Over the top means up near the top of the ring and travelling back (left). A hop inside the ring is not a ride:
    // switching halves then would leave the ball wedged against the way down from inside.
    else phase = p.y < l.y - l.r * 1.6 && p.x < top && m.body.velocity.x < 0.5 ? 1 : 0;
  }
  if (phase === 1 && (m.loopPhase ?? 0) === 0) game.storyCounter('loops', m); // STORY HOOK: over the top of a loop ring
  m.loopPhase = phase as 0 | 1;
}

/** Steering is off while a marble is up on a loop ring: the ride is the speed it came in with (pushing against it at the top would stall it). */
export function loopLocked(game: Game, m: Marble): boolean {
  const loops = game.track.platformer?.plan.loops;
  if (!loops?.length) return false;
  const lane = m.lane ?? LANE_MIDDLE;
  const p = m.body.position;
  return loops.some((l) => l.lane === lane && inLoopBox(l, p) && (p.y < l.y - 34 || (m.loopPhase ?? 0) === 1));
}


/**
 * One-way ledges: a ball meets a ledge only when it is coming down onto it from above (its bottom at or above
 * the ledge top, not rising). From below, or jumping up through it, it passes straight through.
 */
function onLedgeSide(game: Game, m: Marble): boolean {
  const ledges = game.track.platformer?.plan.ledges;
  if (!ledges?.length) return false;
  const lane = m.lane ?? LANE_MIDDLE;
  const p = m.body.position;
  const v = m.body.velocity;
  for (const l of ledges) {
    if (l.lane !== lane || p.x < l.x - MARBLE_RADIUS || p.x > l.x + l.w + MARBLE_RADIUS) continue;
    if (p.y + MARBLE_RADIUS <= l.y + 6 && v.y > -0.5) return true;
  }
  return false;
}

/**
 * A marble resting on a rope bridge is grounded (it can jump from the deck, steer on it, and the driver can read it).
 * The engine re-poses the planks every step, so their contacts never settle into 'active' ones; this looks for the plank
 * under the marble instead: its bottom within a few pixels of a plank top.
 */
function bridgeGround(game: Game, m: Marble): void {
  if (!game.track.platformer?.plan.bridges?.length) return;
  const lane = m.lane ?? LANE_MIDDLE;
  const p = m.body.position;
  for (const plank of game.bridgeChains().flat()) {
    const md = meta(plank);
    if (md.lane !== lane || Math.abs(p.x - plank.position.x) > (md.bridge?.plankLen ?? 30) / 2 + 2) continue;
    const gap = p.y + MARBLE_RADIUS - (plank.position.y - PLANK_H / 2);
    if (gap > -5 && gap < 9) { m.grounded = 0; return; }
  }
}

/** Spring launch speed (upward). Higher than a jump: a spring is how you reach a ledge. */
export const SPRING_SPEED = 13;

/** Every step: the one-way mask, and springs under a grounded ball. */
export function laneStep(game: Game, m: Marble): void {
  loopStep(game, m);
  applyLaneMask(game, m);
  bridgeGround(game, m);
  keepAboveFloor(game, m);
  const springs = game.track.platformer!.plan.springs;
  if (!springs?.length || game.time < (m.springAt ?? -Infinity) + 400) return;
  const lane = m.lane ?? LANE_MIDDLE;
  const p = m.body.position;
  for (const s of springs) {
    if (s.lane !== lane || p.x < s.x || p.x > s.x + SPRING_W) continue;
    if (Math.abs(p.y + MARBLE_RADIUS - s.y) > 14) continue;
    m.springAt = game.time;
    const v = Body.getVelocity(m.body);
    Body.setVelocity(m.body, { x: Math.max(v.x, 6), y: -SPRING_SPEED });
    game.sfx('spring', m, p.x, p.y);
    return;
  }
}

/**
 * Safety net: a ball must never be inside or just under its own lane's track (lanes sit at different heights, and a
 * lane change in mid-air could slip it under the next stretch). If it is, it goes back on top, moving no faster
 * downward than it was.
 */
export function keepAboveFloor(game: Game, m: Marble): void {
  if (m.hold || (m.cannon && !m.cannon.fired) || (m.fx?.drillUntil ?? 0) > game.time) return;
  if ((m.loopPhase ?? 0) === 1) return; // riding a loop ring
  const p = m.body.position;
  const plan = game.track.platformer!.plan;
  const lane = m.lane ?? LANE_MIDDLE;
  // rope bridges sag below the line between their anchors, and loops have their own rings: leave those alone
  if (plan.bridges?.some((b) => b.lane === lane && p.x >= b.x0 - 20 && p.x <= b.x1 + 20)) return;
  if (plan.loops?.some((l) => l.lane === lane && p.x >= l.x - l.r - 40 && p.x <= l.x + l.pitch + l.r + 40)) return;
  // crossing tracks: under an overpass or inside a loop the floor below is not this ball's floor
  if (inCrossing(game, m) || inRailBox(game, m)) return;
  const floor = floorAt(plan, lane as Lane, p.x);
  if (floor === null || p.y <= floor - MARBLE_RADIUS + 6 || p.y > floor + 160) return;
  Body.setPosition(m.body, { x: p.x, y: floor - MARBLE_RADIUS - 1 });
  const v = Body.getVelocity(m.body);
  if (v.y > 0) Body.setVelocity(m.body, { x: v.x, y: 0 });
}

/** Move a marble to another lane: a small hop, and the camera/skin dolly runs off `laneAt`. */
export function switchLane(game: Game, m: Marble, to: Lane): void {
  if ((m.lane ?? LANE_MIDDLE) === to) return;
  m.laneFrom = m.lane ?? LANE_MIDDLE;
  m.lane = to;
  m.track = undefined; m.rail = undefined;
  m.laneAt = game.time;
  applyLaneMask(game, m);
  // Lanes have their own hills: if the new lane's floor is above the ball, the ball goes on top of it. Over a chasm in
  // the new lane, its next stretch just ahead counts (else the ball would slide in underneath it).
  const plan = game.track.platformer!.plan;
  let floor = floorAt(plan, to, m.body.position.x);
  for (let ahead = 20; floor === null && ahead <= 300; ahead += 20) floor = floorAt(plan, to, m.body.position.x + ahead);
  if (floor !== null && m.body.position.y > floor - MARBLE_RADIUS - 2) Body.setPosition(m.body, { x: m.body.position.x, y: floor - MARBLE_RADIUS - 2 });
  const v = Body.getVelocity(m.body);
  Body.setVelocity(m.body, { x: v.x, y: Math.min(v.y, -4) });
  if (m.info.isPlayer) game.sfx('spring', m, m.body.position.x, m.body.position.y);
}

/** Is this marble mid lane change (the dolly is still running)? */
export function switching(game: Game, m: Marble): boolean {
  // P2-20: Quick Reflexes (laneSwitchPct, negative) ends the change sooner — without the talent this
  // is the same 750 ms the renderer's dolly runs for.
  const speedUp = m.tfx?.laneSwitchPct ?? 0;
  const window = LANE_SWITCH_MS * Math.max(0.25, 1 + speedUp / 100);
  return m.laneAt !== undefined && game.time - m.laneAt < window;
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

/**
 * How hard a lane-change ramp's lip throws the ball up (px per step): enough to clear the other track by about 50 px
 * (a ball thrown up at v rises about v * v / 0.58 px here, measured), at least a hop, at most a big leap.
 */
export function gateLaunchVy(rise: number): number {
  return Math.max(4, Math.min(11, Math.sqrt(0.58 * Math.max(0, rise + 50))));
}

/**
 * Lane-change ramps are jump ramps (the owner): roll up one and its lip throws you into the air and across onto the
 * lane it leads to; you land on that track. Jump over it (or fly past it) and nothing happens.
 */
/**
 * Gold rings on a race course (the owner: rings in normal races too): any ball rolling or flying through one in its
 * lane takes it, and it counts like an orange peg (the same credits at the finish). Deterministic, so an online room
 * agrees. Infinity counts its own rings (its tally), so it switches this off.
 */
export function collectRings(game: Game, m: Marble): void {
  const rings = game.track.platformer?.plan.rings;
  if (!rings?.length || !game.collectRings || m.finishedAt !== null) return;
  const p = m.body.position, lane = m.lane ?? LANE_MIDDLE;
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    if (r.lane !== lane || Math.abs(r.x - p.x) > 34 || Math.abs(r.y - p.y) > 34 || Math.hypot(r.x - p.x, r.y - p.y) > 34) continue;
    rings.splice(i, 1);
    m.pegs++;
    if (game.isHuman(m)) game.sfx('pickup', m, r.x, r.y);
    game.effects.push({ type: 'ring', x: r.x, y: r.y, ttl: 18, maxTtl: 18, color: '#ffd34a' });
  }
}

export function laneGates(game: Game, m: Marble): void {
  const info = game.track.platformer;
  if (!info || switching(game, m)) return;
  const p = m.body.position;
  const lane = m.lane ?? LANE_MIDDLE;
  // rolling on a ramp's slope: touching the wedge's top (it rises GATE_RAMP_H to the lip; see build.ts)
  const g = info.plan.gates.find((gate) => {
    if (gate.kind !== 'ramp' || gate.lane !== lane || p.x < gate.x || p.x > gate.x + gate.w) return false;
    const y0 = floorAt(info.plan, gate.lane as Lane, gate.x) ?? gate.y, y1 = floorAt(info.plan, gate.lane as Lane, gate.x + gate.w) ?? y0;
    const top = y0 + ((y1 - GATE_RAMP_H - y0) * (p.x - gate.x)) / gate.w;
    return Math.abs(p.y + MARBLE_RADIUS - top) < 16;
  });
  if (g) m.gateRide = { gate: g, at: game.time };
  const ride = m.gateRide;
  if (!ride) return;
  if (game.time - ride.at > 250 || ride.gate.lane !== lane) { m.gateRide = undefined; return; }
  if (p.x <= ride.gate.x + ride.gate.w) return;
  // off the lip: up and across
  m.gateRide = undefined;
  const vx = m.body.velocity.x;
  // how far the other track (a little ahead, where the ball comes down) stands above the ball
  const target = floorAt(info.plan, ride.gate.to as Lane, p.x + 120) ?? floorAt(info.plan, ride.gate.to as Lane, p.x);
  const rise = target === null ? 0 : p.y + MARBLE_RADIUS - target;
  switchLane(game, m, ride.gate.to);
  Body.setVelocity(m.body, { x: vx, y: Math.min(m.body.velocity.y, -gateLaunchVy(rise)) });
}

/** Distance along the course path (a hint keeps it on its own stretch). */
export function updateProgress(game: Game, m: Marble): void {
  const info = game.track.platformer!;
  const next = progressAlong(info.path, m.body.position, m.progress);
  // a loop runs backwards for a while: never lose race position riding one
  m.progress = m.progress !== undefined && inRailBox(game, m, 0) ? Math.max(m.progress, next) : next;
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
  // A ball with too little speed to ride a loop sits at the foot of the ring, pushing into it for ever. After a moment
  // (a person gets longer, they may back off and try again) the marshal lifts it out past the ring, rolling on.
  if (loopRescue(game, m)) return;
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
  m.track = undefined; m.rail = undefined;
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

/** Lifts a marble stuck at the foot of a loop ring out past its exit. True when it did. */
function loopRescue(game: Game, m: Marble): boolean {
  const loops = game.track.platformer?.plan.loops;
  if (!loops?.length) return false;
  const lane = m.lane ?? LANE_MIDDLE;
  const p = m.body.position, v = m.body.velocity;
  const loop = loops.find((l) => l.lane === lane && inLoopBox(l, p));
  if (!loop || Math.hypot(v.x, v.y) > 2.5 || p.y < loop.y - loop.r) { m.loopStuckSince = undefined; return false; }
  m.loopStuckSince ??= game.time;
  if (game.time - m.loopStuckSince < (game.isHuman(m) ? 4000 : 1500)) return false;
  m.loopStuckSince = undefined;
  const plan = game.track.platformer!.plan;
  const x = loop.x + loop.pitch + loop.r + 90;
  const floor = floorAt(plan, lane as Lane, x) ?? loop.y;
  Body.setPosition(m.body, { x, y: floor - MARBLE_RADIUS - 4 });
  Body.setVelocity(m.body, { x: 6, y: 0 });
  Body.setAngularVelocity(m.body, 0);
  m.loopPhase = 0;
  m.track = undefined; m.rail = undefined;
  applyLaneMask(game, m);
  m.trail = [];
  m.progress = progressAlong(game.track.platformer!.path, m.body.position, undefined);
  m.bestProgress = m.progress;
  m.motionAt = game.time;
  m.recoveries++;
  m.recoveryUntil = game.time + 1200;
  game.effects.push({ type: 'ring', x, y: floor - MARBLE_RADIUS, ttl: 30, maxTtl: 30, color: '#d63e2e' });
  if (m.info.isPlayer) game.onEvent?.('Race marshal: lifted over the loop', '#d63e2e');
  return true;
}

/** Computer drivers' skill level, from their Speed stat (stronger rivals are better drivers). */
function difficultyOf(m: Marble): Difficulty {
  const sp = m.info.stats.speed;
  return sp >= 8 ? 'hard' : sp <= 3 ? 'easy' : 'normal';
}

/**
 * Does this lane change make sense? Into the safe middle lane always. Into a risky outer lane: never for a cautious
 * driver, always for a reckless one, about half the gates (stable per gate) for everyone else.
 */
function betterLane(g: { x: number; to: number }, caution = 0.5): boolean {
  if (g.to === LANE_MIDDLE) return true;
  if (caution >= 0.7) return false;
  if (caution <= 0.25) return true;
  return ((g.x / 10) | 0) % 2 === 0;
}

/** The skills a computer is holding, in a fixed order (the brain picks by index into this list). */
function heldSkills(m: Marble): ItemType[] {
  return ITEM_TYPES.filter((id) => m.inventory[id] > 0);
}

/** The floor a computer driver senses at `x`: a rope bridge counts as the straight line between its anchors (not its sag). */
function sensedFloor(plan: CoursePlan, lane: Lane, x: number): number | null {
  for (const b of plan.bridges ?? []) if (b.lane === lane) { const line = bridgeLineAt(b, x); if (line !== null) return line; }
  return floorAt(plan, lane, x);
}

/** The loop of this marble's lane whose entry is up to `reach` px ahead (the driver commits to it), if any. */
export function loopAhead(game: Game, m: Marble, reach = 420): LoopSpot | null {
  const loops = game.track.platformer?.plan.loops;
  if (!loops?.length) return null;
  const lane = m.lane ?? LANE_MIDDLE;
  const x = m.body.position.x;
  return loops.find((l) => l.lane === lane && x > l.x - reach && x < l.x + 20) ?? null;
}

/** What a computer driver senses this step (src/game/ai-brain.ts decides from it). */
function sense(game: Game, m: Marble, vx: number, grounded: boolean): Sense {
  const plan = game.track.platformer!.plan;
  const lane = (m.lane ?? LANE_MIDDLE) as Lane;
  const p = m.body.position;
  const here = sensedFloor(plan, lane, p.x) ?? p.y + MARBLE_RADIUS;
  const ahead: (number | null)[] = [];
  for (let i = 1; i <= 16; i++) {
    const f = sensedFloor(plan, lane, p.x + i * SAMPLE_STEP);
    ahead.push(f === null ? null : f - here);
  }
  const dist = (xs: number[]) => xs.filter((x) => x > p.x).reduce((a, x) => Math.min(a, x - p.x), Infinity);
  const nearest = (xs: number[]) => { const d = dist(xs); return Number.isFinite(d) ? d : null; };
  // P2-26: classic pieces in this lane and near the ball's height: hazards to time or hop, solid things to jump.
  const near = classicBodies(game).filter((b) => (meta(b) as { lane?: number }).lane === lane && Math.abs(b.position.y - p.y) < 260 && Math.abs(b.position.x - p.x) < 1500);
  const classicSolid = near.filter((b) => CLASSIC_SOLID.has(meta(b).kind) && !b.isSensor).map((b) => b.bounds.min.x);
  const classicDanger = near.filter((b) => CLASSIC_DANGER.has(meta(b).kind)).map((b) => b.bounds.min.x - 30);
  const crateAt = nearest([...plan.bumps.filter((b) => b.lane === lane).map((b) => b.x), ...classicSolid]);
  const dangerAt = nearest([...game.track.wreckers.filter((w) => meta(w).lane === lane).map((w) => w.position.x - 30), ...classicDanger]);
  let rivalAhead: Sense['rivalAhead'] = null;
  let rivalBehind: Sense['rivalBehind'] = null;
  for (const o of game.marbles) {
    if (o === m || o.finishedAt !== null || (o.lane ?? LANE_MIDDLE) !== lane) continue;
    const dx = o.body.position.x - p.x;
    if (dx > 0 && (!rivalAhead || dx < rivalAhead.dx)) rivalAhead = { dx, dy: o.body.position.y - p.y };
    else if (dx <= 0 && (!rivalBehind || -dx < rivalBehind.dx)) rivalBehind = { dx: -dx };
  }
  const gate = (kind: 'ramp' | 'door') => {
    let best: { dist: number; better: boolean } | null = null;
    for (const g of plan.gates) {
      if (g.kind !== kind || g.lane !== lane) continue;
      const d = g.x - p.x;
      const inside = p.x >= g.x && p.x <= g.x + g.w;
      if (!inside && d < 0) continue;
      const dd = inside ? 0 : d;
      if (!best || dd < best.dist) best = { dist: dd, better: betterLane(g, personalityOf(m.info, game.aiDifficulty).caution) };
    }
    return best;
  };
  return {
    time: game.time, difficulty: difficultyOf(m), persona: personalityOf(m.info, game.aiDifficulty), grounded, vx, ahead, crateAt, wallAt: null, dangerAt,
    heat: m.engine?.heat ?? 0, overheated: (m.engine?.lockedUntil ?? 0) > game.time, hp: m.health?.hp ?? 100,
    rivalAhead, rivalBehind, slots: heldSkills(m).map((id) => ({ charges: m.inventory[id], hint: SKILLS[id].aiHint })), lastSkillAt: m.aiSkillAt ?? -Infinity,
    door: gate('door'), ramp: gate('ramp'), rng: () => game.rng(),
  };
}

/**
 * The computer driver (P2-16): the pure brain in ai-brain.ts decides from what it senses; this applies it.
 * Skills and the Magic Engine are not used yet (they arrive with the skill system).
 */
/** The classic pieces of a course, found once per track (every driver senses them every step). */
const classicCache = new WeakMap<object, Matter.Body[]>();
function classicBodies(game: Game): Matter.Body[] {
  let list = classicCache.get(game.track.bodies);
  if (!list) { list = game.track.bodies.filter((b) => (meta(b) as { classic?: boolean }).classic); classicCache.set(game.track.bodies, list); }
  return list;
}

/** P2-26: classic pieces the computer drivers jump (solid) or time and hop (danger). */
const CLASSIC_SOLID = new Set(['block', 'breakable', 'barricade', 'crumble', 'wall', 'peg', 'ppeg', 'target', 'turnstile']);
const CLASSIC_DANGER = new Set(['blade', 'saw', 'crusher', 'boulder', 'mace', 'spinner', 'wrecker']);

export function aiDrive(game: Game, m: Marble, v: Matter.Vector, s: number): Matter.Vector {
  const grounded = m.grounded < 5;
  // P2-21 / crossing tracks: with a loop or a rail just ahead the driver commits: full push, no hop, no door.
  const commit = !!loopAhead(game, m) || railAhead(game, m);
  const brain = decide(sense(game, m, v.x, grounded));
  const d = commit ? { ...brain, nudge: 1, jump: false, takeDoor: false } : brain;
  if (d.nudge !== 0) v = railSteer(game, m, v, d.nudge, grounded, s);
  if (grounded && game.time >= (m.aiJumpAt ?? 0)) {
    // Pushing but not moving: a rival (or anything else) is in the way. Hop it.
    const blocked = !commit && v.x < 1.2 && game.time - game.raceStartTime > 1500;
    if (d.jump || blocked) {
      m.aiJumpAt = game.time + CONTROL_TUNING.jumpCooldownMs;
      v = { x: v.x, y: Math.min(v.y, -CONTROL_TUNING.jumpSpeed) };
    }
  }
  // Skills: the brain says which held skill fits the moment; a refused one (no target, health off) is just tried later.
  if (d.slot !== null) {
    const id = heldSkills(m)[d.slot];
    m.aiSkillAt = game.time;
    if (id) game.useItem(m, id);
  }
  const door = doorAt(game, m);
  if (door && d.takeDoor && m.doorSeen !== door.x) {
    m.doorSeen = door.x;
    switchLane(game, m, door.to);
  }
  return v;
}
