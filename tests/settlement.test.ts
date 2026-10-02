// P2-07 (#113) battle tests, job BRAVO: the pure race purse in src/game/settlement.ts.
// Standalone: imports only the module under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PRIZES, PEG_CREDITS, KO_BOUNTY, MODE_SCALE, settle, shamanFee } from '../src/game/settlement';
import type { RaceOutcome } from '../src/game/settlement';

const NONE = { prizePct: 0, pegBonusPct: 0, koBountyPct: 0, shamanFeePct: 0 };
const win: RaceOutcome = { finished: true, rank: 1, pegs: 0, kos: 0, dnf: false };

test('constants', () => {
  assert.deepEqual([...PRIZES], [500, 350, 275, 220, 180, 150, 120, 100, 80, 60]);
  assert.equal(PEG_CREDITS, 5);
  assert.equal(KO_BOUNTY, 75);
  assert.deepEqual(MODE_SCALE, { championship: 1, story: 1, quick: 1, custom: 0.3, online: 0.6, 'online-custom': 0.18 });
});

test('shamanFee: championship and story 30 % (min 250), quick 10 % (min 50), online and custom free; short = cannot pay', () => {
  assert.deepEqual(shamanFee('championship', 2000), { due: 600, fee: 600, short: false, takeCharges: 0 });
  assert.deepEqual(shamanFee('story', 500), { due: 250, fee: 250, short: false, takeCharges: 0 });
  assert.deepEqual(shamanFee('championship', 100), { due: 250, fee: 100, short: true, takeCharges: 2 });
  assert.deepEqual(shamanFee('quick', 1000), { due: 100, fee: 100, short: false, takeCharges: 0 });
  assert.deepEqual(shamanFee('quick', 20), { due: 50, fee: 20, short: true, takeCharges: 0 });
  assert.deepEqual(shamanFee('online', 5000), { due: 0, fee: 0, short: false, takeCharges: 0 });
  assert.deepEqual(shamanFee('custom', 5000), { due: 0, fee: 0, short: false, takeCharges: 0 });
  assert.deepEqual(shamanFee('story', 1000, -20), { due: 240, fee: 240, short: false, takeCharges: 0 }, 'a talent can cut the fee: 30 % then -20 %, the minimum too');
});

test('settle: a clean win pays the placement prize; lines are in display order', () => {
  const r = settle(win, 'championship', 1000, NONE);
  assert.deepEqual(r.lines, [{ kind: 'placement', amount: 500 }]);
  assert.equal(r.total, 500);
  assert.equal(r.takeCharges, 0);
});

test('settle: placement, pegs and KO bounties add up; talents raise each part; the mode scale applies to everything earned', () => {
  const r = settle({ finished: true, rank: 3, pegs: 10, kos: 2, dnf: false }, 'championship', 0, NONE);
  assert.deepEqual(r.lines, [{ kind: 'placement', amount: 275 }, { kind: 'pegs', amount: 50 }, { kind: 'kos', amount: 150 }]);
  assert.equal(r.total, 475);
  const t = settle({ finished: true, rank: 3, pegs: 10, kos: 2, dnf: false }, 'championship', 0, { prizePct: 10, pegBonusPct: 20, koBountyPct: 50, shamanFeePct: 0 });
  assert.deepEqual(t.lines, [{ kind: 'placement', amount: 303 }, { kind: 'pegs', amount: 60 }, { kind: 'kos', amount: 225 }]);
  const online = settle({ finished: true, rank: 3, pegs: 10, kos: 2, dnf: false }, 'online', 0, NONE);
  assert.deepEqual(online.lines, [{ kind: 'placement', amount: 165 }, { kind: 'pegs', amount: 30 }, { kind: 'kos', amount: 90 }]);
});

test('settle: rank is clamped to 1..10; zero lines are left out', () => {
  assert.deepEqual(settle({ finished: true, rank: 14, pegs: 0, kos: 0, dnf: false }, 'quick', 0, NONE).lines, [{ kind: 'placement', amount: 60 }]);
  assert.deepEqual(settle({ finished: false, rank: 5, pegs: 0, kos: 0, dnf: false }, 'quick', 0, NONE).lines, [], 'did not finish (no DNF): nothing');
});

test('settle: a DNF pays no placement but keeps pegs and KOs, and the Shaman takes his fee from the wallet plus the winnings', () => {
  const r = settle({ finished: false, rank: 7, pegs: 4, kos: 1, dnf: true }, 'championship', 1000, NONE);
  // earned 20 + 75 = 95; fee 30 % of (1000 + 95) = 329 (min 250)
  assert.deepEqual(r.lines, [{ kind: 'pegs', amount: 20 }, { kind: 'kos', amount: 75 }, { kind: 'shaman', amount: -329 }]);
  assert.equal(r.total, 95 - 329);
  assert.equal(r.takeCharges, 0);
});

test('settle: a DNF the team cannot pay for costs what there is, and the Shaman takes 2 skill charges', () => {
  const r = settle({ finished: false, rank: 9, pegs: 0, kos: 0, dnf: true }, 'story', 120, NONE);
  assert.deepEqual(r.lines, [{ kind: 'shaman', amount: -120 }]);
  assert.equal(r.total, -120);
  assert.equal(r.takeCharges, 2);
});

test('settle: online and custom DNFs are free', () => {
  assert.deepEqual(settle({ finished: false, rank: 9, pegs: 0, kos: 0, dnf: true }, 'online', 5000, NONE).lines, []);
});
