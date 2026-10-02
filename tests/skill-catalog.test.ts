// P2-08 (#114) battle tests, job ALPHA: the skills catalogue in src/game/skills/catalog.ts.
// Standalone: imports only the module under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SKILL_IDS, SKILLS, STARTER_SKILLS, LEGACY_SKILLS, GROUP_COLORS,
  skillDef, skillsInGroup, unlockedSkills, newUnlocks, nextUnlock, allowedOnline, sanitizeSkillList,
} from '../src/game/skills/catalog';

// id, name, short, group, unlock level, price, duration (ms), colour, AI hint
const TABLE: [string, string, string, string, number, number, number, string, string][] = [
  ['rocket', 'Speed Boost', 'BOOST', 'movement', 1, 90, 3000, '#d63e2e', 'gap'],
  ['jump', 'Super Jump', 'JUMP', 'movement', 1, 65, 1000, '#b6a0ff', 'gap'],
  ['shield', 'Bubble Shield', 'SHIELD', 'defence', 1, 80, 4000, '#60a5fa', 'danger'],
  ['oil', 'Oil Slick', 'OIL', 'offence', 2, 55, 9000, '#c084fc', 'behind'],
  ['ram', 'Battering Ram', 'RAM', 'utility', 3, 95, 2500, '#b45309', 'wall'],
  ['repair', 'Repair Kit', 'REPAIR', 'defence', 4, 70, 0, '#4ade80', 'low-hp'],
  ['shock', 'Shockwave', 'SHOCK', 'offence', 5, 100, 0, '#facc15', 'ahead-rival'],
  ['anvil', 'Heavy Metal', 'MASS', 'defence', 6, 80, 5000, '#c5d1e1', 'danger'],
  ['brake', 'Air Brake', 'BRAKE', 'movement', 7, 60, 1000, '#94a3b8', 'gap'],
  ['freeze', 'Freeze Ray', 'FREEZE', 'offence', 8, 110, 2500, '#7dd3fc', 'ahead-rival'],
  ['aero', 'Slipstream', 'AERO', 'movement', 9, 75, 6000, '#5eead4', 'gap'],
  ['bolt', 'Homing Bolt', 'BOLT', 'offence', 10, 105, 0, '#f97316', 'ahead-rival'],
  ['ghost', 'Ghost Mode', 'GHOST', 'defence', 11, 85, 3000, '#e2e8f0', 'danger'],
  ['overdrive', 'Overdrive', 'OVERDRIVE', 'movement', 12, 90, 5000, '#ef4444', 'gap'],
  ['spikes', 'Caltrops', 'SPIKES', 'offence', 13, 70, 6000, '#a8a29e', 'behind'],
  ['decoy', 'Decoy', 'DECOY', 'defence', 14, 65, 5000, '#fbbf24', 'danger'],
  ['grapple', 'Grapple Hook', 'GRAPPLE', 'movement', 15, 85, 0, '#a16207', 'gap'],
  ['bomb', 'Sticky Bomb', 'BOMB', 'offence', 16, 115, 2000, '#dc2626', 'ahead-rival'],
  ['reflect', 'Mirror Plate', 'MIRROR', 'defence', 17, 95, 3000, '#e0f2fe', 'danger'],
  ['blink', 'Blink', 'BLINK', 'movement', 18, 100, 0, '#a78bfa', 'gap'],
  ['emp', 'EMP', 'EMP', 'offence', 19, 120, 4000, '#38bdf8', 'ahead-rival'],
  ['lightning', 'Lightning Strike', 'STRIKE', 'offence', 20, 130, 1000, '#fde047', 'ahead-rival'],
  ['drill', 'Drill', 'DRILL', 'utility', 22, 110, 1000, '#78716c', 'wall'],
  ['charm', "Shaman's Charm", 'CHARM', 'defence', 25, 150, 8000, '#34d399', 'low-hp'],
];

test('the catalogue: 24 skills in this order, with exactly these numbers', () => {
  assert.deepEqual([...SKILL_IDS], TABLE.map((r) => r[0]));
  for (const [id, name, short, group, unlockLevel, price, durationMs, color, aiHint] of TABLE) {
    const d = SKILLS[id as keyof typeof SKILLS];
    assert.deepEqual(
      { id: d.id, name: d.name, short: d.short, group: d.group, unlockLevel: d.unlockLevel, price: d.price, durationMs: d.durationMs, color: d.color, aiHint: d.aiHint },
      { id, name, short, group, unlockLevel, price, durationMs, color, aiHint }, id,
    );
    assert.ok(d.desc.length >= 20 && d.desc.length <= 120, `${id}: a one-sentence description`);
    assert.equal(d.legacy, (LEGACY_SKILLS as readonly string[]).includes(id), `${id}: legacy flag`);
  }
});

test('starters, legacy ids and group colours', () => {
  assert.deepEqual([...STARTER_SKILLS], ['rocket', 'jump', 'shield']);
  assert.deepEqual([...LEGACY_SKILLS], ['rocket', 'jump', 'oil', 'shock', 'anvil', 'aero', 'freeze', 'ghost']);
  assert.deepEqual(GROUP_COLORS, { movement: '#38bdf8', offence: '#ef4444', defence: '#22c55e', utility: '#f59e0b' });
});

test('skillDef: a known id gives its def; anything else gives null', () => {
  assert.equal(skillDef('ram')?.name, 'Battering Ram');
  assert.equal(skillDef('nope'), null);
  assert.equal(skillDef(''), null);
  assert.equal(skillDef('toString'), null, 'not fooled by object prototype keys');
});

test('skillsInGroup: catalogue order', () => {
  assert.deepEqual(skillsInGroup('utility').map((d) => d.id), ['ram', 'drill']);
  assert.deepEqual(skillsInGroup('defence').map((d) => d.id), ['shield', 'repair', 'anvil', 'ghost', 'decoy', 'reflect', 'charm']);
  assert.equal(skillsInGroup('movement').length + skillsInGroup('offence').length + skillsInGroup('defence').length + skillsInGroup('utility').length, 24);
});

test('unlockedSkills: everything at or below the level, catalogue order', () => {
  assert.deepEqual(unlockedSkills(1), ['rocket', 'jump', 'shield']);
  assert.deepEqual(unlockedSkills(4), ['rocket', 'jump', 'shield', 'oil', 'ram', 'repair']);
  assert.equal(unlockedSkills(30).length, 24);
  assert.equal(unlockedSkills(21).length, 22, 'drill (22) and charm (25) still locked');
  assert.deepEqual(unlockedSkills(0), []);
});

test('newUnlocks: the skills a level-up from one level to another unlocks (from exclusive, to inclusive)', () => {
  assert.deepEqual(newUnlocks(1, 3), ['oil', 'ram']);
  assert.deepEqual(newUnlocks(20, 22), ['drill']);
  assert.deepEqual(newUnlocks(5, 5), []);
  assert.deepEqual(newUnlocks(22, 24), []);
});

test('nextUnlock: the next skill to unlock above this level, or null when all are unlocked', () => {
  assert.deepEqual(nextUnlock(1), { id: 'oil', level: 2 });
  assert.deepEqual(nextUnlock(20), { id: 'drill', level: 22 });
  assert.deepEqual(nextUnlock(22), { id: 'charm', level: 25 });
  assert.equal(nextUnlock(25), null);
});

test('allowedOnline: starters always; anything else needs the campaign finished AND the level', () => {
  assert.equal(allowedOnline('shield', 1, false), true);
  assert.equal(allowedOnline('oil', 30, false), false, 'campaign not finished');
  assert.equal(allowedOnline('oil', 2, true), true);
  assert.equal(allowedOnline('charm', 24, true), false, 'level too low');
  assert.equal(allowedOnline('nope', 30, true), false);
});

test('sanitizeSkillList: known ids only, no repeats, first come first kept, at most `max`', () => {
  assert.deepEqual(sanitizeSkillList(['ram', 'nope', 'ram', 'oil', 3, null, 'shield']), ['ram', 'oil', 'shield']);
  assert.deepEqual(sanitizeSkillList('ram'), []);
  assert.deepEqual(sanitizeSkillList(null), []);
  assert.equal(sanitizeSkillList([...SKILL_IDS]).length, 8, 'default max is 8');
  assert.deepEqual(sanitizeSkillList(['ram', 'oil', 'bolt'], 2), ['ram', 'oil']);
});
