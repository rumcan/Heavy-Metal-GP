// MB-10E force-field sanity:
//   B) default pool mix: calendar-random cameos, three seeds, all ten finish;
//   C) forced-profile pressure: one field repeated for a whole course, two seeds, all ten finish.
 // The proving-ground def rides along later, with editor pieces in hand.
// Diagnostics name the straggler and its state when one is left behind.
// Usage: node --import tsx scripts/mb10e-sanity.mjs
import { Game } from '../src/game/engine.ts';
import { mulberry32, randomStats, TRACK_THEMES, CIRCUIT_LENGTH_MULTIPLIER } from '../src/game/types.ts';

const FRAME_MS = 1000 / 60;

function roster(seed) {
  const rng = mulberry32(seed);
  return Array.from({ length: 10 }, (_, id) => ({
    id,
    name: `M${id}`,
    color: '#fff',
    stats: randomStats(rng),
    isPlayer: false,
  }));
}

function runRace(seed, opts, capS, label) {
  const game = new Game(seed, roster(seed), { ...opts, recovery: true, effects: true, aiItems: false, wireEvents: true });
  game.openGate();
  const counts = {};
  let t = 0;
  while (!game.allFinished() && t < capS * 1000) {
    game.step(FRAME_MS);
    for (const e of game.drainRaceEvents()) {
      counts[e.kind] = (counts[e.kind] ?? 0) + 1;
      if (e.kind === 'hold') counts['hold:' + (e.of ?? 'tunnel')] = (counts['hold:' + (e.of ?? 'tunnel')] ?? 0) + 1;
    }
    t += FRAME_MS;
  }
  const ok = game.allFinished();
  console.log(`${label} seed=${seed}: ${ok ? 'ok ' + (t / 1000).toFixed(1) + 's' : 'STUCK'} ${JSON.stringify(counts)}`);
  if (!ok) {
    for (const m of game.marbles) {
      if (m.finishedAt === null) {
        const p = m.body.position;
        console.log(`   id=${m.info.id} (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) v=(${m.body.velocity.x.toFixed(1)},${m.body.velocity.y.toFixed(1)}) hold=${m.hold?.kind ?? '-'} stuck=${m.stuckTime.toFixed(0)} rec=${m.recoveries}`);
      }
    }
  }
  return ok;
}

// ---- A) proving ground: each launcher exactly once ----
let failures = 0;
console.log('— B) default pool mix —');
for (const seed of [13, 777, 314159]) {
  if (!runRace(seed, { profile: { segments: 11 * CIRCUIT_LENGTH_MULTIPLIER, weights: {}, theme: TRACK_THEMES.classic } }, 300, 'default')) failures++;
}

console.log('— C) forced pressure —');
for (const [name, kind] of [['Fan Garden', 'wind'], ['Lodestone Way', 'magnet'], ['Tar Flats', 'mud'], ['Skipping Pools', 'pool'], ['Vent Field', 'geyser']]) {
  for (const seed of [7, 9001]) {
    // calendar cameos cap exposure at ~1-2 a course; this pressures at ~3.
    const weights = { [name]: 6 };
    // pressure rows lean on the marshal now and then: prove termination, not speed
    if (!runRace(seed, { profile: { segments: 11 * CIRCUIT_LENGTH_MULTIPLIER, weights, theme: TRACK_THEMES.classic } }, 420, `${name}/${kind}`)) failures++;
  }
}

if (failures) { console.error(`FAIL: ${failures} run(s) stuck`); process.exit(1); }
console.log('MB-10E sanity: all clear');
