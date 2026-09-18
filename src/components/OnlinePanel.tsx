// ══════════════════════════════════════════════════════════════════════════
// MP-06 — the garage's ONLINE panel: host a race, or join one by its code.
//
// Three ways into a race, and the third is not built yet:
//
//   HOST GAME       opens a room, becomes the host, shows a six-character code
//   JOIN WITH CODE  the code your host is showing
//   AUTO MATCH MAKING  join an open auto lobby, or open one and host it
//
// Every multiplayer call goes through `src/net/transport.ts` — the SDK's
// realtime API has exactly one door in this app, and this panel is not it.
// ══════════════════════════════════════════════════════════════════════════
import { useState } from 'react';
import { Globe, LogIn, Radio, RotateCcw, Users, X } from 'lucide-react';
import {
  ROOM_CODE_LENGTH,
  isOfflineMockRealtime,
  isValidRoomCode,
  normalizeRoomCode,
  NO_ROOM_SERVER_MESSAGE,
} from '../net/transport';

interface Props {
  /** True while a room is being opened. */
  busy: boolean;
  /** Why the last attempt failed, in words a player can act on. */
  error: string | null;
  onHost: () => void;
  onJoin: (code: string) => void;
  /** MP-07: pair with anybody else looking for a race. */
  onQuick: () => void;
  /** True while a quick-match search is in flight (MP-07). */
  searching?: boolean;
  /** How many matchmaking windows have closed with nobody found. */
  windows?: number;
  /** Give up looking (the in-flight request ends when its window does). */
  onCancelSearch?: () => void;
  /**
   * MP-08: the race this player was in when the tab closed. The memo survives a
   * crash on purpose — a drop is the one case that must not clear it.
   */
  rejoin?: { roomCode: string } | null;
  onRejoin?: () => void;
  onDismissRejoin?: () => void;
}

/** Shown under a code that is not six characters yet. */
export const CODE_HINT = 'Enter the six-character code your host is showing.';

export default function OnlinePanel({ busy, error, onHost, onJoin, onQuick, searching = false, onCancelSearch, rejoin = null, onRejoin, onDismissRejoin }: Props) {
  const [code, setCode] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  // No room server means host and join can never meet: the SDK's offline mock
  // still RESOLVES both, with a code nobody else can enter. Say so at the door
  // instead of showing a lobby that will never fill.
  const offline = isOfflineMockRealtime();
  const ready = isValidRoomCode(code);

  const join = () => {
    if (offline || busy) return;
    if (!ready) {
      setHint(CODE_HINT);
      return;
    }
    setHint(null);
    onJoin(normalizeRoomCode(code));
  };

  return <div className="online-panel">
    {rejoin && <div className="online-rejoin">
      <div>
        <strong>You were in a race</strong>
        <span className="muted"> / {rejoin.roomCode} — same grid, same seat, if there is one left.</span>
      </div>
      <button className="button-secondary" disabled={busy} onClick={onRejoin}><RotateCcw size={14} />Rejoin race</button>
      <button className="text-button" onClick={onDismissRejoin} aria-label="Forget that race"><X size={14} /></button>
    </div>}
    {offline
      ? <p className="online-note online-note-warn">{NO_ROOM_SERVER_MESSAGE}</p>
      : <p className="online-note">Up to six players per race — AI drivers fill the rest of the grid.</p>}
    <div className="online-panel-row">
      <button className="button-primary" disabled={busy || offline} onClick={onHost}>
        <Radio size={16} />{busy ? 'Opening the room…' : 'Host game'}
      </button>
      <div className="online-code-entry">
        <Globe size={15} aria-hidden />
        <input
          value={code}
          onChange={(e) => { setCode(normalizeRoomCode(e.target.value).slice(0, ROOM_CODE_LENGTH)); setHint(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') join(); }}
          maxLength={ROOM_CODE_LENGTH}
          placeholder="CODE"
          aria-label="Room code"
          spellCheck={false}
          autoComplete="off"
          disabled={busy || offline}
        />
        <button className="button-secondary" disabled={busy || offline || !ready} onClick={join}>
          <LogIn size={15} />Join with code
        </button>
      </div>
      <button
        className="button-secondary"
        disabled={searching || busy || offline}
        onClick={onQuick}
        title="Queue for a race with a stranger near your rank"
      >
        <Users size={15} />Auto Match Making
      </button>
    </div>
    {searching && <div className="online-search">
      <span className="live-dot" aria-hidden />
      {/* One SDK request is one window; the loop keeps asking, and each closed
          window asks for a wider rank, so "still looking" is honest — nothing
          about this state is a failure. */}
      <span><strong>Auto Match Making…</strong> Looking for another driver. The search starts near your rank and widens until it finds anyone.</span>
      <button className="text-button" onClick={onCancelSearch}><X size={14} />Cancel</button>
    </div>}
    {(hint ?? error) && <p className="online-note online-note-warn">{hint ?? error}</p>}
  </div>;
}
