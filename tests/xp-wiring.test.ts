// P2-09: XP on the account — old saves migrate, a race pays XP once, levels come with talent points.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createAccount, parseAccount, progressOf, awardRaceXp } from '../src/game/economy';
import { raceXp } from '../src/game/progression';

test('a new account starts at level 1 with nothing earned', () => {
  assert.deepEqual(progressOf(createAccount()), { xp: 0, level: 1, talentPoints: 0, awarded: [] });
});

test('an old save (no progress field) is backfilled: 50 XP per past finish', () => {
  const old = parseAccount(JSON.stringify({ version: 1, credits: 900, inventory: {}, finishes: 8 }));
  assert.equal(old.progress, undefined);
  assert.deepEqual(progressOf(old), { xp: 400, level: 3, talentPoints: 2, awarded: [] });
});

test('awardRaceXp: pays once per race id; reports the levels gained', () => {
  const acc = createAccount();
  const first = awardRaceXp(acc, 'quick:1', raceXp({ finished: true, rank: 1, pegs: 5, kos: 1, beatBest: false }));
  assert.equal(progressOf(first.account).xp, 50 + 100 + 10 + 50);
  assert.deepEqual(first.levelsGained, [2]);
  const again = awardRaceXp(first.account, 'quick:1', 999);
  assert.equal(progressOf(again.account).xp, 210, 'the same race pays once');
  assert.deepEqual(again.levelsGained, []);
});

test('progress survives a save and a load; garbage progress is ignored', () => {
  const acc = awardRaceXp(createAccount(), 'r', 300).account;
  const back = parseAccount(JSON.stringify(acc));
  assert.deepEqual(progressOf(back), progressOf(acc));
  const bad = parseAccount(JSON.stringify({ ...acc, progress: { xp: 'lots' } }));
  assert.equal(bad.progress, undefined);
});
