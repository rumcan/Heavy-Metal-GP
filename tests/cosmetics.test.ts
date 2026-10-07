// P2-18 (#126) battle tests, job BRAVO: the ball-customisation catalogue in src/game/cosmetics.ts.
// Standalone: these tests use the pure catalogue, wallet, cache, and lobby/protocol helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MATERIALS, PATTERNS, TRAILS, KO_BURSTS, FINISH_FX, PALETTE, DEFAULT_LOOK,
  COSMETICS_STORAGE_KEY, unlockOf, isUnlocked, unlockHint, sanitizeLook, lockedReset, parseCosmeticsSave,
} from '../src/game/cosmetics';
import type { BallLook, Progress } from '../src/game/cosmetics';
import { createAccount, cosmeticProgressOf, parseAccount, purchaseCosmetic, settleRace } from '../src/game/economy';
import { BallSkinCache, ballSkinKey, ballLookForMarble, advanceRoll, MAX_ROLL_STEP } from '../src/game/ball-skin';
import { fileGarage, rosterOf } from '../src/net/lobby';
import { PROTOCOL_VERSION, validateGarage } from '../src/net/protocol';
import type { Seat } from '../src/net/protocol';
import type { Marble } from '../src/game/engine';

const fresh: Progress = { level: 1, owned: [], achievements: [] };

test('catalogue sizes, order and unique ids', () => {
  assert.equal(MATERIALS.length, 10);
  assert.equal(PATTERNS.length, 12);
  assert.equal(TRAILS.length, 8);
  assert.equal(KO_BURSTS.length, 4);
  assert.equal(FINISH_FX.length, 4);
  for (const ids of [MATERIALS, PATTERNS, TRAILS, KO_BURSTS, FINISH_FX]) assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...MATERIALS], ['steel', 'chrome', 'brass', 'rust', 'oak', 'granite', 'glass', 'lava', 'ice', 'gold']);
  assert.deepEqual([...PATTERNS], ['plain', 'stripes', 'band', 'checker', 'flames', 'skull', 'goblin', 'number', 'team', 'stars', 'cracks', 'rivets']);
  assert.deepEqual([...TRAILS], ['none', 'smoke', 'sparks', 'fire', 'ice', 'rainbow', 'coins', 'wisps']);
  assert.deepEqual([...KO_BURSTS], ['classic', 'confetti', 'scrap', 'ghost']);
  assert.deepEqual([...FINISH_FX], ['flag', 'fireworks', 'crown', 'spin']);
  assert.equal(PALETTE.length, 24);
  assert.ok(PALETTE.every((c) => /^#[0-9a-f]{6}$/.test(c)), 'lower-case #rrggbb');
  assert.equal(new Set(PALETTE).size, 24, 'no duplicates');
});

test('the default look is all free choices', () => {
  assert.deepEqual(DEFAULT_LOOK, { material: 'steel', primary: PALETTE[0], secondary: PALETTE[1], pattern: 'plain', number: 7, trail: 'none', koBurst: 'classic', finishFx: 'flag' });
  for (const [category, id] of [['material', 'steel'], ['pattern', 'plain'], ['trail', 'none'], ['koBurst', 'classic'], ['finishFx', 'flag']] as const) {
    assert.ok(isUnlocked(category, id, fresh), `${category}:${id}`);
  }
});

test('unlockOf: the table', () => {
  assert.deepEqual(unlockOf('material', 'steel'), { kind: 'free' });
  assert.deepEqual(unlockOf('material', 'chrome'), { kind: 'level', level: 3 });
  assert.deepEqual(unlockOf('material', 'oak'), { kind: 'credits', price: 300 });
  assert.deepEqual(unlockOf('material', 'lava'), { kind: 'achievement', id: 'campaign' });
  assert.deepEqual(unlockOf('material', 'gold'), { kind: 'achievement', id: 'first-win' });
  assert.deepEqual(unlockOf('pattern', 'skull'), { kind: 'achievement', id: 'ten-kos' });
  assert.deepEqual(unlockOf('pattern', 'checker'), { kind: 'credits', price: 200 });
  assert.deepEqual(unlockOf('trail', 'rainbow'), { kind: 'achievement', id: 'pegs-50' });
  assert.deepEqual(unlockOf('trail', 'wisps'), { kind: 'level', level: 12 });
  assert.deepEqual(unlockOf('koBurst', 'scrap'), { kind: 'credits', price: 200 });
  assert.deepEqual(unlockOf('finishFx', 'crown'), { kind: 'achievement', id: 'first-win' });
});

test('isUnlocked: level, purchase and achievement rules', () => {
  assert.equal(isUnlocked('material', 'chrome', fresh), false);
  assert.equal(isUnlocked('material', 'chrome', { ...fresh, level: 3 }), true);
  assert.equal(isUnlocked('material', 'oak', fresh), false);
  assert.equal(isUnlocked('material', 'oak', { ...fresh, owned: ['material:oak'] }), true);
  assert.equal(isUnlocked('material', 'lava', { ...fresh, achievements: ['campaign'] }), true);
  assert.equal(isUnlocked('material', 'nope', { ...fresh, level: 99 }), false, 'unknown ids are never unlocked');
});

test('unlockHint: one plain sentence per lock', () => {
  assert.equal(unlockHint('material', 'steel'), 'Free');
  assert.equal(unlockHint('material', 'chrome'), 'Reach level 3');
  assert.equal(unlockHint('material', 'oak'), 'Buy for 300 CR');
  assert.equal(unlockHint('material', 'gold'), 'Win your first race');
  assert.equal(unlockHint('pattern', 'skull'), 'Knock out 10 rivals');
  assert.equal(unlockHint('material', 'lava'), 'Finish the campaign');
  assert.equal(unlockHint('trail', 'rainbow'), 'Hit 50 orange pegs in one race');
});

test('sanitizeLook: anything off the wire becomes a valid look', () => {
  assert.deepEqual(sanitizeLook(null), DEFAULT_LOOK);
  assert.deepEqual(sanitizeLook({ material: 'gold', primary: PALETTE[5], secondary: '#123456', pattern: 'lasers', number: 150, trail: 'fire', koBurst: 7, finishFx: 'crown' }),
    { material: 'gold', primary: PALETTE[5], secondary: DEFAULT_LOOK.secondary, pattern: 'plain', number: 7, trail: 'fire', koBurst: 'classic', finishFx: 'crown' });
  assert.equal(sanitizeLook({ number: 42 }).number, 42);
  assert.equal(sanitizeLook({ number: 4.5 }).number, 7, 'whole numbers 0..99 only');
});

test('lockedReset: locked choices fall back to the default, unlocked ones stay', () => {
  const look = { ...DEFAULT_LOOK, material: 'gold', trail: 'smoke', pattern: 'flames' } as const;
  assert.deepEqual(lockedReset(look, fresh), { ...look, material: 'steel', pattern: 'plain' });
  assert.deepEqual(lockedReset(look, { level: 6, owned: [], achievements: ['first-win'] }), look);
});

test('cosmetics save migration: old accounts and an absent look key start with the default ball', () => {
  assert.equal(COSMETICS_STORAGE_KEY, 'heavy-metal-gp:cosmetics:v1');
  assert.deepEqual(parseCosmeticsSave(null), { version: 1, look: DEFAULT_LOOK });
  const legacyLook = { material: 'chrome', primary: PALETTE[4], pattern: 'stripes' };
  assert.deepEqual(parseCosmeticsSave(JSON.stringify(legacyLook)), {
    version: 1,
    look: { ...DEFAULT_LOOK, material: 'chrome', primary: PALETTE[4], pattern: 'stripes' },
  });
  const migrated = parseAccount(JSON.stringify({ version: 1, credits: 765, inventory: {}, finishes: 3 }));
  assert.equal(migrated.credits, 765, 'migration keeps the existing wallet');
  assert.deepEqual(migrated.cosmeticOwned, []);
  assert.deepEqual(migrated.cosmeticAchievements, []);
  assert.equal(migrated.cosmeticKos, 0);
  assert.deepEqual(createAccount().cosmeticOwned, []);
});

test('cosmetic credit purchases are deduplicated, persisted on the account, and cannot bypass locks', () => {
  const before = createAccount();
  const bought = purchaseCosmetic(before, 'material', 'oak');
  assert.equal(bought.error, undefined);
  assert.equal(bought.account.credits, 100);
  assert.deepEqual(bought.account.cosmeticOwned, ['material:oak']);
  assert.deepEqual(parseAccount(JSON.stringify(bought.account)).cosmeticOwned, ['material:oak']);
  assert.equal(purchaseCosmetic(bought.account, 'material', 'oak').error, 'You already own this cosmetic.');
  assert.equal(purchaseCosmetic(before, 'material', 'chrome').error, 'Reach level 3');
  assert.equal(purchaseCosmetic({ ...before, credits: 0 }, 'material', 'oak').error, 'You need 300 more credits.');
});

test('race achievements unlock cosmetics once and migrate through the account ledger', () => {
  const won = settleRace(createAccount(), 'cosmetics:first-win', { id: 0, rank: 1, time: 12000, pegs: 50, kos: 10 }).account;
  const progress = cosmeticProgressOf(won);
  assert.ok(progress.achievements.includes('first-win'));
  assert.ok(progress.achievements.includes('ten-kos'));
  assert.ok(progress.achievements.includes('pegs-50'));
  assert.equal(isUnlocked('material', 'gold', progress), true);
  assert.equal(isUnlocked('pattern', 'skull', progress), true);
  assert.equal(isUnlocked('trail', 'rainbow', progress), true);
  assert.ok(cosmeticProgressOf({ ...createAccount(), campaignComplete: true }).achievements.includes('campaign'));
  const replay = settleRace(won, 'cosmetics:first-win', { id: 0, rank: 1, time: 12000, pegs: 50, kos: 50 }).account;
  assert.equal(replay.cosmeticKos, 10, 'duplicate race results do not award KOs twice');
});

test('skin cache redraws only when a validated look changes', () => {
  const cache = new BallSkinCache<{ serial: number }>();
  const owner = {};
  let builds = 0;
  const build = () => ({ serial: ++builds });
  const defaultKey = ballSkinKey(DEFAULT_LOOK);
  assert.equal(ballSkinKey({ material: 'not-in-the-catalogue' }), defaultKey, 'invalid ids normalize to the default key');
  const first = cache.get(owner, defaultKey, build);
  assert.strictEqual(cache.get(owner, defaultKey, build), first);
  assert.equal(builds, 1, 'same look is not redrawn');
  const changed = cache.get(owner, ballSkinKey({ ...DEFAULT_LOOK, primary: PALETTE[2] }), build);
  assert.notStrictEqual(changed, first);
  assert.equal(builds, 2, 'appearance changes redraw once');
  assert.strictEqual(cache.get(owner, ballSkinKey({ ...DEFAULT_LOOK, primary: PALETTE[2] }), build), changed);
  assert.equal(builds, 2);
  cache.delete(owner);
  cache.get(owner, ballSkinKey({ ...DEFAULT_LOOK, primary: PALETTE[2] }), build);
  assert.equal(builds, 3, 'discarding a marble drops its entry');
});

test('multiplayer garages carry a look; catalogue-invalid ids become the default before every roster renders', () => {
  assert.ok(PROTOCOL_VERSION >= 10, 'cosmetic SeatGarage fields have a new wire version');
  const invalid = { ...DEFAULT_LOOK, material: 'photon', pattern: 'fake-decal', number: 111 } as unknown as BallLook;
  const garage = {
    name: 'Network Goblin', color: '#22d3ee', stats: { weight: 5, speed: 5, bounce: 5 }, portrait: 1,
    cosmeticLook: invalid,
  };
  assert.equal(validateGarage(garage), null, 'unknown cosmetic ids fall back instead of rejecting the whole lobby');
  const seat: Seat = {
    slot: 1, playerId: 'guest-1', name: 'Guest', color: '#d63e2e', stats: { weight: 5, speed: 5, bounce: 5 },
    portrait: 0, isAI: false, ready: true,
  };
  const filed = fileGarage([seat], 'guest-1', garage);
  const normalized = filed[0].cosmeticLook;
  assert.deepEqual(normalized, DEFAULT_LOOK);
  assert.deepEqual((filed[0].stats as typeof filed[0]['stats'] & { cosmeticLook?: BallLook }).cosmeticLook, DEFAULT_LOOK,
    'the host/guest MarbleInfo stats path carries the same normalized appearance');
  const roster = rosterOf(filed, 0);
  assert.deepEqual(roster[0].cosmeticLook, DEFAULT_LOOK);
  assert.deepEqual(ballLookForMarble({ info: roster[0] } as unknown as Marble), DEFAULT_LOOK);

  const forgedSeat = { ...filed[0], cosmeticLook: invalid } as Seat;
  assert.deepEqual(rosterOf([forgedSeat], 0)[0].cosmeticLook, DEFAULT_LOOK, 'received seats are sanitized too');
});

test('a ball spins by the distance it rolls, forwards at any speed, and not on a respawn', () => {
  let s = advanceRoll(undefined, 0, 0, 14);
  assert.equal(s.angle, 0);
  s = advanceRoll(s, 7, 0, 14);
  assert.ok(Math.abs(s.angle - 0.5) < 1e-9, 'rolling right half a radius turns half a radian clockwise');
  s = advanceRoll(s, 0, 0, 14);
  assert.ok(Math.abs(s.angle) < 1e-9, 'rolling back turns it back');
  s = advanceRoll(s, 60, 0, 14);
  assert.ok(Math.abs(s.angle - MAX_ROLL_STEP) < 1e-9, 'a very fast frame is capped so the spin never reads backwards');
  const before = s.angle;
  s = advanceRoll(s, 2000, -500, 14);
  assert.equal(s.angle, before, 'a teleport is not rolling');
  s = advanceRoll(s, 2000, -480, 14);
  assert.equal(s.angle, before, 'falling straight down keeps the spin');
});
