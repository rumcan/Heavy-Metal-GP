// P2-16 (#122) battle tests, job ALPHA: the pure AI driving brain in src/game/ai-brain.ts.
// Standalone: imports only the module under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DIFFICULTY, SAMPLE_STEP, decide } from '../src/game/ai-brain';
import type { Sense } from '../src/game/ai-brain';

const never = () => 0.99; // rng that never triggers a mistake
const always = () => 0;   // rng that always triggers a mistake

/** A calm, flat stretch: nothing ahead, nobody near, full health, cold engine, no skills. */
function sense(over: Partial<Sense> = {}): Sense {
  return {
    time: 10_000, difficulty: 'normal', grounded: true, vx: 5, ahead: Array(16).fill(0), crateAt: null, wallAt: null, dangerAt: null,
    heat: 0, overheated: false, hp: 100, rivalAhead: null, rivalBehind: null, slots: [], lastSkillAt: -Infinity,
    door: null, ramp: null, rng: never, ...over,
  };
}

test('difficulty table and sample spacing', () => {
  assert.equal(SAMPLE_STEP, 20);
  assert.deepEqual(DIFFICULTY, {
    easy: { speedCap: 7, reactPx: 20, mistakeChance: 0.15, skillDelayMs: 2500 },
    normal: { speedCap: 8.5, reactPx: 34, mistakeChance: 0.05, skillDelayMs: 1200 },
    hard: { speedCap: 10, reactPx: 48, mistakeChance: 0, skillDelayMs: 400 },
  });
});

test('steering: full throttle under the difficulty speed cap, coast at or above it', () => {
  assert.equal(decide(sense({ vx: 5 })).nudge, 1);
  assert.equal(decide(sense({ vx: 8.5 })).nudge, 0);
  assert.equal(decide(sense({ vx: 9, difficulty: 'hard' })).nudge, 1);
});

test('jumping a gap: when a missing floor sample is within reactPx + 7 × vx', () => {
  const ahead = Array(16).fill(0);
  ahead[3] = null; // a gap 80 px ahead (sample i is (i + 1) × 20 px ahead)
  assert.equal(decide(sense({ vx: 7, ahead })).jump, true, '80 <= 34 + 49');
  assert.equal(decide(sense({ vx: 2, ahead })).jump, false, '80 > 34 + 14: not yet');
  assert.equal(decide(sense({ vx: 7, ahead, grounded: false })).jump, false, 'only from the ground');
});

test('jumping a crate (within reactPx + 5 × vx) and a step up (a sample 12+ px higher within the same reach)', () => {
  assert.equal(decide(sense({ vx: 4, crateAt: 50 })).jump, true, '50 <= 34 + 20');
  assert.equal(decide(sense({ vx: 4, crateAt: 60 })).jump, false);
  const step = Array(16).fill(0);
  step[2] = -20; // 60 px ahead the floor is 20 px higher
  assert.equal(decide(sense({ vx: 5, ahead: step })).jump, true);
  const slope = Array(16).fill(0).map((_, i) => -(i + 1) * 2); // a smooth uphill: never 12 px between neighbours
  assert.equal(decide(sense({ vx: 5, ahead: slope })).jump, false, 'smooth uphill is not a step');
});

test('mistakes: when the rng roll is under mistakeChance the jump is missed', () => {
  const ahead = Array(16).fill(0);
  ahead[1] = null;
  assert.equal(decide(sense({ vx: 6, ahead, rng: always })).jump, false);
  assert.equal(decide(sense({ vx: 6, ahead, rng: always, difficulty: 'hard' })).jump, true, 'hard never misses');
});

test('ramps: jump over a ramp that leads to a worse lane; roll through a better one', () => {
  assert.equal(decide(sense({ ramp: { dist: 30, better: false } })).jump, true);
  assert.equal(decide(sense({ ramp: { dist: 30, better: true } })).jump, false);
  assert.equal(decide(sense({ ramp: { dist: 90, better: false } })).jump, false, 'not yet');
});

test('doors: take a door into a better lane when standing in it', () => {
  assert.equal(decide(sense({ door: { dist: 0, better: true } })).takeDoor, true);
  assert.equal(decide(sense({ door: { dist: 0, better: false } })).takeDoor, false);
  assert.equal(decide(sense({ door: { dist: 80, better: true } })).takeDoor, false);
});

test('the Magic Engine: on the ground, below the cap by 1+, heat under 0.7, not overheated, and not heading downhill', () => {
  assert.equal(decide(sense({ vx: 5 })).engine, true);
  assert.equal(decide(sense({ vx: 8 })).engine, false, 'within 1 of the cap');
  assert.equal(decide(sense({ heat: 0.75 })).engine, false);
  assert.equal(decide(sense({ overheated: true })).engine, false);
  assert.equal(decide(sense({ grounded: false })).engine, false);
  const downhill = Array(16).fill(0).map((_, i) => (i + 1) * 4); // the last sample 64 px lower
  assert.equal(decide(sense({ ahead: downhill })).engine, false, 'gravity is doing the work');
});

test('skills: the first slot with charges whose hint fits the moment, after the difficulty delay', () => {
  const slots = [
    { charges: 1, hint: 'low-hp' as const },
    { charges: 0, hint: 'ahead-rival' as const },
    { charges: 2, hint: 'ahead-rival' as const },
  ];
  const rival = { dx: 200, dy: 0 };
  assert.equal(decide(sense({ slots, rivalAhead: rival })).slot, 2, 'slot 1 is empty; slot 0 does not fit');
  assert.equal(decide(sense({ slots, rivalAhead: rival, hp: 30 })).slot, 0, 'low HP comes first');
  assert.equal(decide(sense({ slots, rivalAhead: { dx: 400, dy: 0 } })).slot, null, 'rival out of range (300)');
  assert.equal(decide(sense({ slots, rivalAhead: rival, lastSkillAt: 9_000 })).slot, null, 'too soon after the last skill (1.2 s on normal)');
  assert.equal(decide(sense({ slots, rivalAhead: rival, lastSkillAt: 9_500, difficulty: 'hard' })).slot, 2, 'hard waits only 0.4 s');
});

test('skills: each hint and when it fits', () => {
  const one = (hint: Sense['slots'][number]['hint'], over: Partial<Sense>) => decide(sense({ slots: [{ charges: 1, hint }], ...over })).slot;
  assert.equal(one('behind', { rivalBehind: { dx: 150 } }), 0);
  assert.equal(one('behind', { rivalBehind: { dx: 250 } }), null, 'within 200 behind');
  assert.equal(one('danger', { dangerAt: 180 }), 0);
  assert.equal(one('danger', { dangerAt: 220 }), null, 'within 200');
  assert.equal(one('wall', { wallAt: 120 }), 0);
  assert.equal(one('wall', { wallAt: 160 }), null, 'within 150');
  const gap = Array(16).fill(0);
  gap[8] = null; // 180 px ahead
  assert.equal(one('gap', { ahead: gap }), 0, 'a gap within 200');
  assert.equal(one('low-hp', { hp: 39 }), 0);
  assert.equal(one('low-hp', { hp: 40 }), null, 'under 40');
});
