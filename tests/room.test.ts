// ══════════════════════════════════════════════════════════════════════════
// MP-03 — relay unit tests: seed minting, host identity, message routing,
// the seat table, capacity, the mid-race lock and presence.
//
// Drives the REAL SDK dispatch (`handleJoin` → `onPlayerJoin`,
// `handleMessage` → `onGameMessage`, `handleLeave` → `onPlayerLeave`) with a
// fake `RoomProtocol` that records every outbound frame — the same harness
// shape HexMatch uses. No network, no auth, no browser. The live two-tab
// exchange (a real socket through `npm run dev`) is the README's
// `?mpdebug=1` path, and MP-10 covers it with Playwright.
// ══════════════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';

import RaceRoom, {
  HOST_LEFT_REASON,
  KICKED_REASON,
  LOBBY_CLOSED_REASON,
  MAX_HUMAN_SEATS,
  PRESENCE_POLL_MS,
  RACE_IN_PROGRESS_REASON,
  ROOM_FULL_REASON,
  roomSeed,
} from '../src/rooms/RaceRoom';
import {
  MARBLE_COUNT,
  PROTOCOL_VERSION,
  defaultRaceSettings,
  packState,
  validateWelcome,
  type MarbleState,
  type RaceProtocol,
  type Seat,
} from '../src/net/protocol';
// The room harness — the fake clock, the frame recorder, `join`/`send`/`leave`
// — is shared with RK-03's rating tests (`tests/room-harness.ts`).
import {
  broadcasts,
  join,
  joinRefused,
  leave,
  ofType,
  send,
  sentTo,
  to,
  welcomeOf,
  setup,
  type Frame,
  type Harness,
} from './room-harness';

function marble(i: number): MarbleState {
  return { x: i * 10, y: i * 20, vx: 0, vy: 0, a: 0, finished: false, frozen: false, oil: false, ghost: false, anvil: false, loop: 0 };
}

const PACKED = packState(Array.from({ length: MARBLE_COUNT }, (_, i) => marble(i)));

function stateMsg(seq = 7): RaceProtocol {
  return { type: 'state', seq, t: 1000, marbles: PACKED };
}

function seats(): Seat[] {
  return Array.from({ length: MARBLE_COUNT }, (_, slot) => ({
    slot,
    playerId: slot === 0 ? 'p1' : '',
    name: slot === 0 ? 'P1' : `Rival ${slot}`,
    color: '#67e8f9',
    stats: { weight: 5, speed: 5, bounce: 5 },
    portrait: slot,
    isAI: slot !== 0,
    ready: true,
  }));
}

const lobbyMsg = (): RaceProtocol => ({ type: 'lobby', seats: seats(), settings: defaultRaceSettings() });

// ══════════════════════════════════════════════════════════════════════════
// The seed and the host
// ══════════════════════════════════════════════════════════════════════════

test('MP-03 seed: the room mints one seed, from its own id, without Math.random', async () => {
  const a = setup({}, 'room-alpha');
  const b = setup({}, 'room-alpha');
  const c = setup({}, 'room-beta');
  // The seed is only spoken in the welcome, so a room has to be asked: mint it,
  // seat one player, read what the player was told.
  const seedOf = async (h: Harness): Promise<number> => {
    await h.protocol.handleCreate();
    await join(h, 'p1');
    return welcomeOf(h.frames).seed;
  };
  const alpha = await seedOf(a);
  assert.equal(alpha, await seedOf(b), 'the same room id mints the same seed — a restart cannot swap the circuit');
  assert.notEqual(alpha, await seedOf(c), 'two rooms race two circuits');
  assert.ok(Number.isInteger(alpha) && alpha >= 0 && alpha <= 0xffffffff, `${alpha} is not a uint32`);
  // The minting function itself, pinned: FNV-1a, no RNG anywhere near it.
  assert.equal(roomSeed('room-alpha'), alpha);
  assert.equal(roomSeed(''), 0x811c9dc5, 'the FNV offset basis');
  assert.notEqual(roomSeed('ab'), roomSeed('ba'), 'order matters');
});

test('MP-03 welcome: a joiner gets the seed, the host, the version and the whole grid', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1', 'Ace');
  const targeted = welcomeOf(h.frames, 'p1');
  // The joiner is the first in, so it is the host.
  assert.equal(targeted.hostId, 'p1');
  assert.equal(targeted.v, PROTOCOL_VERSION);
  assert.equal(targeted.seats.length, MARBLE_COUNT, 'a grid of ten, humans and AI');
  assert.deepEqual(targeted.seats.find((s) => s.slot === 0), {
    slot: 0, playerId: 'p1', name: 'Ace', color: '#d63e2e',
    stats: { weight: 5, speed: 5, bounce: 5 }, portrait: 0, isAI: false, ready: false,
  });
  assert.equal(targeted.seats.filter((s) => s.isAI).length, 9, 'AI fills what the humans did not take');
  // ...and the greeting is a frame the client's own validator accepts.
  assert.equal(validateWelcome(targeted), null);
  // Everybody (here: nobody yet) plus the newcomer — nobody gets it twice.
  assert.equal(ofType(to(h.frames, 'p1'), 'welcome').length, 1);
});

test('MP-03 welcome: a second joiner is seated next to the host, and everybody hears it', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  const broadcast = welcomeOf(h.frames);
  assert.equal(broadcast.hostId, 'p1', 'the host does not change under a joiner');
  const humans = broadcast.seats.filter((s) => !s.isAI);
  assert.deepEqual(humans.map((s) => s.slot), [0, 1]);
  assert.deepEqual(humans.map((s) => s.playerId), ['p1', 'p2']);
  const forP2 = welcomeOf(to(h.frames, 'p2'), 'p2');
  assert.equal(forP2.seats[1].playerId, 'p2');
  assert.equal(forP2.hostId, 'p1');
});

// ══════════════════════════════════════════════════════════════════════════
// Routing — the acceptance list
// ══════════════════════════════════════════════════════════════════════════

test('MP-03 relay: forged state from a guest is DROPPED', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  h.frames.length = 0;

  // A guest publishing marble positions is the whole thing this relay exists
  // to stop: no broadcast, no error, nothing for the forger to probe.
  await send(h, 'p2', stateMsg(1));
  await send(h, 'p2', { type: 'events', seq: 1, list: [{ kind: 'peg', i: 4, seat: 2 }] });
  await send(h, 'p2', { type: 'snapshot', id: 1, seq: 1, i: 0, n: 1, data: '{}' });
  await send(h, 'p2', lobbyMsg());
  await send(h, 'p2', { type: 'start', countdownAt: Date.now() });
  await send(h, 'p2', { type: 'results', order: [2, 1], times: Array.from({ length: MARBLE_COUNT }, () => null), pegs: Array.from({ length: MARBLE_COUNT }, () => 0) });
  assert.deepEqual(broadcasts(h.frames), [], 'a guest must never speak for the world');

  // The host saying the same thing is relayed to everyone.
  await send(h, 'p1', stateMsg(2));
  const relayed = broadcasts(h.frames);
  assert.equal(relayed.length, 1);
  assert.equal(relayed[0].type, 'state');
  assert.equal((relayed[0] as { seq: number }).seq, 2);
});

test('MP-03 relay: host state goes to everyone, not back to the host alone', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  await join(h, 'p3');
  h.frames.length = 0;
  await send(h, 'p1', stateMsg(3));
  // One broadcast reaches the whole room; a sendTo would only reach the host.
  assert.deepEqual(ofType(h.frames, 'state').map((f) => f.target), ['broadcast']);
  assert.equal(sentTo(h.frames, 'p2').length, 0, 'guests read the broadcast, not a private line');
});

test('MP-03 relay: intents reach the HOST ONLY', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  h.frames.length = 0;

  await send(h, 'p2', { type: 'intent', kind: 'nudge', v: -0.5 });
  await send(h, 'p2', { type: 'intent', kind: 'item', item: 'rocket' });
  await send(h, 'p2', { type: 'resync' });
  await send(h, 'p2', { type: 'ready', ready: true });

  const frames = h.frames;
  assert.deepEqual([...new Set(frames.map((f) => f.target))], ['p1'], 'an intent has exactly one destination');
  assert.deepEqual(sentTo(frames, 'p1').map((m) => m.type), ['intent', 'intent', 'resync', 'ready']);
  assert.equal(ofType(frames, 'intent').filter((f) => f.target === 'broadcast').length, 0, 'never broadcast');
  assert.equal(sentTo(frames, 'p2').length, 0, 'the sender does not get its own intent back');
});

test('MP-06 relay: every guest frame reaches the host STAMPED with its sender', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  h.frames.length = 0;

  // The SDK hands a client the payload alone — no envelope, no sender — so
  // without the stamp the host could not tell which seat a nudge or a garage
  // belongs to.
  await send(h, 'p2', { type: 'intent', kind: 'nudge', v: -0.5 });
  await send(h, 'p2', { type: 'resync' });
  await send(h, 'p2', { type: 'ready', ready: true, garage: { name: 'Sprocket', color: '#22d3ee', stats: { weight: 7, speed: 4, bounce: 4 }, portrait: 2 } });
  const relayed = sentTo(h.frames, 'p1');
  assert.deepEqual(relayed.map((m) => m.type), ['intent', 'resync', 'ready']);
  for (const msg of relayed) assert.equal((msg as { from?: string }).from, 'p2', `"${msg.type}" carries no stamp`);
  // The garage survived the trip: it is the whole point of the frame.
  const garage = (relayed[2] as { garage?: { name: string } }).garage;
  assert.equal(garage?.name, 'Sprocket');
});

test('MP-06 relay: a guest cannot forge the stamp', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  h.frames.length = 0;
  // p2 claims to be p1 — with no stamp-check this would let a guest file
  // another driver's garage, or nudge a marble that is not theirs.
  await send(h, 'p2', { type: 'ready', ready: true, from: 'p1' });
  const relayed = sentTo(h.frames, 'p1');
  assert.equal(relayed.length, 1);
  assert.equal((relayed[0] as { from?: string }).from, 'p2', 'the room overwrites what a client claims');
});

test('MP-06 relay: a kick from the host evicts the player — and only the host may', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  await join(h, 'p3');
  h.frames.length = 0;

  // A guest kicking the host would empty every room it walked into.
  await send(h, 'p2', { type: 'kick', playerId: 'p1' });
  await send(h, 'p2', { type: 'kick', playerId: 'p3' });
  assert.deepEqual(ofType(h.frames, 'kick'), [], 'a guest cannot evict anybody');

  // Nobody may kick the host: no host, no truth, and the room says so loudly
  // enough already when one walks out.
  await send(h, 'p1', { type: 'kick', playerId: 'p1' });
  await send(h, 'p1', { type: 'kick', playerId: 'nobody-here' });
  assert.deepEqual(ofType(h.frames, 'kick'), [], 'the host and strangers are not kickable');

  await send(h, 'p1', { type: 'kick', playerId: 'p2' });
  const kicks = ofType(h.frames, 'kick');
  assert.equal(kicks.length, 1);
  assert.equal(kicks[0].target, 'p2');
  assert.equal((kicks[0].data as { reason: string }).reason, KICKED_REASON);
  // The eviction is a leave, and a leave is a new welcome for everybody left.
  await leave(h, 'p2', 'kick');
  const grid = welcomeOf(h.frames).seats;
  assert.deepEqual(grid.filter((s) => !s.isAI).map((s) => s.playerId), ['p1', 'p3'], 'the kicked seat is free again');
});

test('MP-03 relay: the host is not a guest — its own intents are not echoed', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  h.frames.length = 0;
  // The host applies its own nudges locally; there is nobody to forward to.
  await send(h, 'p1', { type: 'intent', kind: 'nudge', v: 1 });
  await send(h, 'p1', { type: 'ready', ready: true });
  assert.deepEqual(h.frames, []);
});

test('MP-03 relay: a frame the protocol refuses never crosses the room', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  h.frames.length = 0;
  // All three are the HOST speaking, so authority is not what stops them —
  // the wire is (MP-02's validateMessage is the relay's door too).
  await send(h, 'p1', { type: 'state', seq: 1, t: 0, marbles: 'not base64' });
  await send(h, 'p1', { type: 'events', seq: 1, list: [{ kind: 'peg', i: -1, seat: 0 }] });
  await send(h, 'p1', { type: 'intent', kind: 'nudge', v: 9 });
  await send(h, 'p1', { type: 'nonsense' } as unknown as RaceProtocol);
  await send(h, 'p1', { type: 'welcome', v: PROTOCOL_VERSION, seed: 1, hostId: 'p1', seats: seats(), settings: defaultRaceSettings() });
  await send(h, 'p1', { type: 'reject', reason: 'mine' });
  await send(h, 'p1', { type: 'peerStatus', playerId: 'p2', status: 'disconnected' });
  assert.deepEqual(h.frames, [], 'the room relays nothing it does not own or understand');
});

test('MP-03 relay: the host\'s lobby carries the rules the room cannot know', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  h.frames.length = 0;
  await send(h, 'p1', lobbyMsg());
  const relayed = broadcasts(h.frames);
  assert.equal(relayed.length, 1);
  assert.equal(relayed[0].type, 'lobby');
  assert.equal((relayed[0] as { seats: unknown[] }).seats.length, MARBLE_COUNT);
  // ...and a lobby with an unreadable settings block is refused, not relayed.
  h.frames.length = 0;
  await send(h, 'p1', { type: 'lobby', seats: seats(), settings: { circuit: -7 } });
  assert.deepEqual(h.frames, []);
});

// ══════════════════════════════════════════════════════════════════════════
// Capacity, the mid-race lock, and the host leaving
// ══════════════════════════════════════════════════════════════════════════

test('MP-03 capacity: six humans race, the seventh is refused', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  for (let i = 1; i <= MAX_HUMAN_SEATS; i++) await join(h, `p${i}`);
  // Six is the room's own number — the SDK's handleJoin enforces nothing.
  const reason = await joinRefused(h, 'p7');
  assert.equal(reason, ROOM_FULL_REASON);
  assert.equal(h.players.has('p7'), false, 'a refused joiner is not seated');
  const grid = welcomeOf(h.frames).seats.filter((s) => !s.isAI);
  assert.equal(grid.length, MAX_HUMAN_SEATS);
  // A full room locks itself, so the platform stops offering it too.
  assert.equal(ofType(h.frames, 'lock').length >= 1, true);
  // A leaving player frees the seat again.
  await leave(h, 'p3');
  assert.equal(ofType(h.frames, 'unlock').length >= 1, true);
  await join(h, 'p8');
  assert.equal(welcomeOf(h.frames).seats.filter((s) => !s.isAI).length, MAX_HUMAN_SEATS);
});

test('MP-03 lock: `start` closes the door, and a late joiner is told why', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  h.frames.length = 0;
  // A guest cannot start the race.
  await send(h, 'p2', { type: 'start', countdownAt: Date.now() + 3000 });
  assert.deepEqual(ofType(h.frames, 'start'), []);
  await send(h, 'p1', { type: 'start', countdownAt: Date.now() + 3000 });
  const startFrames = ofType(h.frames, 'start');
  assert.equal(startFrames.length, 1);
  assert.equal(startFrames[0].target, 'broadcast', 'the whole grid counts down together');
  assert.equal(ofType(h.frames, 'lock').length, 1, 'the room locks once the lights go out');

  // The lock is the room's own, not just the platform's: joining through the
  // SDK dispatch is refused, mid-race, with a reason the client can show.
  const reason = await joinRefused(h, 'p3');
  assert.equal(reason, RACE_IN_PROGRESS_REASON);
  assert.equal(h.players.has('p3'), false);
});

test('MP-08 rejoin: a driver the room is holding a seat for may come back mid-race', async () => {
  // A refreshed tab (or a socket that dropped and reattached) is the SAME player
  // asking for the marble that is already rolling for them. Refusing them would
  // make "refresh" a disqualification.
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  const before = welcomeOf(h.frames, 'p2');
  const slot = before.seats.find((s) => s.playerId === 'p2')?.slot;
  assert.ok(slot !== undefined && slot > 0, 'the guest was seated');
  await send(h, 'p1', { type: 'start', countdownAt: Date.now() + 3000 });
  h.frames.length = 0;

  const res = await h.protocol.handleJoin({ id: 'p2', username: 'P2' });
  assert.equal(res.accepted, true, 'a returner is not a late joiner');
  const after = welcomeOf(h.frames, 'p2');
  assert.equal(after.seats.find((s) => s.playerId === 'p2')?.slot, slot, 'and it is the SAME seat — the same marble');
  assert.equal(after.seed, before.seed, 'and the same race');

  // A stranger still gets the door: the grid is set, the marbles are rolling.
  assert.equal(await joinRefused(h, 'p9'), RACE_IN_PROGRESS_REASON);
});

test('MP-08 rejoin: a driver who was kicked has no seat to come back to', async () => {
  // The room owns the seat table, so being taken off the grid is final — the
  // alternative is a kicked player walking back into the race.
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  await send(h, 'p1', { type: 'kick', playerId: 'p2' });
  await leave(h, 'p2', 'kick');
  await send(h, 'p1', { type: 'start', countdownAt: Date.now() + 3000 });
  assert.equal(await joinRefused(h, 'p2'), RACE_IN_PROGRESS_REASON);
});

test('MP-10 hello: a client that missed its greeting can ask for another', async () => {
  // The SDK hands over a room that has ALREADY joined, so the welcome the room
  // sends on join goes out before the page has subscribed to anything. This is
  // the fix for that: the client asks, the room answers — the asker, and nobody
  // else. A lobby that never hears a hello shows a code and no grid, for ever.
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  h.frames.length = 0;

  await send(h, 'p2', { type: 'hello' });
  // Targeted: the room answers the asker alone. (`sendTo` reaches a client's
  // `onPrivateMessage`, not its `onMessage` — the client listens for both, and
  // MP-10's browser suite is what caught the difference.)
  const forP2 = sentTo(h.frames, 'p2');
  assert.equal(forP2.length, 1, 'one answer, to the asker');
  assert.equal(forP2[0].type, 'welcome');
  const welcome = forP2[0] as WelcomeMsg;
  assert.ok(welcome.seats.some((s) => s.playerId === 'p2'), 'and it says where they are sitting');
  assert.equal(welcome.seed, roomSeed('room-1'), 'the same race, not a new one');

  // The host may ask too — a hello is the one frame a client sends that the room
  // answers out of its own mouth, rather than relaying.
  h.frames.length = 0;
  await send(h, 'p1', { type: 'hello' });
  assert.equal(sentTo(h.frames, 'p1').length, 1, 'the host may ask too');
  assert.equal(sentTo(h.frames, 'p2').length, 0, 'and the answer is still private');
});

test('MP-03 host: leaving mid-race ends the race for everyone', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  await send(h, 'p1', { type: 'start', countdownAt: Date.now() });
  await send(h, 'p1', stateMsg(4));
  h.frames.length = 0;

  await leave(h, 'p1', 'leave');
  const rejections = broadcasts(h.frames).filter((m) => m.type === 'reject');
  assert.equal(rejections.length, 1, 'one message, to everyone still in the room');
  assert.equal((rejections[0] as { reason: string }).reason, HOST_LEFT_REASON);
  // The room is finished: no rehost into a race that already ended.
  assert.equal(await joinRefused(h, 'p9'), RACE_IN_PROGRESS_REASON);
});

test('MP-03 host: leaving the LOBBY is not the end of the world', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  h.frames.length = 0;
  // No `start`, so no race: the seat is simply free again.
  await leave(h, 'p1', 'leave');
  assert.equal(broadcasts(h.frames).filter((m) => m.type === 'reject').length, 0);
  await join(h, 'p3');
  assert.equal(welcomeOf(h.frames).hostId, 'p3', 'a newcomer to a hostless lobby takes the seat');
  assert.deepEqual(welcomeOf(h.frames).seats.filter((s) => !s.isAI).map((s) => s.playerId).sort(), ['p2', 'p3']);
  // A guest leaving mid-race is not the host: the race goes on.
  const g = setup();
  await g.protocol.handleCreate();
  await join(g, 'p1');
  await join(g, 'p2');
  await send(g, 'p1', { type: 'start', countdownAt: Date.now() });
  g.frames.length = 0;
  await leave(g, 'p2', 'leave');
  assert.equal(broadcasts(g.frames).filter((m) => m.type === 'reject').length, 0, 'a guest leaving does not end the race');
  await send(g, 'p1', stateMsg(5));
  assert.equal(ofType(g.frames, 'state').length, 1, 'the host is still publishing');
});

test('MP-03 seats: a rejoining player sits down in its old seat', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  await join(h, 'p3');
  await leave(h, 'p2', 'disconnect');
  await join(h, 'p2');
  const humans = welcomeOf(h.frames).seats.filter((s) => !s.isAI).sort((a, b) => a.slot - b.slot);
  assert.deepEqual(humans.map((s) => s.playerId), ['p1', 'p2', 'p3'], 'slot 1 came back to p2');
  // The seat table is bounded by the grid: ten slots, no matter who asks.
  assert.equal(new Set(humans.map((s) => s.slot)).size, humans.length);
});

// ══════════════════════════════════════════════════════════════════════════
// Presence (#164)
// ══════════════════════════════════════════════════════════════════════════

test('MP-03 presence: a dropped socket is announced with the hold window, and a return is greeted again', async () => {
  const h = setup({ reconnectTimeout: 30 });
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  const p2 = h.players.get('p2')!;

  // The platform flips the flag and holds the seat; it tells the room nothing,
  // so the room's own poll is the only place this is visible.
  h.frames.length = 0;
  p2.connected = false;
  h.clock.tick();
  const gone = broadcasts(h.frames).filter((m) => m.type === 'peerStatus');
  assert.equal(gone.length, 1);
  assert.deepEqual(gone[0], {
    type: 'peerStatus', playerId: 'p2', status: 'disconnected', graceMs: 30_000, username: 'P2',
  });

  // And back inside the window: the returner gets a fresh welcome (a reloaded
  // page has never seen the seed), and so does everyone else.
  h.frames.length = 0;
  p2.connected = true;
  h.clock.tick();
  const back = broadcasts(h.frames);
  assert.deepEqual(back.filter((m) => m.type === 'peerStatus')[0], {
    type: 'peerStatus', playerId: 'p2', status: 'reconnected', username: 'P2',
  });
  assert.equal(ofType(to(h.frames, 'p2'), 'welcome').length, 1, 'the returner is re-greeted');
  assert.equal(welcomeOf(h.frames).seed, welcomeOf(to(h.frames, 'p2'), 'p2').seed);

  // No news is no news: an unchanged flag broadcasts nothing.
  h.frames.length = 0;
  h.clock.tick();
  assert.deepEqual(h.frames, []);
});

test('MP-03 presence: the poll runs on the room\'s own clock, and stops when the room empties', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  // Started by the first join, under a name the room owns.
  assert.equal(h.clock.has('presence-poll'), true);
  await leave(h, 'p1');
  assert.equal(h.clock.has('presence-poll'), false);
  assert.equal(PRESENCE_POLL_MS, 1_000);
});

test('Auto Match Making: the host closes the lobby, newcomers are refused until it reopens', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  // A guest cannot close the host's lobby.
  await send(h, 'p2', { type: 'lobby', seats: seats(), open: false });
  await join(h, 'p3');
  await send(h, 'p1', { type: 'lobby', seats: seats(), open: false });
  assert.equal(await joinRefused(h, 'p4'), LOBBY_CLOSED_REASON);
  await send(h, 'p1', { type: 'lobby', seats: seats(), open: true });
  await join(h, 'p4');
});
