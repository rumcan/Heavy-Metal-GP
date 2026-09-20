// calibration probe: free fall + ramp roll speeds
import { Game } from '../../src/game/engine.ts';
import { buildTrackFromDef } from '../../src/game/trackdef.ts';

const FRAME = 1000 / 60;
const stats = (w, s, b) => ({ weight: w, speed: s, bounce: b });

function roster(st) {
  return Array.from({ length: 1 }, (_, id) => ({ id, name: 'P', color: '#fff', stats: st, isPlayer: true }));
}

function run(def, st, capMs = 120000) {
  const track = buildTrackFromDef(def);
  const game = new Game(1, roster(st), { track, effects: false, aiItems: false, recovery: false });
  game.openGate();
  const trace = [];
  let t = 0;
  while (!game.allFinished() && t < capMs) {
    game.step(FRAME);
    t += FRAME;
    if (trace.length < 4 || t % 1000 < FRAME) trace.push([Math.round(t / 1000), Math.round(game.marbles[0].body.position.x), Math.round(game.marbles[0].body.position.y), +game.marbles[0].body.velocity.x.toFixed(1), +game.marbles[0].body.velocity.y.toFixed(1)]);
  }
  return { finish: game.marbles[0].finishedAt, trace };
}

// 1) free fall in an empty column
const free = {
  v: 1, name: 'probe free fall', seed: 1, theme: 'forest', height: 2000,
  pieces: [
    { t: 'ramp', a: [0, 200], b: [430, 230] },
    { t: 'ramp', a: [470, 230], b: [900, 260] },
  ],
};
console.log('free fall:', JSON.stringify(run(free, stats(5, 5, 5), 40000).trace.slice(0, 12)));

// 2) steep chute ramps
const chute = { v: 1, name: 'probe chute', seed: 1, theme: 'forest', height: 2000, pieces: [
  { t: 'ramp', a: [0, 200], b: [880, 320] },
  { t: 'ramp', a: [880, 400], b: [20, 560] },
  { t: 'ramp', a: [20, 640], b: [880, 800] },
  { t: 'ramp', a: [880, 880], b: [20, 1040] },
  { t: 'ramp', a: [20, 1120], b: [880, 1280] },
]};
console.log('chute shallow:', JSON.stringify(run(chute, stats(5, 5, 5), 40000).trace.slice(0, 14)));

// 3) very steep chute
const steep = { v: 1, name: 'probe steep', seed: 1, theme: 'forest', height: 2000, pieces: [
  { t: 'ramp', a: [80, 200], b: [500, 700] },
  { t: 'ramp', a: [520, 720], b: [860, 1200] },
  { t: 'ramp', a: [40, 1220], b: [500, 1700] },
]};
console.log('steep chute:', JSON.stringify(run(steep, stats(5, 5, 5), 40000).trace.slice(0, 16)));
