// P2-09 (#115) battle tests, job BRAVO: the pure progression rules in src/game/progression.ts.
// Standalone: imports only the module under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_LEVEL, XP, AWARDED_KEEP,
  xpToNext, totalXpForLevel, levelForXp, raceXp, chapterXp, newProgress, awardXp, migrateAccount, onlineSkillGate,
} from '../src/game/progression';

test('constants match the design', () => {
  assert.equal(MAX_LEVEL, 30);
  assert.deepEqual(XP, { finish: 50, perPlace: 10, perPeg: 2, perKo: 50, personalBest: 25, chapterFirst: 300, bonusObjective: 100 });
  assert.equal(AWARDED_KEEP, 200);
});

test('xpToNext: round(100 × level^1.4); 0 once at the top level', () => {
  assert.deepEqual([1, 2, 3, 10, 29].map(xpToNext), [100, 264, 466, 2512, 11152]);
  assert.equal(xpToNext(30), 0);
  assert.equal(xpToNext(31), 0);
});

test('totalXpForLevel: the XP it takes to reach a level from level 1', () => {
  assert.equal(totalXpForLevel(1), 0);
  assert.equal(totalXpForLevel(2), 100);
  assert.equal(totalXpForLevel(3), 364);
  assert.equal(totalXpForLevel(5), 1526);
  assert.equal(totalXpForLevel(30), 140372);
});

test('levelForXp: level, XP into it, and XP the level needs; capped at 30', () => {
  assert.deepEqual(levelForXp(0), { level: 1, into: 0, toNext: 100 });
  assert.deepEqual(levelForXp(99), { level: 1, into: 99, toNext: 100 });
  assert.deepEqual(levelForXp(100), { level: 2, into: 0, toNext: 264 });
  assert.deepEqual(levelForXp(400), { level: 3, into: 36, toNext: 466 });
  assert.deepEqual(levelForXp(10_000_000), { level: 30, into: 10_000_000 - 140372, toNext: 0 });
  assert.deepEqual(levelForXp(-5), { level: 1, into: 0, toNext: 100 }, 'negative XP reads as none');
});

test('raceXp: finish + places above last + pegs + KOs + personal best; a DNF keeps only pegs and KOs', () => {
  assert.equal(raceXp({ finished: true, rank: 1, pegs: 0, kos: 0, beatBest: false }), 50 + 100);
  assert.equal(raceXp({ finished: true, rank: 10, pegs: 3, kos: 1, beatBest: true }), 50 + 10 + 6 + 50 + 25);
  assert.equal(raceXp({ finished: true, rank: 15, pegs: 0, kos: 0, beatBest: false }), 50 + 10, 'rank clamped to 1..10');
  assert.equal(raceXp({ finished: false, rank: 4, pegs: 5, kos: 2, beatBest: true }), 10 + 100);
});

test('chapterXp: 300 the first time, plus 100 per bonus objective', () => {
  assert.equal(chapterXp(true, 0), 300);
  assert.equal(chapterXp(true, 2), 500);
  assert.equal(chapterXp(false, 2), 200);
});

test('newProgress: level 1, nothing earned', () => {
  assert.deepEqual(newProgress(), { xp: 0, level: 1, talentPoints: 0, awarded: [] });
});

test('awardXp: adds XP, levels up, one talent point per level gained; never mutates the input', () => {
  const p = newProgress();
  const r = awardXp(p, 'race-1', 400);
  assert.deepEqual(r.state, { xp: 400, level: 3, talentPoints: 2, awarded: ['race-1'] });
  assert.deepEqual(r.levelsGained, [2, 3]);
  assert.deepEqual(p, newProgress(), 'input untouched');
});

test('awardXp: the same race id pays once', () => {
  const once = awardXp(newProgress(), 'race-1', 150).state;
  const twice = awardXp(once, 'race-1', 150);
  assert.deepEqual(twice.state, once);
  assert.deepEqual(twice.levelsGained, []);
});

test('awardXp: remembers only the last AWARDED_KEEP race ids', () => {
  let s = newProgress();
  for (let i = 0; i < AWARDED_KEEP + 5; i++) s = awardXp(s, `r${i}`, 1).state;
  assert.equal(s.awarded.length, AWARDED_KEEP);
  assert.equal(s.awarded[0], 'r5');
  assert.equal(s.xp, AWARDED_KEEP + 5);
});

test('awardXp: no talent points beyond the top level', () => {
  const r = awardXp(newProgress(), 'big', 10_000_000);
  assert.equal(r.state.level, 30);
  assert.equal(r.state.talentPoints, 29);
  assert.equal(r.levelsGained.length, 29);
});

test('migrateAccount: old players get 50 XP per finish, the matching level and talent points', () => {
  assert.deepEqual(migrateAccount(0), { xp: 0, level: 1, talentPoints: 0, awarded: [] });
  assert.deepEqual(migrateAccount(8), { xp: 400, level: 3, talentPoints: 2, awarded: [] });
  assert.deepEqual(migrateAccount(-3), { xp: 0, level: 1, talentPoints: 0, awarded: [] });
});

test('onlineSkillGate: starters only until the campaign is finished', () => {
  assert.equal(onlineSkillGate(false), 'starters');
  assert.equal(onlineSkillGate(true), 'unlocked');
});
