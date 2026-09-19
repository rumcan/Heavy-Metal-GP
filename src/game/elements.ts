/**
 * MB-10 element framework — the shared machinery behind the MB-10A…F track elements.
 *
 * Two driving ideas, taken from the ticket rules:
 *
 * - **Kinematic motion is a pure function of the race clock.** A trapdoor on a timer, a swinging
 *   blade, a piston: the pose at time `t` is computable by anyone holding the same track, exactly
 *   like the wrecking ball. The host uses it before each physics step; a multiplayer guest uses
 *   the very same code on its lerped clock to draw the frame it renders — no wire traffic at all.
 * - **Stateful pieces ease toward a state.** A switch plate leaning left/right, a weight-opened
 *   trapdoor: the state is decided by the host and crosses as an event; both ends run the same
 *   easing (`updateElements` is called from `Game.ageEffects`, which the host runs inside `step`
 *   and the guest runs on its own render loop).
 *
 * Physics stays vector, art is a skin: this file moves Matter bodies and nothing else. The
 * renderer reads the same bodies (and the same clock helpers) for what it draws.
 */
import Matter from 'matter-js';
import { meta, catapultAngle, flipperAngle } from './track';
import type { Kind, Meta, Motion, Track } from './track';

const { Body } = Matter;

/** Milliseconds a hinged door spends swinging between shut and open (and back). */
export const HINGE_SWING_MS = 420;

// ---------------------------------------------------------------- kind index

/**
 * Track bodies grouped by kind, built once per track. `track.bodies` is append-only and never
 * reordered (the multiplayer wire speaks body indices), so a per-track cache is stable forever.
 */
const kindIndex = new WeakMap<Track, Map<Kind, Matter.Body[]>>();

/** Every track body of `kind`, in body order (empty when the track has none). */
export function elementBodies(track: Track, kind: Kind): Matter.Body[] {
  let byKind = kindIndex.get(track);
  if (!byKind) {
    byKind = new Map();
    kindIndex.set(track, byKind);
  }
  let list = byKind.get(kind);
  if (!list) {
    list = track.bodies.filter((body) => meta(body)?.kind === kind);
    byKind.set(kind, list);
  }
  return list;
}

/** True when the track contains at least one body of `kind` (cheap: indexed once). */
export function hasElement(track: Track, kind: Kind): boolean {
  return elementBodies(track, kind).length > 0;
}

// ---------------------------------------------------------------- easing

/** Smooth 0..1 (smoothstep). */
export function ease01(k: number): number {
  const c = Math.max(0, Math.min(1, k));
  return c * c * (3 - 2 * c);
}

/** Move `current` toward `target` at `rate` per ms, never overshooting. */
export function approach01(current: number, target: 0 | 1, ms: number, fullMs: number): number {
  const step = ms / fullMs;
  if (current < target) return Math.min(target, current + step);
  return Math.max(target, current - step);
}

// ---------------------------------------------------------------- hinge pose

/** The timer program of a hinged door: shut, a warning beat, a swing open, a hold, a swing shut. */
export function hingeTimerState(motion: Extract<Motion, { mode: 'hinge' }>, time: number): { angle: number; open: boolean; warn: boolean } {
  const cycle = motion.closedMs + motion.openMs;
  const t = ((time + motion.phase) % cycle + cycle) % cycle;
  const closeAt = motion.closedMs;
  if (t < closeAt - HINGE_SWING_MS) {
    return { angle: 0, open: false, warn: t > closeAt - HINGE_SWING_MS - 700 };
  }
  if (t < closeAt) {
    const k = ease01(1 - (closeAt - t) / HINGE_SWING_MS);
    return { angle: motion.openAngle * k, open: k > 0.5, warn: true };
  }
  if (t < cycle - HINGE_SWING_MS) return { angle: motion.openAngle, open: true, warn: false };
  const k = ease01(1 - (cycle - t) / HINGE_SWING_MS);
  return { angle: motion.openAngle * k, open: k > 0.5, warn: false };
}

/** The door centre when swung to `angle` (hinge pivot + the half-arm rotated). */
export function hingeCenter(motion: Extract<Motion, { mode: 'hinge' }>, angle: number): Matter.Vector {
  const hx = motion.dirX * motion.len / 2;
  return { x: motion.pivot.x + Math.cos(angle) * hx, y: motion.pivot.y + Math.sin(angle) * hx };
}

/** Was the door open past the point where marbles fall through? */
export function hingeIsOpen(motion: Extract<Motion, { mode: 'hinge' }>, angle: number): boolean {
  return Math.abs(angle) > Math.abs(motion.openAngle) * 0.45;
}

// ---------------------------------------------------------------- MB-10B programs

/** Blade swing angle at `time`: ±amp about vertical, full period `periodMs`. */
export function pendulumAngle(motion: Extract<Motion, { mode: 'pendulum' }>, time: number): number {
  return motion.amp * Math.sin((2 * Math.PI * ((time + motion.phaseMs) % motion.periodMs)) / motion.periodMs);
}

/** Blade angular speed (rad/ms) at `time` — drives the knockback's shove. */
export function pendulumOmega(motion: Extract<Motion, { mode: 'pendulum' }>, time: number): number {
  return motion.amp * ((2 * Math.PI) / motion.periodMs) * Math.cos((2 * Math.PI * ((time + motion.phaseMs) % motion.periodMs)) / motion.periodMs);
}

/**
 * Saw slide: eased ping-pong between the slot ends (a smooth start/stop sells the machinery).
 * Returns 0..1 along a→b.
 */
export function slideAt(motion: Extract<Motion, { mode: 'slide' }>, time: number): number {
  const tt = (((time + motion.phaseMs) / motion.periodMs) % 1 + 1) % 1;
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * tt);
}

/** Saw slides back: the direction of travel at `time` (+1 toward b, -1 toward a). */
export function slideDir(motion: Extract<Motion, { mode: 'slide' }>, time: number): number {
  const tt = (((time + motion.phaseMs) / motion.periodMs) % 1 + 1) % 1;
  return Math.sin(2 * Math.PI * tt) >= 0 ? 1 : -1;
}

/** The crusher's slam window in ms — a fast eased drop; the rise takes the rest of the cycle. */
export const PISTON_SLAM_MS = 220;
/** How far above the plate a squash is heard (rumble warning window before the slam). */
export const PISTON_WARN_MS = 700;

/**
 * Crusher piston pose: 0 = parked at the top, 1 = at the floor. Program: top rest, a fast eased
 * slam, `floorMs` sitting on the deck, then a slow rise over whatever the cycle leaves.
 */
export function pistonState(motion: Extract<Motion, { mode: 'piston' }>, time: number): { k: number; slam: boolean; warn: boolean } {
  const cycle = motion.periodMs;
  const t = ((time + motion.phaseMs) % cycle + cycle) % cycle;
  const slamEnd = cycle - motion.floorMs - PISTON_SLAM_MS - Math.max(400, cycle * 0.25);
  // layout: [0, slamStart) rest at top, [slamStart, +SLAM) drop, floor hold, then rise
  const slamStart = Math.max(0, slamEnd);
  if (t < slamStart) return { k: 0, slam: false, warn: t > slamStart - PISTON_WARN_MS };
  if (t < slamStart + PISTON_SLAM_MS) {
    const r = (t - slamStart) / PISTON_SLAM_MS;
    return { k: ease01(r), slam: true, warn: true };
  }
  const riseStart = slamStart + PISTON_SLAM_MS + motion.floorMs;
  if (t < riseStart) return { k: 1, slam: false, warn: false };
  const riseMs = Math.max(60, cycle - riseStart);
  const r = (t - riseStart) / riseMs;
  return { k: ease01(1 - r), slam: false, warn: false };
}

/**
 * Boulder pose: distance rolled into the path at `time` (0 while resting at the top, capped at
 * `spanLen` until the cycle wraps and it is "collected" back to the shed).
 */
export function rollAt(motion: Extract<Motion, { mode: 'roll' }>, time: number): { d: number; rolling: boolean } {
  const t = ((time + motion.phaseMs) % motion.intervalMs + motion.intervalMs) % motion.intervalMs;
  if (t < motion.restMs) return { d: 0, rolling: false };
  const runMs = Math.max(200, motion.intervalMs - motion.restMs);
  const d = Math.min(motion.spanLen, ((t - motion.restMs) / runMs) * motion.spanLen);
  return { d, rolling: true };
}

/** Point on a boulder path at distance `d` (and the local travel direction). */
export function pathAt(motion: Extract<Motion, { mode: 'roll' }>, d: number): { x: number; y: number; dir: Matter.Vector } {
  const { path, stepLens } = motion;
  let i = stepLens.length - 1;
  for (let k = 1; k < stepLens.length; k++) if (d <= stepLens[k]) { i = k - 1; break; }
  const a = path[i], b = path[Math.min(i + 1, path.length - 1)];
  const seg = Math.max(1e-6, stepLens[i + 1] - stepLens[i]);
  const k = Math.max(0, Math.min(1, (d - stepLens[i]) / seg));
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, dir: { x: (b.x - a.x) / seg, y: (b.y - a.y) / seg } };
}

/** Mace sweep angle from eased progress k∈[0,1] over the program: sweep, pause, sweep back, pause. */
export function sweepAngleFrom(k: number, motion: Extract<Motion, { mode: 'sweep' }>): number {
  const half = motion.sweepMs + motion.pauseMs;
  const t = k * (half * 2);
  const swing = (f: number) => -1 + 2 * ease01(Math.max(0, Math.min(1, f)));
  let side: number;
  if (t < motion.sweepMs) side = swing(t / motion.sweepMs);
  else if (t < half) side = 1;
  else if (t < half + motion.sweepMs) side = -swing((t - half) / motion.sweepMs);
  else side = -1;
  return side * (motion.arc / 2);
}

// ---------------------------------------------------------------- generic movers

/**
 * Drive one element body for this frame. Runs on the host (inside `step` via `ageEffects`) and
 * on guests (same call from the guest's render loop), so both ends agree on every pose.
 * Clock-driven motion reads `time`; stateful pieces ease toward their meta state.
 */
export function updateElement(body: Matter.Body, time: number, dt: number): void {
  const md = meta(body);
  if (!md || md.destroyed) return;
  switch (md.kind) {
    case 'trapdoor': {
      const motion = md.motion;
      if (!motion || motion.mode !== 'hinge') return;
      let angle: number;
      if (md.mode === 'weight') {
        // stateful: host decided md.openNow; ease toward it on both ends
        const k = approach01(md.eased ?? 0, md.openNow ? 1 : 0, dt, HINGE_SWING_MS);
        md.eased = k;
        angle = motion.openAngle * ease01(k);
      } else {
        angle = hingeTimerState(motion, time).angle;
      }
      const centre = hingeCenter(motion, angle);
      (Body.setAngle as unknown as (b: Matter.Body, a: number, u: boolean) => void)(body, angle, true);
      (Body.setPosition as unknown as (b: Matter.Body, p: Matter.Vector, u: boolean) => void)(body, centre, true);
      // past the tipping point the hatch is a hole, not a floor
      const open = hingeIsOpen(motion, angle);
      const mask = open ? 0 : 0xffff;
      if (body.collisionFilter.mask !== mask) body.collisionFilter.mask = mask;
      return;
    }
    case 'switch': {
      const pivot = md.pivot;
      const len = md.plateLen ?? 120;
      if (!pivot) return;
      const target = (md.side === 1 ? 1 : -1) * (md.swingAngle ?? 0.6);
      // ease the plate over ~180ms so the swing reads (and never teleports a resting marble)
      const cur = body.angle + (target - body.angle) * Math.min(1, dt * 0.0055);
      (Body.setAngle as unknown as (b: Matter.Body, a: number, u: boolean) => void)(body, cur, true);
      (Body.setPosition as unknown as (b: Matter.Body, p: Matter.Vector, u: boolean) => void)(
        body, { x: pivot.x + Math.sin(cur) * len / 2, y: pivot.y - Math.cos(cur) * len / 2 }, true);
      return;
    }
    // ---- MB-10C: the water wheel hub spins on the race clock like every other machine ----
    case 'wheel': {
      const motion = md.motion;
      if (!motion || motion.mode !== 'spin') return;
      (Body.setAngle as unknown as (b: Matter.Body, a: number, u: boolean) => void)(body, motion.omega * (time + motion.phaseMs), true);
      (Body.setPosition as unknown as (b: Matter.Body, p: Matter.Vector, u: boolean) => void)(body, motion.pivot, true);
      return;
    }
    // ---- MB-10B: blades and crushers — all pure-clock poses, so guests draw the same machine ----
    case 'blade': {
      const motion = md.motion;
      if (!motion || motion.mode !== 'pendulum') return;
      const angle = pendulumAngle(motion, time);
      (Body.setAngle as unknown as (b: Matter.Body, a: number, u: boolean) => void)(body, angle, true);
      (Body.setPosition as unknown as (b: Matter.Body, p: Matter.Vector, u: boolean) => void)(
        body, { x: motion.pivot.x + Math.sin(angle) * motion.arm / 2, y: motion.pivot.y + Math.cos(angle) * motion.arm / 2 }, true);
      return;
    }
    case 'saw': {
      const motion = md.motion;
      if (!motion || motion.mode !== 'slide') return;
      const k = slideAt(motion, time);
      (Body.setPosition as unknown as (b: Matter.Body, p: Matter.Vector, u: boolean) => void)(
        body, { x: motion.a.x + (motion.b.x - motion.a.x) * k, y: motion.a.y + (motion.b.y - motion.a.y) * k }, true);
      return;
    }
    case 'crusher': {
      const motion = md.motion;
      if (!motion || motion.mode !== 'piston') return;
      const { k } = pistonState(motion, time);
      (Body.setPosition as unknown as (b: Matter.Body, p: Matter.Vector, u: boolean) => void)(
        body, { x: motion.top.x, y: motion.top.y + 22 + motion.travel * k }, true);
      return;
    }
    case 'boulder': {
      const motion = md.motion;
      if (!motion || motion.mode !== 'roll') return;
      const { d } = rollAt(motion, time);
      const p = pathAt(motion, d);
      (Body.setPosition as unknown as (b: Matter.Body, p2: Matter.Vector, u: boolean) => void)(body, { x: p.x, y: p.y }, true);
      (Body.setAngle as unknown as (b: Matter.Body, a: number, u: boolean) => void)(body, d / Math.max(1, motion.r), true);
      md.rolled = d;
      return;
    }
    case 'mace': {
      const motion = md.motion;
      if (!motion || motion.mode !== 'sweep') return;
      const cycle = 2 * (motion.sweepMs + motion.pauseMs);
      let k = md.eased ?? ((motion.phaseMs % cycle) / cycle);
      if (time < (md.stunUntil ?? 0)) {
        // shocked: the arm shivers in place for two seconds instead of sweeping
        const ju = Math.sin(time * 0.09) * 0.02;
        (Body.setPosition as unknown as (b: Matter.Body, p: Matter.Vector, u: boolean) => void)(
          body, maceTip(motion, sweepAngleFrom(k, motion) + ju), true);
        return;
      }
      k = (k + dt / cycle) % 1;
      md.eased = k;
      (Body.setPosition as unknown as (b: Matter.Body, p: Matter.Vector, u: boolean) => void)(
        body, maceTip(motion, sweepAngleFrom(k, motion)), true);
      return;
    }
    // ---- MB-10D: catapult arm and flipper bat — kinematic pose from their state clocks ----
    case 'catapult': {
      const ct = md.catapult;
      if (!ct) return;
      const a = catapultAngle(ct, time);
      (Body.setAngle as unknown as (b: Matter.Body, a: number, u: boolean) => void)(body, a, true);
      (Body.setPosition as unknown as (b: Matter.Body, p: Matter.Vector, u: boolean) => void)(
        body, { x: ct.px + Math.cos(a) * ct.len / 2, y: ct.py + Math.sin(a) * ct.len / 2 }, true);
      return;
    }
    case 'flipper': {
      const fl = md.flipper;
      if (!fl) return;
      const a = flipperAngle(fl, time);
      (Body.setAngle as unknown as (b: Matter.Body, a: number, u: boolean) => void)(body, a, true);
      (Body.setPosition as unknown as (b: Matter.Body, p: Matter.Vector, u: boolean) => void)(
        body, { x: fl.px + Math.cos(a) * fl.len / 2, y: fl.py + Math.sin(a) * fl.len / 2 }, true);
      return;
    }
    case 'platform': {
      const motion = md.motion;
      if (!motion || motion.mode !== 'platform') return;
      const p = platformPose(motion, time);
      (Body.setPosition as unknown as (b: Matter.Body, p: Matter.Vector, u: boolean) => void)(body, p, true);
      return;
    }
    case 'turnstile': {
      const ts = md.turnstile;
      if (!ts) return;
      const a = turnstileAngle(ts, time);
      (Body.setAngle as unknown as (b: Matter.Body, a: number, u: boolean) => void)(body, a, true);
      return;
    }
    default:
      return;
  }
}

/** Mace head centre at sweep angle a (pivot + the arm rotated off straight-down). */
export function maceTip(motion: Extract<Motion, { mode: 'sweep' }>, a: number): Matter.Vector {
  return { x: motion.pivot.x + Math.sin(a) * motion.arm, y: motion.pivot.y + Math.cos(a) * motion.arm };
}

/** Drive every framework element of this track for one frame. */
export function updateElements(track: Track, time: number, dt: number): void {
  for (const body of elementBodies(track, 'trapdoor')) updateElement(body, time, dt);
  for (const body of elementBodies(track, 'switch')) updateElement(body, time, dt);
  for (const body of elementBodies(track, 'blade')) updateElement(body, time, dt);
  for (const body of elementBodies(track, 'saw')) updateElement(body, time, dt);
  for (const body of elementBodies(track, 'crusher')) updateElement(body, time, dt);
  for (const body of elementBodies(track, 'boulder')) updateElement(body, time, dt);
  for (const body of elementBodies(track, 'mace')) updateElement(body, time, dt);
  for (const body of elementBodies(track, 'wheel')) updateElement(body, time, dt);
  // MB-10D
  for (const body of elementBodies(track, 'catapult')) updateElement(body, time, dt);
  for (const body of elementBodies(track, 'flipper')) updateElement(body, time, dt);
  for (const body of elementBodies(track, 'platform')) updateElement(body, time, dt);
  for (const body of elementBodies(track, 'turnstile')) updateElement(body, time, dt);
}

// ---------------------------------------------------------------- warnings (skins read these)

/**
 * The warning state of a timer trapdoor: lit while the door is about to swing open, and again
 * while it is moving. Weight doors light while the pack is resting on them (host-tracked).
 */
export function trapdoorWarn(md: Meta, time: number): boolean {
  const motion = md.motion;
  if (!motion || motion.mode !== 'hinge') return false;
  if (md.mode === 'weight') return (md.restSince ?? 0) > 60 || !!md.openNow;
  return hingeTimerState(motion, time).warn;
}

/** MB-10C conveyor: the belt's current direction — base direction times the optional clock flip. */
export function beltDir(belt: { dir0: 1 | -1; flipMs?: number }, time: number): 1 | -1 {
  const flip = belt.flipMs && belt.flipMs > 0 ? (Math.floor(time / belt.flipMs) % 2 ? -1 : 1) : 1;
  return (flip * belt.dir0) as 1 | -1;
}

/** MB-10F platform pose: shuttle a<->b at steady speed, pausing at each end. Deterministic off the clock. */
export function platformPose(motion: Extract<Motion, { mode: 'platform' }>, time: number): Matter.Vector {
  const leg = motion.travelMs + motion.pauseMs;
  const cycle = leg * 2;
  const t = ((time + motion.phaseMs) % cycle + cycle) % cycle;
  let u: number;
  if (t < motion.pauseMs) u = 0;
  else if (t < motion.pauseMs + motion.travelMs) u = (t - motion.pauseMs) / motion.travelMs;
  else u = 1;
  if (t >= leg) u = 1 - u; // coming home: mirror the outbound run
  const e = u * u * (3 - 2 * u); // smooth departs and arrives, pauses read as dwelling
  return { x: motion.a.x + (motion.b.x - motion.a.x) * e, y: motion.a.y + (motion.b.y - motion.a.y) * e };
}

/** MB-10F turnstile angle: free spin off the clock, or an eased 90/-90 ratchet step from the last hit. */
export function turnstileAngle(t: { mode: 0 | 1; arms: number; periodMs: number; phaseMs: number; stepIndex: number; stepAt: number }, time: number): number {
  if (t.mode === 1) return ((time + t.phaseMs) * Math.PI * 2) / t.periodMs;
  const step = (Math.PI * 2) / (t.arms * 2); // half a notch per hit: arms pass twice per revolution
  const from = (t.stepIndex - 1) * step;
  const to = t.stepIndex * step;
  const k = Math.min(1, Math.max(0, (time - t.stepAt) / 420));
  const e = k * k * (3 - 2 * k);
  return from + (to - from) * e;
}
