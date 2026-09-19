// ══════════════════════════════════════════════════════════════════════════
// RK-01 — the rating: an Elo number, the tier it names, and the arithmetic
// that moves it.
//
// Ported from HexMatch (`src/net/rating.ts`, RANK-01 #147) and adapted to a
// RACE. This module is deliberately PURE and SDK-free — no `localStorage`, no
// RUN SDK, no DOM, no clock — because three very different callers need the
// same answers: the client, the room (`src/rooms/RaceRoom.ts`) and this
// repository's Node test suite. Everything a caller needs to know is an
// argument or a return value.
//
// THE SHAPE OF A RATED RACE
//
//   A race that ends has exactly one of three readings, and each has a policy:
//
//     1. the flag fell and the room filed a classification
//                                   → every rated human moves (§ `rateRace`);
//     2. a driver left the race  → the LEAVER is a DNF and ranks below every
//                                   finisher (HexMatch's rule, kept);
//     3. AI seats, friendly rooms, house-rule rooms
//                                   → nothing is rated at all.
//
//   (2) is the one that needs justifying, and HexMatch's justification still
//   holds. A rating system that ignored abandonment would make quitting
//   strictly better than losing, and the ladder would fill with drivers who
//   leave the moment the race turns. Since a race has a scoreboard, "the
//   leaver loses" is both the fair reading and the only one that cannot be
//   farmed. The rule is expressed here as `RaceEntry.left`, which forces a DNF
//   however the classification read — see that field's comment for the one
//   case it must NOT be set on.
//
// WHAT A RACE CHANGES ABOUT THE ARITHMETIC
//
//   HexMatch rates a DUEL: two players, one pairwise result, one number each
//   way. A race here seats up to six HUMANS, so the unit becomes the PAIR:
//   every two rated drivers in the field are a head-to-head result — ahead
//   beats behind — and each driver's K is divided by `(humans − 1)`. Three
//   properties come out of that, and all three are tested:
//
//     - an even six-marble race pays its winner exactly what an even duel pays
//       (K/2): the divisions cancel against the doubled count of pairs;
//     - every pair cancels, so while the whole field shares one K its deltas
//       sum to zero (rounding aside) and the ladder does not inflate;
//     - finishing higher can never pay less, whatever the rest of the field
//       arrived with.
//
//   AI MARBLES ARE NOT ON THE BOARD. A marble nobody is steering is not an
//   opponent, so it cannot be farmed for rating — and it is not in the
//   classification the ladder reads either, which is why every place this
//   module reports (`position`) is a place among the rated HUMANS.
//
// WHY ELO AND NOT SOMETHING ELSE
//
//   The epic asks for chess-style Elo, and it is the right primitive: a race
//   decomposes cleanly into pairwise results, and the two knobs are the START
//   (1000) and the K-factor, which is halved once a driver is ESTABLISHED so a
//   long-standing rating stops swinging on one bad night.
//
// WHAT THE ARITHMETIC DOES NOT DO
//
//   Ratings rank and decorate; they gate nothing. There is no reward, no
//   unlock and no circuit a rating can lock a player out of — which is also
//   why the numbers can be recomputed on every client without trusting anyone:
//   the board a race is rated from is the numbers the ROOM holds (RK-03), and
//   everyone with the same board and the same classification gets the same
//   verdict out of this file.
// ══════════════════════════════════════════════════════════════════════════

/** The rating a driver starts at — the epic's number, and a round one. */
export const START_RATING = 1000;

/**
 * K-factor while PROVISIONAL: the first `PROVISIONAL_MATCHES` rated races.
 * A new driver's rating is a guess, so it is allowed to move fast to find the
 * right neighbourhood. 40/16 is the classic chess pairing of the two values.
 */
export const K_PROVISIONAL = 40;
export const K_ESTABLISHED = 16;

/** Rated races after which a driver is no longer provisional. */
export const PROVISIONAL_MATCHES = 10;

/**
 * Floor. Ratings never go below this: a rating that can run to zero turns a
 * bad start into a hole a new driver cannot climb out of, and the ladder is
 * supposed to be a road back up. There is deliberately NO ceiling — the top of
 * the ladder is open, and the last NAMED tier is not the last rating.
 */
export const RATING_FLOOR = 100;

/**
 * The fewest rated HUMANS a race needs before it is worth anything. A rating
 * is a comparison: with nobody to compare against there is no pair to move a
 * number across, so a solo race (a time trial, an AI-only grid, a room that
 * emptied before the flag) is simply not rated — it moves nothing and it does
 * not tick the provisional counter either (see `applyRaceResult`).
 */
export const MIN_RATED_FIELD = 2;

// ── the tiers: the bands a rating names ───────────────────────────────────

/**
 * Rank tiers, lowest first. `min` is inclusive; the tier runs up to the next
 * tier's `min`. The keys are the badge file names in `src/assets/ui/rank/`
 * (RK-05 derives them) and MUST stay in step with them.
 *
 * THE THRESHOLDS ARE HEXMATCH'S, UNADJUSTED (0, 1100, 1250, 1400, 1550, 1750):
 * the two games start everyone at 1000 and move a rating by about the same
 * amount per night, so there is no argument for new bands. Only the NAMES are
 * this game's — a marble racer out of a scrapyard, not a freight syndicate —
 * and they keep the ladder readable at a glance: Scrap, Bronze Bolt, Iron,
 * Steel, Gold Gear, Heavy Metal. Bands are 150 wide up to the last one and it
 * is open-ended, which puts the 1000 start inside Scrap: everyone begins at
 * the bottom of the yard and the first few wins are the promotion.
 *
 * `unranked` is NOT in this table — it is a state (no rated race filed yet),
 * not a band; see `rankKeyOf`.
 */
export interface RankTier {
  key: string;
  label: string;
  /** Lowest rating in the band. */
  min: number;
  /** One line for the ladder panel / the badge's tooltip. */
  blurb: string;
}

export const RANK_TIERS: readonly RankTier[] = [
  { key: 'scrap', label: 'Scrap', min: 0, blurb: 'Racing on borrowed bolts.' },
  { key: 'bronze-bolt', label: 'Bronze Bolt', min: 1100, blurb: 'A regular name on the entry list.' },
  { key: 'iron', label: 'Iron', min: 1250, blurb: 'Holds the racing line when the pack leans on it.' },
  { key: 'steel', label: 'Steel', min: 1400, blurb: 'Podium pace on any circuit.' },
  { key: 'gold-gear', label: 'Gold Gear', min: 1550, blurb: 'Sets the lap the rest of the grid chases.' },
  { key: 'heavy-metal', label: 'Heavy Metal', min: 1750, blurb: 'The marble everybody wants to beat.' },
];

/** The badge shown to a driver with no rated race yet. */
export const UNRANKED_KEY = 'unranked';
export const UNRANKED_LABEL = 'Unranked';

/**
 * A driver's stored rating, as it lives in RUN player storage (`appStorage`,
 * RK-02's key). Every field is required and every one is clamped by
 * `parseRankState`: storage is shared with older builds of this game and with
 * whatever a future build wrote, and a rating file is not the place to throw.
 *
 * ADAPTED FROM THE DUEL: HexMatch counts duels, and for a duel "not the
 * winner" and "lost" are the same thing. A race has one winner too, but five
 * other places, so the counters read:
 *
 *   - `matches` — rated RACES filed (the provisional counter);
 *   - `wins`    — rated races won, i.e. finished ahead of every other human;
 *   - `losses`  — the rest of them. Yes: second place at a six-marble race is
 *                 a loss in this file, and so is a DNF. A race is won or it is
 *                 not, and `wins + losses === matches` keeps `winRate` honest.
 *                 Elo's own number is the fine-grained measure of WHERE in the
 *                 field a driver finished; this file counts flags.
 */
export interface RankState {
  /** The Elo number. */
  rating: number;
  /** Rated races played (the provisional counter). */
  matches: number;
  wins: number;
  losses: number;
  /**
   * The season this rating belongs to. SEASONS ARE NOT SHIPPED YET (RK-01
   * decided "seam only"): this exists so that a future reset is a
   * `state.season !== CURRENT_SEASON → soft reset` branch rather than a
   * migration over an unversioned number. `RANK_SEASON` is the only value the
   * game writes today.
   */
  season: string;
}

export const RANK_SEASON = 's1';

export const freshRankState = (rating = START_RATING): RankState => ({
  rating: clampRating(rating),
  matches: 0,
  wins: 0,
  losses: 0,
  season: RANK_SEASON,
});

export function clampRating(rating: number): number {
  if (!Number.isFinite(rating)) return START_RATING;
  return Math.max(RATING_FLOOR, Math.round(rating));
}

/** Tier for a rating. Never null: below the first band's floor is still it. */
export function rankOf(rating: number): RankTier {
  const r = clampRating(rating);
  let tier = RANK_TIERS[0];
  for (const candidate of RANK_TIERS) if (r >= candidate.min) tier = candidate;
  return tier;
}

/**
 * The badge key to print: `unranked` until the first rated race is filed,
 * then the tier. A 0-race file and a missing file look the same to the UI,
 * which is the point — one badge for "not yet", one per band after it.
 */
export function rankKeyOf(state: Pick<RankState, 'rating' | 'matches'>): string {
  return state.matches > 0 ? rankOf(state.rating).key : UNRANKED_KEY;
}

export function rankLabelOf(state: Pick<RankState, 'rating' | 'matches'>): string {
  return state.matches > 0 ? rankOf(state.rating).label : UNRANKED_LABEL;
}

export interface TierProgress {
  tier: RankTier;
  /** The next tier, or null at the top of the ladder. */
  next: RankTier | null;
  /** 0–1 through the current band. 1 at the top of the ladder. */
  fraction: number;
  /** Rating still needed for `next` (0 when there is no next). */
  toNext: number;
}

export function tierProgress(rating: number): TierProgress {
  const r = clampRating(rating);
  const tier = rankOf(r);
  const i = RANK_TIERS.indexOf(tier);
  const next = i + 1 < RANK_TIERS.length ? RANK_TIERS[i + 1] : null;
  if (!next) return { tier, next: null, fraction: 1, toNext: 0 };
  const span = next.min - tier.min;
  const into = r - tier.min;
  return {
    tier,
    next,
    fraction: span <= 0 ? 1 : Math.min(1, Math.max(0, into / span)),
    toNext: Math.max(0, next.min - r),
  };
}

// ── the arithmetic ────────────────────────────────────────────────────────

/** Provisional drivers move fast; established ones move carefully. */
export const kFactor = (matches: number): number =>
  matches < PROVISIONAL_MATCHES ? K_PROVISIONAL : K_ESTABLISHED;

/** The classic Elo expectation: 1 for a certain win, 0.5 for an even pairing. */
export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

/**
 * One rated driver, as `rateRace` reads them. `games` is the provisional
 * counter — the number `kFactor` wants — and it is the same field `RankState`
 * calls `matches`; the board keeps the epic's shorter name so a wire payload
 * and a stored file are not mistaken for one another (`ratedFrom` is the only
 * place the two meet).
 */
export interface RatedPlayer {
  playerId: string;
  rating: number;
  /** Rated races played before this one. */
  games: number;
  /**
   * False when the room never heard this driver publish a rating, so the
   * 1000 here is a guess rather than a number anyone earned. Optional: a
   * board built by hand (or a test) is taken at face value.
   */
  known?: boolean;
}

/**
 * One seat of the classification, in finishing order. `order` is the room's
 * `results.order` filtered to the rated humans, and its ARRAY ORDER is the
 * verdict: index 0 finished ahead of index 1.
 */
export interface RaceEntry {
  playerId: string;
  finished: boolean;
  /**
   * The room saw this driver abandon the race — HexMatch's leaver rule, and
   * the reason this flag exists rather than being folded into `finished`.
   *
   * A driver who leaves mid-race is a DNF even if the AI took their marble
   * over (MP-08 hands it a key three seconds after the socket goes) and even
   * if that marble then rolls home: on the scoreboard they abandoned, and a
   * rating system that paid them anyway would be paying people to quit.
   *
   * It must NOT be set on a driver who crossed the line and THEN closed the
   * tab. That is a finished race with a valid classification, and demoting it
   * would punish the ordinary "see the flag, shut the laptop" ending. The
   * room decides which of the two it is looking at — and a reconnect inside
   * the platform's hold window is not a leaver either (MP-08).
   */
  left?: boolean;
}

/** One driver's movement, as both halves of the race agree on it. */
export interface RaceChange {
  playerId: string;
  before: number;
  after: number;
  /**
   * Signed, and in whole points. Can be 0 where a duel's never was: rounding
   * at the floor, a mid-field finish at your own level, or a field too small
   * to rate all leave a number where it was.
   */
  delta: number;
  /**
   * The driver's own K after the `(humans − 1)` division — what one opponent
   * in this field was worth. 0 in a field of one: an unrated race has no pair
   * to move a number across.
   */
  k: number;
  /**
   * 1-based place among the rated HUMANS (AI marbles are not placed here),
   * or 0 when the field was too small to rate — there is no ladder position
   * in a race against nobody.
   */
  position: number;
  /** Whether this driver was classified at the flag (a leaver never is). */
  finished: boolean;
  /** How many rated humans this driver was paired against. */
  opponents: number;
}

/** A seat of the field, with the two facts the pairwise score needs. */
interface Seated {
  player: RatedPlayer;
  finished: boolean;
  /** Index in `order`; only meaningful between two finishers. */
  orderIndex: number;
  /** Index in `board`, which breaks DNF ties for the printed position. */
  boardIndex: number;
  /** 1-based place among the field, finishers first. */
  position: number;
}

/**
 * Line the field up: who finished, in what order, and where each driver
 * prints.
 *
 * Two deliberate readings:
 *
 *   - a driver on the board whom `order` does not mention is a DNF. The room
 *     filed a classification without them, so the race has no record of them
 *     finishing, and "no evidence of finishing" is a non-finish.
 *   - `order` entries for anybody NOT on the board are ignored. That is the
 *     AI seats (which are never rated) and, defensively, a classification row
 *     for a driver the room never heard from — the caller's job is to put
 *     every human on the board (`ratedPlayersFrom` does exactly that, with a
 *     fresh-1000 default, so a silent driver cannot shrink the field).
 */
function seatField(board: readonly RatedPlayer[], order: readonly RaceEntry[]): Seated[] {
  const seen = new Set<string>();
  const field: RatedPlayer[] = [];
  for (const player of board) {
    if (seen.has(player.playerId)) continue; // one row per human; a duplicate would skew every pair
    seen.add(player.playerId);
    field.push(player);
  }
  const entries = new Map<string, RaceEntry>();
  const index = new Map<string, number>();
  order.forEach((entry, i) => {
    if (entries.has(entry.playerId)) return; // first mention wins: a repeated row is not a re-run
    entries.set(entry.playerId, entry);
    index.set(entry.playerId, i);
  });
  const seated = field.map((player, boardIndex): Seated => {
    const entry = entries.get(player.playerId);
    return {
      player,
      finished: entry?.finished === true && entry.left !== true,
      orderIndex: entry ? index.get(player.playerId)! : Number.POSITIVE_INFINITY,
      boardIndex,
      position: 0,
    };
  });
  // Finishers first, in the room's order; then the DNFs, in board order. A
  // DNF listed above a finisher (a malformed classification) is put back
  // below it rather than believed.
  const placed = [...seated].sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished) return a.orderIndex - b.orderIndex;
    return a.boardIndex - b.boardIndex;
  });
  placed.forEach((seat, i) => {
    seat.position = i + 1;
  });
  return seated;
}

/**
 * This pair's result from `a`'s side: 1 when `a` was ahead, 0 when behind,
 * 0.5 when neither is ahead.
 *
 * Two finishers are never level — a classification is a total order, and the
 * room's array is it. A finisher is ahead of every DNF. Two DNFs TIE: neither
 * of them got home, and picking one to be "ahead" on the strength of an array
 * position would be inventing a result the scoreboard does not have. (That is
 * the multiplayer version of HexMatch's rule that a leaver loses: a leaver
 * loses to everyone who finished, and to another leaver they cancel.)
 */
function scoreAgainst(a: Seated, b: Seated): number {
  if (a.finished && b.finished) return a.orderIndex < b.orderIndex ? 1 : 0;
  if (a.finished !== b.finished) return a.finished ? 1 : 0;
  return 0.5;
}

/**
 * The arithmetic, for the WHOLE field at once — one call so no two drivers can
 * be computed from different boards (the classic Elo bug: updating one side
 * first and then reading its new number as the other side's opponent).
 *
 * Every rated human is paired with every other one. A driver's movement is
 *
 *     delta = K(games) / (humans − 1) · Σ (score − expected)
 *
 * over the other humans, and the result rounds to whole points the way the
 * duel did: the HUD prints integers, and a rating carrying decimals into
 * storage makes "±1" drift invisible for months.
 *
 * The array that comes back is in the BOARD's order, one row per board entry.
 */
export function rateRace(
  board: readonly RatedPlayer[],
  order: readonly RaceEntry[],
): RaceChange[] {
  const field = seatField(board, order);
  const humans = field.length;
  const rated = humans >= MIN_RATED_FIELD;
  // The division that makes a six-marble race worth one duel. A field of one
  // has no pairs to divide between, so nothing moves and K is reported as 0.
  const share = humans > 1 ? 1 / (humans - 1) : 0;

  return field.map((me) => {
    const before = clampRating(me.player.rating);
    const k = kFactor(me.player.games);
    let movement = 0;
    for (const them of field) {
      if (them.player.playerId === me.player.playerId) continue;
      const expected = expectedScore(before, clampRating(them.player.rating));
      movement += (scoreAgainst(me, them) - expected) * k * share;
    }
    const after = clampRating(before + movement);
    return {
      playerId: me.player.playerId,
      before,
      after,
      delta: after - before,
      k: k * share,
      position: rated ? me.position : 0,
      finished: me.finished,
      opponents: humans - 1,
    };
  });
}

/** The two halves of a duel, as `rateDuel` computes them. */
export interface RatedDuel {
  winner: RaceChange;
  loser: RaceChange;
}

/**
 * The duel, kept as its own function for two reasons: the epic's acceptance
 * requires that a two-human race equals a HexMatch duel EXACTLY, and the
 * shortest way to show that a two-driver field IS the duel is to keep the duel
 * here to compare against. `rateRace` computes the same numbers pairwise;
 * `tests/rating.test.ts` asserts the two agree, seat for seat.
 */
export function rateDuel(winner: RatedPlayer, loser: RatedPlayer): RatedDuel {
  const wBefore = clampRating(winner.rating);
  const lBefore = clampRating(loser.rating);
  const expected = expectedScore(wBefore, lBefore);
  const wK = kFactor(winner.games);
  const lK = kFactor(loser.games);
  const wAfter = clampRating(wBefore + wK * (1 - expected));
  const lAfter = clampRating(lBefore - lK * (1 - expected));
  return {
    winner: {
      playerId: winner.playerId, before: wBefore, after: wAfter, delta: wAfter - wBefore,
      k: wK, position: 1, finished: true, opponents: 1,
    },
    loser: {
      playerId: loser.playerId, before: lBefore, after: lAfter, delta: lAfter - lBefore,
      k: lK, position: 2, finished: true, opponents: 1,
    },
  };
}

// ── the stored file ───────────────────────────────────────────────────────

/** One rival's number after the race, for the results screen. */
export interface RaceRival {
  playerId: string;
  before: number;
  after: number;
  delta: number;
  position: number;
  finished: boolean;
  /** False when this rival's rating was a guess (see `RatedPlayer.known`). */
  known: boolean;
}

/** A filed race: the file after it, and everything the ending screen prints. */
export interface FiledRaceResult {
  /** The rating file after the race — unchanged when the race was not rated. */
  state: RankState;
  /** This driver's half of `rateRace`. */
  change: RaceChange;
  /** True when the race counted (at least `MIN_RATED_FIELD` rated humans). */
  rated: boolean;
  /** Finished ahead of every other rated human. */
  won: boolean;
  promoted: boolean;
  demoted: boolean;
  tierBefore: RankTier;
  tierAfter: RankTier;
  /** The rest of the field, in finishing order, with everyone's new number. */
  rivals: RaceRival[];
  /** False when any rival's number was a guess. */
  fieldKnown: boolean;
}

/**
 * Fold one race into a driver's own rating file.
 *
 * `board` is the room's copy of "who is what" (RK-03 folds it in), NOT this
 * client's opinions, so every seat computes its half from identical inputs.
 * The player's own file is added to the board if the caller left it out — a
 * driver is always a rated seat in a race they are filing.
 *
 * A race that did not count (a field of one, an abandoned lobby) returns the
 * file UNTOUCHED, including the provisional counter: `matches` is "rated races
 * played", and letting a time trial tick it down would make "established"
 * something a player could farm without ever facing anybody.
 */
export function applyRaceResult(
  self: { playerId: string; state: RankState },
  board: readonly RatedPlayer[],
  order: readonly RaceEntry[],
): FiledRaceResult {
  const field = board.some((p) => p.playerId === self.playerId)
    ? board
    : [...board, ratedFrom(self.playerId, self.state)];
  const changes = rateRace(field, order);
  const change = changes.find((c) => c.playerId === self.playerId)!;
  const rated = field.length >= MIN_RATED_FIELD;
  const keyBefore = rankKeyOf(self.state);
  const tierBefore = rankOf(change.before);

  const rivals: RaceRival[] = field
    .filter((p) => p.playerId !== self.playerId)
    .map((p) => {
      const c = changes.find((x) => x.playerId === p.playerId)!;
      return {
        playerId: p.playerId,
        before: c.before,
        after: c.after,
        delta: c.delta,
        position: c.position,
        finished: c.finished,
        known: p.known !== false,
      };
    })
    .sort((a, b) => a.position - b.position);

  if (!rated) {
    return {
      state: self.state,
      // `rateRace` already reports a field too small to rate as a standstill:
      // nothing moved, nothing was won, and there is no place to print.
      change,
      rated: false,
      won: false,
      promoted: false,
      demoted: false,
      tierBefore,
      tierAfter: tierBefore,
      rivals: [],
      fieldKnown: true,
    };
  }

  const won = change.position === 1;
  const next: RankState = {
    rating: change.after,
    matches: self.state.matches + 1,
    wins: self.state.wins + (won ? 1 : 0),
    losses: self.state.losses + (won ? 0 : 1),
    season: RANK_SEASON,
  };
  const tierAfter = rankOf(next.rating);
  return {
    state: next,
    change,
    rated: true,
    won,
    // Promoted/demoted only when the BAND changes — the first rated race is a
    // promotion out of `unranked`, which is what a driver expects to see.
    promoted: rankKeyOf(next) !== keyBefore && next.rating > change.before,
    demoted: rankKeyOf(next) !== keyBefore && next.rating < change.before,
    tierBefore,
    tierAfter,
    rivals,
    fieldKnown: rivals.every((r) => r.known),
  };
}

/**
 * The local write rule: the NEWER file wins, and `matches` is what "newer"
 * means.
 *
 * `filed` is a file this client computed from a room-witnessed result, so it
 * moves the rating in whichever direction the race did — a loss LOWERS it,
 * which is the whole point of a rating. What must never happen is an OLD file
 * overwriting a newer one: two tabs, a device that was offline, or a late
 * result from a previous race can all hand this function a state built from a
 * shorter history, and the longer history is the truth. So the comparison is
 * on the race COUNT, not on the number.
 *
 * A season change replaces outright: the reset recipe is
 * `{ rating: START_RATING, matches: 0, wins: 0, losses: 0, season: <new> }`,
 * and after a reset the new file is the truth however it compares.
 */
export function advanceRating(current: RankState | null, filed: RankState): RankState {
  if (!current) return filed;
  if (filed.season !== current.season) return filed;      // a season seam replaces
  if (filed.matches < current.matches) return current;    // a stale file: the newer history stands
  return filed;
}

/** The two numbers the arithmetic reads, from a stored file. */
export const ratedFrom = (playerId: string, state: RankState): RatedPlayer => ({
  playerId,
  rating: state.rating,
  games: state.matches,
  known: true,
});

// ── the wire: what a room holds about each driver ─────────────────────────

/**
 * A rating as it travels: the room's copy of "who is what", published once per
 * driver on join (RK-03's relay). Deliberately NOT the full file — the wire
 * carries exactly the two numbers `rateRace` reads, so nothing else can be
 * influenced by a peer.
 */
export interface RankWire {
  playerId: string;
  rating: number;
  /** Rated races played — `RankState.matches` under the board's name. */
  games: number;
}

/**
 * The room's rating board, as a peer sees it. Both clients rebuild this from
 * the welcome + rating messages and it is what a race is rated from, so the
 * seats of one race are always computed from the same inputs.
 */
export type RankBoard = Record<string, { rating: number; games: number }>;

export function parseRankWire(raw: unknown): RankWire | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<RankWire>;
  if (typeof o.playerId !== 'string' || o.playerId.length === 0) return null;
  const rating = typeof o.rating === 'number' && Number.isFinite(o.rating) ? o.rating : START_RATING;
  const games = typeof o.games === 'number' && Number.isFinite(o.games)
    ? Math.max(0, Math.floor(o.games))
    : 0;
  return { playerId: o.playerId, rating: clampRating(rating), games };
}

/** `{ playerId: { rating, games } }` from a roster, for opponent lookups. */
export function rankBoardFrom(entries: readonly RankWire[]): RankBoard {
  const board: RankBoard = {};
  for (const entry of entries) board[entry.playerId] = { rating: entry.rating, games: entry.games };
  return board;
}

/**
 * One driver's numbers as `rateRace` needs them. A driver the room never heard
 * from (an older build, a storage failure, a publish that never landed) is
 * read as a fresh 1000 — the same rating their own first race would be worth
 * against anyone, and the least surprising default on a board that carries no
 * information. `known: false` lets the verdict say the number was a guess.
 */
export function ratedPlayerFor(
  board: RankBoard,
  playerId: string,
): RatedPlayer & { known: boolean } {
  const entry = board[playerId];
  if (!entry) return { playerId, rating: START_RATING, games: 0, known: false };
  return { playerId, rating: entry.rating, games: entry.games, known: true };
}

/**
 * The rated field for a race: one row per HUMAN the room seated, whether or
 * not their rating ever arrived. The caller passes the humans it knows about
 * (the room's roster minus the AI seats) — this is the function that stops a
 * silent driver from vanishing out of the arithmetic and quietly shrinking
 * everyone else's field.
 */
export function ratedPlayersFrom(
  board: RankBoard,
  humanIds: readonly string[],
): RatedPlayer[] {
  const seen = new Set<string>();
  const out: RatedPlayer[] = [];
  for (const id of humanIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(ratedPlayerFor(board, id));
  }
  return out;
}

// ── the verdict a finished race produces ──────────────────────────────────

/** What a filed race means for one seat, as every client agrees on it. */
export interface RaceVerdict extends FiledRaceResult {
  playerId: string;
  /**
   * 1-based place among the rated humans, or 0 when the race did not count.
   * NOT the overall classification: AI marbles are not on this ladder.
   */
  position: number;
  /** How many rated humans raced. */
  field: number;
  /** Classified at the flag (a leaver never is). */
  finished: boolean;
  /** The room saw this driver abandon the race rather than finish it. */
  forfeit: boolean;
}

/**
 * Everything the ending screen needs, from the three facts it has: the
 * driver's own file, the room's board, and the room's classification. Pure —
 * the caller owns storage and the wire.
 */
export function rateRaceOutcome(input: {
  self: { playerId: string; state: RankState };
  board: readonly RatedPlayer[];
  order: readonly RaceEntry[];
}): RaceVerdict {
  const filed = applyRaceResult(input.self, input.board, input.order);
  const seat = input.order.find((e) => e.playerId === input.self.playerId);
  // The field is every rated seat of the race, including this driver — who is
  // always a seat, whether or not the caller's board mentioned them.
  const seated = input.board.some((p) => p.playerId === input.self.playerId)
    ? input.board.length
    : input.board.length + 1;
  const field = filed.rated ? filed.rivals.length + 1 : seated;
  return {
    ...filed,
    playerId: input.self.playerId,
    position: filed.rated ? filed.change.position : 0,
    field,
    finished: filed.change.finished,
    forfeit: seat?.left === true,
  };
}

// ── the stored file, on and off the wire ──────────────────────────────────

/**
 * Read a rank file back out of player storage. Tolerant by design: a value
 * written by an older build, a half-written record, or a hostile one all
 * degrade to a fresh file rather than throwing inside a boot path. Numbers are
 * clamped and counts are floored at zero, so a corrupt file can only ever land
 * a driver at the bottom of the yard — never at the top of a band they did not
 * earn.
 */
export function parseRankState(raw: unknown): RankState | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const o = parsed as Partial<Record<keyof RankState, unknown>>;
  // A record that carries NONE of the five fields is not a half-written rank
  // file, it is somebody else's JSON under our key. Saying so (rather than
  // defaulting every field) is what lets the caller fall through to the local
  // mirror, and what makes a clobbered key a fallback instead of a reset.
  if (
    o.rating === undefined && o.matches === undefined && o.wins === undefined &&
    o.losses === undefined && o.season === undefined
  ) {
    return null;
  }
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const count = (v: unknown): number => Math.max(0, Math.floor(num(v, 0)));
  return {
    rating: clampRating(num(o.rating, START_RATING)),
    matches: count(o.matches),
    wins: count(o.wins),
    losses: count(o.losses),
    season: typeof o.season === 'string' && o.season.length > 0 ? o.season : RANK_SEASON,
  };
}

export const serializeRankState = (state: RankState): string => JSON.stringify(state);

// ── printing ──────────────────────────────────────────────────────────────

/** `1042` — the rating as the HUD prints it. */
export const fmtRating = (rating: number): string => String(clampRating(rating));

/** `+18` / `−14` — signed, with the typographic minus the rest of the HUD uses. */
export const fmtRatingDelta = (delta: number): string =>
  `${delta >= 0 ? '+' : '−'}${Math.abs(Math.round(delta))}`;

/** `1042 · Steel` or `Unranked · placement` — one line for a seat row. */
export function rankSummary(state: RankState): string {
  if (state.matches === 0) return `${UNRANKED_LABEL} · placement`;
  const provisional = state.matches < PROVISIONAL_MATCHES
    ? ` · ${PROVISIONAL_MATCHES - state.matches} to go`
    : '';
  return `${fmtRating(state.rating)} · ${rankLabelOf(state)}${provisional}`;
}

/**
 * Share of rated races WON, as the ladder prints it — and in a race that is
 * every position but first (see `RankState`). `—` until there is something to
 * divide.
 */
export function winRate(state: RankState): string {
  const played = state.wins + state.losses;
  if (played <= 0) return '—';
  return `${Math.round((state.wins / played) * 100)}%`;
}

// ── rank-bucketed matchmaking (RK-04) ─────────────────────────────────────

/**
 * The pool's criterion value for a similar-rank SEARCH WINDOW, or null for
 * "any rank".
 *
 * The matchmaker matches criteria by equality — there is no range operator on
 * the wire (`MatchmakeOptions.criteria` is flat string/number keys) — so a
 * window is expressed as a BUCKET: everyone whose rating rounds into the same
 * bucket is, by the pool's reckoning, similar. The window is therefore always
 * a little wider than `span` (a driver 1 point across a boundary misses the
 * first bucket and is caught by the next window), which is exactly why the
 * search WIDENS over time instead of stopping at one window.
 *
 * A span of 0 (or anything not positive) means Any rank: no criterion at all.
 */
export function searchBucket(rating: number, span: number): number | null {
  if (!(span > 0)) return null;
  return Math.round(clampRating(rating) / span);
}

/**
 * The ladder score for a rating: the leaderboard ranks HIGHEST-first, so a
 * driver's rating IS their score. Exported as a function — rather than used
 * inline — so the one place that decides this is named, and so a season reset
 * has a single seam to change.
 */
export const ladderScoreFor = (rating: number): number => clampRating(rating);
