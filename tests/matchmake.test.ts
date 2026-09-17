// ══════════════════════════════════════════════════════════════════════════
// MP-07 — the quick-match loop, without a socket.
//
// One SDK request is one bounded window; "keep looking until found or
// cancelled" is this loop's job, and every branch of it is a thing a player
// feels: a search that gives up after thirty seconds, a search that spins for
// ever on a real failure, or a cancelled search that leaves a ghost sitting in
// a room.
// ══════════════════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';

import { Matchmaker, RETRY_PAUSE_MS } from '../src/net/matchmake';

/** A platform that answers after `scripted` windows have closed. */
function platform(scripted: number, room = 'ROOM') {
  const sleeps: number[] = [];
  let closed = 0;
  let calls = 0;
  const mm = new Matchmaker<string>({
    request: () => {
      calls++;
      return calls > scripted ? Promise.resolve(room) : Promise.reject(new Error('Matchmaking timeout — no opponent found'));
    },
    isExpired: (err) => err instanceof Error && err.message.toLowerCase().includes('matchmaking timeout'),
    sleep: async (ms) => void sleeps.push(ms),
    onWindowClosed: () => void closed++,
  });
  return { mm, sleeps, windows: () => closed, calls: () => calls };
}

test('MP-07 matchmake: a race on the first window needs no retry', async () => {
  const { mm, calls } = platform(0);
  assert.equal(await mm.find(), 'ROOM');
  assert.equal(calls(), 1);
  assert.equal(mm.windows, 0);
});

test('MP-07 matchmake: a closed window is not an answer — keep asking', async () => {
  // Thirty seconds is the SDK's window, not the player's patience: a search
  // that stopped there would say "nobody is racing" to somebody who pressed a
  // button ten seconds before anybody else did.
  const { mm, sleeps, calls, windows } = platform(3);
  assert.equal(await mm.find(), 'ROOM');
  assert.equal(calls(), 4, 'four windows, four requests');
  assert.equal(windows(), 3);
  // ...with a pause between them, so a search is not a busy loop against the pool.
  assert.deepEqual(sleeps, [RETRY_PAUSE_MS, RETRY_PAUSE_MS, RETRY_PAUSE_MS]);
});

test('MP-07 matchmake: a real failure reaches the player instead of spinning', async () => {
  const mm = new Matchmaker<string>({
    request: () => Promise.reject(new Error('AccessDeniedError')),
    isExpired: (err) => err instanceof Error && err.message.includes('timeout'),
    sleep: async () => {},
  });
  await assert.rejects(() => mm.find(), /AccessDeniedError/, 'a signed-out player gets the login sheet, not a forever-search');
});

test('MP-07 matchmake: cancel stops the search, and a room that lands anyway is dropped', async () => {
  let resolve: ((room: string) => void) | null = null;
  const abandoned: string[] = [];
  const mm = new Matchmaker<string>({
    request: () => new Promise<string>((res) => { resolve = res; }),
    isExpired: () => false,
    sleep: async () => {},
    abandon: (room) => void abandoned.push(room),
  });
  const found = mm.find();
  assert.equal(mm.active, true);
  mm.cancel();
  // The platform has no public cancel for an in-flight request, so the pair can
  // still land: what matters is that it does not hold a seat afterwards.
  resolve!('LATE-ROOM');
  assert.equal(await found, null, 'a cancelled search finds nothing');
  assert.deepEqual(abandoned, ['LATE-ROOM'], 'and the room it landed in is left');
  assert.equal(mm.active, false);
});

test('MP-07 matchmake: a search cancelled before it starts asks nothing', async () => {
  let calls = 0;
  const mm = new Matchmaker<string>({
    request: () => { calls++; return Promise.resolve('ROOM'); },
    isExpired: () => false,
    sleep: async () => {},
  });
  mm.cancel();
  assert.equal(await mm.find(), null);
  assert.equal(calls, 0, 'no request, no seat');
});
