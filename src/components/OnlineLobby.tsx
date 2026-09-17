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
  MIN_HUMANS_TO_START,
  rosterOf,
  seatOfPlayer,
  seededCircuit,
  setReady,
  startBlockedReason,
} from '../net/lobby';
import { START_ARM_MS } from '../net/session';
import type { PeerPresence } from '../net/presence';
import type { RaceLink } from '../net/session';
import type { RaceProtocol, RaceSettings, Seat, SeatGarage, WelcomeMsg } from '../net/protocol';
import { CALENDAR } from '../game/season';
import { loadTracksSync } from '../game/tracks';
import TrackThumbnail from './editor/TrackThumbnail';
import { encodeShareCode } from '../game/sharecode';
import LobbyGrid from './LobbyGrid';
import ItemGlyph from './ItemGlyph';
import { ITEM_INFO, ITEM_TYPES } from '../game/types';
import type { ItemType } from '../game/types';
import { UNLIMITED_ITEM } from '../net/protocol';
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
  /**
   * MP-07: a QUICK RACE — nobody typed a code, so nobody has to press Start.
   * Every driver is ready the moment they sit down, the host picks the circuit
   * from the room's seed, and the lights go out on a timer: twenty seconds once
   * two drivers are in, immediately once the grid is six deep.
   */
  autoStart?: boolean;
  /** MP-08: drivers the room is holding a seat for. */
  peers?: readonly PeerPresence[];
  /**
   * MP-09: the room's last greeting, remembered by App across a race so that
   * "Race again" can put the same drivers back in the same lobby. A room only
   * says hello on a join — it has no way to re-greet a screen that left for a
   * race and came back.
   */
  greeting?: WelcomeMsg | null;
  error: string | null;
  onError: (message: string | null) => void;
}

/**
 * How long a quick race waits with two or more drivers before it drops the
 * lights. Long enough for a third and fourth to arrive, short enough that
 * "quick" is not a lie.
 */
export const AUTO_START_MS = 20_000;
/** Six humans and there is nobody left to wait for. */
export const AUTO_START_FULL_GRID = 6;

/** Charges a host can set per power-up: none, a few, or unlimited. */
const HOUSE_STEPS = [0, 1, 2, 3, 5, UNLIMITED_ITEM];

export default function OnlineLobby({ room, garage, circuitIndex, onCircuit, onLeave, onStart, link, autoStart = false, peers, greeting = null, error, onError }: Props) {
  const [welcome, setWelcome] = useState<WelcomeMsg | null>(greeting);
  /** The host's own copy of the grid (guests read the host's out of `lobby`). */
  const [grid, setGrid] = useState<Seat[] | null>(null);
  const [lobbySeats, setLobbySeats] = useState<Seat[] | null>(null);
  const [lobbySettings, setLobbySettings] = useState<RaceSettings | null>(null);
  const [copied, setCopied] = useState(false);
  /** Host only: house rules for power-ups (null = everyone brings their own kit). */
  const [items, setItems] = useState<Partial<Record<ItemType, number>> | null>(null);
  // MB-08: custom track picking for the host — share-code in settings.customCode
  const myTracks = loadTracksSync();
  const [circuitTab, setCircuitTab] = useState<'calendar' | 'custom'>('calendar');
  const [customCode, setCustomCode] = useState<string | null>(null);
  const [customName, setCustomName] = useState<string | null>(null);
  /** MP-07: when a quick race's lights go out (wall clock ms), once armed. */
  const [autoAt, setAutoAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);

  const isHost = welcome ? welcome.hostId === room.playerId : room.isCreator;
  const seats = (isHost ? grid ?? welcome?.seats : lobbySeats ?? welcome?.seats) ?? [];
  const settings: RaceSettings = isHost ? { circuit: circuitIndex, ...(items ? { items } : {}) } : lobbySettings ?? welcome?.settings ?? { circuit: circuitIndex };
  const circuit = isHost ? circuitIndex : circuitIndexOf(settings);
  const gp = CALENDAR[circuit] ?? CALENDAR[0];
  const localSeat = seatOfPlayer(seats, room.playerId) ?? 0;
  const roster = seats.length ? rosterOf(seats, localSeat) : [];
  const blocked = canStart(seats) ? null : startBlockedReason(seats);
  const amReady = seats.find((s) => s.playerId === room.playerId)?.ready === true;

  /**
   * MP-08: joining a race that is ALREADY RUNNING.
   *
   * A page that comes back (a refresh, a reconnect) lands in the lobby, because
   * that is where a room's welcome puts everybody — but the host's 20 Hz stream
   * arriving at a lobby can only mean the lights are already out, and there is
   * no Start left to wait for.
   *
   * Two things must be true before it can join: the race must be running (a
   * `state` frame), and the host must have said what the grid looks like (a
   * `lobby` frame) — the room's own welcome is only a seating plan, and a driver
   * deserves to see the liveries it is racing, not placeholders.
   */
  const live = useRef(false);
  const joined = useRef(false);
  /** MP-09: this lobby has announced itself once (see the effect below). */
  const announced = useRef(false);
  const joinLive = useCallback((known: Seat[] | null) => {
    const base = latest.current.welcome;
    if (joined.current || !live.current || !base) return;
    const grid_ = known ?? latest.current.lobbySeats;
    if (!grid_) return; // the host has not described the grid yet — wait for it
    if (latest.current.isHost) {
      // The host IS the simulation, and a refreshed page has no world to carry
      // on with. Better an honest exit than a race that has stopped moving.
      onError('That race is under way — a host cannot rejoin mid-race.');
      onLeave();
      return;
    }
    joined.current = true;
    onStart({
      seed: base.seed,
      seats: grid_,
      settings: lobbySettings ?? base.settings,
      localSeat: seatOfPlayer(grid_, room.playerId) ?? 0,
      isHost: false,
      // The lights are out and have been: build the world and get in.
      countdownAt: Date.now(),
    });
  }, [lobbySettings, onError, onLeave, onStart, room.playerId]);

  // Garages and ready flags the host has been told about. Refs, not state: they
  // are read when the next grid is built, and the grid itself is what renders.
  const filed = useRef(new Map<string, SeatGarage>());
  const readies = useRef(new Map<string, boolean>());
  // Everything the message handler needs, without re-subscribing on every render.
  const latest = useRef({ welcome, grid, lobbySeats, isHost, circuit: circuitIndex, items });
  latest.current = { welcome, grid, lobbySeats, isHost, circuit: circuitIndex, items };
  /** The host's full rules for a circuit: the circuit plus any power-up house rules. */
  const hostSettings = (circuitId: number): RaceSettings => {
    const rules = latest.current.items;
    const base: RaceSettings = { circuit: circuitId, ...(rules ? { items: rules } : {}) };
    if (customCode) (base as unknown as { customCode: string }).customCode = customCode;
    return base;
  };

  /** The host's grid: the room's seat table, dressed, with every garage filed. */
  const dress = useCallback((from: Seat[], seed: number): Seat[] => {
    let next = fileGarage(dressGrid(from, seed), room.playerId, garage);
    for (const [id, filed_] of filed.current) next = fileGarage(next, id, filed_);
    for (const [id, ready] of readies.current) next = setReady(next, id, ready);
    if (!autoStart) return next;
    // A quick race has no Ready button: you asked to race, so you are ready.
    for (const seat of next) if (!seat.isAI) next = setReady(next, seat.playerId, true);
    return next;
  }, [autoStart, garage, room.playerId]);

  /** Power-up rules as everyone currently sees them. */
  const rules = settings.items ?? null;
  /** Host only: change the house rules and republish the lobby straight away. */
  const changeItems = (next: Partial<Record<ItemType, number>> | null) => {
    if (!isHost) return;
    setItems(next);
    latest.current.items = next;
    publish(latest.current.grid ?? seats, circuitIndex);
  };

  /** Host only: keep the grid and tell everybody what it looks like. */
  const publish = useCallback((next: Seat[], circuitId: number) => {
    setGrid(next);
    link.send({ type: 'lobby', seats: next, settings: hostSettings(circuitId) });
  }, [link]);

  /** Host picks a custom track — encode to share code (5 KB, fits frame) and publish. */
  const pickCustomTrack = async (trackId: string | null) => {
    if (!isHost) return;
    if (!trackId) {
      setCustomCode(null);
      setCustomName(null);
      setCircuitTab('calendar');
      publish(latest.current.grid ?? seats, circuitIndex);
      return;
    }
    const track = myTracks.find((t) => t.id === trackId);
    if (!track) return;
    try {
      const code = await encodeShareCode(track.def);
      setCustomCode(code);
      setCustomName(track.def.name);
      setCircuitTab('custom');
      // Publish with the new code — circuitId is kept for HUD title fallback
      const settings: RaceSettings = { circuit: circuitIndex, ...(latest.current.items ? { items: latest.current.items } : {}), customCode: code } as RaceSettings;
      setGrid((prev) => prev ?? seats);
      link.send({ type: 'lobby', seats: latest.current.grid ?? seats, settings });
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not share that track.');
    }
  };

  const handle = useCallback((msg: RaceProtocol) => {
    switch (msg.type) {
      case 'welcome': {
        const mine = msg.hostId === room.playerId;
        setWelcome(msg);
        if (mine) {
          // A quick race's circuit is the room's, chosen by its seed: nobody
          // typed a code, so nobody picked a track by hand.
          const circuit = autoStart ? seededCircuit(msg.seed, CALENDAR.length) : latest.current.circuit;
          if (autoStart && circuit !== latest.current.circuit) onCircuit(circuit);
          publish(dress(msg.seats, msg.seed), circuit);
        }
        // My garage reaches the host in the only frame a guest owns. There is
        // no ack: the host files it and the next `lobby` shows it.
        else link.send({ type: 'ready', ready: false, garage });
        return;
      }
      case 'lobby': {
        setLobbySeats(msg.seats);
        if (msg.settings) {
          setLobbySettings(msg.settings);
          const code = (msg.settings as unknown as { customCode?: string })?.customCode;
          if (typeof code === 'string') {
            setCustomCode(code);
            // Try to resolve name from local tracks (host's own list) for display
              setCircuitTab('custom');
          } else if (!isHost) {
            setCustomCode(null);
            setCustomName(null);
          }
        }
        // The host answers a re-greeting with the grid (MP-08) — which is the
        // last thing a returning driver was waiting for.
        joinLive(msg.seats);
        return;
      }
      case 'state':
        // A race is already running, and this screen is in a lobby. See
        // `joinLive`: the stream is the evidence, the grid is the permission.
        live.current = true;
        joinLive(null);
        return;
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
          settings: latest.current.isHost ? hostSettings(latest.current.circuit) : lobbySettings ?? base.settings,
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
  }, [autoStart, dress, garage, joinLive, link, lobbySettings, onCircuit, onError, onStart, publish, room.playerId]);

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

  /**
   * MP-09: coming BACK from a race. The room has not said anything — nobody
   * joined, nobody left — so the seat table this screen already had is the one
   * it reuses, and it re-announces itself: the host republishes the grid (it may
   * have picked another circuit), a guest re-files its garage.
   */
  useEffect(() => {
    if (announced.current) return;
    announced.current = true;
    // Always ask the room where we are sitting: coming back from a race, or into
    // a room we were already in, there is no join to greet us.
    link.send({ type: 'hello' });
    if (!greeting) return;
    if (greeting.hostId === room.playerId) publish(dress(greeting.seats, greeting.seed), latest.current.circuit);
    else link.send({ type: 'ready', ready: false, garage });
    // One announcement, on the way in — the frames below are the room's to send.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // MP-07: the quick race's own clock. Two drivers and the lights are armed;
  // a sixth driver and there is nobody left to wait for.
  const hostStartRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!autoStart || !isHost) return;
    const humans = seats.filter((s) => !s.isAI).length;
    if (humans >= AUTO_START_FULL_GRID) {
      hostStartRef.current();
      return;
    }
    if (humans < MIN_HUMANS_TO_START) {
      setAutoAt(null);
      return;
    }
    // Arm once: a driver joining later must not push the lights out again.
    setAutoAt((at) => at ?? Date.now() + AUTO_START_MS);
  }, [autoStart, isHost, seats]);

  useEffect(() => {
    if (autoAt === null) return;
    const tick = () => {
      const left = autoAt - Date.now();
      if (left <= 0) hostStartRef.current();
      else setRemaining(Math.ceil(left / 1000));
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [autoAt]);

  // One Start, however many ways there are to fire it: a button, a full grid,
  // a countdown that ran out — and a second `start` would move the lights on a
  // screen that had already counted to the first.
  const starting = useRef(false);
  const hostStart = () => {
    if (starting.current) return;
    if (!latest.current.welcome || blocked) return;
    starting.current = true;
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

  hostStartRef.current = hostStart;

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

  // MP-07: a quick race counts itself down, and says so.
  const quickNote = autoStart
    ? isHost
      ? autoAt === null
        ? 'Waiting for another driver — the lights go out the moment somebody joins you.'
        : `Race starts in ${remaining}s — the grid keeps filling until then.`
      : 'Quick race: the lights go out by themselves once the grid is set.'
    : null;

  return <div className="app-shell lobby-page fit-shell">
    <header className="app-header">
      <Brand />
      <div className="header-tools">
        <span className="eyebrow">{autoStart ? 'QUICK RACE' : isHost ? 'HOSTING' : 'JOINED'} <span className="muted">/ {seats.filter((s) => !s.isAI).length} DRIVERS</span></span>
        <button className="text-button" onClick={onLeave}>Leave <ArrowUpRight size={15} /></button>
      </div>
    </header>

    <main className="fit-main lobby-fit">
      {/* The room code, big and first: HexMatch's lobby pattern, sized to be read across a room. */}
      <section className="lobby-code-card" aria-labelledby="lobby-code-title">
        <span className="eyebrow">{isHost ? 'YOUR ROOM CODE' : 'ROOM CODE'}{autoStart ? ' · QUICK RACE' : ''}</span>
        <h2 id="lobby-code-title">{isHost && !autoStart ? 'Invite your rivals' : 'You are in'}</h2>
        <div className="lobby-code">
          <b aria-label={`Room code ${(room.roomCode || '').split('').join(' ')}`}>{room.roomCode || '······'}</b>
          <button className="button-secondary" onClick={() => void copyCode()} aria-label="Copy the room code">
            {copied ? <><Check size={16} />Copied</> : <><Copy size={16} />Copy</>}
          </button>
        </div>
        <p className="lobby-code-note">{isHost && !autoStart
          ? 'Share this code. Friends press Online → Join with code.'
          : 'Friends can still join with this code until the race starts.'}</p>
      </section>
      <section className="fit-pane lobby-circuit" aria-labelledby="lobby-circuit-title">
        <div className="section-topline">
          <span className="eyebrow"><b>01</b> THE CIRCUIT</span>
          <span className="muted">{isHost ? 'You pick' : `Picked by ${welcome?.seats.find((s) => s.playerId === welcome.hostId)?.name ?? 'the host'}`}</span>
        </div>
        {isHost && (
          <div className="circuit-tabs" role="tablist" aria-label="Circuit source">
            <button role="tab" aria-selected={circuitTab === 'calendar'} className={circuitTab === 'calendar' ? 'selected' : ''} onClick={() => { setCircuitTab('calendar'); setCustomCode(null); setCustomName(null); publish(latest.current.grid ?? seats, circuitIndex); }}>Calendar</button>
            <button role="tab" aria-selected={circuitTab === 'custom'} className={circuitTab === 'custom' ? 'selected' : ''} onClick={() => setCircuitTab('custom')}>My tracks{myTracks.length ? ` (${myTracks.length})` : ''}</button>
          </div>
        )}
        {customCode ? (
          <div>
            <h2 id="lobby-circuit-title">{(customName ?? 'CUSTOM CIRCUIT').toUpperCase()}</h2>
            <span className="muted">CUSTOM • Host's track • {customCode.slice(0, 8)}…</span>
            <p className="lobby-circuit-desc">A player-built circuit. Payout reduced to 30 % (18 % online) to keep farming in check. Everyone races the same custom layout.</p>
            {isHost && <button className="text-button" onClick={() => { setCustomCode(null); setCustomName(null); setCircuitTab('calendar'); publish(latest.current.grid ?? seats, circuitIndex); }}>Back to Calendar</button>}
          </div>
        ) : (
          <div>
            <h2 id="lobby-circuit-title">{gp.name.toUpperCase()}</h2>
            <span className="muted">{gp.flag} {gp.location}</span>
            <p className="lobby-circuit-desc">{gp.desc}</p>
          </div>
        )}
        {circuitTab === 'calendar' || !isHost ? (
          <div className="circuit-selector" aria-label="Select a circuit">
            {CALENDAR.map((item, i) => <button
              key={item.id}
              className={i === circuit && !customCode ? 'selected' : ''}
              aria-pressed={i === circuit && !customCode}
              disabled={!isHost}
              onClick={() => { if (!isHost) return; setCustomCode(null); setCustomName(null); onCircuit(i); publish(latest.current.grid ?? seats, i); }}
            ><span>{String(i + 1).padStart(2, '0')}</span><strong>{item.short}</strong></button>)}
          </div>
        ) : (
          <div className="my-tracks-list lobby-custom-list" aria-label="My tracks">
            {myTracks.length === 0 ? (
              <p className="lobby-note">You have no saved tracks — build one in Workshop, then pick it here.</p>
            ) : (
              myTracks.map((t) => (
                <button
                  key={t.id}
                  className={`my-track-row ${customName === t.def.name && customCode ? 'selected' : ''}`}
                  onClick={() => void pickCustomTrack(t.id)}
                  disabled={!isHost}
                >
                  <TrackThumbnail def={t.def} />
                  <span className="my-track-meta">
                    <strong>{t.def.name}</strong>
                    <span className="muted">{t.def.pieces.length} pcs • {t.def.height}px</span>
                  </span>
                  <span className="my-track-check" aria-hidden>{customName === t.def.name && customCode ? '●' : ''}</span>
                </button>
              ))
            )}
          </div>
        )}
        <p className="lobby-note">
          {customCode
            ? 'Custom circuit: everyone races the host’s layout. Payout reduced (see results). Two drivers minimum, six at most.'
            : isHost
              ? 'Everybody races the circuit you pick, on the track the room seeded. Two drivers minimum, six at most.'
              : 'The host picks the circuit. You race the same seed, so you are looking at the same track.'}
        </p>
      </section>

      <section className="fit-pane lobby-powerups" aria-labelledby="lobby-powerups-title">
        <div className="section-topline">
          <span className="eyebrow" id="lobby-powerups-title"><b>03</b> POWER-UPS</span>
          <span className="muted">{isHost ? 'You set' : 'Set by the host'}</span>
        </div>
        <div className="mode-switch lobby-powerup-mode" role="group" aria-label="Power-up rules">
          <button className={!rules ? 'selected' : ''} aria-pressed={!rules} disabled={!isHost} onClick={() => changeItems(null)}>Own kits</button>
          <button className={rules ? 'selected' : ''} aria-pressed={!!rules} disabled={!isHost} onClick={() => changeItems(rules ?? Object.fromEntries(ITEM_TYPES.map((item) => [item, 1])))}>House rules</button>
        </div>
        {rules
          ? <ul className="lobby-powerup-list">{ITEM_TYPES.map((item) => {
            const count = rules[item] ?? 0;
            return <li key={item} style={{ '--item-color': ITEM_INFO[item].color } as React.CSSProperties}>
              <span className="lobby-powerup-name"><ItemGlyph item={item} size={18} />{ITEM_INFO[item].name}</span>
              <span className="lobby-powerup-steps" role="group" aria-label={`${ITEM_INFO[item].name} charges`}>
                {HOUSE_STEPS.map((step) => <button
                  key={step}
                  className={step === count ? 'selected' : ''}
                  aria-pressed={step === count}
                  disabled={!isHost}
                  onClick={() => changeItems({ ...rules, [item]: step })}
                >{step === UNLIMITED_ITEM ? '∞' : step}</button>)}
              </span>
            </li>;
          })}</ul>
          : <p className="lobby-note">Everybody races the power-ups they bought or picked up, and spends them for real.</p>}
        {rules && <p className="lobby-note">Every driver starts with these, AI included. House-rule charges never touch anyone's own kit.</p>}
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
            peers={peers}
          />}
      </section>
    </main>

    <footer className="fit-actions">
      <p>{error ?? quickNote ?? blocked ?? (isHost ? 'Everybody is ready — drop the lights.' : 'Ready when you are. The race starts the moment your host drops the lights.')}</p>
      {!autoStart && <button className="button-secondary" onClick={toggleReady} aria-pressed={amReady} disabled={!seats.length}>
        {amReady ? 'Not ready' : 'Ready'} <Check size={16} />
      </button>}
      {isHost && <button className="button-primary launch-button" disabled={!!blocked || seats.length === 0} onClick={hostStart}>
        Start the race <ArrowRight size={19} />
      </button>}
    </footer>
  </div>;
}
