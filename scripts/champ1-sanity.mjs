// CHAMP-02 sanity (issue #86): directed-route + pack simulations of Monte Pipo Street Circuit.
// Everything headless against the real engine — the same code path a race uses.
// Usage: node --import tsx scripts/champ1-sanity.mjs
import { readFileSync } from 'node:fs';
import { Game } from '../src/game/engine.ts';
import { mulberry32, randomStats } from '../src/game/types.ts';

const def = JSON.parse(readFileSync(new URL('../src/game/official-tracks/champ-1.json', import.meta.url), 'utf8'));
const FRAME_MS = 1000 / 60;
const BUILDS = {
  BALANCED: { weight: 5, speed: 5, bounce: 5 },
  SPEED: { weight: 3, speed: 9, bounce: 3 },
  MASS: { weight: 9, speed: 3, bounce: 3 },
  BOUNCE: { weight: 3, speed: 3, bounce: 9 },
};

function roster(seed, stats = null, n = 10) {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, (_, id) => ({
    id,
    name: `M${id}`,
    color: '#fff',
    stats: stats ? { ...stats } : randomStats(rng),
    isPlayer: id === 0,
  }));
}

/** Checkpoint x-positions recorded the first time each marble crosses the line. */
const LINES = [440, 800, 1000, 1280, 1637, 1940, 2200, 2600, 3180];

function telemetry() {
  return { crossed: new Map(), holds: [], recoveries: 0, pegs: new Set(), spots: [] };
}

function runRace(label, seed, { stats = null, n = 10, policy = null, use = null, capS = 240, inventory, aiItems } = {}) {
  const game = new Game(seed, roster(seed, stats, n), {
    def,
    recovery: true,
    effects: false,
    aiItems: aiItems ?? false,
    wireEvents: true,
    inventory,
    onRecover: (id, pos) => { tel.recoveries++; tel.spots.push(`id${id}@(${Math.round(pos.x)},${Math.round(pos.y)})`); if (n === 1) { const mm = game.marbles.find((x) => x.info.id === id); if (mm) console.log(`   [rec] id${id} v=(${mm.body.velocity.x.toFixed(1)},${mm.body.velocity.y.toFixed(1)}) hold=${mm.hold?.kind ?? '-'} stuck=${mm.stuckTime.toFixed(0)}`); } },
  });
  const tel = telemetry();
  const crossedFor = new Map(); // marble id -> Map(line -> {x, t})
  for (const m of game.marbles) crossedFor.set(m.info.id, new Map());
  game.openGate();
  let t = 0;
  let held = 0;
  while (!game.allFinished() && t < capS * 1000) {
    if (policy) {
      const p = game.player;
      game.nudge = policy(p, t, game);
    }
    if (use) use(game, game.player, t);
    game.step(FRAME_MS);
    for (const e of game.drainRaceEvents()) {
      if (e.kind === 'hold' && e.of === 'tunnel') {
        const m = game.marbles[e.seat];
        tel.holds.push({ seat: e.seat, y: m ? Math.round(m.body.position.y) : -1, t: Math.round(t) });
      }
      if (e.kind === 'crate' && e.broken) tel.pegs.add('crumble-broken@' + Math.round(t));
      if (n === 1 && !['sound', 'peg'].includes(e.kind)) console.log(`   [ev] ${e.kind} t=${(t / 1000).toFixed(2)} ${JSON.stringify({ ...e, kind: undefined })}`);
    }
    for (const m of game.marbles) {
      const done = crossedFor.get(m.info.id);
      const y = m.body.position.y;
      for (const line of LINES) {
        if (!done.has(line) && y >= line) done.set(line, { x: Math.round(m.body.position.x), t: +(t / 1000).toFixed(1) });
      }
    }
    t += FRAME_MS;
    if (n === 1 && Math.round(t) % 1000 < FRAME_MS) {
      const m = game.player;
      console.log(`   [tr] t=${(t / 1000).toFixed(0)}s (${m.body.position.x.toFixed(0)},${m.body.position.y.toFixed(0)}) v=(${m.body.velocity.x.toFixed(1)},${m.body.velocity.y.toFixed(1)}) hold=${m.hold?.kind ?? '-'} inv=${JSON.stringify(m.inventory)}`);
    }
  }
  const finished = game.marbles.filter((m) => m.finishedAt !== null);
  const times = game.marbles.map((m) => (m.finishedAt === null ? null : +(m.finishedAt / 1000).toFixed(2)));
  const ok = game.allFinished();
  const med = (arr) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const medFinish = med(times.filter((x) => x !== null));
  const splitMed = {};
  for (const line of LINES) {
    const ts = [];
    for (const [, done] of crossedFor) if (done.has(line)) ts.push(done.get(line).t);
    splitMed[line] = med(ts);
  }
  console.log(`${label} seed=${seed}: ${ok ? 'ALL FINISH' : 'STUCK'} median=${medFinish}s rec=${tel.recoveries}${tel.spots.length ? ' ' + tel.spots.join(' ') : ''} holds=${JSON.stringify(tel.holds)} broken=${[...tel.pegs].join(',') || '-'}`);
  console.log(`   times: ${JSON.stringify(times)}`);
  console.log(`   splits: ${JSON.stringify(splitMed)}`);
  const p0 = crossedFor.get(0);
  console.log(`   M0 route: ${LINES.map((l) => (p0.has(l) ? `y${l}@x${p0.get(l).x}` : `y${l}:MISS`)).join(' ')}`);
  if (!ok) {
    for (const m of game.marbles) {
      if (m.finishedAt === null) {
        const p = m.body.position;
        console.log(`   id=${m.info.id} (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) v=(${m.body.velocity.x.toFixed(1)},${m.body.velocity.y.toFixed(1)}) hold=${m.hold?.kind ?? '-'} stuck=${m.stuckTime.toFixed(0)} rec=${m.recoveries}`);
      }
    }
  }
  return { ok, medFinish, splitMed, tel, times, game };
}

// ------------------------------------------------------------------ policies
// Steer helpers operate while the marble is inside a y-window.
const steer = (m, lo, hi, dir) => (m.body.position.y > lo && m.body.position.y < hi ? dir : 0);

const POLICIES = {
  // Rooftop line: hug left through the fork mouth, then the ice/boost do the work.
  rooftop: (m, t) => steer(m, 460, 760, -1),
  // Warehouse: hug right, stay east of the cargo cut.
  warehouse: (m) => (m.body.position.y > 460 && m.body.position.y < 900 && m.body.position.x < 750 ? 1 : 0),
  // Cargo cut: slip inside the divider, then let the cut channel funnel down.
  cut: (m) => {
    const p = m.body.position;
    if (p.y < 760) return p.x < 600 ? 1 : 0;
    if (p.y < 800) return -0.4;
    return 0;
  },
  // Ferry jump: take the rooftop line (deterministic chamber entry), ride ramp 1,
  // collect the peg at (490,1445) and pop the jump inside the window x490..545.
  ferry: (m) => {
    const p = m.body.position;
    if (p.y > 460 && p.y < 760) return -1;
    if (p.y > 1380 && p.y < 1520 && p.x < 466) return -1; // brake along the run-up so the jump carries ~2 px/step
    return 0;
  },
  // Quay ride: same entry, never jump — roll off the ramp lip and take the catch ramp around.
  quay: (m) => steer(m, 460, 760, -1),
  // Warehouse + steer into the right crane lane for the shock peg.
  shockLane: (m) => {
    const p = m.body.position;
    if (p.y > 460 && p.y < 900 && p.x < 750) return 1;
    if (p.y > 2340 && p.y < 2440 && p.x < 590) return 1;
    return 0;
  },
};

const USE = {
  ferryJump: (game, m) => {
    if (!m || m.finishedAt !== null) return;
    const p = m.body.position;
    if (p.x > 468 && p.x < 542 && p.y > 1400 && p.y < 1510 && m.inventory.jump > 0 && game.canUseItem(m, 'jump')) {
      game.useItem(m, 'jump');
      console.log(`   [ferry] jump used at (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) t=${(game.time / 1000).toFixed(2)}s`);
    }
  },
  shockMace: (game, m) => {
    if (!m || m.finishedAt !== null) return;
    const p = m.body.position;
    if (p.y > 2380 && p.y < 2480 && m.inventory.shock > 0 && game.canUseItem(m, 'shock')) {
      game.useItem(m, 'shock');
      console.log(`   [shock] used at (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) t=${(game.time / 1000).toFixed(2)}s`);
    }
  },
};

const mode = process.argv[2] ?? 'all';

if (mode === 'all' || mode === 'pack') {
  console.log('== 10-marble pack, random builds (acceptance: all finish) ==');
  for (const seed of [42, 7]) runRace('pack', seed, { n: 10 });
  runRace('pack+aiItems', 42, { n: 10, aiItems: true });

  console.log('== specialist packs (all ten the same build) ==');
  for (const [name, stats] of Object.entries(BUILDS)) {
    runRace(name, 42, { stats, n: 10 });
  }
}

if (mode === 'all' || mode === 'directed') {
  console.log('== directed solo routes ==');
  runRace('rooftop/SPEED', 11, { stats: BUILDS.SPEED, n: 1, policy: POLICIES.rooftop, capS: 120 });
  runRace('loft/BOUNCE', 11, { stats: BUILDS.BOUNCE, n: 1, policy: POLICIES.rooftop, capS: 120 });
  runRace('warehouse/BALANCED', 11, { stats: BUILDS.BALANCED, n: 1, policy: POLICIES.warehouse, capS: 120 });
  runRace('cut/MASS', 11, { stats: BUILDS.MASS, n: 1, policy: POLICIES.cut, capS: 120 });
  runRace('cut/SPEED(light)', 11, { stats: BUILDS.SPEED, n: 1, policy: POLICIES.cut, capS: 120 });
  runRace('ferry-jump/BALANCED', 11, { stats: BUILDS.BALANCED, n: 1, policy: POLICIES.ferry, use: USE.ferryJump, capS: 120 });
  runRace('ferry-miss(quay)/BALANCED', 11, { stats: BUILDS.BALANCED, n: 1, policy: POLICIES.quay, capS: 120 });
  runRace('shock-mace/BALANCED', 11, { stats: BUILDS.BALANCED, n: 1, policy: POLICIES.shockLane, use: USE.shockMace, capS: 120 });
  console.log('== same-route specialist comparisons ==');
  runRace('rooftop/BALANCED', 11, { stats: BUILDS.BALANCED, n: 1, policy: POLICIES.rooftop, capS: 120 });
  runRace('cut/BALANCED', 11, { stats: BUILDS.BALANCED, n: 1, policy: POLICIES.cut, capS: 120 });
  runRace('loft/BALANCED(ferry policy)', 11, { stats: BUILDS.BALANCED, n: 1, policy: POLICIES.quay, capS: 120 });
}
