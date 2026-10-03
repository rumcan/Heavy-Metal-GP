// ══════════════════════════════════════════════════════════════════════════
// P2-19 — health, DNF, KOs and skill effects on the wire.
//
// Acceptance, one test each:
//
//   1. the hp byte and the DNF flag survive pack/unpack;
//   2. a snapshot's hp/dnf/kos are there when a joiner needs them, and a bad
//      one is refused;
//   3. every new race event validates, and a lie does not;
//   4. a host race on a platformer course, where health is on: a KO rides the
//      wire, and the guest replaying the stream classifies the race exactly
//      as the host did;
//   5. the online purse pays a KO bounty and the Shaman charges nothing.
//
// The pair harness is the session harness from MP-06 with the network taken
// out (no latency, no loss): a KO has to land on a known frame to be asserted,
// and the frames are the same frames either way.
// ══════════════════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';

import Matter from 'matter-js';
import { AI_COLORS, AI_NAMES, mulberry32, randomStats } from '../src/game/types';
import type { HeatResult, Seat, TrackProfile } from '../src/game/types';
import { dressGrid } from '../src/net/lobby';
import { RaceSession, START_ARM_MS } from '../src/net/session';
import {
  MARBLE_COUNT,
  PROTOCOL_VERSION,
  SKILL_FX_KINDS,
  isRaceSnapshot,
  packState,
  unpackState,
  validateMessage,
} from '../src/net/protocol';
import type { MarbleState, RaceEvent, RaceProtocol, RaceSnapshot } from '../src/net/protocol';
import { createAccount, onlineRaceId, settleOnlineRace, settleRace } from '../src/game/economy';
import { KO_BOUNTY } from '../src/game/settlement';

const { Body } = Matter;

const SEED = 4242;
const FRAME_MS = 1000 / 60;
const CLOCK_START = 1_700_000_000_000;

/** P2-00's platformer: health is on there, which is what this ticket races on. */
const PLATFORMER: TrackProfile = {
  segments: 10,
  weights: {},
  theme: { bg1: '#0b1220', bg2: '#132033', track: '#2b3a4d', pipe: '#3b4a5d', pipeEdge: '#4b5a6d' },
  generator: 'platformer',
  course: 'training',
};

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

const marbleState = (overrides: Partial<MarbleState> = {}): MarbleState => ({
  x: 1, y: 2, vx: -3.5, vy: 4.25, a: 0.5,
  finished: false, frozen: false, oil: false, ghost: false, anvil: false,
  loop: 0, lane: 1, hp: 1, dnf: false, ...overrides,
});

/** A valid snapshot off a real host, as a joiner would receive it. */
function snapshotOf(host: RaceSession): RaceSnapshot {
  const snap = host.host?.snapshot();
  assert.ok(snap, 'a host has a world to snapshot');
  return snap as RaceSnapshot;
}

test('P2-19 pack: hp and the DNF flag survive a packed frame', () => {
  const full = marbleState({ hp: 1 });
  const half = marbleState({ hp: 0.5 });
  // A frame of the wrong size is nobody's state: half a marble is worse than none.
  assert.equal(unpackState(packState([full, half]), 2)?.length, 2, 'two marbles read as two');
  assert.equal(unpackState(packState([full, half]), MARBLE_COUNT), null, 'a two-marble frame is not a grid');
  assert.deepEqual(unpackState(packState([full, half]), 2), unpackState(packState([full, half]), 2), 'and both ends read the same bytes');

  const frame = unpackState(packState([full, marbleState({ hp: 0.5, dnf: true })].concat(Array.from({ length: 8 }, () => full))))!;
  assert.equal(frame[0].hp, 1, 'a full bar is 255 on the wire');
  assert.equal(frame[0].dnf, false);
  assert.ok(Math.abs((frame[1].hp ?? 0) - 128 / 255) < 1e-9, `half a bar is 128/255, got ${frame[1].hp}`);
  assert.equal(frame[1].dnf, true, 'the DNF bit reads back');

  // 0 HP and the flag are the same story — and a knocked-out marble still has a lane and a stage.
  const ko = unpackState(packState([marbleState({ hp: 0, dnf: true, lane: 2, loop: 6 })].concat(Array.from({ length: 9 }, () => full))))!;
  assert.equal(ko[0].hp, 0);
  assert.equal(ko[0].dnf, true);
  assert.equal(ko[0].lane, 2);
  assert.equal(ko[0].loop, 6, 'the start-light stage still rides in the lane byte');
});

test('P2-19 snapshot: hp, dnf and kos are validated, and refused when they lie', () => {
  const seats = grid();
  const host = new RaceSession({
    seed: SEED, seats, profile: PLATFORMER, settings: { circuit: 0 }, localSeat: 0, isHost: true,
    send: () => {}, now: () => CLOCK_START, countdownAt: CLOCK_START + START_ARM_MS,
  });
  const snap = snapshotOf(host);
  assert.ok(isRaceSnapshot(snap), 'a host snapshot with health fields is a snapshot');
  // The host's own snapshot carries the fields (health is on for a platformer) — and a joiner that
  // reads it can set every marble's bar from it.
  for (const m of snap.marbles) {
    assert.equal(typeof m.hp, 'number', 'every marble carries its hp');
    assert.equal(m.dnf, false);
    assert.equal(m.kos, 0);
  }
  const warp = (patch: Partial<MarbleState>) => ({ ...snap, marbles: snap.marbles.map((m, i) => (i === 0 ? { ...m, ...patch } : m)) });
  assert.ok(isRaceSnapshot(warp({ hp: 0, dnf: true, kos: 3 })), 'a knocked-out marble is a legal snapshot row');
  assert.equal(isRaceSnapshot(warp({ hp: 1.5 })), false, 'hp is a fraction 0..1');
  assert.equal(isRaceSnapshot(warp({ hp: -0.1 })), false);
  assert.equal(isRaceSnapshot(warp({ hp: 'full' as unknown as number })), false);
  assert.equal(isRaceSnapshot(warp({ dnf: 'yes' as unknown as boolean })), false);
  assert.equal(isRaceSnapshot(warp({ kos: -1 })), false, 'a KO count is not negative');
  assert.equal(isRaceSnapshot(warp({ kos: 1.5 })), false, 'a KO count is whole');
  assert.equal(isRaceSnapshot(warp({ kos: 100_001 })), false);
  host.dispose();
});

test('P2-19 events: ko and skillfx are accepted, and a lie is not', () => {
  const err = (event: RaceEvent) => validateMessage({ type: 'events', seq: 1, list: [event] });
  const ok = (event: RaceEvent) => assert.equal(err(event), null, `${event.kind} should validate`);

  // A KO: the victim's seat and the killer's, or -1 when nobody is to blame (a hazard, a fall).
  ok({ kind: 'ko', seat: 3, by: 1 });
  ok({ kind: 'ko', seat: 3, by: -1 });
  assert.equal(err({ kind: 'ko', seat: 3, by: MARBLE_COUNT } as RaceEvent)?.code, 'forged', 'a killer that is not a seat');
  assert.equal(err({ kind: 'ko', seat: 3, by: -2 } as RaceEvent)?.code, 'forged');
  assert.equal(err({ kind: 'ko', seat: MARBLE_COUNT, by: 1 } as RaceEvent)?.code, 'forged', 'a victim that is not a seat');
  assert.equal(err({ kind: 'ko', seat: 1.5, by: 1 } as RaceEvent)?.code, 'forged', 'a victim that is not a whole seat');

  // A skill effect: the seven kinds the guest can draw, and a position and expiry to draw with.
  for (const fx of SKILL_FX_KINDS) {
    ok({ kind: 'skillfx', fx, seat: 0, target: 4, x: 300.5, y: 900.25, until: 21_000 });
    ok({ kind: 'skillfx', fx, seat: 0, target: -1, x: 0, y: 0, until: 0 });
  }
  assert.equal(err({ kind: 'skillfx', fx: 'nuke', seat: 0, target: -1, x: 1, y: 2, until: 3 } as unknown as RaceEvent)?.code, 'forged', 'an effect this build cannot draw');
  assert.equal(err({ kind: 'skillfx', fx: 'bolt', seat: 0, target: -1, x: Number.NaN, y: 2, until: 3 } as RaceEvent)?.code, 'malformed', 'no position');
  assert.equal(err({ kind: 'skillfx', fx: 'bolt', seat: 0, target: -1, x: 1, y: 2, until: -1 } as RaceEvent)?.code, 'malformed', 'no expiry');
  assert.equal(err({ kind: 'skillfx', fx: 'bomb', seat: 0, target: 99, x: 1, y: 2, until: 3 } as RaceEvent)?.code, 'forged', 'a target that is not a seat');
  assert.equal(err({ kind: 'skillfx', fx: 'decoy', seat: 99, target: -1, x: 1, y: 2, until: 3 } as RaceEvent)?.code, 'forged', 'an owner that is not a seat');
  assert.ok(PROTOCOL_VERSION >= 8, 'P2-19 was a wire change: version 8 or later');
});

interface Pair {
  host: RaceSession;
  guest: RaceSession;
  tick(): void;
  /** Frames the host has published, in order. */
  hostFrames: RaceProtocol[];
}

/** A host and a guest on one wire, with the network taken out of it. */
function pair(): Pair {
  let now = CLOCK_START;
  const seats = grid();
  const hostFrames: RaceProtocol[] = [];
  const toGuest: RaceProtocol[] = [];
  const toHost: RaceProtocol[] = [];
  const base = {
    seed: SEED,
    seats,
    profile: PLATFORMER,
    settings: { circuit: 0 },
    now: () => now,
    countdownAt: now + START_ARM_MS,
  };
  const host = new RaceSession({
    ...base, localSeat: 0, isHost: true,
    send: (msg) => { hostFrames.push(msg); toGuest.push(msg); },
  });
  const guest = new RaceSession({
    ...base, localSeat: 1, isHost: false,
    send: (msg) => toHost.push(msg),
  });
  return {
    host,
    guest,
    hostFrames,
    tick() {
      now += FRAME_MS;
      host.update(FRAME_MS);
      guest.update(FRAME_MS);
      for (const msg of toGuest.splice(0)) guest.accept(msg);
      // What the room stamps on the way through: the sender's id, so the host
      // can tell whose intent a frame is. Nothing here sends intents.
      for (const msg of toHost.splice(0)) host.accept({ ...msg, from: 'player-1' });
    },
  };
}

test('P2-19 race: a KO rides the wire, and the guest classifies it as the host did', () => {
  const p = pair();
  assert.equal(p.host.game.healthOn, true, 'a platformer race runs with health on');
  assert.equal(p.guest.game.healthOn, true, 'the guest knows health is in play');

  // Past the lights, on both screens.
  let guard = 0;
  while (!p.host.gateOpen && guard++ < 3000) p.tick();
  for (let i = 0; i < 20; i++) p.tick();
  assert.ok(p.guest.gateOpen, 'the guest is racing too');

  // Seat 0 knocks seat 1 out: a real KO with a real credit line.
  const victim = p.host.game.marbles[1];
  assert.equal(p.host.game.damage(victim, 400, 0, 'bomb'), true, 'one hit knocks the victim out');
  assert.equal(victim.dnf, true, 'the host marks the marble out');
  assert.equal(p.host.game.marbles[0].kos, 1, 'the host credits the killer');

  // Every marble out is a finished race (allFinished): the classification is published now rather
  // than after the nine-minute heat limit. The rest are hazards — no credit for those.
  const sweep = () => { for (const m of p.host.game.marbles) if (!m.dnf && (m.health?.hp ?? 0) > 0) p.host.game.damage(m, 400, null, 'hazard'); };
  sweep();
  for (guard = 0; !p.host.results && guard < 3000; guard++) {
    p.tick();
    if (guard % 30 === 0) sweep();
  }

  const hostRows = p.host.results;
  assert.ok(hostRows, 'the host published the classification');
  const guestRows = p.guest.results;
  assert.ok(guestRows, 'and the guest received it');

  // The results frame carries the health story: who was out, and who did the knocking.
  const results = p.host.host!.results!;
  assert.ok(results.dnf && results.kos, 'a health race publishes dnf and kos');
  assert.equal(results.dnf![1], true, 'the victim did not finish');
  assert.ok(results.kos![0] >= 1, `the killer is on the board, got ${results.kos![0]}`);
  assert.equal(results.times[1], null, 'and a DNF has no time');

  // The guest's classification is the host's, row for row, and so is its world: every marble it
  // believes is out, the KO counts it believes were earned, and no marble it should not be drawing.
  assert.deepEqual(guestRows, hostRows, 'guest rows == host rows');
  for (let seat = 0; seat < MARBLE_COUNT; seat++) {
    assert.equal(p.guest.game.marbles[seat].dnf, results.dnf![seat], `seat ${seat} dnf agrees`);
    assert.equal(p.guest.game.marbles[seat].kos ?? 0, results.kos![seat], `seat ${seat} kos agrees`);
  }
  assert.equal(p.guest.game.marbles[1].body.position.x, -5000, 'the knocked-out marble left the guest world');
  assert.ok(p.hostFrames.some((f) => f.type === 'events' && f.list.some((e) => e.kind === 'ko' && e.seat === 1 && e.by === 0)), 'the ko event rode the wire');
  assert.ok(p.hostFrames.some((f) => f.type === 'state'), 'state frames were published');
  p.host.dispose();
  p.guest.dispose();
});

test('P2-19 race: a skill effect rides the wire for the guest to draw', () => {
  const p = pair();
  let guard = 0;
  while (!p.host.gateOpen && guard++ < 3000) p.tick();
  for (let i = 0; i < 20; i++) p.tick();

  // Seat 1 lays spike strips (a hazard: no target needed), and seat 0 fires a bolt at a rival that
  // is genuinely ahead of it — a homing bolt is refused with nobody in range, which is the skill
  // working, not the test.
  const guestMarble = p.host.game.marbles[1];
  guestMarble.inventory.spikes = 1;
  assert.equal(p.host.game.useItem(guestMarble, 'spikes'), true, 'the spikes went down');
  const hostMarble = p.host.game.marbles[0];
  guestMarble.lane = hostMarble.lane;
  Body.setPosition(guestMarble.body, { x: hostMarble.body.position.x + 120, y: hostMarble.body.position.y });
  hostMarble.inventory.bolt = 1;
  assert.equal(p.host.game.useItem(hostMarble, 'bolt'), true, 'the bolt was fired at the rival ahead');

  for (let i = 0; i < 30; i++) p.tick();

  const fx = p.hostFrames.flatMap((f) => (f.type === 'events' ? f.list : [])).filter((e) => e.kind === 'skillfx');
  assert.ok(fx.some((e) => e.kind === 'skillfx' && e.fx === 'spikes' && e.seat === 1), 'the spikes are on the wire');
  assert.ok(fx.some((e) => e.kind === 'skillfx' && e.fx === 'bolt' && e.seat === 0), 'and so is the bolt');

  // The guest DRAWS them: the patch is in its world, the bolt is in its projectile list, and the
  // host's own collision is the only thing that decides whether the bolt hits.
  assert.ok(p.guest.game.spikes.length >= 1, 'the guest drew the spike patch');
  assert.ok(p.guest.game.projectiles.length >= 1, 'the guest drew the bolt');
  const drawn = p.guest.game.projectiles[0];
  assert.equal(drawn.owner, 0, 'the bolt belongs to the seat that spent it');
  assert.equal(drawn.target, 1, 'and it is chasing the seat it was aimed at');
  p.host.dispose();
  p.guest.dispose();
});

test('P2-19 purse: online pays the KO bounty and the Shaman charges nothing', () => {
  const me: HeatResult = { id: 3, rank: 4, time: null, pegs: 2, dnf: true, kos: 3 };
  const raceId = onlineRaceId('ABC123', 7);
  const online = settleOnlineRace(createAccount(), raceId, me);
  assert.equal(online.payout.placement, 0, 'a DNF earns no placement money');
  assert.equal(online.payout.koBounty, Math.round(3 * KO_BOUNTY * 0.6), 'three KOs pay the online bounty');
  assert.equal(online.payout.shamanFee, 0, 'the Shaman does not charge online');
  assert.equal(online.payout.total, online.payout.koBounty! + online.payout.pegBonus, 'the panel adds up');
  assert.equal(online.account.credits, 400 + online.payout.total);

  // Once per race id, however many times the results are shown.
  const again = settleOnlineRace(online.account, raceId, me);
  assert.equal(again.payout.alreadyPaid, true);
  assert.strictEqual(again.account, online.account);

  // The same DNF in a championship round DOES owe the Shaman — that is the difference online bought.
  const championship = settleRace(createAccount(), 'champ:1:1', me, 1, 'championship');
  assert.ok((championship.payout.shamanFee ?? 0) > 0, 'offline, a DNF owes the Shaman');
  assert.equal(championship.payout.koBounty, 3 * KO_BOUNTY, 'and offline the bounty is paid at full scale');
});
