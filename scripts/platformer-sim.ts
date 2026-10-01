// P2-00 dev probe: race a platformer course headless and report how the field got on.
// Run: npx tsx scripts/platformer-sim.ts [seed]
import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { AI_COLORS, AI_NAMES, mulberry32, randomStats, TRACK_THEMES } from '../src/game/types';
import { buildPlatformerTrack } from '../src/game/platformer/build';

const seed = Number(process.argv[2] ?? 1);
const rng = mulberry32(777);
const roster = Array.from({ length: 10 }, (_, i) => ({
  id: i, name: AI_NAMES[i] ?? `AI ${i}`, color: AI_COLORS[i % AI_COLORS.length], stats: randomStats(rng), isPlayer: i === 0, character: i % 6,
}));
const track = buildPlatformerTrack(seed, TRACK_THEMES.forest);
const game = new Game(seed, roster, { track, humanSeats: [] });
// Seat 0 is "the player": give it to the AI too by marking it a remote human that does nothing? No: drive it like the AI.
game.player.info.isPlayer = false;
game.start();
game.openGate();
const plan = track.platformer!.plan;
console.log(`course ${plan.width} px, ${plan.floors.length} floors, ${plan.bumps.length} bumps, ${plan.gates.length} gates, finishX ${plan.finishX}`);
let t = 0;
for (; t < 180000 && !game.allFinished(); t += PHYSICS_STEP) {
  game.step(PHYSICS_STEP);
  if (Math.round(t) % 15000 < PHYSICS_STEP) {
    console.log(`${(t / 1000).toFixed(0)}s`, game.ranking().map((r) => `${r.marble.info.id}:${Math.round(r.marble.progress ?? 0)}/L${r.marble.lane}${r.finished ? 'F' : ''}`).join(' '));
  }
}
console.log('done at', (t / 1000).toFixed(1), 's');
for (const r of game.ranking()) console.log(r.rank, r.marble.info.id, r.finished ? (r.time! / 1000).toFixed(1) + 's' : 'DNF', 'recoveries', r.marble.recoveries);
