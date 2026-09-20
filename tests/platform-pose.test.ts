// CHAMP-05 regression: the lift platform must dwell at BOTH ends of its run.
// The pre-fix pose mirrored the outbound leg with `if (t >= leg) u = 1 - u`, which
// evaluated against an already-finalised u — so the slab snapped home the instant
// it arrived at b and never held there. Suzuka Spiral's disembark aperture sits at
// the b end, so a missing dwell there strands riders against solid shaft wall.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { platformPose } from '../src/game/elements.ts';

const motion = {
  mode: 'platform' as const,
  a: { x: 780, y: 1350 },
  b: { x: 780, y: 2170 },
  travelMs: 1800,
  pauseMs: 450,
  phaseMs: 0,
};
const LEG = motion.travelMs + motion.pauseMs; // 2250
const CYCLE = LEG * 2; // 4500

test('platform holds still at the a end for the full pause', () => {
  for (const t of [0, 100, 449]) {
    assert.deepEqual(platformPose(motion, t), { x: 780, y: 1350 }, `t=${t}`);
  }
});

test('platform rides a -> b during the travel window', () => {
  const y0 = platformPose(motion, motion.pauseMs).y;
  const y1 = platformPose(motion, motion.pauseMs + motion.travelMs / 2).y;
  const y2 = platformPose(motion, LEG).y;
  assert.equal(y0, 1350);
  assert.ok(y1 > 1600 && y1 < 1900, `mid-ride y=${y1}`);
  assert.equal(y2, 2170);
});

test('platform dwells at the b end instead of snapping home', () => {
  for (const t of [LEG, LEG + 100, LEG + 449]) {
    const p = platformPose(motion, t);
    assert.equal(p.y, 2170, `t=${t} must hold at b`);
  }
});

test('platform rides home and closes the cycle continuously', () => {
  const mid = platformPose(motion, CYCLE - motion.travelMs / 2);
  assert.ok(mid.y > 1600 && mid.y < 1900, `return y=${mid.y}`);
  assert.deepEqual(platformPose(motion, CYCLE - 1), platformPose(motion, -1));
  // no teleport anywhere in the cycle: consecutive samples stay close
  let prev = platformPose(motion, 0);
  for (let t = 10; t <= CYCLE; t += 10) {
    const p = platformPose(motion, t);
    assert.ok(Math.hypot(p.x - prev.x, p.y - prev.y) < 20, `jump at t=${t}`);
    prev = p;
  }
});

test('phase offset shifts the dwell window', () => {
  const phased = { ...motion, phaseMs: 1000 };
  assert.equal(platformPose(phased, 0).y, platformPose(motion, 1000).y);
});
