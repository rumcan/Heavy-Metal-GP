// P2-00 (#124): the 2.5D depth-lane maths (src/game/lanes.ts).
// The camera stands on your lane; only lanes behind you are drawn; a lane change is a camera dolly.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LANE_BACK, LANE_MIDDLE, LANE_FRONT, LANE_STEP, LANE_LIFT,
  laneCategory, laneMask, NON_LANE_MASK,
  dollyEase, laneFocus, laneView, visibleLanes, projectToScreen,
} from '../src/game/lanes';

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

test('lane ids', () => {
  assert.deepEqual([LANE_BACK, LANE_MIDDLE, LANE_FRONT], [0, 1, 2]);
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

test('laneView: the lane you are on is full size, sharp, clear, solid — whichever lane it is', () => {
  for (const l of [0, 1, 2]) {
    assert.deepEqual(laneView(l, l), { scale: 1, lift: -0, fog: 0, blur: 0, alpha: 1 });
  }
});

test('laneView: lanes behind you are smaller, higher, hazed and blurred, one step per lane', () => {
  const one = laneView(1, 2);
  assert.ok(near(one.scale, LANE_STEP) && near(one.lift, -LANE_LIFT) && near(one.fog, 0.55) && near(one.blur, 0), 'hazed, not blurred');
  assert.equal(one.alpha, 1);
  const two = laneView(0, 2);
  assert.ok(near(two.scale, LANE_STEP * LANE_STEP) && near(two.fog, 0.85), 'fog capped');
});

test('laneView: a lane in front of the camera fades out fast (only seen while you dive away from it)', () => {
  assert.equal(laneView(2, 1).alpha, 0);
  assert.ok(near(laneView(2, 1.8).alpha, 1 - 0.2 * 1.5));
  assert.ok(near(laneView(2, 1.8).scale, Math.pow(LANE_STEP, -0.2) * 1.16), 'it swells past the camera');
});

test('visibleLanes: never a lane in front of you', () => {
  assert.deepEqual(visibleLanes(0), [0]);
  assert.deepEqual(visibleLanes(1), [0, 1]);
  assert.deepEqual(visibleLanes(2), [0, 1, 2]);
  assert.deepEqual(visibleLanes(1.7), [0, 1, 2], 'mid-dive the old front lane is still fading out');
});

test('dolly: eased, clamped; focus goes from the old lane to the new one', () => {
  assert.equal(dollyEase(0), 0);
  assert.equal(dollyEase(1), 1);
  assert.equal(dollyEase(0.5), 0.5);
  assert.ok(dollyEase(0.1) < 0.1, 'slow start');
  assert.equal(dollyEase(-3), 0);
  assert.equal(dollyEase(9), 1);
  assert.equal(laneFocus(2, 1, 0), 2);
  assert.equal(laneFocus(2, 1, 1), 1);
  assert.equal(laneFocus(2, 1, 0.5), 1.5);
});

test('projectToScreen: the camera point of the focused lane is the screen centre', () => {
  const view = { w: 1000, h: 600 };
  for (const l of [0, 1, 2]) {
    const s = projectToScreen({ x: 500, y: 800 }, l, { x: 500, y: 800, zoom: 1.2, focus: l }, view);
    assert.ok(near(s.x, 500) && near(s.y, 300) && near(s.scale, 1.2), `lane ${l}`);
  }
});

test('projectToScreen: a lane behind you moves less (parallax) and sits higher', () => {
  const view = { w: 800, h: 400 };
  const cam = { x: 0, y: 0, zoom: 1, focus: 1 };
  const mine = projectToScreen({ x: 100, y: 0 }, 1, cam, view);
  const back = projectToScreen({ x: 100, y: 0 }, 0, cam, view);
  assert.ok(near(mine.x, 500));
  assert.ok(near(back.x, 400 + 100 * LANE_STEP));
  assert.ok(near(back.y, 200 - LANE_LIFT));
});
