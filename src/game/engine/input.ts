// Human input: steering, the core jump and the Magic Engine. P2-01 (controls) owns this file.
// The rules (numbers, heat, coyote time) live in ../controls.ts; this applies them to a marble.
import Matter from 'matter-js';
import type { Game, Marble } from '../engine';
import { CONTROL_TUNING, engineStep, engineThrust, jumpStep, newEngine, newJump, steerVelocity } from '../controls';
import { TICK } from '../engine';
import { nearGround, railJump, railSteer, tryDoor } from './platformer';

/** Is this marble driven by a human (local or a guest)? Only humans get the engine and the core jump. */
function handsOf(game: Game, m: Marble): { nudge: number; engine: boolean; jump: boolean } | null {
  const guest = game.humanInput.get(m.info.id);
  if (guest) {
    const jump = guest.jump === true;
    guest.jump = false; // one press, one jump
    return { nudge: guest.nudge, engine: guest.engine === true, jump };
  }
  if (m !== game.player || !m.info.isPlayer) return null;
  const jump = game.jumpPressed;
  game.jumpPressed = false;
  return { nudge: game.nudge, engine: game.engineHeld, jump };
}

/** Apply this marble's input to velocity `v` for a step of scale `s`; returns the new velocity. */
export function steer(game: Game, m: Marble, v: Matter.Vector, s: number): Matter.Vector {
  // MP-04: input is per-seat. The local player drives `nudge` (it never crosses a wire); any other
  // human seat is a guest whose intents the host has already applied to `humanInput`.
  const hands = handsOf(game, m);
  if (!hands) return v;
  const grounded = m.grounded < 5;
  // crossing tracks: on a steep or upside-down Workshop rail, steering pushes along the track
  if (hands.nudge !== 0) v = game.track.platformer ? railSteer(game, m, v, hands.nudge, grounded, s) : { x: steerVelocity(v.x, hands.nudge, grounded, s), y: v.y };

  // P2-08: Overdrive: the engine never overheats and pushes half as hard again
  const overdrive = (m.fx?.overdriveUntil ?? 0) > game.time;
  // P2-17: Engine talents: more heat capacity, faster cooling, a shorter lock-out, more thrust
  const fx = m.tfx;
  const tune = fx ? { ...CONTROL_TUNING, engineHeatPerMs: CONTROL_TUNING.engineHeatPerMs / (1 + (fx.engineHeatPct ?? 0) / 100), engineCoolPerMs: CONTROL_TUNING.engineCoolPerMs * (1 + (fx.engineCoolPct ?? 0) / 100), overheatLockMs: CONTROL_TUNING.overheatLockMs * (1 + (fx.overheatLockPct ?? 0) / 100), engineThrust: CONTROL_TUNING.engineThrust * (1 + (fx.thrustPct ?? 0) / 100) } : CONTROL_TUNING;
  const engine = engineStep(m.engine ?? newEngine(), hands.engine, game.time, s * TICK, tune);
  m.engine = overdrive ? { heat: 0, lockedUntil: 0 } : engine.state;
  const push = engineThrust(v.x, v.y, engine.firing || (overdrive && hands.engine), s * (overdrive ? 1.5 : 1), tune);
  v = { x: v.x + push.x, y: v.y + push.y };

  // P2-00: on a platformer, a jump press inside a lane door goes through the door instead.
  if (hands.jump && game.track.platformer && tryDoor(game, m)) hands.jump = false;
  // A jump still counts with a little air under the ball (half its size): only looked for while a press is waiting.
  const waiting = hands.jump || game.time - (m.jumpState?.pressedAt ?? -Infinity) <= CONTROL_TUNING.jumpBufferMs;
  const canJump = grounded || (waiting && !!game.track.platformer && nearGround(game, m));
  const jump = jumpStep(m.jumpState ?? newJump(), game.time, canJump, hands.jump);
  m.jumpState = jump.state;
  if (jump.jump) v = game.track.platformer ? railJump(game, m, v) : { x: v.x, y: Math.min(v.y, -CONTROL_TUNING.jumpSpeed) };
  return v;
}
