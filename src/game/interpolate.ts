// Perf: smooth motion between physics steps. The world steps in fixed 1/120 s slices, but the screen refreshes on its
// own clock (60, 90, 120, 144 Hz, and never exactly on time), so a frame can land one, two or three slices after the
// last one. Drawing the raw positions makes rolling balls judder. Instead each marble is drawn where it was between
// its last two steps, by how far the clock has run into the next slice (`alpha`, 0..1).
import type { Game } from './engine';

interface Pose { x: number; y: number; angle: number }
const before = new WeakMap<object, Pose>();

/** Call just before each `game.step`: remembers where every marble was. */
export function rememberPoses(game: Game): void {
  for (const m of game.marbles) {
    const p = before.get(m.body);
    const { x, y } = m.body.position;
    if (p) { p.x = x; p.y = y; p.angle = m.body.angle; } else before.set(m.body, { x, y, angle: m.body.angle });
  }
}

/** A jump this far in one step is a teleport (respawn, cannon, tunnel): never smeared across. */
const TELEPORT = 120;

/**
 * Put every marble at its in-between pose for drawing, and return a function that puts the real physics poses back.
 * Only the position and angle fields are written (not the vertices), and they are restored before the next step, so
 * the simulation never sees it.
 */
export function blendPoses(game: Game, alpha: number): () => void {
  if (!(alpha > 0 && alpha < 1)) return () => {};
  const saved: [Game['marbles'][number], number, number, number][] = [];
  for (const m of game.marbles) {
    const p = before.get(m.body);
    if (!p || m.hold) continue;
    const { x, y } = m.body.position;
    if (Math.abs(x - p.x) > TELEPORT || Math.abs(y - p.y) > TELEPORT) continue;
    saved.push([m, x, y, m.body.angle]);
    m.body.position.x = p.x + (x - p.x) * alpha;
    m.body.position.y = p.y + (y - p.y) * alpha;
    m.body.angle = p.angle + (m.body.angle - p.angle) * alpha;
  }
  return () => {
    for (const [m, x, y, angle] of saved) { m.body.position.x = x; m.body.position.y = y; m.body.angle = angle; }
  };
}
