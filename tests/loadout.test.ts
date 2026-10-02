// P2-10 (#116) battle tests, job ALPHA: the pure loadout rules in src/game/loadout.ts.
// Standalone: imports only the module under test. The skill data comes in as an argument (a small catalogue).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LOADOUT_SLOTS, SLOT_KEYS, BUDGETS,
  emptyLoadout, setSlot, clearSlot, loadoutCost, lockReason, validateLoadout, dropPool,
} from '../src/game/loadout';
import type { Catalog, Loadout } from '../src/game/loadout';

const CAT: Catalog = {
  rocket: { price: 90, unlockLevel: 1, starter: true },
  jump: { price: 65, unlockLevel: 1, starter: true },
  shield: { price: 80, unlockLevel: 1, starter: true },
  oil: { price: 55, unlockLevel: 2, starter: false },
  ram: { price: 95, unlockLevel: 3, starter: false },
  charm: { price: 150, unlockLevel: 25, starter: false },
};
const VET = { level: 30, campaignComplete: true };
const ROOKIE = { level: 1, campaignComplete: false };

test('constants', () => {
  assert.equal(LOADOUT_SLOTS, 8);
  assert.deepEqual([...SLOT_KEYS], ['Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F']);
  assert.deepEqual([...BUDGETS], [0, 200, 500, 1000]);
});

test('emptyLoadout: eight empty slots', () => {
  assert.deepEqual(emptyLoadout(), [null, null, null, null, null, null, null, null]);
});

test('setSlot: puts a skill in a slot; a skill lives in one slot only; never mutates', () => {
  const a = setSlot(emptyLoadout(), 0, 'rocket', 2);
  assert.deepEqual(a[0], { skill: 'rocket', charges: 2 });
  const b = setSlot(a, 3, 'rocket');
  assert.equal(b[0], null, 'moved out of slot 0');
  assert.deepEqual(b[3], { skill: 'rocket', charges: 1 }, 'charges default to 1');
  assert.deepEqual(a[0], { skill: 'rocket', charges: 2 }, 'input untouched');
  assert.deepEqual(setSlot(a, 8, 'oil'), a, 'out of range: unchanged');
  assert.deepEqual(setSlot(a, -1, 'oil'), a);
});

test('clearSlot: empties one slot', () => {
  const a = setSlot(setSlot(emptyLoadout(), 0, 'rocket'), 1, 'oil');
  assert.deepEqual(clearSlot(a, 0), [null, { skill: 'oil', charges: 1 }, null, null, null, null, null, null]);
  assert.deepEqual(clearSlot(a, 99), a);
});

test('loadoutCost: price × charges over the filled slots; unknown skills cost nothing', () => {
  let l: Loadout = setSlot(emptyLoadout(), 0, 'rocket', 2);
  l = setSlot(l, 5, 'oil', 3);
  assert.equal(loadoutCost(l, CAT), 90 * 2 + 55 * 3);
  assert.equal(loadoutCost(setSlot(emptyLoadout(), 0, 'nope', 4), CAT), 0);
});

test('lockReason: unknown, level, then the online campaign gate (starters are always fine)', () => {
  assert.equal(lockReason('nope', CAT, VET, false), 'unknown');
  assert.equal(lockReason('ram', CAT, ROOKIE, false), 'level');
  assert.equal(lockReason('ram', CAT, { level: 5, campaignComplete: false }, false), null, 'offline: level is enough');
  assert.equal(lockReason('ram', CAT, { level: 5, campaignComplete: false }, true), 'campaign');
  assert.equal(lockReason('shield', CAT, ROOKIE, true), null, 'starters are always allowed');
  assert.equal(lockReason('charm', CAT, { level: 24, campaignComplete: true }, true), 'level');
});

test('validateLoadout: anything off the wire becomes a legal loadout, with a reason for every cut', () => {
  const raw = [
    { skill: 'rocket', charges: 3 },
    { skill: 'nope', charges: 1 },
    'garbage',
    { skill: 'rocket', charges: 1 },
    { skill: 'ram', charges: 2 },
    { skill: 'oil', charges: 2.5 },
    null,
    { skill: 'jump', charges: 40 },
    { skill: 'shield', charges: 1 },
  ];
  const r = validateLoadout(raw, CAT, { level: 5, campaignComplete: false }, { kind: 'own' }, false);
  assert.deepEqual(r.loadout, [
    { skill: 'rocket', charges: 3 }, null, null, null, { skill: 'ram', charges: 2 }, { skill: 'oil', charges: 2 }, null, { skill: 'jump', charges: 9 },
  ], 'only 8 slots read; charges are whole numbers 1..9');
  assert.deepEqual(r.trimmed, ['nope:unknown', 'rocket:duplicate']);
});

test('validateLoadout: locked skills are cut (online campaign gate too)', () => {
  const raw = [{ skill: 'rocket', charges: 1 }, { skill: 'ram', charges: 1 }, { skill: 'charm', charges: 1 }];
  const r = validateLoadout(raw, CAT, { level: 5, campaignComplete: false }, { kind: 'own' }, true);
  assert.deepEqual(r.loadout.slice(0, 3), [{ skill: 'rocket', charges: 1 }, null, null]);
  assert.deepEqual(r.trimmed, ['ram:campaign', 'charm:level']);
});

test('validateLoadout: a budget is spent slot by slot; a slot that does not fit loses charges, then the slot', () => {
  const raw = [{ skill: 'rocket', charges: 1 }, { skill: 'shield', charges: 2 }, { skill: 'jump', charges: 1 }];
  const r = validateLoadout(raw, CAT, VET, { kind: 'budget', credits: 200 }, true);
  // rocket 90 fits (90), shield 2×80 does not: one charge fits (170), jump 65 does not fit at all
  assert.deepEqual(r.loadout.slice(0, 3), [{ skill: 'rocket', charges: 1 }, { skill: 'shield', charges: 1 }, null]);
  assert.deepEqual(r.trimmed, ['shield:budget', 'jump:budget']);
  assert.ok(loadoutCost(r.loadout, CAT) <= 200);
  const zero = validateLoadout(raw, CAT, VET, { kind: 'budget', credits: 0 }, true);
  assert.deepEqual(zero.loadout, emptyLoadout());
});

test('validateLoadout: unlimited and own kits have no cost limit; a non-array is an empty loadout', () => {
  const raw = [{ skill: 'charm', charges: 9 }];
  assert.deepEqual(validateLoadout(raw, CAT, VET, { kind: 'unlimited' }, true).loadout[0], { skill: 'charm', charges: 9 });
  assert.deepEqual(validateLoadout('nope', CAT, VET, { kind: 'own' }, false), { loadout: emptyLoadout(), trimmed: [] });
});

test('dropPool: the skills an item box may drop: the loadout, in slot order', () => {
  let l = setSlot(emptyLoadout(), 4, 'oil');
  l = setSlot(l, 1, 'rocket');
  assert.deepEqual(dropPool(l), ['rocket', 'oil']);
  assert.deepEqual(dropPool(emptyLoadout()), []);
});
