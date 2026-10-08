// Run with: node --import tsx --test tests/forest.test.ts
// The foreground forest and the owner's islands (src/game/platformer/forest.ts):
// - the tree line follows the track's hills and never moves against it, and does NOT move when the camera zooms
//   itself with your speed (the owner: "make sure the tree line DOES NOT MOVE DOWN");
// - on a slope the trees and islands slide with the track, so they never climb up and down it against the track (the
//   owner: tilted trees moved up and down as the ball passed); on level ground they keep their depth;
// - an island never sinks into the trees or rises out of them as it passes;
// - islands only stand over a quiet stretch of track.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ISLAND_PARALLAX, ISLAND_QUIET_REACH, ISLAND_SLOT_W, ISLAND_SPOTS, PARALLAX_DRIFT, busyStretches, easeSlope, forestLine, islandSpotIn, islandSpots, islandWidth, lineSlope, quietTest, slopeParallax } from '../src/game/platformer/forest';
import type { ForestView, IslandEnv, IslandLayer, IslandPick } from '../src/game/platformer/forest';
import { chunkTracks, infinityChunk } from '../src/game/platformer/infinity';
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

/** Rolling hills like Infinity's: its mean grade, a big swell and a ripple. */
const hills = (x: number) => 600 + 0.1 * x + 90 * Math.sin(x / 1100) + 20 * Math.sin(x / 400);

/**
 * Roll the camera down `ground` and follow one pine of a row at depth `p` (the row scrolls by the camera's movement
 * times slopeParallax, as render.ts foregroundScroll does, or at its full depth with `fixed`): how far it moved up or
 * down against the track under it, per screen px the track scrolled.
 */
function climb(ground: (x: number) => number, p: number, fixed: boolean): number {
  const s = 1.0, depth = 160, step = 22;
  let camX = 2000, slope = 0, sx = CW * 0.8, against = 0, scrolled = 0;
  let line = forestLine(ground, camOn(ground, camX, s), CW, CH, depth, 0);
  for (let f = 0; f < 600; f++) {
    slope = easeSlope(slope, lineSlope(line, CW));
    const pe = fixed ? p : slopeParallax(p, slope);
    camX += step;
    const next = forestLine(ground, camOn(ground, camX, s), CW, CH, depth, 0);
    const nx = sx - step * s * pe;
    // the pine's move up or down, less the move of the track point that was under it
    against += Math.abs((next(nx) - line(sx)) - (next(sx - step * s) - line(sx)));
    scrolled += step * s;
    sx = nx < -100 ? CW * 0.9 : nx;
    line = next;
  }
  return against / scrolled;
}

test('on a slope the pines slide with the track: they never climb up and down it against the track (the owner)', () => {
  for (const p of [1.07, 1.35, 2.0]) {
    const now = climb(hills, p, false), before = climb(hills, p, true);
    console.log(`# depth ${p}: ${now.toFixed(4)} px against the track per px (it was ${before.toFixed(4)})`);
    assert.ok(now <= PARALLAX_DRIFT * 1.6, `depth ${p}: ${now.toFixed(4)} px against the track per px scrolled`);
    assert.ok(before > now * 2.5, 'the full depth on a slope did climb against the track');
  }
});

test('on level ground every row keeps its depth; on a slope it slides with the track, smoothly in between', () => {
  for (const p of PINE_DEPTHS) assert.equal(slopeParallax(p, 0), p);
  assert.ok(slopeParallax(1.35, 0.1) <= 1 + PARALLAX_DRIFT / 0.1 + 1e-9);
  let prev = slopeParallax(1.35, 0);
  for (let g = 0.001; g < 0.5; g += 0.001) { const v = slopeParallax(1.35, g); assert.ok(v <= prev + 1e-9 && prev - v < 0.05, `at ${g}`); prev = v; }
  assert.equal(slopeParallax(0.8, 0), 0.8, 'a layer slower than the track too');
  assert.ok(Math.abs(slopeParallax(0.8, 0.2) - 1) <= PARALLAX_DRIFT / 0.2 + 1e-9);
  assert.equal(lineSlope(() => 300, CW), 0);
  assert.ok(Math.abs(lineSlope((sx) => 0.25 * sx, CW) - 0.25) < 1e-6);
});
const PINE_DEPTHS = [1.03, 1.17, 1.35, 1.9];

// ------------------------------------------------------------------ islands
const PICK: IslandPick = { art: 0, at: 0.5, size: 0.5, sink: 0.5 };
function env(over: Partial<IslandEnv> = {}): IslandEnv {
  return { treesAt: () => 500, quiet: () => true, pick: () => PICK, widthOf: () => 400, aspect: () => 0.75, ...over };
}

test('an island stands in the trees where it is (never sinking into them or rising out of them) and slides with its layer', () => {
  const s = 1.0, depth = 160, drop = 50;
  let camX = 3.6 * ISLAND_SLOT_W, slope = 0;
  const layer: IslandLayer = { u: camX, pe: 1 };
  let gap0: number | null = null, lastX: number | null = null, seen = 0;
  for (let f = 0; f < 700; f++) {
    const view = camOn(hills, camX, s);
    const line = forestLine(hills, view, CW, CH, depth, 0);
    slope = easeSlope(slope, lineSlope(line, CW));
    layer.pe = slopeParallax(ISLAND_PARALLAX, slope);
    const treesAt = (sx: number) => line(sx) + drop;
    const spots = islandSpots(view, layer, CW, CH, env({ treesAt })).filter((sp) => Math.abs(sp.x - CW / 2) < CW * 0.6);
    const sp = spots.find((o) => Math.round((layer.u + (o.x - CW / 2) / s) / ISLAND_SLOT_W - 0.5) === 4);
    if (sp) {
      seen++;
      // the tops of the trees across its middle (averaged, so a wobble of one sampled point never jitters it)
      const trees = [-2, -1, 0, 1, 2].reduce((t, i) => t + treesAt(sp.x + (i * sp.w) / 10), 0) / 5;
      const gap = sp.top - trees;
      if (gap0 === null) gap0 = gap;
      assert.ok(Math.abs(gap - gap0) < 1e-6, `the island moved in the trees by ${(gap - gap0).toFixed(2)} px`);
      if (lastX !== null) assert.ok(Math.abs((lastX - sp.x) - 20 * s * layer.pe) < 1e-6, 'it slides at the speed of its layer');
      lastX = sp.x;
    }
    camX += 20;
    layer.u += 20 * slopeParallax(ISLAND_PARALLAX, easeSlope(slope, lineSlope(forestLine(hills, camOn(hills, camX, s), CW, CH, depth, 0), CW)));
    layer.pe = slopeParallax(ISLAND_PARALLAX, slope);
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

test('islands only stand where nothing is going on: at the first quiet spot of their km, none in a busy one, decided once', () => {
  const g = slope(0.1);
  const slot = 5, mid = (slot + 0.5) * ISLAND_SLOT_W, reach = ISLAND_QUIET_REACH;
  const spotOf = (busy: [number, number][]) => islandSpotIn(slot, (wx) => wx, quietTest(busy));
  assert.equal(spotOf([]), 0.5, 'a quiet km: the island in the middle of it');
  const moved = spotOf([[mid + reach - 50, mid + reach + 50]]);
  assert.ok(moved !== null && moved < 0.5 && moved > 0.4, `something at its middle: the next quiet spot (${moved})`);
  assert.equal(spotOf([[slot * ISLAND_SLOT_W, (slot + 1) * ISLAND_SLOT_W]]), null, 'a busy km: no island');
  const at = (busy: [number, number][]) => islandSpots(camOn(g, mid, 1.0), { u: mid, pe: 1 }, CW, CH, env({ quiet: quietTest(busy) })).length;
  assert.equal(at([]), 1);
  assert.equal(at([[slot * ISLAND_SLOT_W, (slot + 1) * ISLAND_SLOT_W]]), 0);
  // decided once: a slot that came up busy stays without an island (it never pops in on screen)
  const memo = new Map<number, number | null>();
  islandSpots(camOn(g, mid, 1.0), { u: mid, pe: 1 }, CW, CH, env({ quiet: () => false, memo }));
  assert.equal(islandSpots(camOn(g, mid, 1.0), { u: mid, pe: 1 }, CW, CH, env({ quiet: () => true, memo })).length, 0);
});

test('one island a km at most, never two near each other, and they grow and shrink with your zoom', () => {
  assert.ok(ISLAND_SLOT_W >= 10_000, 'a slot is a km');
  const gap = Math.min(...ISLAND_SPOTS) + (1 - Math.max(...ISLAND_SPOTS));
  assert.ok(gap * ISLAND_SLOT_W >= 3900, 'two islands are at least 0.4 km apart');
  const g = slope(0.1), mid = 5.5 * ISLAND_SLOT_W;
  const w = (zoom: number) => islandSpots(camOn(g, mid, 1.0), { u: mid, pe: 1 }, CW, CH, env({ zoom }))[0].w;
  assert.ok(Math.abs(w(2) / w(1) - 2) < 1e-9 && Math.abs(w(0.5) / w(1) - 0.5) < 1e-9);
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
    springs: chunks.flatMap((c) => c.springs), ...chunkTracks(chunks), bridges: chunks.flatMap((c) => c.bridges),
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
      const f = islandSpotIn(slot, (wx) => wx, q), reach = ISLAND_QUIET_REACH;
      if (f === null) continue;
      const wx = (slot + f) * ISLAND_SLOT_W;
      if (wx - reach < 3200) continue;
      islands++;
      (plan.tracks ?? []).forEach((t) => assert.ok(t.box.x1 + 250 < wx - reach || t.box.x0 - 250 > wx + reach, 'an island over a loop'));
      for (const p of plan.pits ?? []) assert.ok(p.x1 < wx - reach || p.x0 > wx + reach, 'an island over a pit');
      for (const gt of plan.gates) assert.ok(gt.x + gt.w < wx - reach || gt.x > wx + reach, 'an island over a lane ramp');
    }
    const slots = Math.floor(plan.width / ISLAND_SLOT_W);
    console.log(`# seed ${seed}: an island in ${islands} of ${slots} km (41 km)`);
    assert.ok(islands >= slots * 0.75, `seed ${seed}: only ${islands} islands in 41 km (the owner: one a km)`);
  }
});
