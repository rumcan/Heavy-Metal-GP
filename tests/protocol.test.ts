// ══════════════════════════════════════════════════════════════════════════
// MP-02 — race protocol tests (ticket #13).
//
// The acceptance list, plus the rules that make the wire survivable:
//
//   1. THE SIZE FACT: a ten-marble `state` frame stays far under 4 KiB, and
//      every frame stays under the gateway's 16 KiB.
//   2. EVERY MESSAGE VALIDATES — one example per type, through the one door
//      (`validateMessage`) the relay and the session will both use.
//   3. THE REFUSALS: unknown types, oversized frames, forged values (a nudge
//      harder than ±1, an item the game does not have, a body index no track
//      has, a seat that is not on the grid, a finishing order with one marble
//      in two places) and a version mismatch that produces the reload message.
//   4. CHUNKED SNAPSHOTS: a full world splits, reassembles out of order,
//      survives a newer transfer overtaking it, and is DROPPED when the
//      reassembled bytes do not describe a world.
//   5. THE SEAM: the protocol module stays importable by the room bundle (no
//      SDK, no Matter, no engine) and both the transport and the room now
//      speak this union.
//
// No browser, no network, no room server: this file imports the protocol
// directly. `src/game/track.ts` appears only to pin `MARBLE_COUNT` against the
// real grid — Matter.js runs fine in Node, and the protocol itself must never
// import it.
// ══════════════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');

import {
  BYTES_PER_MARBLE,
  FRAME_CAP_BYTES,
  HOST_LEFT_REASON,
  MARBLE_COUNT,
  MAX_BODY_INDEX,
  MAX_EVENTS_PER_FRAME,
  MAX_LOOP_STAGE,
  MAX_SNAPSHOT_CHUNKS,
  PROTOCOL_VERSION,
  RACE_MESSAGE_TYPES,
  SEQ_MODULO,
  SNAPSHOT_CHUNK_CHARS,
  SnapshotAssembler,
  STATE_BUDGET_BYTES,
  VERSION_MISMATCH_MESSAGE,
  chunkSnapshot,
  decodeBase64,
  defaultRaceSettings,
  encodeBase64,
  frameBytes,
  isSeqGap,
  nextSeq,
  packedStateLength,
  packState,
  readMessage,
  rejectionFor,
  unpackState,
  validateMessage,
  isRaceSnapshot,
  validateWelcome,
  type EventsMsg,
  type ValidateOptions,
  type MarbleState,
  type RaceEvent,
  type RaceProtocol,
  type RaceSnapshot,
  type Seat,
  type StateMsg,
} from '../src/net/protocol';
import { GRID_N, generateTrack } from '../src/game/track';
import type { TrackProfile } from '../src/game/types';

// ══════════════════════════════════════════════════════════════════════════
// Builders — one valid example of everything
// ══════════════════════════════════════════════════════════════════════════

const THEME: TrackProfile['theme'] = { bg1: '#0b0f14', bg2: '#101820', track: '#141e28', pipe: '#354657', pipeEdge: '#62778c' };
const CIRCUIT: TrackProfile = { segments: 33, weights: { Chicane: 2 }, theme: THEME };

function seat(slot: number, over: Partial<Seat> = {}): Seat {
  return {
    slot,
    playerId: slot === 0 ? 'player-host' : '',
    name: slot === 0 ? 'You' : `Rival ${slot}`,
    color: slot === 0 ? '#d63e2e' : '#67e8f9',
    stats: { weight: 5, speed: 5, bounce: 5 },
    portrait: slot,
    isAI: slot !== 0,
    ready: true,
    ...over,
  };
}

const SEATS: Seat[] = Array.from({ length: MARBLE_COUNT }, (_, i) => seat(i));

function marble(i: number): MarbleState {
  return {
    x: 120 + i * 66.5,
    y: 4300.25 + i * 900,
    vx: -3.5 + i * 0.75,
    vy: 8.125 - i,
    a: i * 0.4,
    finished: i < 2,
    frozen: i === 3,
    oil: i === 4,
    ghost: i === 5,
    anvil: i === 6,
    loop: i % (MAX_LOOP_STAGE + 1),
  };
}

const MARBLES: MarbleState[] = Array.from({ length: MARBLE_COUNT }, (_, i) => marble(i));

const STATE: StateMsg = { type: 'state', seq: 41, t: 12345.5, marbles: packState(MARBLES) };

const EVENTS: EventsMsg = {
  type: 'events',
  seq: 41,
  list: [
    { kind: 'peg', i: 512, seat: 0 },
    { kind: 'crate', i: 900, hp: 4.5, broken: false },
    { kind: 'box', i: 33, taken: true, seat: 2 },
    { kind: 'box', i: 33, taken: false },
    { kind: 'oil', x: 120.5, y: 400.25, r: 48, seat: 1, until: 21200 },
    { kind: 'freeze', seat: 4, by: 1, until: 18000 },
    { kind: 'shock', seat: 1, x: 300, y: 900 },
    { kind: 'item', seat: 0, item: 'rocket' },
    { kind: 'finish', seat: 0, time: 48250, rank: 1 },
    { kind: 'sound', cue: 'peg', seat: 0 },
    { kind: 'sound', cue: 'gate' },
  ],
};

function snapshot(over: Partial<RaceSnapshot> = {}): RaceSnapshot {
  return {
    t: 61000,
    clock: 60000,
    started: true,
    marbles: MARBLES,
    destroyed: [0, 12, 340, 899],
    boxes: [
      { i: 33, active: false },
      { i: 78, active: true },
    ],
    oils: [{ x: 120.5, y: 400.25, r: 48, owner: 1, expiresAt: 69000 }],
    inventories: Array.from({ length: MARBLE_COUNT }, () => ({
      rocket: 1, jump: 0, oil: 2, shock: 0, anvil: 0, aero: 0, freeze: 0, ghost: 9,
    })),
    pegs: Array.from({ length: MARBLE_COUNT }, (_, i) => i * 3),
    times: Array.from({ length: MARBLE_COUNT }, (_, i) => (i < 2 ? 48250 + i * 900 : null)),
    order: [0, 1],
    ...over,
  };
}

const INVENTORY = { rocket: 1, jump: 0, oil: 2, shock: 0, anvil: 0, aero: 0, freeze: 0, ghost: 9 };

/** One valid frame per message type — the "every message validates" table. */
const VALID: RaceProtocol[] = [
  { type: 'welcome', v: PROTOCOL_VERSION, seed: 987654321, hostId: 'player-host', seats: SEATS, settings: defaultRaceSettings() },
  { type: 'welcome', v: PROTOCOL_VERSION, seed: 1, hostId: 'player-host', seats: SEATS, settings: { circuit: CIRCUIT, laps: 3 } },
  { type: 'lobby', seats: SEATS },
  { type: 'ready', ready: true },
  { type: 'start', countdownAt: 1_700_000_000_000 },
  STATE,
  EVENTS,
  { type: 'snapshot', id: 3, seq: 41, i: 0, n: 1, data: '{"t":1}' },
  { type: 'intent', kind: 'nudge', v: -1 },
  { type: 'intent', kind: 'nudge', v: 0 },
  { type: 'intent', kind: 'nudge', v: 0.5 },
  { type: 'intent', kind: 'item', item: 'freeze' },
  { type: 'resync' },
  {
    type: 'results',
    order: [0, 1, 2],
    times: [48250, 49150, 50000, null, null, null, null, null, null, null],
    pegs: [7, 3, 0, 1, 2, 3, 4, 5, 6, 0],
  },
  { type: 'peerStatus', playerId: 'player-guest', status: 'disconnected', graceMs: 47_000, username: 'Rival 1' },
  { type: 'peerStatus', playerId: 'player-guest', status: 'reconnected' },
  { type: 'reject', reason: HOST_LEFT_REASON },
];

/** Static and dynamic import specifiers of a source file (comments cannot fake one). */
function importSpecifiers(file: string): string[] {
  const source = readFileSync(join(ROOT, file), 'utf8');
  return [...source.matchAll(/from\s+'([^']+)'|import\(\s*'([^']+)'\s*\)/g)].map((m) => m[1] ?? m[2]);
}

/** The error a frame is refused with, or null. */
const check = (msg: unknown, opts?: ValidateOptions) => validateMessage(msg, opts);

// ══════════════════════════════════════════════════════════════════════════
// 1. The size facts
// ══════════════════════════════════════════════════════════════════════════

test('MP-02 size: ten marbles pack into one frame far under the 4 KiB budget', () => {
  // The ticket's acceptance: `state` for ten marbles stays under 4 KiB.
  const bytes = frameBytes(STATE);
  assert.equal(packedStateLength(), 280);
  assert.ok(bytes < STATE_BUDGET_BYTES, `state frame is ${bytes} bytes (budget ${STATE_BUDGET_BYTES})`);
  // And the real number, so a future field cannot quietly eat the headroom:
  // 21 bytes a marble, base64'd, plus the envelope — ~330 bytes of 4096.
  assert.ok(bytes < 512, `state frame is ${bytes} bytes, expected ~330`);
  // Twenty of these a second, and the 16 KiB frame is still mostly empty.
  assert.ok(bytes < FRAME_CAP_BYTES / 20, `20 Hz × ${bytes} bytes leaves no headroom in a ${FRAME_CAP_BYTES} byte frame`);
});

test('MP-02 size: the caps are the ones the gateway enforces', () => {
  assert.equal(FRAME_CAP_BYTES, 16 * 1024);
  assert.equal(BYTES_PER_MARBLE, 21, 'five float32 plus one flag byte');
  assert.ok(SNAPSHOT_CHUNK_CHARS * 2 <= FRAME_CAP_BYTES, 'two chunks plus their envelopes fit the cap');
  assert.equal(STATE_BUDGET_BYTES, 4096);
  for (const msg of VALID) {
    assert.ok(frameBytes(msg) <= FRAME_CAP_BYTES, `${msg.type} frame is oversized`);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 2. Packing
// ══════════════════════════════════════════════════════════════════════════

test('MP-02 pack: the byte layout is pinned, so both ends read the same bytes', () => {
  // Two marbles, one with every flag set: 42 bytes → 56 base64 characters.
  // Hardcoded on purpose — endianness is stated, not assumed, and a change
  // here is a wire change (bump PROTOCOL_VERSION).
  const pinned = packState([
    { x: 1, y: 2, vx: -3.5, vy: 4.25, a: 0.5, finished: false, frozen: true, oil: false, ghost: true, anvil: false, loop: 0 },
    { x: -1000.5, y: 20000, vx: 0, vy: 0, a: -1, finished: true, frozen: false, oil: true, ghost: false, anvil: true, loop: 7 },
  ]);
  assert.equal(pinned, 'AACAPwAAAEAAAGDAAACIQAAAAD8KACB6xABAnEYAAAAAAAAAAAAAgL/1');
  assert.equal(pinned.length, packedStateLength(2));
});

test('MP-02 pack: a state frame round-trips through float32', () => {
  const back = unpackState(STATE.marbles);
  assert.ok(back, 'a packed frame must unpack');
  assert.equal(back?.length, MARBLE_COUNT);
  back?.forEach((m, i) => {
    const want = MARBLES[i];
    // float32 is exactly what the wire carries — compare at that precision.
    for (const key of ['x', 'y', 'vx', 'vy', 'a'] as const) {
      assert.equal(m[key], Math.fround(want[key]), `${key} of marble ${i}`);
    }
    assert.equal(m.finished, want.finished);
    assert.equal(m.frozen, want.frozen);
    assert.equal(m.oil, want.oil);
    assert.equal(m.ghost, want.ghost);
    assert.equal(m.anvil, want.anvil);
    assert.equal(m.loop, want.loop, 'the three spare flag bits survive');
  });
});

test('MP-02 pack: a payload that is not a whole frame is not a state frame', () => {
  assert.equal(unpackState(''), null);
  assert.equal(unpackState(STATE.marbles.slice(0, 279)), null, 'one character short');
  assert.equal(unpackState(STATE.marbles + 'AA'), null, 'a marble too long');
  // ...and the validator says so before anything tries to read a marble.
  const err = check({ ...STATE, marbles: STATE.marbles.slice(0, 200) });
  assert.equal(err?.code, 'malformed');
  assert.equal(check({ ...STATE, marbles: 42 })?.code, 'malformed');
  // A count the grid cannot have is not a state frame either.
  assert.equal(unpackState(packState(MARBLES.slice(0, 3))), null, 'the grid is ten marbles');
});

test('MP-02 pack: base64 is strict about what it will decode', () => {
  const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 250, 255]);
  const text = encodeBase64(bytes);
  assert.deepEqual([...decodeBase64(text)!], [...bytes]);
  // Every length, so padding is exercised (our frames happen to need none).
  for (let n = 0; n < 12; n++) {
    const slice = bytes.slice(0, n);
    assert.deepEqual([...decodeBase64(encodeBase64(slice))!], [...slice], `${n} bytes`);
  }
  for (const junk of ['A', 'AAAAA', 'AA=A', '====', 'ab c', 'AA!!', 'AAAA===', 'ÿÿÿÿ', 'AAA\n']) {
    assert.equal(decodeBase64(junk), null, `"${junk}" must not decode`);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 3. Validators — every message, then every refusal
// ══════════════════════════════════════════════════════════════════════════

test('MP-02 validation: every message type validates, and every type is covered', () => {
  // The table is the whole union: a type without an example here is a type
  // that has never been on the wire.
  const covered = new Set(VALID.map((m) => m.type));
  for (const type of RACE_MESSAGE_TYPES) {
    assert.ok(covered.has(type), `no valid example of "${type}" in the test table`);
  }
  for (const msg of VALID) {
    const err = check(msg);
    assert.equal(err, null, `"${msg.type}" should validate: ${err?.code} ${err?.message}`);
  }
});

test('MP-02 validation: readMessage hands back the frame, or nothing at all', () => {
  assert.equal(readMessage(STATE), STATE);
  assert.equal(readMessage({ type: 'delta' }), null);
  assert.equal(readMessage(null), null);
  assert.equal(readMessage('{"type":"resync"}'), null, 'a JSON string is not a frame');
});

test('MP-02 validation: unknown, empty and non-object frames are refused', () => {
  for (const junk of [null, undefined, 42, 'welcome', [], {}, { type: 'delta' }, { type: 'snapshot-chunk' }, { type: '' }, { type: 7 }]) {
    const err = check(junk);
    assert.equal(err?.code, 'malformed', `${JSON.stringify(junk)} must be refused as malformed`);
  }
  assert.match(check({ type: 'delta' })?.message ?? '', /Unknown message type/);
});

test('MP-02 validation: a frame the gateway would drop is refused as oversized', () => {
  // The real thing: a frame past the 16 KiB cap, caught before any field is
  // looked at. (A 20k-character name is nonsense too, but size is why it can
  // never even arrive.)
  const huge = { type: 'peerStatus', playerId: 'p1', status: 'disconnected', username: 'x'.repeat(20_000) };
  assert.equal(check(huge)?.code, 'oversized');
  // The cap is a parameter, so a host that knows its gateway is tighter can
  // say so — and a frame inside the cap is then refused anyway.
  assert.equal(check(STATE, { maxBytes: 32 })?.code, 'oversized');
  assert.equal(check(STATE, { maxBytes: FRAME_CAP_BYTES }), null);
  // An `events` frame past its own bound (a 20 Hz frame cannot need 64 events).
  const flood: EventsMsg = { type: 'events', seq: 1, list: Array.from({ length: MAX_EVENTS_PER_FRAME + 1 }, () => ({ kind: 'peg', i: 1, seat: 0 })) };
  assert.equal(check(flood)?.code, 'oversized');
  // A snapshot frame past its slice size.
  assert.equal(check({ type: 'snapshot', id: 1, seq: 1, i: 0, n: 2, data: 'x'.repeat(SNAPSHOT_CHUNK_CHARS + 1) })?.code, 'oversized');
});

test('MP-02 validation: a welcome from another build is refused with the reload message', () => {
  const welcome = { type: 'welcome', v: PROTOCOL_VERSION, seed: 1, hostId: 'p1', seats: SEATS, settings: defaultRaceSettings() };
  assert.equal(check(welcome), null, 'this build talks to itself');

  for (const v of [PROTOCOL_VERSION - 1, PROTOCOL_VERSION + 1, 0, 99]) {
    const err = check({ ...welcome, v });
    assert.equal(err?.code, 'version', `v${v} must be refused as a version mismatch`);
    assert.equal(err?.message, VERSION_MISMATCH_MESSAGE);
  }
  // No version at all is a malformed frame, not a mismatch — the client shows
  // the reload line only when the room actually named another version.
  assert.equal(check({ ...welcome, v: undefined })?.code, 'malformed');
  // And the refusal travels back as a `reject` carrying that message.
  const err = validateWelcome({ ...welcome, v: PROTOCOL_VERSION - 1 });
  assert.ok(err);
  assert.deepEqual(rejectionFor(err), { type: 'reject', reason: VERSION_MISMATCH_MESSAGE });
  assert.equal(validateWelcome({ ...welcome, v: PROTOCOL_VERSION }), null);
});

test('MP-02 validation: a welcome that cannot describe a race is refused', () => {
  const welcome = { type: 'welcome', v: PROTOCOL_VERSION, seed: 1, hostId: 'p1', seats: SEATS, settings: defaultRaceSettings() };
  const refusals: [string, unknown, string][] = [
    ['no seed', { ...welcome, seed: undefined }, 'malformed'],
    ['no host', { ...welcome, hostId: '' }, 'malformed'],
    ['no seats', { ...welcome, seats: undefined }, 'malformed'],
    ['nine seats', { ...welcome, seats: SEATS.slice(0, 9) }, 'malformed'],
    ['eleven seats', { ...welcome, seats: [...SEATS, seat(10)] }, 'malformed'],
    ['two seats in one slot', { ...welcome, seats: [...SEATS.slice(1), seat(1, { playerId: 'twin' })] }, 'forged'],
    ['a slot off the grid', { ...welcome, seats: [...SEATS.slice(1), seat(10)] }, 'malformed'],
    ['a livery that is not a colour', { ...welcome, seats: [...SEATS.slice(1), seat(0, { color: 'red' })] }, 'malformed'],
    ['a livery that is a style injection', { ...welcome, seats: [...SEATS.slice(1), seat(0, { color: '#fff;background:url(x)' })] }, 'malformed'],
    ['stats off the stat scale', { ...welcome, seats: [...SEATS.slice(1), seat(0, { stats: { weight: 99, speed: 5, bounce: 5 } })] }, 'forged'],
    ['no stats', { ...welcome, seats: [...SEATS.slice(1), seat(0, { stats: undefined })] }, 'malformed'],
    ['an AI seat with a player id', { ...welcome, seats: [...SEATS.slice(1), seat(0, { isAI: true, playerId: 'ghost' })] }, 'forged'],
    ['a human seat with no player id', { ...welcome, seats: [seat(0, { playerId: '' }), ...SEATS.slice(1)] }, 'forged'],
    ['an over-long name', { ...welcome, seats: [...SEATS.slice(1), seat(0, { name: 'x'.repeat(33) })] }, 'malformed'],
    ['no settings', { ...welcome, settings: undefined }, 'malformed'],
    ['a circuit that is not a circuit id', { ...welcome, settings: { circuit: -1 } }, 'malformed'],
    ['a circuit definition with no theme', { ...welcome, settings: { circuit: { segments: 33, weights: {} } } }, 'malformed'],
    // JSON is how the key arrives: an object literal would set a prototype
    // instead of carrying the key, and the wire never does that.
    ['a circuit definition with a poisoned weight key', { ...welcome, settings: { circuit: { segments: 33, weights: JSON.parse('{"__proto__":1}'), theme: THEME } } }, 'malformed'],
    ['a lap count the sim cannot run', { ...welcome, settings: { circuit: 0, laps: 100 } }, 'malformed'],
  ];
  for (const [label, msg, code] of refusals) {
    const err = check(msg);
    assert.equal(err?.code, code, `${label}: ${err?.code} — ${err?.message}`);
    assert.ok(err?.message, `${label} must say why`);
  }
  // A whole circuit definition is as good as a calendar id.
  assert.equal(check({ ...welcome, settings: { circuit: CIRCUIT, laps: 3 } }), null);
  // `validateWelcome` is the join path's own door, and it only takes welcomes.
  assert.equal(validateWelcome({ ...welcome, type: 'lobby' })?.code, 'malformed');
  assert.equal(validateWelcome(null)?.code, 'malformed');
});

test('MP-02 validation: a lobby is the whole grid, not half of one', () => {
  assert.equal(check({ type: 'lobby', seats: SEATS }), null);
  assert.equal(check({ type: 'lobby', seats: [] })?.code, 'malformed');
  assert.equal(check({ type: 'lobby', seats: SEATS.slice(0, 6) })?.code, 'malformed', 'six humans still race a ten-marble grid');
  assert.equal(check({ type: 'lobby', seats: SEATS.map((s) => ({ ...s, ready: s.slot % 2 === 0 })) }), null, 'ready flags ride along');
  // MP-03: the host republishes the rules here — the room greets a joiner with
  // the defaults because it cannot know what the host picked, and a guest that
  // built a different circuit would read every body index as another body.
  assert.equal(check({ type: 'lobby', seats: SEATS, settings: { circuit: CIRCUIT, laps: 3 } }), null);
  assert.equal(check({ type: 'lobby', seats: SEATS, settings: defaultRaceSettings() }), null);
  assert.equal(check({ type: 'lobby', seats: SEATS, settings: { circuit: -1 } })?.code, 'malformed', 'present but unreadable is refused');
  assert.equal(check({ type: 'lobby', seats: SEATS, settings: 'suzuka' })?.code, 'malformed');
});

test('MP-02 validation: a guest cannot ask the world for more than the game gives', () => {
  // A nudge is analog touch: -1..1. A client asking for a harder shove is
  // either broken or cheating, and the wire refuses rather than clamps.
  assert.equal(check({ type: 'intent', kind: 'nudge', v: 1 }), null);
  assert.equal(check({ type: 'intent', kind: 'nudge', v: -1 }), null);
  for (const v of [1.01, -1.01, 4, -99]) {
    assert.equal(check({ type: 'intent', kind: 'nudge', v })?.code, 'forged', `nudge ${v} must be refused`);
  }
  // Infinity and NaN are not numbers on this wire at all — a client that sends
  // them is broken rather than greedy, and the guest must never see them.
  for (const v of [Number.POSITIVE_INFINITY, Number.NaN]) {
    assert.equal(check({ type: 'intent', kind: 'nudge', v })?.code, 'malformed', `nudge ${v} is not a number`);
  }
  assert.equal(check({ type: 'intent', kind: 'nudge', v: 'left' })?.code, 'malformed');
  assert.equal(check({ type: 'intent', kind: 'nudge' })?.code, 'malformed');
  // An item the game does not have is a forged frame; an unknown intent kind
  // is a frame from another build.
  assert.equal(check({ type: 'intent', kind: 'item', item: 'rocket' }), null);
  assert.equal(check({ type: 'intent', kind: 'item', item: 'nuke' })?.code, 'forged');
  assert.equal(check({ type: 'intent', kind: 'item' })?.code, 'malformed');
  assert.equal(check({ type: 'intent', kind: 'brake' })?.code, 'malformed');
});

test('MP-02 validation: events are checked against what the track and grid can hold', () => {
  assert.equal(check(EVENTS), null, 'the whole event vocabulary validates');
  const refusals: [string, RaceEvent, string][] = [
    ['a body index past the end of any circuit', { kind: 'peg', i: MAX_BODY_INDEX + 1, seat: 0 }, 'forged'],
    ['a negative body index', { kind: 'peg', i: -1, seat: 0 }, 'forged'],
    ['a seat that is not on the grid', { kind: 'peg', i: 4, seat: MARBLE_COUNT }, 'forged'],
    ['a crate with no hit points', { kind: 'crate', i: 4, hp: 'lots', broken: true }, 'malformed'],
    ['a box that never says taken or not', { kind: 'box', i: 4 }, 'malformed'],
    ['an oil slick with no radius', { kind: 'oil', x: 1, y: 2, r: 0, seat: 0, until: 1 }, 'malformed'],
    ['a freeze with no thaw', { kind: 'freeze', seat: 1, by: 0, until: 'soon' }, 'malformed'],
    ['a shock with no position', { kind: 'shock', seat: 1, x: 1, y: Number.NaN }, 'malformed'],
    ['an item that is not an item', { kind: 'item', seat: 1, item: 'banana' }, 'forged'],
    ['a finish with no time', { kind: 'finish', seat: 1, time: -4, rank: 1 }, 'malformed'],
    ['a finish place off the podium and off the grid', { kind: 'finish', seat: 1, time: 4, rank: 11 }, 'forged'],
    ['a sound cue this build cannot name', { kind: 'sound', cue: 'explosion' }, 'forged'],
    ['an event kind from another game', { kind: 'cross' } as unknown as RaceEvent, 'malformed'],
    ['an event that is not an object', null as unknown as RaceEvent, 'malformed'],
  ];
  for (const [label, event, code] of refusals) {
    const err = check({ type: 'events', seq: 1, list: [event] });
    assert.equal(err?.code, code, `${label}: ${err?.code} — ${err?.message}`);
  }
  // An empty batch is a batch: nothing happened this frame.
  assert.equal(check({ type: 'events', seq: 1, list: [] }), null);
  assert.equal(check({ type: 'events', seq: -1, list: [] })?.code, 'malformed', 'a sequence is not negative');
});

test('MP-02 validation: results cannot put one marble in two places', () => {
  const results = { type: 'results', order: [0, 1], times: Array.from({ length: MARBLE_COUNT }, (_, i) => (i < 2 ? 1000 + i : null)), pegs: Array.from({ length: MARBLE_COUNT }, () => 0) };
  assert.equal(check(results), null);
  assert.equal(check({ ...results, order: [0, 0] })?.code, 'forged', 'a seat cannot finish twice');
  assert.equal(check({ ...results, order: [0, MARBLE_COUNT] })?.code, 'forged', 'a seat that is not on the grid');
  assert.equal(check({ ...results, times: results.times.slice(0, 9) })?.code, 'malformed', 'a time per seat');
  assert.equal(check({ ...results, times: results.times.map(() => -1) })?.code, 'malformed', 'no negative race times');
  assert.equal(check({ ...results, pegs: [] })?.code, 'malformed', 'a peg count per seat');
  // An unclassified race still has an order: the grid, as the host saw it.
  assert.equal(check({ ...results, order: [] }), null);
});

test('MP-02 validation: presence and refusal', () => {
  assert.equal(check({ type: 'peerStatus', playerId: 'p1', status: 'disconnected' }), null);
  assert.equal(check({ type: 'peerStatus', playerId: '', status: 'disconnected' })?.code, 'malformed');
  assert.equal(check({ type: 'peerStatus', playerId: 'p1', status: 'left' })?.code, 'malformed');
  assert.equal(check({ type: 'peerStatus', playerId: 'p1', status: 'disconnected', graceMs: -1 })?.code, 'malformed');
  assert.equal(check({ type: 'reject', reason: HOST_LEFT_REASON }), null);
  assert.equal(check({ type: 'reject' })?.code, 'malformed');
  // The host-left line is the one both ends compare against, so it is the
  // wire's business, not the room's private string.
  assert.match(HOST_LEFT_REASON, /host/i);
});

// ══════════════════════════════════════════════════════════════════════════
// 4. Chunked snapshots
// ══════════════════════════════════════════════════════════════════════════

test('MP-02 snapshot: a full world chunks, and every frame fits the cap', () => {
  // A realistic join: a long circuit's worth of popped pegs and broken crates.
  const world = snapshot({ destroyed: Array.from({ length: 1200 }, (_, i) => i * 3) });
  const frames = chunkSnapshot(world, 41, 7);
  assert.ok(frames.length >= 1);
  for (const frame of frames) {
    assert.ok(frameBytes(frame) <= FRAME_CAP_BYTES, `${frameBytes(frame)} bytes`);
    assert.equal(check(frame), null);
  }
  // Reassembly: every frame, in reverse, on the last one only.
  const asm = new SnapshotAssembler();
  let done = null;
  for (const frame of [...frames].reverse()) done = asm.accept(frame) ?? done;
  assert.ok(done, 'a complete transfer must reassemble');
  assert.equal(done?.seq, 41, 'the snapshot resumes the stream at its own seq');
  assert.equal(done?.snap.destroyed.length, 1200);
  assert.equal(done?.snap.marbles.length, MARBLE_COUNT);
  assert.equal(asm.pending, false);
  assert.equal(asm.missing, 0);
  // A sliced-JSON transfer is a plain concat: it round-trips whole.
  const json = JSON.stringify(world);
  assert.equal(frames.map((f) => f.data).join(''), json);
});

test('MP-02 snapshot: small slices still reassemble, and gaps keep the transfer pending', () => {
  const frames = chunkSnapshot(snapshot(), 5, 1, 64);
  assert.ok(frames.length > 3, 'a 64-character slice cuts a world into many frames');
  const asm = new SnapshotAssembler();
  for (const frame of frames.slice(0, -1)) {
    assert.equal(asm.accept(frame), null, 'an incomplete transfer yields nothing');
    assert.equal(asm.pending, true);
  }
  // A duplicate frame must not double-append, or the transfer never completes.
  assert.equal(asm.accept(frames[0]), null);
  assert.equal(asm.missing, 1);
  const done = asm.accept(frames[frames.length - 1]);
  assert.ok(done);
  assert.equal(done?.snap.boxes.length, 2);
  assert.equal(done?.snap.inventories.length, MARBLE_COUNT);
});

test('MP-02 snapshot: a newer transfer supersedes one in flight', () => {
  // A resync overtaking a slow join must never mix halves of two worlds.
  const first = chunkSnapshot(snapshot({ clock: 1000 }), 10, 1, 64);
  const second = chunkSnapshot(snapshot({ clock: 9000 }), 40, 2, 64);
  const asm = new SnapshotAssembler();
  for (const frame of first.slice(0, 2)) assert.equal(asm.accept(frame), null);
  assert.equal(asm.pending, true);
  let done = null;
  for (const frame of second) done = asm.accept(frame) ?? done;
  assert.ok(done, 'the newer transfer completes');
  assert.equal(done?.seq, 40);
  assert.equal(done?.snap.clock, 9000, 'not a mixture of the two worlds');
  // The abandoned transfer can never complete: feeding the rest of its frames
  // — including the last, which would have finished it — yields nothing.
  for (const frame of first.slice(2)) {
    assert.equal(asm.accept(frame), null);
    assert.ok(asm.missing > 0, 'a superseded transfer must never come back and complete');
  }
});

test('MP-02 snapshot: a chunk that lies about the transfer is dropped', () => {
  const asm = new SnapshotAssembler();
  for (const frame of [
    { type: 'snapshot', id: 1, seq: 1, i: 0, n: 0, data: 'x' },
    { type: 'snapshot', id: 1, seq: 1, i: 0, n: MAX_SNAPSHOT_CHUNKS + 1, data: 'x' },
    { type: 'snapshot', id: 1, seq: 1, i: 5, n: 2, data: 'x' },
    { type: 'snapshot', id: 1, seq: 1, i: -1, n: 2, data: 'x' },
    { type: 'snapshot', id: 1, seq: 1, i: 0, n: 2, data: 42 },
    { type: 'snapshot', id: 1.5, seq: 1, i: 0, n: 1, data: 'x' },
    { type: 'snapshot', id: 1, seq: 1, i: 0, n: 2, data: 'x'.repeat(SNAPSHOT_CHUNK_CHARS + 1) },
    { type: 'state', seq: 1, t: 0, marbles: '' },
    null,
    'snapshot',
  ]) {
    assert.equal(asm.accept(frame), null, JSON.stringify(frame));
  }
  assert.equal(asm.pending, false, 'a refused frame must not start a transfer');
  // And the validator agrees, so the relay never forwards one.
  for (const frame of [
    { type: 'snapshot', id: 1, seq: 1, i: 0, n: MAX_SNAPSHOT_CHUNKS + 1, data: 'x' },
    { type: 'snapshot', id: 1, seq: 1, i: 2, n: 2, data: 'x' },
  ]) {
    assert.equal(check(frame)?.code, 'forged');
  }
});

test('MP-02 snapshot: a transfer that parses into something that is not a world is dropped', () => {
  // Reassembly is a concat and a parse — and a parse succeeds on a lot of
  // things that are not a race. The shape check is what stands between a
  // hostile transfer and a guest applying it.
  const asm = new SnapshotAssembler();
  const json = JSON.stringify({ t: 1, clock: 2, started: true, marbles: 'not marbles' });
  for (const frame of chunkSnapshot(JSON.parse(json) as RaceSnapshot, 1, 1, 32)) {
    assert.equal(asm.accept(frame), null);
  }
  assert.equal(asm.pending, false, 'a dropped transfer must not stay pending');

  // Corrupt halves: valid frames, invalid whole.
  const corrupt = chunkSnapshot(snapshot(), 1, 1, 32).map((f) => ({ ...f, data: f.data.slice(0, 30) }));
  const second = new SnapshotAssembler();
  for (const frame of corrupt) assert.equal(second.accept(frame), null);
  assert.equal(second.pending, false);
});

test('MP-02 snapshot: isRaceSnapshot is what the assembler trusts', () => {
  assert.equal(isRaceSnapshot(snapshot()), true);
  assert.equal(isRaceSnapshot(null), false);
  assert.equal(isRaceSnapshot([]), false);
  assert.equal(isRaceSnapshot({ ...snapshot(), marbles: snapshot().marbles.slice(0, 9) }), false, 'a grid of nine');
  assert.equal(isRaceSnapshot({ ...snapshot(), clock: -1 }), false);
  assert.equal(isRaceSnapshot({ ...snapshot(), started: 'yes' }), false);
  assert.equal(isRaceSnapshot({ ...snapshot(), destroyed: [MAX_BODY_INDEX + 1] }), false);
  assert.equal(isRaceSnapshot({ ...snapshot(), boxes: [{ i: 1 }] }), false, 'a box with no state');
  assert.equal(isRaceSnapshot({ ...snapshot(), inventories: snapshot().inventories.map((i) => ({ ...i, rocket: 99 })) }), false, 'a stack past the maximum');
  assert.equal(isRaceSnapshot({ ...snapshot(), inventories: snapshot().inventories.map((i) => ({ ...i, rocket: 1.5 })) }), false, 'half an item');
  assert.equal(isRaceSnapshot({ ...snapshot(), pegs: [1, 2] }), false, 'a peg count per seat');
  assert.equal(isRaceSnapshot({ ...snapshot(), times: Array.from({ length: MARBLE_COUNT }, () => -5) }), false);
  assert.equal(isRaceSnapshot({ ...snapshot(), order: [0, 0] }), false, 'a seat cannot finish twice');
  assert.equal(isRaceSnapshot({ ...snapshot(), marbles: snapshot().marbles.map((m) => ({ ...m, x: Number.NaN })) }), false, 'a NaN position');
  assert.equal(isRaceSnapshot({ ...snapshot(), marbles: snapshot().marbles.map((m) => ({ ...m, loop: MAX_LOOP_STAGE + 1 })) }), false);
  // The inventory reader is reused by the results/HUD path, so pin it too.
  assert.deepEqual(snapshot().inventories[0], INVENTORY);
});

// ══════════════════════════════════════════════════════════════════════════
// 5. Sequencing
// ══════════════════════════════════════════════════════════════════════════

test('MP-02 sequencing: a dropped frame is a resync, the next one is not', () => {
  assert.equal(nextSeq(0), 1);
  assert.equal(nextSeq(SEQ_MODULO - 1), 0, 'the sequence wraps');
  assert.equal(isSeqGap(-1, 0), false, 'the first frame of a stream is not a gap');
  assert.equal(isSeqGap(0, 1), false);
  assert.equal(isSeqGap(0, 2), true, 'a dropped frame');
  assert.equal(isSeqGap(0, 0), true, 'a replayed frame');
  assert.equal(isSeqGap(SEQ_MODULO - 1, 0), false, 'the wrap is not a gap');
});

// ══════════════════════════════════════════════════════════════════════════
// 6. The seam — what the room bundle may import, and who speaks this union
// ══════════════════════════════════════════════════════════════════════════

test('MP-02 purity: the protocol imports nothing the room bundle may not have', () => {
  // `src/rooms/RaceRoom.ts` imports this module, so everything protocol.ts
  // pulls in ends up in the room worker: no SDK (it would drag the client
  // singleton along), no `matter-js` (a physics engine for a relay that never
  // simulates), no track/engine/render (same reason, plus the art pipeline).
  const imports = importSpecifiers('src/net/protocol.ts');
  for (const forbidden of ['@series-inc/rundot-game-sdk', 'matter-js', 'track', 'engine', 'render', 'season', 'storage', 'react', 'net/transport']) {
    assert.ok(
      !imports.some((spec) => spec.includes(forbidden)),
      `src/net/protocol.ts must not import ${forbidden} (imports: ${imports.join(', ')})`,
    );
  }
  // The two game modules it does import are the pure ones — and nothing else
  // at all, so the room bundle cannot grow by accident.
  assert.deepEqual([...new Set(imports)].sort(), ['../game/cues', '../game/types']);
});

test('MP-02 purity: the two game modules the protocol imports are pure too', () => {
  // Enforced where it matters (the room bundle), checked here so a future edit
  // to `types.ts` or `audio.ts` fails in the suite rather than in a worker.
  for (const file of ['src/game/types.ts', 'src/game/cues.ts']) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    assert.equal(/from '[^']+'/.test(source), false, `${file} must have no imports of its own`);
  }
});

test('MP-02 wiring: the transport and the room both speak this union', () => {
  // MP-01 left both aliases on the SDK's base `Protocol` (`{ type: string }`)
  // until the wire existed. Now that it does, a room that does not speak it is
  // a room whose messages nobody validates.
  const transport = readFileSync(join(ROOT, 'src/net/transport.ts'), 'utf8');
  assert.match(transport, /import type \{ RaceProtocol \} from '\.\/protocol'/);
  assert.equal(/export type RaceProtocol = /.test(transport), false, 'the union has one home');
  // The room may import three things: the server SDK, the shared wire, and the
  // pure game constants it seats people with. Nothing else belongs in a bundle
  // that runs in a room worker.
  assert.deepEqual(
    [...new Set(importSpecifiers('src/rooms/RaceRoom.ts'))].sort(),
    ['../game/types', '../net/protocol', '@series-inc/rundot-game-sdk/mp-server'],
  );
  // And the isolation rule MP-01 pinned still holds with the new file in
  // place: the protocol is not a back door to the realtime API.
  assert.deepEqual(importSpecifiers('src/net/protocol.ts').filter((s) => s.includes('rundot')), []);
});

test('MP-02 grid: the protocol\'s ten marbles are the track\'s ten grid slots', () => {
  // The packed frame has no count on the wire: it is the grid, always. Any
  // drift between this constant and `GRID_N` would make every frame unreadable.
  assert.equal(MARBLE_COUNT, GRID_N);
  // ...and the bound on a body index is a bound on reality: a generated
  // circuit is ~1–1.5k bodies, so the cap only refuses the impossible.
  const track = generateTrack(12345, { segments: 33, weights: {}, theme: THEME });
  assert.ok(track.bodies.length > 100, 'a real circuit has bodies to index');
  assert.ok(track.bodies.length < MAX_BODY_INDEX, `${track.bodies.length} bodies vs index cap ${MAX_BODY_INDEX}`);
});
