// MB-10F — big set pieces.
//
// Targeted tests for the five carnival elements: schema bounds, the share
// code round trip (rows 42-46), builder metadata, and two live probes
// (trampoline stat split; turnstile ratchet + wire event). Geometry mirrors
// scripts/mb10f-sanity.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import { buildTrackFromDef, validateTrackDef } from '../src/game/trackdef';
import type { TrackDef } from '../src/game/trackdef';
import { meta } from '../src/game/track';
import { Game } from '../src/game/engine';
import { encodeShareCode, decodeShareCode } from '../src/game/sharecode';
import { AI_COLORS, mulberry32, randomStats } from '../src/game/types';
import type { MarbleInfo } from '../src/game/types';

const { Body } = Matter;

const roster = (seed = 1, tweak?: (s: MarbleInfo['stats']) => MarbleInfo['stats']): MarbleInfo[] => {
  const rng = mulberry32(seed);
  return Array.from({ length: 10 }, (_, id) => ({
    id,
    name: `M${id}`,
    color: AI_COLORS[id % AI_COLORS.length],
    stats: tweak && id === 0 ? tweak(randomStats(rng)) : randomStats(rng),
    isPlayer: false,
  }));
};

const SET_DEF = {
  v: 1, name: 'set pieces', seed: 3, theme: 'classic', height: 2600,
  pieces: [
    { t: 'ramp', a: [0, 60], b: [300, 200] },
    { t: 'trampoline', x: 390, y: 260, w: 175, tension: 1.3 },
    { t: 'ramp', a: [0, 520], b: [470, 710] },
    { t: 'turnstile', x: 455, y: 686, arms: 4, r: 78, mode: 0, period: 0, phase: 0 },
    { t: 'ramp', a: [0, 1110], b: [300, 1250] },
    { t: 'targets', x: 370, y: 1260, count: 4, reset: 5600 },
    { t: 'ramp', a: [0, 1500], b: [880, 1780] },
    { t: 'vortex', x: 560, y: 1660, r: 175, spin: 1.4, hole: 34 },
    { t: 'ramp', a: [0, 2150], b: [380, 2310] },
    { t: 'ramp', a: [560, 2310], b: [880, 2460] },
    { t: 'platform', ax: 405, ay: 2346, bx: 535, by: 2346, w: 130, travel: 2400, pause: 1600, phase: 0 },
    { t: 'ramp', a: [60, 2540], b: [890, 2590] },
  ],
} as unknown as TrackDef;

test('MB-10F schema: the five set pieces validate and bounds reject', () => {
  const ok = validateTrackDef(SET_DEF);
  assert.ok(ok.ok, ok.ok ? '' : ok.errors.join('; '));
  const reject = (piece: Record<string, unknown>, why: RegExp) => {
    const def = { ...SET_DEF, pieces: [...SET_DEF.pieces.slice(0, 2), piece] } as unknown;
    const check = validateTrackDef(def);
    assert.ok(!check.ok, `expected rejection but passed: ${JSON.stringify(piece)}`);
    if (!check.ok) assert.match(check.errors.join(' '), why);
  };
  reject({ t: 'trampoline', x: 100, y: 100, w: 30, tension: 1 }, /\.w is/);
  reject({ t: 'turnstile', x: 100, y: 100, arms: 9, r: 60, mode: 0, period: 0, phase: 0 }, /\.arms is/);
  reject({ t: 'targets', x: 100, y: 100, count: 9, reset: 5000 }, /\.count is/);
  reject({ t: 'vortex', x: 100, y: 100, r: 20, spin: 1, hole: 30 }, /\.r is/);
  reject({ t: 'platform', ax: 100, ay: 100, bx: 200, by: 100, w: 500, travel: 2000, pause: 0, phase: 0 }, /\.w is/);
});

test('MB-10F share code round-trips the five new kinds exactly', async () => {
  const code = await encodeShareCode(SET_DEF);
  const back = await decodeShareCode(code);
  const kinds = back.pieces.map((p) => p.t).join(',');
  assert.equal(kinds, 'ramp,trampoline,ramp,turnstile,ramp,targets,ramp,vortex,ramp,ramp,platform,ramp');
  const esc = back.pieces[3];
  assert.deepEqual(esc.t === 'turnstile' && { arms: esc.arms, r: esc.r, mode: esc.mode }, { arms: 4, r: 78, mode: 0 });
  const vo = back.pieces[7];
  assert.deepEqual(vo.t === 'vortex' && { r: vo.r, spin: vo.spin, hole: vo.hole }, { r: 175, spin: 1.4, hole: 34 });
  const pf = back.pieces[10];
  assert.deepEqual(pf.t === 'platform' && { travel: pf.travel, pause: pf.pause, phase: pf.phase }, { travel: 2400, pause: 1600, phase: 0 });
});

test('MB-10F builders stamp the meta the engine replays', () => {
  const track = buildTrackFromDef(SET_DEF);
  assert.equal(track.bodies.filter((b) => meta(b).trampoline).length, 1);
  assert.equal(track.bodies.filter((b) => meta(b).turnstile).length, 1);
  assert.equal(track.bodies.filter((b) => meta(b).target).length, 4, 'four pins');
  assert.equal(track.targetBanks.length, 1);
  assert.equal(track.targetBanks[0].count, 4);
  assert.equal(track.bodies.filter((b) => meta(b).vortex).length, 1);
  const platform = track.bodies.find((b) => meta(b).motion?.mode === 'platform');
  assert.ok(platform, 'platform piece stamps a kinematic slide motion');
});

function probeRun(def: TrackDef, tweak: ((s: MarbleInfo['stats']) => MarbleInfo['stats']) | undefined, plant: { x: number; y: number }, vel: { x: number; y: number }, log: (games: Game, m: NonNullable<Game['marbles'][number]>, frame: number) => boolean, frames = 400): void {
  const game = new Game(11, roster(11, tweak), { def, recovery: false, effects: false, aiItems: false, wireEvents: true });
  try {
    game.openGate();
    for (const s of game.marbles.slice(1)) s.finishedAt = 1;
    const m = game.marbles[0];
    Body.setPosition(m.body, plant);
    Body.setVelocity(m.body, vel);
    for (let i = 0; i < frames && !log(game, m, i); i++) game.step(1000 / 60);
  } finally {
    game.destroy();
  }
}

const NET_DEF = {
  v: 1, name: 'net', seed: 11, theme: 'classic', height: 2000,
  pieces: [
    { t: 'ramp', a: [0, 60], b: [300, 180] },
    { t: 'trampoline', x: 390, y: 250, w: 175, tension: 1.3 },
    { t: 'ramp', a: [60, 330], b: [880, 440] },
  ],
} as unknown as TrackDef;

const TS_DEF = {
  v: 1, name: 'ts', seed: 11, theme: 'classic', height: 2000,
  pieces: [
    { t: 'ramp', a: [0, 60], b: [880, 220] },
    { t: 'turnstile', x: 450, y: 125, arms: 4, r: 60, mode: 0, period: 0, phase: 0 },
  ],
} as unknown as TrackDef;

test('MB-10F trampoline: bounce-savvy light marbles out-jump heavy ones', () => {
  const apex = (tweak: (s: MarbleInfo['stats']) => MarbleInfo['stats']): number => {
    let minY = Infinity;
    let touched = false;
    probeRun(NET_DEF, tweak, { x: 250, y: 60 }, { x: 4, y: 2 }, (_g, m) => {
      if (m.body.position.y < 260) touched = true;
      if (touched) minY = Math.min(minY, m.body.position.y);
      return false;
    }, 260);
    return minY;
  };
  const lightApex = apex((s) => { s.bounce = 9; s.weight = 2; return s; });
  const heavyApex = apex((s) => { s.bounce = 2; s.weight = 9; return s; });
  assert.ok(lightApex > 0 && lightApex < 245 && lightApex < heavyApex, 'the light marble sprang somewhere above the net');
  assert.ok(heavyApex > lightApex + 30, `heavy barely springs: light apex ${lightApex.toFixed(0)} vs heavy ${heavyApex.toFixed(0)}`);
});

test('MB-10F turnstile: a rolling shove ratchets the hub and emits the wire event', () => {
  let events = 0;
  let maxStep = 0;
  probeRun(TS_DEF, undefined, { x: 300, y: 92 }, { x: 8, y: 0 }, (game) => {
    const hub = game.track.bodies.find((bb) => meta(bb).turnstile);
    for (const e of game.drainRaceEvents()) if (e.kind === 'turnstile') events++;
    maxStep = Math.max(maxStep, meta(hub!).turnstile!.stepIndex);
    return events >= 2 || maxStep >= 2;
  }, 500);
  assert.ok(maxStep >= 1, `the ratchet never stepped (steps ${maxStep})`);
  assert.ok(events >= 1, 'no turnstile wire event was emitted');
});
