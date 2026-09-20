/**
 * CHAMP-04 branch timing — the ticket's "branch entry -> rejoin" acceptance check.
 *
 *   node --import tsx scripts/champ3/branch.mjs [branch...]
 *
 * The steered full-course runs in `sim.mjs` show *which* line a marble takes, but they cannot force
 * a line: the engine only lets a player nudge while slow or drifting backwards, so a run that falls
 * down the left bank cannot be steered onto the spring line. This harness measures the branches
 * directly instead: snap a marble onto the branch's own floor at the entry lip, give it one fixed
 * entry velocity (the same state for every build), and report the time to the branch's rejoin line.
 * Differences between builds are then physics, not steering — which is what "specialist advantage"
 * means. `oxbowB-skim` / `oxbowB-wade` run the pool at a fast and a slow entry speed so the ticket's
 * "measured skim plus a recoverable wade" pair is reproducible too.
 */
import Matter from 'matter-js';
import { Game } from '../../src/game/engine.ts';
import { buildTrackFromDef } from '../../src/game/trackdef.ts';
import { buildDef } from './def.mjs';
import { BUILDS, roster } from './sim.mjs';

const FRAME = 1000 / 60;
const CAP_MS = 45000;

/** at: a point near the branch's floor (snapped onto the nearest slab). rejoin: branch's merge y. */
export const BRANCHES = {
  sweepA: { at: [250, 790], speed: 320, rejoin: 1090, specialist: 'SPEED', line: 'left ice sweep' },
  springA: { at: [690, 762], speed: 320, rejoin: 1090, specialist: 'BOUNCE', line: 'right spring line / net' },
  oxbowB: { at: [775, 1495], speed: 430, rejoin: 2140, specialist: 'SPEED', line: 'oxbow switchback + pool' },
  'oxbowB-skim': { base: 'oxbowB', speed: 620, line: 'oxbow switchback + pool (fast entry)' },
  'oxbowB-wade': { base: 'oxbowB', speed: 170, line: 'oxbow switchback + pool (slow entry)' },
  burrowB: { at: [430, 1290], speed: 380, rejoin: 2445, specialist: 'BOUNCE', line: 'entry rail + raised root burrow' },
  outsideC: { at: [560, 2510], speed: 380, rejoin: 3295, specialist: 'SPEED', line: 'outside S' },
  rootC: { at: [418, 2590], speed: 340, rejoin: 3295, specialist: 'MASS', line: 'root channel / dry bay' },
};

/** Closest point on a slab's usable surface to `at`, plus that slab's downhill tangent. */
function snap(def, at) {
  let best = null;
  for (const p of def.pieces) {
    if (p.t !== 'ramp' && p.t !== 'ice') continue;
    const [ax, ay] = p.a;
    const [bx, by] = p.b;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 30) continue;
    const t = Math.max(0, Math.min(1, ((at[0] - ax) * dx + (at[1] - ay) * dy) / (len * len)));
    const px = ax + dx * t;
    const py = ay + dy * t;
    const d = Math.hypot(px - at[0], py - at[1]);
    if (!best || d < best.d) {
      const tx = dx / len;
      const ty = dy / len;
      best = { d, px, py, tx, ty, piece: p };
    }
  }
  if (!best) throw new Error('no slab');
  return best;
}

function runBranch(name, buildName) {
  const spec = BRANCHES[name];
  const base = spec.base ? BRANCHES[spec.base] : spec;
  const def = buildDef();
  const track = buildTrackFromDef(def);
  const game = new Game(41004, roster(BUILDS[buildName]), { track, effects: false, aiItems: false, recovery: true });
  game.openGate();
  const m = game.marbles[0];
  const s = snap(def, base.at);
  const speed = spec.speed ?? base.speed;
  // Seat the marble just above the slab's top face, using whichever perpendicular points up.
  let nx = s.ty;
  let ny = -s.tx;
  if (ny > 0) { nx = -nx; ny = -ny; }
  Matter.Body.setPosition(m.body, { x: s.px + nx * 32, y: s.py + ny * 32 });
  // Matter velocities are per-step displacement, so a px/s entry speed is /60 here.
  Matter.Body.setVelocity(m.body, { x: (s.tx * speed) / 60, y: (s.ty * speed) / 60 });

  let t = 0;
  let enteredPool = false;
  let lowest = s.py;
  while (t < CAP_MS && m.body.position.y < base.rejoin) {
    game.step(FRAME);
    t += FRAME;
    lowest = Math.max(lowest, m.body.position.y);
    if (s.piece.t === 'pool' || name.startsWith('oxbowB')) {
      const p = m.body.position;
      if (p.y > 1600 && p.y < 1750 && p.x > 280 && p.x < 600) enteredPool = true;
    }
  }
  const done = m.body.position.y >= base.rejoin;
  return { done, time: done ? Math.round(t) / 1000 : null, x: Math.round(m.body.position.x), recoveries: m.recoveries, enteredPool, lowest: Math.round(lowest) };
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(BRANCHES);
for (const name of names) {
  const spec = BRANCHES[name];
  const base = spec.base ? BRANCHES[spec.base] : spec;
  const rows = Object.keys(BUILDS).map((b) => [b, runBranch(name, b)]);
  const times = rows.filter(([, r]) => r.time !== null).map(([, r]) => r.time);
  const slow = times.length ? Math.max(...times) : 0;
  console.log(`\n${name} — ${spec.line}   entry speed ${spec.speed ?? base.speed}, rejoin y${base.rejoin}, specialist ${base.specialist}`);
  for (const [b, r] of rows) {
    const delta = r.time === null ? 'DNF' : `${r.time === slow ? '' : '-'}${Math.round((1 - r.time / slow) * 1000) / 10}%`;
    console.log(`  ${b === base.specialist ? '*' : ' '}${b.padEnd(9)} ${r.time === null ? '  DNF ' : `${r.time.toFixed(1)}s`}  ${delta.padStart(7)}  rec=${r.recoveries}${name.startsWith('oxbowB') ? ` pool=${r.enteredPool ? 'yes' : 'no '}` : ''} low=${r.lowest}`);
  }
  const specTime = rows.find(([b]) => b === base.specialist)[1].time;
  const others = rows.filter(([b, r]) => b !== base.specialist && b !== 'BALANCED' && r.time !== null);
  if (specTime !== null && others.length) {
    const ref = Math.min(...others.map(([, r]) => r.time));
    console.log(`  * specialist vs best other archetype: ${Math.round((1 - specTime / ref) * 1000) / 10}% quicker`);
  }
}
