// ══════════════════════════════════════════════════════════════════════════
// RK-05 (#59) — the rank surfaces' maths, with no React and no SDK in sight.
//
// Four places print a rating: the garage header, a lobby seat, the ladder list
// and the results screen. The first three want the same thing (a badge, a tier,
// a number), which is `RankChipModel`; the fourth wants the same thing PLUS
// what the race did to it, which is `RankedRaceView`.
//
// Ported from HexMatch's chip builders (`chipFor` / `chipForWire`, RANK-01
// #147) and its ending screen's rating row (`EndingRankLine`, `src/iso/ending.ts`).
// The shapes are theirs; what a RACE adds is the field: a duel has one rival,
// so `verdict.rivals` is a list here and the results screen prints a row per
// rated human.
//
// It lives in `src/game/` rather than beside the components for one practical
// reason: this half must be importable by a plain node test (`tsx`), and the
// component files import PNGs and `lucide-react`, which only vite can load.
// ══════════════════════════════════════════════════════════════════════════
import {
  MIN_RATED_FIELD,
  PROVISIONAL_MATCHES,
  rankKeyOf,
  rankLabelOf,
  rankOf,
  type RaceVerdict,
  type RankState,
} from '../net/rating';

/**
 * A chip's contents. Deliberately not a `RankState`: a lobby seat's number
 * arrives off the room's board with two fields and no history, and inventing
 * wins/losses for a rival would be inventing facts.
 */
export interface RankChipModel {
  /** Badge key (`src/assets/ui/rank/<key>.png`). */
  key: string;
  label: string;
  /** The rating, or null when this seat has not published one yet. */
  rating: number | null;
  /** Rated races this player has filed — drives the "placement" note. */
  games: number;
}

/** A chip from a driver's own file. */
export function chipOf(state: Pick<RankState, 'rating' | 'matches'>): RankChipModel {
  return {
    key: rankKeyOf(state),
    label: rankLabelOf(state),
    rating: state.rating,
    games: state.matches,
  };
}

/**
 * A chip for a seat whose number came off the room's board.
 *
 * `null` is a real state — the board has not heard from that seat — and it
 * prints as `Unrated / no rating yet` rather than as a number, because a 1000
 * would be a guess the player would believe.
 */
export function chipOfWire(entry: { rating: number; games: number } | null | undefined): RankChipModel {
  if (!entry) return { key: 'unranked', label: 'Unrated', rating: null, games: 0 };
  return chipOf({ rating: entry.rating, matches: entry.games });
}

/**
 * A chip for one row of the public ladder: the board carries a PEAK rating and
 * no history, so `games` is 1 — enough to say "a rated player", not enough to
 * claim anything about their placement races.
 */
export function chipOfBoard(rating: number): RankChipModel {
  const tier = rankOf(rating);
  return { key: tier.key, label: tier.label, rating, games: 1 };
}

/** Where a seat's chip comes from, as the lobby passes it down to the grid. */
export type RankChipLookup = (playerId: string) => RankChipModel | null;

/** True while a driver is still inside their placement races. */
export const isProvisional = (games: number): boolean => games < PROVISIONAL_MATCHES;

// ── the results screen ────────────────────────────────────────────────────

/** One rated human's line on the results screen, this driver included. */
export interface RankedResultRow {
  playerId: string;
  /** What the row prints: `You` for this driver, the seat's name for a rival. */
  name: string;
  /** The signed movement (+18 / −7). */
  delta: number;
  /** The number after the race. */
  rating: number;
  /** Badge key after the race. */
  key: string;
  /** Place among the rated humans — the results table's own order. */
  position: number;
  /** Classified at the flag (a leaver never is). */
  finished: boolean;
  /** Still inside the placement races, after this one. */
  provisional: boolean;
  /** False when this row's number was a guess (the room never heard them). */
  known: boolean;
}

/**
 * What the results screen is allowed to say about the rating.
 *
 *   `unrated`  the race did not count, and WHY: `room` — a friendly lobby the
 *              room refused to rate; `alone` — a rated lobby with no other
 *              rated human in it. Neither prints a zero: a zero is a number a
 *              player would believe.
 *   `pending`  the race counts, and the room has not filed it yet. Prints as
 *              work in progress (HexMatch's rule) rather than as a standstill,
 *              because the verdict normally lands a round trip after the flag.
 *   `settled`  the room's verdict, per rated human.
 */
export type RankedRaceState = 'unrated' | 'pending' | 'settled';

export interface RankedRaceView {
  state: RankedRaceState;
  /** Why a race did not count — null when it did, or when it is still filing. */
  reason: 'room' | 'alone' | null;
  /** Every rated human in finishing order, this driver included. */
  rows: RankedResultRow[];
  /** This driver's own row, or null while the room has not filed. */
  self: RankedResultRow | null;
  /** Row lookup for the results table, keyed by player id. */
  byId: Readonly<Record<string, RankedResultRow>>;
  /**
   * The same rows under the results table's own numbering: a seat SLOT.
   * The classification is drawn per marble (`result.id`), and a rating is filed
   * per player, so this is the one place the two numberings are joined.
   */
  bySeat: Readonly<Record<number, RankedResultRow>>;
  promoted: boolean;
  demoted: boolean;
  /** The room saw this driver abandon the race rather than finish it. */
  forfeit: boolean;
  /** False when the rating file refused the write — the number will not survive a reload. */
  stored: boolean;
  /** This driver's card as it stands, for the states with no verdict to print. */
  current: RankChipModel | null;
}

/**
 * Build the results screen's rating view from the three things that carry it:
 * the room's verdict, whether the room rates races at all, and the seat names.
 *
 * Nothing here decides anything about the rating — `rateRaceOutcome` did that,
 * once, on every seat, from the room's own board and classification. This is
 * printing: which of the three states the screen is in, and what each rated
 * human's row says.
 */
export function rankedViewFor(input: {
  verdict: RaceVerdict | null;
  /** True when the room rates races at all (matchmade, no house rules). */
  rated: boolean;
  /** `FiledOutcome.stored` — false when the write was refused. */
  stored?: boolean;
  /** Seat names by player id, so a rival prints as `Sprocket` and not as an id. */
  names?: Readonly<Record<string, string>>;
  /** The grid, so a filing can be read back as the seats the results table draws. */
  seats?: readonly { slot: number; playerId: string }[];
  /** This driver's card, printed while there is no verdict yet. */
  current?: RankChipModel | null;
}): RankedRaceView {
  const { verdict, rated, names = {}, seats = [], current = null } = input;
  const stored = input.stored !== false;
  const pending: RankedRaceView = {
    state: !rated ? 'unrated' : 'pending',
    reason: rated ? null : 'room',
    rows: [],
    self: null,
    byId: {},
    bySeat: {},
    promoted: false,
    demoted: false,
    forfeit: false,
    stored,
    current,
  };
  if (!verdict) return pending;

  if (!rated) return pending;
  if (!verdict.rated) {
    // The arithmetic had nothing to rate — a field of one, or a room that did
    // not rate it. Either way NOTHING moved, so this is the unrated state and
    // not the pending one: a pending row would promise a delta that is never
    // coming. `field` is every rated seat the room saw, this driver included.
    return {
      ...pending,
      state: 'unrated',
      reason: verdict.field < MIN_RATED_FIELD ? 'alone' : 'room',
    };
  }

  const self: RankedResultRow = {
    playerId: verdict.playerId,
    name: 'You',
    delta: verdict.change.delta,
    rating: verdict.state.rating,
    key: rankKeyOf(verdict.state),
    position: verdict.change.position,
    finished: verdict.finished,
    provisional: isProvisional(verdict.state.matches),
    known: true,
  };
  const rows: RankedResultRow[] = [
    self,
    ...verdict.rivals.map((rival): RankedResultRow => ({
      playerId: rival.playerId,
      name: names[rival.playerId] ?? 'A rival',
      delta: rival.delta,
      rating: rival.after,
      key: rankOf(rival.after).key,
      position: rival.position,
      finished: rival.finished,
      provisional: false,
      known: rival.known,
    })),
  ].sort((a, b) => a.position - b.position);
  const byId: Record<string, RankedResultRow> = {};
  const bySeat: Record<number, RankedResultRow> = {};
  for (const row of rows) byId[row.playerId] = row;
  for (const seat of seats) {
    const row = byId[seat.playerId];
    if (row) bySeat[seat.slot] = row;
  }

  return {
    state: 'settled',
    reason: null,
    rows,
    self,
    byId,
    bySeat,
    promoted: verdict.promoted,
    demoted: verdict.demoted,
    forfeit: verdict.forfeit,
    stored,
    current,
  };
}

export { fmtRating, fmtRatingDelta, rankLabelOf } from '../net/rating';
