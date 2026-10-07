// Run with: node --import tsx --test tests/crossings.test.ts
// Crossing tracks: rails, crossing zones and passages, built from a Workshop def (side-scrolling courses).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Piece, TrackDef } from '../src/game/trackdef';
import { SEG_MAX, isRail, piecePoints, ridePoints } from '../src/game/platformer/crossings';
import { defFromPlan, newPlatformerDef, planFromTrackDef, settle } from '../src/game/platformer/def';
import { planBodies } from '../src/game/platformer/build';
import { PLATFORMER_COURSES, planOfficial } from '../src/game/platformer/course';
import { loopKit, overpassKit } from '../src/game/platformer/track-kits';
import { meta } from '../src/game/track';

const defOf = (pieces: Piece[]): TrackDef => ({ ...newPlatformerDef('Test', 4000), pieces });

test('isRail: valleys and left-running floors are not rails; turn-backs and uprights are', () => {
  assert.equal(isRail(piecePoints({ t: 'curve', a: [0, 0], c: [300, 120], b: [600, 0] })!), false);
  assert.equal(isRail(piecePoints({ t: 'curve', a: [0, 0], c: [400, 0], b: [100, -300] })!), true);
  assert.equal(isRail(piecePoints({ t: 'ramp', a: [100, 0], b: [100, -200] })!), true);
  assert.equal(isRail(piecePoints({ t: 'curve', a: [600, 0], c: [300, 120], b: [0, 0] })!), false);
});

test('ridePoints: a floor is ridden left to right, a rail as stored, no segment longer than SEG_MAX', () => {
  const floor = ridePoints({ t: 'ramp', a: [500, 0], b: [0, 0] })!;
  assert.equal(floor.rail, false);
  assert.ok(floor.pts[0].x < floor.pts[floor.pts.length - 1].x);
  const rail = ridePoints({ t: 'ramp', a: [100, 0], b: [100, -200] })!;
  assert.equal(rail.rail, true);
  assert.deepEqual(rail.pts[0], { x: 100, y: 0 });
  assert.deepEqual(rail.pts[rail.pts.length - 1], { x: 100, y: -200 });
  for (const r of [floor, rail]) for (let i = 1; i < r.pts.length; i++) assert.ok(Math.hypot(r.pts[i].x - r.pts[i - 1].x, r.pts[i].y - r.pts[i - 1].y) <= SEG_MAX + 0.01);
});

test('loop kit: six lines, one crossing of two passages, the run-up joins the first curve', () => {
  const plan = planFromTrackDef({ ...newPlatformerDef('Loop', 4000), pieces: loopKit(1600, 800) });
  assert.equal(plan.tracks!.length, 6);
  assert.equal(plan.tracks!.filter((l) => l.rail).length, 4);
  assert.equal(plan.crossings!.length, 1);
  const z = plan.crossings![0];
  assert.equal(z.passages.length, 2);
  assert.notEqual(z.passages[0].bit, z.passages[1].bit);
  const sources = (i: number) => new Set(z.passages[i].runs.map(([li]) => plan.tracks![li].source));
  const has = (s: number) => [0, 1].find((i) => sources(i).has(s))!;
  assert.equal(has(0), has(1));
  assert.equal(has(4), has(5));
  assert.notEqual(has(0), has(4));
  assert.ok(1600 >= z.x0 && 1600 <= z.x1 && 790 >= z.y0 && 790 <= z.y1);
  assert.ok(!plan.floors.some((f) => f.x0 >= 1500 && f.x1 <= 1700 && f.y0 < 700), "the loop's top is not ground");
});

test('overpass kit: one crossing, the dive is in front', () => {
  const plan = planFromTrackDef(defOf(overpassKit(1600, 800)));
  assert.equal(plan.crossings!.length, 1);
  const z = plan.crossings![0];
  assert.equal(z.passages.length, 2);
  const depthOfSource = (s: number) => z.passages.find((P) => P.runs.some(([li]) => plan.tracks![li].source === s))!.depth;
  assert.ok(depthOfSource(1) > depthOfSource(0));
});

test('parallel decks are not a crossing', () => {
  const plan = planFromTrackDef(defOf([{ t: 'ramp', a: [1000, 800], b: [2000, 800] }, { t: 'ramp', a: [1000, 740], b: [2000, 740] }]));
  assert.equal(plan.crossings, undefined);
  assert.equal(plan.tracks, undefined);
});

test('a sloppy joint is not a crossing', () => {
  const plan = planFromTrackDef(defOf([{ t: 'ramp', a: [1000, 800], b: [1500, 800] }, { t: 'curve', a: [1490, 802], c: [1700, 900], b: [1900, 850] }]));
  assert.equal(plan.crossings, undefined);
  assert.equal(plan.tracks, undefined);
});

test('golden rule: no official course gets tracks, crossings or line bodies', () => {
  for (const c of PLATFORMER_COURSES) {
    const plan = planFromTrackDef(defFromPlan(planOfficial(c), c.id));
    assert.equal(plan.tracks, undefined, `${c.id} has tracks`);
    assert.equal(plan.crossings, undefined, `${c.id} has crossings`);
    for (const b of planBodies(plan).bodies) assert.equal(meta(b)?.line, undefined, `${c.id} has a line body`);
  }
});

test('settle keeps a spring on its own track at a crossing', () => {
  const def = defOf([...overpassKit(1600, 800), { t: 'pad', x: 1700, y: 800, w: 60, dir: 1 } as Piece]);
  const out = settle(def);
  const pad = out.pieces.find((p) => p.t === 'pad') as { y: number };
  assert.equal(pad.y, 800);
});
