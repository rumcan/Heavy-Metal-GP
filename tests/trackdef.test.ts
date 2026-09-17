// ══════════════════════════════════════════════════════════════════════════
// MB-01 — track definition format (TrackDef) and loader.
//
// The acceptance is an identity claim: a def recording of a procedural
// circuit must rebuild that circuit *body for body*, so a player can open a
// generated circuit and edit it (MB-02…MB-09) with the physics unchanged.
//
//   1. ROUND TRIP — for 20+ seeds across all six Grands Prix, every body is
//      compared exactly: count and order, position, angle, vertices, the
//      collision filter and the plugin metadata that carries gameplay
//      (peg colours, dropped items, wrecking-ball phases, spinner angles,
//      ramp surfaces), plus decor, sectors and the derived body lists. Bit
//      equality is possible because a def records the *builder calls* — the
//      mirror flag included — rather than pre-mirrored coordinates.
//   2. THE SAME RACE — two engines, procedural vs def-built, are stepped in
//      lockstep through a full Marblehurst heat (105s of simulation) and have
//      to agree on every marble position, every finish time and the
//      classification.
//   3. UNTRUSTED INPUT — a def arrives from a save, a share code or the
//      network, so the loader validates before it builds. A malformed def is
//      refused with a readable reason, is never half-built, and never throws
//      inside `Game`: the race falls back to the procedural circuit.
// ══════════════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import { DEFAULT_PROFILE, generateTrack, meta } from '../src/game/track';
import type { Track } from '../src/game/track';
import { TrackDefError, buildTrackFromDef, generateTrackDef, validateTrackDef } from '../src/game/trackdef';
import type { TrackDef } from '../src/game/trackdef';
import { CALENDAR } from '../src/game/season';
import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { AI_COLORS, AI_NAMES, ITEM_TYPES, TRACK_THEMES, mulberry32, randomStats, themeIdFor } from '../src/game/types';
import type { MarbleInfo } from '../src/game/types';

const SEEDS = [1, 7, 1234, 2026];
const PROFILES = [
  ...CALENDAR.map((gp) => ({ name: gp.short, profile: gp.profile })),
  { name: 'DEFAULT', profile: DEFAULT_PROFILE },
];

function roster(seed = 42): MarbleInfo[] {
  const rng = mulberry32(seed);
  return Array.from({ length: 10 }, (_, id) => ({
    id,
    name: id === 0 ? 'You' : AI_NAMES[id - 1],
    color: id === 0 ? '#d63e2e' : AI_COLORS[id - 1],
    stats: randomStats(rng),
    isPlayer: id === 0,
  }));
}

const points = (body: Matter.Body) => body.vertices.map((v) => [v.x, v.y] as [number, number]);
/** Position of each listed body inside `track.bodies`; compares body lists without relying on Matter's id counter. */
const positions = (track: Track, list: Matter.Body[]) => list.map((body) => track.bodies.indexOf(body));

/** Compares a rebuilt circuit with the procedural one and returns a one-line summary. Throws on any difference. */
function assertSameTrack(procedural: Track, rebuilt: Track, context: string): string {
  assert.equal(rebuilt.height, procedural.height, `${context}: circuit height`);
  assert.equal(rebuilt.startY, procedural.startY, `${context}: startY`);
  assert.equal(rebuilt.finishY, procedural.finishY, `${context}: finishY`);
  assert.equal(rebuilt.seed, procedural.seed, `${context}: seed`);
  assert.deepEqual(rebuilt.theme, procedural.theme, `${context}: theme`);
  assert.deepEqual(rebuilt.pegCount, procedural.pegCount, `${context}: peg count`);
  assert.deepEqual(rebuilt.segments, procedural.segments, `${context}: sectors`);
  assert.deepEqual(rebuilt.decor, procedural.decor, `${context}: decor`);
  assert.equal(rebuilt.bodies.length, procedural.bodies.length, `${context}: body count`);
  assert.equal(meta(rebuilt.gate).kind, 'gate', `${context}: gate missing`);

  for (let index = 0; index < procedural.bodies.length; index++) {
    const body = procedural.bodies[index];
    const other = rebuilt.bodies[index];
    const at = `${context}: body ${index} of ${procedural.bodies.length}`;
    assert.equal(other.label, body.label, `${at} label`);
    assert.equal(other.position.x, body.position.x, `${at} x`);
    assert.equal(other.position.y, body.position.y, `${at} y`);
    assert.equal(other.angle, body.angle, `${at} angle`);
    assert.equal(other.isStatic, body.isStatic, `${at} static`);
    assert.equal(other.isSensor, body.isSensor, `${at} sensor`);
    assert.deepEqual(other.collisionFilter, body.collisionFilter, `${at} collision filter`);
    assert.deepEqual(points(other), points(body), `${at} vertices`);
    assert.deepEqual(meta(other), meta(body), `${at} metadata`);
  }

  assert.deepEqual(positions(rebuilt, rebuilt.spinners), positions(procedural, procedural.spinners), `${context}: spinners`);
  assert.deepEqual(positions(rebuilt, rebuilt.itemBoxes), positions(procedural, procedural.itemBoxes), `${context}: item boxes`);
  assert.deepEqual(positions(rebuilt, rebuilt.ramps), positions(procedural, procedural.ramps), `${context}: ramps`);
  assert.deepEqual(positions(rebuilt, rebuilt.buckets), positions(procedural, procedural.buckets), `${context}: buckets`);
  assert.deepEqual(positions(rebuilt, rebuilt.wreckers), positions(procedural, procedural.wreckers), `${context}: wreckers`);

  return `${procedural.bodies.length} bodies, ${procedural.segments.length} sectors, ${procedural.decor.length} decor pieces identical`;
}

test('TrackDef: every recorded circuit rebuilds body for body', { timeout: 180000 }, () => {
  let tracks = 0;
  const details: string[] = [];
  for (const { name, profile } of PROFILES) {
    for (const seed of SEEDS) {
      const def = generateTrackDef(seed, profile, name);
      const check = validateTrackDef(def);
      assert.ok(check.ok, `${name} ${seed}: a generated def must validate — ${check.ok ? '' : check.error}`);
      assert.equal(check.def.pieces.length, def.pieces.length, `${name} ${seed}: validation changed the piece list`);
      details.push(assertSameTrack(generateTrack(seed, profile), buildTrackFromDef(def), `${name} seed ${seed}`));
      tracks++;
    }
  }
  assert.ok(tracks >= 20, `expected at least 20 seeds, compared ${tracks}`);
  console.log(`    ${tracks} circuits rebuilt identically — e.g. ${details[0]}`);
});

test('TrackDef: a def-built circuit races exactly like the procedural one', { timeout: 180000 }, () => {
  const gp = CALENDAR[0];
  const seed = 1234;
  const procedural = new Game(seed, roster(), { profile: gp.profile, effects: false, aiItems: false });
  // The def goes through the engine seam (what MB-04 will do), not through a pre-built track.
  const fromDef = new Game(seed, roster(), { profile: gp.profile, effects: false, aiItems: false, def: generateTrackDef(seed, gp.profile, gp.name) });
  try {
    assert.equal(fromDef.trackDefError, null, 'the engine refused a valid def');
    procedural.openGate();
    fromDef.openGate();
    let steps = 0;
    while ((!procedural.allFinished() || !fromDef.allFinished()) && steps < 40000) {
      procedural.step(PHYSICS_STEP);
      fromDef.step(PHYSICS_STEP);
      steps++;
      if (steps % 120 === 0) {
        for (let index = 0; index < procedural.marbles.length; index++) {
          const a = procedural.marbles[index].body.position;
          const b = fromDef.marbles[index].body.position;
          assert.equal(b.x, a.x, `step ${steps}: marble ${index} diverged in x`);
          assert.equal(b.y, a.y, `step ${steps}: marble ${index} diverged in y`);
        }
      }
    }
    assert.ok(procedural.allFinished() && fromDef.allFinished(), `race did not finish in ${steps} steps`);
    const ids = (game: Game) => game.finishOrder.map((m) => m.info.id);
    assert.deepEqual(ids(fromDef), ids(procedural), 'classification differs');
    assert.deepEqual(fromDef.marbles.map((m) => m.finishedAt), procedural.marbles.map((m) => m.finishedAt), 'finish times differ');
    assert.deepEqual(fromDef.marbles.map((m) => m.pegs), procedural.marbles.map((m) => m.pegs), 'peg counts differ');
    assert.equal(fromDef.marbles.reduce((sum, m) => sum + m.recoveries, 0), procedural.marbles.reduce((sum, m) => sum + m.recoveries, 0), 'recoveries differ');
    console.log(`    ${procedural.finishOrder.length}/10 finished after ${(steps * PHYSICS_STEP / 1000).toFixed(1)}s; identical order, times and positions`);
  } finally {
    procedural.destroy();
    fromDef.destroy();
  }
});

test('TrackDef: malformed defs are refused with a readable reason', () => {
  const good = generateTrackDef(1234, CALENDAR[0].profile, 'Marblehurst');
  const cases: [string, unknown, RegExp][] = [
    ['not an object', 'a track', /must be a JSON object/],
    ['missing version', { ...good, v: undefined }, /version undefined/],
    ['future version', { ...good, v: 2 }, /version 2/],
    ['unknown theme', { ...good, theme: 'neon' }, /theme must be one of/],
    ['empty name', { ...good, name: '   ' }, /name must be a non-empty string/],
    ['pieces not an array', { ...good, pieces: {} }, /pieces must be an array/],
    ['too many pieces', { ...good, pieces: Array.from({ length: 6001 }, () => ({ t: 'peg', x: 1, y: 1, r: 5 })) }, /the limit is 6000/],
    ['unknown piece type', { ...good, pieces: [{ t: 'teleporter', x: 10, y: 10 }] }, /unknown piece type "teleporter"/],
    ['non-finite coordinate', { ...good, pieces: [{ t: 'peg', x: Number.NaN, y: 10, r: 9 }] }, /pieces\[0\]\.x must be a finite number/],
    ['string coordinate', { ...good, pieces: [{ t: 'peg', x: '10', y: 10, r: 9 }] }, /pieces\[0\]\.x must be a finite number/],
    ['outside the pipe', { ...good, pieces: [{ t: 'breakable', x: 1000, y: 10, w: 30, h: 60, req: 5 }] }, /is 1000; expected 0\.\.900/],
    ['below the circuit height', { ...good, height: 900, pieces: [{ t: 'peg', x: 10, y: 5000, r: 9 }] }, /below the circuit's height/],
    ['bad peg colour', { ...good, pieces: [{ t: 'ppeg', x: 10, y: 10, color: 'red', r: 9 }] }, /color must be blue, orange or green/],
    ['unknown item drop', { ...good, pieces: [{ t: 'ppeg', x: 10, y: 10, color: 'green', r: 13, item: 'laser' }] }, /item must be one of/],
    ['zero direction', { ...good, pieces: [{ t: 'hoop', x: 10, y: 10, dir: [0, 0] }] }, /dir must not be \[0, 0\]/],
    ['bad pad direction', { ...good, pieces: [{ t: 'pad', x: 10, y: 10, w: 40, dir: 0 }] }, /dir must be -1 or 1/],
    ['negative height', { ...good, height: -100 }, /height is -100/],
    ['out-of-range seed', { ...good, seed: -4 }, /seed is -4/],
    ['bad mirror flag', { ...good, pieces: [{ t: 'peg', x: 10, y: 10, r: 9, flip: 'yes' }] }, /flip must be true or false/],
    ['bad sector', { ...good, segments: [{ name: 'Start', y: 'top', h: 10 }] }, /segments\[0\]\.y must be a finite number/],
  ];

  for (const [label, value, expected] of cases) {
    const check = validateTrackDef(value);
    assert.equal(check.ok, false, `${label} was accepted`);
    if (check.ok) continue;
    assert.match(check.error, expected, `${label}: unhelpful message — ${check.error}`);
    assert.ok(check.errors.length > 0 && check.error.length > 10, `${label}: no readable message`);
    assert.throws(() => buildTrackFromDef(value), (error: unknown) => error instanceof TrackDefError && expected.test(error.message), `${label}: buildTrackFromDef must throw a TrackDefError`);
  }

  // A def that is only *mostly* right is still refused, and says where.
  const broken = { ...good, pieces: [...good.pieces.slice(0, 12), { t: 'spinner', x: 450, y: 900, len: 0, speed: 0.03 }, ...good.pieces.slice(13)] };
  const check = validateTrackDef(broken);
  assert.equal(check.ok, false);
  if (!check.ok) assert.match(check.error, /pieces\[12\]\.len is 0; expected 20\.\.900/, `got: ${check.error}`);
});

test('TrackDef: a refused def never takes a race down with it', () => {
  const gp = CALENDAR[0];
  const broken = { v: 1, name: 'Broken', theme: 'classic', height: 1200, pieces: [{ t: 'peg', x: 5000, y: 10, r: 9 }] };
  const game = new Game(1234, roster(), { profile: gp.profile, def: broken, effects: false });
  try {
    assert.ok(game.trackDefError, 'a rejected def must be reported');
    assert.match(game.trackDefError!, /pieces\[0\]\.x is 5000; expected 0\.\.900/);
    assertSameTrack(generateTrack(1234, gp.profile), game.track, 'fallback track');
  } finally {
    game.destroy();
  }

  // Absent means absent: an unset def is not an error.
  const procedural = new Game(7, roster(), { profile: gp.profile, def: null, effects: false });
  try {
    assert.equal(procedural.trackDefError, null, 'a null def should mean "no def", not a rejection');
  } finally {
    procedural.destroy();
  }

  // Values that are not even an object must be just as harmless.
  for (const value of [42, 'circuit', []]) {
    const game = new Game(7, roster(), { profile: gp.profile, def: value, effects: false });
    try {
      assert.ok(game.trackDefError, `def ${JSON.stringify(value)} produced no message`);
      assert.ok(game.track.bodies.length > 0, 'no track was built');
    } finally {
      game.destroy();
    }
  }
});

test('TrackDef: defs survive JSON and a hand-written def is deterministic', () => {
  const gp = CALENDAR[1];
  const def = generateTrackDef(99, gp.profile, 'Monte Pipo');
  const viaJson = JSON.parse(JSON.stringify(def)) as TrackDef;
  assert.deepEqual(viaJson, def, 'a def must be JSON-safe as-is');
  assertSameTrack(generateTrack(99, gp.profile), buildTrackFromDef(viaJson), 'JSON round trip');

  // What MB-03 will write: no seed, no phases, plain world coordinates, no mirror flag.
  const authored: TrackDef = {
    v: 1,
    name: 'Test bench',
    theme: 'silver',
    height: 2400,
    pieces: [
      { t: 'ramp', a: [0, 480], b: [700, 640] },
      { t: 'ramp', a: [900, 700], b: [200, 860] },
      { t: 'peg', x: 450, y: 780, r: 14 },
      { t: 'ppeg', x: 620, y: 520, color: 'orange', r: 9 },
      { t: 'ppeg', x: 680, y: 520, color: 'green', r: 13 },
      { t: 'itembox', x: 300, y: 560 },
      { t: 'bucket', y: 1000 },
      { t: 'wall', x: 120, y: 1120, w: 12, h: 200 },
      { t: 'boost', x: 500, y: 980, len: 120, thick: 40, dir: [0, 1] },
      { t: 'spinner', x: 450, y: 1200, len: 190, speed: 0.04 },
      { t: 'wrecker', pivot: [700, 1300], chain: 95, amp: 0.5, speed: 0.002 },
    ],
  };
  const check = validateTrackDef(authored);
  assert.ok(check.ok, `hand-written def refused: ${check.ok ? '' : check.error}`);
  const first = buildTrackFromDef(authored);
  const second = buildTrackFromDef(JSON.parse(JSON.stringify(authored)));
  assertSameTrack(first, second, 'authored def, built twice');
  assert.deepEqual(first.theme, TRACK_THEMES.silver, 'theme id resolved to the wrong palette');
  assert.equal(themeIdFor(TRACK_THEMES.sakura), 'sakura');
  // Two authored pegs, plus the funnel peg every start grid brings with it.
  assert.equal(first.bodies.filter((b) => meta(b).kind === 'ppeg' && b.position.y > 440).length, 2, 'pegs were not all built');

  // And it is a circuit the engine can race on: the marbles leave the grid, roll and finish.
  const game = new Game(5, roster(), { def: authored, effects: false, recovery: true });
  try {
    assert.equal(game.trackDefError, null);
    game.openGate();
    for (let step = 0; step < 12 * 300; step++) game.step(PHYSICS_STEP);
    const rolled = game.marbles.filter((m) => m.body.position.y > game.track.startY + 200);
    assert.equal(rolled.length, game.marbles.length, 'marbles did not roll away on an authored circuit');
    assert.ok(game.marbles.every((m) => Number.isFinite(m.body.position.x)), 'non-finite marble position');
  } finally {
    game.destroy();
  }

  // Hand-written defs are deterministic: the builder's RNG is seeded from the def, never from Math.random.
  const rolling = buildTrackFromDef({ ...authored, pieces: authored.pieces.filter((p) => p.t === 'wrecker' || p.t === 'ppeg' || p.t === 'spinner') });
  const again = buildTrackFromDef({ ...authored, pieces: authored.pieces.filter((p) => p.t === 'wrecker' || p.t === 'ppeg' || p.t === 'spinner') });
  assertSameTrack(rolling, again, 'rolled details');
  assert.ok(ITEM_TYPES.includes(meta(rolling.bodies.find((b) => meta(b).pegColor === 'green')!).itemDrop!), 'a glowing peg lost its item');
});
