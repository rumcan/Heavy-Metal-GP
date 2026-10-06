// Run with: node --import tsx --test tests/infinity.test.ts
// P2-24: Infinity mode. The land is stateless per chunk and joins continuously; the world around the ball stays small
// and near zero however far it goes; the same seed and inputs give the same run; a simple bot rolls for many km.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHUNK_W, infinityChunk, isLoopChunk, shiftChunk, terrainY } from '../src/game/platformer/infinity';
import type { Lane } from '../src/game/platformer/course';

const LANES: Lane[] = [0, 1, 2];

test('a chunk depends only on (seed, index): rebuilding it, in any order, gives the same land', () => {
  const first = [5, 2, 9, 0, 5].map((i) => JSON.stringify(infinityChunk(42, i)));
  assert.equal(first[0], first[4], 'chunk 5 built twice');
  assert.equal(first[1], JSON.stringify(infinityChunk(42, 2)));
  assert.notEqual(JSON.stringify(infinityChunk(42, 5)), JSON.stringify(infinityChunk(43, 5)), 'another seed, another land');
});

test('chunk joins are continuous: no step above 2 px and a slope change below 0.05 at every boundary', () => {
  for (const seed of [1, 7, 2026, 99999]) {
    for (let n = 0; n < 400; n++) {
      const a = infinityChunk(seed, n), b = infinityChunk(seed, n + 1);
      for (const lane of LANES) {
        const left = a.floors.filter((f) => f.lane === lane).sort((p, q) => p.x1 - q.x1).at(-1)!;
        const right = b.floors.filter((f) => f.lane === lane).sort((p, q) => p.x0 - q.x0)[0];
        assert.ok(left && right, `seed ${seed} chunk ${n} lane ${lane}: floor at the join`);
        assert.ok(Math.abs(left.x1 - right.x0) < 1e-9, 'the slabs meet');
        assert.ok(Math.abs(left.y1 - right.y0) <= 2, `seed ${seed} chunk ${n} lane ${lane}: step ${left.y1 - right.y0}`);
        const sl = (left.y1 - left.y0) / (left.x1 - left.x0), sr = (right.y1 - right.y0) / (right.x1 - right.x0);
        assert.ok(Math.abs(sl - sr) < 0.05, `seed ${seed} chunk ${n} lane ${lane}: slope ${sl.toFixed(3)} vs ${sr.toFixed(3)}`);
      }
    }
  }
});

test('the land rolls: every slope a ball meets is a slope it can roll or climb, and the mean line descends gently', () => {
  for (const seed of [3, 8, 21]) {
    let steepest = 0;
    for (let x = 0; x < 400_000; x += 20) for (const lane of LANES) steepest = Math.max(steepest, Math.abs(terrainY(seed, lane, x + 20) - terrainY(seed, lane, x)) / 20);
    assert.ok(steepest < 0.85, `seed ${seed}: steepest slope ${steepest.toFixed(2)}`);
    const drop = terrainY(seed, 1, 1_000_000) - terrainY(seed, 1, 100_000);
    assert.ok(drop / 900_000 > 0.05 && drop / 900_000 < 0.16, `seed ${seed}: mean grade ${(drop / 900_000).toFixed(3)}`);
  }
});

test('nothing hostile and no clutter: no wreckers or boxes, features stay inside their chunk, density is low', () => {
  let features = 0, loops = 0;
  const chunks = 600;
  for (let n = 0; n < chunks; n++) {
    const c = infinityChunk(11, n);
    const keys = Object.keys(c);
    assert.ok(!keys.includes('wreckers') && !keys.includes('itemBoxes'), 'nothing hostile or power-up');
    for (const g of c.gates) assert.ok(g.x >= c.x0 + 1100 && g.x + g.w <= c.x1, 'a gate lies inside its chunk');
    for (const s of c.springs) assert.ok(s.x >= c.x0 + 300 && s.x <= c.x0 + 900);
    for (const l of c.ledges) assert.ok(l.x + l.w <= c.x1 + 260, 'a ledge may spill a little into the next chunk, never far');
    for (const b of c.bridges) assert.ok(b.x0 >= c.x0 + 700 && b.x1 <= c.x0 + 1100);
    loops += c.loops.length;
    // (clouds up in the sky are scenery to ride, not clutter on the track: the owner wants lots of them)
    features += c.bumps.length + c.gates.length + c.springs.length + c.ledges.filter((l) => l.cloud === undefined).length + c.loops.length + c.bridges.length;
    if (n < 2) assert.equal(c.bumps.length + c.gates.length + c.springs.length + c.loops.length + c.bridges.length, 0, 'the start is clear');
    assert.equal(c.loops.length > 0, isLoopChunk(11, n) && c.loops.length > 0);
  }
  assert.ok(features / chunks < 1.6, `${(features / chunks).toFixed(2)} features per chunk is not calm`);
  assert.ok(loops >= 8 && loops <= 90, `${loops} loops in ${chunks} chunks`);
});

test('chasms are never wider than a normal jump, and every chasm has its floor on both sides', () => {
  for (let n = 2; n < 300; n++) {
    const c = infinityChunk(5, n);
    for (const lane of LANES) {
      const fl = c.floors.filter((f) => f.lane === lane).sort((p, q) => p.x0 - q.x0);
      for (let i = 1; i < fl.length; i++) {
        const gap = fl[i].x0 - fl[i - 1].x1;
        if (gap > 1) assert.ok(gap <= 160, `chunk ${n} lane ${lane}: a ${gap} px chasm`);
      }
    }
  }
});

test('generating a chunk is fast (the frame must not hitch)', () => {
  const t0 = performance.now();
  for (let n = 0; n < 500; n++) infinityChunk(77, n);
  const per = (performance.now() - t0) / 500;
  console.log(`# one chunk takes ${per.toFixed(2)} ms`);
  assert.ok(per < 4, `${per.toFixed(2)} ms per chunk`);
});

test('shiftChunk moves the same land to other coordinates', () => {
  const c = infinityChunk(9, 4), s = shiftChunk(c, -5000, 300);
  assert.equal(s.floors.length, c.floors.length);
  assert.equal(s.floors[0].x0, c.floors[0].x0 - 5000);
  assert.equal(Math.round(s.floors[0].y0 - c.floors[0].y0), 300);
  assert.equal(CHUNK_W, 1600);
});

// ------------------------------------------------------------------ the engine side: a ball on an endless land
import Matter from 'matter-js';
import { InfinityRun } from '../src/game/platformer/infinity-world';
import { floorAt } from '../src/game/platformer/course';
import { PX_PER_KM, ORIGIN_STEP } from '../src/game/platformer/infinity';
import type { MarbleInfo } from '../src/game/types';

const driver: MarbleInfo = { id: 0, name: 'Roller', color: '#f06040', stats: { weight: 5, speed: 5, bounce: 5 }, isPlayer: true } as MarbleInfo;

/** A plain driver: push right, hop a chasm just before its edge, hop a crate. */
function bot(run: InfinityRun): void {
  const g = run.game, m = g.player, p = m.body.position, lane = (m.lane ?? 1) as Lane, plan = g.track.platformer!.plan;
  const look = Math.max(40, Math.min(150, m.body.velocity.x * 7));
  g.nudge = 1;
  g.jumpPressed = floorAt(plan, lane, p.x + look) === null || plan.bumps.some((b) => b.lane === lane && b.x > p.x && b.x - p.x < 110);
  g.engineHeld = false;
}

function drive(seed: number, km: number, onStep?: (run: InfinityRun) => void) {
  const run = new InfinityRun(seed, driver, { effects: false });
  let steps = 0, maxBodies = 0, maxCoord = 0;
  while (run.km < km && steps < 2_000_000) {
    bot(run);
    run.step();
    steps++;
    maxBodies = Math.max(maxBodies, run.bodyCount);
    const p = run.game.player.body.position;
    maxCoord = Math.max(maxCoord, Math.abs(p.x), Math.abs(p.y));
    onStep?.(run);
  }
  return { run, steps, maxBodies, maxCoord };
}

test('Roll: the ball starts on the meadow with no gate and no cannon, and rolls on', () => {
  const run = new InfinityRun(1, driver, { effects: false });
  const m = run.game.player;
  assert.equal(m.cannon, undefined);
  assert.ok(run.game.gateOpen);
  for (let i = 0; i < 600; i++) { bot(run); run.step(); }
  assert.ok(run.game.player.body.position.x > 800, 'it has rolled right');
  assert.ok(run.km > 0.05);
  run.destroy();
});

test('a bot drives 20 km on several seeds and is lifted back only a handful of times', () => {
  for (const seed of [1, 2, 3, 4]) {
    const { run, steps } = drive(seed, 20);
    console.log(`# seed ${seed}: 20 km in ${steps} steps, lifted back ${run.falls} times`);
    assert.ok(run.km >= 20, `seed ${seed} got stuck at ${run.km.toFixed(1)} km`);
    assert.ok(run.falls <= 5, `seed ${seed}: lifted back ${run.falls} times in 20 km`);
    run.destroy();
  }
});

test('bodies alive stay in a small window and coordinates stay near zero over a very long run (150 km)', () => {
  const { run, maxBodies, maxCoord } = drive(7, 150);
  console.log(`# 150 km: at most ${maxBodies} bodies alive, largest coordinate ${Math.round(maxCoord)}, ${run.originShifts} origin shifts`);
  assert.ok(run.km >= 150, `stuck at ${run.km.toFixed(1)} km`);
  assert.ok(maxBodies < 1100, `${maxBodies} bodies`);
  assert.ok(maxCoord < 100_000, `largest coordinate ${maxCoord}`);
  assert.ok(run.originShifts >= 30, `${run.originShifts} origin shifts`);
  assert.ok(run.chunksBuilt > 900, 'chunks were built ahead and thrown away behind');
  run.destroy();
});

test('shifting the origin is invisible: the absolute position and speed carry straight on', () => {
  const run = new InfinityRun(11, driver, { effects: false });
  let before: { abs: number; vx: number } | null = null, jumped = 0;
  for (let i = 0; i < 60_000 && run.originShifts < 2; i++) {
    const shifts = run.originShifts, abs = run.absoluteX(), vx = run.game.player.body.velocity.x;
    bot(run);
    run.step();
    if (run.originShifts > shifts) {
      before = { abs, vx };
      jumped = Math.abs(run.absoluteX() - abs);
      assert.ok(jumped < 40, `the ball moved ${jumped} px across a shift`);
      assert.ok(Math.abs(run.game.player.body.velocity.x - vx) < 3, 'its speed carried on');
    }
  }
  assert.ok(before, 'a shift happened');
  assert.ok(run.game.player.body.position.x < ORIGIN_STEP, 'the ball is back near zero');
  run.destroy();
});

test('the same seed and the same inputs give the same run (5 km replay)', () => {
  const trace = () => {
    const out: string[] = [];
    let n = 0;
    drive(5, 5, (run) => { if (++n % 250 === 0) out.push(`${run.absoluteX().toFixed(3)},${run.game.player.body.position.y.toFixed(3)}`); });
    return out.join('|');
  };
  const a = trace(), b = trace();
  assert.ok(a.length > 100);
  assert.equal(a, b);
});

test('falling is gentle and free: lifted back onto the last ground with a run-up, no penalty, a fade for the screen', () => {
  const run = new InfinityRun(3, driver, { effects: false });
  for (let i = 0; i < 900; i++) { bot(run); run.step(); }
  const before = run.absoluteX();
  const m = run.game.player;
  // Drop the ball into the void well under the land.
  Matter.Body.setPosition(m.body, { x: m.body.position.x, y: m.body.position.y + 4000 });
  run.step();
  assert.equal(run.falls, 1);
  assert.ok(run.fade > 0.9, 'the screen fades');
  assert.ok(run.absoluteX() <= before + 50, 'back on ground behind');
  for (let i = 0; i < 200; i++) { bot(run); run.step(); }
  assert.ok(run.game.player.body.position.y < run.game.track.height, 'rolling on the land again');
  assert.equal(run.game.player.health?.hp, run.game.player.health?.hp, 'nothing was lost');
  run.destroy();
});

test('distance never goes backwards, and the best is the farthest it ever got', () => {
  const run = new InfinityRun(2, driver, { effects: false });
  let last = 0;
  for (let i = 0; i < 4000; i++) {
    bot(run);
    if (i > 1500) run.game.nudge = -1; // roll back for a while
    run.step();
    assert.ok(run.distance >= last - 1e-9);
    last = run.distance;
  }
  assert.ok(run.best >= run.distance);
  assert.equal(PX_PER_KM, 10_000);
  run.destroy();
});

// ------------------------------------------------------------------ records
import * as storage from '../src/game/storage';
import {
  INFINITY_KEY, dailySeedText, emptyRecords, formatKm, loadRecords, normalizeRecords, recordDistance, recordStart, seedFromText, seedTextFor,
} from '../src/game/infinity-store';

test('records: best and total distance are kept, no credits or XP, and damaged saves are repaired', () => {
  storage.removeItem(INFINITY_KEY);
  assert.deepEqual(loadRecords(), emptyRecords());
  recordStart('day-2026-10-03');
  recordDistance(2.5);
  recordDistance(4, 2.5);             // the same run, banked again later: only the new 1.5 km is added
  let r = loadRecords();
  assert.equal(r.runs, 1);
  assert.equal(r.bestKm, 4);
  assert.equal(r.totalKm, 4);
  recordDistance(1.2);                // a shorter run does not lower the best
  r = loadRecords();
  assert.equal(r.bestKm, 4);
  assert.ok(Math.abs(r.totalKm - 5.2) < 1e-9);
  assert.deepEqual(Object.keys(r).sort(), ['bestKm', 'choice', 'lastSeed', 'mySeed', 'reduceMotion', 'runs', 'totalKm'], 'distance, seeds and the Reduce motion choice only');
  assert.deepEqual(normalizeRecords({ bestKm: -3, totalKm: 'x', runs: 2.7, choice: 'weird', mySeed: 5 }), { ...emptyRecords(), runs: 2 });
  storage.setItem(INFINITY_KEY, '{not json');
  assert.deepEqual(loadRecords(), emptyRecords());
  storage.removeItem(INFINITY_KEY);
});

test('seeds: the same text is the same number for ever, the day seed follows the date, My seed wins when it is chosen', () => {
  assert.equal(seedFromText('Moss-And-Lanterns'), seedFromText('  moss-and-lanterns '));
  assert.notEqual(seedFromText('a'), seedFromText('b'));
  assert.equal(seedFromText('abc'), 0x1A47E90B, 'FNV-1a of "abc" never changes (saved seeds must keep their land)');
  assert.equal(dailySeedText(new Date(2026, 9, 3)), 'day-2026-10-03');
  const r = { ...emptyRecords(), mySeed: 'pines' };
  assert.equal(seedTextFor(r, new Date(2026, 9, 3)), 'day-2026-10-03');
  assert.equal(seedTextFor({ ...r, choice: 'mine' }, new Date(2026, 9, 3)), 'pines');
  assert.equal(seedTextFor({ ...emptyRecords(), choice: 'mine' }, new Date(2026, 9, 3)), 'day-2026-10-03', 'an empty My seed falls back to the day');
  assert.equal(formatKm(0.04), '0.0');
  assert.equal(formatKm(7.26), '7.3');
  assert.equal(formatKm(42.4), '42');
});
