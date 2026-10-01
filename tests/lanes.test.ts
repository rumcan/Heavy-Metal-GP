// P2-00 (#124) battle tests, job BRAVO: the 2.5D depth-lane maths (src/game/lanes.ts).
// Three lanes are three flat 2D layers; "depth" is faked with scale, parallax, fog and blur.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LANE_BACK, LANE_MIDDLE, LANE_FRONT, LANES, laneCategory, laneMask, NON_LANE_MASK,
  laneBlend, projectToScreen, laneAlpha, drawOrder,
} from '../src/game/lanes';

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

test('lane ids and look', () => {
  assert.deepEqual([LANE_BACK, LANE_MIDDLE, LANE_FRONT], [0, 1, 2]);
  assert.deepEqual(LANES, [
    { name: 'back', scale: 0.75, parallax: 0.7, fog: 0.35, blur: 3 },
    { name: 'middle', scale: 1, parallax: 1, fog: 0, blur: 0 },
    { name: 'front', scale: 1.25, parallax: 1.35, fog: 0, blur: 0 },
  ]);
});

test('collision layers: each lane has its own category bit; masks see only their own lane plus non-lane bodies', () => {
  assert.equal(laneCategory(0), 0x1000);
  assert.equal(laneCategory(1), 0x2000);
  assert.equal(laneCategory(2), 0x4000);
  assert.equal(NON_LANE_MASK, 0x0fff);
  assert.equal(laneMask(1), 0x0fff | 0x2000);
  assert.equal(laneMask(1) & laneCategory(0), 0, 'middle never touches back');
  assert.equal(laneMask(1) & laneCategory(2), 0, 'middle never touches front');
  assert.throws(() => laneCategory(3), /lane/);
});

test('laneBlend: eases between two lanes (smoothstep), clamped', () => {
  assert.deepEqual(laneBlend(1, 2, 0), { scale: 1, parallax: 1, fog: 0, blur: 0 });
  assert.deepEqual(laneBlend(1, 2, 1), { scale: 1.25, parallax: 1.35, fog: 0, blur: 0 });
  const mid = laneBlend(1, 0, 0.5); // smoothstep(0.5) = 0.5
  assert.ok(near(mid.scale, 0.875) && near(mid.parallax, 0.85) && near(mid.fog, 0.175) && near(mid.blur, 1.5), JSON.stringify(mid));
  const q = laneBlend(1, 2, 0.25); // smoothstep(0.25) = 0.15625
  assert.ok(near(q.scale, 1 + 0.25 * 0.15625), JSON.stringify(q));
  assert.deepEqual(laneBlend(1, 2, 5), laneBlend(1, 2, 1));
  assert.deepEqual(laneBlend(1, 2, -1), laneBlend(1, 2, 0));
});

test('projectToScreen: the camera point is the screen centre in every lane', () => {
  const cam = { x: 500, y: 800, scale: 1.2 };
  const view = { w: 1000, h: 600 };
  for (const lane of [0, 1, 2]) {
    const s = projectToScreen({ x: 500, y: 800 }, lane, cam, view);
    assert.ok(near(s.x, 500) && near(s.y, 300), `lane ${lane}`);
    assert.ok(near(s.scale, 1.2 * LANES[lane].scale));
  }
});

test('projectToScreen: nearer lanes move further for the same world offset (parallax)', () => {
  const cam = { x: 0, y: 0, scale: 1 };
  const view = { w: 800, h: 400 };
  const back = projectToScreen({ x: 100, y: 50 }, 0, cam, view);
  const mid = projectToScreen({ x: 100, y: 50 }, 1, cam, view);
  const front = projectToScreen({ x: 100, y: 50 }, 2, cam, view);
  assert.ok(near(back.x, 400 + 70) && near(back.y, 200 + 35));
  assert.ok(near(mid.x, 500) && near(mid.y, 250));
  assert.ok(near(front.x, 400 + 135) && near(front.y, 200 + 67.5));
});

test('laneAlpha: your lane is solid; lanes in front of you fade more than lanes behind', () => {
  assert.equal(laneAlpha(1, 1), 1);
  assert.equal(laneAlpha(0, 1), 0.6, 'behind you');
  assert.equal(laneAlpha(2, 1), 0.85, 'in front of you');
  assert.equal(laneAlpha(2, 0), 0.85);
  assert.equal(laneAlpha(0, 2), 0.6);
});

test('drawOrder: always back to front', () => {
  assert.deepEqual(drawOrder(), [0, 1, 2]);
});
