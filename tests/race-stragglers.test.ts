// Run with: node --import tsx --test tests/race-stragglers.test.ts
// A race must never wait for ever on a ball that cannot get home: a ball wedged at the foot of a loop is lifted over
// it, and drivers still out 20 s after the most recent finish are classified Did Not Finish (only computer drivers
// online). Infinity's floating origin reports how far the world moved, so the screen can carry its camera along.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { AI_COLORS, AI_NAMES, TRACK_THEMES, mulberry32, randomStats } from '../src/game/types';
import type { MarbleInfo } from '../src/game/types';
import { storyCourseId } from '../src/game/story/courses';
import { buildPlatformerTrack } from '../src/game/platformer/build';
import { floorAt } from '../src/game/platformer/course';
import { InfinityRun } from '../src/game/platformer/infinity-world';
import { ORIGIN_STEP } from '../src/game/platformer/infinity';

const field = (n: number, player = false): MarbleInfo[] => {
  const rng = mulberry32(7);
  return Array.from({ length: n }, (_, i) => ({ id: i, name: AI_NAMES[i] ?? `AI ${i}`, color: AI_COLORS[i % AI_COLORS.length], stats: randomStats(rng), isPlayer: player && i === 0, character: i % 6 }));
};

test('a ball with no speed at the foot of a loop (or hopping inside it) is lifted out past the ring, not left there', () => {
  const track = buildPlatformerTrack(1, TRACK_THEMES.forest, storyCourseId(1));
  const loop = track.platformer!.plan.loops![0];
  assert.ok(loop, 'story chapter 1 has its loop');
  for (const [dx, vx] of [[-40, 0], [20, 0], [60, 1], [-300, 4]]) {
    const game = new Game(1, field(3), { track });
    game.start();
    game.openGate();
    const m = game.marbles[1];
    m.cannon = undefined;
    m.lane = loop.lane;
    const x = loop.x + dx, y = floorAt(track.platformer!.plan, loop.lane, x) ?? loop.y;
    Matter.Body.setPosition(m.body, { x, y: y - 18 });
    Matter.Body.setVelocity(m.body, { x: vx, y: 0 });
    m.progress = undefined; m.bestProgress = undefined; m.motionAt = 0;
    for (let t = 0; t < 12000; t += PHYSICS_STEP) game.step(PHYSICS_STEP);
    assert.ok(m.body.position.x > loop.x + loop.pitch + loop.r, `started ${dx} px from the loop at ${vx}: still at ${Math.round(m.body.position.x - loop.x)}`);
    game.destroy();
  }
});

test('stragglers: 20 s after the most recent finish, everyone still out is Did Not Finish and the race ends', () => {
  const track = buildPlatformerTrack(1, TRACK_THEMES.forest, storyCourseId(1));
  const game = new Game(1, field(4), { track, stragglerCut: { ms: 20_000, humans: true } });
  game.start();
  game.openGate();
  // Two drivers can never get home: parked far behind on the grid with no way to roll.
  for (const m of game.marbles.slice(2)) { m.frozen = true; m.frozenUntil = Infinity; Matter.Body.setStatic(m.body, true); }
  let t = 0;
  for (; t < 300_000 && !game.allFinished(); t += PHYSICS_STEP) game.step(PHYSICS_STEP);
  assert.ok(game.allFinished(), 'the race ended');
  assert.equal(game.finishOrder.length, 2);
  assert.ok(game.marbles.slice(2).every((m) => m.dnf), 'the stragglers are DNF');
  const lastFinish = Math.max(...game.finishOrder.map((m) => m.finishedAt ?? 0));
  assert.ok(game.raceTime() - lastFinish >= 20_000 && game.raceTime() - lastFinish < 20_500, 'cut 20 s after the last finish');
  game.destroy();
});

test('stragglers online: a person is never cut, only computer drivers', () => {
  const track = buildPlatformerTrack(1, TRACK_THEMES.forest, storyCourseId(1));
  const game = new Game(1, field(5, true), { track, stragglerCut: { ms: 20_000, humans: false } });
  game.start();
  game.openGate();
  const human = game.player, ai = game.marbles[4];
  for (const m of [human, ai]) { Matter.Body.setStatic(m.body, true); }
  for (let t = 0; t < 200_000 && !(ai.dnf); t += PHYSICS_STEP) game.step(PHYSICS_STEP);
  assert.ok(ai.dnf, 'the computer straggler is cut');
  assert.ok(!human.dnf, 'the person is not');
  game.destroy();
});

test('no straggler rule unless asked for (classic races and tests are unchanged)', () => {
  const track = buildPlatformerTrack(1, TRACK_THEMES.forest, storyCourseId(1));
  const game = new Game(1, field(2), { track });
  assert.equal(game.stragglerCut, null);
  game.destroy();
});

test('Infinity reports how far the world moved at an origin shift', () => {
  const driver = { id: 0, name: 'Roller', color: '#f00', stats: { weight: 5, speed: 5, bounce: 5 }, isPlayer: true } as MarbleInfo;
  const run = new InfinityRun(4, driver, { effects: false });
  for (let i = 0; i < 80_000 && run.originShifts === 0; i++) {
    const g = run.game, m = g.player, plan = g.track.platformer!.plan;
    g.nudge = 1;
    const lane = (m.lane ?? 1) as 0, p = m.body.position;
    g.jumpPressed = floorAt(plan, lane, p.x + Math.max(40, Math.min(150, m.body.velocity.x * 7))) === null || plan.bumps.some((b) => b.lane === lane && b.x > p.x && b.x - p.x < 110);
    run.step();
  }
  assert.equal(run.originShifts, 1);
  assert.equal(run.lastShift.dx, -ORIGIN_STEP);
  assert.equal(run.lastShift.dy, -run.origin.y);
  run.destroy();
});
