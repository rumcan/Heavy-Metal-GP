// MB-10E — fields and surfaces.
//
// Targeted tests for the five new pieces: schema validation bounds, the
// share-code round trip (append-only rows wind/magnet/mud/pool/geyser), the
// builder metadata a guest engine replays, and two live probes of the field
// forces (magnet latch; pond skip-and-wade egress). Deterministic geometry is
// the same ground truth scripts/mb10e-sanity.mjs uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
const { Body } = Matter;
import { buildTrackFromDef, validateTrackDef } from '../src/game/trackdef';
import type { TrackDef } from '../src/game/trackdef';
import { meta } from '../src/game/track';
import { Game } from '../src/game/engine';
import { encodeShareCode, decodeShareCode } from '../src/game/sharecode';
import { AI_COLORS, mulberry32, randomStats } from '../src/game/types';
import type { MarbleInfo } from '../src/game/types';

const roster = (seed = 1): MarbleInfo[] => {
  const rng = mulberry32(seed);
  return Array.from({ length: 10 }, (_, id) => ({
    id,
    name: `M${id}`,
    color: AI_COLORS[id % AI_COLORS.length],
    stats: randomStats(rng),
    isPlayer: false,
  }));
};

const FIELD_DEF = {
  v: 1, name: 'fields', seed: 3, theme: 'classic', height: 2400,
  pieces: [
    { t: 'ramp', a: [0, 60], b: [60, 120] },
    { t: 'ramp', a: [60, 620], b: [300, 680] },
    { t: 'wind', a: [360, 400], b: [560, 640], dir: 270, str: 0.3, pulse: 2000, phase: 400 },
    { t: 'magnet', x: 460, y: 900, r: 150, str: 5, period: 4600, phase: 600 },
    { t: 'mud', a: [120, 1320], b: [380, 1400], drag: 0.3 },
    { t: 'pool', a: [340, 1700], b: [620, 1700], depth: 100, skip: 6 },
    { t: 'geyser', x: 700, y: 1950, h: 300, period: 3200, phase: 800 },
    { t: 'ramp', a: [0, 2100], b: [880, 2240] },
  ],
} as unknown as TrackDef;

test('MB-10E schema: the five pieces validate and bounds reject', () => {
  const ok = validateTrackDef(FIELD_DEF);
  assert.ok(ok.ok, ok.ok ? '' : ok.errors.join('; '));

  const reject = (piece: Record<string, unknown>, why: RegExp) => {
    const def = { ...FIELD_DEF, pieces: [...FIELD_DEF.pieces.slice(0, 2), piece] } as unknown;
    const check = validateTrackDef(def);
    assert.ok(!check.ok, `expected rejection but passed: ${JSON.stringify(piece)}`);
    if (!check.ok) assert.match(check.errors.join(' '), why);
  };
  reject({ t: 'wind', a: [0, 0], b: [300, 10], dir: 270, str: 9, pulse: 0, phase: 0 }, /\.str is 9/i);
  reject({ t: 'magnet', x: 200, y: 200, r: 500, str: 5, period: 0, phase: 0 }, /\.r is 500/i);
  reject({ t: 'mud', a: [10, 500], b: [300, 520], drag: 0.9 }, /\.drag is 0\.9/i);
  reject({ t: 'pool', a: [100, 500], b: [400, 500], depth: 400 }, /\.depth is 400/i);
  reject({ t: 'geyser', x: 100, y: 100, h: 40, period: 3000, phase: 0 }, /\.h is 40/i);
});

test('MB-10E share code round-trips the five new kinds exactly', async () => {
  const code = await encodeShareCode(FIELD_DEF);
  const back = await decodeShareCode(code);
  assert.equal(back.pieces.length, (FIELD_DEF.pieces as unknown[]).length);
  const kinds = back.pieces.map((p) => p.t).join(',');
  assert.equal(kinds, 'ramp,ramp,wind,magnet,mud,pool,geyser,ramp');
  const wind = back.pieces[2];
  assert.deepEqual(wind.t === 'wind' && { dir: wind.dir, str: wind.str, pulse: wind.pulse, phase: wind.phase }, { dir: 270, str: 0.3, pulse: 2000, phase: 400 });
  const pool = back.pieces[5];
  assert.deepEqual(pool.t === 'pool' && { depth: pool.depth, skip: pool.skip }, { depth: 100, skip: 6 });
  const geyser = back.pieces[6];
  assert.deepEqual(geyser.t === 'geyser' && { h: geyser.h, period: geyser.period, phase: geyser.phase }, { h: 300, period: 3200, phase: 800 });
});

test('MB-10E builders stamp the meta the engine replays', () => {
  const track = buildTrackFromDef(FIELD_DEF);
  const winds = track.bodies.filter((b) => meta(b).wind);
  assert.equal(winds.length, 1);
  const w = meta(winds[0]).wind!;
  assert.deepEqual({ ux: Math.round(w.ux * 100) / 100 + 0, uy: Math.round(w.uy * 100) / 100 + 0 }, { ux: 0, uy: -1 });
  assert.equal(w.pulseMs, 2000);
  const magnets = track.bodies.filter((b) => meta(b).magnet);
  assert.equal(magnets.length, 1);
  assert.equal(meta(magnets[0]).magnet!.r, 150);
  const pools = track.bodies.filter((b) => meta(b).pool);
  assert.equal(pools.length, 1);
  assert.equal(pools[0].isSensor, true, 'the water column is a sensor');
  const geysers = track.bodies.filter((b) => meta(b).geyser);
  assert.equal(geysers.length, 1);
});

test('MB-10E magnet: an anvil-heavy marble latches, then releases', () => {
  const def = {
    v: 1, name: 'magnet-probe', seed: 5, theme: 'classic', height: 1800,
    pieces: [
      { t: 'ramp', a: [0, 60], b: [880, 700] },
      { t: 'magnet', x: 700, y: 660, r: 220, str: 6, period: 0, phase: 0 },
    ],
  } as unknown as TrackDef;
  const game = new Game(5, roster(5), { def, recovery: false, effects: false, aiItems: false, wireEvents: false });
  try {
    game.openGate();
    for (const s of game.marbles.slice(1)) s.finishedAt = 1;
    const m = game.marbles[0];
    m.anvilUntil = Number.MAX_SAFE_INTEGER; // iron-heavy: the magnet should grab it
    const rolling = { y: 500 };
    Body.setPosition(m.body, { x: 420, y: 700 });
    Body.setVelocity(m.body, { x: 5, y: 0 });
    let minD = Infinity;
    let freeAfter = -1;
    for (let i = 0; i < 600; i++) {
      game.step(1000 / 60);
      rolling.y = m.body.position.y;
      const d = Math.hypot(m.body.position.x - 700, m.body.position.y - 660);
      minD = Math.min(minD, d);
      if (i > 200 && d > 400 && freeAfter < 0) freeAfter = i;
    }
    assert.ok(minD < 220, `anvil marble never felt the magnet (closest ${minD.toFixed(0)})`);
    assert.ok(freeAfter > 0, 'anvil marble never escaped the magnet');
    assert.ok(Number.isFinite(rolling.y));
  } finally {
    game.destroy();
  }
});

test('MB-10E pool: a fast flat entry skips across and exits right', () => {
  const def = {
    v: 1, name: 'pool-probe', seed: 9, theme: 'classic', height: 2400,
    pieces: [
      { t: 'ramp', a: [60, 620], b: [300, 680] },
      { t: 'pool', a: [340, 480], b: [620, 480], depth: 100, skip: 6 },
      { t: 'ramp', a: [634, 496], b: [880, 700] },
      { t: 'ramp', a: [60, 1600], b: [300, 1680] },
    ],
  } as unknown as TrackDef;
  // NOTE the pond sits above the start-funnel peg column (x450/y<400 is the start area)
  void def;
  const live = { ...def, pieces: [
    { t: 'ramp', a: [60, 620], b: [300, 680] },
    { t: 'pool', a: [340, 700], b: [620, 700], depth: 100, skip: 6 },
    { t: 'ramp', a: [634, 716], b: [880, 900] },
    { t: 'ramp', a: [0, 1200], b: [880, 1500] },
  ] } as unknown as TrackDef;
  const game = new Game(9, roster(9), { def: live, recovery: false, effects: false, aiItems: false, wireEvents: false });
  try {
    game.openGate();
    for (const s of game.marbles.slice(1)) s.finishedAt = 1;
    const m = game.marbles[0];
    Body.setPosition(m.body, { x: 240, y: 660 });
    Body.setVelocity(m.body, { x: 9, y: 3 });
    let maxX = 0;
    for (let i = 0; i < 300; i++) {
      game.step(1000 / 60);
      maxX = Math.max(maxX, m.body.position.x);
    }
    assert.ok(maxX > 850 && m.body.position.y > 880, `the stone never skimmed past the pond onto the far slope (max x ${maxX.toFixed(0)}, y ${m.body.position.y.toFixed(0)})`);
  } finally {
    game.destroy();
  }
});
