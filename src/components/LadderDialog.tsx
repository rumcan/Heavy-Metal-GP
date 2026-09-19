// ══════════════════════════════════════════════════════════════════════════
// RK-05 (#59) — the ladder panel: the top of the board, and your place on it.
//
// Ported from HexMatch's ladder screen (`src/ui/StartScreen.tsx`, RANK-01
// #147) into this game's kit dialog. Two things are that file's and worth
// keeping spelled out:
//
//   - THE BOARD IS A PUBLIC, KEEP-BEST NUMBER, NOT THE TRUTH. A rating gates
//     nothing; the private file (`rankstore.ts`) is where a driver's number
//     actually lives, and the board holds the best it has ever been. So the
//     panel prints the board's rows as the board has them and its own card
//     from the driver's own file, side by side, rather than pretending the
//     two must agree.
//   - IT DEGRADES IN ONE LINE. A page with no leaderboard behind it (a dev
//     room, a signed-out player) still opens the panel and says why it is
//     empty, because an empty table would read as "nobody plays this game".
//
// Pure rendering: the board arrives as a prop (`App` reads it through
// `rankStore().loadLadder(50)`), so the three states — no board, no answer,
// empty board — are testable without a browser.
// ══════════════════════════════════════════════════════════════════════════
import { RefreshCw } from 'lucide-react';
import type { RankLadder } from '../net/rankstore';
import RankChip, { chipOfBoard } from './RankChip';
import type { RankChipModel } from './RankChip';
import Dialog from './Dialog';

interface Props {
  /** The board's rows, once they have arrived. */
  ladder: RankLadder | null;
  /** True while the board is being read. */
  loading: boolean;
  /**
   * False when this page has no ladder behind it at all (`isLadderAvailable`):
   * a dev room, a preview, an older host. The panel says that instead of
   * waiting for an answer that cannot come.
   */
  available: boolean;
  /** This driver's own card, from their own file. */
  mine: RankChipModel;
  /** Ask the board again — the panel is a snapshot, not a subscription. */
  onRetry: () => void;
  onClose: () => void;
}

export default function LadderDialog({ ladder, loading, available, mine, onRetry, onClose }: Props) {
  const rows = ladder?.entries ?? [];
  const place = ladder?.mine?.rank ?? null;
  const total = ladder?.total ?? rows.length;

  return <Dialog titleId="ladder-title" onClose={onClose} className="ladder-panel">
    <span className="eyebrow">THE LADDER <span className="muted">/ TOP 50</span></span>
    <h2 id="ladder-title">Top ratings</h2>
    <p className="ladder-subtitle">Every rated quick race moves one number. The badge is the band it lands in.</p>

    {!available ? (
      // No board behind this page: not an error, and not an empty ladder.
      <p className="ladder-note">The ladder is not reachable from this page — it needs a signed-in RUN.world player. Quick race still works; your rating is kept on your own file.</p>
    ) : loading ? (
      <p className="ladder-note" role="status">Reading the board…</p>
    ) : !ladder ? (
      <p className="ladder-note">The ladder did not answer just now. Your rating is safe on your own file — try again in a moment.</p>
    ) : rows.length === 0 ? (
      <p className="ladder-note">Nobody has filed a rating yet. Win a quick race and this board has a first name on it.</p>
    ) : (
      <ol className="ladder-list">
        {rows.map((row, index) => {
          const place_ = row.rank > 0 ? row.rank : index + 1;
          return <li key={`${row.profileId || row.username}-${place_}`} data-rank={place_}>
            <span className="ladder-place">{place_}</span>
            <RankChip model={chipOfBoard(row.rating)} who={row.username} />
          </li>;
        })}
      </ol>
    )}

    <p className="ladder-mine">
      <span>Your card</span>
      <RankChip model={mine} />
      {place !== null && <small className="muted">rank {place} of {total}</small>}
      {available && !loading && (
        <button className="text-button" onClick={onRetry}><RefreshCw size={13} />Refresh</button>
      )}
    </p>

    <div className="ladder-actions">
      <button className="button-secondary" onClick={onClose}>Close</button>
    </div>
  </Dialog>;
}
