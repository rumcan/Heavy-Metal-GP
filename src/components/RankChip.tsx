// ══════════════════════════════════════════════════════════════════════════
// RK-05 (#59) — the rank chip: one badge and one number, everywhere they show.
//
// Ported from HexMatch's `RankChip` (`src/ui/StartScreen.tsx`, RANK-01 #147).
// The reasoning is theirs and it is why this is one component rather than four
// pieces of markup: the SAME chip is printed in the garage header (your own
// rating), on every human seat in the lobby (yours from your own file, a
// rival's from the room's board) and in the ladder list. Four hand-rolled
// copies would drift the moment a tier is renamed.
//
// `rating: null` means the room has not carried this player's number yet — the
// chip says "no rating yet" out loud rather than hiding the row, since a rated
// race against an unknown opponent is worth less and the player is about to
// race them anyway.
//
// The MODEL is `src/game/rank-view.ts` (pure, node-testable); this file is only
// how it looks. No SDK, no storage, no effects — `tests/lobby-ui.test.ts`
// paints it through vite's SSR pipeline.
// ══════════════════════════════════════════════════════════════════════════
import { fmtRating } from '../net/rating';
import { badgeUrlFor } from '../game/rank-badge';
import { isProvisional } from '../game/rank-view';
import type { RankChipModel } from '../game/rank-view';

export type { RankChipModel, RankChipLookup } from '../game/rank-view';
export { chipOf, chipOfWire, chipOfBoard } from '../game/rank-view';

interface Props {
  model: RankChipModel;
  /** Who this chip belongs to, in the list-flavoured printings (the ladder). */
  who?: string;
  /** Print the badge and the number without the tier label (a seat row). */
  compact?: boolean;
  /** Hide the badge: the results row already prints one, and two medals read as a bug. */
  badge?: boolean;
}

export default function RankChip({ model, who, compact = false, badge = true }: Props) {
  const provisional = model.rating !== null && isProvisional(model.games);
  const title = model.rating === null
    ? 'No rating published to this room yet'
    : `${model.label} · ${fmtRating(model.rating)}${provisional ? ' · placement races' : ''}`;
  return <span className={`rank-chip ${compact ? 'rank-chip-compact' : ''}`} data-tier={model.key} data-rating={model.rating ?? ''} title={title}>
    {badge && <img className="rank-badge" src={badgeUrlFor(model.key)} alt="" aria-hidden="true" decoding="async" />}
    <span className="rank-chip-text">
      {who && <em className="rank-chip-who">{who}</em>}
      {/* A seat row has room for a medal and a number, not a tier name — but the
          name is what a screen reader needs, so it is printed and hidden rather
          than dropped. */}
      <b className={compact ? 'sr-only' : undefined}>{model.label}</b>
      <small>{model.rating === null ? 'no rating yet' : fmtRating(model.rating)}</small>
    </span>
  </span>;
}
