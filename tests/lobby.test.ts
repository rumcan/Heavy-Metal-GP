// ══════════════════════════════════════════════════════════════════════════
// MP-06 — the lobby's rules: who the host puts on the grid, how a garage gets
// filed, and when Start is allowed to drop the lights.
//
// The room decides WHO sits where; the host decides WHAT the grid looks like.
// Every rule here is one a lobby bug would show as two screens disagreeing — a
// guest watching a grid it is not in, or a Start button that fires into a race
// nobody joined.
// ══════════════════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';

import { AI_COLORS, AI_NAMES, PLAYER_COLORS } from '../src/game/types';
import {
  MIN_HUMANS_TO_START,
  canStart,
  circuitIndexOf,
  dressGrid,
  fileGarage,
  gridOrderOf,
  humansOf,
  rosterOf,
  seatOfPlayer,
  setReady,
  seededCircuit,
  startBlockedReason,
} from '../src/net/lobby';
import { emptyInventory } from '../src/game/types';
import type { Seat } from '../src/net/protocol';
import { MARBLE_COUNT } from '../src/net/protocol';

const SEED = 5150;

/** The room's greeting: two humans in slots 0 and 1, placeholders everywhere else. */
function roomGrid(humans = 2): Seat[] {
  return Array.from({ length: MARBLE_COUNT }, (_, slot) => ({
    slot,
    playerId: slot < humans ? `player-${slot}` : '',
    name: slot < humans ? `PLAYER ${slot}` : AI_NAMES[slot],
    color: PLAYER_COLORS[slot % PLAYER_COLORS.length],
    stats: { weight: 5, speed: 5, bounce: 5 },
    portrait: slot,
    isAI: slot >= humans,
    ready: slot < humans ? false : true,
  }));
}

const garage = (name: string) => ({ name, color: '#22d3ee', stats: { weight: 7, speed: 4, bounce: 4 }, portrait: 3 });

test('MP-06 lobby: the host dresses the grid, and the AI is dressed from the seed', () => {
  const grid = dressGrid(roomGrid(), SEED);
  assert.equal(grid.length, MARBLE_COUNT);
  // Humans are left exactly as the room seated them — until they file a garage.
  assert.equal(grid[0].playerId, 'player-0');
  assert.equal(grid[0].name, 'PLAYER 0');
  // The machines are not nine identical marbles any more.
  const ai = grid.filter((s) => s.isAI);
  assert.equal(ai.length, 8);
  assert.ok(new Set(ai.map((s) => s.stats.weight)).size > 1, 'the AI field has different tunes');
  assert.deepEqual(ai.map((s) => AI_NAMES.includes(s.name)), ai.map(() => true), 'every machine has a name from the game');
  assert.deepEqual(ai.map((s) => AI_COLORS.includes(s.color)), ai.map(() => true));
  assert.deepEqual(ai.map((s) => s.ready), ai.map(() => true), 'the AI is always ready — it has no say');
  // And it is the same field tomorrow, in the same room: a room that restarts
  // hands the same players the same race.
  assert.deepEqual(dressGrid(roomGrid(), SEED), grid, 'the seed dresses the grid, not Math.random');
  assert.notDeepEqual(dressGrid(roomGrid(), SEED + 1).filter((s) => s.isAI), ai, 'another race, another field');
});

test('MP-06 lobby: a guest files its garage, and only its own', () => {
  const grid = dressGrid(roomGrid(), SEED);
  const filed = fileGarage(grid, 'player-1', garage('Sprocket'));
  assert.equal(filed[1].name, 'Sprocket');
  assert.equal(filed[1].color, '#22d3ee');
  assert.deepEqual(filed[1].stats, { weight: 7, speed: 4, bounce: 4 });
  assert.equal(filed[1].portrait, 3);
  assert.equal(filed[0].name, 'PLAYER 0', 'nobody else was touched');
  // A stranger, and a machine: neither has a garage to file.
  assert.deepEqual(fileGarage(grid, 'player-nobody', garage('Ghost')), grid);
  assert.deepEqual(fileGarage(grid, '', garage('Ghost')), grid);
  const aiId = grid.find((s) => s.isAI)!;
  assert.equal(aiId.playerId, '');
  assert.deepEqual(fileGarage(grid, 'player-1', garage('x')).filter((s) => s.isAI), grid.filter((s) => s.isAI));
});

test('MP-06 lobby: ready is per seat, and the machines are always ready', () => {
  const grid = dressGrid(roomGrid(), SEED);
  assert.deepEqual(humansOf(grid).map((s) => s.ready), [false, false]);
  const one = setReady(grid, 'player-0', true);
  assert.deepEqual(humansOf(one).map((s) => s.ready), [true, false]);
  // A guest that never joined cannot ready itself into somebody's grid.
  assert.deepEqual(setReady(grid, 'player-9', true), grid);
  assert.deepEqual(grid.filter((s) => s.isAI).map((s) => s.ready), grid.filter((s) => s.isAI).map(() => true));
});

test('MP-06 lobby: Start needs two humans, and every one of them ready', () => {
  const two = dressGrid(roomGrid(2), SEED);
  assert.equal(canStart(two), false, 'two humans, neither ready');
  assert.match(startBlockedReason(two) ?? '', /rival|PLAYER 0/i);

  const oneHuman = dressGrid(roomGrid(1), SEED);
  assert.equal(canStart(setReady(oneHuman, 'player-0', true)), false, 'one human is the offline game');
  assert.match(startBlockedReason(setReady(oneHuman, 'player-0', true)) ?? '', /rival/i, 'and it says why');

  const both = setReady(setReady(two, 'player-0', true), 'player-1', true);
  assert.equal(canStart(both), true);
  assert.equal(startBlockedReason(both), null);
  // One driver holding up the grid is named, rather than a silent grey button.
  const waiting = setReady(setReady(two, 'player-0', true), 'player-1', false);
  assert.equal(canStart(waiting), false);
  assert.match(startBlockedReason(waiting) ?? '', /PLAYER 1/);
  assert.equal(MIN_HUMANS_TO_START, 2);
});

test('MP-06 lobby: the roster is the grid, numbered by slot', () => {
  const grid = fileGarage(dressGrid(roomGrid(), SEED), 'player-1', garage('Sprocket'));
  const roster = rosterOf(grid, 1);
  assert.equal(roster.length, MARBLE_COUNT);
  assert.deepEqual(roster.map((m) => m.id), [...Array(MARBLE_COUNT).keys()], 'one id per seat, in slot order');
  assert.equal(roster[1].isPlayer, true, 'the local seat is the one this screen drives');
  assert.equal(roster[0].isPlayer, false);
  assert.equal(roster.filter((m) => m.isPlayer).length, 1, 'exactly one marble is mine');
  assert.equal(roster[1].name, 'Sprocket');
  // The same numbering the packed frames use: no translation table to get wrong.
  assert.deepEqual(gridOrderOf(grid), [...Array(MARBLE_COUNT).keys()]);
  assert.equal(seatOfPlayer(grid, 'player-1'), 1);
  assert.equal(seatOfPlayer(grid, 'player-7'), null, 'not on the grid');
  assert.equal(seatOfPlayer(grid, undefined), null);
});

test('MP-09 lobby: a driver’s kit is filed with its garage, and rides on its marble', () => {
  // An online race spends what each driver BOUGHT. The kit travels the same way
  // the livery and the tune do — inside `ready` — and what the host puts on the
  // grid is what that seat came with, not a copy of the host's.
  const seats = dressGrid(roomGrid(), SEED);
  const mine = { name: 'Sprocket', color: '#22d3ee', stats: { weight: 6, speed: 5, bounce: 4 }, portrait: 2, inventory: { ...emptyInventory(), rocket: 2 } };
  const filed = fileGarage(seats, 'player-1', mine);
  assert.deepEqual(filed.find((s) => s.playerId === 'player-1')?.inventory?.rocket, 2, 'filed against its own seat');
  assert.equal(filed.find((s) => s.playerId === 'player-2')?.inventory, undefined, 'and nobody else gets one');
  // A guest that says nothing about a kit keeps whatever the host already had.
  const kept = fileGarage(filed, 'player-1', { name: 'Sprocket', color: '#22d3ee', stats: mine.stats, portrait: 2 });
  assert.deepEqual(kept.find((s) => s.playerId === 'player-1')?.inventory?.rocket, 2);
  // The AI carries nothing it did not pick up: a kit is a person's.
  for (const seat of filed) if (seat.isAI) assert.equal(seat.inventory, undefined);

  // And it reaches the marble the simulation spends from.
  const roster = rosterOf(filed, 1);
  assert.equal(roster.find((m) => m.id === 1)?.inventory?.rocket, 2);
});

test('MP-07 lobby: a quick race runs the circuit the seed picked, not Math.random', () => {
  // The host republishing a lobby (a rejoin, a refresh) must not hand the field
  // a different track — and the calendar is not the wire's business, so it is
  // the seed that decides.
  const count = 6; // the calendar's length, as the caller knows it
  assert.equal(seededCircuit(9182, count), seededCircuit(9182, count), 'the same room, the same circuit');
  const picks = new Set(Array.from({ length: 60 }, (_, i) => seededCircuit(i * 7919, count)));
  assert.ok(picks.size > 1, 'and different rooms get different tracks');
  for (const pick of picks) assert.ok(pick >= 0 && pick < count, `${pick} is not on the calendar`);
  // Degenerate inputs are a circuit, not a crash.
  assert.equal(seededCircuit(1, 0), 0);
  assert.equal(seededCircuit(1, 1), 0);
});

test('MP-06 lobby: a circuit is a calendar index until the lobby says otherwise', () => {
  assert.equal(circuitIndexOf({ circuit: 3 }), 3);
  assert.equal(circuitIndexOf({ circuit: 0, laps: 2 }), 0);
  assert.equal(circuitIndexOf(undefined), 0, 'no settings yet reads as the opener');
  // A whole circuit definition is a future custom track: today it is not a
  // calendar entry, so the lobby falls back rather than indexing off it.
  assert.equal(circuitIndexOf({ circuit: { segments: 10, weights: {}, theme: { bg1: '#000', bg2: '#111', track: '#222', pipe: '#333', pipeEdge: '#444' } } }), 0);
});
