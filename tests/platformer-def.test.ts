// Run with: node --import tsx --test tests/platformer-def.test.ts
// P2-22: a platformer TrackDef becomes the CoursePlan the race builds. Pieces are floors, springs, crates, gates...;
// the start platform and the finish run-out are added by the converter, and floor-bound pieces settle onto their floors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { AI_COLORS, AI_NAMES, TRACK_THEMES, mulberry32, randomStats } from '../src/game/types';
import type { MarbleInfo } from '../src/game/types';
import { validateTrackDef } from '../src/game/trackdef';
import type { Piece, TrackDef } from '../src/game/trackdef';
import { trackFromPlan } from '../src/game/platformer/build';
import { floorAt } from '../src/game/platformer/course';
import {
  PF_START_END, PF_START_Y, finishXOf, newPlatformerDef, planFromTrackDef, platformerProblems, settle,
} from '../src/game/platformer/def';

const Y = PF_START_Y;

/** A gentle three-part course on the middle lane with a spring, a crate and a gate to the back lane (and back). */
function course(pieces: Piece[], width = 9000): TrackDef {
  const def = newPlatformerDef('Test Course', width);
  const check = validateTrackDef({ ...def, pieces });
  assert.ok(check.ok, check.ok ? '' : check.error);
  return check.ok ? check.def : def;
}

const hills: Piece[] = [
  { t: 'ramp', a: [PF_START_END, Y], b: [2000, Y + 150] },
  { t: 'ramp', a: [2000, Y + 150], b: [3200, Y + 150] },
  { t: 'curve', a: [3200, Y + 150], c: [3800, Y + 150], b: [4200, Y + 300] },
  { t: 'ramp', a: [4200, Y + 300], b: [6400, Y + 300] },
  { t: 'ramp', a: [6700, Y + 300], b: [8800, Y + 300] },
];

test('a new course is just the start platform and the finish, and it plans', () => {
  const plan = planFromTrackDef(newPlatformerDef('Empty', 6000));
  assert.equal(plan.width, 6000);
  assert.equal(plan.startY, Y);
  assert.equal(plan.finishX, finishXOf(6000));
  // Three lanes of start platform and three of run-out.
  assert.equal(plan.floors.length, 6);
  for (const lane of [0, 1, 2] as const) {
    assert.equal(floorAt(plan, lane, 300), Y, `lane ${lane} start platform`);
    assert.equal(floorAt(plan, lane, 5900), Y, `lane ${lane} run-out`);
  }
});

test('ramps and curves are floors in their own lane; a curve is cut into slabs', () => {
  const def = course([...hills, { t: 'ramp', a: [2000, Y - 200], b: [3000, Y - 200], lane: 2 }]);
  const plan = planFromTrackDef(def);
  assert.equal(floorAt(plan, 1, 1450), Y + 75, 'halfway down the first ramp (the lane is 1, the default)');
  assert.equal(floorAt(plan, 2, 2500), Y - 200, 'the front-lane ledge floor');
  assert.equal(floorAt(plan, 0, 2500), null, 'nothing in the back lane there: a gap');
  const slabs = plan.floors.filter((f) => f.lane === 1 && f.x0 >= 3200 && f.x1 <= 4200);
  // at least its 12 segments, and none longer than about 40 px, so a tight bend stays round (the owner)
  assert.ok(slabs.length >= 12, `${slabs.length} slabs`);
  assert.ok(slabs.every((f) => Math.hypot(f.x1 - f.x0, f.y1 - f.y0) <= 60), 'short slabs');
  assert.ok(plan.beams?.some((b) => b.lane === 1 && b.pts.length === slabs.length + 1), 'its beam is painted whole');
});

test('every piece is the drop-track piece itself (classic art and behaviour), except the floors and the lane pieces', () => {
  const def = course([
    ...hills,
    { t: 'pad', x: 2600, y: Y + 150, w: 60, dir: 1 },
    { t: 'boost', x: 1500, y: Y, len: 160, thick: 20, dir: [1, 0] },
    { t: 'itembox', x: 3000, y: Y + 80 },
    { t: 'block', x: 5000, y: Y + 270, w: 60, h: 60, lane: 0 },
    { t: 'gate', kind: 'ramp', to: 0, x: 5200, y: Y + 300, w: 170 },
    { t: 'gate', kind: 'door', to: 1, x: 5600, y: Y + 300, w: 170, lane: 0 },
    { t: 'ledge', x: 4300, y: Y + 200, w: 400, lane: 2 },
    { t: 'wrecker', pivot: [3500, Y - 200], chain: 180, amp: 0.6, speed: 0.002, phase: 1 },
    { t: 'bridge', a: [6400, Y + 300], b: [7000, Y + 300], planks: 30, slack: 12, lane: 2 },
    { t: 'loop', x: 4600, bottom: Y + 300, r: 90, lane: 1 },
    { t: 'ice', a: [7000, Y + 300], b: [7400, Y + 300], lane: 2 },
  ]);
  const plan = planFromTrackDef(def);
  // the classic pieces, each in its own lane, built by the drop-track Builder
  const classic = (plan.extras ?? []).map((e) => [e.piece.t, e.lane]);
  assert.deepEqual(classic.sort(), [['block', 0], ['boost', 1], ['bridge', 2], ['ice', 2], ['itembox', 1], ['loop', 1], ['pad', 1], ['wrecker', 1]].sort());
  assert.deepEqual([plan.springs, plan.boosts, plan.itemBoxes, plan.wreckers, plan.loops].map((l) => l?.length ?? 0), [0, 0, 0, 0, 0], 'no platformer copies of them');
  // the drivers still sense the block, the bridge and the ice; none of those is built or drawn twice
  assert.deepEqual(plan.bumps, [{ lane: 0, x: 4970, w: 60, y: Y + 240, h: 60, hidden: true }]);
  assert.equal(plan.bridges!.length, 1);
  assert.ok(plan.bridges![0].hidden && plan.bridges![0].lane === 2);
  assert.ok(plan.floors.some((f) => f.hidden && f.lane === 2 && f.x0 === 7000 && f.x1 === 7400), 'the ice is ground the drivers see');
  // the platformer's own lane pieces
  assert.deepEqual(plan.gates!.map((g) => [g.kind, g.lane, g.to]), [['ramp', 1, 0], ['door', 0, 1]]);
  assert.deepEqual(plan.ledges, [{ lane: 2, x: 4300, w: 400, y: Y + 200 }]);
});

test('a classic piece in a platformer course is built once, by the classic Builder, with its classic body kinds', () => {
  const def = course([...hills, { t: 'bridge', a: [6400, Y + 300], b: [7000, Y + 300], planks: 30, slack: 12 }, { t: 'ice', a: [7000, Y + 300], b: [7400, Y + 300] }, { t: 'block', x: 5000, y: Y + 270, w: 60, h: 60 }]);
  const track = trackFromPlan(planFromTrackDef(def), 1, TRACK_THEMES.forest);
  const classic = track.bodies.filter((b) => (b.plugin as { classic?: boolean }).classic);
  const kinds = new Set(classic.map((b) => (b.plugin as { kind: string }).kind));
  assert.ok(kinds.has('bridge') && kinds.has('ice'), [...kinds].join(','));
  const bridgePlanks = track.bodies.filter((b) => (b.plugin as { kind: string }).kind === 'bridge');
  assert.ok(bridgePlanks.every((b) => (b.plugin as { classic?: boolean }).classic), 'no second, platformer-built bridge');
});

test('settle puts floor-bound pieces on the floor of their lane and leaves floaters alone', () => {
  const def = course([
    ...hills,
    { t: 'pad', x: 2600, y: 1500, w: 60, dir: 1 },
    { t: 'block', x: 5000, y: 1000, w: 60, h: 60 },
    { t: 'gate', kind: 'ramp', to: 0, x: 5200, y: 1000, w: 170 },
    { t: 'itembox', x: 3000, y: 12 },
  ]);
  const next = settle(def);
  const get = (t: string) => next.pieces.find((p) => p.t === t) as Piece & Record<string, number>;
  assert.equal(get('pad').y, Y + 150);
  assert.equal(get('block').y, Y + 300 - 30, 'a 60 px crate: its middle is half a crate above the floor');
  assert.equal(get('gate').y, Y + 300);
  assert.equal(get('itembox').y, 12, 'a hovering item box stays');
  assert.equal(settle(next), next, 'settling a settled course changes nothing and returns the same def');
});

test('problems are readable sentences', () => {
  assert.deepEqual(platformerProblems(course(hills)), []);
  const floating = course([...hills, { t: 'pad', x: 3000, y: Y, w: 60, dir: 1, lane: 0 }]);
  assert.match(platformerProblems(floating).join(' '), /pad #6 at x 3000 floats/);
  const toSelf = course([...hills, { t: 'gate', kind: 'ramp', to: 1, x: 5200, y: Y + 300, w: 170 }]);
  assert.match(platformerProblems(toSelf).join(' '), /leads to its own lane/);
  const gap = course([{ t: 'ramp', a: [PF_START_END, Y], b: [1500, Y] }], 12000);
  assert.match(platformerProblems(gap).join(' '), /gap near x .* too wide/);
  const late = course([...hills, { t: 'itembox', x: 8950, y: Y }], 9000);
  assert.match(platformerProblems(late).join(' '), /beyond the finish/);
});

function field(): MarbleInfo[] {
  const rng = mulberry32(31);
  return Array.from({ length: 10 }, (_, i) => ({ id: i, name: AI_NAMES[i] ?? `AI ${i}`, color: AI_COLORS[i % AI_COLORS.length], stats: randomStats(rng), isPlayer: false, character: i % 6 }));
}

test('a hand-built course is raced end to end by the whole AI field', () => {
  const def = settle(course([
    ...hills,
    { t: 'pad', x: 2600, y: Y + 150, w: 60, dir: 1 },
    { t: 'itembox', x: 3000, y: Y + 80 },
    { t: 'boost', x: 5200, y: Y + 300, len: 200, thick: 20, dir: [1, 0] },
    { t: 'ramp', a: [6700, Y + 300], b: [8700, Y + 300] },
  ], 9500));
  assert.deepEqual(platformerProblems(def), []);
  const plan = planFromTrackDef(def);
  const game = new Game(5, field(), { track: trackFromPlan(plan, 5, TRACK_THEMES.forest) });
  game.start();
  game.openGate();
  let t = 0;
  for (; t < 240000 && !game.allFinished(); t += PHYSICS_STEP) game.step(PHYSICS_STEP);
  assert.ok(game.finishOrder.length >= 9, `${game.finishOrder.length}/10 finished after ${Math.round(t / 1000)} s`);
});

test('a copy of an official course is a valid def of a few hundred pieces that the field still races through', async () => {
  const { planFlow } = await import('../src/game/platformer/flow');
  const { defFromPlan } = await import('../src/game/platformer/def');
  for (const seed of [7, 11]) {
    const original = planFlow(seed);
    const check = validateTrackDef(defFromPlan(original, `Copy ${seed}`));
    assert.ok(check.ok, check.ok ? '' : check.error);
    if (!check.ok) return;
    assert.ok(check.def.pieces.length < 900, `${check.def.pieces.length} pieces`);
    assert.equal(check.def.width! - 500, Math.round(original.finishX), 'the finish stands where it did');
    assert.deepEqual(platformerProblems(check.def), [], 'a copy has no problems to fix');
    const copy = planFromTrackDef(check.def);
    for (const lane of [0, 1, 2] as const) {
      const a = floorAt(original, lane, 4000), b = floorAt(copy, lane, 4000);
      assert.ok(a === null ? b === null : b !== null && Math.abs(b - (a + (Y - original.startY))) < 60, `lane ${lane} floor at 4000: ${a} vs ${b}`);
    }
    const game = new Game(seed, field(), { track: trackFromPlan(copy, seed, TRACK_THEMES.forest) });
    game.start();
    game.openGate();
    let t = 0;
    for (; t < 300000 && !game.allFinished(); t += PHYSICS_STEP) game.step(PHYSICS_STEP);
    assert.ok(game.finishOrder.length >= 8, `seed ${seed}: ${game.finishOrder.length}/10 finished after ${Math.round(t / 1000)} s`);
  }
});
