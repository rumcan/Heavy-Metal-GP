// Run with: node --import tsx --test tests/ai-personality.test.ts
// P2-16b (#122): each rival drives like themselves (skill, aggression, caution), the race difficulty shifts their skill,
// and the brain uses it without any extra forces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERSONALITIES, personalityOf, rivalIndexOf, tuningOf } from '../src/game/ai-personality';
import { DIFFICULTY, decide } from '../src/game/ai-brain';
import type { Sense } from '../src/game/ai-brain';
import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { AI_COLORS, AI_NAMES, TRACK_THEMES, mulberry32, randomStats } from '../src/game/types';
import type { MarbleInfo } from '../src/game/types';
import { buildPlatformerTrack } from '../src/game/platformer/build';

test('every rival has a personality in range', () => {
  assert.equal(PERSONALITIES.length, 16);
  for (const p of PERSONALITIES) {
    assert.ok(Number.isInteger(p.skill) && p.skill >= 1 && p.skill <= 5);
    assert.ok(p.aggression >= 0 && p.aggression <= 1 && p.caution >= 0 && p.caution <= 1);
  }
  assert.equal(rivalIndexOf({ id: 3, character: 2 }), 2);
  assert.equal(rivalIndexOf({ id: 5 }), 4, 'saves without a character fall back to id order');
});

test('difficulty shifts skill by one, clamped to 1..5', () => {
  const grubba = { id: 9, character: 2 }; // skill 2
  assert.equal(personalityOf(grubba).skill, 2);
  assert.equal(personalityOf(grubba, 'easy').skill, 1);
  assert.equal(personalityOf(grubba, 'hard').skill, 3);
  const ace = { id: 9, character: 0 }; // skill 5
  assert.equal(personalityOf(ace, 'hard').skill, 5);
  const knuckles = { id: 9, character: 3 }; // skill 2
  assert.equal(personalityOf(knuckles, 'easy').skill, 1);
  assert.equal(personalityOf({ id: 9, character: 6 }, 'easy').skill, 1);
});

test('skill 1 is the old easy driver and skill 5 the old hard one, never faster than a person can steer', () => {
  const easy = tuningOf({ skill: 1, aggression: 0.5, caution: 0.5 }), hard = tuningOf({ skill: 5, aggression: 0.5, caution: 0.5 });
  assert.equal(easy.speedCap, DIFFICULTY.easy.speedCap);
  assert.equal(hard.speedCap, DIFFICULTY.hard.speedCap);
  assert.ok(hard.speedCap <= 10, 'steering never pushes past the human cap (CONTROL_TUNING.maxSteerVx)');
  assert.ok(easy.mistakeChance > hard.mistakeChance);
  assert.ok(tuningOf({ skill: 3, aggression: 1, caution: 0.5 }).skillDelayMs < tuningOf({ skill: 3, aggression: 0, caution: 0.5 }).skillDelayMs, 'aggressive fires sooner');
});

const base = (persona: Sense['persona'], over: Partial<Sense> = {}): Sense => ({
  time: 10_000, difficulty: 'normal', grounded: true, vx: 6, ahead: Array(20).fill(0), crateAt: null, wallAt: null, dangerAt: null,
  heat: 0, overheated: false, hp: 100, rivalAhead: null, rivalBehind: null, slots: [], lastSkillAt: 0, door: null, ramp: null,
  rng: () => 0.99, persona, ...over,
});

test('a cautious driver jumps a chasm earlier than a reckless one', () => {
  const at = (gapPx: number) => { const ahead: (number | null)[] = Array(20).fill(0); ahead[Math.floor(gapPx / 20) - 1] = null; return ahead; };
  const careful = { skill: 3, aggression: 0.5, caution: 1 }, reckless = { skill: 3, aggression: 0.5, caution: 0 };
  // find the furthest gap each one already jumps for
  const furthest = (p: typeof careful) => { let far = 0; for (let px = 40; px <= 400; px += 20) if (decide(base(p, { ahead: at(px) })).jump) far = px; return far; };
  assert.ok(furthest(careful) > furthest(reckless), `careful ${furthest(careful)} vs reckless ${furthest(reckless)}`);
});

test('an aggressive driver goes after a rival further ahead with an offence skill', () => {
  const slots = [{ charges: 1, hint: 'ahead-rival' as const }];
  const rivalAhead = { dx: 380, dy: 0 };
  assert.equal(decide(base({ skill: 3, aggression: 1, caution: 0.5 }, { slots, rivalAhead })).slot, 0);
  assert.equal(decide(base({ skill: 3, aggression: 0, caution: 0.5 }, { slots, rivalAhead })).slot, null);
});

function field(seed: number, character: (i: number) => number): MarbleInfo[] {
  const rng = mulberry32(seed);
  return Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: AI_NAMES[i], color: AI_COLORS[i], stats: { weight: 5, speed: 5, bounce: 5 }, isPlayer: false, character: character(i) }));
  void rng; void randomStats;
}

test('the same seed gives the same finishing order twice, and a skilled field beats a clumsy one on average', () => {
  const race = (seed: number, character: (i: number) => number) => {
    const game = new Game(seed, field(seed, character), { track: buildPlatformerTrack(seed, TRACK_THEMES.forest, 'rolling-hills'), effects: false, aiItems: false });
    game.start(); game.openGate();
    let t = 0;
    for (; t < 200_000 && !game.allFinished(); t += PHYSICS_STEP) game.step(PHYSICS_STEP);
    const order = game.finishOrder.map((m) => m.info.id).join(',');
    game.destroy();
    return { order, t };
  };
  const a = race(4, (i) => i), b = race(4, (i) => i);
  assert.equal(a.order, b.order);
  // a field of skill-5 drivers (Ace, The Hood) against a field of skill-2 ones (Grubba, Knuckles, Lucky)
  let fast = 0, slow = 0;
  for (const seed of [2, 5]) {
    fast += race(seed, (i) => (i % 2 ? 0 : 12)).t;
    slow += race(seed, (i) => [2, 3, 6][i % 3]).t;
  }
  assert.ok(fast < slow, `skilled field ${Math.round(fast / 1000)} s, clumsy field ${Math.round(slow / 1000)} s`);
});
