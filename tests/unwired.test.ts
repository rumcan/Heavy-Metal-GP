// P2-20 — docs/arena/P2-20-finish-unwired.md: one smoke test per job, deliberately
// cross-module. The deep rules live with their own modules (xp-wiring, talents-wiring,
// loadout, protocol, host); this file proves the four jobs are WIRED — each one end to
// end through the API the screens actually call.
//
// Standalone: node --import tsx --test tests/unwired.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { awardResultXp, createAccount, progressOf, settleRace } from '../src/game/economy';
import { Game } from '../src/game/engine';
import { buildPlatformerTrack } from '../src/game/platformer/build';
import { trimKit, mergeRaceKit } from '../src/game/loadout';
import { PROTOCOL_VERSION, readRaceSettings } from '../src/net/protocol';
import { AI_COLORS, AI_NAMES, emptyInventory, mulberry32, randomStats, TRACK_THEMES } from '../src/game/types';

// ─── Job 1 — championship and story results ────────────────────────────────────

test('job 1: a story race pays its purse once, its KO bounty, the Shaman fee — and XP once per race id', () => {
  const acc = { ...createAccount(), credits: 5000 };
  // A health result: purse rules run — KO bounty in, story Shaman fee (30 %, min 250) out.
  const dnf = { id: 0, rank: 10, time: null, pegs: 2, dnf: true, kos: 1 } as const;
  const first = settleRace(acc, 'story:7:1:1', dnf, 1, 'story');
  assert.equal(first.payout.koBounty, 75, 'a rival you knocked out pays the KO bounty');
  assert.ok(first.payout.shamanFee >= 250, `the story fee is 30 % of the wallet, at least 250: got ${first.payout.shamanFee}`);
  assert.equal(first.payout.alreadyPaid, false);
  const replay = settleRace(first.account, 'story:7:1:1', dnf, 1, 'story');
  assert.equal(replay.account.credits, first.account.credits, 'a replayed race id pays no purse twice');
  assert.equal(replay.payout.alreadyPaid, true);

  // XP rides the same once-per-race-id gate: a win levels a fresh account once, never twice.
  const win = { id: 0, rank: 1, time: 50000, pegs: 5, kos: 1 } as const;
  const xp1 = awardResultXp(first.account, 'story:7:1:1:win', win);
  assert.ok(xp1.xp > 0, 'the race pays XP');
  assert.deepEqual(xp1.levelsGained, [2], '210 XP: level 1 to 2, one talent point earned');
  const xp2 = awardResultXp(xp1.account, 'story:7:1:1:win', win);
  assert.equal(progressOf(xp2.account).xp, progressOf(xp1.account).xp, 'the same race id never pays XP twice');
  assert.deepEqual(xp2.levelsGained, [], 'and a replay hands out no levels');
});

// ─── Job 2 — per-mode loadouts ─────────────────────────────────────────────────

test('job 2: each mode reads its own bar, and a mode nobody saved falls back to the old shared loadout', async () => {
  const store = await import('../src/game/loadout-store');
  const storage = await import('../src/game/storage');
  storage.removeItem(store.MODED_LOADOUT_KEY); // start pre-P2-20: only the shared bar exists
  const shared = ['oil', 'rocket', 'jump', 'shock', 'anvil', 'aero', 'freeze', 'ghost'];
  storage.setItem(store.LOADOUT_KEY, JSON.stringify(shared));

  assert.deepEqual(store.loadSlots('story'), shared, 'an unsaved mode falls back to the v1 shared bar');
  assert.deepEqual(store.loadSlots(), shared, 'the no-mode path is byte-compatible with v1');

  const quickBar = ['bolt', 'rocket', 'jump', 'shock', 'anvil', 'aero', 'freeze', 'ghost'];
  store.saveSlots(quickBar as never, 'quick');
  assert.deepEqual(store.loadSlots('quick'), quickBar, 'the bar saved for quick is the one quick races');
  assert.deepEqual(store.loadSlots('story'), shared, 'story keeps its own (fallback) bar — modes do not bleed');

  const onlineBar = ['spikes', 'rocket', 'jump', 'shock', 'anvil', 'aero', 'freeze', 'ghost'];
  store.saveSlots(onlineBar as never, 'online');
  assert.deepEqual(store.loadSlots('online'), onlineBar, 'four modes, four bars');
  assert.deepEqual(store.loadSlots('quick'), quickBar, 'saving one mode never rewrites another');
  storage.setItem(store.LOADOUT_KEY, JSON.stringify(['bogus', 'not-a-skill']));
  assert.deepEqual(store.loadSlots('championship'), store.defaultSlots(), 'the shared fallback sanitises to the original eight');
});

// ─── Job 3 — the Driver talent tree ────────────────────────────────────────────

test('job 3: a Driver build reaches the racing marble as m.tfx — and rivals race stock', () => {
  const rng = mulberry32(3);
  const roster = () => Array.from({ length: 10 }, (_, i) => ({
    id: i, name: AI_NAMES[i] ?? `AI ${i}`, color: AI_COLORS[i % AI_COLORS.length],
    stats: randomStats(rng), isPlayer: i === 0, character: i % 6,
  }));
  const track = () => buildPlatformerTrack(2, TRACK_THEMES.forest, 'rolling-hills');

  const build = { 'quick-reflexes': 3, 'steady-hands': 3, 'second-wind': 3, 'lucky-draw': 1 };
  const g = new Game(2, roster(), { track: track(), talents: build, slots: [] });
  const fx = g.player.tfx;
  assert.ok(fx, 'the driver tree applied to the player marble');
  assert.equal(fx.laneSwitchPct, -30, 'Quick Reflexes ×3: lane changes finish 30 % sooner');
  assert.equal(fx.landingKeepPct, 30, 'Steady Hands ×3: a hard landing keeps 30 % more roll');
  assert.equal(fx.regenDelayMs, -4500, 'Second Wind ×3: health restarts 4.5 s sooner');
  assert.equal(fx.boxLuckPct, 15, 'Lucky Draw ×1: 15 % of boxes pay out twice');
  assert.equal(g.marbles[1]?.tfx, undefined, 'a rival never wears your build');

  // The checksum's promise, restated: no talents in, nothing to apply — tfx stays absent.
  const plain = new Game(2, roster(), { track: track(), talents: {}, slots: [] });
  assert.equal(plain.player.tfx, undefined, 'a stock race has no talent effects at all');
});

// ─── Job 4 — the host loadout budget ───────────────────────────────────────────

test('job 4: the budget trims kits in table order, settles without losing the home stash, and rides at protocol v9', () => {
  assert.equal(PROTOCOL_VERSION, 9, 'the wire changed — the handshake must notice');
  assert.equal(readRaceSettings({ circuit: 0, loadoutSlots: 4 })?.loadoutSlots, 4);
  assert.equal(readRaceSettings({ circuit: 0, loadoutSlots: 9 }), null, 'nine is more slots than a kit holds');

  const home = { ...emptyInventory(), rocket: 3, oil: 2, bolt: 1, jump: 4 };
  // ITEM_TYPES order is rocket, jump, oil, ..., bolt — the trim keeps the first N charged types.
  const raced = trimKit(home, 2);
  assert.equal(raced.rocket, 3, 'kept — first charged type in table order');
  assert.equal(raced.jump, 4, 'kept — second');
  assert.equal(raced.oil, 0, 'trimmed out of the race');
  assert.equal(raced.bolt, 0, 'and so is this one');
  assert.equal(trimKit(home, 8).oil, 2, 'a full budget never trims');

  // Coming home: raced skills are the end-of-race kit (spent is spent, picked is kept);
  // skills left at home stay untouched, and a pickup of a trimmed type is a bonus.
  const kit = { ...raced, rocket: 1, shock: 2 };
  const back = mergeRaceKit(home, kit, 2);
  assert.equal(back.rocket, 1, 'you raced the rockets and spent two');
  assert.equal(back.jump, 4, 'untouched in the race, still yours');
  assert.equal(back.oil, 2, 'never raced — left at home, intact');
  assert.equal(back.bolt, 1, 'this one too');
  assert.equal(back.shock, 2, 'a shock picked while racing a trimmed kit comes home');
  // A room with no rule behaves exactly as before: the kit replaces the wallet.
  assert.deepEqual(mergeRaceKit(home, kit), kit, 'a room with no budget: the kit simply replaces the wallet');
});
