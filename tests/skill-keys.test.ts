// P2-01 (#107) battle tests, job BRAVO: the key map in src/game/skill-keys.ts.
// Keys are matched by KeyboardEvent.code (the PHYSICAL key), so Q W E R / A S D F sit in the same place
// on an AZERTY or QWERTZ keyboard. Standalone: imports only the module under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SKILL_KEYS, actionForKey, slotKeyLabel, skillRows } from '../src/game/skill-keys';

test('SKILL_KEYS: top row Q W E R, bottom row A S D F', () => {
  assert.deepEqual([...SKILL_KEYS], ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyA', 'KeyS', 'KeyD', 'KeyF']);
});

test('actionForKey: skill slots from letters and from 1–8 (row and numpad)', () => {
  assert.deepEqual(actionForKey('KeyQ'), { kind: 'skill', slot: 0 });
  assert.deepEqual(actionForKey('KeyF'), { kind: 'skill', slot: 7 });
  assert.deepEqual(actionForKey('Digit1'), { kind: 'skill', slot: 0 });
  assert.deepEqual(actionForKey('Digit8'), { kind: 'skill', slot: 7 });
  assert.deepEqual(actionForKey('Numpad3'), { kind: 'skill', slot: 2 });
  assert.equal(actionForKey('Digit9'), null);
  assert.equal(actionForKey('Digit0'), null, '0 is zoom reset, not a skill');
});

test('actionForKey: movement — arrows steer, ↑ and Space jump, ↓ is the engine', () => {
  assert.deepEqual(actionForKey('ArrowLeft'), { kind: 'steer', dir: -1 });
  assert.deepEqual(actionForKey('ArrowRight'), { kind: 'steer', dir: 1 });
  assert.deepEqual(actionForKey('ArrowUp'), { kind: 'jump' });
  assert.deepEqual(actionForKey('Space'), { kind: 'jump' });
  assert.deepEqual(actionForKey('ArrowDown'), { kind: 'engine' });
});

test('actionForKey: A and D no longer steer (they are skill keys)', () => {
  assert.deepEqual(actionForKey('KeyA'), { kind: 'skill', slot: 4 });
  assert.deepEqual(actionForKey('KeyD'), { kind: 'skill', slot: 6 });
});

test('actionForKey: keys the race screen already uses are left alone (null)', () => {
  for (const code of ['KeyM', 'KeyP', 'KeyT', 'Escape', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract', 'Tab', 'Enter']) {
    assert.equal(actionForKey(code), null, code);
  }
});

test('slotKeyLabel: the letter shown on each slot', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(slotKeyLabel), ['Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F']);
  assert.equal(slotKeyLabel(8), '');
  assert.equal(slotKeyLabel(-1), '');
});

test('skillRows: 8 slots split into two rows of four, in order; short lists still make two rows', () => {
  const s = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  assert.deepEqual(skillRows(s), [['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h']]);
  assert.deepEqual(skillRows(['a', 'b', 'c']), [['a', 'b', 'c'], []]);
  assert.deepEqual(skillRows(['a', 'b', 'c', 'd', 'e']), [['a', 'b', 'c', 'd'], ['e']]);
  assert.deepEqual(skillRows([...s, 'i']), [['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h']], 'never more than 8');
});
