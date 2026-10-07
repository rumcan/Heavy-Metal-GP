// Run with: node --import tsx --test tests/editor-joins.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Piece } from '../src/game/trackdef';
import { reverseTrack, smoothJoins, snapEnd } from '../src/components/editor/joins';
import { movePast, toFront } from '../src/components/editor/order';

test('snapEnd snaps a near end, leaves a far one, ignores other lanes', () => {
  const ramp: Piece = { t: 'ramp', a: [0, 0], b: [100, 0] };
  const near: Piece = { t: 'curve', a: [110, 6], c: [200, 50], b: [300, 0] };
  assert.deepEqual((snapEnd([ramp, near], 1, 'a') as { a: number[] }).a, [100, 0]);
  const far: Piece = { t: 'curve', a: [130, 0], c: [200, 50], b: [300, 0] };
  assert.deepEqual((snapEnd([ramp, far], 1, 'a') as { a: number[] }).a, [130, 0]);
  const other: Piece = { t: 'ramp', a: [0, 0], b: [100, 0], lane: 0 };
  assert.deepEqual((snapEnd([other, near], 1, 'a') as { a: number[] }).a, [110, 6]);
});

test('reverseTrack swaps a and b and keeps c', () => {
  const r = reverseTrack({ t: 'curve', a: [0, 0], c: [5, 6], b: [10, 0] }) as { a: number[]; b: number[]; c: number[] };
  assert.deepEqual(r.a, [10, 0]);
  assert.deepEqual(r.b, [0, 0]);
  assert.deepEqual(r.c, [5, 6]);
});

test('smoothJoins lines the bend up with the track it joins', () => {
  const pieces: Piece[] = [{ t: 'ramp', a: [0, 0], b: [100, 0] }, { t: 'curve', a: [100, 0], c: [150, -80], b: [250, -100] }];
  const c = (smoothJoins(pieces, 1) as { c: number[] }).c;
  assert.equal(c[1], 0);
  assert.ok(c[0] > 100);
});

test('toFront and movePast reorder pieces', () => {
  const p = [0, 1, 2, 3].map((x) => ({ t: 'ramp', a: [x, 0], b: [x + 1, 0] }) as Piece);
  const f = toFront(p, [1]);
  assert.deepEqual(f.pieces, [p[0], p[2], p[3], p[1]]);
  assert.equal(f.newIndex.get(1), 3);
  assert.deepEqual(movePast(p, 0, 2, 1).pieces, [p[1], p[2], p[0], p[3]]);
});
