// ══════════════════════════════════════════════════════════════════════════
// MP-06 — the LOBBY: the room the host opened and everybody else walked into.
//
// Two screens, one component, because they are the same room seen from either
// end — and the difference is one field of the welcome:
//
//   isHost  the grid is MINE. I dress it (the room seats people with
//           placeholder marbles; I decide what the field looks like), file
//           every guest's garage as it arrives, pick the circuit, take a driver
//           off the grid, and drop the lights when everybody is ready.
//   guest   the grid is the HOST's, and I read it out of `lobby`. I send my own
//           garage once, in `ready`, and I say when I am ready.
//
// The room owns who sits where and refuses what it does not own; the host owns
// what the grid looks like. Nothing here simulates anything — that starts when
// the lights go out and `RaceSession` takes over.
// ══════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, Copy } from 'lucide-react';
import type { RaceRoom } from '../net/transport';
import {
  canStart,
  circuitIndexOf,
  dressGrid,
  fileGarage,
  rosterOf,
  seatOfPlayer,
  setReady,
  startBlockedReason,
} from '../net/lobby';
import { START_ARM_MS } from '../net/session';
import type { RaceLink } from '../net/session';
import type { RaceProtocol, RaceSettings, Seat, SeatGarage, WelcomeMsg } from '../net/protocol';
import { CALENDAR } from '../game/season';
import LobbyGrid from './LobbyGrid';
import Brand from './Brand';

/** What App needs to launch an online race once the lights are armed. */
export interface OnlineRaceStart {
  seed: number;
  seats: Seat[];
  settings: RaceSettings;
  localSeat: number;
  isHost: boolean;
  countdownAt: number;
}

interface Props {
  /** The connected room. The lobby reads its code and its player id. */
  room: RaceRoom;
  /** This driver's garage — filed into their seat, and sent to the host. */
  garage: SeatGarage;
  circuitIndex: number;
  onCircuit: (index: number) => void;
  /** Back to the garage. Leaves the room. */
  onLeave: () => void;
  onStart: (race: OnlineRaceStart) => void;
  /** The room's message sink. The lobby listens until the race takes over. */
  link: RaceLink;
  error: string | null;
  onError: (message: string | null) => void;
}

export default function OnlineLobby({ room, garage, circuitIndex, onCircuit, onLeave, onStart, link, error, onError }: Props) {
  const [welcome, setWelcome] = useState<WelcomeMsg | null>(null);
  /** The host's own copy of the grid (guests read the host's out of `lobby`). */
  const [grid, setGrid] = useState<Seat[] | null>(null);
  const [lobbySeats, setLobbySeats] = useState<Seat[] | null>(null);
  const [lobbySettings, setLobbySettings] = useState<RaceSettings | null>(null);
  const [copied, setCopied] = useState(false);

  const isHost = welcome ? welcome.hostId === room.playerId : room.isCreator;
  const seats = (isHost ? grid ?? welcome?.seats : lobbySeats ?? welcome?.seats) ?? [];
  const settings: RaceSettings = isHost ? { circuit: circuitIndex } : lobbySettings ?? welcome?.settings ?? { circuit: circuitIndex };
  const circuit = isHost ? circuitIndex : circuitIndexOf(settings);
  const gp = CALENDAR[circuit] ?? CALENDAR[0];
  const localSeat = seatOfPlayer(seats, room.playerId) ?? 0;
  const roster = seats.length ? rosterOf(seats, localSeat) : [];
  const blocked = canStart(seats) ? null : startBlockedReason(seats);
  const amReady = seats.find((s) => s.playerId === room.playerId)?.ready === true;

  // Garages and ready flags the host has been told about. Refs, not state: they
  // are read when the next grid is built, and the grid itself is what renders.
  const filed = useRef(new Map<string, SeatGarage>());
  const readies = useRef(new Map<string, boolean>());
  // Everything the message handler needs, without re-subscribing on every render.
  const latest = useRef({ welcome, grid, lobbySeats, isHost, circuit: circuitIndex });
  latest.current = { welcome, grid, lobbySeats, isHost, circuit: circuitIndex };

  /** The host's grid: the room's seat table, dressed, with every garage filed. */
  const dress = useCallback((from: Seat[], seed: number): Seat[] => {
    let next = fileGarage(dressGrid(from, seed), room.playerId, garage);
    for (const [id, filed_] of filed.current) next = fileGarage(next, id, filed_);
    for (const [id, ready] of readies.current) next = setReady(next, id, ready);
    return next;
  }, [garage, room.playerId]);

  /** Host only: keep the grid and tell everybody what it looks like. */
  const publish = useCallback((next: Seat[], circuitId: number) => {
    setGrid(next);
    link.send({ type: 'lobby', seats: next, settings: { circuit: circuitId } });
  }, [link]);

  const handle = useCallback((msg: RaceProtocol) => {
    switch (msg.type) {
      case 'welcome': {
        const mine = msg.hostId === room.playerId;
        setWelcome(msg);
        if (mine) publish(dress(msg.seats, msg.seed), latest.current.circuit);
        // My garage reaches the host in the only frame a guest owns. There is
        // no ack: the host files it and the next `lobby` shows it.
        else link.send({ type: 'ready', ready: false, garage });
        return;
      }
      case 'lobby': {
        setLobbySeats(msg.seats);
        if (msg.settings) setLobbySettings(msg.settings);
        return;
      }
      case 'ready': {
        // Guests' ready flags and garages: the host files both, then republishes.
        if (!latest.current.isHost || !msg.from) return;
        if (msg.garage) filed.current.set(msg.from, msg.garage);
        readies.current.set(msg.from, msg.ready);
        const base = latest.current.welcome;
        if (base) publish(dress(base.seats, base.seed), latest.current.circuit);
        return;
      }
      case 'start': {
        const base = latest.current.welcome;
        if (!base) return;
        const grid_ = latest.current.isHost
          ? latest.current.grid ?? base.seats
          : latest.current.lobbySeats ?? base.seats;
        onStart({
          seed: base.seed,
          seats: grid_,
          settings: latest.current.isHost ? { circuit: latest.current.circuit } : lobbySettings ?? base.settings,
          localSeat: seatOfPlayer(grid_, room.playerId) ?? 0,
          isHost: latest.current.isHost,
          countdownAt: msg.countdownAt,
        });
        return;
      }
      case 'reject':
        // Room full, race already under way, host gone — the room's own voice,
        // and it names the reason.
        onError(msg.reason);
        return;
      default:
        return;
    }
  }, [dress, garage, link, lobbySettings, onError, onStart, publish, room.playerId]);

  const handleLeft = useCallback((playerId: string) => {
    // The host walking out of a lobby is the end of the lobby: no host, no
    // truth, and this room does not migrate the host (MP-08's business).
    if (latest.current.welcome && playerId === latest.current.welcome.hostId && !latest.current.isHost) {
      onError('The host left the lobby.');
      onLeave();
    }
  }, [onError, onLeave]);

  // The room is subscribed once, in App. This screen raises its hand.
  useEffect(() => {
    link.onMessage = handle;
    link.onPlayerLeft = handleLeft;
    return () => {
      if (link.onMessage === handle) link.onMessage = null;
      if (link.onPlayerLeft === handleLeft) link.onPlayerLeft = null;
    };
  }, [link, handle, handleLeft]);

  const hostStart = () => {
    if (!latest.current.welcome || blocked) return;
    // Far enough out that both ends can build a ten-marble world before the
    // gate opens on the instant everybody was just told about.
    const countdownAt = Date.now() + START_ARM_MS;
    link.send({ type: 'start', countdownAt: Math.round(countdownAt) });
    // The room echoes `start` to everyone, this screen included — but it is
    // 100 ms away, and the host's own world has to exist first.
    handle({ type: 'start', countdownAt });
  };

  const toggleReady = () => {
    const next = !amReady;
    if (isHost) {
      // The host files its own flag — there is nobody to ask.
      readies.current.set(room.playerId, next);
      const base = latest.current.welcome;
      if (base) publish(dress(base.seats, base.seed), latest.current.circuit);
      return;
    }
    link.send({ type: 'ready', ready: next });
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.roomCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // No clipboard (a sandboxed frame): the code is on screen and selectable.
      onError('Copy is blocked here — select the code instead.');
    }
  };

  return <div className="app-shell lobby-page fit-shell">
    <header className="app-header">
      <Brand />
      <div className="lobby-code-block">
        <span className="eyebrow">{isHost ? 'YOUR ROOM CODE' : 'ROOM CODE'}</span>
        <div className="lobby-code">
          <b>{room.roomCode || '······'}</b>
          <button className="icon-button" onClick={() => void copyCode()} aria-label="Copy the room code">
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
      </div>
      <div className="header-tools">
        <span className="eyebrow">{isHost ? 'HOSTING' : 'JOINED'} <span className="muted">/ {seats.filter((s) => !s.isAI).length} DRIVERS</span></span>
        <button className="text-button" onClick={onLeave}>Leave <ArrowUpRight size={15} /></button>
      </div>
    </header>

    <main className="fit-main lobby-fit">
      <section className="fit-pane lobby-circuit" aria-labelledby="lobby-circuit-title">
        <div className="section-topline">
          <span className="eyebrow"><b>01</b> THE CIRCUIT</span>
          <span className="muted">{isHost ? 'You pick' : `Picked by ${welcome?.seats.find((s) => s.playerId === welcome.hostId)?.name ?? 'the host'}`}</span>
        </div>
        <div>
          <h2 id="lobby-circuit-title">{gp.name.toUpperCase()}</h2>
          <span className="muted">{gp.flag} {gp.location}</span>
          <p className="lobby-circuit-desc">{gp.desc}</p>
        </div>
        <div className="circuit-selector" aria-label="Select a circuit">
          {CALENDAR.map((item, i) => <button
            key={item.id}
            className={i === circuit ? 'selected' : ''}
            aria-pressed={i === circuit}
            disabled={!isHost}
            onClick={() => { if (!isHost) return; onCircuit(i); publish(latest.current.grid ?? seats, i); }}
          ><span>{String(i + 1).padStart(2, '0')}</span><strong>{item.short}</strong></button>)}
        </div>
        <p className="lobby-note">
          {isHost
            ? 'Everybody races the circuit you pick, on the track the room seeded. Two drivers minimum, six at most.'
            : 'The host picks the circuit. You race the same seed, so you are looking at the same track.'}
        </p>
      </section>

      <section className="fit-pane lobby-grid-pane" aria-labelledby="lobby-grid-title">
        <div className="section-topline">
          <div className="eyebrow" id="lobby-grid-title"><b>02</b> THE GRID <span className="muted">/ 10 GOBLINS</span></div>
        </div>
        {seats.length === 0
          ? <p className="lobby-note">Waiting for the room…</p>
          : <LobbyGrid
            seats={seats}
            roster={roster}
            myPlayerId={room.playerId}
            isHost={isHost}
            onKick={(playerId) => link.send({ type: 'kick', playerId })}
          />}
      </section>
    </main>

    <footer className="fit-actions">
      <p>{error ?? blocked ?? (isHost ? 'Everybody is ready — drop the lights.' : 'Ready when you are. The race starts the moment your host drops the lights.')}</p>
      <button className="button-secondary" onClick={toggleReady} aria-pressed={amReady} disabled={!seats.length}>
        {amReady ? 'Not ready' : 'Ready'} <Check size={16} />
      </button>
      {isHost && <button className="button-primary launch-button" disabled={!!blocked || seats.length === 0} onClick={hostStart}>
        Start the race <ArrowRight size={19} />
      </button>}
    </footer>
  </div>;
}
