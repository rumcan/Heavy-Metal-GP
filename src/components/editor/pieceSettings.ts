/**
 * #71. The numeric limits behind a piece's settings, in one place.
 *
 * The settings popup already clamps everything it writes to the range the `TrackDef` schema accepts.
 * The prompts a placement opens did not: answering "1" to a trapdoor's open delay wrote `open: 1`
 * straight into the map, and the map then failed the very validator that gates sharing — the player
 * built something they could not publish, with no way to tell which piece was at fault. So the
 * prompts clamp through here, against the same limits the popup and the schema use.
 */
import type { Piece } from '../../game/trackdef';

/** An allowed range, matching `validateTrackDef`'s `number(value, at, min, max)` for that field. */
export interface SettingRange {
  min: number;
  max: number;
  /** Whole units only (milliseconds, peg radii) — the popup rounds these before clamping. */
  integer?: boolean;
}

/**
 * Limits for the fields a placement prompt asks about, copied from the schema in
 * `src/game/trackdef.ts` (trapdoor, crusher, boulder). Keep them in step with it.
 */
export const SETTING_RANGES = {
  trapdoor: {
    open: { min: 200, max: 20000, integer: true },
    closed: { min: 200, max: 20000, integer: true },
    kg: { min: 0.1, max: 50 },
    hold: { min: 0, max: 5000, integer: true },
  },
  crusher: {
    period: { min: 1400, max: 30000, integer: true },
    floor: { min: 100, max: 5000, integer: true },
  },
  boulder: {
    r: { min: 12, max: 60, integer: true },
    interval: { min: 1800, max: 30000, integer: true },
    rest: { min: 0, max: 10000, integer: true },
  },
} satisfies Record<string, Record<string, SettingRange>>;

/**
 * How much of its interval a boulder may spend resting before the validator calls it "barely
 * rolls". Shared with `validate.ts` so a prompt can never write a rest the validator rejects.
 */
export const BOULDER_REST_RATIO = 0.7;

/** Clamp into a range, rounding first when the field is whole units. */
export function clampToRange(value: number, range: SettingRange): number {
  const v = range.integer ? Math.round(value) : value;
  return Math.max(range.min, Math.min(range.max, v));
}

/**
 * Read a prompt answer: the number the player typed, inside the allowed range. Anything that is not
 * a number — a cancelled prompt, an empty box, "abc" — leaves `fallback` in place, which is the
 * piece's own default and is already in range.
 */
export function readPromptedNumber(answer: string | null, range: SettingRange, fallback: number): number {
  if (answer === null) return fallback;
  const text = answer.trim();
  // An emptied box means "leave it alone", not zero — Number('') is 0 and would clamp to the minimum.
  if (!text) return fallback;
  const value = Number(text);
  if (!Number.isFinite(value)) return fallback;
  return clampToRange(value, range);
}

/**
 * The most a boulder may rest and still roll within its interval — the prompt's ceiling, from the
 * validator's rule. Falls back to the schema minimum when the interval is too short to leave room.
 */
export function maxBoulderRest(interval: number): number {
  const cap = Math.floor(interval * BOULDER_REST_RATIO);
  return Math.max(0, cap);
}

/** The trapdoor/crusher/boulder settings a placement asks for, applied to the piece it just built. */
export function applyPlacementSettings(
  piece: Piece,
  ask: (question: string, value: string) => string | null,
): Piece {
  if (piece.t === 'trapdoor') {
    if (piece.mode === 'timer') {
      return {
        ...piece,
        open: readPromptedNumber(
          ask(`How many milliseconds until it opens? (${SETTING_RANGES.trapdoor.open.min}–${SETTING_RANGES.trapdoor.open.max})`, String(piece.open)),
          SETTING_RANGES.trapdoor.open,
          piece.open,
        ),
      };
    }
    return {
      ...piece,
      kg: readPromptedNumber(
        ask(`How many kg of weight to trigger it? (${SETTING_RANGES.trapdoor.kg.min}–${SETTING_RANGES.trapdoor.kg.max})`, String(piece.kg)),
        SETTING_RANGES.trapdoor.kg,
        piece.kg,
      ),
    };
  }
  if (piece.t === 'crusher') {
    return {
      ...piece,
      period: readPromptedNumber(
        ask(`How many milliseconds for a full cycle (period)? (${SETTING_RANGES.crusher.period.min}–${SETTING_RANGES.crusher.period.max})`, String(piece.period)),
        SETTING_RANGES.crusher.period,
        piece.period,
      ),
      floor: readPromptedNumber(
        ask(`How many milliseconds should it stay down (floor hold)? (${SETTING_RANGES.crusher.floor.min}–${SETTING_RANGES.crusher.floor.max})`, String(piece.floor)),
        SETTING_RANGES.crusher.floor,
        piece.floor,
      ),
    };
  }
  if (piece.t === 'boulder') {
    const r = readPromptedNumber(
      ask(`What is the boulder radius (size)? (${SETTING_RANGES.boulder.r.min}–${SETTING_RANGES.boulder.r.max})`, String(piece.r)),
      SETTING_RANGES.boulder.r,
      piece.r,
    );
    const interval = readPromptedNumber(
      ask(`How many milliseconds between boulder spawns? (${SETTING_RANGES.boulder.interval.min}–${SETTING_RANGES.boulder.interval.max})`, String(piece.interval)),
      SETTING_RANGES.boulder.interval,
      piece.interval,
    );
    const rest = readPromptedNumber(
      ask(`How many milliseconds should the boulder wait before rolling (rest)? (0–${SETTING_RANGES.boulder.rest.max})`, String(piece.rest)),
      SETTING_RANGES.boulder.rest,
      piece.rest,
    );
    // A rest that eats the interval leaves the boulder sitting at the top: cap it the way the
    // validator does, so the prompt cannot build a piece validation then refuses.
    return { ...piece, r, interval, rest: Math.min(rest, maxBoulderRest(interval)) };
  }
  return piece;
}
