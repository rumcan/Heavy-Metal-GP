// P2-02 (#108) battle test: standalone (no other repo imports), so the Arena sandbox can run it as-is.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bakeWindRotation } from '../src/game/wind-rotation';

type Vec = [number, number];
const vent = (over: Partial<{ a: Vec; b: Vec; dir: number; rot: number; flip: boolean }> = {}) =>
  ({ t: 'wind' as const, a: [340, 1000] as Vec, b: [560, 1260] as Vec, dir: 270, str: 0.34, pulse: 0, phase: 0, ...over });
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const box = (p: { a: Vec; b: Vec }) => ({
  x: Math.min(p.a[0], p.b[0]), y: Math.min(p.a[1], p.b[1]),
  w: Math.abs(p.b[0] - p.a[0]), h: Math.abs(p.b[1] - p.a[1]),
});

test('no rot: the piece comes back unchanged (same object)', () => {
  const p = vent();
  assert.equal(bakeWindRotation(p), p);
  const zero = vent({ rot: 0 });
  assert.equal(bakeWindRotation(zero), zero);
});

test('rot 90 on an upward vent: blows right, rot removed', () => {
  const out = bakeWindRotation(vent({ dir: 270, rot: 90 }));
  assert.equal(out.dir, 0);
  assert.equal('rot' in out, false, 'rot is baked in and removed');
});

test('rot adds clockwise and wraps into 0..359', () => {
  assert.equal(bakeWindRotation(vent({ dir: 270, rot: 180 })).dir, 90);
  assert.equal(bakeWindRotation(vent({ dir: 10, rot: -30 })).dir, 340);
  assert.equal(bakeWindRotation(vent({ dir: 300, rot: 450 })).dir, 30);
});

test('rot 90 turns the field area about its centre: 220×260 becomes 260×220', () => {
  const b = box(bakeWindRotation(vent({ rot: 90 })));
  assert.ok(near(b.w, 260) && near(b.h, 220), `${b.w}×${b.h}`);
  assert.ok(near(b.x + b.w / 2, 450) && near(b.y + b.h / 2, 1130), 'same centre');
});

test('rot 45: the field becomes the axis-aligned box around the turned rectangle', () => {
  const b = box(bakeWindRotation(vent({ rot: 45 })));
  const side = (220 + 260) * Math.SQRT1_2; // both extents of a 220×260 rectangle turned 45°
  assert.ok(near(b.w, side, 0.2) && near(b.h, side, 0.2), `${b.w.toFixed(2)}×${b.h.toFixed(2)}`);
  assert.ok(near(b.x + b.w / 2, 450, 0.2) && near(b.y + b.h / 2, 1130, 0.2), 'same centre');
});

test('a flipped (mirrored) vent turns the other way on screen', () => {
  // The mirror maps dir d to 180 − d when built, so the stored turn must be negated: 270 − 90 = 180, mirrored → 0 (right).
  assert.equal(bakeWindRotation(vent({ dir: 270, rot: 90, flip: true })).dir, 180);
});

test('other fields are kept', () => {
  const out = bakeWindRotation(vent({ rot: 90 }));
  assert.equal(out.str, 0.34);
  assert.equal(out.t, 'wind');
});
