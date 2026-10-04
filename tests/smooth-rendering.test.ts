// Run with: node --import tsx --test tests/smooth-rendering.test.ts
// Perf: in-between poses never leak into the physics, mip levels are picked only for art drawn well under its size,
// and the automatic resolution drops when frames keep arriving late and comes back when there is room.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { AI_COLORS, TRACK_THEMES, mulberry32, randomStats } from '../src/game/types';
import { buildPlatformerTrack } from '../src/game/platformer/build';
import { blendPoses, rememberPoses } from '../src/game/interpolate';
import { mipLevel } from '../src/game/mip';
import { MIN_SCALE, RenderScale } from '../src/game/render-scale';

test('in-between poses sit between the last two steps and are put back exactly', () => {
  const rng = mulberry32(2);
  const field = Array.from({ length: 4 }, (_, i) => ({ id: i, name: `AI ${i}`, color: AI_COLORS[i], stats: randomStats(rng), isPlayer: false, character: i }));
  const game = new Game(2, field, { track: buildPlatformerTrack(2, TRACK_THEMES.forest, 'rolling-hills') });
  game.start();
  game.openGate();
  for (let i = 0; i < 600; i++) game.step(PHYSICS_STEP);
  rememberPoses(game);
  const was = game.marbles.map((m) => ({ ...m.body.position }));
  game.step(PHYSICS_STEP);
  const now = game.marbles.map((m) => ({ ...m.body.position }));
  const undo = blendPoses(game, 0.25);
  game.marbles.forEach((m, i) => {
    if (Math.abs(now[i].x - was[i].x) > 120) return;
    assert.ok(Math.abs(m.body.position.x - (was[i].x + (now[i].x - was[i].x) * 0.25)) < 1e-9);
  });
  undo();
  game.marbles.forEach((m, i) => assert.deepEqual({ ...m.body.position }, now[i]));
  assert.doesNotThrow(() => blendPoses(game, 1)(), 'alpha 1 is a no-op');
});

test('mip levels only for art drawn under half its size, never below 8 px', () => {
  assert.equal(mipLevel(1, 512, 512), 0);
  assert.equal(mipLevel(0.6, 512, 512), 0);
  assert.equal(mipLevel(0.4, 512, 512), 1);
  assert.equal(mipLevel(0.2, 512, 512), 2);
  assert.equal(mipLevel(0.01, 64, 64), 3, 'stops at 8 px');
  assert.equal(mipLevel(0, 512, 512), 0);
});

test('the resolution drops when frames keep arriving late and comes back when they are on time', () => {
  const r = new RenderScale();
  for (let i = 0; i < 30; i++) r.observe(16.7);
  assert.equal(r.scale, 1);
  let changed = false;
  for (let i = 0; i < 60; i++) changed = r.observe(33) || changed;
  assert.ok(changed && r.scale < 1, `late frames lower it (now ${r.scale})`);
  for (let i = 0; i < 400; i++) r.observe(33);
  assert.ok(r.scale >= MIN_SCALE);
  for (let i = 0; i < 2000; i++) r.observe(16.7);
  assert.equal(r.scale, 1, 'back to full sharpness');
  assert.equal(r.observe(5000), false, 'a pause is ignored');
  assert.equal(r.ratio(3), 2, 'capped at 2x');
});
