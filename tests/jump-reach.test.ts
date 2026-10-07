// Run with: node --import tsx --test tests/jump-reach.test.ts
// The owner: a jump still counts with a little air between the ball and the track (up to half a ball).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import { Game } from '../src/game/engine';
import { MARBLE_RADIUS, TRACK_THEMES } from '../src/game/types';
import type { MarbleInfo } from '../src/game/types';
import { trackFromPlan } from '../src/game/platformer/build';
import type { CoursePlan, Floor } from '../src/game/platformer/course';
import { JUMP_REACH, applyLaneMask, nearGround } from '../src/game/engine/platformer';

const Y = 600;
const driver: MarbleInfo = { id: 0, name: 'Tester', color: '#ff0000', stats: { weight: 5, speed: 5, bounce: 5 }, isPlayer: true } as MarbleInfo;
const floors: Floor[] = [0, 1, 2].map((lane) => ({ lane: lane as 0, x0: -200, y0: Y, x1: 4200, y1: Y }));
const plan: CoursePlan = { seed: 0, width: 3800, height: Y + 900, floors, bumps: [], gates: [], path: [{ x: 0, y: Y - 30 }, { x: 3800, y: Y - 30 }], startX: 520, startY: Y, finishX: 3500, finishY: Y };

function ballAt(gap: number) {
  const game = new Game(1, [driver], { track: trackFromPlan(plan, 1, TRACK_THEMES.forest), recovery: false, effects: false, aiItems: false });
  const m = game.player;
  m.lane = 1;
  m.cannon = undefined;
  applyLaneMask(game, m);
  Matter.Body.setPosition(m.body, { x: 1500, y: Y - MARBLE_RADIUS - gap });
  const near = nearGround(game, m);
  game.destroy();
  return near;
}

test('jump reach: on the track, and with up to half a ball of air, the ball can jump', () => {
  assert.equal(JUMP_REACH, MARBLE_RADIUS / 2);
  assert.ok(ballAt(0), 'resting on the track');
  assert.ok(ballAt(JUMP_REACH - 1), 'just under half a ball up');
});

test('jump reach: higher than half a ball, no jump (no jumping in mid-air)', () => {
  assert.ok(!ballAt(JUMP_REACH + 3));
  assert.ok(!ballAt(60));
});
