// P2-17 (#125) battle tests, job BRAVO: the pure talent-tree rules in src/game/talents.ts.
// Standalone: imports only the module under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TREES, TALENTS, STAT_KEYS, RESPEC_PRICE,
  talentDef, tierLevel, tierPointsNeeded, pointsSpent, pointsInTree, canRankUp, rankUp, validateBuild, talentEffects, respecCost,
} from '../src/game/talents';
import type { Build } from '../src/game/talents';

// id, tree, tier, maxRank, stat, perRank
const TABLE: [string, string, number, number, string, number][] = [
  ['heat-sink', 'engine', 1, 3, 'engineHeatPct', 10], ['coolant', 'engine', 1, 3, 'engineCoolPct', 10],
  ['turbo', 'engine', 2, 3, 'thrustPct', 5], ['streamline', 'engine', 2, 3, 'topSpeedPct', 2],
  ['big-tank', 'engine', 3, 2, 'engineHeatPct', 10], ['nitro', 'engine', 3, 2, 'thrustPct', 5],
  ['afterburner', 'engine', 4, 1, 'overheatLockPct', -50],
  ['plating', 'chassis', 1, 3, 'maxHp', 10], ['patch-up', 'chassis', 1, 3, 'regenDelayMs', -1000],
  ['padding', 'chassis', 2, 3, 'damageTakenPct', -4], ['mender', 'chassis', 2, 3, 'regenPct', 10],
  ['bulwark', 'chassis', 3, 2, 'maxHp', 10], ['thick-skin', 'chassis', 3, 2, 'damageTakenPct', -4],
  ['iron-belly', 'chassis', 4, 1, 'ironBelly', 1],
  ['sharpened', 'arsenal', 1, 3, 'offenceDamagePct', 6], ['quick-fuse', 'arsenal', 1, 3, 'projectileSpeedPct', 10],
  ['stockpile', 'arsenal', 2, 1, 'firstOffenceCharge', 1], ['heavy-hitter', 'arsenal', 2, 3, 'offenceDamagePct', 6],
  ['long-range', 'arsenal', 3, 2, 'projectileSpeedPct', 10], ['demolition', 'arsenal', 3, 2, 'offenceDamagePct', 6],
  ['bounty-hunter', 'arsenal', 4, 1, 'koBountyPct', 50],
  ['lingering', 'tactics', 1, 3, 'skillDurationPct', 8], ['nimble', 'tactics', 1, 3, 'skillCooldownPct', -10],
  ['organised', 'tactics', 2, 1, 'boxFavourLoadout', 1], ['extended', 'tactics', 2, 3, 'skillDurationPct', 8],
  ['rapid', 'tactics', 3, 2, 'skillCooldownPct', -10], ['focus', 'tactics', 3, 2, 'skillDurationPct', 8],
  ['quick-hands', 'tactics', 4, 1, 'refundChancePct', 15],
  ['sponsor', 'fortune', 1, 3, 'prizePct', 5], ['peg-hunter', 'fortune', 1, 3, 'pegBonusPct', 10],
  ['haggler', 'fortune', 2, 3, 'shamanFeePct', -10], ['big-sponsor', 'fortune', 2, 3, 'prizePct', 5],
  ['collector', 'fortune', 3, 2, 'pegBonusPct', 10], ['thrifty', 'fortune', 3, 2, 'shamanFeePct', -10],
  ['lucky-goblin', 'fortune', 4, 1, 'xpPct', 15],
];

test('the trees and talents: exactly this table, in this order', () => {
  assert.deepEqual([...TREES], ['engine', 'chassis', 'arsenal', 'tactics', 'fortune']);
  assert.deepEqual(TALENTS.map((t) => [t.id, t.tree, t.tier, t.maxRank, t.stat, t.perRank]), TABLE);
  for (const t of TALENTS) {
    assert.ok(t.name.length >= 3, `${t.id}: a name`);
    assert.ok(t.desc.length >= 15 && t.desc.length <= 100, `${t.id}: a one-line description`);
  }
  assert.equal(RESPEC_PRICE, 500);
});

test('STAT_KEYS: every stat a talent can change, once each', () => {
  assert.deepEqual([...STAT_KEYS].sort(), [...new Set(TABLE.map((r) => r[4]))].sort());
});

test('talentDef: a known id gives its def; anything else null', () => {
  assert.equal(talentDef('nitro')?.tier, 3);
  assert.equal(talentDef('nope'), null);
  assert.equal(talentDef('constructor'), null);
});

test('tiers open at driver level 1 / 6 / 11 / 16 and after 0 / 3 / 6 / 9 points lower in the same tree', () => {
  assert.deepEqual([1, 2, 3, 4].map(tierLevel), [1, 6, 11, 16]);
  assert.deepEqual([1, 2, 3, 4].map(tierPointsNeeded), [0, 3, 6, 9]);
});

test('pointsSpent / pointsInTree (below a tier)', () => {
  const b: Build = { 'heat-sink': 3, coolant: 1, turbo: 2, plating: 1 };
  assert.equal(pointsSpent(b), 7);
  assert.equal(pointsInTree(b, 'engine'), 6);
  assert.equal(pointsInTree(b, 'engine', 2), 4, 'points in engine tiers below tier 2');
  assert.equal(pointsInTree(b, 'chassis'), 1);
});

test('canRankUp: unknown, maxed, no points left, level too low, not enough points lower in the tree', () => {
  const b: Build = { 'heat-sink': 3 };
  assert.equal(canRankUp(b, 'nope', 30, 30), false);
  assert.equal(canRankUp(b, 'heat-sink', 30, 30), false, 'already at max rank');
  assert.equal(canRankUp(b, 'coolant', 30, 3), false, 'all 3 points are spent');
  assert.equal(canRankUp(b, 'turbo', 5, 10), false, 'tier 2 needs level 6');
  assert.equal(canRankUp(b, 'turbo', 6, 10), true, '3 points in tier 1, level 6');
  assert.equal(canRankUp({ 'heat-sink': 2 }, 'turbo', 6, 10), false, 'only 2 points below tier 2');
  assert.equal(canRankUp(b, 'coolant', 1, 10), true);
});

test('rankUp: a new build with one more rank, or null when not allowed; never mutates', () => {
  const b: Build = { 'heat-sink': 1 };
  assert.deepEqual(rankUp(b, 'heat-sink', 1, 5), { 'heat-sink': 2 });
  assert.deepEqual(b, { 'heat-sink': 1 });
  assert.equal(rankUp(b, 'afterburner', 30, 30), null);
});

test('validateBuild: drops unknown ids and bad ranks, clamps to max rank, and keeps the build legal', () => {
  assert.deepEqual(validateBuild({ 'heat-sink': 5, nope: 2, coolant: 0, plating: -1, padding: 'x' }, 30, 30), { 'heat-sink': 3 });
  assert.deepEqual(validateBuild(null, 30, 30), {});
  // tier 2 without the points below it, or above the level, is dropped
  assert.deepEqual(validateBuild({ 'heat-sink': 1, turbo: 2 }, 30, 30), { 'heat-sink': 1 });
  assert.deepEqual(validateBuild({ 'heat-sink': 3, turbo: 2 }, 5, 30), { 'heat-sink': 3 });
  // more points than the driver has: whole talents are dropped from the highest tier down until it fits
  assert.deepEqual(validateBuild({ 'heat-sink': 3, coolant: 3, turbo: 3 }, 30, 7), { 'heat-sink': 3, coolant: 3 });
  // a fractional rank is floored
  assert.deepEqual(validateBuild({ 'heat-sink': 2.7 }, 30, 30), { 'heat-sink': 2 });
});

test('talentEffects: every stat key present; rank × perRank summed per stat', () => {
  const fx = talentEffects({ 'heat-sink': 3, 'big-tank': 1, padding: 2, afterburner: 1 });
  assert.equal(fx.engineHeatPct, 40);
  assert.equal(fx.damageTakenPct, -8);
  assert.equal(fx.overheatLockPct, -50);
  assert.equal(fx.xpPct, 0);
  assert.deepEqual(Object.keys(fx).sort(), [...STAT_KEYS].sort());
  assert.ok(Object.values(talentEffects({})).every((v) => v === 0));
});

test('respecCost: the first respec is free, every later one costs RESPEC_PRICE', () => {
  assert.equal(respecCost(0), 0);
  assert.equal(respecCost(1), 500);
  assert.equal(respecCost(7), 500);
});
