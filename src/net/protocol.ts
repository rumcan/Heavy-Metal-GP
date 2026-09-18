// ══════════════════════════════════════════════════════════════════════════
// MP-02 — the race protocol (RUN.world).
//
// The shared message union spoken by the host browser, the guest browsers and
// the thin validating relay (`src/rooms/RaceRoom.ts`, MP-03). Imported by BOTH
// sides — including the ROOM BUNDLE — so it must stay free of SDK, DOM and
// Matter.js imports: `transport.ts` is the only client module that touches the
// SDK, and the room keeps its `mp-server` import to itself. The two game
// modules it does import (`../game/types`, `../game/cues`) are pure — no SDK,
// no DOM, no physics, no module-scope side effects. Keep them that way: a
// `matter-js` import here would drag the physics engine into the room worker.
//
// The wire (ticket #13, epic #11):
//   - HOST AUTHORITY. The host browser runs the Matter.js `Game`; guests render
//     and send intents. The room never simulates anything.
//   - `state` at 20 Hz: ten marbles packed into 21 bytes each (5 × float32 plus
//     a flag byte) and base64'd — JSON numbers would cost ~3× the bytes, and a
//     frame that misses its budget is a frame the gateway drops.
//   - `events` ride alongside the state: pegs, crates, boxes, items, oil,
//     freeze, shock, finishes and sound cues — everything a guest must SHOW or
//     PLAY and cannot re-derive locally (guests do not simulate).
//   - `snapshot` is join/resync ONLY, and it is CHUNKED: a full world (marble
//     states + destroyed bodies + boxes + inventories) does not fit the 16 KiB
//     frame, and the gateway drops an oversized frame rather than fragmenting
//     it.
//   - `seq` numbers every state frame. A guest that sees a gap asks for a
//     `resync` and gets a snapshot. The two compose: apply snapshot(seq), then
//     frames seq+1, seq+2…
//   - Body references are stable indices into `track.bodies`. Both sides build
//     the identical circuit from `seed` + the same profile, which is why the
//     profile is validated strictly: one differing byte and a peg index points
//     at a different peg (or past the end of the array).
//
// Determinism: nothing here generates anything. Track generation and sim
// randomness come from the seeded RNG (`mulberry32`); this file only moves the
// numbers both sides already agree on.
// ══════════════════════════════════════════════════════════════════════════
import { ITEM_TYPES, MAX_ITEM_STACK, STAT_MAX, STAT_MIN } from '../game/types';
import type { Inventory, ItemType, MarbleStats, TrackProfile, TrackTheme } from '../game/types';
import { SOUND_EVENTS, isSoundEvent } from '../game/cues';
import type { SoundEvent } from '../game/cues';
export type { SoundEvent };
// RK-01's shapes, by TYPE only: `rating.ts` is pure (no SDK, no DOM, no clock),
// so importing it here costs the room bundle nothing — and the wire's rows are
// then the arithmetic's own `RaceEntry`, which is what stops the two drifting.
import { RATING_FLOOR } from './rating';
import type { RaceEntry, RankWire } from './rating';
export type { RaceEntry, RankWire };

// ══════════════════════════════════════════════════════════════════════════
// Constants
// ══════════════════════════════════════════════════════════════════════════

/**
 * Protocol version. Bump it whenever the wire changes in a way an older peer
 * would misread — a mixed-version room must REFUSE, never half-run.
 *
 * v1 (MP-02): the first race wire — welcome (seats, seed, settings),
 * lobby/ready/start, 20 Hz packed `state`, `events`, chunked `snapshot`,
 * `intent`, `resync`, `results`, presence and the hard refusal on mismatch.
 */
export const PROTOCOL_VERSION = 3; // 3: the rated wire (rating board, result claim, the room's result); also carries MB-10 mover rides and dynamic state (hold.of, seesaw, bridge)

/**
 * Realtime WS frame cap in bytes. Mirrors the SDK's `MAX_BROADCAST_BYTES`
 * (`mp-server`, 16 KiB). Defined HERE rather than imported from `mp-server` so
 * the client never pulls server code into its bundle — and so the room can
 * check a frame against the same number the gateway enforces.
 */
export const FRAME_CAP_BYTES = 16 * 1024;

/**
 * Bytes one `state` frame may cost (ticket acceptance: ten marbles under
 * 4 KiB). A packed ten-marble frame is ~280 base64 characters — the budget is
 * four times what the format needs, so a future extra field does not have to
 * re-open the size question, and a frame that somehow grows past it is refused
 * instead of silently eating the 20 Hz stream's headroom.
 */
export const STATE_BUDGET_BYTES = 4 * 1024;

/**
 * The grid: ten marbles, every race, always — up to six humans with AI filling
 * the rest (`rundot/realtime.config.json` → `maxPlayers`, `GRID_N` in
 * `src/game/track.ts`). Every packed `state` frame carries exactly this many
 * marbles, which is why the count is NOT on the wire: a frame of any other
 * length is not a frame this version can read.
 */
export const MARBLE_COUNT = 10;

/** Floats per marble on the wire: x, y, vx, vy, angle. */
export const FLOATS_PER_MARBLE = 5;

/** Bytes per marble: five float32 plus one flag byte. */
export const BYTES_PER_MARBLE = FLOATS_PER_MARBLE * 4 + 1;

/** Characters of one packed frame's base64 (ten marbles → 280, no padding). */
export function packedStateLength(count: number = MARBLE_COUNT): number {
  return Math.ceil((count * BYTES_PER_MARBLE) / 3) * 4;
}

/** Flag-byte layout. Three bits are left for a loop/staging counter. */
export const FLAG_FINISHED = 1 << 0;
export const FLAG_FROZEN = 1 << 1;
export const FLAG_OIL = 1 << 2;
export const FLAG_GHOST = 1 << 3;
export const FLAG_ANVIL = 1 << 4;
export const FLAG_LOOP_MASK = 0b1110_0000;
/** The loop counter is three bits: 0..7. */
export const MAX_LOOP_STAGE = 7;

/**
 * Characters of snapshot JSON per chunk frame: 8 KiB against the 16 KiB cap,
 * which leaves room for the envelope and for a stricter gateway than the one
 * we are promised.
 */
export const SNAPSHOT_CHUNK_CHARS = 8000;

/** Frames a transfer may run to before it is refused as malformed (~1 MiB). */
export const MAX_SNAPSHOT_CHUNKS = 128;

/** Events one `events` frame may carry (a 20 Hz frame cannot need more). */
export const MAX_EVENTS_PER_FRAME = 64;

/**
 * The largest body index the wire will accept. A generated circuit is ~1–1.5k
 * bodies (`generateTrack`), so this is not a track limit — it only stops a
 * hostile index from becoming an out-of-bounds read on the guest.
 */
export const MAX_BODY_INDEX = 0x7fff;

/** Longest seat name the wire accepts (it goes straight into the HUD). */
export const MAX_NAME_LENGTH = 32;

/** Laps: the shipped races are one downhill pass. 1 is all the sim runs. */
export const DEFAULT_LAPS = 1;
export const MAX_LAPS = 9;

/**
 * Sequence numbers are monotonic and wrap here. The wire is JSON, so a plain
 * integer is all the sequencing there is — and a wrap is what keeps it plain
 * over a long race (20 Hz × 9 minutes is ~11k frames, nowhere near this).
 */
export const SEQ_MODULO = 2 ** 31;

/**
 * Shown when a welcome arrives from a different protocol version. A
 * mixed-version room must show this — never desync silently.
 */
export const VERSION_MISMATCH_MESSAGE = 'This game has been updated — reload to race together';

/**
 * The reject reason the room sends when the HOST seat empties — no host, no
 * truth. It lives with the wire vocabulary because BOTH ends speak it: the
 * room sends it (MP-03) and the client compares against it to choose the
 * "host left" copy, without importing the server module.
 */
export const HOST_LEFT_REASON = 'The host left the race.';

/** Sent to a newcomer after the host closed the lobby. */
export const LOBBY_CLOSED_REASON = 'The host closed this lobby to new drivers.';

// ══════════════════════════════════════════════════════════════════════════
// Lobby: seats, settings, welcome
// ══════════════════════════════════════════════════════════════════════════

/**
 * A circuit definition. Today that is `TrackProfile` — segment count, segment
 * weights, theme — because a seed and a profile are all `generateTrack` needs.
 * Named `TrackDef` on the wire so a future custom-circuit format (waypoints,
 * hand-built segments) changes the union, not the message.
 */
export type TrackDef = TrackProfile;

/**
 * One grid slot. The SAME index is used three ways, on purpose:
 *   - `slot` here, and the seat's position in `welcome.seats`,
 *   - the marble's offset in every packed `state` frame,
 *   - the local `MarbleInfo.id` (the roster is ten marbles, ids 0..9).
 * One numbering, no translation table, no way to address the wrong marble.
 */
export interface Seat {
  /** Grid slot, 0..MARBLE_COUNT-1. */
  slot: number;
  /** RUN player id; '' for an AI seat. */
  playerId: string;
  /** Name as the HUD shows it. */
  name: string;
  /** Livery colour, `#rrggbb` — it is painted straight into a canvas/style. */
  color: string;
  stats: MarbleStats;
  /** Portrait (player) or rival sprite (AI) index. */
  portrait: number;
  isAI: boolean;
  /** Lobby ready flag (MP-06). Absent reads as not ready. */
  ready?: boolean;
  /**
   * What this driver is CARRYING (MP-09). Absent reads as empty.
   *
   * An online race spends each driver's own kit, not the host's: a guest files
   * it through `ready`, the host puts it on the marble, and the pickups and the
   * spends belong to the seat. Counts are clamped by the wire — a guest who
   * says nine rockets when it owns none gets what it owns.
   */
  inventory?: Inventory;
}

/** Largest share-code the wire will carry (a full track is ~5 KB as a code, well inside the frame cap). */
export const MAX_CUSTOM_CODE_CHARS = 12000;

/** What the race is: which circuit, and how many times around it. */
export interface RaceSettings {
  /**
   * Calendar id (an index into `CALENDAR` in `src/game/season.ts`) or a whole
   * circuit definition for a custom race. A number is resolved against the
   * client's own calendar — the protocol cannot import it (`season.ts` pulls
   * in `storage.ts`, which boots the SDK, and the room bundle may not).
   */
  circuit: number | TrackDef;
  /** Laps. Absent reads as `DEFAULT_LAPS`. */
  laps?: number;
  /**
   * House rules for power-ups. Absent: every driver races the kit they brought (MP-09).
   * Present: every driver, AI included, starts with these charges per item; `UNLIMITED_ITEM` never runs out.
   * House-rule charges never come out of (or go back into) anyone's own kit.
   */
  items?: Partial<Record<ItemType, number>>;
  /**
   * MB-08: a custom track as a share-code string (`1-` + deflate+base64url, see
   * `src/game/sharecode.ts`). When present the host is racing a player-built
   * circuit; `circuit` is ignored by the simulation (kept for compatibility and
   * for the HUD title) and the track is built with `buildTrackFromDef` after
   * `decodeShareCode`. Fits inside `FRAME_CAP_BYTES` (~5 KB) so the settings
   * still travel in a single `welcome`/`lobby` frame — no extra chunk type is
   * needed, but the value is still size-checked and validated before it is
   * decoded.
   */
  customCode?: string;
  /** False: AI drivers never use power-ups. Absent reads as true. */
  aiItems?: boolean;
  /** AI seats the host took off the grid: they do not race. Human seats are never benched. */
  benched?: number[];
}

/** An item the host set to "unlimited". */
export const UNLIMITED_ITEM = -1;
/** The largest finite house-rule count a host can set. */
export const MAX_HOUSE_ITEMS = MAX_ITEM_STACK;

/** The room's rules before the host has filed any (MP-06 files the real ones). */
export function defaultRaceSettings(): RaceSettings {
  return { circuit: 0, laps: DEFAULT_LAPS };
}

/** server → one client, on join and on every rejoin. */
export interface WelcomeMsg {
  type: 'welcome';
  /** Protocol version — the handshake's whole point (see `validateWelcome`). */
  v: number;
  /** The seed both sides regenerate the circuit from. Minted by the room. */
  seed: number;
  /** The seat that runs the simulation. */
  hostId: string;
  /** The whole grid — ten seats, humans and AI, in slot order. */
  seats: Seat[];
  settings: RaceSettings;
  /**
   * RK-03: the room's rating board — every driver that has published a rating,
   * as the room holds it. It rides the greeting so a newcomer's first look at
   * the lobby already shows the numbers, and so the board a race is rated from
   * is the ROOM's copy rather than whichever updates happened to arrive.
   * Optional: absent reads as "nobody has published yet".
   */
  ratings?: RankWire[];
}

/**
 * host → server → everyone. The lobby, whole: the seats (with their ready
 * flags) rather than a patch, because a lobby is a handful of rows and a
 * joiner needs all of them at once.
 *
 * `settings` is the HOST's answer to the room's welcome: the room greets a
 * joiner with the default circuit (it cannot know what the host picked), so
 * the host republishes the rules its lobby is showing here, and this room
 * relays it to everyone. It has to travel — a guest building a different
 * circuit from the host would read every body index as a different body.
 * Optional: absent reads as the defaults the welcome already carried.
 */
export interface LobbyMsg {
  type: 'lobby';
  seats: Seat[];
  settings?: RaceSettings;
  /** False once the host closed the lobby to new drivers. Absent reads as open. */
  open?: boolean;
  /**
   * RK-05: the HOST's word that this is a RATED lobby — they came in through
   * Quick race (matchmaking), not a code, and the lobby is racing without
   * house-rule power-ups.
   *
   * It has to travel because ratedness is decided by the DOOR, and only the
   * host knows which door they came through. A guest who joined a matchmade
   * room by its code is in the same rated race as everybody else, and would
   * otherwise print "a friendly race" on a result that moved their rating.
   *
   * It is a HINT, not authority: the room ANDs the same claim with what it can
   * see for itself (house rules) and stamps `ResultMsg.rated`, which is the
   * flag every seat files from. Absent reads as false — a lobby that says
   * nothing is a friendly one.
   */
  rated?: boolean;
}

/**
 * One driver's garage: the name on the timing tower, the livery on the marble,
 * the tune under it and the face in the portrait slot.
 *
 * Sent by the guest in `ready` — the lobby's one guest→host frame — and filed
 * by the host into `lobby`, which is the message every seat reads. The host
 * does not ask for it twice: a guest re-sends it whenever it changes.
 */
export interface SeatGarage {
  name: string;
  /** `#rrggbb`, painted straight into a canvas fill and a style. */
  color: string;
  stats: MarbleStats;
  portrait: number;
  /** MP-09: this driver's own items, filed against their seat. */
  inventory?: Inventory;
}

/**
 * Who sent a guest frame — stamped by the ROOM as it relays, never by the guest.
 *
 * A guest frame (`intent`, `resync`, `ready`) carries no seat of its own: the
 * seat table is the room's business, and the room is the only party that knows
 * which socket a frame came from. So it writes `from` on the way through and
 * OVERWRITES any a client tried to send — a guest cannot forge another seat's
 * nudges, or file another driver's garage. The SDK hands a client the payload
 * alone, with no sender and no envelope, so the stamp has to ride inside it.
 *
 * The server side of the same fact is `msg.sender.id` (see `RaceHost.accept`).
 */
export interface RelayedFrame {
  /** RUN player id of the guest that sent this frame. Written by the room. */
  from?: string;
}

/** guest → server → host. One seat's ready flag, and the seat's garage. */
export interface ReadyMsg extends RelayedFrame {
  type: 'ready';
  ready: boolean;
  /**
   * This seat's garage, on join and whenever the driver changes it. Absent
   * leaves the seat exactly as the host last filed it — a plain ready toggle.
   */
  garage?: SeatGarage;
}

/** host → server. Take a driver off the grid. The ROOM owns the eviction. */
export interface KickMsg {
  type: 'kick';
  /** RUN player id of the driver to remove. */
  playerId: string;
}

/**
 * host → server → everyone. `countdownAt` is the wall clock (epoch ms) at
 * which the lights go out, so every tab counts down to the same instant
 * instead of to its own receipt of this message.
 */
export interface StartMsg {
  type: 'start';
  countdownAt: number;
}

// ══════════════════════════════════════════════════════════════════════════
// Chat — drivers talking (MP-CHAT)
//
// The one frame a GUEST may say to EVERYBODY. Everything else a guest owns
// (`intent`, `resync`, `ready`) travels to the host alone, because the host
// is the simulation and a guest has no business telling a peer what the
// world looks like. Talk is different: it is not the world, it is the
// driver, and the host is not the only one allowed to have a mouth.
//
// So the ROOM relays it — stamped, like every guest frame, because the SDK
// hands a client the payload alone and a line with no author is not a
// conversation. It is never simulated, never replayed and never stored: a
// driver who joins late simply has not heard it.
//
// ADDITIVE, and that is why `PROTOCOL_VERSION` does not move for it: nothing
// in the simulation reads a line, so a build that has never heard of `chat`
// refuses it as an unknown type and races on exactly as before (muted), and a
// room that has never heard of it drops it. A version bump would reload
// everybody out of a live race to protect a conversation — the wrong trade
// for a frame that cannot desync a marble.
// ══════════════════════════════════════════════════════════════════════════

/**
 * The longest line the wire will carry.
 *
 * Long enough for a sentence, short enough that a line is a bubble and not a
 * paragraph: in a race it is drawn over a marble, and a wall of text over a
 * ball is not a speech bubble. The lobby input is clamped to the same number,
 * so what is typed is what travels.
 */
export const MAX_CHAT_LENGTH = 120;

/** client → server → everyone. One driver, one line. */
export interface ChatMsg extends RelayedFrame {
  type: 'chat';
  /** The line itself. Trimmed and length-capped by the wire. */
  text: string;
}

// ══════════════════════════════════════════════════════════════════════════
// Steady state: the 20 Hz frame
// ══════════════════════════════════════════════════════════════════════════

/**
 * One marble, decodable — the shape `packState` takes and `unpackState`
 * returns, and the shape a snapshot stores. The wire itself carries the packed
 * string; this is what both ends actually read and write.
 */
export interface MarbleState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Body angle, radians. */
  a: number;
  finished: boolean;
  frozen: boolean;
  /** Standing in an oil slick. */
  oil: boolean;
  ghost: boolean;
  anvil: boolean;
  /** 0..7 loop/staging counter — three spare bits in the flag byte. */
  loop: number;
}

/**
 * host → server → everyone, 20 Hz. The steady state.
 *
 * `marbles` is base64 of `MARBLE_COUNT × BYTES_PER_MARBLE` bytes — five
 * float32 and a flag byte per marble, little-endian, packed by `packState`.
 * Little-endian is stated, not assumed: both ends must read the same bytes the
 * same way whatever the machine.
 */
export interface StateMsg {
  type: 'state';
  seq: number;
  /** Host simulation clock (ms since the `Game` was built). */
  t: number;
  /** Packed marble states — see `packState`. Length implies the count. */
  marbles: string;
}

// ══════════════════════════════════════════════════════════════════════════
// Events — everything a guest must show but cannot simulate
//
// Body references (`i`) are stable indices into `track.bodies`; seat
// references (`seat`, `by`) are grid slots. Both are integers, both are
// validated, and neither can name something the peer does not have.
// ══════════════════════════════════════════════════════════════════════════

/** A peg lit up and popped away (`i` is its body index). */
export interface PegEvent {
  kind: 'peg';
  i: number;
  seat: number;
}

/** A breakable wall: damage taken, and whether it broke open. */
export interface CrateEvent {
  kind: 'crate';
  i: number;
  hp: number;
  broken: boolean;
}

/** An item box taken (`taken: true`, by `seat`) or respawned (`taken: false`). */
export interface BoxEvent {
  kind: 'box';
  i: number;
  taken: boolean;
  seat?: number;
}

/** An oil slick hit the track. */
export interface OilEvent {
  kind: 'oil';
  x: number;
  y: number;
  r: number;
  /** The marble that dropped it. */
  seat: number;
  /** Host clock (ms) when it evaporates. */
  until: number;
}

/** A freeze ray landed: `seat` is the victim, `by` the one who fired. */
export interface FreezeEvent {
  kind: 'freeze';
  seat: number;
  by: number;
  /** Host clock (ms) when the ice melts. */
  until: number;
}

/** A shockwave went off. */
export interface ShockEvent {
  kind: 'shock';
  seat: number;
  x: number;
  y: number;
}

/** An item was deployed. */
export interface ItemEvent {
  kind: 'item';
  seat: number;
  item: ItemType;
}

/** A marble crossed the line. */
export interface FinishEvent {
  kind: 'finish';
  seat: number;
  /** Race clock (ms since the gate), as the host measured it. */
  time: number;
  /** 1-based finishing place. */
  rank: number;
}

/** A sound cue. See `src/game/cues.ts` — the names, not the noise. */
export interface CueEvent {
  kind: 'sound';
  cue: SoundEvent;
  /** The marble the cue belongs to, when it has one. */
  seat?: number;
}

/** MB-10A. A track-switch plate flipped to a route (`side`: 0 = left, 1 = right). */
export interface SwitchEvent {
  kind: 'switch';
  i: number;
  side: 0 | 1;
}

/** MB-10A. A stateful (weight-mode) trapdoor opened or closed. */
export interface TrapdoorEvent {
  kind: 'trapdoor';
  i: number;
  open: boolean;
}

/**
 * MB-10A. A marble is hidden inside an element until `until` (host clock). `of` names the
 * carrier: a cliff `tunnel` draw is hidden start-to-end; a water-`wheel` bucket ride or a
 * `screw` lift transit stays visible on screen (MB-10C).
 */
export interface HoldEvent {
  kind: 'hold';
  seat: number;
  until: number;
  of?: 'tunnel' | 'wheel' | 'screw';
}

/**
 * MB-10C. A seesaw's dynamic state, streamed at a low rate while the plank is moving: its
 * angle (rad, 0 = level) and angular velocity (rad/ms). Guests blend their local copy toward
 * it; the plank itself is a body, so track collisions follow.
 */
export interface SeesawEvent {
  kind: 'seesaw';
  i: number;
  angle: number;
  angVel: number;
}

/**
 * MB-10C. A rope bridge's plank chain: `i` is the FIRST plank's body index (planks are
 * contiguous from the builder) and `sag` is each plank's vertical offset in px, rounded.
 * Guests spring their local planks toward it.
 */
export interface BridgeEvent {
  kind: 'bridge';
  i: number;
  sag: number[];
}

export type RaceEvent =
  | PegEvent
  | CrateEvent
  | BoxEvent
  | OilEvent
  | FreezeEvent
  | ShockEvent
  | ItemEvent
  | FinishEvent
  | CueEvent
  | SwitchEvent
  | TrapdoorEvent
  | HoldEvent
  | SeesawEvent
  | BridgeEvent;

/** Every event kind, in wire order. `validateMessage` rejects anything else. */
export const RACE_EVENT_KINDS = ['peg', 'crate', 'box', 'oil', 'freeze', 'shock', 'item', 'finish', 'sound', 'switch', 'trapdoor', 'hold', 'seesaw', 'bridge'] as const;

/**
 * host → server → everyone. What happened since the last frame.
 *
 * `seq` is the state frame this batch belongs to, so a guest buffers events
 * against the state they describe rather than guessing: apply state(seq), then
 * events(seq).
 */
export interface EventsMsg {
  type: 'events';
  seq: number;
  list: RaceEvent[];
}

// ══════════════════════════════════════════════════════════════════════════
// The full world — join and resync only, and chunked
// ══════════════════════════════════════════════════════════════════════════

/** One item box: its body index and whether it is live. */
export interface ItemBoxState {
  i: number;
  active: boolean;
}

/** One live oil slick. */
export interface OilState {
  x: number;
  y: number;
  r: number;
  owner: number;
  /** Host clock (ms) when it evaporates. */
  expiresAt: number;
}

/**
 * The whole world the host is running — the join/resync payload.
 *
 * Per-seat arrays (`inventories`, `pegs`, `times`) are indexed by seat slot,
 * the same numbering as `welcome.seats` and the packed frames.
 */
export interface RaceSnapshot {
  /** Host simulation clock (ms since the `Game` was built) — the `t` of the next frame. */
  t: number;
  /** Race clock as the HUD shows it (ms since the gate); 0 before the start. */
  clock: number;
  /** True once the gate is open. */
  started: boolean;
  marbles: MarbleState[];
  /**
   * Indices into `track.bodies` the host has destroyed — popped pegs, broken
   * crates, the opened gate. Everything else is still standing.
   */
  destroyed: number[];
  boxes: ItemBoxState[];
  oils: OilState[];
  inventories: Inventory[];
  /** Per-seat orange pegs popped. */
  pegs: number[];
  /** Per-seat finish time (ms); null when the seat has not finished. */
  times: (number | null)[];
  /** Finishing order as seat indices, best first; empty before the first finish. */
  order: number[];
}

/**
 * host → server → everyone (join/resync ONLY). One slice of a full world.
 *
 * A whole `RaceSnapshot` is several kilobytes of JSON against a 16 KiB frame
 * that the gateway does not fragment — an oversized frame is dropped, or the
 * socket is closed. So join/resync crosses as N frames:
 *
 *   host:  JSON.stringify(snap) → slices of SNAPSHOT_CHUNK_CHARS → N frames
 *   guest: concat by index → JSON.parse → validate → apply
 *
 * Frames of one transfer share `id`, and a newer `id` supersedes one in
 * flight, so a resync that overtakes a slow join can never mix halves. `seq`
 * is the state sequence the snapshot REPRESENTS: the guest resumes at `seq`,
 * so snapshot(seq) then frames seq+1, seq+2… compose.
 */
export interface SnapshotMsg {
  type: 'snapshot';
  /** Transfer id — monotonic per host, newest wins. */
  id: number;
  seq: number;
  /** 0-based index of this frame, and the transfer's total frame count. */
  i: number;
  n: number;
  /** A slice of `JSON.stringify(snap)`. Reassembly is a plain concat. */
  data: string;
}

// ══════════════════════════════════════════════════════════════════════════
// Intents, resync, results
// ══════════════════════════════════════════════════════════════════════════

/**
 * guest → server → HOST ONLY. A nudge is analog touch: -1 (left) … 0 … +1
 * (right). Nothing stronger exists, so |v| > 1 is a forged frame, not a
 * strong push.
 */
export interface NudgeIntentMsg extends RelayedFrame {
  type: 'intent';
  kind: 'nudge';
  v: number;
}

/** guest → server → HOST ONLY. Deploy one carried item. */
export interface ItemIntentMsg extends RelayedFrame {
  type: 'intent';
  kind: 'item';
  item: ItemType;
}

export type IntentMsg = NudgeIntentMsg | ItemIntentMsg;

/** guest → server → host. Sent when a guest detects a `seq` gap. */
export interface ResyncMsg extends RelayedFrame {
  type: 'resync';
}

/**
 * host → server → everyone. The classified race, once.
 *
 * `order` is seat indices best-first; `times` and `pegs` are per seat (indexed
 * by slot), so the HUD can show the whole grid without a second lookup.
 */
export interface ResultsMsg {
  type: 'results';
  order: number[];
  /** seat → finish time in ms; null for a non-finisher. */
  times: (number | null)[];
  /** seat → orange pegs popped. */
  pegs: number[];
}

// ══════════════════════════════════════════════════════════════════════════
// Room-owned messages (presence and refusal)
// ══════════════════════════════════════════════════════════════════════════

/** server → one client, on refused join or host loss. */
export interface RejectMsg {
  type: 'reject';
  reason: string;
}

/**
 * server → everyone. One seat's presence, as the room sees it (MP-08).
 *
 * The platform holds a dropped socket's seat for `reconnectTimeout` before it
 * evicts, and without this a race simply stops moving with no way to tell
 * "reconnecting" from "gone".
 */
export interface PeerStatusMsg {
  type: 'peerStatus';
  playerId: string;
  status: 'disconnected' | 'reconnected';
  /** For `disconnected`: milliseconds the seat is held before eviction. */
  graceMs?: number;
  /** The room's name for the seat, so a notice can say who mid-race. */
  username?: string;
}

/**
 * client → server: say hello again, and be told where you are sitting (MP-10).
 *
 * The SDK hands a client a room that has ALREADY joined — `createRoom` and
 * `joinRoomByCode` both resolve after the join — so the greeting the room sends
 * on join goes out before the page has subscribed to anything, and a lobby can
 * sit there showing a code and no grid for ever. Rather than rely on the socket
 * buffering a frame nobody was listening for, the client asks: the room answers
 * this player, and only this player, with a fresh welcome.
 *
 * The room's own voice, like `welcome`: never relayed, never broadcast.
 */
export interface HelloMsg {
  type: 'hello';
}

// ══════════════════════════════════════════════════════════════════════════
// RK-03 — the rated wire: the room's rating board, and the one result a race
// can file.
//
// Ported from HexMatch's RANK-01 (v6) messages and adapted to a race. The shape
// of the whole thing is HexMatch's, and so is the reason for it:
//
//   - a RATING is published by its owner and relayed to everybody, so both ends
//     of a race compute from one shared board (RK-01's arithmetic reads the
//     board, never a peer's opinion);
//   - a RESULT carries NO rating numbers at all. The claim names the finishing
//     order of the human seats; the room stamps it with its own clock and its
//     own copy of the board, and every client recomputes `rateRace` from THAT.
//     A forged claim can therefore only ever ask for the wrong verdict, never
//     hand out a number the arithmetic does not produce.
//
// What a race changes about the duel: there is no winner and loser pair. A race
// is a CLASSIFICATION — an order of the rated humans, with non-finishers below
// every finisher — so `order` is the verdict, and the room's job is to be the
// one party that saw who actually stayed to the end.
// ══════════════════════════════════════════════════════════════════════════

/**
 * One rated seat of a classification, in finishing order.
 *
 * These are the HUMAN seats only, by player id — AI marbles are not rated and
 * never appear here (RK-01). `left` is the room's own mark, and it means "this
 * driver abandoned the race" (`RaceEntry` in `src/net/rating.ts`, which this
 * aliases so the wire and the arithmetic cannot drift apart).
 */
export type RankedRow = RaceEntry;

/** Rated drivers a race can carry: the room's six human seats. */
export const MAX_RATED_DRIVERS = 6;

/** Ratings one board may carry: the same six seats, plus slack for a stale row. */
export const MAX_RATING_ROWS = 8;

/**
 * client → server. A driver's rating, published once per join.
 *
 * The one rule the relay enforces: `playerId` must be the SENDER's own id. A
 * rating is the one number a player is allowed to be wrong about (it only ever
 * feeds an expectation, and it gates nothing), but it must never be possible to
 * write somebody else's — which is why the id check exists at all.
 *
 * `joinToken` is minted by the client when it joins and authorises a later
 * re-publish for the same seat (a reconnect, a re-attach). The room keeps the
 * first token it saw for a driver and refuses any later rating that arrives
 * without it, so a third party who joined afterwards cannot overwrite a rating
 * mid-race. It is a session nonce, not a secret: it never leaves the room.
 */
export interface PlayerRatingMsg {
  type: 'playerRating';
  playerId: string;
  rating: number;
  /** Rated races played — `RankState.matches` under the board's name (RK-01). */
  games: number;
  joinToken: string;
}

/**
 * server → everyone. The room's rating board, whole.
 *
 * Needed because a rating published after a client's own welcome would
 * otherwise be visible only to whoever joined later: the host publishes on
 * boot, a guest may already be in the lobby, and the guest must still learn the
 * host's number before the race is filed. Six rows at most — cheaper to send
 * whole than to sequence.
 */
export interface RatingUpdateMsg {
  type: 'ratingUpdate';
  ratings: RankWire[];
}

/**
 * host → server. "The race is over, and this is the classification."
 *
 * Only the host may file a finished race (the relay drops it otherwise): the
 * host is the seat that runs the simulation and therefore the only one that can
 * say who crossed the line. A guest claiming a classification is either
 * confused or lying; both are ignored.
 *
 * The claim carries no numbers. The room stamps the result with its own clock
 * and its own copy of the board, and — this is the part that matters in a race
 * — marks every driver it saw ABANDON as a non-finisher, whatever the host's
 * summary said about their marble.
 */
export interface ResultClaimMsg {
  type: 'resultClaim';
  /** The rated humans, in finishing order: finishers first, then the DNFs. */
  order: RankedRow[];
  /** Race length in seconds, as the host measured it; 0 when unknown. */
  durationSec: number;
  /**
   * The host's word on whether this race counts: true only when the room it is
   * claiming in was created by quick-race matchmaking, and the lobby raced
   * without house-rule power-ups.
   *
   * It has to be the host's call because the room CANNOT make it: a room's
   * `config.metadata` is its static configuration (`rundot/realtime.config.json`)
   * and the client's matchmaking criteria ride a join ticket the room never
   * sees (`RoomOptions` is `criteria` + `createOptions` + `persistentKey`, and
   * `matchmakeRoom` takes no `createOptions` at all) — so "was I matchmade" is
   * only known to the seat that pressed the button, which is the host.
   *
   * The room still has the last word: it ANDs this with the rules it watched
   * the lobby set (house-rule items ⇒ not rated) and stamps the result. See
   * `ResultMsg.rated`.
   */
  rated: boolean;
}

/**
 * server → everyone. The room's filed result — the end of a rated race, from
 * the only party that saw every seat.
 *
 * Two producers, one shape:
 *
 *   1. the host's `resultClaim`, validated and stamped by the room, so every
 *      seat acts on one classification rather than each trusting itself;
 *   2. the room itself, when a seat EMPTIES mid-race: the driver who walked out
 *      is a DNF (`left`), and the room is the only party that saw them go.
 *
 * `ratings` is the board as it stood when the result was filed, so a result is
 * self-contained: a seat that never saw another driver's `ratingUpdate` (or saw
 * it late) still computes the same numbers as everybody else.
 */
export interface ResultMsg {
  type: 'result';
  order: RankedRow[];
  ratings: RankWire[];
  reason: 'finish' | 'forfeit';
  /**
   * The ROOM's verdict on whether this race counts — its rules, not the
   * arithmetic. False means: file nothing. Every seat reads the same flag, and
   * the client that skips its write does so because the room told it to, not
   * because its own button said so. (A field too small to rate is a separate,
   * arithmetic verdict — `RaceVerdict.rated`.)
   */
  rated: boolean;
  /** How long the race lasted, in seconds, as the host measured it. */
  durationSec: number;
  /**
   * The seats that emptied during this race, as the ROOM saw them (plural: a
   * six-seat race can lose more than one driver, where HexMatch's duel could
   * lose only the loser). Lets a survivors' screen name who walked out even if
   * the roster event and this message race — and every one of them is already
   * `left` in `order`, which is what the arithmetic reads.
   */
  departedIds?: string[];
  /** Room clock (ms) when the room filed it. Forms the once-only race key. */
  at: number;
}

export type RaceProtocol =
  | WelcomeMsg
  | LobbyMsg
  | ReadyMsg
  | StartMsg
  | ChatMsg
  | StateMsg
  | EventsMsg
  | SnapshotMsg
  | IntentMsg
  | ResyncMsg
  | ResultsMsg
  | HelloMsg
  | KickMsg
  | PeerStatusMsg
  | RejectMsg
  | KitMsg
  | PlayerRatingMsg
  | RatingUpdateMsg
  | ResultClaimMsg
  | ResultMsg;

/**
 * host → everyone: what the human drivers are carrying, after a pickup or a
 * spend. Small on purpose — a whole snapshot for a kit change froze guests
 * while it was reassembled, and with house-rule items that was constant.
 */
export interface KitMsg {
  type: 'kit';
  kits: { slot: number; inventory: Inventory }[];
}

/** Every `type` tag in the union — the discriminator the room switches on. */
export const RACE_MESSAGE_TYPES = [
  'welcome',
  'lobby',
  'ready',
  'start',
  'chat',
  'state',
  'events',
  'snapshot',
  'intent',
  'resync',
  'results',
  'hello',
  'kick',
  'peerStatus',
  'reject',
  'kit',
  'playerRating',
  'ratingUpdate',
  'resultClaim',
  'result',
] as const;

export type RaceMessageType = RaceProtocol['type'];

// ══════════════════════════════════════════════════════════════════════════
// Packed state: MarbleState[] ⇄ base64
//
// A hand-rolled base64 codec rather than `btoa`/`Buffer` on purpose: this
// module is imported by the ROOM bundle, which is not a browser (`btoa` is not
// there), and by the client, where `Buffer` is not there. One codec, both
// ends, no polyfill.
// ══════════════════════════════════════════════════════════════════════════

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_VALUES = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64_CHARS.length; i++) table[B64_CHARS.charCodeAt(i)] = i;
  return table;
})();

/** Standard base64 (with `=` padding) of `bytes`. */
export function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64_CHARS[b0 >> 2];
    out += B64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64_CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64_CHARS[b2 & 0x3f] : '=';
  }
  return out;
}

/** Decode standard base64; `null` when it is not base64 (bad char, bad padding). */
export function decodeBase64(text: string): Uint8Array | null {
  const body = text.replace(/=+$/, '');
  const padding = text.length - body.length;
  if (padding > 2) return null;
  if (padding !== (4 - (body.length % 4)) % 4) return null;
  const bytes = new Uint8Array(Math.floor((body.length * 3) / 4));
  let at = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < body.length; i++) {
    const code = body.charCodeAt(i);
    const value = code < 128 ? B64_VALUES[code] : -1;
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[at++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes;
}

/**
 * A non-finite value is a broken frame, not a wire error: the guest has to
 * draw SOMETHING, and a NaN in a Matter body poisons every later frame. Zero
 * is the least surprising thing to draw, and the recovery watchdog (a local
 * matter) is what stops it from happening at all.
 */
function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function packFlags(m: MarbleState): number {
  const loop = Number.isFinite(m.loop) ? Math.max(0, Math.min(MAX_LOOP_STAGE, Math.floor(m.loop))) : 0;
  return (
    (m.finished ? FLAG_FINISHED : 0) |
    (m.frozen ? FLAG_FROZEN : 0) |
    (m.oil ? FLAG_OIL : 0) |
    (m.ghost ? FLAG_GHOST : 0) |
    (m.anvil ? FLAG_ANVIL : 0) |
    (loop << 5)
  );
}

function unpackFlags(byte: number): Pick<MarbleState, 'finished' | 'frozen' | 'oil' | 'ghost' | 'anvil' | 'loop'> {
  return {
    finished: (byte & FLAG_FINISHED) !== 0,
    frozen: (byte & FLAG_FROZEN) !== 0,
    oil: (byte & FLAG_OIL) !== 0,
    ghost: (byte & FLAG_GHOST) !== 0,
    anvil: (byte & FLAG_ANVIL) !== 0,
    loop: (byte & FLAG_LOOP_MASK) >>> 5,
  };
}

/** Pack marble states into the base64 a `state` frame carries. */
export function packState(marbles: readonly MarbleState[]): string {
  const bytes = new Uint8Array(marbles.length * BYTES_PER_MARBLE);
  const view = new DataView(bytes.buffer);
  marbles.forEach((m, i) => {
    const at = i * BYTES_PER_MARBLE;
    view.setFloat32(at, finite(m.x), true);
    view.setFloat32(at + 4, finite(m.y), true);
    view.setFloat32(at + 8, finite(m.vx), true);
    view.setFloat32(at + 12, finite(m.vy), true);
    view.setFloat32(at + 16, finite(m.a), true);
    view.setUint8(at + 20, packFlags(m));
  });
  return encodeBase64(bytes);
}

/**
 * Unpack a `state` frame's payload. `null` when it is not a whole frame of
 * `count` marbles — a frame that decodes to the wrong length is nobody's
 * state, and half a marble is worse than none (the resync heals it).
 */
export function unpackState(data: string, count: number = MARBLE_COUNT): MarbleState[] | null {
  const bytes = decodeBase64(data);
  if (!bytes) return null;
  if (!Number.isInteger(count) || count <= 0 || bytes.length !== count * BYTES_PER_MARBLE) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: MarbleState[] = [];
  for (let i = 0; i < count; i++) {
    const at = i * BYTES_PER_MARBLE;
    out.push({
      x: view.getFloat32(at, true),
      y: view.getFloat32(at + 4, true),
      vx: view.getFloat32(at + 8, true),
      vy: view.getFloat32(at + 12, true),
      a: view.getFloat32(at + 16, true),
      ...unpackFlags(view.getUint8(at + 20)),
    });
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// Sequencing (HexMatch's `delta.ts` idea, minus its payload)
// ══════════════════════════════════════════════════════════════════════════

/** Sequence numbers start here and wrap at `SEQ_MODULO`. */
export const SEQ_START = 0;

/** The next sequence number after `seq`. */
export function nextSeq(seq: number): number {
  return (((Number.isInteger(seq) ? seq : SEQ_START) + 1) % SEQ_MODULO + SEQ_MODULO) % SEQ_MODULO;
}

/**
 * True when `next` is not the immediate successor of `prev`: a dropped frame,
 * a replay, or a frame from a host that restarted. `prev` = -1 (nothing yet)
 * makes the first frame of any sequence a non-gap.
 */
export function isSeqGap(prev: number, next: number): boolean {
  return nextSeq(prev) !== next;
}

// ══════════════════════════════════════════════════════════════════════════
// Frame size — the guard HexMatch's `delta.ts` runs before every publish
// ══════════════════════════════════════════════════════════════════════════

/**
 * Serialized size in bytes — the `deltaBytes` precedent: JSON length. The
 * gateway counts the frame it is handed, and this is the same string.
 */
export function frameBytes(msg: RaceProtocol): number {
  return JSON.stringify(msg).length;
}

/** True when `msg` serializes inside `cap` (default: the gateway's own cap). */
export function fitsInFrame(msg: RaceProtocol, cap: number = FRAME_CAP_BYTES): boolean {
  return frameBytes(msg) <= cap;
}

// ══════════════════════════════════════════════════════════════════════════
// Chunked snapshot transfer
// ══════════════════════════════════════════════════════════════════════════

/**
 * Split one full world into frames that each fit the guaranteed 16 KiB cap.
 *
 * `JSON.stringify` output is sliced by UTF-16 code unit and the guest rejoins
 * the exact same string before parsing, so a slice may split anything (an
 * escape, a surrogate pair) without corrupting the result — only the concat
 * matters. The size bound is exact: every frame carries at most
 * `SNAPSHOT_CHUNK_CHARS` data characters plus ~60 bytes of envelope.
 */
export function chunkSnapshot(
  snap: RaceSnapshot,
  seq: number,
  id: number,
  chunkChars: number = SNAPSHOT_CHUNK_CHARS,
): SnapshotMsg[] {
  const json = JSON.stringify(snap);
  const size = Math.max(1, Math.floor(chunkChars));
  const n = Math.max(1, Math.ceil(json.length / size));
  const out: SnapshotMsg[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      type: 'snapshot',
      id: Math.floor(id) >>> 0,
      seq: Math.floor(seq),
      i,
      n,
      data: json.slice(i * size, (i + 1) * size),
    });
  }
  return out;
}

/** A reassembled full world plus the state sequence it represents. */
export interface AssembledSnapshot {
  snap: RaceSnapshot;
  /** The guest resumes at `seq`: snapshot(seq), then frames seq+1, seq+2… */
  seq: number;
}

/**
 * Guest-side reassembly of a chunked snapshot.
 *
 * Strict and self-healing: shape-invalid frames are ignored, a new transfer id
 * abandons whatever was half-received (a resync that overtakes a slow join), a
 * duplicate index does not double-append, and a transfer that never completes
 * simply never yields — `pending` tells the caller to keep buffering frames
 * instead of applying them to a half-applied world.
 */
export class SnapshotAssembler {
  private id = -1;
  private seq = -1;
  private total = 0;
  private parts: string[] = [];
  private filled = 0;

  /** True while a transfer is in flight (some frames seen, not all). */
  get pending(): boolean {
    return this.total > 0 && this.filled < this.total;
  }

  /** Frames still missing; 0 when idle or complete. */
  get missing(): number {
    return this.total > 0 ? this.total - this.filled : 0;
  }

  reset(): void {
    this.id = -1;
    this.seq = -1;
    this.total = 0;
    this.parts = [];
    this.filled = 0;
  }

  /**
   * Feed one frame; returns the reassembled world on the frame that completes
   * the transfer, `null` otherwise.
   */
  accept(msg: unknown): AssembledSnapshot | null {
    if (!msg || typeof msg !== 'object') return null;
    const m = msg as Partial<SnapshotMsg>;
    if (m.type !== 'snapshot') return null;
    const { id, seq, i, n, data } = m;
    if (
      typeof id !== 'number' || !Number.isInteger(id) ||
      typeof seq !== 'number' || !Number.isInteger(seq) ||
      typeof i !== 'number' || !Number.isInteger(i) ||
      typeof n !== 'number' || !Number.isInteger(n) ||
      typeof data !== 'string'
    ) {
      return null;
    }
    if (n <= 0 || n > MAX_SNAPSHOT_CHUNKS || i < 0 || i >= n) return null;
    if (data.length > SNAPSHOT_CHUNK_CHARS) return null;

    if (id !== this.id || n !== this.total) {
      // A new transfer (or a re-cut of this one) — the old partial is dead.
      this.id = id;
      this.seq = seq;
      this.total = n;
      this.parts = new Array<string>(n).fill('');
      this.filled = 0;
    }
    if (this.parts[i] === '') {
      this.parts[i] = data;
      this.filled++;
    }
    if (this.filled < this.total) return null;

    const json = this.parts.join('');
    const atSeq = this.seq;
    this.reset();
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return null; // corrupt transfer: a resync heals it
    }
    // A reassembled world is still UNTRUSTED INPUT: shape-check it before the
    // guest applies it, and drop the transfer rather than half-apply it.
    if (!isRaceSnapshot(parsed)) return null;
    return { snap: parsed as RaceSnapshot, seq: atSeq };
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Validation
//
// Four ways a frame can be wrong, and the code says which:
//
//   version   — a peer from another build (the welcome's `v`). Refuse loudly:
//               a mixed-version room would desync silently.
//   malformed — not an object, unknown type, or a field of the wrong shape.
//   forged    — shaped right, but claims something no honest peer can claim:
//               a nudge harder than ±1, an item that does not exist, a body or
//               seat index that cannot exist, a duplicated finishing order.
//   oversized — serializes past the frame cap (or past the state budget), so
//               the gateway would drop it anyway.
//
// Validators return `ProtocolError | null` (HexMatch's contract) so every
// caller handles the four the same way.
// ══════════════════════════════════════════════════════════════════════════

export type ProtocolErrorCode = 'version' | 'malformed' | 'forged' | 'oversized';

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;
  constructor(code: ProtocolErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ProtocolError';
  }
}

const bad = (message: string) => new ProtocolError('malformed', message);
const forged = (message: string) => new ProtocolError('forged', message);
const oversized = (message: string) => new ProtocolError('oversized', message);

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInt(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isText(value: unknown, maxLength: number): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

/** `#rrggbb` only: the livery is painted into a canvas fill and a style string. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function isTheme(value: unknown): value is TrackTheme {
  if (!value || typeof value !== 'object') return false;
  const t = value as Record<string, unknown>;
  return ['bg1', 'bg2', 'track', 'pipe', 'pipeEdge'].every((key) => typeof t[key] === 'string' && t[key] !== '');
}

/**
 * Read a circuit definition. Strict, because this is the one field a mismatch
 * is fatal in: the profile and the seed ARE the track, so a guest that built a
 * different circuit would read every body index as a different body.
 */
export function readTrackDef(value: unknown): TrackDef | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (!isNumber(p.segments) || p.segments < 0) return null;
  if (!p.weights || typeof p.weights !== 'object' || Array.isArray(p.weights)) return null;
  for (const [key, weight] of Object.entries(p.weights as Record<string, unknown>)) {
    // `__proto__` and friends are refused rather than copied: a JSON key is
    // not a safe object key.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return null;
    if (!isNumber(weight) || weight < 0) return null;
  }
  if (!isTheme(p.theme)) return null;
  return { segments: p.segments, weights: { ...(p.weights as Record<string, number>) }, theme: { ...(p.theme as TrackTheme) } };
}

/** True when the settings describe a custom track (validate before building). */
export function isCustomSettings(settings: RaceSettings | undefined): boolean {
  return typeof settings?.customCode === 'string' && settings.customCode.length > 0;
}

/** Share-code prefix for a valid custom track code (v1 deflate). */
const CUSTOM_CODE_PREFIX = '1-';

/** Read the race settings; `null` when present-but-unreadable. */
export function readRaceSettings(value: unknown): RaceSettings | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Record<string, unknown>;
  let circuit: number | TrackDef;
  if (typeof s.circuit === 'number') {
    // A calendar id. The client resolves it against its own CALENDAR — this
    // module cannot import `season.ts` (it boots the SDK through `storage.ts`).
    if (!Number.isInteger(s.circuit) || s.circuit < 0) return null;
    circuit = s.circuit;
  } else {
    const def = readTrackDef(s.circuit);
    if (!def) return null;
    circuit = def;
  }
  if (s.laps !== undefined && !isInt(s.laps, DEFAULT_LAPS, MAX_LAPS)) return null;
  let items: Partial<Record<ItemType, number>> | undefined;
  if (s.items !== undefined) {
    if (!s.items || typeof s.items !== 'object') return null;
    items = {};
    for (const [key, count] of Object.entries(s.items as Record<string, unknown>)) {
      if (!(ITEM_TYPES as readonly string[]).includes(key)) return null;
      if (!isInt(count, UNLIMITED_ITEM, MAX_HOUSE_ITEMS)) return null;
      items[key as ItemType] = count as number;
    }
  }
  if (s.customCode !== undefined) {
    if (typeof s.customCode !== 'string') return null;
    if (s.customCode.length === 0 || s.customCode.length > MAX_CUSTOM_CODE_CHARS) return null;
    if (!s.customCode.startsWith(CUSTOM_CODE_PREFIX)) return null;
    // Base64url shape check — the full deflate validation is `decodeShareCode`.
    if (!/^[A-Za-z0-9_-]+$/.test(s.customCode.slice(2))) return null;
  }
  if (s.aiItems !== undefined && typeof s.aiItems !== 'boolean') return null;
  let benched: number[] | undefined;
  if (s.benched !== undefined) {
    if (!Array.isArray(s.benched) || s.benched.length > MARBLE_COUNT) return null;
    if (!s.benched.every((slot) => isInt(slot, 0, MARBLE_COUNT - 1))) return null;
    benched = [...new Set(s.benched as number[])];
  }
  return {
    circuit,
    ...(s.laps !== undefined ? { laps: s.laps as number } : {}),
    ...(items ? { items } : {}),
    ...(typeof s.customCode === 'string' ? { customCode: s.customCode } : {}),
    ...(s.aiItems !== undefined ? { aiItems: s.aiItems as boolean } : {}),
    ...(benched ? { benched } : {}),
  };
}

/** Validate the relay stamp: present-or-absent, and a non-empty string when present. */
function validateFrom(msg: { from?: unknown }): ProtocolError | null {
  if (msg.from === undefined) return null;
  if (typeof msg.from !== 'string' || msg.from.length === 0) return bad('Relay stamp is not a player id.');
  return null;
}

/**
 * Validate a driver's garage. The tune is range-checked but NOT summed against
 * `STAT_BUDGET` — same call as `validateSeat`: the budget is a garage rule for
 * building a marble, and refusing a whole room over it would strand everyone.
 */
export function validateGarage(value: unknown): ProtocolError | null {
  if (!value || typeof value !== 'object') return bad('Garage is not an object.');
  const g = value as Record<string, unknown>;
  if (!isText(g.name, MAX_NAME_LENGTH)) return bad('Garage name is missing or too long.');
  if (typeof g.color !== 'string' || !HEX_COLOR.test(g.color)) return bad('Garage livery is not a #rrggbb colour.');
  if (!g.stats || typeof g.stats !== 'object') return bad('Garage has no stats.');
  const stats = g.stats as Record<string, unknown>;
  for (const key of ['weight', 'speed', 'bounce']) {
    if (!isInt(stats[key], STAT_MIN, STAT_MAX)) return forged(`Garage stat ${key} is not ${STAT_MIN}..${STAT_MAX}.`);
  }
  if (!isInt(g.portrait, 0, 4095)) return forged('Garage portrait index is out of range.');
  // A kit is counts, and counts have a ceiling: an inventory is not a wallet a
  // client may top up on the way through the wire.
  if (g.inventory !== undefined && readInventory(g.inventory) === null) return forged('Garage inventory is not an inventory.');
  return null;
}

/**
 * Validate one grid seat. Stats are range-checked (1..10) but NOT summed
 * against `STAT_BUDGET`: the budget is a garage rule for building a marble,
 * not a wire rule, and refusing a roster over it would strand a whole room.
 */
export function validateSeat(value: unknown): ProtocolError | null {
  if (!value || typeof value !== 'object') return bad('Seat is not an object.');
  const s = value as Record<string, unknown>;
  if (!isInt(s.slot, 0, MARBLE_COUNT - 1)) return bad(`Seat slot is not 0..${MARBLE_COUNT - 1}.`);
  if (typeof s.playerId !== 'string') return bad('Seat player id is not a string.');
  if (!isText(s.name, MAX_NAME_LENGTH)) return bad('Seat name is missing or too long.');
  if (typeof s.color !== 'string' || !HEX_COLOR.test(s.color)) return bad('Seat livery is not a #rrggbb colour.');
  if (!s.stats || typeof s.stats !== 'object') return bad('Seat has no stats.');
  const stats = s.stats as Record<string, unknown>;
  for (const key of ['weight', 'speed', 'bounce']) {
    if (!isInt(stats[key], STAT_MIN, STAT_MAX)) return forged(`Seat stat ${key} is not ${STAT_MIN}..${STAT_MAX}.`);
  }
  if (!isInt(s.portrait, 0, 4095)) return forged('Seat portrait index is out of range.');
  if (typeof s.isAI !== 'boolean') return bad('Seat isAI flag is not a boolean.');
  if (s.ready !== undefined && typeof s.ready !== 'boolean') return bad('Seat ready flag is not a boolean.');
  if (s.inventory !== undefined && readInventory(s.inventory) === null) return forged('Seat inventory is not an inventory.');
  if (s.isAI && s.playerId !== '') return forged('An AI seat must not claim a player id.');
  if (!s.isAI && s.playerId === '') return forged('A human seat must carry its player id.');
  return null;
}

/**
 * Validate a whole grid: exactly `MARBLE_COUNT` seats, each slot present
 * exactly once. The packed frames are addressed by slot, so a short or
 * duplicated roster is a grid the guest cannot read.
 */
export function validateSeats(seats: unknown): ProtocolError | null {
  if (!Array.isArray(seats)) return bad('Seats are not a list.');
  if (seats.length !== MARBLE_COUNT) return bad(`A grid is ${MARBLE_COUNT} seats, got ${seats.length}.`);
  const seen = new Set<number>();
  for (const seat of seats) {
    const err = validateSeat(seat);
    if (err) return err;
    const slot = (seat as Seat).slot;
    if (seen.has(slot)) return forged(`Seat slot ${slot} is claimed twice.`);
    seen.add(slot);
  }
  return null;
}

/**
 * Reject a welcome we cannot safely join (§11 of the epic). A `version`
 * mismatch is the common wild case — a guest left on an old tab after a
 * deploy — so it gets the actionable reload message rather than a silent
 * desync.
 */
export function validateWelcome(msg: unknown): ProtocolError | null {
  if (!msg || typeof msg !== 'object') return bad('Welcome is not an object.');
  const o = msg as Partial<WelcomeMsg>;
  if (o.type !== 'welcome') return bad('Message is not a welcome.');
  if (typeof o.v !== 'number') return bad('Welcome has no protocol version.');
  if (o.v !== PROTOCOL_VERSION) return new ProtocolError('version', VERSION_MISMATCH_MESSAGE);
  if (!isNumber(o.seed)) return bad('Welcome has no map seed.');
  if (typeof o.hostId !== 'string' || o.hostId.length === 0) return bad('Welcome has no host.');
  const seats = validateSeats(o.seats);
  if (seats) return seats;
  // Settings are part of the welcome, not an afterthought: the circuit is the
  // track, and a guest that guessed it would build the wrong world.
  if (!readRaceSettings(o.settings)) return bad('Welcome settings are missing or malformed.');
  // RK-03: the board rides the greeting. Present and unreadable is refused
  // rather than half-read — a lobby that shows one driver's number wrong is a
  // lobby whose race nobody can check afterwards.
  if (o.ratings !== undefined && !readRankBoard(o.ratings)) return bad('Welcome ratings are not a board.');
  return null;
}

function validateState(msg: StateMsg): ProtocolError | null {
  if (!isInt(msg.seq, 0, SEQ_MODULO - 1)) return bad('State sequence is not a sequence number.');
  if (!isNumber(msg.t) || msg.t < 0) return bad('State clock is not a non-negative number.');
  if (typeof msg.marbles !== 'string') return bad('State payload is not a string.');
  if (msg.marbles.length !== packedStateLength()) {
    return bad(`State payload is ${msg.marbles.length} characters, expected ${packedStateLength()}.`);
  }
  // Unpacking is the cheapest complete check there is: a payload that does not
  // decode to ten whole marbles is not a state frame.
  if (!unpackState(msg.marbles)) return bad('State payload is not packed marble states.');
  const bytes = frameBytes(msg);
  if (bytes > STATE_BUDGET_BYTES) return oversized(`State frame is ${bytes} bytes (budget ${STATE_BUDGET_BYTES}).`);
  return null;
}

function validateEvent(value: unknown): ProtocolError | null {
  if (!value || typeof value !== 'object') return bad('Event is not an object.');
  const e = value as Record<string, unknown>;
  const body = (i: unknown) => (isInt(i, 0, MAX_BODY_INDEX) ? null : forged(`Body index ${String(i)} is not 0..${MAX_BODY_INDEX}.`));
  const seat = (s: unknown) => (isInt(s, 0, MARBLE_COUNT - 1) ? null : forged(`Seat ${String(s)} is not 0..${MARBLE_COUNT - 1}.`));
  switch (e.kind) {
    case 'peg': {
      const err = body(e.i) ?? seat(e.seat);
      return err;
    }
    case 'crate': {
      if (!isNumber(e.hp) || e.hp < 0) return bad('Crate event has no hit points.');
      if (typeof e.broken !== 'boolean') return bad('Crate event has no broken flag.');
      return body(e.i);
    }
    case 'box': {
      if (typeof e.taken !== 'boolean') return bad('Box event has no taken flag.');
      if (e.seat !== undefined) {
        const err = seat(e.seat);
        if (err) return err;
      }
      return body(e.i);
    }
    case 'oil': {
      if (!isNumber(e.x) || !isNumber(e.y)) return bad('Oil event has no position.');
      if (!isNumber(e.r) || e.r <= 0) return bad('Oil event has no radius.');
      if (!isNumber(e.until)) return bad('Oil event has no expiry.');
      return seat(e.seat);
    }
    case 'freeze': {
      if (!isNumber(e.until)) return bad('Freeze event has no thaw time.');
      return seat(e.seat) ?? seat(e.by);
    }
    case 'shock': {
      if (!isNumber(e.x) || !isNumber(e.y)) return bad('Shock event has no position.');
      return seat(e.seat);
    }
    case 'item': {
      if (typeof e.item !== 'string') return bad('Item event has no item.');
      if (!(ITEM_TYPES as readonly string[]).includes(e.item)) {
        return forged(`Item "${e.item}" is not an item this game has.`);
      }
      return seat(e.seat);
    }
    case 'finish': {
      if (!isNumber(e.time) || e.time < 0) return bad('Finish event has no time.');
      if (!isInt(e.rank, 1, MARBLE_COUNT)) return forged(`Finish rank ${String(e.rank)} is not 1..${MARBLE_COUNT}.`);
      return seat(e.seat);
    }
    case 'sound': {
      if (typeof e.cue !== 'string') return bad('Sound event has no cue.');
      if (!isSoundEvent(e.cue)) return forged(`Sound cue "${e.cue}" is not one of: ${SOUND_EVENTS.join(', ')}.`);
      if (e.seat !== undefined) return seat(e.seat);
      return null;
    }
    case 'switch': {
      if (e.side !== 0 && e.side !== 1) return bad('Switch event has no side.');
      return body(e.i);
    }
    case 'trapdoor': {
      if (typeof e.open !== 'boolean') return bad('Trapdoor event has no open flag.');
      return body(e.i);
    }
    case 'hold': {
      if (typeof e.until !== 'number' || !Number.isFinite(e.until) || e.until < 0) return bad('Hold event has no release time.');
      if (e.of !== undefined && !['tunnel', 'wheel', 'screw'].includes(e.of as string)) return bad('Hold event names no carrier this build knows.');
      return seat(e.seat);
    }
    case 'seesaw': {
      if (typeof e.angle !== 'number' || !Number.isFinite(e.angle) || Math.abs(e.angle) > 3) return bad('Seesaw event has no sane angle.');
      if (typeof e.angVel !== 'number' || !Number.isFinite(e.angVel)) return bad('Seesaw event has no angular velocity.');
      return body(e.i);
    }
    case 'bridge': {
      if (!Array.isArray(e.sag) || e.sag.length < 1 || e.sag.length > 12) return bad('Bridge event has a malformed sag chain.');
      for (const s of e.sag) if (typeof s !== 'number' || !Number.isFinite(s) || Math.abs(s) > 400) return bad('Bridge event has a plank out of range.');
      return body(e.i);
    }
    default:
      return bad(`Unknown event kind "${String(e.kind)}".`);
  }
}

function validateEvents(msg: EventsMsg): ProtocolError | null {
  if (!isInt(msg.seq, 0, SEQ_MODULO - 1)) return bad('Event sequence is not a sequence number.');
  if (!Array.isArray(msg.list)) return bad('Events payload is not a list.');
  if (msg.list.length > MAX_EVENTS_PER_FRAME) {
    return oversized(`Events frame carries ${msg.list.length} events (cap ${MAX_EVENTS_PER_FRAME}).`);
  }
  for (const event of msg.list) {
    const err = validateEvent(event);
    if (err) return err;
  }
  return null;
}

function validateSnapshotChunk(msg: SnapshotMsg): ProtocolError | null {
  if (!isInt(msg.id, 0, 0xffffffff)) return bad('Snapshot transfer id is not an id.');
  if (!isInt(msg.seq, 0, SEQ_MODULO - 1)) return bad('Snapshot sequence is not a sequence number.');
  if (!isInt(msg.i, 0, MAX_SNAPSHOT_CHUNKS - 1)) return bad('Snapshot frame index is out of range.');
  if (!isInt(msg.n, 1, MAX_SNAPSHOT_CHUNKS)) return forged(`Snapshot claims ${msg.n} frames (cap ${MAX_SNAPSHOT_CHUNKS}).`);
  if (msg.i >= msg.n) return forged(`Snapshot frame ${msg.i} is past the end of a ${msg.n}-frame transfer.`);
  if (typeof msg.data !== 'string') return bad('Snapshot frame has no data.');
  if (msg.data.length > SNAPSHOT_CHUNK_CHARS) {
    return oversized(`Snapshot frame carries ${msg.data.length} characters (cap ${SNAPSHOT_CHUNK_CHARS}).`);
  }
  return null;
}

function validateIntent(msg: IntentMsg): ProtocolError | null {
  if (msg.kind === 'nudge') {
    if (!isNumber(msg.v)) return bad('Nudge is not a number.');
    // Analog touch: -1..1. Anything stronger is a client asking for a push the
    // game cannot give, which is exactly what a forged intent looks like.
    if (msg.v < -1 || msg.v > 1) return forged(`Nudge ${msg.v} is outside -1..1.`);
    return null;
  }
  if (msg.kind === 'item') {
    if (typeof msg.item !== 'string') return bad('Item intent has no item.');
    if (!(ITEM_TYPES as readonly string[]).includes(msg.item)) {
      return forged(`Item "${msg.item}" is not an item this game has.`);
    }
    return null;
  }
  return bad(`Unknown intent kind "${String((msg as { kind?: unknown }).kind)}".`);
}

function readInventory(value: unknown): Inventory | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const out = {} as Inventory;
  for (const item of ITEM_TYPES) {
    const count = raw[item];
    if (!isInt(count, 0, MAX_ITEM_STACK)) return null;
    out[item] = count as number;
  }
  return out;
}

/**
 * Shape check for a whole world — the payload a chunked transfer reassembles
 * into. A predicate rather than a `ProtocolError` because the assembler needs
 * the narrowing, not a message: a transfer that parses into something that is
 * not a race is dropped and resynced, never half-applied.
 */
export function isRaceSnapshot(value: unknown): value is RaceSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const s = value as Record<string, unknown>;
  if (!isNumber(s.t) || s.t < 0) return false;
  if (!isNumber(s.clock) || s.clock < 0) return false;
  if (typeof s.started !== 'boolean') return false;
  if (!Array.isArray(s.marbles) || s.marbles.length !== MARBLE_COUNT) return false;
  for (const m of s.marbles) {
    if (!m || typeof m !== 'object') return false;
    const marble = m as Record<string, unknown>;
    for (const key of ['x', 'y', 'vx', 'vy', 'a']) {
      if (!isNumber(marble[key])) return false;
    }
    for (const key of ['finished', 'frozen', 'oil', 'ghost', 'anvil']) {
      if (typeof marble[key] !== 'boolean') return false;
    }
    if (!isInt(marble.loop, 0, MAX_LOOP_STAGE)) return false;
  }
  if (!Array.isArray(s.destroyed)) return false;
  for (const i of s.destroyed) if (!isInt(i, 0, MAX_BODY_INDEX)) return false;
  if (!Array.isArray(s.boxes)) return false;
  for (const box of s.boxes) {
    if (!box || typeof box !== 'object') return false;
    if (!isInt((box as Record<string, unknown>).i, 0, MAX_BODY_INDEX)) return false;
    if (typeof (box as Record<string, unknown>).active !== 'boolean') return false;
  }
  if (!Array.isArray(s.oils)) return false;
  for (const oil of s.oils) {
    if (!oil || typeof oil !== 'object') return false;
    const o = oil as Record<string, unknown>;
    if (!isNumber(o.x) || !isNumber(o.y) || !isNumber(o.r) || o.r <= 0) return false;
    if (!isInt(o.owner, 0, MARBLE_COUNT - 1)) return false;
    if (!isNumber(o.expiresAt)) return false;
  }
  const perSeat = (list: unknown, check: (v: unknown) => boolean): boolean =>
    Array.isArray(list) && list.length === MARBLE_COUNT && list.every(check);
  if (!perSeat(s.inventories, (inv) => readInventory(inv) !== null)) return false;
  if (!perSeat(s.pegs, (p) => isInt(p, 0, 100_000))) return false;
  if (!perSeat(s.times, (t) => t === null || (isNumber(t) && (t as number) >= 0))) return false;
  if (!Array.isArray(s.order)) return false;
  if (s.order.length > MARBLE_COUNT) return false;
  for (const seat of s.order) if (!isInt(seat, 0, MARBLE_COUNT - 1)) return false;
  if (new Set(s.order).size !== s.order.length) return false;
  return true;
}

function validateResults(msg: ResultsMsg): ProtocolError | null {
  if (!Array.isArray(msg.order) || msg.order.length > MARBLE_COUNT) return bad('Result order is not a finishing order.');
  for (const seat of msg.order) {
    if (!isInt(seat, 0, MARBLE_COUNT - 1)) return forged(`Result seat ${String(seat)} is not 0..${MARBLE_COUNT - 1}.`);
  }
  // One seat, one place: a duplicated order is a claim the race cannot make.
  if (new Set(msg.order).size !== msg.order.length) return forged('Result order lists a seat twice.');
  if (!Array.isArray(msg.times) || msg.times.length !== MARBLE_COUNT) return bad('Result times are not one per seat.');
  for (const time of msg.times) {
    if (time !== null && (!isNumber(time) || time < 0)) return bad('Result time is not a race time.');
  }
  if (!Array.isArray(msg.pegs) || msg.pegs.length !== MARBLE_COUNT) return bad('Result pegs are not one per seat.');
  for (const pegs of msg.pegs) {
    if (!isInt(pegs, 0, 100_000)) return bad('Result peg count is not a count.');
  }
  return null;
}

/**
 * One rating as it travels, or `null` when it is not one (RK-03).
 *
 * Tolerant in the direction that matters and strict in the other: the rating
 * itself is clamped to a legal number (`rating.ts`'s floor, no ceiling), the
 * game count is floored at zero, and a row that carries no id at all is
 * refused — a board row nobody can be named by is a row nobody can be rated
 * against.
 */
export function readRankWire(value: unknown): RankWire | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  if (!isText(o.playerId, MAX_NAME_LENGTH)) return null;
  if (!isNumber(o.rating)) return null;
  if (!isNumber(o.games) || o.games < 0) return null;
  return {
    playerId: o.playerId as string,
    rating: Math.max(RATING_FLOOR, Math.round(o.rating)),
    games: Math.max(0, Math.floor(o.games)),
  };
}

/** A whole board, or `null` when any row is not a rating (RK-03). */
export function readRankBoard(value: unknown): RankWire[] | null {
  if (!Array.isArray(value) || value.length > MAX_RATING_ROWS) return null;
  const board: RankWire[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const wire = readRankWire(entry);
    if (!wire) return null;
    // One row per driver: a duplicated id would let a seat skew its own pair.
    if (seen.has(wire.playerId)) continue;
    seen.add(wire.playerId);
    board.push(wire);
  }
  return board;
}

/**
 * A rated classification: one row per rated HUMAN, in finishing order (RK-03).
 *
 * The two rules a race cannot do without: every row names a driver, and nobody
 * appears twice (a duplicated row would be counted twice in the pairwise
 * arithmetic). Order between finishers is the array's, so it is not checked
 * here — the rows are simply read in the order they arrived.
 */
export function readRankedOrder(value: unknown): RankedRow[] | null {
  if (!Array.isArray(value) || value.length > MAX_RATED_DRIVERS) return null;
  const order: RankedRow[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;
    const o = entry as Record<string, unknown>;
    if (!isText(o.playerId, MAX_NAME_LENGTH)) return null;
    if (typeof o.finished !== 'boolean') return null;
    if (o.left !== undefined && typeof o.left !== 'boolean') return null;
    if (seen.has(o.playerId as string)) return null;
    seen.add(o.playerId as string);
    order.push({
      playerId: o.playerId as string,
      finished: o.finished,
      ...(o.left === true ? { left: true } : {}),
    });
  }
  return order;
}

export interface ValidateOptions {
  /** Override the serialized-size cap (default `FRAME_CAP_BYTES`). */
  maxBytes?: number;
}

/**
 * Narrow an unknown inbound payload to the union. RUN delivers game messages
 * as one discriminated object — `type` is the whole check here; each handler
 * validates the fields it reads (as `validateMessage` does for all of them).
 */
export function isRaceProtocol(msg: unknown): msg is RaceProtocol {
  if (!msg || typeof msg !== 'object') return false;
  const t = (msg as { type?: unknown }).type;
  return (RACE_MESSAGE_TYPES as readonly unknown[]).includes(t);
}

function describeType(msg: unknown): string {
  if (msg && typeof msg === 'object' && 'type' in msg) {
    const t = (msg as { type: unknown }).type;
    return typeof t === 'string' ? `"${t}"` : String(t);
  }
  return typeof msg;
}

/**
 * Validate any inbound frame: unknown type, oversized, malformed or forged —
 * `null` means the message is safe to act on.
 *
 * The relay (MP-03) and the client session (MP-04/05) both call this on every
 * message before they look at a field, which is what makes "forged state is
 * dropped" a property of the wire rather than of whoever wrote the handler.
 */
export function validateMessage(msg: unknown, opts: ValidateOptions = {}): ProtocolError | null {
  if (!isRaceProtocol(msg)) return bad(`Unknown message type: ${describeType(msg)}.`);
  const cap = opts.maxBytes ?? FRAME_CAP_BYTES;
  const bytes = frameBytes(msg);
  if (bytes > cap) return oversized(`Frame is ${bytes} bytes (cap ${cap}).`);

  switch (msg.type) {
    case 'welcome':
      return validateWelcome(msg);
    case 'lobby': {
      const err = validateSeats(msg.seats);
      if (err) return err;
      // A settings block that is PRESENT and unreadable is refused rather than
      // half-read: two seats racing different circuits is the desync the
      // version check exists to prevent.
      if (msg.settings !== undefined && !readRaceSettings(msg.settings)) return bad('Lobby settings are malformed.');
      if (msg.open !== undefined && typeof msg.open !== 'boolean') return bad('Lobby open flag is not a boolean.');
      return null;
    }
    case 'kit': {
      if (!Array.isArray(msg.kits) || msg.kits.length > MARBLE_COUNT) return bad('Kit list is malformed.');
      for (const kit of msg.kits) {
        if (!kit || !isInt(kit.slot, 0, MARBLE_COUNT - 1) || readInventory(kit.inventory) === null) return bad('Kit entry is malformed.');
      }
      return null;
    }
    case 'ready': {
      if (typeof msg.ready !== 'boolean') return bad('Ready is not a boolean.');
      if (msg.garage !== undefined) {
        const err = validateGarage(msg.garage);
        if (err) return err;
      }
      return validateFrom(msg);
    }
    // Nothing to forge (MP-10): a hello is a request for the room's own
    // greeting, and the room answers the SENDER — there is nothing in it to lie
    // about, and nothing to check.
    case 'hello':
      return null;
    case 'kick':
      // Host-only by ROUTING, not by shape: the room drops a kick from anyone
      // but the host. All the wire can insist on is that it names a driver.
      return typeof msg.playerId === 'string' && msg.playerId.length > 0 ? null : bad('Kick names no driver.');
    case 'start':
      return isNumber(msg.countdownAt) ? null : bad('Start has no countdown time.');
    // MP-CHAT. A line is a string, it is not empty, and it is not a speech.
    // Anything longer than the cap is REFUSED rather than cut: a half-truth
    // that reads as the whole sentence is worse than a line that never
    // arrived, and both ends clamp before they send.
    case 'chat': {
      if (typeof msg.text !== 'string') return bad('Chat has no line.');
      if (msg.text.trim().length === 0) return bad('Chat is empty.');
      if (msg.text.length > MAX_CHAT_LENGTH) return bad(`Chat is longer than ${MAX_CHAT_LENGTH} characters.`);
      return validateFrom(msg);
    }
    case 'state':
      return validateState(msg);
    case 'events':
      return validateEvents(msg);
    case 'snapshot':
      return validateSnapshotChunk(msg);
    case 'intent': {
      const err = validateIntent(msg);
      return err ?? validateFrom(msg);
    }
    case 'resync':
      return validateFrom(msg);
    case 'results':
      return validateResults(msg);
    // RK-03. Shape only for the rating itself: a number that is not a number is
    // malformed, and a rating below the floor is CLAMPED rather than refused
    // (`readRankWire`) — the board only ever feeds an expectation.
    case 'playerRating': {
      if (!isText(msg.playerId, MAX_NAME_LENGTH)) return bad('Rating names no driver.');
      if (!isNumber(msg.rating)) return bad('Rating is not a number.');
      if (!isNumber(msg.games) || msg.games < 0) return bad('Rating has no game count.');
      if (!isText(msg.joinToken, 128)) return bad('Rating has no join token.');
      return null;
    }
    case 'ratingUpdate':
      return readRankBoard(msg.ratings) ? null : bad('Rating update is not a board.');
    case 'resultClaim': {
      if (!readRankedOrder(msg.order)) return bad('Result claim is not a classification.');
      if (!isNumber(msg.durationSec) || msg.durationSec < 0) return bad('Result claim has no duration.');
      // Required, not optional: "was this race rated" must never be a question
      // two peers can answer differently by omission.
      if (typeof msg.rated !== 'boolean') return bad('Result claim does not say whether the race is rated.');
      return null;
    }
    case 'result': {
      if (!readRankedOrder(msg.order)) return bad('Result is not a classification.');
      if (!readRankBoard(msg.ratings)) return bad('Result has no rating board.');
      if (msg.reason !== 'finish' && msg.reason !== 'forfeit') return bad('Result has no verdict.');
      // Both required: every seat must be able to tell, from the result alone,
      // whether the race counted and how long it lasted.
      if (typeof msg.rated !== 'boolean') return bad('Result does not say whether the race counted.');
      if (!isNumber(msg.durationSec) || msg.durationSec < 0) return bad('Result has no duration.');
      if (msg.departedIds !== undefined) {
        if (!Array.isArray(msg.departedIds) || msg.departedIds.length > MAX_RATED_DRIVERS) {
          return bad('Result has no departing drivers.');
        }
        for (const id of msg.departedIds) {
          if (!isText(id, MAX_NAME_LENGTH)) return bad('Result names no departing driver.');
        }
      }
      if (!isNumber(msg.at) || msg.at < 0) return bad('Result has no room clock.');
      return null;
    }
    case 'peerStatus': {
      if (typeof msg.playerId !== 'string' || msg.playerId.length === 0) return bad('Peer status has no player id.');
      if (msg.status !== 'disconnected' && msg.status !== 'reconnected') return bad('Peer status is not a status.');
      if (msg.graceMs !== undefined && (!isNumber(msg.graceMs) || msg.graceMs < 0)) return bad('Peer grace is not a duration.');
      if (msg.username !== undefined && typeof msg.username !== 'string') return bad('Peer username is not a string.');
      return null;
    }
    case 'reject':
      return typeof msg.reason === 'string' ? null : bad('Reject has no reason.');
    default:
      return bad(`Unhandled message type: ${describeType(msg)}.`);
  }
}

/** The message, when it validates; `null` when it must be dropped. */
export function readMessage(raw: unknown): RaceProtocol | null {
  return validateMessage(raw) === null ? (raw as RaceProtocol) : null;
}

/** The `reject` frame a refused join is answered with. */
export function rejectionFor(err: ProtocolError): RejectMsg {
  return { type: 'reject', reason: err.message };
}
