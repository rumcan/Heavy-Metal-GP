// Run with: node --import tsx --test tests/premium.test.ts
// The owner: one button, about a dollar of RUN Bits, unlocks everything. Every lock in the game consults the unlock.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import shop from '../rundot/shop.config.json';
import { ALL_TIERS_LEVEL, UNLOCK_ALL_ID, UNLOCK_ALL_PRICE_BITS, UNLOCK_ALL_STORAGE_KEY, buyUnlockAll, onUnlockAll, setUnlockAll, talentTierLevel, unlockAllOwned } from '../src/game/premium';
import { STORAGE_KEYS } from '../src/game/storage';
import { lockReason } from '../src/game/loadout';
import type { Catalog } from '../src/game/loadout';
import { isUnlocked } from '../src/game/cosmetics';
import { canRankUp, TALENTS, tierLevel } from '../src/game/talents';
import { chapterUnlocked, newStory } from '../src/game/story/state';

afterEach(() => setUnlockAll(false));

const CAT: Catalog = { rocket: { price: 90, unlockLevel: 1, starter: true }, charm: { price: 150, unlockLevel: 25, starter: false } };

test('the shop item on RUN matches the game: one id, one price, a permanent entitlement', () => {
  const item = shop.items.find((i) => i.itemId === UNLOCK_ALL_ID)!;
  assert.ok(item && item.active && item.unique);
  assert.equal(item.category, 'non_consumable');
  assert.deepEqual(item.price, { type: 'bucks', value: String(UNLOCK_ALL_PRICE_BITS) });
  assert.deepEqual(item.entitlements, [{ entitlementId: UNLOCK_ALL_ID, quantity: 1, consumable: false }]);
  assert.ok((STORAGE_KEYS as readonly string[]).includes(UNLOCK_ALL_STORAGE_KEY), 'the cached answer survives a reload');
  assert.ok((STORAGE_KEYS as readonly string[]).includes('heavy-metal-gp:radio'), 'and so do the radio settings');
});

test('skills: a level-locked skill (and an online one before the campaign) opens with the unlock', () => {
  assert.equal(lockReason('charm', CAT, { level: 1, campaignComplete: false }, false), 'level');
  assert.equal(lockReason('charm', CAT, { level: 30, campaignComplete: false }, true), 'campaign');
  setUnlockAll(true);
  assert.equal(lockReason('charm', CAT, { level: 1, campaignComplete: false }, false), null);
  assert.equal(lockReason('charm', CAT, { level: 1, campaignComplete: false }, true), null);
  assert.equal(lockReason('no-such-skill', CAT, { level: 1, campaignComplete: false }, false), 'unknown', 'unknown ids stay unknown');
});

test('cosmetics: level, credit and achievement locks open; unknown ids never do', () => {
  const p = { level: 1, owned: [], achievements: [] };
  assert.equal(isUnlocked('material', 'brass', p), false);
  assert.equal(isUnlocked('material', 'lava', p), false);
  assert.equal(isUnlocked('material', 'brass', { ...p, unlockAll: true }), true);
  assert.equal(isUnlocked('material', 'lava', { ...p, unlockAll: true }), true);
  assert.equal(isUnlocked('material', 'no-such', { ...p, unlockAll: true }), false);
});

test('talents: every tier opens (the points still come from levels)', () => {
  // a tier-2 talent with its tree's tier-1 talents maxed: only the level gate stands in the way at level 1
  const high = TALENTS.find((t) => t.tier === 2)!;
  const build = Object.fromEntries(TALENTS.filter((t) => t.tree === high.tree && t.tier === 1).map((t) => [t.id, t.maxRank]));
  const spent = Object.values(build).reduce((a, v) => a + v, 0);
  assert.ok(tierLevel(2) > 1 && spent >= 3, 'fixture: the tier below is full');
  assert.equal(canRankUp(build, high.id, talentTierLevel(1), spent + 1), false, 'level 1: tier 2 is shut');
  setUnlockAll(true);
  assert.equal(talentTierLevel(1), ALL_TIERS_LEVEL);
  assert.equal(canRankUp(build, high.id, talentTierLevel(1), spent + 1), true, 'unlocked: tier 2 is open');
  assert.equal(canRankUp(build, high.id, talentTierLevel(1), spent), false, 'but a point is still needed');
});

test('story: every chapter opens', () => {
  const s = newStory(1, { name: 'T', color: '#f00', portrait: 0, stats: { weight: 5, speed: 5, bounce: 5 } });
  assert.equal(chapterUnlocked(s, 1), true);
  assert.equal(chapterUnlocked(s, 4), false);
  setUnlockAll(true);
  assert.equal(chapterUnlocked(s, 4), true);
});

test('the flag: listeners hear a change once; buying without RUN behind the page is unavailable (nothing charged)', async () => {
  const heard: boolean[] = [];
  const off = onUnlockAll((v) => heard.push(v));
  setUnlockAll(true);
  setUnlockAll(true);
  setUnlockAll(false);
  off();
  assert.deepEqual(heard, [true, false]);
  assert.equal(unlockAllOwned(), false);
  assert.equal(await buyUnlockAll(), 'unavailable');
});
