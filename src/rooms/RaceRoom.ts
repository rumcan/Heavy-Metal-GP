// ══════════════════════════════════════════════════════════════════════════
// MP-03 — the race room: a THIN VALIDATING RELAY (RUN.world GameRoom).
//
// Host authority, thin relay (epic #11): the host browser runs the full
// Matter.js `Game`, guests render and send intents. This room owns exactly
// five things and simulates nothing:
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
//   4. THE RATING BOARD (RK-03) — who is what, as each driver published it,
//      plus the ONE result a race may file. The room is the only party that can
//      add the two facts no client holds: which seats it watched empty
//      (a leaver is a DNF whatever the marble went on to do) and the board the
//      result was filed against. See the RK-03 section near the bottom — and
//      the departures from HexMatch's version, argued there.
//   5. PRESENCE — the platform flips `player.connected` when a socket drops
//      and holds the seat for `reconnectTimeout`, but it tells the room
//      nothing. So the room polls once a second and speaks the two
//      transitions as `peerStatus`, re-greeting a returner with a welcome
//      (a reloaded page is a brand-new client that has never seen the seed).
//
// Routing, in one table:
//
//   intent / resync / ready   guest  → HOST ONLY  (sendTo hostId, stamped `from`)
//   chat                      client → EVERYONE   (broadcast, stamped `from`)
//   kick                      host   → SERVER     (the room evicts the player)
//   state / events / snapshot host   → EVERYONE   (broadcast)
//   lobby / start / results   host   → EVERYONE   (broadcast)
//   playerRating              client → SERVER     (the room's board; own id only)
//   resultClaim               host   → EVERYONE   (the room files it, once)
//   welcome / reject / peerStatus    server-only: a client sending one is ignored
//   ratingUpdate / result     SERVER only: a client sending one is ignored
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
  LOBBY_CLOSED_REASON,
  MARBLE_COUNT,
  PROTOCOL_VERSION,
  defaultRaceSettings,
  readRankWire,
  validateMessage,
  type LobbyMsg,
  type PlayerRatingMsg,
  type RaceProtocol,
  type RankWire,
  type RankedRow,
  type ResultClaimMsg,
  type ResultMsg,
  type Seat,
  type WelcomeMsg,
} from '../net/protocol';
import { AI_COLORS, AI_NAMES, PLAYER_COLORS } from '../game/types';
import type { MarbleStats } from '../game/types';

export type RoomProtocol = RaceProtocol;

/** Sent when the host is gone — no host, no truth. Lives in the protocol so
 *  the client can recognise it without importing the server module. */
export { HOST_LEFT_REASON, LOBBY_CLOSED_REASON };

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
  // ── RK-03 state ─────────────────────────────────────────────────────────
  /** player id → that driver's published rating. Only ever written by its owner. */
  private readonly ratings = new Map<string, { rating: number; games: number; joinToken: string }>();
  /**
   * Every player this room has ever seated. A claim may name a driver whose
   * seat the room has already removed: the host files the classification AFTER
   * the flag, and a seat that emptied mid-race is gone by then (#164's
   * kill-then-finish case, ported from HexMatch).
   */
  private readonly everJoined = new Set<string>();
  /**
   * Drivers the room watched walk out of a LIVE race — its own fact, and the
   * one thing a filing classification cannot be argued out of. See `fileResult`.
   */
  private readonly departed = new Set<string>();
  /** True once this room has spent its one result. */
  private resultFiled = false;
  /**
   * True while the host's lobby is showing house-rule power-ups. Read off the
   * `lobby` frames as they are relayed, because a lobby that hands out items
   * hands out a race that is nobody's to rate (`ResultMsg.rated`).
   */
  private houseRules = false;
  /** True while the host has closed the lobby to new drivers. */
  private lobbyClosed = false;

  onCreate() {
    this.seed = roomSeed(this.roomId);
    this.log.info('Race room created', { roomId: this.roomId, seed: this.seed });
  }

  onPlayerJoin(player: Player) {
    // MP-08: a driver the room is still holding a seat for is not a newcomer —
    // it is the same player coming back (a refresh, a reconnect), and their
    // marble is still out there rolling.
    const returning = this.seats.has(player.id);
    // A race in progress has no seat to offer anyone else: the grid is set, the
    // marbles are rolling, and a newcomer would arrive mid-heat with nowhere to
    // go. `reject` throws — everything below is skipped.
    if (this.raceLive && !returning) this.reject({ reason: RACE_IN_PROGRESS_REASON });
    if (this.lobbyClosed && !returning) this.reject({ reason: LOBBY_CLOSED_REASON });
    if (!returning && this.seats.size >= this.maxHumans()) {
      this.reject({ reason: ROOM_FULL_REASON });
    }
    // First joiner is the host; a newcomer to a hostless room takes over (the
    // host migration this ticket deliberately does not do, but a lobby whose
    // host walked out is a lobby worth salvaging).
    const hostId = this.hostId ?? player.id;
    this.hostId = hostId;
    if (!this.seats.has(player.id)) this.seats.set(player.id, this.firstFreeSeat());
    // RK-03: kept even after the seat is given up, so a claim can still name a
    // driver the room has since removed (see `everJoined`).
    this.everJoined.add(player.id);
    this.presence.set(player.id, player.connected !== false);
    if (!this.clock.has(PRESENCE_TIMER)) {
      this.clock.setInterval(PRESENCE_TIMER, () => this.pollPresence(), PRESENCE_POLL_MS);
    }
    this.log.info(returning ? 'Player rejoined' : 'Player joined', { playerId: player.id, slot: this.seats.get(player.id), hostId });
    // A broadcast inside `onPlayerJoin` only reaches ALREADY-connected members:
    // the newcomer's socket registers after the hook runs. So the newcomer gets
    // the welcome targeted, and everyone else learns the new seat table from the
    // broadcast. Nobody gets it twice.
    //
    // The newcomer's copy is TARGETED, and a targeted frame lands on the
    // client's `onPrivateMessage`, not its `onMessage` — a page that has not
    // finished mounting is listening for neither, which is why a client also
    // asks (`hello`) once it is.
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
      // client → EVERYONE (MP-CHAT). Talk is the one thing a GUEST may say to
      // the room rather than to the host: it is not the world, it is the
      // driver, and the host has no more right to a mouth than anybody else.
      //
      // Stamped like every relayed frame, for the same reason: the SDK hands a
      // client the payload alone, and a line whose author the receiver has to
      // guess is a line anybody could have written.
      case 'chat': {
        this.broadcast({ ...p, from: msg.sender.id });
        return;
      }
      // client → server (MP-10): the greeting sent at join time goes out before
      // the page has subscribed to anything, because the SDK hands over a room
      // that has already joined. Answer the asker — and only the asker — with a
      // fresh one. Not broadcast: nobody else needs to be told twice.
      case 'hello': {
        // Why this message exists at all: the greeting in `onPlayerJoin` goes out
        // BEFORE the newcomer's socket is registered (`createRoom` and
        // `joinRoomByCode` both hand over a room that has already joined), so the
        // only copy that reaches them is the targeted one — and a page that has
        // not finished mounting is not listening for it either. So the client
        // asks, and the room answers the asker alone.
        //
        // Targeted, and private: `sendTo` frames arrive on the client's
        // `onPrivateMessage`, NOT on `onMessage` (which is broadcast-only). That
        // split is the whole reason MP-06's lobby could show a code and no grid —
        // see `src/net/transport.ts`.
        this.log.info('Hello — greeting the asker', { from: msg.sender.id, hostId: this.hostId });
        this.sendTo(msg.sender.id, this.welcome(this.hostId ?? msg.sender.id));
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
        // Tell them first. The platform's own `kick` reaches a client only as a
        // socket that stopped talking — no reason, no event, nothing a screen can
        // explain — so the room says why while it still can.
        this.sendTo(p.playerId, { type: 'reject', reason: KICKED_REASON });
        this.kick(p.playerId, KICKED_REASON);
        return;
      }
      // HOST → everyone. `sender.id !== hostId` is the ONE piece of real
      // authority this relay keeps: a guest that publishes state is either
      // confused or cheating, and either way the answer is silence.
      case 'lobby':
        if (msg.sender.id !== this.hostId) return;
        // RK-03: the room reads the rules as they pass. House-rule power-ups are
        // the one half of "is this race rated" the room can see for itself, so
        // it keeps the LATEST word (a host who clears the rules before the
        // lights has cleared them) and `fileResult` ANDs it in.
        this.houseRules = p.settings?.items !== undefined && Object.keys(p.settings.items).length > 0;
        // The host's "stop letting more join" switch rides on the lobby frame.
        if (p.open !== undefined && p.open === this.lobbyClosed) {
          this.lobbyClosed = !p.open;
          if (this.lobbyClosed) this.lock();
          else if (!this.raceLive && this.seats.size < this.maxHumans()) this.unlock();
        }
        this.broadcast(p);
        return;
      case 'state':
      case 'events':
      case 'kit':
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
      // client → server (RK-03). A driver's own rating, relayed to everyone as
      // the room's board. A rating is the one number a player is allowed to be
      // wrong about — it only ever feeds an expectation — but it must never be
      // possible to write somebody else's, so `onRating` drops anything not
      // signed by its owner's id.
      case 'playerRating': {
        this.onRating(msg.sender.id, p);
        return;
      }
      // host → server (RK-03). The race is over and this is the classification;
      // the room validates it against what it saw, stamps it with its own clock
      // and its own board, and files the ONE result this room will ever carry.
      case 'resultClaim': {
        if (msg.sender.id !== this.hostId) return;
        this.onResultClaim(p);
        return;
      }
      // `welcome` / `reject` / `peerStatus` are the ROOM's own voice, and so are
      // `ratingUpdate` / `result` (RK-03). A client that sends one is speaking
      // for the server: ignored, never relayed.
      default:
        return;
    }
  }

  onPlayerLeave(player: Player, reason: LeaveReason) {
    this.seats.delete(player.id);
    this.presence.delete(player.id);
    // RK-03: a seat that empties during a LIVE, unfiled race is a driver who
    // walked out. The room is the only party that sees it happen for everybody,
    // so it is the only party that can say so in the result — see `fileResult`.
    if (this.raceLive && !this.resultFiled) {
      this.departed.add(player.id);
      this.log.info('Driver left mid-race — marked a DNF', { playerId: player.id, reason });
    }
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
    // A free seat is a free seat again — until the host says `start` or closes the lobby.
    if (!this.lobbyClosed) this.unlock();
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

  // ── RK-03: the rating board and the one filed result ─────────────────────
  //
  // Ported from HexMatch's `HexmatchRoom` (RANK-01), where a room rated a DUEL.
  // Three things had to change for a race, and each is argued where it happens:
  //
  //   (1) the verdict is a CLASSIFICATION, not a winner/loser pair — so the
  //       room's own contribution is not "who won" (it cannot know: it does
  //       not simulate) but "who was still here" (`departed`);
  //   (2) there is no forfeit TIMER: a leaver's loss in a duel is fully
  //       determined the moment they go, but a race is not over until somebody
  //       has a classification to file. The room keeps the leaver's mark until
  //       the host's claim arrives and merges it in there;
  //   (3) `rated` — whether the race counts at all — is the host's word ANDed
  //       with the one rule the room can check for itself (house-rule
  //       power-ups). HexMatch let the CLIENT decide ratedness from the button
  //       it was pressed with; in a six-seat race that would let two seats
  //       disagree about whether their own race counted, so the verdict is
  //       stamped by the room and every seat reads the same flag. The host is
  //       trusted for it for the same reason it is the only seat allowed to
  //       claim a classification at all: it is the seat that ran the
  //       simulation. (A room created by friends' Host-game could therefore
  //       claim to be rated — but that host could equally fabricate the
  //       classification, so the ladder's protection is the room's board and
  //       its leaver marks, not this flag.)

  /**
   * A driver publishes their rating. Two rules, both about who may speak:
   *
   *   - the id must be the SENDER's (the relay knows which socket a frame came
   *     from; see `RelayedFrame` for the same rule on guest frames). A rating is
   *     the one number a player is allowed to be wrong about, but never
   *     somebody else's number;
   *   - the first publish for a seat must carry a join token, and every later
   *     publish for that seat must carry the SAME one. The token is minted when
   *     the client joins, so a third party who joined later (or a stale tab)
   *     cannot overwrite a rating mid-race. Re-publishing with the same token is
   *     idempotent and expected: a client re-publishes after filing its own
   *     result, and the newer number is the truer one.
   */
  private onRating(senderId: string, msg: PlayerRatingMsg): void {
    const wire = readRankWire(msg);
    if (!wire || wire.playerId !== senderId) {
      this.log.warn('Dropped a rating that was not the sender\'s own', { senderId });
      return;
    }
    const existing = this.ratings.get(senderId);
    if (existing) {
      if (msg.joinToken !== existing.joinToken) return;
    } else if (typeof msg.joinToken !== 'string' || msg.joinToken.length === 0) {
      return;
    }
    this.ratings.set(senderId, { rating: wire.rating, games: wire.games, joinToken: msg.joinToken });
    // The board goes out whole: at most six rows, and a delta would need a
    // sequence number and a re-request path for a message that is sent a
    // handful of times a race.
    this.broadcast({ type: 'ratingUpdate', ratings: this.ratingBoard() });
  }

  /**
   * The host says the race is over, and this is the classification.
   *
   * The room checks the two things it can check — the claimant is the host (a
   * guest does not run the simulation, so it has no standing to say who crossed
   * the line), and one result per room — then REPLACES the claim's leaver marks
   * with its own (`mergeClaim`) before filing.
   */
  private onResultClaim(msg: ResultClaimMsg): void {
    if (this.resultFiled) return;
    // A race that never started is not a race anyone may be rated from: before
    // `start` there is a lobby, and a claim for a lobby is a claim for a heat
    // that does not exist.
    if (!this.raceLive) return;
    const order = this.mergeClaim(msg.order);
    if (!order) {
      this.log.warn('Dropped a result claim that named a driver this room never seated');
      return;
    }
    const durationSec = Number.isFinite(msg.durationSec) ? Math.max(0, Math.round(msg.durationSec)) : 0;
    // `rated` is the host's word about how the room was created (matchmade or
    // friends), ANDed with the room's own look at the lobby's rules. See (3).
    this.fileResult(order, 'finish', durationSec, msg.rated === true && !this.houseRules);
  }

  /**
   * The classification as the ROOM saw it: the host's finish order, with the
   * room's leaver marks forced on top.
   *
   * Forcing, not merging, is the whole point. MP-08 hands a dropped driver's
   * marble to the AI three seconds after their socket goes, and that AI can
   * roll home — so the host's summary may well have the leaver down as a
   * finisher. On the scoreboard they abandoned, and a rating system that paid
   * them anyway would be paying people to quit (`RaceEntry.left`,
   * `src/net/rating.ts`).
   *
   * A leaver the claim forgot is appended as the DNF it is: the room seated
   * them, so they are a rated seat of this race, and dropping them would
   * quietly shrink everybody else's field. `null` — the whole claim is refused
   * — only for a row naming somebody this room never seated: a classification
   * cannot invent a driver, and a half-believed one is worse than none.
   */
  private mergeClaim(claim: readonly RankedRow[]): RankedRow[] | null {
    const order: RankedRow[] = [];
    const seen = new Set<string>();
    for (const row of claim) {
      if (!this.everJoined.has(row.playerId)) return null;
      if (seen.has(row.playerId)) return null;
      seen.add(row.playerId);
      order.push(
        this.departed.has(row.playerId)
          ? { playerId: row.playerId, finished: false, left: true }
          : { playerId: row.playerId, finished: row.finished === true },
      );
    }
    for (const id of this.departed) {
      if (seen.has(id)) continue;
      seen.add(id);
      order.push({ playerId: id, finished: false, left: true });
    }
    return order;
  }

  /**
   * File the one result this room will ever carry. Idempotent by construction:
   * `resultFiled` is set BEFORE the broadcast, so two claims (or a claim racing
   * the room's own leaver bookkeeping) cannot move a rating twice for one race.
   *
   * The list of ratings travels WITH the result, so a seat that never saw
   * another driver's `ratingUpdate` still computes the same numbers as
   * everybody else — which is what "no rating numbers on the wire" rests on:
   * the clients recompute `rateRace` from THIS board and THIS classification.
   *
   * A race that never produces a claim — the host walked out (which ends the
   * race for everyone), or the room emptied first — files NOTHING. The room
   * does not simulate, so it has no classification to file, and one it cannot
   * see is one it must not invent.
   */
  private fileResult(
    order: readonly RankedRow[],
    reason: ResultMsg['reason'],
    durationSec: number,
    rated: boolean,
  ): void {
    if (this.resultFiled) return;
    this.resultFiled = true;
    const result: ResultMsg = {
      type: 'result',
      order: [...order],
      ratings: this.ratingBoard(),
      reason,
      durationSec,
      rated,
      at: Date.now(),
    };
    if (this.departed.size > 0) result.departedIds = [...this.departed];
    this.log.info('Race result filed', {
      rated,
      reason,
      drivers: order.length,
      departed: this.departed.size,
      durationSec,
    });
    this.broadcast(result);
  }

  /** The board as it stands: every rating the room has actually been told. */
  private ratingBoard(): RankWire[] {
    return [...this.ratings.entries()].map(([playerId, entry]) => ({
      playerId,
      rating: entry.rating,
      games: entry.games,
    }));
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
    // RK-03: the board rides the greeting, so a newcomer's first look at the
    // lobby already shows the numbers — and so the board a race is rated from
    // is the ROOM's copy rather than whichever updates happened to arrive.
    return {
      type: 'welcome',
      v: PROTOCOL_VERSION,
      seed: this.seed,
      hostId,
      seats,
      settings: defaultRaceSettings(),
      ratings: this.ratingBoard(),
    };
  }
}

/** Re-exported for the lobby's convenience: the host's roster message. */
export type RaceLobbyMsg = LobbyMsg;
