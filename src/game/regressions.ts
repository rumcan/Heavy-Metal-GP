import Matter from 'matter-js';
import { Game } from './engine';
import { PHYSICS_STEP, rampSurface } from './physics';
import { CALENDAR, gpSeed, newSeason, recordHeat, computeStandings, computeTeamStandings, gridSlots } from './season';
import { DEFAULT_PROFILE, generateTrack, meta, W } from './track';
import { buildTrackFromDef } from './trackdef';
import type { Track } from './track';
import { AI_COLORS, AI_NAMES, adjustStat, mulberry32, randomStats, statsToPhysics, emptyInventory, ITEM_TYPES, ITEM_INFO } from './types';
import type { MarbleInfo, MarbleStats, Inventory } from './types';

export interface RegressionCheck {
  name: string;
  category: 'Physics' | 'Race safety' | 'Championship' | 'Power-ups';
  run: () => Promise<string>;
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function roster(seed = 42): MarbleInfo[] {
  const rng = mulberry32(seed);
  return Array.from({ length: 10 }, (_, id) => ({
    id, name: id === 0 ? 'You' : AI_NAMES[id - 1],
    color: id === 0 ? '#d63e2e' : AI_COLORS[id - 1],
    stats: randomStats(rng), isPlayer: id === 0,
  }));
}

function ramp(a: Matter.Vector, b: Matter.Vector): Matter.Body {
  const surface = rampSurface(a, b);
  const body = Matter.Bodies.rectangle(
    (a.x + b.x) / 2 - surface.normal.x * 13,
    (a.y + b.y) / 2 - surface.normal.y * 13,
    surface.length + 4, 26,
    { isStatic: true, angle: Math.atan2(surface.tangent.y, surface.tangent.x), label: 'ramp' },
  );
  body.friction = 0.002;
  body.frictionStatic = 0;
  body.plugin = { kind: 'ramp', surface };
  return body;
}

function fixture(obstacles: Matter.Body[], finishY = 1000): Track {
  const gate = Matter.Bodies.rectangle(W / 2, 140, W, 20, { isStatic: true, label: 'gate' });
  gate.plugin = { kind: 'gate' };
  const finish = Matter.Bodies.rectangle(W / 2, finishY, W, 14, { isStatic: true, isSensor: true });
  finish.plugin = { kind: 'finish' };
  const walls = [-20, W + 20].map((x) => Matter.Bodies.rectangle(x, finishY / 2, 40, finishY + 600, { isStatic: true }));
  walls.forEach((body) => { body.plugin = { kind: 'wall' }; });
  return {
    seed: 42, bodies: [gate, finish, ...walls, ...obstacles], height: finishY + 200,
    startY: 116, finishY, gate, segments: [{ name: 'Test fixture', y: 0, h: finishY }],
    spinners: [], turnstiles: [], itemBoxes: [], buckets: [], pegCount: { orange: 0, total: 0 },
    ramps: obstacles.filter((body) => !!meta(body).surface), theme: DEFAULT_PROFILE.theme, decor: [], wreckers: [],
    targetBanks: [],
  };
}

async function simulate(game: Game, ms: number, stopOnFinish = false) {
  const steps = Math.ceil(ms / PHYSICS_STEP);
  for (let tick = 0; tick < steps; tick++) {
    game.step(PHYSICS_STEP);
    if (stopOnFinish && game.allFinished()) break;
    // Yield between batches so the same tests can run in the in-app physics lab.
    if (tick % 1200 === 1199) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

const checks: RegressionCheck[] = [];
function add(name: string, category: RegressionCheck['category'], run: RegressionCheck['run']) {
  checks.push({ name, category, run });
}

for (const angle of [2, 5, 10]) {
  for (const direction of [-1, 1]) {
    add(`${angle}-degree ramp, ${direction === 1 ? 'right' : 'left'} downhill`, 'Physics', async () => {
      const drop = Math.tan(angle * Math.PI / 180) * 800;
      const surfaceBody = direction === 1 ? ramp({ x: 50, y: 300 }, { x: 850, y: 300 + drop }) : ramp({ x: 850, y: 300 }, { x: 50, y: 300 + drop });
      const game = new Game(42, [roster()[0]], { track: fixture([surfaceBody]), effects: false, recovery: false, aiItems: false });
      try {
        const surface = meta(surfaceBody).surface!;
        const x = direction === 1 ? 100 : 800;
        const y = 300 + Math.tan(angle * Math.PI / 180) * 50;
        Matter.Body.setPosition(game.player.body, { x: x + surface.normal.x * 14, y: y + surface.normal.y * 14 });
        game.openGate();
        let elapsed = 0;
        // Measure while still on the ramp, before a fast marble can rebound off the outer wall.
        while (elapsed < 2400 && (game.player.body.position.x - x) * direction < 500) {
          game.step(PHYSICS_STEP);
          elapsed += PHYSICS_STEP;
        }
        const distance = (game.player.body.position.x - x) * direction;
        const speed = Matter.Body.getVelocity(game.player.body).x * direction;
        ensure(distance >= 500, `Only ${distance.toFixed(1)}px in 2.4s; expected 500px.`);
        ensure(speed > 5.5, `Slow rolling: ${speed.toFixed(2)}px/tick.`);
        ensure(game.player.recoveries === 0, 'Ramp test must pass without recovery.');
        return `${distance.toFixed(0)}px in ${(elapsed / 1000).toFixed(2)}s; ${(speed * 6).toFixed(0)} cm/s; no recovery`;
      } finally { game.destroy(); }
    });
  }
}

add('Grid stays level; launch starts from rest', 'Physics', async () => {
  const game = new Game(42, roster(), { track: fixture([]), effects: false });
  try {
    await simulate(game, 2000);
    ensure(game.marbles.every((m) => Math.abs(m.body.position.y - 116) < 0.01), 'Grid did not stay horizontal.');
    ensure(game.raceTime() === 0, 'Countdown was counted in the race clock.');
    game.openGate();
    ensure(game.marbles.every((m) => Matter.Body.getSpeed(m.body) === 0), 'Launch added an artificial kick.');
    game.step(PHYSICS_STEP);
    const first = Matter.Body.getSpeed(game.player.body);
    await simulate(game, 200);
    ensure(first > 0 && first < 0.3, `First-step speed is ${first}.`);
    ensure(Matter.Body.getSpeed(game.player.body) > first * 6, 'Marble did not accelerate under gravity.');
    return '10 aligned marbles; zero launch impulse; gradual gravity acceleration';
  } finally { game.destroy(); }
});

add('A stationary marble is gently nudged off a peg', 'Race safety', async () => {
  const peg = Matter.Bodies.circle(450, 350, 22, { isStatic: true, label: 'peg' });
  peg.plugin = { kind: 'peg', radius: 22 };
  const game = new Game(42, [roster()[0]], { track: fixture([peg]), effects: false });
  try {
    Matter.Body.setPosition(game.player.body, { x: 450, y: 314 });
    game.openGate();
    await simulate(game, 6000, true);
    ensure(game.player.body.position.y > 450, 'Marble remained balanced on the peg.');
    return 'Balanced marble escapes without player input';
  } finally { game.destroy(); }
});

add('A trapped marble receives a safe marshal recovery', 'Race safety', async () => {
  const walls = [
    Matter.Bodies.rectangle(450, 370, 140, 20, { isStatic: true }),
    Matter.Bodies.rectangle(385, 325, 16, 110, { isStatic: true }),
    Matter.Bodies.rectangle(515, 325, 16, 110, { isStatic: true }),
  ];
  walls.forEach((body) => { body.plugin = { kind: 'wall' }; });
  const game = new Game(42, [roster()[0]], { track: fixture(walls), effects: false });
  try {
    Matter.Body.setPosition(game.player.body, { x: 450, y: 340 });
    game.openGate();
    await simulate(game, 14000, true);
    ensure(game.player.recoveries > 0, 'Watchdog did not detect the trap.');
    ensure(game.allFinished(), 'Marble did not finish after recovery.');
    ensure(game.player.trail.length < 15, 'Recovery left an unbounded trail.');
    return `Trap cleared; ${game.player.recoveries} local recovery; finish recorded`;
  } finally { game.destroy(); }
});

add('Freeze duration and oil penalties are respected', 'Race safety', async () => {
  const game = new Game(42, roster().slice(0, 2), { track: fixture([]), effects: false, aiItems: false });
  try {
    game.openGate();
    const m = game.player;
    m.frozenUntil = game.time + 2500;
    game.setFrozen(m, true);
    const initial = { ...m.body.position };
    await simulate(game, 2400);
    ensure(m.frozen && m.body.position.y === initial.y, 'Freeze released early or recovery moved the marble.');
    ensure(m.recoveries === 0 && m.nudges === 0, 'Recovery bypassed a freeze.');
    await simulate(game, 200);
    ensure(!m.frozen && Number.isFinite(m.body.mass), 'Freeze did not restore a finite, dynamic body.');
    game.oils.push({ ...m.body.position, r: 2000, ownerId: 1, expiresAt: game.time + 2000 });
    await simulate(game, 1600);
    ensure(m.inOil && m.recoveries === 0 && m.nudges === 0, 'Recovery cancelled an oil penalty.');
    return '2.5s freeze preserved; oil is not bypassed; mass restored';
  } finally { game.destroy(); }
});

add('High-speed impacts stay inside the pipe', 'Physics', async () => {
  const game = new Game(42, [roster()[0]], { track: fixture([], 3000), effects: false, recovery: false });
  try {
    game.openGate();
    Matter.Body.setPosition(game.player.body, { x: 875, y: 200 });
    Matter.Body.setVelocity(game.player.body, { x: 25, y: 0 });
    for (let i = 0; i < 600; i++) {
      game.step(PHYSICS_STEP);
      const { x, y } = game.player.body.position;
      ensure(Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= W, `Escaped pipe: ${x}, ${y}.`);
    }
    return '600 substeps; no wall tunneling or non-finite positions';
  } finally { game.destroy(); }
});

add('All stat builds retain the 15-point budget', 'Physics', async () => {
  const keys: (keyof MarbleStats)[] = ['weight', 'speed', 'bounce'];
  let assertions = 0;
  for (const key of keys) {
    for (let value = 1; value <= 10; value++) {
      const s = adjustStat({ weight: 5, speed: 5, bounce: 5 }, key, value);
      ensure(s.weight + s.speed + s.bounce === 15, 'Stat budget changed.');
      ensure(keys.every((k) => s[k] >= 1 && s[k] <= 10), 'Stat escaped its limits.');
      const p = statsToPhysics(s);
      ensure(p.mass > 0 && p.frictionAir >= 0 && p.restitution < 1, 'Invalid physics properties.');
      assertions++;
    }
  }
  ensure(gridSlots([0])[0].x === 450, 'Single-marble test grid produced an invalid position.');
  return `${assertions} stat configurations valid`;
});

for (const circuit of CALENDAR) {
  add(`Full field finishes: ${circuit.short}`, 'Race safety', async () => {
    let longest = 0;
    let recoveries = 0;
    for (const seed of [2026, 99, 2147483646]) {
      const game = new Game(gpSeed(seed, circuit.id), roster(seed + circuit.id), { profile: circuit.profile, effects: false });
      try {
        game.openGate();
        await simulate(game, 520000, true);
        const remaining = game.marbles.filter((m) => m.finishedAt === null);
        ensure(remaining.length === 0, `Seed ${seed}: ${remaining.length} stuck: ${remaining.map((m) => `${m.info.name}@${Math.round(m.body.position.y)} (${m.recoveries} recoveries)`).join(', ')}.`);
        ensure(new Set(game.finishOrder.map((m) => m.info.id)).size === 10, 'Finish entries are missing or duplicated.');
        ensure(game.marbles.every((m) => Number.isFinite(m.body.position.x)), 'Non-finite marble position.');
        longest = Math.max(longest, game.raceTime());
        recoveries += game.marbles.reduce((sum, m) => sum + m.recoveries, 0);
      } finally { game.destroy(); }
    }
    return `3 layouts; 30/30 finished; longest heat ${(longest / 1000).toFixed(1)}s; ${recoveries} local recoveries`;
  });
}

add('Procedural tracks preserve all signature features', 'Race safety', async () => {
  for (let seed = 1; seed <= 24; seed++) {
    const track = generateTrack(seed, CALENDAR[seed % CALENDAR.length].profile);
    const names = track.segments.map((s) => s.name);
    for (const name of ['Foundry Cut', 'Spring Exchange', 'Smuggler Run', 'Sky Ferry', 'Peg Bank', 'Crane Yard']) ensure(names.some(n => n.startsWith(name)), `Seed ${seed} is missing ${name}.`);
    for (const body of track.ramps) ensure(meta(body).surface!.normal.y < 0, 'Ramp surface is inverted.');
  }
  return '24 seeds; correct ramp normals and all six specialist route sectors';
});

add('MB-10D launchers: the whole field rides every toy', 'Race safety', async () => {
  // The proving-ground circuit: each MB-10D piece exactly once on its tuned geometry (felt
  // segment positions, mirrored in scripts/mb10d-sanity.mjs). Exercises the TrackDef schema,
  // the validator, the builders, the holds and their releases as one machine.
  const def = {
    v: 1, name: 'MB-10D proving ground', seed: 11, theme: 'classic', height: 3300,
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
  buildTrackFromDef(def); // throws on a schema validator bug before the race even starts
  const totals: Record<string, number> = {};
  for (const seed of [7, 9001, 424242]) {
    const game = new Game(seed, roster(seed), { def, recovery: true, effects: false, aiItems: false, wireEvents: true });
    try {
      game.openGate();
      let t = 0;
      while (!game.allFinished() && t < 240000) {
        game.step(1000 / 60);
        for (const e of game.drainRaceEvents()) {
          if (e.kind === 'hold') totals['hold:' + (e.of ?? 'tunnel')] = (totals['hold:' + (e.of ?? 'tunnel')] ?? 0) + 1;
          if (e.kind === 'flipper' || e.kind === 'sling') totals[e.kind] = (totals[e.kind] ?? 0) + 1;
        }
        t += 1000 / 60;
      }
      ensure(game.allFinished(), `Seed ${seed} left the field waiting past 240s.`);
    } finally { game.destroy(); }
  }
  for (const need of ['hold:cannon', 'hold:catapult', 'hold:scoop', 'flipper', 'sling']) {
    ensure((totals[need] ?? 0) > 0, `Launcher ${need} never fired across the three seeds.`);
  }
  return `3 seeds on the proving ground; rides ${JSON.stringify(totals)}`;
});

add('MB-10E fields: every field fires and nobody drowns', 'Race safety', async () => {
  // Proving-ground circuit: each MB-10E field once on the exact geometry the segments ship
  // (mirrored in scripts/mb10e-sanity.mjs). Exercises the schema, the builders, the clock
  // programs, and proves the whole field creams through: no stick, no drown, no stall.
  const def = {
    v: 1, name: 'MB-10E proving ground', seed: 11, theme: 'classic', height: 2900,
    pieces: [
      { t: 'ramp', a: [0, 40], b: [300, 150] },
      { t: 'ramp', a: [300, 150], b: [360, 180] },
      { t: 'wind', a: [360, -20], b: [560, 320], dir: 300, str: 0.36, pulse: 2800, phase: 0 },
      { t: 'ramp', a: [560, 160], b: [880, 330] },
      { t: 'ramp', a: [60, 320], b: [890, 440] },
      { t: 'ramp', a: [0, 520], b: [470, 710] },
      { t: 'wall', x: 845, y: 800, w: 14, h: 250 },
      { t: 'magnet', x: 700, y: 760, r: 175, str: 5, period: 0, phase: 0 },
      { t: 'ramp', a: [470, 710], b: [120, 850] },
      { t: 'wall', x: 30, y: 940, w: 14, h: 210 },
      { t: 'magnet', x: 190, y: 940, r: 175, str: 5, period: 4600, phase: 600 },
      { t: 'ramp', a: [120, 850], b: [660, 1010] },
      { t: 'ramp', a: [660, 1010], b: [880, 1120] },
      { t: 'ramp', a: [0, 1230], b: [260, 1340] },
      { t: 'mud', a: [120, 1307], b: [380, 1405], drag: 0.3 },
      { t: 'ramp', a: [260, 1340], b: [560, 1500] },
      { t: 'mud', a: [430, 1446], b: [700, 1564], drag: 0.3 },
      { t: 'ramp', a: [560, 1500], b: [890, 1670] },
      { t: 'ramp', a: [0, 1830], b: [240, 1950] },
      { t: 'pool', a: [290, 1970], b: [620, 1970], depth: 96, skip: 6.5 },
      { t: 'ramp', a: [634, 1986], b: [880, 2140] },
      { t: 'ramp', a: [240, 1990], b: [330, 2030] },
      { t: 'ramp', a: [0, 2230], b: [300, 2380] },
      { t: 'ramp', a: [300, 2380], b: [400, 2410] },
      { t: 'geyser', x: 430, y: 2408, h: 260, period: 3500, phase: 0 },
      { t: 'ramp', a: [460, 2424], b: [530, 2450] },
      { t: 'geyser', x: 560, y: 2442, h: 260, period: 3700, phase: 900 },
      { t: 'ramp', a: [590, 2466], b: [660, 2490] },
      { t: 'geyser', x: 690, y: 2480, h: 260, period: 3900, phase: 1700 },
      { t: 'ramp', a: [720, 2498], b: [890, 2620] },
      { t: 'ramp', a: [0, 2660], b: [890, 2820] },
    ],
  };
  buildTrackFromDef(def); // throws on a schema validator bug before the race even starts
  const cues: Record<string, number> = {};
  for (const seed of [7, 9001, 424242]) {
    const game = new Game(seed, roster(seed), { def, recovery: true, effects: false, aiItems: false, wireEvents: true });
    try {
      game.openGate();
      let t = 0;
      while (!game.allFinished() && t < 300000) {
        game.step(1000 / 60);
        for (const e of game.drainRaceEvents()) {
          if (e.kind === 'sound' && e.cue) cues[e.cue] = (cues[e.cue] ?? 0) + 1;
        }
        t += 1000 / 60;
      }
      ensure(game.allFinished(), `Seed ${seed} left the field waiting past 300s.`);
    } finally { game.destroy(); }
  }
  // every cue-bearing field must have fired at least once across the seeds
  for (const need of ['steam', 'gurgle', 'zap', 'splash']) {
    ensure((cues[need] ?? 0) > 0, `Field cue '${need}' never fired across the three seeds.`);
  }
  return `3 seeds on the fields ground; cues ${JSON.stringify({ steam: cues.steam ?? 0, gurgle: cues.gurgle ?? 0, zap: cues.zap ?? 0, splash: cues.splash ?? 0 })}`;
});

add('MB-10F set pieces: every big toy fires and nobody is penned', 'Race safety', async () => {
  // Proving-ground circuit: each MB-10F set piece once on tuned geometry. Asserts the wire
  // events move too: target pins drop and re-arm, the turnstile ratchets, the vortex drops.
  // (The calendar-scale pressure for these pieces lives in scripts/mb10f-sanity.mjs.)
  const def = {
    v: 1, name: 'MB-10F proving ground', seed: 11, theme: 'classic', height: 3100,
    pieces: [
      { t: 'ramp', a: [0, 40], b: [300, 160] },
      { t: 'trampoline', x: 390, y: 260, w: 175, tension: 1.3 },
      { t: 'ramp', a: [60, 340], b: [880, 450] },
      { t: 'ramp', a: [540, 170], b: [880, 300] },
      { t: 'ramp', a: [0, 520], b: [470, 710] },
      { t: 'turnstile', x: 455, y: 686, arms: 4, r: 78, mode: 0, period: 0, phase: 0 },
      { t: 'ramp', a: [470, 710], b: [180, 880] },
      { t: 'turnstile', x: 200, y: 856, arms: 3, r: 88, mode: 1, period: 4200, phase: 400 },
      { t: 'ramp', a: [180, 880], b: [880, 1040] },
      // The pack leaves the second turnstile riding the right-hand wall, so the drop-target bank
      // used to sit on a ledge on the far side of the pipe that no marble ever rolled across: the
      // pins never fired and this check failed on every seed. This switchback catches the wall
      // riders and carries them left, over the bank, and on into the vortex bowl.
      { t: 'ramp', a: [880, 1060], b: [340, 1200] },
      { t: 'targets', x: 600, y: 1133, count: 4, reset: 5600 },
      { t: 'ramp', a: [520, 1276], b: [890, 1410] },
      { t: 'ramp', a: [0, 1500], b: [880, 1780] },
      { t: 'vortex', x: 560, y: 1660, r: 175, spin: 1.4, hole: 34 },
      { t: 'ramp', a: [0, 1910], b: [880, 2050] },
      { t: 'ramp', a: [0, 2150], b: [380, 2310] },
      { t: 'ramp', a: [560, 2310], b: [880, 2460] },
      { t: 'platform', ax: 405, ay: 2346, bx: 535, by: 2346, w: 130, travel: 2400, pause: 1600, phase: 0 },
      { t: 'ramp', a: [60, 2540], b: [890, 2640] },
      { t: 'ramp', a: [0, 2700], b: [890, 3010] },
    ],
  };
  buildTrackFromDef(def); // throws on a schema validator bug before the race even starts
  const events: Record<string, number> = {};
  for (const seed of [7, 9001, 424242]) {
    const game = new Game(seed, roster(seed), { def, recovery: true, effects: false, aiItems: false, wireEvents: true });
    try {
      game.openGate();
      let t = 0;
      while (!game.allFinished() && t < 360000) {
        game.step(1000 / 60);
        for (const e of game.drainRaceEvents()) {
          events[e.kind] = (events[e.kind] ?? 0) + 1;
          if (e.kind === 'sound' && e.cue) events['cue:' + e.cue] = (events['cue:' + e.cue] ?? 0) + 1;
        }
        t += 1000 / 60;
      }
      ensure(game.allFinished(), `Seed ${seed} left the field waiting past 360s.`);
    } finally { game.destroy(); }
  }
  for (const need of ['targets', 'turnstile']) {
    ensure((events[need] ?? 0) > 0, `Event '${need}' never fired across the three seeds.`);
  }
  for (const need of ['cue:boing', 'cue:whoosh']) {
    ensure((events[need] ?? 0) > 0, `Cue '${need}' never fired across the three seeds.`);
  }
  return `3 seeds on the set pieces; events ${JSON.stringify(Object.fromEntries(Object.entries(events).filter(([k]) => ['targets', 'turnstile', 'cue:boing', 'cue:whoosh', 'cue:crank', 'cue:ding', 'cue:bonus'].includes(k))))}`;
});

add('Three heats use one seed and advance the championship once', 'Championship', async () => {
  let season = newSeason(roster());
  const seed = gpSeed(season.seed, 0);
  const heat = roster().map((m, i) => ({ id: m.id, rank: i + 1, time: 30000 + i * 500, pegs: 0 }));
  for (let i = 0; i < 3; i++) {
    ensure(gpSeed(season.seed, season.round) === seed, 'Track changed inside a Grand Prix.');
    season = recordHeat(season, heat);
  }
  ensure(season.round === 1 && season.heat === 0, 'GP did not advance after exactly three heats.');
  const drivers = computeStandings(season);
  ensure(drivers[0].points === 76, `Winner should earn 3x25+1, got ${drivers[0].points}.`);
  const teams = computeTeamStandings(drivers);
  ensure(teams[0].points === 76 + 54, 'Constructor points are incorrect.');
  return '3 heats; identical circuit; 76 winner points; 130 constructor points';
});

add('Even the slowest builds accelerate on shallow slopes', 'Physics', async () => {
  const builds: MarbleStats[] = [
    { weight: 10, speed: 1, bounce: 4 }, { weight: 4, speed: 1, bounce: 10 },
    { weight: 1, speed: 10, bounce: 4 }, { weight: 5, speed: 5, bounce: 5 },
  ];
  for (const stats of builds) {
    const body = ramp({ x: 50, y: 300 }, { x: 850, y: 370 });
    const game = new Game(42, [{ ...roster()[0], stats }], { track: fixture([body]), recovery: false, effects: false });
    try {
      Matter.Body.setPosition(game.player.body, { x: 100, y: 290 });
      game.openGate();
      await simulate(game, 1400);
      ensure(game.player.body.position.x > 340, `Build ${JSON.stringify(stats)} crawled on a 5-degree slope.`);
      ensure(game.player.recoveries === 0, 'Test used recovery.');
    } finally { game.destroy(); }
  }
  return 'Heavy, bouncy, fast and balanced builds all cover at least 240px in 1.4s';
});

add('Crowded funnels keep colliding marbles moving', 'Race safety', async () => {
  const game = new Game(42, roster(), { track: fixture([
    ramp({ x: 0, y: 280 }, { x: 405, y: 420 }),
    ramp({ x: 900, y: 280 }, { x: 495, y: 420 }),
  ]), effects: false, aiItems: false });
  let collisions = 0;
  Matter.Events.on(game.engine, 'collisionStart', (event: Matter.IEventCollision<Matter.Engine>) => {
    collisions += event.pairs.filter((p) => p.bodyA.label === 'marble' && p.bodyB.label === 'marble').length;
  });
  try {
    game.openGate();
    await simulate(game, 16000, true);
    ensure(game.allFinished(), 'The crowded funnel did not clear.');
    ensure(collisions >= 5, `Only ${collisions} marble-to-marble collisions; fixture was not crowded.`);
    return `${collisions} marble collisions; 10/10 safely through the funnel`;
  } finally { game.destroy(); }
});

add('Flat floors do not generate artificial acceleration', 'Physics', async () => {
  const floor = ramp({ x: 0, y: 300 }, { x: 900, y: 300 });
  const game = new Game(42, [roster()[0]], { track: fixture([floor]), recovery: false, effects: false });
  try {
    Matter.Body.setPosition(game.player.body, { x: 450, y: 286 });
    game.openGate();
    await simulate(game, 1200);
    ensure(Math.abs(game.player.body.position.x - 450) < 3, 'A flat floor accelerated the marble.');
    Matter.Body.setVelocity(game.player.body, { x: 6, y: 0 });
    await simulate(game, 600);
    ensure(game.player.body.position.x > 600, 'Flat rolling lost too much momentum.');
    return 'No spontaneous acceleration; existing rolling momentum is retained';
  } finally { game.destroy(); }
});

add('Out-of-bounds marbles return to a clear local position', 'Race safety', async () => {
  const game = new Game(42, [roster()[0]], { track: fixture([]), effects: false });
  try {
    game.openGate();
    Matter.Body.setPosition(game.player.body, { x: W + 100, y: 400 });
    await simulate(game, 3000, true);
    ensure(game.player.recoveries === 1 && game.allFinished(), 'Out-of-bounds recovery failed.');
    ensure(game.player.body.position.x >= 0 && game.player.body.position.x <= W, 'Recovery placed the marble outside the pipe.');
    return 'Safe in-bounds recovery followed by a real finish-line crossing';
  } finally { game.destroy(); }
});

add('Anvil mass expires correctly, even while frozen', 'Physics', async () => {
  const game = new Game(42, [roster()[0]], { track: fixture([], 10000), effects: false });
  try {
    game.openGate();
    const m = game.player;
    const mass = m.body.mass;
    m.inventory.anvil = 1;
    game.usePlayerItem();
    ensure(Math.abs(m.body.mass - mass * 3) < 1e-6, 'Anvil did not triple mass.');
    m.frozenUntil = game.time + 6500;
    game.setFrozen(m, true);
    await simulate(game, 6800);
    ensure(!m.frozen && Math.abs(m.body.mass - mass) < 1e-6, 'Expired anvil retained incorrect mass after thaw.');
    return '3x mass during anvil; exact base mass after thaw';
  } finally { game.destroy(); }
});

add('DNFs score zero and malformed classifications are rejected', 'Championship', async () => {
  const initial = newSeason(roster());
  const heat = roster().map((m, i) => ({ id: m.id, rank: i + 1, time: i === 9 ? null : 30000 + i * 500, pegs: 0 }));
  const next = recordHeat(initial, heat);
  ensure(computeStandings(next).find((s) => s.id === 9)?.points === 0, 'A DNF earned championship points.');
  ensure(initial.results[0].length === 0, 'Recording a heat mutated the original season.');
  let rejected = false;
  try { recordHeat(initial, [heat[0], ...heat.slice(0, 9)]); } catch { rejected = true; }
  ensure(rejected, 'Duplicate marble IDs were accepted.');
  return 'No points for non-finishers; immutable recording; duplicate classification rejected';
});

add('Bought and collected power-ups share one inventory without overwriting', 'Power-ups', async () => {
  const game = new Game(42, [roster()[0]], { track: fixture([], 30000), effects: false, inventory: { rocket: 2, jump: 1 } });
  let saved: Inventory = emptyInventory();
  game.onInventoryChange = (inventory) => { saved = inventory; };
  try {
    game.grantItem(game.player, 'jump');
    game.grantItem(game.player, 'oil');
    ensure(game.player.inventory.rocket === 2 && game.player.inventory.jump === 2 && game.player.inventory.oil === 1, 'A pickup replaced a bought charge.');
    ensure(saved.rocket === 2 && saved.jump === 2, 'Inventory change was not reported for persistence.');
    game.openGate();
    ensure(game.usePlayerItem('jump'), 'Selected jump could not be used.');
    ensure(Number(game.player.inventory.jump) === 1 && Number(saved.jump) === 1, 'Using jump did not consume exactly one charge.');
    ensure(game.player.inventory.rocket === 2 && game.player.inventory.oil === 1, 'Using jump consumed another item.');
    ensure(!game.usePlayerItem('oil'), 'Global cooldown did not stop a double use.');
    await simulate(game, 500);
    ensure(game.usePlayerItem('oil'), 'Different item could not be deployed after the cooldown.');
    return 'Bought + picked-up stacks preserved; only the chosen charge is spent and saved';
  } finally { game.destroy(); }
});

add('Every timed item expires and restores normal physics', 'Power-ups', async () => {
  for (const item of ['rocket', 'jump', 'anvil', 'aero', 'ghost'] as const) {
    const game = new Game(42, [roster()[0]], { track: fixture([], 30000), effects: false, inventory: { [item]: 2 } });
    try {
      game.openGate();
      Matter.Body.setVelocity(game.player.body, { x: 4, y: 1 });
      const mass = game.player.body.mass;
      const drag = game.player.body.frictionAir;
      ensure(game.usePlayerItem(item), `${item} did not deploy.`);
      ensure(game.itemRemaining(game.player, item) > 0, `${item} has no timer.`);
      ensure(!game.usePlayerItem(item) && game.player.inventory[item] === 1, 'An active item was spent again.');
      if (item === 'jump') ensure(game.player.body.velocity.y < -10 && Math.abs(game.player.body.velocity.x - 4) < 0.01, 'Jump lost lateral momentum or did not launch.');
      if (item === 'aero') ensure(game.player.body.frictionAir < drag * 0.051 && game.player.body.friction === 0, 'Drag did not decrease by 95%.');
      if (item === 'anvil') ensure(Math.abs(game.player.body.mass - mass * 3) < 1e-5, 'Heavy metal did not triple mass.');
      if (item === 'ghost') ensure((game.player.body.collisionFilter.mask! & 2) === 0, 'Ghost still collides with rivals.');
      await simulate(game, ITEM_INFO[item].duration + 100);
      ensure(game.itemRemaining(game.player, item) === 0, `${item} never expired.`);
      ensure(Math.abs(game.player.body.mass - mass) < 1e-5, 'Mass was not restored.');
      ensure(Math.abs(game.player.body.frictionAir - drag) < 1e-8, 'Drag was not restored.');
      ensure((game.player.body.collisionFilter.mask! & 2) !== 0, 'Ghost collision mask was not restored.');
    } finally { game.destroy(); }
  }
  return 'Boost, jump, mass, drag and ghost timers validated; charges cannot be wasted while active';
});

add('Glowing pegs bounce, give their marked item once, then disappear', 'Power-ups', async () => {
  const peg = Matter.Bodies.circle(450, 350, 13, { isStatic: true, label: 'ppeg' });
  peg.restitution = 0.42;
  peg.plugin = { kind: 'ppeg', pegColor: 'green', itemDrop: 'aero', radius: 13, hit: false, hitAt: 0 };
  const game = new Game(42, [roster()[0]], { track: fixture([peg]), effects: false });
  try {
    game.openGate();
    await simulate(game, 1600);
    ensure(meta(peg).hit && meta(peg).destroyed, 'Peg did not pop away on contact.');
    ensure(!Matter.Composite.allBodies(game.world).includes(peg), 'Popped peg remains in the solver.');
    ensure(game.player.inventory.aero === 1, 'Marked pickup missing or granted more than once.');
    return 'Marked slipstream charge collected exactly once; popped peg removed';
  } finally { game.destroy(); }
});

add('Freeze without a target, empty slots, and the start grid never spend a charge', 'Power-ups', async () => {
  const game = new Game(42, [roster()[0]], { track: fixture([], 30000), effects: false, inventory: { freeze: 1, rocket: 1 } });
  try {
    ensure(!game.usePlayerItem('rocket') && game.player.inventory.rocket === 1, 'Grid input spent a boost.');
    game.openGate();
    ensure(!game.usePlayerItem('freeze') && game.player.inventory.freeze === 1, 'No-target freeze spent a charge.');
    ensure(!game.usePlayerItem('oil') && game.player.inventory.oil === 0, 'Empty slot deployed.');
    game.player.frozenUntil = game.time + 2000;
    game.setFrozen(game.player, true);
    ensure(!game.usePlayerItem('rocket') && game.player.inventory.rocket === 1, 'Frozen marble deployed a charge.');
    return 'Charges kept on invalid input; no inventory can go negative';
  } finally { game.destroy(); }
});

add('All six circuits have compact connected chapters with deliberate item supplies', 'Race safety', async () => {
  for (const gp of CALENDAR) {
    const track = generateTrack(1234, gp.profile);
    ensure(track.segments.length - 4 === Math.max(8, Math.min(14, Math.round(gp.profile.segments / 3))), 'Unexpected chapter count.');
    ensure(track.finishY > 7000 && track.finishY < 14000, 'Course length is outside the compact race budget.');
    ensure(track.pegCount.total > 20 && track.pegCount.total < 200, `Unexpected peg density on ${gp.short}.`);
    const glowing = track.bodies.filter((b) => meta(b).pegColor === 'green');
    ensure(glowing.length >= 8, 'Not enough glowing pickup pegs.');
    ensure(glowing.every((b) => meta(b).itemDrop && ITEM_TYPES.includes(meta(b).itemDrop!)), 'Glowing peg has no valid item.');
    const repeated = generateTrack(1234, gp.profile);
    ensure(track.finishY === repeated.finishY && track.pegCount.total === repeated.pegCount.total, 'Same heat seed changed the track.');
    const game = new Game(1234, roster(), { track, effects: false });
    try {
      const active = Matter.Composite.allBodies(game.world).length;
      ensure(track.bodies.length <= 350 ? active <= track.bodies.length + 10 : active < track.bodies.length / 2,
        'Physics body budget exceeded; large courses must stream distant geometry.');
    } finally { game.destroy(); }
  }
  return '8-14 connected chapters, deliberate item supplies and streamed physics';
});

export const regressionChecks: readonly RegressionCheck[] = checks;