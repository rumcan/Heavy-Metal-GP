// P2-00 (#124) battle tests, job ALPHA: progress along a course path (src/game/course-path.ts).
// In a platformer "lower = ahead" stops being true, so race order comes from distance along a path.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePath, progressAlong, pointAt, rankByProgress } from '../src/game/course-path';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// An L-shaped course: right 1000, then down 500.
const L = makePath([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 500 }]);

test('makePath: cumulative lengths and total', () => {
  assert.deepEqual(L.cum, [0, 1000, 1500]);
  assert.equal(L.length, 1500);
  assert.throws(() => makePath([{ x: 0, y: 0 }]), /two points/);
});

test('makePath: zero-length segments are dropped', () => {
  const p = makePath([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }]);
  assert.equal(p.points.length, 2);
  assert.equal(p.length, 10);
});

test('progressAlong: projects onto the closest segment', () => {
  assert.ok(near(progressAlong(L, { x: 400, y: 30 }), 400));
  assert.ok(near(progressAlong(L, { x: 1020, y: 200 }), 1200));
  assert.equal(progressAlong(L, { x: -50, y: 0 }), 0, 'clamped at the start');
  assert.equal(progressAlong(L, { x: 1000, y: 900 }), 1500, 'clamped at the end');
});

test('progressAlong: a hint keeps a marble on its own stretch of a switchback', () => {
  // Floors stacked 100 px apart: right on y=0, back left on y=100, right again on y=200.
  const S = makePath([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 200 }, { x: 1000, y: 200 }]);
  const p = { x: 500, y: 52 }; // between floor 1 and floor 2, a little closer to floor 2
  assert.ok(near(progressAlong(S, p), 1600), 'no hint: the closest segment wins');
  assert.ok(near(progressAlong(S, p, 500), 500), 'with a hint near 500: stays on floor 1 (only segments within ±400 of the hint count)');
});

test('pointAt: the point at a distance along the path (clamped)', () => {
  assert.deepEqual(pointAt(L, 250), { x: 250, y: 0 });
  assert.deepEqual(pointAt(L, 1250), { x: 1000, y: 250 });
  assert.deepEqual(pointAt(L, -5), { x: 0, y: 0 });
  assert.deepEqual(pointAt(L, 99999), { x: 1000, y: 500 });
});

test('rankByProgress: finishers first by time, then furthest along, ties by id', () => {
  const order = rankByProgress([
    { id: 0, progress: 300, finishedAt: null },
    { id: 1, progress: 1500, finishedAt: 52000 },
    { id: 2, progress: 900, finishedAt: null },
    { id: 3, progress: 1500, finishedAt: 51000 },
    { id: 4, progress: 900, finishedAt: null },
  ]);
  assert.deepEqual(order, [3, 1, 2, 4, 0]);
});
