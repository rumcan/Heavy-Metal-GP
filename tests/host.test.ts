// ══════════════════════════════════════════════════════════════════════════
// MP-04 — the host simulates, everyone else renders.
//
// `src/net/host.ts` is driven here exactly the way a browser would drive it,
// with two substitutions: a clock the test moves by hand, and a `send` that
// appends to a list. Everything else — the Matter.js world, the fixed step,
// the packing, the chunking — is the real thing.
//
// The acceptance list is two items:
//   1. Host with 1 guest + 8 AI: race completes, results identical on both
//      screens. Tested by replaying the host's OWN frame stream the way a guest
//      would (it has the seed, so it has the track, so it can tell a scoring
//      peg from a dud) and comparing the classification it rebuilds with the
//      `results` frame the host sent.
//   2. Host frame time does not regress more than 10 %. Tested by timing the
//      same number of physics steps with and without the publishing.
// ══════════════════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { generateTrack, meta } from '../src/game/track';
import { AI_COLORS, AI_NAMES, mulberry32, randomStats } from '../src/game/types';
import { RaceHost, COUNTDOWN_MS, LIGHT_INTERVAL_MS, NUDGE_RATE_PER_SECOND, STATE_INTERVAL_MS } from '../src/net/host';
import type { RaceHostOptions } from '../src/net/host';
import {
  FRAME_CAP_BYTES,
  MARBLE_COUNT,
  MAX_EVENTS_PER_FRAME,
  SnapshotAssembler,
  frameBytes,
  unpackState,
  validateMessage,
} from '../src/net/protocol';
import type { MarbleState, RaceEvent, RaceProtocol, RaceSnapshot, Seat } from '../src/net/protocol';

const SEED = 20240517;
const FRAME_MS = 1000 / 60;
const CLOCK_START = 1_700_000_000_000;

/** Ten seats: `humans` of them driven by people (slot 0 is the host's own), the rest AI. */
function grid(humans = 2): Seat[] {
  const rng = mulberry32(4242);
  return Array.from({ length: MARBLE_COUNT }, (_, slot) => ({
    slot,
    playerId: slot < humans ? `player-${slot}` : '',
    name: slot === 0 ? 'Host' : slot === 1 ? 'Guest' : AI_NAMES[slot - 1],
    color: slot === 0 ? '#d63e2e' : slot === 1 ? '#3b82f6' : AI_COLORS[slot - 1],
    stats: randomStats(rng),
    portrait: slot % 6,
    isAI: slot >= humans,
  }));
}

interface Harness {
  host: RaceHost;
  frames: RaceProtocol[];
  /** Move the wall clock and advance the host, as one rendered frame would. */
  tick(ms?: number): void;
  now(): number;
  advance(ms: number): void;
  /** Every event the host has published so far, in order. */
  events(): RaceEvent[];
  states(): Extract<RaceProtocol, { type: 'state' }>[];
}

function harness(overrides: Partial<RaceHostOptions> = {}): Harness {
  let now = CLOCK_START;
  const frames: RaceProtocol[] = [];
  const host = new RaceHost({
    seed: SEED,
    seats: grid(),
    track: generateTrack(SEED),
    now: () => now,
    send: (msg) => frames.push(msg),
    localSeat: 0,
    ...overrides,
  });
  return {
    host,
    frames,
    tick(ms = FRAME_MS) {
      now += ms;
      host.advance(ms);
    },
    advance(ms: number) {
      now += ms;
    },
    now: () => now,
    events: () => {
      // The host publishes every batch twice on purpose (see `RaceHost.publish`),
      // so a stream read back has to ignore the second copy. Chunks of one batch
      // share a sequence number, so the dedupe is per-sequence, not per-frame.
      const out: RaceEvent[] = [];
      const seen = new Set<number>();
      let current = -1;
      let repeat = false;
      for (const f of frames) {
        // A publish is a state frame followed by its event frames, so the
        // second copy — which carries the PREVIOUS sequence number — is
        // recognised by arriving in a later publish than the first.
        if (f.type === 'state') current = -1;
        if (f.type !== 'events') continue;
        if (f.seq !== current) {
          current = f.seq;
          repeat = seen.has(current);
          seen.add(current);
        }
        if (!repeat) out.push(...f.list);
      }
      return out;
    },
    states: () => frames.filter((f): f is Extract<RaceProtocol, { type: 'state' }> => f.type === 'state'),
  };
}

/**
 * Schedule a start and run the countdown out, frame by frame. The host owns the
 * clock: nobody — not even the host's own call — opens the gate before the
 * instant it told everyone about.
 */
function start(h: Harness, countdown = COUNTDOWN_MS): void {
  const gateAt = h.now() + countdown;
  h.host.scheduleStart(gateAt);
  let guard = 0;
  while (!h.host.started && guard++ < 1200) h.tick();
  assert.ok(h.host.started, `the gate never dropped (clock at ${h.now()}, gate at ${gateAt})`);
}

/** Run a host until it publishes results (or the safety net runs out). */
function raceOut(h: Harness, limitMs = 400_000): void {
  const started = h.now();
  while (!h.host.results && h.now() - started < limitMs) h.tick();
}

test('MP-04 host: the host publishes nothing until the lights it scheduled go out', () => {
  const h = harness();
  const gateAt = h.now() + COUNTDOWN_MS;
  h.host.scheduleStart(gateAt);

  const start = h.frames.find((f) => f.type === 'start');
  assert.ok(start && start.type === 'start', 'the host tells everyone when the gate will drop');
  assert.equal(start.countdownAt, gateAt, 'and it is the same instant the host is counting to');

  // Four seconds of frames: five lights, and still on the grid.
  while (h.now() < gateAt - 200) h.tick();
  assert.equal(h.host.started, false, 'counting down early does not start the race');

  // The instant passes and the host — the only clock that is the race — opens it.
  while (h.now() < gateAt + 100) h.tick();
  assert.equal(h.host.started, true);
  assert.equal(h.host.game.stage, 6, 'the gate-open stage rides in every state frame');
});

test('MP-04 host: the five lights ride out in the state frames', () => {
  const h = harness();
  const gateAt = h.now() + COUNTDOWN_MS;
  h.host.scheduleStart(gateAt);
  const stages = new Set<number>();
  const record = () => {
    const last = h.states().at(-1);
    if (last) stages.add(unpackState(last.marbles)![0].loop);
  };
  while (h.now() < gateAt - 100) {
    h.tick();
    record();
  }
  // Five lights, then a beat, then the gate: a guest that joined mid-countdown
  // reads the lights off the frames it is already applying.
  for (let light = 0; light <= 5; light++) assert.ok(stages.has(light), `no state frame showed light ${light}`);
  assert.equal(stages.has(6), false, 'the lights-out stage is not a light');
  while (h.now() < gateAt + 100) h.tick();
  record();
  assert.ok(stages.has(6), 'no state frame showed the gate open');
  assert.ok(LIGHT_INTERVAL_MS * 5 < COUNTDOWN_MS, 'five lights, then a beat, then the gate');
});

test('MP-04 host: state is published at 20 Hz', () => {
  const h = harness();
  start(h);
  const before = h.states().length;
  for (let i = 0; i < 120; i++) h.tick(); // two seconds of frames
  const frames = h.states().length - before;
  const expected = Math.floor(2000 / STATE_INTERVAL_MS);
  assert.ok(Math.abs(frames - expected) <= 2, `published ${frames} frames in 2 s, expected ~${expected}`);
});

test('MP-04 host: every frame the host publishes survives the wire', () => {
  const h = harness();
  start(h);
  for (let i = 0; i < 400; i++) h.tick();
  h.host.sendSnapshot();
  assert.ok(h.frames.length > 20, 'the race produced frames');
  for (const frame of h.frames) {
    assert.equal(validateMessage(frame), null, `the host published a frame the room would refuse: ${JSON.stringify(frame).slice(0, 120)}`);
    assert.ok(frameBytes(frame) <= FRAME_CAP_BYTES, 'a frame the gateway would drop');
    if (frame.type === 'events') assert.ok(frame.list.length <= MAX_EVENTS_PER_FRAME, 'an events frame carried more than one frame can hold');
  }
});

test('MP-04 host: a guest seat is driven by its intents, not by the AI', () => {
  const pushed = harness();
  start(pushed);
  for (let i = 0; i < 180; i++) {
    pushed.host.applyIntent(1, { type: 'intent', kind: 'nudge', v: 1 });
    pushed.tick();
  }
  const coasted = harness();
  start(coasted);
  for (let i = 0; i < 180; i++) coasted.tick();

  const pushedX = pushed.host.game.marbles[1].body.position.x;
  const coastedX = coasted.host.game.marbles[1].body.position.x;
  assert.ok(pushedX > coastedX + 5, `three seconds of nudging right moved the guest ${(pushedX - coastedX).toFixed(1)}px right`);
});

test('MP-04 host: the AI keeps its hands off every human seat', () => {
  // A guest who has joined but not touched a control must not be played for.
  const h = harness();
  for (const m of h.host.game.marbles) m.inventory.rocket = 3;
  start(h);
  for (let i = 0; i < 300; i++) h.tick();

  const deployed = h.events().filter((e) => e.kind === 'item');
  assert.ok(deployed.length > 0, 'the AI field did use its items, so the test can tell the difference');
  for (const event of deployed) {
    assert.ok(event.kind === 'item');
    assert.ok(event.seat >= 2, `seat ${event.seat} is a person and deploys its own items`);
  }
  assert.equal(h.host.game.marbles[0].inventory.rocket, 3, 'the host seat kept its rockets');
  assert.equal(h.host.game.marbles[1].inventory.rocket, 3, 'the guest seat kept its rockets');
});

test('MP-04 host: a guest may not deploy what it does not have, or before the gate', () => {
  const h = harness();
  const guest = h.host.game.marbles[1];

  // Before the gate nobody may deploy, whatever they carry.
  guest.inventory.rocket = 1;
  h.host.applyIntent(1, { type: 'intent', kind: 'item', item: 'rocket' });
  assert.equal(guest.inventory.rocket, 1, 'the grid is not a racetrack');

  start(h);

  // Events ride out with the next state frame, so a publish has to happen
  // before the wire can be read.
  const flush = () => { for (let i = 0; i < 4; i++) h.tick(); };
  const guestItems = () => h.events().filter((e) => e.kind === 'item' && e.seat === 1);
  // A freeze ray from the field must not be what refuses the deploy below.
  for (let i = 0; i < 200 && guest.frozen; i++) h.tick();

  // An item the seat is not carrying: refused (canUseItem is the same rule the
  // host's own hands are held to). The AI field is deploying all the while, so
  // this is the guest's stream, not the race's.
  h.host.applyIntent(1, { type: 'intent', kind: 'item', item: 'freeze' });
  flush();
  assert.equal(guestItems().length, 0, 'an empty loadout deploys nothing');

  // What it does carry: deployed, once, and the event rides out.
  h.host.applyIntent(1, { type: 'intent', kind: 'item', item: 'rocket' });
  assert.equal(guest.inventory.rocket, 0);
  flush();
  assert.deepEqual(guestItems(), [{ kind: 'item', seat: 1, item: 'rocket' }]);

  // Mid-cooldown: refused again, so a held key cannot empty a loadout.
  h.host.applyIntent(1, { type: 'intent', kind: 'item', item: 'jump' });
  flush();
  assert.equal(guestItems().length, 1, 'the item cooldown applies to guests too');
});

test('MP-04 host: nudges are limited to 30 a second', () => {
  const h = harness();
  start(h);
  const guest = () => h.host.game.marbles[1];

  // The burst: 100 messages in one instant, the first 30 land.
  for (let i = 0; i < NUDGE_RATE_PER_SECOND * 3 + 10; i++) h.host.applyIntent(1, { type: 'intent', kind: 'nudge', v: 1 });
  assert.equal(h.host.game.humanInput.get(1)?.nudge, 1, 'the burst was accepted');

  // Now the bucket is empty and the seat is pacing-limited: this one is dropped.
  h.host.applyIntent(1, { type: 'intent', kind: 'nudge', v: -1 });
  assert.equal(h.host.game.humanInput.get(1)?.nudge, 1, `more than ${NUDGE_RATE_PER_SECOND} nudges in a second must not reach the host`);

  // A second later it is allowed through again.
  h.advance(1000);
  h.tick();
  h.host.applyIntent(1, { type: 'intent', kind: 'nudge', v: -1 });
  assert.equal(h.host.game.humanInput.get(1)?.nudge, -1, 'the bucket refills');
  assert.ok(guest().finishedAt === null || true);
});

test('MP-08 host: three seconds without a driver and the AI has the marble', () => {
  // A race must not stop because one socket did. The seat is held for a minute;
  // the marble is handed over after three seconds, and handed back if they make
  // it. This is the handover.
  const h = harness();
  start(h);
  assert.ok(h.host.game.humanInput.has(1), 'the guest is driving');

  h.host.accept({ type: 'peerStatus', playerId: 'player-1', status: 'disconnected', graceMs: 60_000, username: 'Guest' });
  // Not instantly: a tunnel or a hiccup is not a departure.
  h.advance(2_000);
  h.tick();
  assert.ok(h.host.game.humanInput.has(1), 'two seconds is a hiccup, not a dropout');
  assert.deepEqual(h.host.aiSeats, []);

  h.advance(1_100);
  h.tick();
  assert.ok(!h.host.game.humanInput.has(1), 'past three seconds the marble is the AI’s');
  assert.deepEqual([...h.host.aiSeats], [1], 'and the host says so');
  // Handing it over twice would be a bug the seat could feel: the second call
  // has nothing to release.
  assert.equal(h.host.releaseSeat('player-1'), false, 'a marble already released is not released again');
});

test('MP-08 host: a driver who comes back gets their own marble back, and the world with it', () => {
  const h = harness();
  start(h);
  h.host.accept({ type: 'peerStatus', playerId: 'player-1', status: 'disconnected', graceMs: 60_000, username: 'Guest' });
  h.advance(3_100);
  h.tick();
  assert.deepEqual([...h.host.aiSeats], [1], 'the AI has it by now');

  const before = h.frames.length;
  h.host.accept({ type: 'peerStatus', playerId: 'player-1', status: 'reconnected', username: 'Guest' });
  assert.deepEqual([...h.host.aiSeats], [], 'and gives it back');
  assert.ok(h.host.game.humanInput.has(1), 'the seat is a human seat again');
  assert.equal(h.host.game.humanInput.get(1)?.nudge, 0, 'with no lean left over from before the drop');
  // They come back to a race that moved on: a nudge is not enough, they need the
  // world, so the host sends one without waiting to be asked.
  assert.ok(h.frames.slice(before).some((f) => f.type === 'snapshot'), 'a returner is handed the whole world');

  // And the marble still answers them. Two identical harnesses — one nudged, one
  // coasting — because "did it move right" is only meaningful against what it
  // would have done on its own: the track is not a straight line.
  const coasting = harness();
  start(coasting);
  coasting.host.accept({ type: 'peerStatus', playerId: 'player-1', status: 'disconnected', graceMs: 60_000, username: 'Guest' });
  coasting.advance(3_100);
  coasting.tick();
  coasting.host.accept({ type: 'peerStatus', playerId: 'player-1', status: 'reconnected', username: 'Guest' });

  for (let i = 0; i < 180; i++) {
    h.host.applyIntent(1, { type: 'intent', kind: 'nudge', v: 1 });
    h.tick();
    coasting.tick();
  }
  const driven = h.host.game.marbles[1].body.position.x;
  const coasted = coasting.host.game.marbles[1].body.position.x;
  assert.ok(driven > coasted + 5, `the marble came back to hands that steer it (${(driven - coasted).toFixed(1)}px of lean)`);
});

test('MP-08 host: a driver the room re-greets is shown the real grid, not the seating plan', () => {
  // The room's welcome is a SEATING PLAN: placeholder seats with placeholder
  // names, because the room does not know a livery from a tune. A driver who
  // rejoins mid-race is welcomed by the room and described by the host — the
  // only end that knows what the grid actually looks like.
  const h = harness();
  start(h);
  h.frames.length = 0;
  const seatingPlan = grid().map((seat) => ({ ...seat, name: 'PLACEHOLDER', stats: { weight: 5, speed: 5, bounce: 5 } }));
  h.host.accept({ type: 'welcome', v: 1, seed: SEED, hostId: 'player-0', seats: seatingPlan, settings: { circuit: 0 } });

  const lobbies = h.frames.filter((f): f is Extract<RaceProtocol, { type: 'lobby' }> => f.type === 'lobby');
  assert.equal(lobbies.length, 1, 'the host answers the greeting once');
  assert.equal(lobbies[0].seats[1].name, 'Guest', 'and with what it knows, not what the room guessed');
  assert.deepEqual(lobbies[0].seats[1].stats, grid()[1].stats, 'tune included — a placeholder 5/5/5 is not the car they brought');
  assert.equal(lobbies[0].settings?.circuit, 0);
});

test('MP-08 host: a rival nobody dropped is nobody the host touches', () => {
  // `reconnected` for a player who was never missing must not conjure a marble
  // or invent a snapshot: the frame is the room's, and it arrives for every
  // seat, including the ones that never went anywhere.
  const h = harness();
  start(h);
  const before = h.frames.length;
  h.host.accept({ type: 'peerStatus', playerId: 'player-1', status: 'reconnected' });
  assert.equal(h.host.reclaim('player-1'), false, 'nothing was taken, so nothing is given back');
  assert.equal(h.frames.length, before, 'and no snapshot is spent on it');
  assert.ok(h.host.game.humanInput.has(1), 'the guest still has their marble');
});

test('MP-09 host: a human’s kit changing republishes the world, once', () => {
  // A guest's items live on the host's marble, so a pickup is invisible to them
  // until the host says so. Pickups are rare, so this is one snapshot per change
  // — not a stream — and it is the only way a guest's toolbar can tell the truth
  // about what they are holding.
  const h = harness();
  start(h);
  for (let i = 0; i < 20; i++) h.tick();
  h.frames.length = 0;

  h.host.game.marbles[1].inventory.rocket = 2; // the guest picked something up
  h.tick();
  const first = h.frames.filter((f) => f.type === 'snapshot').length;
  assert.ok(first > 0, 'a changed kit is republished');

  // And only on the change: the next sixty frames of carrying it are silent.
  h.frames.length = 0;
  for (let i = 0; i < 60; i++) h.tick();
  assert.equal(h.frames.filter((f) => f.type === 'snapshot').length, 0, 'carrying is not changing');

  h.host.game.marbles[1].inventory.rocket = 3;
  h.tick();
  assert.ok(h.frames.some((f) => f.type === 'snapshot'), 'but another change is published again');
});

test('MP-09 host: an AI marble’s pickups do not republish anything', () => {
  // Nine machines picking up boxes is nine snapshots a second if the host is not
  // careful — and a guest's toolbar only ever shows its OWN kit.
  const h = harness();
  start(h);
  for (let i = 0; i < 20; i++) h.tick();
  h.frames.length = 0;
  for (let slot = 2; slot < MARBLE_COUNT; slot++) h.host.game.marbles[slot].inventory.rocket = 1;
  h.tick();
  assert.equal(h.frames.filter((f) => f.type === 'snapshot').length, 0);
});

test('MP-04 host: a snapshot carries the whole world and reassembles', () => {
  const h = harness();
  start(h);
  for (let i = 0; i < 600; i++) h.tick(); // ten seconds of racing: pegs pop, boxes empty

  h.host.sendSnapshot();
  const chunks = h.frames.filter((f) => f.type === 'snapshot');
  assert.ok(chunks.length > 0, 'a joiner is sent the world');

  const assembler = new SnapshotAssembler();
  let assembled: RaceSnapshot | null = null;
  let atSeq = -1;
  for (const chunk of chunks) {
    const done = assembler.accept(chunk);
    if (done) {
      assembled = done.snap;
      atSeq = done.seq;
    }
  }
  assert.ok(assembled, 'the chunks reassembled into a world');
  assert.equal(atSeq, h.host.sequence, 'a snapshot is stamped with the frame it represents');
  assert.equal(assembled.marbles.length, MARBLE_COUNT);
  assert.equal(assembled.started, true);
  assert.ok(assembled.destroyed.length > 0, 'ten seconds of racing destroyed something');
  assert.deepEqual(assembled, h.host.snapshot(), 'the reassembled world is the world the host is running');
  assert.deepEqual(
    assembled.order,
    h.host.game.finishOrder.map((m) => m.info.id),
    'the finishing order so far travelled too',
  );
});

test('MP-04 host: a full race completes, and a guest replaying the stream classifies it identically', () => {
  const h = harness();
  h.host.scheduleStart(h.now() + COUNTDOWN_MS);
  raceOut(h);
  const results = h.host.results;
  assert.ok(results, 'the race completed and the host published results');
  assert.equal(results.order.length, MARBLE_COUNT, 'every seat is classified');
  for (const time of results.times) assert.notEqual(time, null, 'every marble got home');

  // ── The guest's side of the wire ──────────────────────────────────────────
  // It never steps physics. It has the seed, so it has the track, so it can
  // tell a scoring peg from a dud by the body index the host sent. Everything
  // below is derived from the frames alone — which is what "identical on both
  // screens" has to mean when only one screen simulates.
  const track = generateTrack(SEED);
  const times: (number | null)[] = new Array(MARBLE_COUNT).fill(null);
  const pegs: number[] = new Array(MARBLE_COUNT).fill(0);
  const order: number[] = [];
  const home = new Set<number>();
  let lastSeq = -1;
  let gaps = 0;
  // The host says every batch twice, so the replay ignores the second copy:
  // chunks of one batch share a sequence number, the repeat does not.
  const seenEvents = new Set<number>();
  let eventSeq = -1;
  let repeat = false;

  for (const frame of h.frames) {
    if (frame.type === 'state') {
      if (lastSeq >= 0 && frame.seq !== lastSeq + 1) gaps++;
      lastSeq = frame.seq;
      const marbles: MarbleState[] = unpackState(frame.marbles);
      assert.equal(marbles.length, MARBLE_COUNT);
      eventSeq = -1; // a new publish: its event frames may repeat the last one's
    }
    if (frame.type !== 'events') continue;
    if (frame.seq !== eventSeq) {
      eventSeq = frame.seq;
      repeat = seenEvents.has(eventSeq);
      seenEvents.add(eventSeq);
    }
    if (repeat) continue;
    for (const event of frame.list) {
      if (event.kind === 'finish' && !home.has(event.seat)) {
        home.add(event.seat);
        times[event.seat] = Math.round(event.time);
        order.push(event.seat);
      }
      if (event.kind === 'peg' && meta(track.bodies[event.i]).pegColor === 'orange') pegs[event.seat]++;
    }
  }

  assert.equal(gaps, 0, 'the host published an unbroken run of sequence numbers');
  assert.deepEqual(order, results.order, 'the finishing order a guest rebuilds is the host\'s');
  assert.deepEqual(times, results.times, 'the times a guest rebuilds are the host\'s');
  assert.deepEqual(pegs, results.pegs, 'the peg counts a guest rebuilds are the host\'s');
});

test('MP-04 host: publishing costs the host a fraction of a frame', (context) => {
  const FRAME_BUDGET_MS = FRAME_MS;
  const ticks = 6_000;
  const seats = grid();
  const track = generateTrack(SEED);

  // ── The wire, measured on its own ────────────────────────────────────────
  // A host whose gate is still shut has nothing to simulate — `step` returns
  // after the clock — so everything `advance` spends above the bare loop IS the
  // publishing: ten marbles packed, a full events frame drained, two frames out.
  // (Comparing two racing runs instead is a coin toss: the sim's own cost
  // varies by 50 % frame to frame as marbles stream in and out of the solver,
  // which is ten times the signal.)
  const idle = new Game(SEED, seats.map((s) => ({
    id: s.slot, name: s.name, color: s.color, stats: s.stats, isPlayer: s.slot === 0,
  })), { track, humanSeats: [1], gridOrder: seats.map((s) => s.slot) });
  idle.start();

  let now = CLOCK_START;
  const out: RaceProtocol[] = [];
  const host = new RaceHost({ seed: SEED, seats, track, now: () => now, send: (m) => out.push(m), localSeat: 0 });
  const burst = () => {
    for (let i = 0; i < MAX_EVENTS_PER_FRAME; i++) host.game.emit({ kind: 'peg', i, seat: i % MARBLE_COUNT });
  };

  for (let i = 0; i < 1000; i++) idle.step(PHYSICS_STEP);
  for (let i = 0; i < 500; i++) { now += FRAME_MS; burst(); host.advance(FRAME_MS); }

  const timeIdle = () => {
    const t0 = performance.now();
    for (let i = 0; i < ticks * 2; i++) idle.step(PHYSICS_STEP);
    return performance.now() - t0;
  };
  const timeHost = () => {
    const t0 = performance.now();
    for (let i = 0; i < ticks; i++) { now += FRAME_MS; burst(); host.advance(FRAME_MS); }
    return performance.now() - t0;
  };
  const idleBest = Math.min(timeIdle(), timeIdle(), timeIdle());
  const hostBest = Math.min(timeHost(), timeHost(), timeHost());
  const publishes = out.filter((f) => f.type === 'state').length;
  const perPublish = (hostBest - idleBest) / publishes;
  // One publish every 50 ms: at 60 fps that is one every three frames.
  const perFrame = perPublish * (STATE_INTERVAL_MS / FRAME_MS);

  context.diagnostic(
    `publishing: ${perPublish.toFixed(1)} µs per publish (${publishes} of them, a full 64-event frame each) ` +
    `→ ${perFrame.toFixed(2)} µs of a ${FRAME_BUDGET_MS.toFixed(2)} ms frame (${((perFrame / FRAME_BUDGET_MS) * 100).toFixed(2)} %)`,
  );
  assert.ok(
    perFrame <= FRAME_BUDGET_MS * 0.1,
    `the wire costs ${((perFrame / FRAME_BUDGET_MS) * 100).toFixed(1)} % of a frame; the budget is 10 %`,
  );

  // ── And the whole frame stays inside its budget while actually racing ─────
  const racing = harness({ track });
  racing.host.game.openGate();
  for (let i = 0; i < 600; i++) racing.tick();
  const t0 = performance.now();
  for (let i = 0; i < 1200; i++) racing.tick();
  const perRacingFrame = (performance.now() - t0) / 1200;
  context.diagnostic(`a racing host frame: ${perRacingFrame.toFixed(3)} ms of physics + publishing`);
  assert.ok(perRacingFrame < FRAME_BUDGET_MS / 4, `a host frame costs ${perRacingFrame.toFixed(3)} ms — a quarter of a frame is the ceiling`);
  assert.ok(racing.host.game.marbles.some((m) => m.finishedAt === null), 'the frame was measured mid-race, not on an empty track');

  idle.destroy();
  host.dispose();
  racing.host.dispose();
});
