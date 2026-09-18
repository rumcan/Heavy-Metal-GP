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
import { meta } from './track';
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
    default:
      return;
  }
}

/** Drive every framework element of this track for one frame. */
export function updateElements(track: Track, time: number, dt: number): void {
  for (const body of elementBodies(track, 'trapdoor')) updateElement(body, time, dt);
  for (const body of elementBodies(track, 'switch')) updateElement(body, time, dt);
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
