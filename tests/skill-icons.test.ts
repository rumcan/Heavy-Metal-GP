// Skill button art: every skill (the 24 and the premium ones) has its plaque (src/assets/ui/item-<id>.webp), the same size as the
// original eight, small enough for the single-file build, and no two alike.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ITEM_TYPES } from '../src/game/types';
import { ICONS } from '../scripts/icons/generate.mjs';

const ui = (id: string) => fileURLToPath(new URL(`../src/assets/ui/item-${id}.webp`, import.meta.url));

test('every skill has its button art', () => {
  const missing = ITEM_TYPES.filter((id) => !existsSync(ui(id)));
  assert.deepEqual(missing, []);
});

test('the generator covers exactly the skills that have no hand-made art', () => {
  const generated = ICONS.map(([id]) => id).sort();
  const original = ['aero', 'anvil', 'freeze', 'ghost', 'jump', 'oil', 'rocket', 'shock'];
  assert.deepEqual([...generated, ...original].sort(), [...ITEM_TYPES].sort());
  assert.equal(new Set(ICONS.map(([, label]) => label)).size, ICONS.length, 'every label is different');
});

test('button art is the size of the originals, small, transparent around the plaque, and no two are the same', async () => {
  const hashes = new Map<string, string>();
  for (const id of ITEM_TYPES) {
    const file = ui(id);
    assert.ok(statSync(file).size < 40 * 1024, `${id} is ${Math.round(statSync(file).size / 1024)} KB`);
    const meta = await sharp(file).metadata();
    assert.ok(meta.width! >= 300 && meta.width! <= 315, `${id} width ${meta.width}`); // the originals are 305..312 wide
    assert.equal(meta.height, 240, `${id} height`);
    assert.ok(meta.hasAlpha, `${id} has transparency`);
    const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
    assert.ok(!hashes.has(hash), `${id} is the same file as ${hashes.get(hash)}`);
    hashes.set(hash, id);
  }
  const total = ITEM_TYPES.reduce((sum, id) => sum + statSync(ui(id)).size, 0);
  // a budget per plaque (the 24 skills had 900 KB, about 37 KB each): the single-file build stays small as skills are added
  assert.ok(total < ITEM_TYPES.length * 30 * 1024, `all button art together is ${Math.round(total / 1024)} KB for ${ITEM_TYPES.length} skills`);
});
