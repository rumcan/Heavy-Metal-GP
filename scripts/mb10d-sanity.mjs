// MB-10D launcher/pinball sanity:
//   A) proving-ground TrackDef — every launcher once, three seeds, all ten finish;
//   B) default pool mix — calendar-random cameos, three seeds, all ten finish (integration baseline);
//   C) forced-profile pressure — one launcher repeated for a whole course, two seeds, all ten finish.
// Diagnostics name the straggler and its state when one is left behind.
// Usage: node --import tsx scripts/mb10d-sanity.mjs
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
const provingDef = {
  v: 1, name: 'MB-10D proving ground', seed: 11, theme: 'classic', height: 3300,
  segments: [
    { name: 'Start', y: 0, h: 120 }, { name: 'Cannon', y: 120, h: 520 }, { name: 'Catapult', y: 640, h: 550 },
    { name: 'Flippers', y: 1190, h: 540 }, { name: 'Slings', y: 1730, h: 500 }, { name: 'Scoop', y: 2230, h: 540 }, { name: 'Out', y: 2770, h: 530 },
  ],
  pieces: [
    { t: 'ramp', a: [0, 40], b: [200, 140] },
    { t: 'ramp', a: [0, 150], b: [150, 200] }, { t: 'ramp', a: [150, 250], b: [360, 320] },
    { t: 'cannon', x: 220, y: 256, aimMin: 290, aimMax: 310, power: 12.5, auto: 1500, phase: 0 },
    { t: 'ramp', a: [350, 240], b: [560, 300] }, { t: 'ramp', a: [560, 300], b: [880, 560] },
    { t: 'ramp', a: [360, 320], b: [480, 380] }, { t: 'ramp', a: [480, 380], b: [890, 590] },
    { t: 'ramp', a: [0, 650], b: [150, 880] }, { t: 'ramp', a: [150, 880], b: [330, 980] },
    { t: 'catapult', x: 430, y: 790, len: 240, reload: 1200, dir: 0 },
    { t: 'ramp', a: [310, 920], b: [520, 990] }, { t: 'ramp', a: [520, 990], b: [880, 1090] },
    { t: 'ramp', a: [160, 970], b: [470, 1060] }, { t: 'ramp', a: [470, 1060], b: [890, 1170] },
    { t: 'ramp', a: [0, 1220], b: [260, 1310] }, { t: 'ramp', a: [260, 1310], b: [440, 1395] },
    { t: 'flipper', x: 560, y: 1418, side: 0, len: 124, strength: 1.45, timer: 0, phase: 0 },
    { t: 'ramp', a: [440, 1440], b: [720, 1530] }, { t: 'ramp', a: [720, 1530], b: [890, 1690] },
    { t: 'flipper', x: 740, y: 1546, side: 1, len: 112, strength: 2.4, timer: 1600, phase: 300 },
    { t: 'ramp', a: [0, 1760], b: [300, 1848] },
    { t: 'wall', x: 276, y: 1980, w: 12, h: 280 }, { t: 'wall', x: 560, y: 1980, w: 12, h: 280 },
    { t: 'ramp', a: [300, 2040], b: [420, 2110] },
      { t: 'sling', x: 470, y: 2100, size: 125, facing: 225, strength: 4 },
      { t: 'sling', x: 380, y: 2220, size: 125, facing: 305, strength: 4 },
    { t: 'ramp', a: [340, 2270], b: [890, 2340] },
    { t: 'ramp', a: [0, 2260], b: [260, 2330] }, { t: 'ramp', a: [260, 2330], b: [450, 2410] },
    { t: 'ramp', a: [450, 2410], b: [640, 2480] },
    { t: 'scoop', x: 545, y: 2453, deg: 279, hold: 700 },
    { t: 'ramp', a: [640, 2480], b: [890, 2720] },
    { t: 'scoop', x: 300, y: 2680, deg: 276, hold: 800, exit: [420, 2740, 1400] },
    { t: 'ramp', a: [240, 2760], b: [890, 2800] },
    { t: 'ramp', a: [0, 2860], b: [400, 3030] }, { t: 'ramp', a: [400, 3030], b: [890, 3180] },
  ],
};

let failures = 0;
console.log('— A) proving ground —');
for (const seed of [7, 9001, 424242]) {
  if (!runRace(seed, { def: provingDef }, 240, 'proving')) failures++;
}

console.log('— B) default pool mix —');
for (const seed of [13, 777, 314159]) {
  if (!runRace(seed, { profile: { segments: 11 * CIRCUIT_LENGTH_MULTIPLIER, weights: {}, theme: TRACK_THEMES.classic } }, 300, 'default')) failures++;
}

console.log('— C) forced pressure —');
for (const [name, kind] of [['Cannon Run', 'cannon'], ['Catapult Ledge', 'catapult'], ['Flipper Alley', 'flipper'], ['Sling Chute', 'sling'], ['Scoop Subway', 'scoop']]) {
  for (const seed of [7, 9001]) {
    // calendar cameos cap exposure at ~1-2 a course; this pressures at ~3.
    const weights = { [name]: 6 };
    // pressure rows lean on the marshal now and then: prove termination, not speed
    if (!runRace(seed, { profile: { segments: 11 * CIRCUIT_LENGTH_MULTIPLIER, weights, theme: TRACK_THEMES.classic } }, 420, `${name}/${kind}`)) failures++;
  }
}

if (failures) { console.error(`FAIL: ${failures} run(s) stuck`); process.exit(1); }
console.log('MB-10D sanity: all clear');
