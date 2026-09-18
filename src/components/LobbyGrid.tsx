// ══════════════════════════════════════════════════════════════════════════
// MP-06 — the lobby's grid: ten slots, in slot order.
//
// One row per seat, and the row says what the seat IS: a driver with a face, a
// livery and a tune (and a Ready flag), or a machine the host dressed from the
// seed. The host gets a kick button on every seat that is not its own; a guest
// gets the same ten rows and no buttons.
//
// Split out of `OnlineLobby` because it is the half of the lobby that is pure
// rendering: it takes seats and draws them, which is what makes it testable
// without a room.
// ══════════════════════════════════════════════════════════════════════════
import type { CSSProperties } from 'react';
import { UserMinus, UserPlus } from 'lucide-react';
import type { MarbleInfo } from '../game/types';
import { RIVALS, characterOf } from '../game/characters';
import type { Seat } from '../net/protocol';
import type { PeerPresence } from '../net/presence';
import Portrait from './Portrait';
import RankChip from './RankChip';
import type { RankChipLookup } from '../game/rank-view';

interface Props {
  /** The grid, in slot order. */
  seats: readonly Seat[];
  /** The same grid as `MarbleInfo[]` — what `Portrait` and the livery read. */
  roster: readonly MarbleInfo[];
  /** Which player this screen is, so its own row can say YOU. */
  myPlayerId: string;
  /** The host may take a driver off the grid; nobody else may. */
  isHost: boolean;
  onKick?: (playerId: string) => void;
  /** MP-08: drivers whose socket dropped, so their row can say so. */
  peers?: readonly PeerPresence[];
  /** AI seats the host took off the grid. */
  benched?: readonly number[];
  /** Host only: take an AI off the grid or put it back. */
  onToggleAI?: (slot: number) => void;
  /**
   * RK-05: a HUMAN seat's rank chip — this driver's own file, or the number the
   * room's board has for a rival. Absent (or a `null` answer) prints no chip,
   * which is what an older caller and an unranked seat both look like.
   */
  rankOf?: RankChipLookup;
}

export default function LobbyGrid({ seats, roster, myPlayerId, isHost, onKick, peers, benched = [], onToggleAI, rankOf }: Props) {
  return <ol className="driver-grid lobby-grid">
    {seats.map((seat, index) => {
      const mine = seat.playerId === myPlayerId;
      // MP-08: a dropped driver keeps their seat — and their row says why the
      // portrait is not moving, instead of leaving the grid to guess.
      const dropped = seat.playerId ? peers?.some((peer) => peer.playerId === seat.playerId) ?? false : false;
      const off = seat.isAI && benched.includes(seat.slot);
      const info = roster[index] ?? { id: seat.slot, name: seat.name, color: seat.color, stats: seat.stats, isPlayer: mine, character: seat.portrait };
      return <li key={seat.slot} className={`${mine ? 'is-player' : ''} ${seat.isAI ? 'is-ai' : ''} ${dropped ? 'is-dropped' : ''} ${off ? 'is-benched' : ''}`} style={{ '--team': seat.color } as CSSProperties}>
        {seat.isAI
          ? <span className="lobby-ai-badge" aria-hidden>AI</span>
          : <Portrait marble={info} mood={seat.ready ? 'happy' : 'angry'} size={42} alt={seat.name} />}
        <div>
          <strong>{seat.name}</strong>
          <small>{dropped ? 'RECONNECTING' : mine ? 'YOU' : off ? 'OFF THE GRID' : seat.isAI ? 'MACHINE' : seat.ready ? 'READY' : 'NOT READY'}</small>
          <span>{seat.isAI ? RIVALS[characterOf(info)]?.tag ?? 'AI' : `${seat.stats.weight}/${seat.stats.speed}/${seat.stats.bounce}`}</span>
        </div>
        {/* RK-05: a rated seat shows its badge and number. AI seats have no
            rating — they are never rated, so they get no chip rather than an
            unranked one that would read as a player. */}
        {!seat.isAI && rankOf && (() => {
          const chip = rankOf(seat.playerId);
          return chip ? <RankChip model={chip} compact /> : null;
        })()}
        <i className="lobby-livery" style={{ background: seat.color }} aria-hidden />
        {isHost && seat.isAI && onToggleAI && <button
          className="icon-button lobby-kick"
          onClick={() => onToggleAI(seat.slot)}
          aria-label={off ? `Put ${seat.name} back on the grid` : `Remove ${seat.name} from the grid`}
          title={off ? 'Put back on the grid' : 'Remove AI from the grid'}
        >{off ? <UserPlus size={14} /> : <UserMinus size={14} />}</button>}
        {isHost && !mine && !seat.isAI && onKick && <button
          className="icon-button lobby-kick"
          onClick={() => onKick(seat.playerId)}
          aria-label={`Take ${seat.name} off the grid`}
          title="Take off the grid"
        ><UserMinus size={14} /></button>}
      </li>;
    })}
  </ol>;
}
