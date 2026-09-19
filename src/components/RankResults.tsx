// ══════════════════════════════════════════════════════════════════════════
// RK-05 (#59) — the results screen's rating row.
//
// Ported from HexMatch's ledger row (`appendRankRow` in `src/iso/ending.ts`,
// RANK-01 #147). Three of its rules are load-bearing and are kept verbatim:
//
//   - THE PENDING STATE IS NOT A ZERO. A rated race prints "Filed with the
//     room…" until the verdict lands, because a `+0` is a number a player
//     would believe and the room is normally a round trip behind the flag.
//   - PROMOTION IS A BAND CHANGE, NOT EVERY WIN. `promoted`/`demoted` come from
//     the arithmetic (`applyRaceResult`), which only reports them when the tier
//     KEY moves — so the callout means what it says.
//   - AN UNRATED RACE SAYS WHY. A friends' lobby and a rated lobby with nobody
//     else rated in it are different facts and print different lines.
//
// The race-shaped addition is the FIELD: a duel's row has one rival, so the
// table below prints a per-human rating change for every rated seat, while the
// band here prints this driver's own — badge, new number, signed delta and the
// tier callouts.
// ══════════════════════════════════════════════════════════════════════════
import { Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { UNRANKED_KEY, badgeUrlFor } from '../game/rank-badge';
import { fmtRating, fmtRatingDelta, rankOf } from '../net/rating';
import type { RankedRaceView, RankedResultRow } from '../game/rank-view';

/** The badge key to print: the new tier once a race settled, else the driver's own. */
function badgeKeyOf(view: RankedRaceView): string {
  if (view.self) return view.self.key;
  return view.current?.key ?? UNRANKED_KEY;
}

/**
 * The rating band on the results screen. Prints in all three states; the
 * results table reads `view.byId` for its own per-row column.
 */
export default function RankResults({ view }: { view: RankedRaceView }) {
  const self = view.self;
  const up = self ? self.delta >= 0 : false;

  return <section
    className={`results-ranking is-${view.state}${view.promoted ? ' is-promoted' : ''}${view.demoted ? ' is-demoted' : ''}`}
    data-state={view.state}
    aria-label="Ranked rating"
    role="status"
  >
    <img className="results-ranking-badge" src={badgeUrlFor(badgeKeyOf(view))} alt="" aria-hidden="true" decoding="async" />
    <div className="results-ranking-body">
      {view.state === 'pending' && <>
        <b className="results-ranking-headline">
          <span className="results-ranking-tier">Filed with the room…</span>
        </b>
        <small className="results-ranking-note">
          <span>The rating lands as soon as the room agrees.</span>
          {view.current?.rating != null && <span>You are {fmtRating(view.current.rating)} right now.</span>}
        </small>
      </>}

      {view.state === 'unrated' && <>
        <b className="results-ranking-headline">
          <span className="results-ranking-tier">{view.current?.label ?? 'Unranked'}</span>
          {view.current?.rating != null && <span className="results-ranking-rating">{fmtRating(view.current.rating)}</span>}
          <span className="results-ranking-flag">UNRATED</span>
        </b>
        <small className="results-ranking-note">
          {view.reason === 'alone'
            ? 'You were the only rated driver in this race — nothing moved.'
            : 'A friendly race: nothing moved. Quick race is the rated door.'}
        </small>
      </>}

      {view.state === 'settled' && self && <>
        <b className="results-ranking-headline">
          <span className="results-ranking-tier">{rankOf(self.rating).label}</span>
          <span className="results-ranking-rating">{fmtRating(self.rating)}</span>
          <span className={`results-ranking-delta ${up ? 'up' : 'down'}`}>
            {up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}{fmtRatingDelta(self.delta)}
          </span>
        </b>
        <small className="results-ranking-note">
          <span className="results-ranking-callouts">
            {view.promoted && <span className="rank-callout is-promoted"><Sparkles size={12} />PROMOTED</span>}
            {view.demoted && <span className="rank-callout is-demoted"><TrendingDown size={12} />RELEGATED</span>}
            {view.forfeit && <span className="rank-callout">FILED BY FORFEIT</span>}
            {self.provisional && <span className="rank-callout">PLACEMENT RACE</span>}
            {!self.known && <span className="rank-callout">PART OF THIS FIELD WAS UNRATED</span>}
            {!view.stored && <span className="rank-callout is-warn">NOT SAVED — MAY NOT SURVIVE A RELOAD</span>}
          </span>
          <span>P{self.position} of {view.rows.length} rated drivers.</span>
        </small>
      </>}
    </div>
  </section>;
}

/**
 * One driver's delta, as the results table prints it beside their name. A DNF
 * or a seat the board never rated has no row and prints nothing rather than a
 * `+0` (see the pending rule above).
 */
export function RankDelta({ row }: { row: RankedResultRow | undefined }) {
  if (!row) return null;
  return <span className={`rank-delta ${row.delta >= 0 ? 'up' : 'down'}`} data-tier={row.key} data-delta={row.delta}>
    {fmtRatingDelta(row.delta)}
    <b className="sr-only">{row.delta >= 0 ? ' rating points gained' : ' rating points lost'}</b>
  </span>;
}
