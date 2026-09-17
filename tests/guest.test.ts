// ══════════════════════════════════════════════════════════════════════════
// MP-05 — the guest renders, never simulates.
//
// These tests stand a host and a guest either side of a fake network: a queue
// with a delivery time and a seeded coin for loss. Everything else is the real
// thing — the host's Matter.js world, the guest's interpolation, the packing
// and the chunking.
//
// The acceptance is one line: with 150 ms of latency and 2 % loss, guest motion
// is smooth and never desyncs for more than one resync. So the first test plays
// a whole race across that network and measures both.
// ══════════════════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateTrack, meta } from '../src/game/track';
import { AI_COLORS, AI_NAMES, mulberry32, randomStats } from '../src/game/types';
import { RaceHost, COUNTDOWN_MS } from '../src/net/host';
import { LIGHTS_OUT_STAGE } from '../src/game/engine';
import type { RaceHostOptions } from '../src/net/host';
import { RaceGuest, MAX_LOCAL_TILT } from '../src/net/guest';
import {
  MARBLE_COUNT,
  chunkSnapshot,
  packState,
  unpackState,
  type MarbleState,
  type RaceEvent,
  type RaceProtocol,
  type Seat,
} from '../src/net/protocol';

const SEED = 90210;
const FRAME_MS = 1000 / 60;
const CLOCK_START = 1_700_000_000_000;
const LATENCY_MS = 150;
const LOSS = 0.02;

function grid(humans = 2): Seat[] {
  const rng = mulberry32(31337);
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

interface Wire {
  /** Advance one rendered frame on both ends: host steps, network moves, guest draws. */
  tick(): void;
  host: RaceHost;
  guest: RaceGuest;
  now(): number;
  /** Delivered-frame count, and how many the network ate. */
  dropped: number;
  delivered: number;
}

/**
 * A host and a guest joined by a network that is late and lossy. Loss is
 * decided by a SEEDED coin (`mulberry32`), so a failing run is a failing run
 * tomorrow too.
 */
function wire(opts: { latencyMs?: number; loss?: number; blackout?: (frame: number) => boolean } = {}): Wire {
  const latency = opts.latencyMs ?? LATENCY_MS;
  const loss = opts.loss ?? LOSS;
  const rng = mulberry32(0xc0ffee);
  let now = CLOCK_START;
  const toGuest: { msg: RaceProtocol; due: number }[] = [];
  const toHost: { msg: RaceProtocol; due: number }[] = [];
  let dropped = 0;
  let delivered = 0;
  let frame = 0;

  const hostOptions: RaceHostOptions = {
    seed: SEED,
    seats: grid(),
    track: generateTrack(SEED),
    now: () => now,
    send: (msg) => {
      if (opts.blackout?.(frame)) return; // a hole in the network
      if (rng() < loss) {
        dropped++;
        return;
      }
      toGuest.push({ msg, due: now + latency });
    },
    localSeat: 0,
  };
  const host = new RaceHost(hostOptions);
  // The guest builds its OWN circuit from the seed — that is the whole trick
  // behind naming track bodies by index.
  const guest = new RaceGuest({
    seed: SEED,
    seats: grid(),
    track: generateTrack(SEED),
    localSeat: 1,
    now: () => now,
    send: (msg) => toHost.push({ msg, due: now + latency }),
  });

  const deliver = () => {
    for (const queue of [toGuest, toHost]) {
      while (queue.length && queue[0].due <= now) {
        const { msg } = queue.shift()!;
        delivered++;
        if (queue === toGuest) guest.accept(msg);
        else host.accept(msg);
      }
    }
  };

  return {
    host,
    guest,
    now: () => now,
    get dropped() {
      return dropped;
    },
    get delivered() {
      return delivered;
    },
    tick() {
      frame++;
      now += FRAME_MS;
      host.advance(FRAME_MS);
      deliver();
      guest.update(now);
    },
  };
}

const flat = (host: RaceHost): string => packState(host.game.marbleStates());

/** Give the guest the whole world the way a joiner receives it: chunk by chunk. */
function handOver(host: RaceHost, guest: RaceGuest): void {
  const frames = chunkSnapshot(host.snapshot(), host.sequence, 1);
  for (const chunk of frames) guest.acceptChunk(chunk);
}

test('MP-05 guest: 150 ms and 2 % loss — a whole race, smooth, and at most one resync', (context) => {
  const net = wire();
  net.host.scheduleStart(net.now() + COUNTDOWN_MS);
  handOver(net.host, net.guest); // the guest joins before the lights

  const path: { x: number; y: number }[] = [];
  let frames = 0;
  let staleFrames = 0;
  while (!net.host.results && frames < 60_000) {
    net.tick();
    frames++;
    if (!net.guest.ready) continue;
    const me = net.guest.me;
    // Only while it is racing: the moment a marble finishes, BOTH ends park it
    // by the finish line in one step, and that is a teleport by design.
    if (me.finishedAt === null) path.push({ x: me.body.position.x, y: me.body.position.y });
    if (net.guest.lagMs > 400) staleFrames++;
  }
  const results = net.host.results;
  assert.ok(results, 'the race finished');

  // The results frame is 150 ms away when the host sends it, and so are the
  // last few state frames. Let the network catch up before comparing what the
  // two screens know — a guest can only agree with a host it has heard from.
  let settle = 0;
  while (!net.guest.results && settle++ < 900) net.tick();
  assert.ok(net.guest.results, 'the guest got the results too');

  // ── Smooth ───────────────────────────────────────────────────────────────
  // Distance moved between two rendered frames. A marble in free fall covers
  // real ground, so this is a ceiling on TELEPORTING, not on speed.
  const steps: number[] = [];
  for (let i = 1; i < path.length; i++) steps.push(Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  steps.sort((a, b) => a - b);
  const max = steps.at(-1) ?? 0;
  const p99 = steps[Math.floor(steps.length * 0.99)] ?? 0;
  context.diagnostic(
    `${net.delivered} frames delivered, ${net.dropped} eaten; ${steps.length} drawn ` +
    `(median ${steps[Math.floor(steps.length / 2)]?.toFixed(1)}px, p99 ${p99.toFixed(1)}px, max ${max.toFixed(1)}px)`,
  );
  assert.ok(steps.length > 1000, 'the guest drew a race, not a moment of one');
  assert.ok(p99 < 60, `the 99th-percentile step is ${p99.toFixed(1)}px — that is a teleport, not motion`);
  // The worst step is bounded by what a marble can cover: the speed cap is 32
  // units per 120 Hz tick, so a 60 Hz frame moves one at most ~64 px, and the
  // playout clock is allowed to run 25 % fast while it catches up after a hole.
  assert.ok(max < 120, `the worst step is ${max.toFixed(1)}px — more than a catch-up frame's worth`);
  assert.ok(staleFrames < steps.length * 0.02, `${staleFrames} frames were drawn more than 400 ms stale`);

  // ── And it never lost the plot ────────────────────────────────────────────
  context.diagnostic(`resyncs asked for: ${net.guest.resyncs}`);
  assert.ok(net.guest.resyncs <= 1, `the guest asked for ${net.guest.resyncs} resyncs`);
  assert.equal(net.guest.pending, false, 'no transfer left hanging');

  // The guest's world agrees with the host's on the things that matter.
  for (let seat = 0; seat < MARBLE_COUNT; seat++) {
    const mine = net.guest.game.marbles[seat];
    const theirs = net.host.game.marbles[seat];
    assert.equal(mine.pegs, theirs.pegs, `seat ${seat} counted different pegs`);
    assert.equal(mine.finishedAt !== null, theirs.finishedAt !== null, `seat ${seat} disagrees about finishing`);
  }
  assert.deepEqual(
    net.guest.game.finishOrder.map((m) => m.info.id),
    net.host.game.finishOrder.map((m) => m.info.id),
    'the finishing order is the same on both screens',
  );
  assert.equal(net.guest.game.destroyedIndices().length > 0, true, 'the guest removed the pegs the host popped');
});

test('MP-06 guest: the lights-out state frame opens the gate, with no snapshot in sight', () => {
  // A guest that joined before the lights and never asked for the world sees
  // nothing but state frames. The light stage rides in them — but the gate does
  // not, and a guest whose `gateOpen` stayed false would watch the lights reach
  // five and then stand still while the host's field was already away.
  const net = wire({ latencyMs: 20, loss: 0 });
  net.host.scheduleStart(net.now() + COUNTDOWN_MS);
  assert.equal(net.guest.game.gateOpen, false);

  let frames = 0;
  while (!net.host.game.gateOpen && frames++ < 3000) net.tick();
  assert.ok(net.host.game.gateOpen, 'the host opened its gate');
  assert.ok(net.guest.game.stage < LIGHTS_OUT_STAGE, 'the guest has not been told yet — its frames are 20 ms old');
  assert.equal(net.guest.game.gateOpen, false);

  // Two frames later the lights-out stage has crossed the wire.
  for (let i = 0; i < 6; i++) net.tick();
  assert.ok(net.guest.game.gateOpen, 'the state frame opened the guest gate too');

  // And the marbles actually roll: the guest is racing, not posing.
  const before = net.guest.me.body.position.y;
  for (let i = 0; i < 120; i++) net.tick();
  assert.ok(net.guest.me.body.position.y > before + 50, `the guest marble moved ${(net.guest.me.body.position.y - before).toFixed(1)}px in two seconds`);
  assert.equal(net.guest.game.gateOpen, true, 'the gate stays open');
  assert.equal(net.guest.resyncs, 0, 'a plain start needs no resync');
});

test('MP-05 guest: a snapshot hands over the whole world', () => {
  const net = wire({ latencyMs: 0, loss: 0 });
  net.host.scheduleStart(net.now());
  for (let i = 0; i < 900; i++) net.tick(); // fifteen seconds: pegs pop, boxes empty
  assert.ok(net.host.game.destroyedIndices().length > 0, 'the host destroyed something first');

  const fresh = new RaceGuest({
    seed: SEED,
    seats: grid(),
    track: generateTrack(SEED),
    localSeat: 1,
    now: () => 0,
    send: () => {},
  });
  handOver(net.host, fresh);

  // Positions: the host rounds a snapshot to two decimals, so that is the tolerance.
  for (let seat = 0; seat < MARBLE_COUNT; seat++) {
    const mine = fresh.game.marbles[seat];
    const theirs = net.host.game.marbles[seat];
    assert.ok(Math.abs(mine.body.position.x - theirs.body.position.x) < 0.02, `seat ${seat} x`);
    assert.ok(Math.abs(mine.body.position.y - theirs.body.position.y) < 0.02, `seat ${seat} y`);
  }
  assert.deepEqual(fresh.game.destroyedIndices(), net.host.game.destroyedIndices(), 'the same geometry is gone');
  assert.deepEqual(fresh.game.boxStates(), net.host.game.boxStates(), 'the same boxes are live');
  assert.equal(fresh.game.oils.length, net.host.game.oils.length, 'the same slicks are on the track');
  assert.deepEqual(fresh.game.marbles.map((m) => m.pegs), net.host.game.marbles.map((m) => m.pegs), 'the same pegs are scored');
  assert.equal(fresh.game.gateOpen, true);
  assert.deepEqual(fresh.game.finishOrder.map((m) => m.info.id), net.host.game.finishOrder.map((m) => m.info.id));
  for (const index of net.host.game.destroyedIndices()) {
    assert.equal(meta(fresh.game.track.bodies[index]).destroyed, true, `body ${index} is still standing on the guest`);
  }
});

test('MP-05 guest: a blackout costs exactly one resync, and the world lands', () => {
  // Twenty frames of nothing: far more than a state frame can be late by, and
  // far more than the interpolation buffer can paper over.
  const net = wire({
    latencyMs: 40,
    loss: 0,
    blackout: (frame) => frame >= 600 && frame < 620,
  });
  net.host.scheduleStart(net.now());
  handOver(net.host, net.guest);

  let frames = 0;
  while (frames < 1200) {
    net.tick();
    frames++;
  }
  assert.equal(net.guest.resyncs, 1, 'one hole, one request (the retry is paced, not machine-gunned)');
  assert.equal(net.guest.pending, false, 'the world landed');
  assert.ok(net.guest.ready, 'and there is a picture again');

  // Back in step with the host: the guest is drawing the host's world, a
  // latency behind it, and not a frozen one.
  const gap = Math.abs(net.guest.game.time - net.host.game.time);
  assert.ok(gap < 500, `guest clock is ${gap.toFixed(0)} ms from the host's`);
  for (let seat = 0; seat < MARBLE_COUNT; seat++) {
    const mine = net.guest.game.marbles[seat];
    const theirs = net.host.game.marbles[seat];
    if (theirs.finishedAt !== null) continue;
    const distance = Math.hypot(mine.body.position.x - theirs.body.position.x, mine.body.position.y - theirs.body.position.y);
    assert.ok(distance < 400, `seat ${seat} is ${distance.toFixed(0)}px from where the host has it`);
  }
});

test('MP-05 guest: late, duplicate and out-of-order frames do not move the picture backwards', () => {
  const net = wire({ latencyMs: 0, loss: 0 });
  net.host.scheduleStart(net.now());
  handOver(net.host, net.guest);
  for (let i = 0; i < 400; i++) net.tick();

  const host = net.host;
  let t = net.now();
  /** Move the guest's own clock; the host is not ticking, so the network is quiet. */
  const draw = (times = 10) => {
    for (let i = 0; i < times; i++) {
      t += FRAME_MS;
      net.guest.update(t);
    }
  };
  const drawn = net.guest.sequence;
  const a = { type: 'state' as const, seq: drawn + 1, t: host.game.time, marbles: flat(host) };

  net.guest.acceptState(a, t);
  net.guest.acceptState(a, t); // the same frame again
  net.guest.acceptState({ type: 'state', seq: drawn - 1, t: 0, marbles: flat(host) }, t); // one it drew already
  draw();
  assert.equal(net.guest.sequence, drawn + 1, 'the newer frame is drawn, the duplicate and the late one are not');

  // Out of order: seq+3 lands before seq+2. Both are kept, and the picture only
  // ever moves forward.
  const b = { type: 'state' as const, seq: drawn + 2, t: host.game.time + 50, marbles: flat(host) };
  const c = { type: 'state' as const, seq: drawn + 3, t: host.game.time + 100, marbles: flat(host) };
  net.guest.acceptState(c, t);
  net.guest.acceptState(b, t);
  draw(20);
  assert.equal(net.guest.sequence, drawn + 3, 'the newest frame wins');

  // And a frame that is not a frame at all is dropped rather than decoded.
  net.guest.acceptState({ type: 'state', seq: drawn + 4, t: 0, marbles: 'not base64 at all!' }, t);
  draw(20);
  assert.equal(net.guest.sequence, drawn + 3, 'garbage is not drawn');
});

test('MP-05 guest: the host\'s events change what the guest draws', () => {
  const host = new RaceHost({ seed: SEED, seats: grid(), track: generateTrack(SEED), now: () => 0, send: () => {}, localSeat: 0 });
  const guest = new RaceGuest({ seed: SEED, seats: grid(), track: generateTrack(SEED), localSeat: 1, now: () => 0, send: () => {} });
  handOver(host, guest);

  let clock = 1000;
  let seq = guest.sequence;
  /**
   * One state frame and the events that belong to it, as the host would send
   * them. `patch` edits the frame, because the frame is authoritative: a host
   * whose marble is frozen says so in the flag byte, and a test that freezes a
   * marble with an event alone has written a frame that contradicts itself.
   */
  const play = (list: RaceEvent[], patch?: (m: MarbleState, seat: number) => MarbleState): void => {
    seq++;
    const states = host.game.marbleStates().map((m, seat) => (patch ? patch(m, seat) : m));
    guest.acceptState({ type: 'state', seq, t: host.game.time, marbles: packState(states) }, clock);
    guest.acceptEvents({ type: 'events', seq, list });
    // Draw out the delay: events are held until the picture REACHES the frame
    // they belong to, which is the point — they are drawn in step with the
    // state they describe, not when they happen to arrive.
    for (let i = 0; i < 10; i++) {
      clock += FRAME_MS;
      guest.update(clock);
    }
  };

  const track = guest.game.track;
  const pegIndex = track.bodies.findIndex((b) => meta(b).kind === 'ppeg' && meta(b).pegColor === 'orange');
  const boxIndex = track.bodies.findIndex((b) => meta(b).kind === 'itembox');
  assert.ok(pegIndex >= 0 && boxIndex >= 0, 'the circuit has a scoring peg and an item box');

  const seat = 3;
  const before = guest.game.marbles[seat].pegs;
  play([{ kind: 'peg', i: pegIndex, seat }]);
  assert.equal(meta(track.bodies[pegIndex]).destroyed, true, 'the peg is gone');
  assert.equal(guest.game.marbles[seat].pegs, before + 1, 'and it scored');

  play([{ kind: 'box', i: boxIndex, taken: true, seat }]);
  assert.equal(meta(track.bodies[boxIndex]).active, false, 'the box was taken');
  play([{ kind: 'box', i: boxIndex, taken: false }]);
  assert.equal(meta(track.bodies[boxIndex]).active, true, 'and respawned');

  play([{ kind: 'oil', x: 100, y: 200, r: 48, seat, until: 9000 }]);
  assert.equal(guest.game.oils.length, 1, 'the slick is on the track');

  play([{ kind: 'freeze', seat, by: 2, until: 2500 }], (m, i) => (i === seat ? { ...m, frozen: true } : m));
  assert.equal(guest.game.marbles[seat].frozen, true, 'the marble is in ice');
  assert.ok(guest.game.marbles[seat].body.isStatic, 'and it cannot be rolled');

  play([{ kind: 'sound', cue: 'finish', seat }]);
  assert.deepEqual(guest.drainCues(), ['finish'], 'the cue is queued for the mixer');
  assert.deepEqual(guest.drainCues(), [], 'and drained once');

  // A shock shatters ice — otherwise the guest would leave a marble frozen in
  // ice the host has already melted.
  play([{ kind: 'shock', seat: 2, x: 100, y: 200 }], (m, i) => (i === seat ? { ...m, frozen: false } : m));
  assert.equal(guest.game.marbles[seat].frozen, false, 'the shock freed it');

  // A finish parks the marble where the host parks finishers.
  const finisher = 4;
  play([{ kind: 'finish', seat: finisher, time: 61000, rank: 1 }]);
  assert.equal(guest.game.marbles[finisher].finishedAt, 61000);
  assert.ok(guest.game.marbles[finisher].body.isSensor, 'and it is off the track');
  assert.deepEqual(guest.game.finishOrder.map((m) => m.info.id), [finisher]);
  assert.ok(guest.game.effects.length > 0, 'and it drew the ring');
});

test('MP-05 guest: an events frame the network eats is said again', () => {
  const out: RaceProtocol[] = [];
  let clock = 0;
  const host = new RaceHost({ seed: SEED, seats: grid(), track: generateTrack(SEED), now: () => clock, send: (m) => out.push(m), localSeat: 0 });
  const guest = new RaceGuest({ seed: SEED, seats: grid(), track: generateTrack(SEED), localSeat: 1, now: () => 0, send: () => {} });
  host.game.openGate();
  handOver(host, guest); // the guest joins before anything has been published
  const events = () => out.filter((f): f is Extract<RaceProtocol, { type: 'events' }> => f.type === 'events');

  // Publish once with something to say, then again with something else.
  host.game.emit({ kind: 'peg', i: 0, seat: 1 });
  clock += 60;
  host.advance(60);
  const first = events();
  assert.equal(first.length, 1, 'one batch published');
  const lost = first[0];

  host.game.emit({ kind: 'peg', i: 1, seat: 2 });
  clock += 60;
  host.advance(60);
  const second = events();

  // The second publish repeats the first batch, sequence number and all: a
  // guest that missed the frame gets it from the next one.
  assert.ok(
    second.some((f) => f.seq === lost.seq && JSON.stringify(f.list) === JSON.stringify(lost.list)),
    'the host said the first batch again',
  );

  // And a guest that only ever saw the second publish still applies both.
  let drawn = 5_000;
  for (const frame of second) {
    guest.acceptState({ type: 'state', seq: frame.seq, t: host.game.time, marbles: packState(host.game.marbleStates()) }, drawn);
    guest.acceptEvents(frame);
    drawn += 16;
    guest.update(drawn);
  }
  // Draw out the delay: the last batch is held until the picture reaches the
  // frame it belongs to.
  for (let i = 0; i < 10; i++) {
    drawn += 16;
    guest.update(drawn);
  }
  assert.equal(meta(guest.game.track.bodies[0]).destroyed, true, 'the frame that went missing was recovered');
  assert.equal(meta(guest.game.track.bodies[1]).destroyed, true, 'and the one that arrived was applied');
});

test('MP-05 guest: a forged body index is ignored, not crashed on', () => {
  const guest = new RaceGuest({
    seed: SEED,
    seats: grid(),
    track: generateTrack(SEED),
    localSeat: 1,
    now: () => 0,
    send: () => {},
  });
  const bodies = guest.game.track.bodies.length;
  const standing = () => guest.game.track.bodies.filter((b) => meta(b).destroyed).length;
  const before = standing();
  guest.acceptState({ type: 'state', seq: 1, t: 0, marbles: packState(guest.game.marbleStates()) }, 0);
  guest.acceptEvents({
    type: 'events',
    seq: 1,
    list: [
      { kind: 'peg', i: -1, seat: 0 },
      { kind: 'peg', i: bodies + 10, seat: 0 },
      { kind: 'peg', i: Number.NaN, seat: 0 },
      { kind: 'crate', i: bodies * 2, hp: 0, broken: true },
    ],
  });
  guest.update(16);
  assert.equal(guest.game.marbles[0].pegs, 0, 'nothing was scored from a body that cannot exist');
  assert.equal(standing(), before, 'and nothing that does exist was destroyed');
});

test('MP-05 guest: the local marble leans at once, bounded, and the next frame overwrites it', () => {
  const guest = new RaceGuest({ seed: SEED, seats: grid(), track: generateTrack(SEED), localSeat: 1, now: () => 0, send: () => {} });
  const still = () => packState(Array.from({ length: MARBLE_COUNT }, () => ({
    x: 450, y: 500, vx: 0, vy: 0, a: 0, finished: false, frozen: false, oil: false, ghost: false, anvil: false, loop: 0,
  })));
  let clock = 10_000;
  let seq = 0;
  const draw = (times = 1) => {
    for (let i = 0; i < times; i++) {
      clock += FRAME_MS;
      guest.update(clock);
    }
  };
  const frame = () => {
    seq++;
    guest.acceptState({ type: 'state', seq, t: seq * 50, marbles: still() }, clock);
  };
  frame();
  frame();
  draw(10);
  const mine = guest.me;
  assert.ok(Math.abs(mine.body.angle) < 1e-9, 'a still world draws no lean at all');

  // Key down: the marble leans on this frame, without waiting for the host.
  guest.setLocalNudge(1);
  draw();
  const leaned = mine.body.angle;
  assert.ok(leaned > 0, 'the marble leans the moment the key goes down');

  // Held down it saturates instead of spinning the marble away.
  for (let i = 0; i < 100; i++) {
    guest.setLocalNudge(1);
    draw();
  }
  assert.ok(mine.body.angle <= MAX_LOCAL_TILT + 1e-9, `the lean is bounded (${mine.body.angle.toFixed(3)} rad)`);

  // Key up: the frames from the host overwrite it, and it decays away.
  for (let i = 0; i < 60; i++) {
    frame();
    draw();
  }
  assert.ok(Math.abs(mine.body.angle) < 0.01, `the lean is gone (${mine.body.angle.toFixed(4)} rad)`);
});

test('MP-05 guest: interpolation lands between two frames, not on one', () => {
  const guest = new RaceGuest({ seed: SEED, seats: grid(), track: generateTrack(SEED), localSeat: 1, now: () => 0, send: () => {} });

  const row = (y: number): MarbleState[] =>
    Array.from({ length: MARBLE_COUNT }, (_, i) => ({
      x: 100 + i * 10, y: i === 0 ? y : 200, vx: 0, vy: 0, a: 0,
      finished: false, frozen: false, oil: false, ghost: false, anvil: false, loop: 0,
    }));

  // Two frames, 50 ms apart: marble 0 falls 100 px between them.
  guest.acceptState({ type: 'state', seq: 1, t: 0, marbles: packState(row(100)) }, 1_000);
  guest.acceptState({ type: 'state', seq: 2, t: 50, marbles: packState(row(200)) }, 1_050);

  guest.update(1_125); // render 100 ms behind, halfway between the two arrivals
  const y = guest.game.marbles[0].body.position.y;
  assert.ok(y > 100 && y < 200, `drew y=${y} — a frame, not a blend of two`);
  assert.ok(Math.abs(y - 150) < 1, `drew y=${y}, the midpoint is 150`);

  guest.update(1_150); // the second frame's arrival: it should be fully caught up
  assert.ok(Math.abs(guest.game.marbles[0].body.position.y - 200) < 1, 'and it lands on the newer frame');
  assert.equal(unpackState(packState(row(200)))!.length, MARBLE_COUNT, 'the wire round-trips');
});
