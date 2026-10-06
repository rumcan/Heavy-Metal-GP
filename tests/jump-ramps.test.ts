// Run with: node --import tsx --test tests/jump-ramps.test.ts
// The owner: every lane change is a jump ramp. Roll up one and its lip throws you into the air, across onto the other
// track, and you land there. Generated courses and Infinity only make ramps (doors are placed by hand).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { AI_COLORS, AI_NAMES, TRACK_THEMES } from '../src/game/types';
import type { MarbleInfo } from '../src/game/types';
import { buildPlatformerTrack } from '../src/game/platformer/build';
import { floorAt } from '../src/game/platformer/course';
import type { Lane, LaneGate } from '../src/game/platformer/course';
import { applyLaneMask } from '../src/game/engine/platformer';
import { progressAlong } from '../src/game/course-path';
import { infinityChunk } from '../src/game/platformer/infinity';
import { MARBLE_RADIUS } from '../src/game/types';

const solo: MarbleInfo[] = [{ id: 1, name: AI_NAMES[0], color: AI_COLORS[0], stats: { weight: 5, speed: 5, bounce: 5 }, isPlayer: true }];

/** Roll the player at `g` from a run-up in its lane, holding right; where does it end up? */
function rideGate(seed: number, course: string, pick: (g: LaneGate) => boolean) {
  const track = buildPlatformerTrack(seed, TRACK_THEMES.forest, course);
  const plan = track.platformer!.plan;
  const g = plan.gates.find((gate) => pick(gate) && floorAt(plan, gate.lane, gate.x - 260) !== null);
  if (!g) return null;
  const game = new Game(seed, solo, { track, effects: false });
  game.start(); game.openGate();
  const m = game.player;
  m.cannon = undefined; // out of the start cannon
  m.lane = g.lane; m.laneFrom = g.lane; m.laneAt = undefined;
  applyLaneMask(game, m);
  const x = g.x - 260;
  Matter.Body.setPosition(m.body, { x, y: floorAt(plan, g.lane as Lane, x)! - MARBLE_RADIUS - 2 });
  Matter.Body.setVelocity(m.body, { x: 8, y: 0 });
  m.progress = m.bestProgress = progressAlong(track.platformer!.path, m.body.position);
  m.motionAt = game.time;
  game.nudge = 1;
  let landed = false;
  for (let t = 0; t < 4000; t += PHYSICS_STEP) {
    game.step(PHYSICS_STEP);
    const p = m.body.position;
    if (m.lane === g.to && p.x > g.x + g.w + 40 && m.grounded < 3) {
      const floor = floorAt(plan, g.to as Lane, p.x);
      if (floor !== null && Math.abs(p.y + MARBLE_RADIUS - floor) < 30) { landed = true; break; }
    }
  }
  const out = { gate: g, lane: m.lane, landed };
  game.destroy();
  return out;
}

test('generated courses and Infinity only make lane-change ramps', () => {
  for (const seed of [1, 2, 3]) {
    const plan = buildPlatformerTrack(seed, TRACK_THEMES.forest, 'rolling-hills').platformer!.plan;
    assert.ok(plan.gates.every((g) => g.kind === 'ramp'), `seed ${seed}`);
  }
  for (let i = 2; i < 60; i++) assert.ok(infinityChunk(7, i).gates.every((g) => g.kind === 'ramp'));
});

test('rolling up a lane-change ramp throws the ball across, and it lands on the other track', () => {
  let up = 0, down = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    for (const dir of [-1, 1]) {
      const r = rideGate(seed, 'rolling-hills', (g) => Math.sign(g.to - g.lane) === dir);
      if (!r) continue;
      assert.equal(r.lane, r.gate.to, `seed ${seed}: the ball changed lane off the lip (${r.gate.lane} -> ${r.gate.to})`);
      assert.ok(r.landed, `seed ${seed}: it landed on lane ${r.gate.to} past the ramp`);
      if (dir < 0) up++; else down++;
    }
  }
  assert.ok(up > 0 && down > 0, `rode ${up} ramps up to the back and ${down} down to the front`);
});
