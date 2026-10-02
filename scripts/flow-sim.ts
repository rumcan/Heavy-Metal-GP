// P2-00 dev probe: race the Snowline flow course headless.
import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { AI_COLORS, AI_NAMES, mulberry32, randomStats, TRACK_THEMES } from '../src/game/types';
import { buildPlatformerTrack } from '../src/game/platformer/build';

const id = process.argv[2] ?? 'snowline';
const rng = mulberry32(777);
const roster = Array.from({ length: 10 }, (_, i) => ({ id: i, name: AI_NAMES[i] ?? `AI ${i}`, color: AI_COLORS[i % AI_COLORS.length], stats: randomStats(rng), isPlayer: false, character: i % 6 }));
const track = buildPlatformerTrack(1, TRACK_THEMES.forest, id);
const plan = track.platformer!.plan;
console.log(`${id}: ${plan.floors.length} floors, ${plan.bumps.length} rocks, ${plan.gates.length} gates, drop ${Math.round(plan.finishY - plan.startY)}, bodies ${track.bodies.length}`);
const game = new Game(1, roster, { track });
game.start(); game.openGate();
const t0 = Date.now();
let t = 0, maxV = 0;
for (; t < 180000 && !game.allFinished(); t += PHYSICS_STEP) {
  game.step(PHYSICS_STEP);
  for (const m of game.marbles) maxV = Math.max(maxV, Math.hypot(m.body.velocity.x, m.body.velocity.y));
  if (Math.round(t) % 20000 < PHYSICS_STEP) console.log(`${Math.round(t / 1000)}s`, game.ranking().slice(0, 3).map((r) => `${r.marble.info.id}:${Math.round(r.marble.progress ?? 0)}`).join(' '), 'last', Math.round(game.ranking().at(-1)!.marble.progress ?? 0));
}
console.log(`done ${(t / 1000).toFixed(1)}s sim in ${Date.now() - t0}ms wall; max speed ${maxV.toFixed(1)}`);
for (const r of game.ranking()) console.log(r.rank, r.marble.info.id, r.finished ? (r.time! / 1000).toFixed(1) + 's' : 'DNF', 'falls', r.marble.recoveries, 'lane', r.marble.lane);
