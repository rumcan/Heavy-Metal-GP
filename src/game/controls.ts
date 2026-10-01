// P2-01 (#107): the control rules. Pure functions, no DOM, no clock: time is passed in, so the engine
// (and the host, online) can replay them exactly. Every number lives in CONTROL_TUNING.

/** Steering from the held controls: touch wins, else right minus left. -1 … 0 … +1. */
export function nudgeOf(controls: { left: boolean; right: boolean; touch: number }): number {
  return controls.touch || Number(controls.right) - Number(controls.left);
}

export const CONTROL_TUNING = {
  steerGround: 0.22,         // x-velocity added per step (s = 1) while steering on the ground
  steerAir: 0.12,            // same, in the air
  counterSteerBoost: 1.6,    // multiplier when pushing against your current x-motion
  maxSteerVx: 10,            // steering never pushes |vx| past this in the pushed direction
  engineThrust: 0.18,        // Magic Engine push per step (s = 1)
  engineHeatPerMs: 1 / 3000, // heat gained per ms while firing (full heat = 1 after 3 s)
  engineCoolPerMs: 1 / 4000, // heat lost per ms while not firing
  overheatLockMs: 1500,      // no engine for this long after reaching full heat
  jumpSpeed: 9,              // upward speed of the core jump (the engine applies vy = -jumpSpeed)
  coyoteMs: 120,             // a jump still works this long after leaving the ground
  jumpBufferMs: 120,         // a press this long before landing still jumps on landing
  jumpCooldownMs: 500,       // minimum time between two jumps
};
export type ControlTuning = typeof CONTROL_TUNING;

/** New x-velocity after steering. `nudge` is -1..1 (0 = no input); `s` is the step scale. */
export function steerVelocity(vx: number, nudge: number, grounded: boolean, s: number, t: ControlTuning = CONTROL_TUNING): number {
  if (nudge === 0) return vx;
  let push = (grounded ? t.steerGround : t.steerAir) * nudge * s;
  const against = vx !== 0 && Math.sign(nudge) !== Math.sign(vx);
  if (against) return vx + push * t.counterSteerBoost; // steering against the motion is never clamped
  const dir = Math.sign(nudge);
  if (vx * dir >= t.maxSteerVx) return vx;             // already at/over the cap that way
  const next = vx + push;
  return dir > 0 ? Math.min(next, t.maxSteerVx) : Math.max(next, -t.maxSteerVx);
}

export interface EngineState { heat: number; lockedUntil: number }
export function newEngine(): EngineState { return { heat: 0, lockedUntil: 0 }; }

/** Advance the Magic Engine by `dtMs` at time `now` (ms). `held` = the engine key is held. */
export function engineStep(state: EngineState, held: boolean, now: number, dtMs: number, t: ControlTuning = CONTROL_TUNING): { state: EngineState; firing: boolean } {
  const cool = () => ({ state: { heat: Math.max(0, state.heat - dtMs * t.engineCoolPerMs), lockedUntil: state.lockedUntil }, firing: false });
  if (now < state.lockedUntil || !held) return cool();
  const heat = state.heat + dtMs * t.engineHeatPerMs;
  if (heat >= 1) return { state: { heat: 1, lockedUntil: now + t.overheatLockMs }, firing: false };
  return { state: { heat, lockedUntil: state.lockedUntil }, firing: true };
}

/** The engine's push to add to velocity this step: along the direction of travel, straight down when nearly stopped. */
export function engineThrust(vx: number, vy: number, firing: boolean, s: number, t: ControlTuning = CONTROL_TUNING): { x: number; y: number } {
  if (!firing) return { x: 0, y: 0 };
  const speed = Math.hypot(vx, vy);
  if (speed < 0.5) return { x: 0, y: t.engineThrust * s };
  const k = (t.engineThrust * s) / speed;
  return { x: vx * k, y: vy * k };
}

export interface JumpState { lastGroundedAt: number; pressedAt: number; lastJumpAt: number }
export function newJump(): JumpState { return { lastGroundedAt: -Infinity, pressedAt: -Infinity, lastJumpAt: -Infinity }; }

/** Advance the core jump at time `now`. `pressed` = a NEW press happened this step. One press, one jump. */
export function jumpStep(state: JumpState, now: number, grounded: boolean, pressed: boolean, t: ControlTuning = CONTROL_TUNING): { state: JumpState; jump: boolean } {
  const next: JumpState = {
    lastGroundedAt: grounded ? now : state.lastGroundedAt,
    pressedAt: pressed ? now : state.pressedAt,
    lastJumpAt: state.lastJumpAt,
  };
  const jump = now - next.pressedAt <= t.jumpBufferMs
    && now - next.lastGroundedAt <= t.coyoteMs
    && now - next.lastJumpAt >= t.jumpCooldownMs;
  if (jump) { next.lastJumpAt = now; next.pressedAt = -Infinity; }
  return { state: next, jump };
}
