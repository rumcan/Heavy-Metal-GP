// ══════════════════════════════════════════════════════════════════════════
// MP-03 — the race room: a THIN VALIDATING RELAY (RUN.world GameRoom).
//
// Host authority, thin relay (epic #11): the host browser runs the full
// Matter.js `Game`, guests render and send intents. This room owns exactly
// four things and simulates nothing:
//
//   1. THE SEED — minted in `onCreate`, once, from the room's own id. Every
//      client regenerates the identical circuit from `seed` + the profile, and
//      that is what makes a body index meaningful on both sides.
//   2. THE HOST IDENTITY — the first joiner. Host-only messages
//      (`state`, `events`, `snapshot`, `lobby`, `start`, `results`) are
//      relayed ONLY when `sender.id === hostId`; a guest-forged frame is
//      DROPPED silently — no broadcast, no error a bad client could probe.
//   3. THE SEAT TABLE — player → grid slot (0..9). The room owns it because it
//      is the only party that sees every join and leave; the host decides what
//      fills the rest of the grid (AI), and says so in `lobby`.
//   4. PRESENCE — the platform flips `player.connected` when a socket drops
//      and holds the seat for `reconnectTimeout`, but it tells the room
//      nothing. So the room polls once a second and speaks the two
//      transitions as `peerStatus`, re-greeting a returner with a welcome
//      (a reloaded page is a brand-new client that has never seen the seed).
//
// Routing, in one table:
//
//   intent / resync / ready   guest  → HOST ONLY  (sendTo hostId, stamped `from`)
//   kick                      host   → SERVER     (the room evicts the player)
//   state / events / snapshot host   → EVERYONE   (broadcast)
//   lobby / start / results   host   → EVERYONE   (broadcast)
//   welcome / reject / peerStatus    server-only: a client sending one is ignored
//   anything else, or anything that fails `validateMessage`  → dropped
//
// Two rules this file must keep:
//   - Import the SDK's `mp-server` surface ONLY. This module runs on the room
//     server, never in the browser, so it must never reach `…/mp-client`,
//     `…/api` or `src/net/transport.ts` (that would drag the client bundle into
//     the room and the room into the page). `src/net/protocol.ts` is the one
//     shared import both sides are allowed: it is pure.
//   - Never generate anything here with `Math.random()`: the seed every client
//     regenerates its circuit from is minted once, by the room, from a seeded
//     RNG (see `roomSeed`).
//
// Registered in `rundot/realtime.config.json` (`hmgp-race`, `maxPlayers: 6`).
// ══════════════════════════════════════════════════════════════════════════
import { GameRoom } from '@series-inc/rundot-game-sdk/mp-server';
import type { GameMessage, LeaveReason, Player } from '@series-inc/rundot-game-sdk/mp-server';
import {
  HOST_LEFT_REASON,
  MARBLE_COUNT,
  PROTOCOL_VERSION,
  defaultRaceSettings,
  validateMessage,
  type LobbyMsg,
  type RaceProtocol,
  type Seat,
  type WelcomeMsg,
} from '../net/protocol';
import { AI_COLORS, AI_NAMES, PLAYER_COLORS } from '../game/types';
import type { MarbleStats } from '../game/types';

export type RoomProtocol = RaceProtocol;

/** Sent when the host is gone — no host, no truth. Lives in the protocol so
 *  the client can recognise it without importing the server module. */
export { HOST_LEFT_REASON };

/** Sent to a player who tries to join a race that is already running. */
export const RACE_IN_PROGRESS_REASON = 'This race is already under way.';

/** Sent to the seventh human: the grid seats six of you, AI fills the rest. */
export const ROOM_FULL_REASON = 'This race is full — six drivers, no more.';

/** The reason a kicked player's `onPlayerLeave` carries (MP-06). */
export const KICKED_REASON = 'The host took you off the grid.';

/**
 * Human seats on the grid. The room's `maxPlayers` is the platform's number;
 * this is the room's own, and it is the one the seat table is sized against —
 * the SDK's `handleJoin` enforces nothing on its own, so without this check a
 * seventh joiner would arrive with nowhere to sit.
 */
export const MAX_HUMAN_SEATS = 6;

/** The placeholder grid entry: a seat the room has given nobody yet. */
const PLACEHOLDER_STATS: MarbleStats = { weight: 5, speed: 5, bounce: 5 };

/** How often the room looks at its members' `connected` flags (#164). */
export const PRESENCE_POLL_MS = 1_000;

/** The clock handle the presence poll runs under (named, so it is clearable). */
export const PRESENCE_TIMER = 'presence-poll';

/** Assumed reconnect window when the config says nothing, in ms. */
export const DEFAULT_RECONNECT_GRACE_MS = 60_000;

/**
 * The seed, minted from the room's own id.
 *
 * Deterministic on purpose: `Math.random()` here would be the one place in the
 * race the client could not reproduce, and a room that restarted (a crash, a
 * restore) would hand the surviving players a different circuit from the one
 * they are racing. FNV-1a over `roomId` is stable, cheap, and needs no state.
 */
export function roomSeed(roomId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < roomId.length; i++) {
    hash ^= roomId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export default class RaceRoom extends GameRoom<RoomProtocol> {
  private seed = 0;
  private hostId: string | null = null;
  /** player id → grid slot. Kept across rejoins: the same id sits down again. */
  private readonly seats = new Map<string, number>();
  /** The last `connected` value the presence poll saw, per member (#164). */
  private readonly presence = new Map<string, boolean>();
  /** True from the host's `start` until the room forgets the race. */
  private raceLive = false;

  onCreate() {
    this.seed = roomSeed(this.roomId);
    this.log.info('Race room created', { roomId: this.roomId, seed: this.seed });
  }

  onPlayerJoin(player: Player) {
    // A race in progress has no seat to offer: the grid is set, the marbles
    // are rolling, and a newcomer would arrive mid-heat with nowhere to go.
    // `reject` throws — everything below is skipped.
    if (this.raceLive) this.reject({ reason: RACE_IN_PROGRESS_REASON });
    if (!this.seats.has(player.id) && this.seats.size >= this.maxHumans()) {
      this.reject({ reason: ROOM_FULL_REASON });
    }
    // First joiner is the host; a newcomer to a hostless room takes over (the
    // host migration this ticket deliberately does not do, but a lobby whose
    // host walked out is a lobby worth salvaging).
    const hostId = this.hostId ?? player.id;
    this.hostId = hostId;
    if (!this.seats.has(player.id)) this.seats.set(player.id, this.firstFreeSeat());
    this.presence.set(player.id, player.connected !== false);
    if (!this.clock.has(PRESENCE_TIMER)) {
      this.clock.setInterval(PRESENCE_TIMER, () => this.pollPresence(), PRESENCE_POLL_MS);
    }
    this.log.info('Player joined', { playerId: player.id, slot: this.seats.get(player.id), hostId });
    // A broadcast inside `onPlayerJoin` only reaches ALREADY-connected members:
    // the newcomer's socket registers after the hook runs. So the newcomer gets
    // the welcome targeted, and everyone else learns the new seat table from the
    // broadcast. Nobody gets it twice.
    const greeting = this.welcome(hostId);
    this.broadcast(greeting);
    this.sendTo(player.id, greeting);
    // Six humans and the room is full — the rest of the grid is AI, and the
    // host says so in `lobby`.
    if (this.seats.size >= this.maxHumans()) this.lock();
  }

  onGameMessage(msg: GameMessage<RoomProtocol>) {
    const p = msg.payload;
    // The wire's own door (MP-02) runs here, on the relayed frame, so a frame
    // that would be refused at the far end never costs the room a broadcast.
    const err = validateMessage(p);
    if (err) {
      this.log.warn('Dropped a frame the protocol refuses', { code: err.code, message: err.message, from: msg.sender.id });
      return;
    }
    switch (p.type) {
      // guest → HOST ONLY. The host applies its own nudges locally, so a host
      // intent would be a self-echo — forwarded only when the sender is a guest.
      //
      // The relay STAMPS the sender on the way through (`from`): the SDK hands
      // a client the payload alone, so without it the host could not tell which
      // seat a nudge or a garage belongs to. A client-sent `from` is overwritten
      // rather than trusted — see `RelayedFrame` in the protocol.
      case 'intent':
      case 'resync':
      case 'ready': {
        if (this.hostId !== null && msg.sender.id !== this.hostId) {
          this.sendTo(this.hostId, { ...p, from: msg.sender.id });
        }
        return;
      }
      // host → server. The host may take a driver off its grid, but only the
      // room can actually remove one: it owns the seat table, and a client that
      // could evict another client could empty a room. `onPlayerLeave` runs
      // with reason `kick`, which frees the seat and re-greets everyone.
      case 'kick': {
        if (msg.sender.id !== this.hostId) return;
        // Nobody may kick the host, and a player who is not here needs no
        // evicting — the SDK's own `kick` is not a no-op for either.
        if (p.playerId === this.hostId || !this.players.has(p.playerId)) return;
        this.kick(p.playerId, KICKED_REASON);
        return;
      }
      // HOST → everyone. `sender.id !== hostId` is the ONE piece of real
      // authority this relay keeps: a guest that publishes state is either
      // confused or cheating, and either way the answer is silence.
      case 'lobby':
      case 'state':
      case 'events':
      case 'snapshot':
      case 'results': {
        if (msg.sender.id !== this.hostId) return;
        this.broadcast(p);
        return;
      }
      case 'start': {
        if (msg.sender.id !== this.hostId) return;
        // The lights are out: no new joiners from here on. The room locks so a
        // seventh player with the code cannot walk into a running heat, and
        // `raceLive` is what `onPlayerJoin` refuses them with.
        this.raceLive = true;
        this.lock();
        this.broadcast(p);
        return;
      }
      // `welcome` / `reject` / `peerStatus` are the ROOM's own voice. A client
      // that sends one is speaking for the server: ignored, never relayed.
      default:
        return;
    }
  }

  onPlayerLeave(player: Player, reason: LeaveReason) {
    this.seats.delete(player.id);
    this.presence.delete(player.id);
    if (player.id === this.hostId) {
      // No host, no truth — and no host migration (out of scope). Mid-race that
      // is the end of the race for everyone, said out loud so nobody sits
      // watching a world that has stopped moving.
      this.hostId = null;
      if (this.raceLive) {
        this.log.info('Host left mid-race — ending the race', { playerId: player.id });
        this.broadcast({ type: 'reject', reason: HOST_LEFT_REASON });
      }
    }
    this.log.info('Player left', { playerId: player.id, reason });
    // A leave changes the grid, so everybody still in the room gets the new
    // seat table — that is how a lobby's grid shrinks when somebody walks out,
    // or when the host takes somebody off it (MP-06). Not mid-race: the grid is
    // set once the lights are out, and a runner who drops is handed to the AI
    // (MP-08) rather than re-seated. And not for a hostless room, which is a
    // lobby waiting for its next host.
    if (!this.raceLive && this.hostId !== null) this.broadcast(this.welcome(this.hostId));
    // A free seat is a free seat again — until the host says `start`.
    this.unlock();
    if (this.playerCount === 0 && this.clock.has(PRESENCE_TIMER)) this.clock.clear(PRESENCE_TIMER);
  }

  // ── presence (#164) ────────────────────────────────────────────────────

  /**
   * One look a second at the platform's own presence flags.
   *
   * The harness flips `player.connected` when a socket drops (and holds the
   * seat for `reconnectTimeout`) and flips it back on a re-attach, but it
   * calls no room hook for either. The room is the only party that can tell
   * BOTH seats, so it speaks the two transitions:
   *
   *   connected → disconnected   `peerStatus` with the hold window, so the
   *                              rest of the grid sees "reconnecting 0:29"
   *                              instead of a marble that stopped moving.
   *   disconnected → connected   `peerStatus` back, plus a fresh welcome: a
   *                              reloaded page is a new client that has never
   *                              seen the seed, and the host answers its
   *                              `resync` with full state.
   */
  private pollPresence(): void {
    for (const player of this.players.values()) {
      const connected = player.connected !== false;
      const before = this.presence.get(player.id);
      if (before === undefined || before === connected) {
        this.presence.set(player.id, connected);
        continue;
      }
      this.presence.set(player.id, connected);
      if (!connected) {
        this.log.info('Peer disconnected — seat held', { playerId: player.id });
        this.broadcast({
          type: 'peerStatus',
          playerId: player.id,
          status: 'disconnected',
          graceMs: this.reconnectGraceMs(),
          username: player.username,
        });
        continue;
      }
      this.log.info('Peer reconnected inside the window', { playerId: player.id });
      this.broadcast({ type: 'peerStatus', playerId: player.id, status: 'reconnected', username: player.username });
      // The re-greeting: targeted at the returner, broadcast for the rest.
      const greeting = this.welcome(this.hostId ?? player.id);
      this.broadcast(greeting);
      this.sendTo(player.id, greeting);
    }
    // Tidy: forget seats that are gone, and stop watching an empty room.
    for (const id of this.presence.keys()) if (!this.players.has(id)) this.presence.delete(id);
    if (this.playerCount === 0 && this.clock.has(PRESENCE_TIMER)) this.clock.clear(PRESENCE_TIMER);
  }

  /** The window the platform is holding a dropped seat for, in ms. */
  private reconnectGraceMs(): number {
    const seconds = this.config.reconnectTimeout;
    return typeof seconds === 'number' && seconds > 0 ? seconds * 1000 : DEFAULT_RECONNECT_GRACE_MS;
  }

  // ── the seat table ─────────────────────────────────────────────────────

  /** Humans the room will seat. The config's `maxPlayers`, bounded to the grid. */
  private maxHumans(): number {
    const configured = this.config.maxPlayers;
    const cap = typeof configured === 'number' && configured > 0 ? Math.floor(configured) : MAX_HUMAN_SEATS;
    return Math.min(cap, MAX_HUMAN_SEATS, MARBLE_COUNT);
  }

  /** The lowest free slot — a rejoining player keeps its old one. */
  private firstFreeSeat(): number {
    const taken = new Set(this.seats.values());
    for (let slot = 0; slot < MARBLE_COUNT; slot++) if (!taken.has(slot)) return slot;
    return MARBLE_COUNT - 1;
  }

  /**
   * The join greeting: seed, host, protocol version and the whole grid.
   *
   * Ten seats, always — the grid is a ten-marble grid and the packed frames are
   * addressed by slot. The room fills the seats it has given out and leaves the
   * rest as AI placeholders; the HOST is the party that knows the real grid
   * (liveries, stats, portraits, which seats are machines) and says so in
   * `lobby`, which this room relays to everyone. The welcome is the seating
   * plan; the lobby is the race.
   */
  private welcome(hostId: string): WelcomeMsg {
    const seated = new Map<number, Player>();
    for (const [id, slot] of this.seats) {
      const player = this.players.get(id);
      if (player) seated.set(slot, player);
    }
    const seats: Seat[] = [];
    for (let slot = 0; slot < MARBLE_COUNT; slot++) {
      const player = seated.get(slot);
      seats.push(
        player
          ? {
              slot,
              playerId: player.id,
              name: player.username,
              color: PLAYER_COLORS[slot % PLAYER_COLORS.length],
              stats: { ...PLACEHOLDER_STATS },
              portrait: slot,
              isAI: false,
              ready: false,
            }
          : {
              slot,
              playerId: '',
              name: AI_NAMES[slot % AI_NAMES.length],
              color: AI_COLORS[slot % AI_COLORS.length],
              stats: { ...PLACEHOLDER_STATS },
              portrait: slot,
              isAI: true,
              ready: true,
            },
      );
    }
    return { type: 'welcome', v: PROTOCOL_VERSION, seed: this.seed, hostId, seats, settings: defaultRaceSettings() };
  }
}

/** Re-exported for the lobby's convenience: the host's roster message. */
export type RaceLobbyMsg = LobbyMsg;
