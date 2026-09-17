// ══════════════════════════════════════════════════════════════════════════
// MP-08 — who is missing, and for how long.
//
// The room says "this player's socket went" and "how long the seat is held".
// Everything a PLAYER feels about that — the marble changing hands, the
// countdown on the notice, the moment the race is called off — is arithmetic on
// top of those two facts, and it is the same arithmetic on every screen. So it
// lives in one pure module and is tested here, rather than being re-derived
// (and re-disagreed about) by the host, the HUD and the lobby.
// ══════════════════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AI_TAKEOVER_MS,
  DEFAULT_PEER_GRACE_MS,
  foldPeer,
  graceLabel,
  graceLeft,
  offlineFor,
  peerOf,
  takeoverDue,
  type PeerPresence,
} from '../src/net/presence';
import type { PeerStatusMsg } from '../src/net/protocol';

const T0 = 1_700_000_000_000;
const drop = (playerId: string, graceMs?: number, username?: string): PeerStatusMsg =>
  ({ type: 'peerStatus', playerId, status: 'disconnected', graceMs, username });
const back = (playerId: string, username?: string): PeerStatusMsg =>
  ({ type: 'peerStatus', playerId, status: 'reconnected', username });

test('MP-08 presence: only a drop is worth remembering', () => {
  let list: PeerPresence[] = [];
  list = foldPeer(list, drop('player-1', 30_000, 'Sprocket'), T0);
  assert.equal(list.length, 1);
  assert.equal(list[0].playerId, 'player-1');
  assert.equal(list[0].username, 'Sprocket', 'a notice can say WHO is missing');
  assert.equal(list[0].since, T0);
  assert.equal(list[0].graceMs, 30_000);

  // "Reconnected" is not information a screen can show — it is the absence of
  // the drop it cancels.
  list = foldPeer(list, back('player-1'), T0 + 1_000);
  assert.deepEqual(list, [], 'a driver who is back needs no badge');
  assert.equal(peerOf(list, 'player-1'), null);
});

test('MP-08 presence: a drop is remembered once, however many times the room says it', () => {
  // The room polls every second; a fold that appended would grow the list every
  // poll and the strip would list the same driver six times.
  let list: PeerPresence[] = [];
  list = foldPeer(list, drop('player-1', 45_000), T0);
  list = foldPeer(list, drop('player-1', 45_000), T0 + 1_000);
  list = foldPeer(list, drop('player-1', 45_000), T0 + 2_000);
  assert.equal(list.length, 1);
  assert.equal(list[0].since, T0, 'and the clock starts at the FIRST drop, not the latest echo');
  assert.equal(offlineFor(list[0], T0 + 2_000), 2_000);
});

test('MP-08 presence: a room that says nothing about the window still gets one', () => {
  const list = foldPeer([], drop('player-1'), T0);
  assert.equal(list[0].graceMs, DEFAULT_PEER_GRACE_MS);
  // Zero and negative are not durations — they are a room that has not said.
  assert.equal(foldPeer([], drop('player-1', 0), T0)[0].graceMs, DEFAULT_PEER_GRACE_MS);
  assert.equal(foldPeer([], drop('player-1', -5), T0)[0].graceMs, DEFAULT_PEER_GRACE_MS);
});

test('MP-08 presence: the hold window counts down, and stops at nothing', () => {
  const [peer] = foldPeer([], drop('player-1', 30_000), T0);
  assert.equal(graceLeft(peer, T0), 30_000);
  assert.equal(graceLeft(peer, T0 + 10_000), 20_000);
  assert.equal(graceLeft(peer, T0 + 30_000), 0, 'the seat is gone, not "gone in -1ms"');
  assert.equal(graceLeft(peer, T0 + 99_000), 0);
  // A clock that ran backwards (an NTP step) is not a seat that came back.
  assert.equal(offlineFor(peer, T0 - 5_000), 0);
});

test('MP-08 presence: the countdown reads the way a player expects', () => {
  assert.equal(graceLabel(29_000), '0:29');
  assert.equal(graceLabel(60_000), '1:00');
  assert.equal(graceLabel(0), '0:00');
  assert.equal(graceLabel(-1), '0:00', 'never a negative countdown');
  // 500ms must read as one second left, not "0:00" while time remains.
  assert.equal(graceLabel(500), '0:01');
});

test('MP-08 presence: three seconds is the whole race’s patience, not the window’s', () => {
  const [peer] = foldPeer([], drop('player-1', 60_000), T0);
  assert.equal(takeoverDue(peer, T0 + AI_TAKEOVER_MS - 1), false, 'not a moment early');
  assert.equal(takeoverDue(peer, T0 + AI_TAKEOVER_MS), true);
  // And the seat is STILL theirs a minute later — the AI has the marble, the
  // driver keeps the seat until the room gives it up.
  assert.equal(takeoverDue(peer, T0 + 55_000), true);
  assert.ok(graceLeft(peer, T0 + 55_000) > 0, 'the seat is held long after the marble changes hands');
});
