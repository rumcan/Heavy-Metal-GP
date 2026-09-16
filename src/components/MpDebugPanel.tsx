// ══════════════════════════════════════════════════════════════════════════
// MP-01 — DEV ONLY. Host / join / quick-match debug panel.
//
// This is the throwaway harness MP-01's acceptance asks for ("debug buttons are
// fine"), not the game's lobby: MP-06 builds the real Host game / Join with
// code / Quick race UI on top of the same `src/net/transport.ts` wrappers, and
// that ticket deletes this file's entry point.
//
// It is loaded lazily and only when BOTH hold:
//   - `import.meta.env.DEV` (never in a published build), and
//   - the page URL carries `?mpdebug=1` (so the default dev page — and the
//     existing browser test suite — is untouched).
//
// Everything here talks to the transport wrappers, never to the SDK itself: no
// `mp-client` import, no reaching through the SDK singleton (the isolation test
// in `tests/multiplayer.test.ts` enforces exactly that).
// ══════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  createRoom,
  isAccessDenied,
  isOfflineMockRealtime,
  isValidRoomCode,
  joinRoomByCode,
  normalizeRoomCode,
  NO_ROOM_SERVER_MESSAGE,
  promptLogin,
  quickMatch,
  writeActiveMatch,
  type ConnectionState,
  type RaceRoom,
  type ServerPlayer,
} from '../net/transport';

const panelStyle: React.CSSProperties = {
  position: 'fixed', left: 12, bottom: 12, zIndex: 9999, width: 268,
  background: '#081420f2', border: '1px solid #2b3a4d', borderRadius: 6,
  boxShadow: '0 10px 30px #0009', color: '#ede3c7', padding: '10px 12px',
  fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 11, lineHeight: 1.5,
};
const rowStyle: React.CSSProperties = { display: 'flex', gap: 6, marginTop: 6 };
const buttonStyle: React.CSSProperties = {
  flex: 1, padding: '5px 8px', background: '#13253a', color: '#ede3c7',
  border: '1px solid #2b3a4d', borderRadius: 4, cursor: 'pointer', font: 'inherit',
};
const inputStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, padding: '5px 6px', background: '#06101a', color: '#ede3c7',
  border: '1px solid #2b3a4d', borderRadius: 4, font: 'inherit', textTransform: 'uppercase',
};

/** One line of panel status, plus the room code once there is one. */
interface PanelState {
  status: string;
  code: string;
  seats: ServerPlayer[];
  connection: ConnectionState | null;
  isCreator: boolean;
  error: string | null;
}

const EMPTY: PanelState = { status: 'idle', code: '', seats: [], connection: null, isCreator: false, error: null };

export default function MpDebugPanel() {
  const [state, setState] = useState<PanelState>(EMPTY);
  const [codeInput, setCodeInput] = useState('');
  const [busy, setBusy] = useState(false);
  const roomRef = useRef<RaceRoom | null>(null);

  /** Seat/host/connection events are the room's own — read them off the handle. */
  const sync = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    setState((s) => ({
      ...s,
      code: room.roomCode,
      seats: [...room.players],
      connection: room.connectionState,
      isCreator: room.isCreator,
    }));
  }, []);

  const attach = useCallback((room: RaceRoom) => {
    roomRef.current = room;
    room.on({
      onPlayerJoined: sync,
      onPlayerLeft: sync,
      onDisconnect: () => setState((s) => ({ ...s, status: 'disconnected', connection: room.connectionState })),
      onReconnecting: () => setState((s) => ({ ...s, status: 'reconnecting', connection: room.connectionState })),
      onReconnected: () => { setState((s) => ({ ...s, status: 'connected', connection: room.connectionState })); sync(); },
      onError: (error) => setState((s) => ({ ...s, error })),
    });
    void writeActiveMatch({ roomCode: room.roomCode, at: Date.now() });
    sync();
  }, [sync]);

  const run = useCallback(async (label: string, action: () => Promise<RaceRoom>) => {
    if (isOfflineMockRealtime()) {
      setState({ ...EMPTY, status: 'no room server', error: NO_ROOM_SERVER_MESSAGE });
      return;
    }
    setBusy(true);
    setState((s) => ({ ...s, status: label, error: null }));
    try {
      const room = await action();
      attach(room);
      setState((s) => ({ ...s, status: 'connected', error: null }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isAccessDenied(err)) {
        const { success } = await promptLogin();
        setState({ ...EMPTY, status: 'signed out', error: success ? 'Signed in — try again.' : message });
      } else {
        setState((s) => ({ ...s, status: 'failed', error: message }));
      }
    } finally {
      setBusy(false);
    }
  }, [attach]);

  const leave = useCallback(() => {
    roomRef.current?.leave();
    roomRef.current = null;
    void writeActiveMatch(null);
    setState(EMPTY);
  }, []);

  // Unmounting (a hot reload, a navigation) drops the room rather than leaving
  // a live socket — and a live seat — behind.
  useEffect(() => () => { roomRef.current?.leave(); }, []);

  // NOTE for anyone reading a one-seat list on the GUEST side: the SDK only
  // tells a newly joined player about its own seat — the rest of the grid
  // arrives with MP-03's `welcome` (the room's roster + seed), while the HOST
  // sees each joiner as `room:playerJoined`. Seeing the same room code on both
  // tabs is what "joined" means until then.
  const seatList = state.seats.map((p) => `${p.username}${p.id === roomRef.current?.playerId ? ' (you)' : ''}`).join(', ');

  return <aside style={panelStyle} aria-label="Multiplayer debug panel">
    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#8d99a8' }}>
      <strong style={{ color: '#ede3c7' }}>MP DEBUG</strong>
      <span>{state.connection ?? state.status}</span>
    </div>
    <div style={{ marginTop: 6 }}>
      <div>you: {roomRef.current?.playerId ?? 'not in a room'}</div>
      <div>room: <b style={{ color: '#d63e2e', letterSpacing: 2 }}>{state.code || '—'}</b>{state.isCreator ? ' (host)' : ''}</div>
      <div>seats: {state.seats.length ? `${state.seats.length} — ${seatList}` : '—'}</div>
    </div>
    <div style={rowStyle}>
      <button style={buttonStyle} disabled={busy || !!state.code} onClick={() => void run('hosting', createRoom)}>Host race</button>
      <button style={buttonStyle} disabled={busy || !!state.code} onClick={() => void run('searching', () => quickMatch())}>Quick race</button>
    </div>
    <div style={rowStyle}>
      <input
        style={inputStyle}
        value={codeInput}
        maxLength={6}
        placeholder="CODE"
        aria-label="Room code"
        onChange={(e) => setCodeInput(normalizeRoomCode(e.target.value))}
      />
      <button
        style={buttonStyle}
        disabled={busy || !!state.code}
        onClick={() => {
          if (!isValidRoomCode(codeInput)) { setState((s) => ({ ...s, error: 'Enter the 6-character code from the other tab.' })); return; }
          void run('joining', () => joinRoomByCode(codeInput));
        }}
      >Join</button>
    </div>
    <div style={rowStyle}>
      <button style={buttonStyle} disabled={!state.code} onClick={leave}>Leave room</button>
    </div>
    {state.error && <p style={{ margin: '6px 0 0', color: '#e8b4a2' }}>{state.error}</p>}
  </aside>;
}

/**
 * Mount the panel on the live page. Called from `src/main.tsx` — lazily, and
 * only in a dev page carrying `?mpdebug=1`.
 */
export function mountMpDebugPanel(): Root {
  const host = document.createElement('div');
  host.dataset.mpDebug = 'panel';
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(<MpDebugPanel />);
  return root;
}
