// Human input: how a held left/right steers the marble. P2-01 (controls) owns this file.
// Split out of engine.ts (P2-00a).
import Matter from 'matter-js';
import type { Game, Marble } from '../engine';

/** Apply this marble's steering input to velocity `v` for a step of scale `s`; returns the new velocity. */
export function steer(game: Game, m: Marble, v: Matter.Vector, s: number): Matter.Vector {
  // MP-04: input is per-seat now. The local player drives `nudge` (it never
  // crosses a wire); any other human seat is a guest whose intents the host
  // has already applied to `humanInput`.
  const nudge = game.humanInput.get(m.info.id)?.nudge ?? (m === game.player ? game.nudge : 0);
  if (nudge !== 0 && (Math.abs(v.x) < 9 || Math.sign(v.x) !== Math.sign(nudge))) v = { x: v.x + nudge * 0.16 * s, y: v.y };
  return v;
}
