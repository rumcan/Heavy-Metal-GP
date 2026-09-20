// CHAMP-05 headless route proofs (dev only).
//
//   node --import tsx scripts/champ-05/sim.mjs                # 10-marble pack
//   node --import tsx scripts/champ-05/sim.mjs --build SPEED  # one specialist
//   node --import tsx scripts/champ-05/sim.mjs --build MASS --items anvil
//   node --import tsx scripts/champ-05/sim.mjs --trace        # per-second positions
//
// Runs the authored def straight through the real Game: no recovery unless the
// flag says so, no AI items, deterministic seed. Reports gate crossing times so
// branch timings can be compared between builds.
import { Game } from '../../src/game/engine.ts';
import { PHYSICS_STEP } from '../../src/game/physics.ts';
import { def } from './def.mjs';

const args = process.argv.slice(2);
const buildName = args.includes('--build') ? args[args.indexOf('--build') + 1] : null;
const trace = args.includes('--trace');
const withRecovery = !args.includes('--no-recovery');

const BUILDS = {
  SPEED: { weight: 3, speed: 9, bounce: 3 },
  MASS: { weight: 9, speed: 3, bounce: 3 },
  BOUNCE: { weight: 3, speed: 3, bounce: 9 },
  BALANCED: { weight: 5, speed: 5, bounce: 5 },
};

const roster = buildName
  ? [{ id: 0, name: buildName, color: '#fff', isPlayer: true, stats: BUILDS[buildName] }]
  : Array.from({ length: 10 }, (_, i) => ({
    id: i, name: `M${i}`, color: '#fff', isPlayer: i === 0,
    stats: BUILDS[[ 'SPEED', 'MASS', 'BOUNCE', 'BALANCED' ][i % 4]],
  }));

const game = new Game(42, roster, { def, recovery: withRecovery, effects: false, aiItems: false });
const gates = [660, 1200, 1620, 2260, 2560, 3080, 3380];
const seen = new Map(game.marbles.map((m) => [m.info.id, { gate: 0, times: [], rec: 0, nudge: 0 }]));
let recoveries = 0;
game.onRecovery = () => { recoveries++; };

game.openGate();
const items = args.includes('--items') ? args[args.indexOf('--items') + 1].split(',') : [];
for (const m of game.marbles) for (const it of items) game.grantItem(m, it);

// ── directed routes: nudge windows + one item use, keyed off marble position.
const route = args.includes('--route') ? args[args.indexOf('--route') + 1] : null;
let jumped = false;
if (route === 'B_LIFT') for (const m of game.marbles) game.grantItem(m, 'jump');
function steer(m, y) {
  if (!route) return 0;
  switch (route) {
    case 'A_LEFT': return y > 620 && y < 780 ? -1 : 0;
    case 'A_RIGHT': return y > 620 && y < 780 ? 1 : 0;
    case 'A_CENTRE': return 0;
    case 'B_LIFT':
      if (!jumped && y > 1380 && y < 1470 && m.body.position.x > 420 && m.body.position.x < 520 && game.useItem(m, 'jump')) jumped = true;
      return 0;
    case 'B_INNER': return y > 1560 && y < 1660 ? 1 : 0;
    case 'B_LONG': return y > 1560 && y < 1660 ? -1 : 0;
    case 'C_LEFT': return y > 2380 && y < 2560 ? -1 : 0;
    case 'C_RIGHT': return y > 2380 && y < 2560 ? 1 : 0;
    default: return 0;
  }
}

const MAX = 90_000;
let lastTrace = 0;
for (let t = 0; t < MAX; t += PHYSICS_STEP) {
  game.nudge = steer(game.player, game.player.body.position.y);
  game.step(PHYSICS_STEP);
  for (const m of game.marbles) {
    const s = seen.get(m.info.id);
    while (s.gate < gates.length && m.body.position.y > gates[s.gate]) { s.times.push(Math.round(t)); s.gate++; }
    if (trace && t - lastTrace >= 1000) {
      console.log(`  t=${(t / 1000).toFixed(0)}s m${m.info.id} (${m.body.position.x.toFixed(0)},${m.body.position.y.toFixed(0)}) v=${Math.hypot(m.body.velocity.x, m.body.velocity.y).toFixed(1)}`);
    }
  }
  if (trace && t - lastTrace >= 1000) lastTrace = t;
  if (game.allFinished()) break;
}

console.log(`seed42 ${buildName ?? 'pack'} recovery=${withRecovery} finished=${game.marbles.filter((m) => m.finishedAt !== null).length}/${game.marbles.length} recoveries=${recoveries}`);
for (const m of game.marbles) {
  const s = seen.get(m.info.id);
  const fin = m.finishedAt === null ? '—' : (m.finishedAt / 1000).toFixed(1);
  console.log(` m${m.info.id} ${m.info.stats.weight}/${m.info.stats.speed}/${m.info.stats.bounce} finish=${fin}s gates=${s.times.map((x) => (x / 1000).toFixed(1)).join(',')} last=(${m.body.position.x.toFixed(0)},${m.body.position.y.toFixed(0)})`);
}
game.destroy();
