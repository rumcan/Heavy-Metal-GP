// ══════════════════════════════════════════════════════════════════════════
// MP-06 / MP-02 / Controls — unit tests for small pure functions.
// ══════════════════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';

import { benchedSlots, setReady, fileGarage } from '../src/net/lobby';
import { readRaceSettings } from '../src/net/protocol';
import { nudgeOf } from '../src/game/controls';
import { MARBLE_COUNT } from '../src/net/protocol';
import type { Seat, RaceSettings } from '../src/net/protocol';

// ── helpers ────────────────────────────────────────────────────────────────

function makeSeat(slot: number, isAI: boolean, playerId = ''): Seat {
  return {
    slot,
    playerId,
    name: isAI ? `AI ${slot}` : `PLAYER ${slot}`,
    color: '#000000',
    stats: { weight: 5, speed: 5, bounce: 5 },
    portrait: 0,
    isAI,
    ready: false,
  };
}

function makeGrid(humanCount = 2): Seat[] {
  return Array.from({ length: MARBLE_COUNT }, (_, i) => makeSeat(i, i >= humanCount, i < humanCount ? `player-${i}` : ''));
}

// ── benchedSlots ───────────────────────────────────────────────────────────

test('benchedSlots: undefined settings or no benched returns []', () => {
  const grid = makeGrid();
  assert.deepStrictEqual(benchedSlots(grid, undefined), []);
  assert.deepStrictEqual(benchedSlots(grid, {} as RaceSettings), []);
});

test('benchedSlots: returns only AI slots listed in settings.benched, in slot order', () => {
  const grid = makeGrid();
  const settings: RaceSettings = { circuit: 0, benched: [4, 5] };
  assert.deepStrictEqual(benchedSlots(grid, settings), [4, 5]);
});

test('benchedSlots: never returns a human slot, even when listed', () => {
  const grid = makeGrid(3); // slots 0,1,2 are human
  const settings: RaceSettings = { circuit: 0, benched: [1] };
  assert.deepStrictEqual(benchedSlots(grid, settings), []);
});

test('benchedSlots: ignores duplicates', () => {
  const grid = makeGrid();
  const settings: RaceSettings = { circuit: 0, benched: [4, 4, 5] };
  assert.deepStrictEqual(benchedSlots(grid, settings), [4, 5]);
});

// ── readRaceSettings ───────────────────────────────────────────────────────

test('readRaceSettings: minimal { circuit: 0 } is accepted', () => {
  const result = readRaceSettings({ circuit: 0 });
  assert.ok(result !== null);
  assert.strictEqual(result!.circuit, 0);
});

test('readRaceSettings: aiItems: false is kept; aiItems: "no" returns null', () => {
  const withFalse = readRaceSettings({ circuit: 0, aiItems: false });
  assert.ok(withFalse !== null);
  assert.strictEqual(withFalse!.aiItems, false);

  const withString = readRaceSettings({ circuit: 0, aiItems: 'no' as unknown });
  assert.strictEqual(withString, null);
});

test('readRaceSettings: benched: [4,5] is kept; benched: [99] and benched: "all" return null', () => {
  const withValid = readRaceSettings({ circuit: 0, benched: [4, 5] });
  assert.ok(withValid !== null);
  assert.deepStrictEqual(withValid!.benched, [4, 5]);

  assert.strictEqual(readRaceSettings({ circuit: 0, benched: [99] }), null);
  assert.strictEqual(readRaceSettings({ circuit: 0, benched: 'all' as unknown }), null);
});

test('readRaceSettings: items: { rocket: -1 } is kept; items: { rocket: 10 } and items: { notAnItem: 1 } return null', () => {
  const withUnlimited = readRaceSettings({ circuit: 0, items: { rocket: -1 } });
  assert.ok(withUnlimited !== null);
  assert.strictEqual(withUnlimited!.items?.rocket, -1);

  assert.strictEqual(readRaceSettings({ circuit: 0, items: { rocket: 10 } }), null);
  assert.strictEqual(readRaceSettings({ circuit: 0, items: { notAnItem: 1 } }), null);
});

// ── nudgeOf ────────────────────────────────────────────────────────────────

test('nudgeOf: left only gives -1; right only gives 1; both give 0; neither gives 0', () => {
  assert.strictEqual(nudgeOf({ left: true, right: false, touch: 0 }), -1);
  assert.strictEqual(nudgeOf({ left: false, right: true, touch: 0 }), 1);
  assert.strictEqual(nudgeOf({ left: true, right: true, touch: 0 }), 0);
  assert.strictEqual(nudgeOf({ left: false, right: false, touch: 0 }), 0);
});

test('nudgeOf: a non-zero touch value wins over the keys', () => {
  assert.strictEqual(nudgeOf({ left: true, right: false, touch: 0.5 }), 0.5);
  assert.strictEqual(nudgeOf({ left: false, right: true, touch: -0.5 }), -0.5);
});

// ── setReady and fileGarage ────────────────────────────────────────────────

test('setReady: changes only the named human seat and never an AI seat', () => {
  const grid = makeGrid(2);
  const updated = setReady(grid, 'player-0', true);
  assert.strictEqual(updated[0].ready, true);
  assert.strictEqual(updated[1].ready, false);
  assert.strictEqual(updated[2].ready, false); // AI
  assert.strictEqual(updated[9].ready, false); // AI
});

test('fileGarage: copies name, color, stats and portrait onto the named human seat only', () => {
  const grid = makeGrid(2);
  const garage = {
    name: 'Sprocket',
    color: '#22d3ee',
    stats: { weight: 7, speed: 4, bounce: 4 },
    portrait: 3,
  };
  const updated = fileGarage(grid, 'player-1', garage);
  assert.strictEqual(updated[1].name, 'Sprocket');
  assert.strictEqual(updated[1].color, '#22d3ee');
  assert.deepStrictEqual(updated[1].stats, { weight: 7, speed: 4, bounce: 4 });
  assert.strictEqual(updated[1].portrait, 3);
  // Others untouched
  assert.strictEqual(updated[0].name, 'PLAYER 0');
  assert.strictEqual(updated[2].name, 'AI 2');
});
