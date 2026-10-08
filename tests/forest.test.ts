// Run with: node --import tsx --test tests/forest.test.ts
// The foreground forest and the owner's islands (src/game/platformer/forest.ts):
// - the tree line follows the track's hills and never moves against it, and does NOT move when the camera zooms
//   itself with your speed (the owner: "make sure the tree line DOES NOT MOVE DOWN");
// - an island never bobs and never sinks into the trees or rises out of them as it passes;
// - islands only stand over a quiet stretch of track.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ISLAND_PARALLAX, ISLAND_QUIET_REACH, ISLAND_SLOT_W, busyStretches, forestLine, islandSpots, islandWidth, quietTest } from '../src/game/platformer/forest';
import type { ForestView, IslandEnv, IslandPick } from '../src/game/platformer/forest';
import { infinityChunk } from '../src/game/platformer/infinity';
import type { CoursePlan } from '../src/game/platformer/course';

const CW = 1280, CH = 720;
/** A straight downhill track (Infinity's mean grade is 0.1): world y at world x. */
const slope = (g: number, c = 600) => (x: number) => c + g * x;
/** Infinity's camera: on the track at its centre, 15 px above it. */
const camOn = (ground: (x: number) => number | null, x: number, scale: number): ForestView => ({ x, y: (ground(x) ?? 0) - 15, scale });

test('the tree line does not move when the camera zooms itself with your speed (only the 15 px the camera frames above the track)', () => {
  const g = slope(0.1);
  const fs = 1.25, depth = 130 * fs;
  for (const x of [1000, 5000, 20000]) {
    const slow = forestLine(g, camOn(g, x, 1.56), CW, CH, depth, 0);
    const fast = forestLine(g, camOn(g, x, 0.86), CW, CH, depth, 0);
    // at the middle of the screen: the track's own lock (15 px times the zoom change) is all that moves
    assert.ok(Math.abs(slow(CW / 2) - fast(CW / 2)) <= 15 * (1.56 - 0.86) + 0.5, `${slow(CW / 2)} vs ${fast(CW / 2)}`);
  }
});

test('the tree line is angled with every hill and never moves against the track: a fixed depth below it on screen', () => {
  // rolling hills like Infinity's (a big swell and a ripple)
  const hills = (x: number) => 600 + 0.1 * x + 90 * Math.sin(x / 1100) + 20 * Math.sin(x / 400);
  for (const camX of [3000, 3400, 9000]) {
    const view = camOn(hills, camX, 1.1);
    const line = forestLine(hills, view, CW, CH, 160, 0);
    for (let sx = 0; sx <= CW; sx += 40) {
      const track = CH / 2 + (hills(view.x + (sx - CW / 2) / view.scale) - view.y) * view.scale;
      assert.ok(Math.abs(line(sx) - (track + 160)) < 2.5, `at ${sx}: line ${line(sx).toFixed(1)}, track + depth ${(track + 160).toFixed(1)}`);
    }
  }
});

test('the tree line holds over a gap and is eased over a step (never a tower), and takes the first ground left of the start', () => {
  const stepped = (x: number) => (x > 4000 && x < 4300 ? null : x < 5000 ? 600 : 300);
  const view: ForestView = { x: 4800, y: 585, scale: 1 };
  const line = forestLine(stepped, view, CW, CH, 100, 0);
  for (let sx = 0; sx < CW; sx += 24) assert.ok(Math.abs(line(sx + 24) - line(sx)) <= 24 * 0.6 + 0.01, `steep at ${sx}`);
  const gapAt = CW / 2 + (4150 - view.x) * view.scale;
  const leftOfGap = CW / 2 + (3990 - view.x) * view.scale;
  assert.ok(Math.abs(line(gapAt) - line(leftOfGap)) < 1, 'over the gap the line holds the height to its left');
});

// ------------------------------------------------------------------ islands
const PICK: IslandPick = { art: 0, at: 0.5, size: 0.5, sink: 0.5 };
function env(ground: (x: number) => number | null, over: Partial<IslandEnv> = {}): IslandEnv {
  return { groundAt: ground, treeDrop: 200, quiet: () => true, fs: 1.25, pick: () => PICK, widthOf: () => 400, aspect: () => 0.75, ...over };
}

test('on a steady slope an island keeps the same height in the trees all the way across the screen (no sinking), and never bobs', () => {
  const g = slope(0.12);
  const fs = 1.25, depth = 130 * fs, frontDrop = (168 - 130) * 1.35 * fs;
  const e = env(g, { treeDrop: depth + frontDrop });
  let gap0: number | null = null, top0: number | null = null, y0 = 0;
  let seen = 0;
  // the camera rolls down the hill past slot 4's island
  for (let camX = 3 * ISLAND_SLOT_W; camX < 7 * ISLAND_SLOT_W; camX += 37) {
    const view = camOn(g, camX, 1.0);
    const spots = islandSpots(view, CW, CH, e).filter((s) => Math.abs(s.x - CW / 2) < CW * 0.6);
    const line = forestLine(g, view, CW, CH, depth, 0);
    for (const s of spots) {
      // the island of slot 4 (its spot at its own depth: the screen x back through the islands' parallax)
      if (Math.floor((camX + (s.x - CW / 2) / (view.scale * ISLAND_PARALLAX)) / ISLAND_SLOT_W) !== 4) continue;
      seen++;
      const trees = line(s.x) + frontDrop; // the front row's tops where the island stands
      const gap = s.top - trees;
      if (gap0 === null) { gap0 = gap; top0 = s.top; y0 = view.y; }
      assert.ok(Math.abs(gap - gap0) < 1.5, `the island moved against the trees by ${(gap - gap0).toFixed(2)} px`);
      // rigid: its height changes only as the camera's does, times its depth
      assert.ok(Math.abs((s.top - top0!) + (view.y - y0) * view.scale * ISLAND_PARALLAX) < 0.5, 'the island bobbed');
    }
  }
  assert.ok(seen > 20, `the island was on screen for ${seen} frames`);
});

test('islands are big but a little smaller than before: half to two thirds of the screen, never more than 0.9 of it', () => {
  for (const [cw, ch] of [[1280, 720], [1920, 1080], [375, 812], [812, 375]]) {
    for (const size of [0, 0.5, 1]) for (const art of [250, 400, 560]) {
      const w = islandWidth(cw, ch, size, art);
      assert.ok(w <= cw * 0.9 + 1e-6, `${w} on ${cw}`);
      assert.ok(w >= Math.min(cw * 0.9, Math.max(cw, ch * 1.3) * 0.42 * Math.sqrt(250 / 400)) - 1e-6);
    }
  }
});

test('islands only stand where nothing is going on on the track they cover on their way across the screen', () => {
  const g = slope(0.1);
  const slot = 5, wx = (slot + 0.4 + 0.2 * PICK.at) * ISLAND_SLOT_W;
  const reach = ISLAND_QUIET_REACH;
  const at = (busy: [number, number][]) => {
    const q = quietTest(busy);
    return islandSpots(camOn(g, wx, 1.0), CW, CH, env(g, { quiet: q })).length;
  };
  assert.equal(at([]), 1, 'a quiet stretch: the island is there');
  assert.equal(at([[wx + reach - 50, wx + reach + 50]]), 0, 'something at the edge of its reach: no island');
  assert.equal(at([[wx - 20, wx + 20]]), 0, 'something right behind it: no island');
  assert.equal(at([[wx + reach + 50, wx + reach + 400]]), 1, 'something past its reach: the island is there');
});

test('quietTest: clear and busy stretches', () => {
  const q = quietTest([[100, 200], [150, 300], [1000, 1100]]);
  assert.equal(q(0, 99), true);
  assert.equal(q(0, 100), false);
  assert.equal(q(301, 999), true);
  assert.equal(q(250, 260), false);
  assert.equal(q(1101, 5000), true);
  assert.equal(quietTest([])(0, 1e9), true);
});

/** An Infinity stretch of land as one plan (chunks from..to). */
function infinityPlan(seed: number, from: number, to: number): CoursePlan {
  const chunks = Array.from({ length: to - from }, (_, i) => infinityChunk(seed, from + i));
  return {
    seed, style: 'flow', width: chunks[chunks.length - 1].x1, height: 1e6,
    floors: chunks.flatMap((c) => c.floors), bumps: [], gates: chunks.flatMap((c) => c.gates), ledges: chunks.flatMap((c) => c.ledges),
    springs: chunks.flatMap((c) => c.springs), loops: chunks.flatMap((c) => c.loops), bridges: chunks.flatMap((c) => c.bridges),
    boosts: [], kickers: chunks.flatMap((c) => c.kickers), rings: [], pits: chunks.flatMap((c) => c.pits),
    path: [], startX: 520, startY: 600, finishX: 1e12, finishY: 1e12,
  } as unknown as CoursePlan;
}

test('over Infinity land: islands come round now and then, and never over a loop, a pit, a gap or a lane ramp', () => {
  for (const seed of [1, 7, 2026]) {
    const plan = infinityPlan(seed, 2, 260); // about 41 km
    const busy = busyStretches(plan), q = quietTest(busy);
    let islands = 0;
    for (let slot = 0; slot * ISLAND_SLOT_W < plan.width; slot++) {
      const wx = (slot + 0.5) * ISLAND_SLOT_W, reach = ISLAND_QUIET_REACH;
      if (wx - reach < 3200 || !q(wx - reach, wx + reach)) continue;
      islands++;
      for (const l of plan.loops ?? []) assert.ok(l.x + (l.pitch ?? 0) + 250 < wx - reach || l.x - 250 > wx + reach, 'an island over a loop');
      for (const p of plan.pits ?? []) assert.ok(p.x1 < wx - reach || p.x0 > wx + reach, 'an island over a pit');
      for (const gt of plan.gates) assert.ok(gt.x + gt.w < wx - reach || gt.x > wx + reach, 'an island over a lane ramp');
    }
    const slots = Math.floor(plan.width / ISLAND_SLOT_W);
    console.log(`# seed ${seed}: an island over ${islands} of ${slots} slots (41 km)`);
    assert.ok(islands >= 25, `seed ${seed}: only ${islands} islands in 41 km (the owner saw none in 10 km)`);
  }
});
