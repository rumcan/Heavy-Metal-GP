// ══════════════════════════════════════════════════════════════════════════
// MP-06 — the LOBBY'S rules, with no React and no SDK in sight.
//
// The lobby is a seat table, a circuit and a set of ready flags, and every one
// of those has a rule worth testing:
//
//   - the HOST owns the grid. The room mints the seat table (who sits where),
//     but it seats people with placeholder marbles; the host decides what the
//     grid actually looks like and says so in `lobby`, which is the frame every
//     seat reads. A guest's own garage reaches the host in `ready` and is filed
//     here.
//   - the AI is part of the grid, and it is dressed FROM THE SEED, so the host
//     and every guest that receives its `lobby` agree on who is racing — and a
//     room that restarts hands the same players the same field.
//   - `Start` needs two humans and everybody ready. One human and nine machines
//     is the offline game, and the lobby should not be able to launch a race
//     nobody asked to join.
//
// Pure on purpose: no SDK, no DOM, no React, no `season.ts` (it boots the SDK
// through `storage.ts`). The component owns the calendar and resolves the
// circuit; this file only ever moves seats around.
// ══════════════════════════════════════════════════════════════════════════
import { AI_COLORS, AI_NAMES, mulberry32, randomStats } from '../game/types';
import type { MarbleInfo } from '../game/types';
import type { RaceSettings, Seat, SeatGarage } from './protocol';
import { MARBLE_COUNT } from './protocol';

export type { SeatGarage };

/** An alias worth having: the wire calls it a garage, the garage calls it you. */
export type Garage = SeatGarage;

/**
 * Humans needed before the host may drop the lights.
 *
 * Two, not one: a one-human grid is the offline game with extra steps, and a
 * lobby exists to put drivers in the same race. Six is the roof (the room's
 * `MAX_HUMAN_SEATS`) and AI fills whatever is left.
 */
export const MIN_HUMANS_TO_START = 2;

/** The humans on the grid, in slot order. */
export function humansOf(seats: readonly Seat[]): Seat[] {
  return seats.filter((s) => !s.isAI).sort((a, b) => a.slot - b.slot);
}

/** The seat a RUN player is sitting in, or null when they are not on the grid. */
export function seatOfPlayer(seats: readonly Seat[], playerId: string | undefined): number | null {
  if (!playerId) return null;
  return seats.find((s) => s.playerId === playerId)?.slot ?? null;
}

/** Seats in slot order, whatever order the wire handed them over in. */
export function inSlotOrder(seats: readonly Seat[]): Seat[] {
  return [...seats].sort((a, b) => a.slot - b.slot);
}

/**
 * The host's grid: the room's seat table, dressed.
 *
 * Humans keep whatever garage the host has filed for them (their own, or the
 * one they sent in `ready`). The AI is dressed from the seed — a name, a
 * livery, a tune and a face — because nine identical 5/5/5 placeholders is not
 * a field, and `randomStats` off the room's seed means the same room hands the
 * same field to everybody who walks in.
 */
export function dressGrid(seats: readonly Seat[], seed: number): Seat[] {
  return inSlotOrder(seats).map((seat) => {
    if (!seat.isAI) return { ...seat };
    const rng = mulberry32((seed ^ Math.imul(seat.slot + 1, 0x9e3779b1)) >>> 0);
    const i = seat.slot % AI_NAMES.length;
    return { ...seat, name: AI_NAMES[i], color: AI_COLORS[i], stats: randomStats(rng), portrait: i, ready: true };
  });
}

/** A garage arrives: file it against the seat that sent it. */
export function fileGarage(seats: readonly Seat[], playerId: string, garage: SeatGarage): Seat[] {
  return inSlotOrder(seats).map((seat) =>
    seat.playerId === playerId && !seat.isAI
      ? {
          ...seat,
          name: garage.name,
          color: garage.color,
          stats: { ...garage.stats },
          portrait: garage.portrait,
          // The kit travels with the garage (MP-09): what a driver bought is
          // what that marble carries, and nothing here invents an item.
          inventory: garage.inventory ? { ...garage.inventory } : seat.inventory,
        }
      : seat,
  );
}

/** One seat's ready flag. AI seats are always ready — they have no say. */
export function setReady(seats: readonly Seat[], playerId: string, ready: boolean): Seat[] {
  return inSlotOrder(seats).map((seat) => (seat.playerId === playerId && !seat.isAI ? { ...seat, ready } : seat));
}

/**
 * True when the host may drop the lights: enough humans, and every one of them
 * ready. A lone driver with nine machines is the offline game — the lobby makes
 * you wait for somebody.
 */
export function canStart(seats: readonly Seat[]): boolean {
  const humans = humansOf(seats);
  return humans.length >= MIN_HUMANS_TO_START && humans.every((s) => s.ready === true);
}

/** Why the Start button is disabled, in the words the button shows. Null when it is not. */
export function startBlockedReason(seats: readonly Seat[]): string | null {
  const humans = humansOf(seats);
  if (humans.length < MIN_HUMANS_TO_START) return `Waiting for a rival — ${MIN_HUMANS_TO_START} drivers minimum`;
  const waiting = humans.filter((s) => s.ready !== true);
  if (waiting.length) return `Waiting for ${waiting.map((s) => s.name).join(', ')}`;
  return null;
}

/**
 * The roster the simulation and the HUD read: one `MarbleInfo` per seat, with
 * the marble's id being the seat's slot — the same numbering as the packed
 * state frames, so there is no translation table to get wrong.
 */
export function rosterOf(seats: readonly Seat[], localSeat: number): MarbleInfo[] {
  return inSlotOrder(seats).map((seat) => ({
    id: seat.slot,
    name: seat.name,
    color: seat.color,
    stats: seat.stats,
    isPlayer: seat.slot === localSeat,
    isHuman: !seat.isAI,
    character: seat.portrait,
    inventory: seat.inventory,
  }));
}

/** The grid in starting order: seat order, the order the marbles were built in. */
export function gridOrderOf(seats: readonly Seat[]): number[] {
  return inSlotOrder(seats).map((s) => s.slot);
}

/** AI seats taken off the grid for this race. A human sitting in a benched slot always races. */
export function benchedSlots(seats: readonly Seat[], settings: RaceSettings | undefined): number[] {
  const wanted = new Set(settings?.benched ?? []);
  return inSlotOrder(seats).filter((seat) => seat.isAI && wanted.has(seat.slot)).map((seat) => seat.slot);
}

/** The circuit the lobby is showing, as a calendar index. A whole `TrackDef` reads as the first. */
export function circuitIndexOf(settings: RaceSettings | undefined): number {
  if (!settings) return 0;
  if (isCustomSettings(settings)) return typeof settings.circuit === 'number' ? settings.circuit : 0;
  return typeof settings.circuit === 'number' ? settings.circuit : 0;
}

/** True when the settings carry a custom track (MB-08). */
export function isCustomSettings(settings: RaceSettings | undefined): boolean {
  return typeof settings?.customCode === 'string' && settings.customCode.length > 0;
}

/**
 * The circuit a QUICK RACE runs: picked by the host, from the room's seed.
 *
 * Not `Math.random()`, for the same reason nothing else in this game uses it:
 * the host republishing the lobby (a rejoin, a refresh) must not hand the field
 * a different track, and the seed is the one thing both ends already agree on.
 * The host still says which circuit in `lobby` — this only decides it.
 */
export function seededCircuit(seed: number, count: number): number {
  if (count <= 0) return 0;
  return Math.floor(mulberry32(seed >>> 0)() * count) % count;
}

/** A whole grid of seats, for a test or a lobby that has not heard from a room yet. */
export function emptyGrid(): Seat[] {
  return Array.from({ length: MARBLE_COUNT }, (_, slot) => ({
    slot,
    playerId: '',
    name: AI_NAMES[slot % AI_NAMES.length],
    color: AI_COLORS[slot % AI_COLORS.length],
    stats: { weight: 5, speed: 5, bounce: 5 },
    portrait: slot % AI_NAMES.length,
    isAI: true,
    ready: true,
  }));
}
