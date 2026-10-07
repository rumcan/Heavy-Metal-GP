// Run with: node --import tsx --test tests/crossing-ride.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { TRACK_THEMES } from '../src/game/types';
import type { MarbleInfo } from '../src/game/types';
import { trackFromPlan } from '../src/game/platformer/build';
import { newPlatformerDef, planFromTrackDef } from '../src/game/platformer/def';
import { KIT_HALF_PITCH, KIT_R, loopKit, overpassKit } from '../src/game/platformer/track-kits';
import type { Piece } from '../src/game/trackdef';
import { ALL_PLY } from '../src/game/lanes';

const Y = 800, X = 2000;
const driver: MarbleInfo = { id: 0, name: 'Tester', color: '#ff0000', stats: { weight: 5, speed: 5, bounce: 5 }, isPlayer: true } as MarbleInfo;

/** A course of just `pieces` (plus the start platform and the run-out every course has, far from X). */
function course(pieces: Piece[]) {
  const def = { ...newPlatformerDef('Ride', 6000), pieces };
  return trackFromPlan(planFromTrackDef(def), 1, TRACK_THEMES.forest);
}

/** Put the player at (x, y) moving at (vx, vy) and step `steps`; no steering. Returns the trace. */
function ride(pieces: Piece[], x: number, y: number, vx: number, vy: number, steps: number, before?: (game: Game) => void) {
  const game = new Game(1, [driver], { track: course(pieces), recovery: false, effects: false, aiItems: false });
  game.start();
  game.openGate();
  const m = game.player;
  m.lane = 1;
  m.cannon = undefined;
  before?.(game);
  Matter.Body.setPosition(m.body, { x, y });
  Matter.Body.setVelocity(m.body, { x: vx, y: vy });
  const trace: { x: number; y: number }[] = [];
  for (let i = 0; i < steps; i++) { game.step(PHYSICS_STEP); trace.push({ x: m.body.position.x, y: m.body.position.y }); }
  game.destroy?.();
  return trace;
}

const FLAT = Y - 14;
const top = (t: { y: number }[]) => Math.min(...t.map((p) => p.y));

test('a fast ball rides the loop', () => {
  const t = ride(loopKit(X, Y), X - 400, Y - 15, 14, 0, 900);
  assert.ok(top(t) < Y - 2 * KIT_R + 40, `top ${top(t)}`);
  const hi = t.findIndex((p) => p.y === top(t));
  assert.ok(t.slice(hi).some((p) => p.x > X + KIT_HALF_PITCH + 150 && Math.abs(p.y - FLAT) < 8), 'out along the run-out');
});

test('a slow ball falls back', () => {
  const t = ride(loopKit(X, Y), X - 400, Y - 15, 6, 0, 900);
  assert.ok(top(t) >= Y - 2 * KIT_R + 40, `top ${top(t)}`);
  const hi = t.findIndex((p) => p.y === top(t));
  assert.ok(t.slice(hi).some((p) => p.x < X - 150 && Math.abs(p.y - FLAT) < 8), 'back on the run-up');
});

test('under the overpass the ball never touches the dive', () => {
  const t = ride(overpassKit(X, Y), X - 450, Y - 15, 8, 0, 300);
  for (const p of t) if (p.x > X - 300 && p.x < X + 300) assert.ok(Math.abs(p.y - FLAT) < 6, `y ${p.y} at x ${p.x}`);
});

test('down the dive through the flat track', () => {
  const t = ride(overpassKit(X, Y), X - 380, Y - 200 + (20 * 200) / 400 - 15, 4, 0, 600);
  assert.ok(t[t.length - 1].y > Y + 100, `y ${t[t.length - 1].y}`);
});

test('a jump under the overpass lands back on its own track', () => {
  let jumped = false;
  const game = new Game(1, [driver], { track: course(overpassKit(X, Y)), recovery: false, effects: false, aiItems: false });
  game.start();
  game.openGate();
  const m = game.player;
  m.lane = 1;
  m.cannon = undefined;
  Matter.Body.setPosition(m.body, { x: X - 450, y: Y - 15 });
  Matter.Body.setVelocity(m.body, { x: 8, y: 0 });
  const trace: { x: number; y: number }[] = [];
  for (let i = 0; i < 300; i++) {
    if (!jumped && m.body.position.x > X - 40) { jumped = true; Matter.Body.setVelocity(m.body, { x: m.body.velocity.x, y: -7 }); }
    game.step(PHYSICS_STEP);
    trace.push({ x: m.body.position.x, y: m.body.position.y });
  }
  game.destroy?.();
  assert.ok(jumped);
  assert.ok(trace.every((p) => p.y > FLAT - 120), 'never landed on the dive');
  const after = trace.filter((p) => p.x > X + 100);
  assert.ok(after.some((p) => Math.abs(p.y - FLAT) < 6), 'back on its own track');
});

test('front catches a ball from the air', () => {
  const drop = (pieces: Piece[]) => ride(pieces, X + 60, Y - 20, 0, 0, 120);
  assert.ok(drop(overpassKit(X, Y)).some((p) => p.y > Y + 5), 'the dive (in front) caught it');
  assert.ok(drop(overpassKit(X, Y).reverse()).every((p) => p.y < Y - 5), 'the flat track (in front) caught it');
});

test('a course without crossings is untouched', () => {
  const game = new Game(1, [driver], { track: course([{ t: 'ramp', a: [900, 800], b: [3000, 900] }]), recovery: false, effects: false, aiItems: false });
  game.start();
  game.openGate();
  const m = game.player;
  m.lane = 1;
  m.cannon = undefined;
  Matter.Body.setPosition(m.body, { x: 1200, y: 780 });
  for (let i = 0; i < 10; i++) game.step(PHYSICS_STEP);
  assert.equal(m.passage, undefined);
  assert.equal(m.body.collisionFilter.mask! & ALL_PLY, ALL_PLY);
  game.destroy?.();
});
