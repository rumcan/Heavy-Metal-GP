// Human input: steering, the core jump and the Magic Engine. P2-01 (controls) owns this file.
// The rules (numbers, heat, coyote time) live in ../controls.ts; this applies them to a marble.
import Matter from 'matter-js';
import type { Game, Marble } from '../engine';
import { CONTROL_TUNING, engineStep, engineThrust, jumpStep, newEngine, newJump, steerVelocity } from '../controls';
import { TICK } from '../engine';
import { tryDoor } from './platformer';

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
  if (hands.nudge !== 0) v = { x: steerVelocity(v.x, hands.nudge, grounded, s), y: v.y };

  // P2-08: Overdrive: the engine never overheats and pushes half as hard again
  const overdrive = (m.fx?.overdriveUntil ?? 0) > game.time;
  const engine = engineStep(m.engine ?? newEngine(), hands.engine, game.time, s * TICK);
  m.engine = overdrive ? { heat: 0, lockedUntil: 0 } : engine.state;
  const push = engineThrust(v.x, v.y, engine.firing || (overdrive && hands.engine), s * (overdrive ? 1.5 : 1));
  v = { x: v.x + push.x, y: v.y + push.y };

  // P2-00: on a platformer, a jump press inside a lane door goes through the door instead.
  if (hands.jump && game.track.platformer && tryDoor(game, m)) hands.jump = false;
  const jump = jumpStep(m.jumpState ?? newJump(), game.time, grounded, hands.jump);
  m.jumpState = jump.state;
  if (jump.jump) v = { x: v.x, y: Math.min(v.y, -CONTROL_TUNING.jumpSpeed) };
  return v;
}
