// Run with: node --import tsx --test tests/pre-race-loadout.test.ts
// P2-10b (#116): the loadout screen before every race, unless the player said not to ask.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as storage from '../src/game/storage';
import { PRE_RACE_KEY, askEveryRace, setAskEveryRace, shouldAskLoadout } from '../src/game/pre-race';
import { STORAGE_KEYS } from '../src/game/storage';

test('asks before quick, championship and story races; never the tutorial, Infinity or online', () => {
  for (const mode of ['quick', 'championship', 'story'] as const) assert.equal(shouldAskLoadout({ mode }, true), true, mode);
  assert.equal(shouldAskLoadout({ mode: 'story', tutorial: true }, true), false);
  assert.equal(shouldAskLoadout({ mode: 'infinity' }, true), false);
  assert.equal(shouldAskLoadout({ mode: 'online' }, true), false);
});

test('"Don\'t ask before every race" is remembered on the device, and is the only way to switch it off', () => {
  storage.removeItem(PRE_RACE_KEY);
  assert.equal(askEveryRace(), true, 'asks by default');
  setAskEveryRace(false);
  assert.equal(askEveryRace(), false);
  assert.equal(shouldAskLoadout({ mode: 'quick' }), false);
  setAskEveryRace(true);
  assert.equal(shouldAskLoadout({ mode: 'quick' }), true);
  assert.ok((STORAGE_KEYS as readonly string[]).includes(PRE_RACE_KEY), 'the key is preloaded at boot');
  storage.removeItem(PRE_RACE_KEY);
});
