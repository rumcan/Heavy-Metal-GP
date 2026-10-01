import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAccount, purchaseItem, settleRace, settleOnlineRace, onlineRaceId, ONLINE_PAYOUT_SCALE, parseAccount, prizeFor, RACE_PRIZES } from '../src/game/economy';
import { emptyInventory, ITEM_INFO, ITEM_TYPES, MAX_ITEM_STACK, normalizeInventory } from '../src/game/types';

test('Economy: a purchase subtracts its exact price and adds one persistent charge', () => {
  const before = createAccount();
  const bought = purchaseItem(before, 'rocket');
  assert.equal(bought.error, undefined);
  assert.equal(bought.account.credits, 400 - ITEM_INFO.rocket.price);
  assert.equal(bought.account.inventory.rocket, 1);
  assert.equal(before.inventory.rocket, 0);
  assert.deepEqual(parseAccount(JSON.stringify(bought.account)), bought.account);
});

test('Economy: insufficient funds and full stacks cannot be purchased', () => {
  const empty = { ...createAccount(), credits: 0 };
  assert.strictEqual(purchaseItem(empty, 'jump').account, empty);
  assert.ok(purchaseItem(empty, 'jump').error);
  const full = { ...createAccount(), inventory: { ...emptyInventory(), jump: MAX_ITEM_STACK } };
  assert.strictEqual(purchaseItem(full, 'jump').account, full);
  assert.ok(purchaseItem(full, 'jump').error);
});

test('Economy: all placements pay credits and orange pegs add a finish bonus', () => {
  for (let i = 1; i <= 10; i++) {
    const prize = prizeFor({ id: 0, rank: i, time: 40000, pegs: 3 });
    assert.equal(prize.placement, RACE_PRIZES[i - 1]);
    assert.equal(prize.pegBonus, 15);
  }
  assert.deepEqual(prizeFor({ id: 0, rank: 1, time: null, pegs: 99 }), { placement: 0, pegBonus: 0 });
  assert.deepEqual(prizeFor({ id: 0, rank: -1, time: 20, pegs: 99 }), { placement: 0, pegBonus: 0 });
});

test('Economy: the same race payout cannot be collected twice, including after reload', () => {
  const result = { id: 0, rank: 2, time: 50000, pegs: 3 };
  const first = settleRace(createAccount(), 'champ:42:0:0', result);
  assert.equal(first.payout.total, 365);
  assert.equal(first.account.credits, 765);
  assert.equal(first.account.finishes, 1);
  const loaded = parseAccount(JSON.stringify(first.account));
  const second = settleRace(loaded, 'champ:42:0:0', result);
  assert.strictEqual(second.account, loaded);
  assert.equal(second.payout.alreadyPaid, true);
  assert.equal(second.account.credits, 765);
  assert.equal(settleRace(loaded, 'champ:42:0:1', result).account.credits, 1130);
});

test('Economy: invalid saves and inventory counts are safely normalized', () => {
  assert.equal(parseAccount('invalid json').credits, 400);
  assert.equal(parseAccount('{"version":1,"credits":-10}').credits, 400);
  const clean = normalizeInventory({ rocket: 999, jump: -2, aero: '5', shock: NaN, oil: 3.9, invalid: 3 });
  assert.equal(clean.rocket, 9);
  assert.equal(clean.jump, 0);
  assert.equal(clean.aero, 0);
  assert.equal(clean.shock, 0);
  assert.equal(clean.oil, 3);
  assert.deepEqual(Object.keys(clean).sort(), [...ITEM_TYPES].sort());
});

test('Economy: fast consecutive purchases never overspend or reset an inventory', () => {
  let account = createAccount();
  for (let i = 0; i < 20; i++) account = purchaseItem(account, 'jump').account;
  assert.equal(account.inventory.jump, Math.floor(400 / ITEM_INFO.jump.price));
  assert.equal(account.credits, 400 % ITEM_INFO.jump.price);
  assert.ok(account.credits >= 0);
});
// ── MP-09 ─────────────────────────────────────────────────────────────────
// An online race has no banker: every screen pays itself, out of the host's
// classification, for the seat it was driving. What has to be identical on both
// ends is therefore not the wallet but the RACE.

test('MP-09 economy: an online race is one race, by one id, on every screen', () => {
  // `countdownAt` is the instant the lobby published — the race's identity on
  // the wire — so both screens settle under the same id without talking about
  // money, and neither can pay the same race twice.
  assert.equal(onlineRaceId('ABC123', 1_700_000_000_000), 'online:ABC123:1700000000000');
  assert.equal(onlineRaceId('ABC123', 1_700_000_000_000), onlineRaceId('ABC123', 1_700_000_000_000), 'same race, same id');
  assert.notEqual(onlineRaceId('ABC123', 1_700_000_000_000), onlineRaceId('ABC123', 1_700_000_060_000), 'the next heat is a different race');
  assert.notEqual(onlineRaceId('ABC123', 1_700_000_000_000), onlineRaceId('XYZ999', 1_700_000_000_000), 'and so is another room’s');
});

test('MP-09 economy: an online heat pays the online share, once, and the panel adds up', () => {
  const me = { id: 3, rank: 2, time: 50_000, pegs: 3 };
  const first = settleOnlineRace(createAccount(), onlineRaceId('ABC123', 42), me);
  // A championship P2 with three pegs is 365; online is that, scaled.
  const full = settleRace(createAccount(), 'champ:1:1:1', me);
  assert.equal(first.payout.total, Math.round(350 * ONLINE_PAYOUT_SCALE) + Math.round(15 * ONLINE_PAYOUT_SCALE));
  assert.ok(first.payout.total < full.payout.total, 'an online heat pays less than a championship round');
  // The results panel shows the two halves and a total: they have to agree, or
  // it is showing arithmetic nobody believes.
  assert.equal(first.payout.placement + first.payout.pegBonus, first.payout.total);
  assert.equal(first.account.credits, 400 + first.payout.total);

  // Once. A rejoin, a republish, a second `results` frame — none of them pays
  // the same race again.
  const again = settleOnlineRace(first.account, onlineRaceId('ABC123', 42), me);
  assert.strictEqual(again.account, first.account);
  assert.equal(again.payout.alreadyPaid, true);
  assert.equal(again.account.credits, first.account.credits);
});

test('MP-09 economy: a driver who did not finish an online race is paid nothing', () => {
  // And a race that never reached a classification (the host left) never calls
  // this at all — so the only way to be paid is to have finished.
  const dnf = settleOnlineRace(createAccount(), onlineRaceId('ABC123', 9), { id: 1, rank: 4, time: null, pegs: 7 });
  assert.equal(dnf.payout.total, 0);
  assert.equal(dnf.account.credits, 400);
  assert.equal(dnf.account.finishes, 0);
});

// ── P2-05: race loot and the additive v1 trophy ledger ─────────────────────
test('Trophies: v1 saves migrate without losing credits, inventory or the payout ledger', async () => {
  const { keptSkills } = await import('../src/game/economy');
  const legacy = { version: 1, credits: 765, inventory: { ...emptyInventory(), rocket: 3 }, paidRaces: ['old-race'], totalWinnings: 365, finishes: 1 };
  const loaded = parseAccount(JSON.stringify(legacy));
  assert.equal(loaded.credits, legacy.credits);
  assert.deepEqual(loaded.inventory, legacy.inventory);
  assert.deepEqual(loaded.paidRaces, legacy.paidRaces);
  assert.equal(loaded.totalWinnings, legacy.totalWinnings);
  assert.equal(loaded.finishes, legacy.finishes);
  assert.deepEqual(loaded.trophies, emptyInventory());
  assert.deepEqual(loaded.trophyRaces, []);
  assert.deepEqual(keptSkills(undefined, loaded.inventory), emptyInventory(), 'a missing snapshot must not invent loot');
});

test('Trophies: kept is the positive net change, not starting stock or spent skills', async () => {
  const { keptSkills } = await import('../src/game/economy');
  const start = { ...emptyInventory(), rocket: 2, oil: 3, anvil: 9 };
  const end = { ...start, rocket: 5, oil: 1, jump: 2 };
  assert.deepEqual(keptSkills(start, end), { ...emptyInventory(), rocket: 3, jump: 2 });
  assert.deepEqual(start, { ...emptyInventory(), rocket: 2, oil: 3, anvil: 9 }, 'snapshots are not mutated');
  assert.deepEqual(keptSkills(start, null), emptyInventory());
});

test('Trophies: races count once after reload and lifetime totals can exceed a full stack', async () => {
  const { addRaceTrophies } = await import('../src/game/economy');
  const start = { ...emptyInventory(), rocket: 1, oil: 2 };
  const end = { ...start, rocket: 9, oil: 1 };
  const base = { ...createAccount(), inventory: end };
  const first = addRaceTrophies(base, 'race-a', start, end);
  assert.equal(first.trophies.rocket, 8);
  assert.equal(first.trophies.oil, 0);
  assert.equal(first.credits, base.credits);
  assert.deepEqual(first.inventory, end, 'recording trophies does not duplicate owned charges');
  assert.deepEqual(first.paidRaces, [], 'trophies are independent of credits, including DNF/unscored heats');
  const loaded = parseAccount(JSON.stringify(first));
  assert.strictEqual(addRaceTrophies(loaded, 'race-a', start, end), loaded);
  const second = addRaceTrophies(loaded, 'race-b', start, end);
  assert.equal(parseAccount(JSON.stringify(second)).trophies.rocket, 16, 'lifetime is not capped at nine');
  assert.equal(base.trophies.rocket, 0, 'the reducer is immutable');
});

test('Trophies: invalid counts and race ids are safely migrated', () => {
  const loaded = parseAccount(JSON.stringify({ ...createAccount(), trophies: { rocket: 24, jump: -1, oil: 2.9, shock: '99', anvil: null, aero: 1e12, freeze: 0, ghost: 5, unknown: 8 }, trophyRaces: ['a', 'a', '', 3, 'x'.repeat(180)] }));
  assert.deepEqual(loaded.trophies, { ...emptyInventory(), rocket: 24, oil: 2, aero: 1e9, ghost: 5 });
  assert.deepEqual(loaded.trophyRaces, ['a']);
});

test('Trophies: stale wallet/shop saves cannot erase results trophies or double-count them', async () => {
  const { ACCOUNT_KEY, loadAccount, saveAccount, saveRaceTrophies } = await import('../src/game/economy');
  const storage = await import('../src/game/storage');
  storage.removeItem(ACCOUNT_KEY);
  try {
    const beforeResults = { ...createAccount(), inventory: { ...emptyInventory(), freeze: 2 } };
    saveAccount(beforeResults);
    saveRaceTrophies('fixture-race', emptyInventory(), beforeResults.inventory);
    assert.equal(loadAccount().trophies.freeze, 2);
    const purchased = purchaseItem(beforeResults, 'jump').account;
    saveAccount(purchased); // App's old account doesn't yet have the trophy ledger.
    assert.equal(loadAccount().credits, purchased.credits);
    assert.equal(loadAccount().inventory.jump, 1);
    assert.equal(loadAccount().trophies.freeze, 2);
    assert.deepEqual(loadAccount().trophyRaces, ['fixture-race']);
    saveRaceTrophies('fixture-race', emptyInventory(), beforeResults.inventory);
    assert.equal(loadAccount().trophies.freeze, 2, 'StrictMode/rating updates cannot count again');
    saveRaceTrophies('next-race', beforeResults.inventory, { ...beforeResults.inventory, freeze: 3 });
    assert.equal(loadAccount().trophies.freeze, 3);
    assert.equal(loadAccount().inventory.jump, 1, 'a trophy write keeps the current wallet intact');
  } finally { storage.removeItem(ACCOUNT_KEY); }
});
