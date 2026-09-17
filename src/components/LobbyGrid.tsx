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
import { UserMinus } from 'lucide-react';
import type { MarbleInfo } from '../game/types';
import { RIVALS, characterOf } from '../game/characters';
import type { Seat } from '../net/protocol';
import Portrait from './Portrait';

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
}

export default function LobbyGrid({ seats, roster, myPlayerId, isHost, onKick }: Props) {
  return <ol className="driver-grid lobby-grid">
    {seats.map((seat, index) => {
      const mine = seat.playerId === myPlayerId;
      const info = roster[index] ?? { id: seat.slot, name: seat.name, color: seat.color, stats: seat.stats, isPlayer: mine, character: seat.portrait };
      return <li key={seat.slot} className={`${mine ? 'is-player' : ''} ${seat.isAI ? 'is-ai' : ''}`} style={{ '--team': seat.color } as CSSProperties}>
        {seat.isAI
          ? <span className="lobby-ai-badge" aria-hidden>AI</span>
          : <Portrait marble={info} mood={seat.ready ? 'happy' : 'angry'} size={42} alt={seat.name} />}
        <div>
          <strong>{seat.name}</strong>
          <small>{mine ? 'YOU' : seat.isAI ? 'MACHINE' : seat.ready ? 'READY' : 'NOT READY'}</small>
          <span>{seat.isAI ? RIVALS[characterOf(info)]?.tag ?? 'AI' : `${seat.stats.weight}/${seat.stats.speed}/${seat.stats.bounce}`}</span>
        </div>
        <i className="lobby-livery" style={{ background: seat.color }} aria-hidden />
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
