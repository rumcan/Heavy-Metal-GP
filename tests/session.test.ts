// ══════════════════════════════════════════════════════════════════════════
// MP-06 — a race on two screens.
//
// The acceptance is "host shows code, guest joins, both ready, race starts on
// both". The code and the joining are the lobby's business (and the browser's),
// but the STARTING is this: two sessions, one wire, and both ends racing the
// same heat. Everything here is the real thing — the host's Matter.js world,
// the guest's interpolation, the packing, the intents — over a network that is
// late and a little lossy.
// ══════════════════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';

import { AI_COLORS, AI_NAMES, mulberry32, randomStats } from '../src/game/types';
import { dressGrid, gridOrderOf, rosterOf } from '../src/net/lobby';
import { RaceSession, START_ARM_MS } from '../src/net/session';
import type { SessionOptions } from '../src/net/session';
import { COUNTDOWN_MS } from '../src/net/host';
import type { ItemType, TrackProfile } from '../src/game/types';
import type { IntentMsg, RaceProtocol, Seat } from '../src/net/protocol';
import { MARBLE_COUNT } from '../src/net/protocol';

const SEED = 4242;
const FRAME_MS = 1000 / 60;
const CLOCK_START = 1_700_000_000_000;
const LATENCY_MS = 90;
const PROFILE: TrackProfile = { segments: 10, weights: {}, theme: { bg1: '#0b1220', bg2: '#132033', track: '#2b3a4d', pipe: '#3b4a5d', pipeEdge: '#4b5a6d' } };

function grid(humans = 2): Seat[] {
  const rng = mulberry32(31337);
  const seats: Seat[] = Array.from({ length: MARBLE_COUNT }, (_, slot) => ({
    slot,
    playerId: slot < humans ? `player-${slot}` : '',
    name: slot === 0 ? 'Host' : slot === 1 ? 'Guest' : AI_NAMES[slot - 1],
    color: slot === 0 ? '#d63e2e' : slot === 1 ? '#3b82f6' : AI_COLORS[slot - 1],
    stats: randomStats(rng),
    portrait: slot % 6,
    isAI: slot >= humans,
    ready: true,
  }));
  return dressGrid(seats, SEED);
}

interface Pair {
  host: RaceSession;
  guest: RaceSession;
  now(): number;
  /** Advance one rendered frame on both screens; deliver what is due. */
  tick(): void;
  /** Intents the guest has put on the wire. */
  intents: IntentMsg[];
  /** EVERY frame the guest has put on the wire (resyncs included). */
  guestFrames: RaceProtocol[];
  /** EVERY frame the host has put on the wire. */
  hostFrames: RaceProtocol[];
  sent: number;
}

/** A host session and a guest session joined by a late, slightly lossy wire. */
function pair(opts: { loss?: number } = {}): Pair {
  const loss = opts.loss ?? 0;
  const rng = mulberry32(0xc0ffee);
  let now = CLOCK_START;
  const toGuest: { msg: RaceProtocol; due: number }[] = [];
  const toHost: { msg: RaceProtocol; due: number }[] = [];
  const intents: IntentMsg[] = [];
  const guestFrames: RaceProtocol[] = [];
  const hostFrames: RaceProtocol[] = [];
  let sent = 0;
  const seats = grid();
  const countdownAt = now + START_ARM_MS;

  const base = {
    seed: SEED,
    seats,
    profile: PROFILE,
    settings: { circuit: 0 },
    now: () => now,
    countdownAt,
  } satisfies Partial<SessionOptions>;

  const host = new RaceSession({
    ...base,
    localSeat: 0,
    isHost: true,
    send: (msg) => {
      sent++;
      hostFrames.push(msg);
      if (rng() < loss) return;
      toGuest.push({ msg, due: now + LATENCY_MS });
    },
  });
  const guest = new RaceSession({
    ...base,
    localSeat: 1,
    isHost: false,
    send: (msg) => {
      sent++;
      if (msg.type === 'intent') intents.push(msg);
      guestFrames.push(msg);
      if (rng() < loss) return;
      toHost.push({ msg, due: now + LATENCY_MS });
    },
  });

  const deliver = () => {
    for (const queue of [toGuest, toHost]) {
      while (queue.length && queue[0].due <= now) {
        const { msg } = queue.shift()!;
        if (queue === toGuest) {
          guest.accept(msg);
        } else {
          // What the ROOM does on the way through: stamp the sender, so the
          // host can tell which seat a nudge or an item belongs to. A guest
          // frame without one is a frame the host must ignore.
          host.accept({ ...msg, from: 'player-1' });
        }
      }
    }
  };

  return {
    host,
    guest,
    intents,
    guestFrames,
    hostFrames,
    now: () => now,
    get sent() {
      return sent;
    },
    tick() {
      now += FRAME_MS;
      host.update(FRAME_MS);
      guest.update();
      deliver();
    },
  };
}

test('MP-06 session: the lights go out on both screens, and both fields roll', () => {
  const p = pair();
  assert.equal(p.host.isHost, true);
  assert.equal(p.guest.isHost, false);
  assert.equal(p.host.gateOpen, false);
  assert.equal(p.guest.gateOpen, false);

  // The lobby armed the countdown before either world existed: the count is
  // the SAME instant on both screens, and it is a wall clock, not a receipt.
  let frames = 0;
  while (!p.host.gateOpen && frames++ < 3000) p.tick();
  assert.ok(p.host.gateOpen, 'the host dropped the gate');
  assert.ok(frames * FRAME_MS >= COUNTDOWN_MS - 100, `the gate opened after ${(frames * FRAME_MS) | 0}ms, not ${COUNTDOWN_MS}`);

  // The guest is 90 ms behind, so it opens a few frames later — from the state
  // frame, with no snapshot and no second `start`.
  for (let i = 0; i < 20; i++) p.tick();
  assert.ok(p.guest.gateOpen, 'the guest dropped the gate too');
  assert.equal(p.host.lightStage, -1, 'the HUD shows GO, not five lit lights');

  // Both screens are watching marbles move.
  const before = { host: p.host.game.marbles[3].body.position.y, guest: p.guest.game.marbles[3].body.position.y };
  for (let i = 0; i < 120; i++) p.tick();
  assert.ok(p.host.game.marbles[3].body.position.y > before.host + 20, 'the host field rolled');
  assert.ok(p.guest.game.marbles[3].body.position.y > before.guest + 20, 'the guest field rolled with it');
  assert.equal(p.guest.resyncs, 0, 'a clean start needs no resync');
  p.host.dispose();
  p.guest.dispose();
});

test('MP-06 session: a whole race classifies identically on both screens', () => {
  const p = pair({ loss: 0.01 });
  let frames = 0;
  while (!p.host.results && frames++ < 60_000) p.tick();
  const host = p.host.results;
  assert.ok(host, 'the host classified the race');
  // The results frame is 90 ms away when it is sent — let it land.
  let settle = 0;
  while (!p.guest.results && settle++ < 900) p.tick();
  const guest = p.guest.results;
  assert.ok(guest, 'the guest got the classification');
  assert.deepEqual(guest, host, 'one race, one result, two screens');
  assert.equal(host!.length, MARBLE_COUNT);
  assert.deepEqual(host!.map((r) => r.rank), [...Array(MARBLE_COUNT).keys()].map((i) => i + 1));
  // ...and the rows are numbered by seat, the way every packed frame is.
  for (const row of host!) assert.ok(row.id >= 0 && row.id < MARBLE_COUNT);
  p.host.dispose();
  p.guest.dispose();
});

test('MP-06 session: a guest nudge reaches the host and moves that seat, and no other', () => {
  const p = pair();
  while (!p.host.gateOpen) p.tick();
  for (let i = 0; i < 160; i++) p.tick(); // clear the lights and the first scramble

  const before = p.host.game.marbles[1].body.position.x;
  // Hold the key: 60 frames of it is a second of key repeat.
  for (let i = 0; i < 60; i++) {
    p.guest.setNudge(1);
    p.tick();
  }
  const intents = p.intents.filter((m) => m.kind === 'nudge');
  assert.ok(intents.length > 0, 'the guest said something');
  assert.ok(intents.every((m) => m.kind === 'nudge' && m.v === 1));
  // 60 frames at 60 Hz is 30 nudges a second, not 60: the client paces itself
  // the way the host's own token bucket paces a guest.
  assert.ok(intents.length <= 34, `${intents.length} nudges in a second`);
  assert.ok(intents.length >= 15, `${intents.length} nudges in a second — the wire is being starved`);

  // The host applied them to the seat that sent them.
  const after = p.host.game.marbles[1].body.position.x;
  assert.notEqual(after, before, 'the guest seat moved');
  // And the release always lands: a nudge the host never hears let go would
  // leave the marble leaning for the rest of the race.
  const held = p.host.game.humanInput.get(1)?.nudge ?? 0;
  p.guest.setNudge(0);
  for (let i = 0; i < 30; i++) p.tick();
  assert.equal(p.host.game.humanInput.get(1)?.nudge ?? 0, 0, 'the host let go');
  assert.equal(held, 1, 'the host was holding it before');
  p.host.dispose();
  p.guest.dispose();
});

test('MP-06 session: a guest item is a request, not a decision', () => {
  const p = pair();
  while (!p.host.gateOpen) p.tick();
  for (let i = 0; i < 400; i++) p.tick(); // long enough to have picked something up

  const held: ItemType = 'rocket';
  p.guest.game.marbles[1].inventory[held] = 2; // what the guest thinks it carries
  const hostBefore = p.host.game.marbles[1].inventory[held];
  p.guest.useItem(held);
  for (let i = 0; i < 10; i++) p.tick();

  const request = p.intents.find((m) => m.kind === 'item');
  assert.ok(request, 'the guest asked');
  assert.equal(request && request.kind === 'item' ? request.item : null, held);
  // The guest does not spend it — only the host's simulation knows whether it
  // was legal, and the state frames are where the answer comes back.
  assert.equal(p.guest.game.marbles[1].inventory[held], 2, 'a guest never decides');
  assert.ok(p.host.game.marbles[1].inventory[held] <= hostBefore, 'the host spent it, or refused to');
  p.host.dispose();
  p.guest.dispose();
});

test('MP-06 session: cues cross the wire as names and come out as noise', () => {
  const p = pair();
  // The lights beep and the gate drops inside the first five seconds. Both are
  // NAMES on the wire — the guest has no engine of its own to produce them.
  while (!p.guest.gateOpen && p.now() - CLOCK_START < 20_000) p.tick();
  for (let i = 0; i < 20; i++) p.tick(); // let the last of the sequence land
  const cues = p.guest.drainCues();
  assert.ok(cues.length > 0, 'the guest heard something');
  for (const cue of cues) {
    assert.equal(typeof cue.type, 'string');
    assert.ok(Number.isFinite(cue.x) && Number.isFinite(cue.y), 'a cue plays somewhere on the track');
    assert.equal(cue.player, true);
  }
  assert.ok(cues.some((c) => c.type === 'go' || c.type === 'light'), `expected the start sequence, got ${cues.map((c) => c.type).join(', ')}`);
  // Drained is drained: the mixer must not play the same beep twice.
  assert.deepEqual(p.guest.drainCues(), []);
  p.host.dispose();
  p.guest.dispose();
});

test('MP-08 session: the room’s word about a drop reaches the host, and a returner gets their marble back', () => {
  // The whole point of MP-08 in one test: the room notices (it is the only end
  // that can), the host acts (it is the only end holding the marble), and the
  // driver who comes back gets the same marble back.
  const p = pair();
  for (let i = 0; i < 200; i++) p.tick();
  assert.equal(p.host.aiSeats.length, 0);
  assert.ok(p.host.game.humanInput.has(1), 'the guest is driving its own marble');

  p.host.accept({ type: 'peerStatus', playerId: 'player-1', status: 'disconnected', graceMs: 30_000, username: 'Guest' });
  assert.equal(p.host.dropped.length, 1, 'the host heard the room');
  for (let i = 0; i < 200; i++) p.tick(); // 3.3 s of racing without them
  assert.deepEqual([...p.host.aiSeats], [1], 'three seconds later the AI has it');
  assert.ok(!p.host.game.humanInput.has(1));

  // Ten seconds gone — the seat is still held, so they are still in the race.
  p.host.accept({ type: 'peerStatus', playerId: 'player-1', status: 'reconnected', username: 'Guest' });
  assert.deepEqual([...p.host.aiSeats], [], 'and it is theirs again');
  assert.ok(p.host.game.humanInput.has(1));
  assert.equal(p.host.dropped.length, 0, 'with no badge left on them');
});

test('MP-08 session: a page that comes back asks for the world instead of waiting for it', () => {
  // A reloaded tab has never seen a frame. The room re-greets it (the seat is
  // still theirs — the room test covers that), and the guest's answer is to ask
  // for the world at once rather than racing blind until a gap trips the
  // resync-on-gap path.
  const p = pair();
  for (let i = 0; i < 120; i++) p.tick();
  p.guestFrames.length = 0;
  p.guest.accept({ type: 'welcome', v: 1, seed: SEED, hostId: 'player-0', seats: grid(), settings: { circuit: 0 } });
  assert.ok(
    p.guestFrames.some((f) => f.type === 'resync'),
    'a returning page asks for the world the moment the room says hello',
  );
});

test('MP-08 session: the host answers the room’s re-greeting with the grid it knows', () => {
  // A returner is welcomed by the ROOM (a seating plan) and described by the
  // HOST (the liveries, the tunes, the faces). Both frames have to reach them
  // or they race a grid of placeholders.
  const p = pair();
  for (let i = 0; i < 60; i++) p.tick();
  p.hostFrames.length = 0;
  p.host.accept({ type: 'welcome', v: 1, seed: SEED, hostId: 'player-0', seats: grid(), settings: { circuit: 0 } });
  const lobbies = p.hostFrames.filter((f) => f.type === 'lobby');
  assert.equal(lobbies.length, 1, 'the host says what the grid looks like, once');
  // And the returner's own page asks for the world, because a welcome is not a
  // race — the marbles are already out there.
  p.guestFrames.length = 0;
  p.guest.accept({ type: 'welcome', v: 1, seed: SEED, hostId: 'player-0', seats: grid(), settings: { circuit: 0 } });
  assert.ok(p.guestFrames.some((f) => f.type === 'resync'), 'and the returning page asks for it');
});

test('MP-09 session: what a driver is carrying is the same on both screens', () => {
  // The kit lives on the host's marble; a guest sees it because the host
  // republishes the world when it changes. A toolbar that says three when the
  // marble holds one is a lie the player pays for.
  const p = pair();
  for (let i = 0; i < 60; i++) p.tick();
  assert.deepEqual(p.guest.kit, p.host.game.marbles[1].inventory, 'the guest sees its own kit');

  p.host.game.marbles[1].inventory.rocket = 3;
  for (let i = 0; i < 60; i++) p.tick();
  assert.equal(p.guest.kit.rocket, 3, 'and it is told when it changes');
  assert.deepEqual(p.guest.kit, p.host.game.marbles[1].inventory);

  // And the host's own seat is its own business, not the wire's.
  p.host.game.marbles[0].inventory.jump = 1;
  for (let i = 0; i < 60; i++) p.tick();
  assert.deepEqual(p.host.kit, p.host.game.marbles[0].inventory);
  assert.equal(p.guest.kit.jump, 0, 'the guest does not borrow the host’s kit');
});

test('MP-06 session: the screen holds one grid, numbered the same way on both ends', () => {
  const p = pair();
  const seats = grid();
  assert.deepEqual(p.host.roster, rosterOf(seats, 0));
  assert.deepEqual(p.guest.roster, rosterOf(seats, 1));
  assert.deepEqual(p.host.gridOrder, gridOrderOf(seats));
  assert.deepEqual(p.guest.gridOrder, gridOrderOf(seats));
  assert.equal(p.host.roster[0].isPlayer, true);
  assert.equal(p.guest.roster[1].isPlayer, true);
  // The seats a session was built with are the seats it races — a guest is not
  // free to invent a grid the host is not simulating.
  assert.deepEqual(p.guest.seats, p.host.seats);
  p.host.dispose();
  p.guest.dispose();
});
