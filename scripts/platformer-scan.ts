// P2-00 dev probe: race many seeds headless and print a one-line report per seed (to pick official courses).
// Run: npx tsx scripts/platformer-scan.ts [from] [to]
import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { AI_COLORS, AI_NAMES, mulberry32, randomStats, TRACK_THEMES } from '../src/game/types';
import { buildPlatformerTrack } from '../src/game/platformer/build';

const from = Number(process.argv[2] ?? 1), to = Number(process.argv[3] ?? 20);
for (let seed = from; seed <= to; seed++) {
  const rng = mulberry32(777);
  const roster = Array.from({ length: 10 }, (_, i) => ({ id: i, name: AI_NAMES[i] ?? `AI ${i}`, color: AI_COLORS[i % AI_COLORS.length], stats: randomStats(rng), isPlayer: false, character: i % 6 }));
  const track = buildPlatformerTrack(seed, TRACK_THEMES.forest);
  const game = new Game(seed, roster, { track });
  game.start(); game.openGate();
  const switches = new Map<number, number>();
  let t = 0;
  for (; t < 150000 && !game.allFinished(); t += PHYSICS_STEP) {
    game.step(PHYSICS_STEP);
    for (const m of game.marbles) if (m.laneAt !== undefined && Math.abs(m.laneAt - game.time) < 1) switches.set(m.info.id, (switches.get(m.info.id) ?? 0) + 1);
  }
  const plan = track.platformer!.plan;
  const times = game.finishOrder.map((m) => m.finishedAt! / 1000);
  const rec = game.marbles.reduce((a, m) => a + m.recoveries, 0);
  const sw = [...switches.values()].reduce((a, b) => a + b, 0);
  console.log(`seed ${seed}: gates ${plan.gates.length} (${plan.gates.filter((g) => g.kind === 'door').length} doors) bumps ${plan.bumps.length} drop ${plan.finishY - plan.startY} | finished ${times.length}/10 in ${times[0]?.toFixed(1)}-${times.at(-1)?.toFixed(1)}s, falls ${rec}, lane changes ${sw}`);
}
