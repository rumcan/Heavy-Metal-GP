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

import { Matchmaker, RANK_SEARCH_STEPS, RETRY_PAUSE_MS, rankRungs } from '../src/net/matchmake';
import type { MatchRung, RankedRung } from '../src/net/matchmake';

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

// ── RK-04 (#58): the ladder ────────────────────────────────────────────────
//
// A ranked search is MP-07's loop walking RANK_SEARCH_STEPS: one window per
// rung, each rung WIDER, and the last rung asks for Any rank. Two things are
// being pinned down here, and they are the acceptance:
//
//   - a driver of a similar rating is found in the TIGHTEST window — the
//     ladder costs a nearby rival nothing; and
//   - when nobody nearby is looking, the search widens and still matches
//     anyone — the window closing is "widen", never "no rival found".
//
// The pool answers with the rule RUN's `criteriaMatches` implements (and the
// dev sidecar copies): a request JOINS a waiting room when the room satisfies
// every key the request asks for. So an Any-rank search can see a
// similar-rank room, and a similar-rank search cannot see an Any-rank one —
// the asymmetry that makes the ladder's last rung the safe one.

/** A pool: waiting tickets, matched by the criteria rule, closed on demand. */
class RankPool {
  private readonly tickets: { bucket: number | null; resolve: (room: string) => void; reject: (err: Error) => void }[] = [];
  /** What the pool sees: one entry per rung a driver is currently sitting on. */
  readonly offered: (number | null)[] = [];

  request(rung: RankedRung): Promise<string> {
    this.offered.push(rung.bucket);
    const partner = this.tickets.find((w) => rung.bucket == null || w.bucket === rung.bucket);
    if (partner) {
      this.tickets.splice(this.tickets.indexOf(partner), 1);
      partner.resolve('ROOM');
      return Promise.resolve('ROOM');
    }
    return new Promise((resolve, reject) => this.tickets.push({ bucket: rung.bucket, resolve, reject }));
  }

  /** Close the oldest window: exactly what the SDK does when a ticket times out. */
  expireOldest(): void {
    this.tickets.shift()?.reject(new Error('Matchmaking timeout — no opponent found'));
  }

  get waiting(): number {
    return this.tickets.length;
  }
}

/** Let a search's loop settle: every await (and the pause) gets a turn. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** One driver's ranked search over a pool, with the rungs it visited recorded. */
function search(pool: RankPool, rating: number) {
  const rungs: MatchRung[] = [];
  const mm = new Matchmaker<string>({
    steps: rankRungs(rating),
    request: (rung) => {
      rungs.push(rung);
      return pool.request(rankRungs(rating)[rung.index]);
    },
    isExpired: (err) => err instanceof Error && err.message.toLowerCase().includes('matchmaking timeout'),
    sleep: async () => {},
  });
  return { mm, rungs };
}

test('RK-04 ladder: the rungs a rating searches are the copied ones, in order', () => {
  // HexMatch's spans and budgets, unsqueezed: tightening or shortening them
  // would change who a ranked driver can be paired with.
  assert.deepEqual(
    RANK_SEARCH_STEPS.map((step) => [step.span, step.budgetMs]),
    [[75, 6_000], [200, 8_000], [400, 8_000], [0, 8_000]],
  );
  // The last rung is the escape hatch: no rank criterion at all.
  const rungs = rankRungs(1000);
  assert.equal(rungs.length, RANK_SEARCH_STEPS.length);
  assert.equal(rungs[rungs.length - 1].bucket, null, 'Any rank is a search with no rank key');
  assert.equal(rungs[rungs.length - 1].last, true);
  assert.equal(rungs[0].last, false);
  // Every rung before it asks for a DIFFERENT, wider window.
  assert.notEqual(rungs[0].bucket, rungs[1].bucket);
  assert.notEqual(rungs[1].bucket, rungs[2].bucket);
});

test('RK-04 ladder: two drivers of a similar rating ask the pool for the same bucket', () => {
  // 12 points apart is a similar-rank pair by any reading; the tight window
  // must put them on the same rung, so the search costs them nothing.
  assert.equal(rankRungs(1000)[0].bucket, rankRungs(1012)[0].bucket);
  // A driver a tier or two away is in another bucket at the tight rung — and
  // that is the case the ladder exists for.
  assert.notEqual(rankRungs(1000)[0].bucket, rankRungs(1600)[0].bucket);
});

test('RK-04 ladder: two similar-rated drivers are matched in the first, tightest window', async () => {
  const pool = new RankPool();
  const first = search(pool, 1000);
  const second = search(pool, 1012);
  const found = await Promise.all([first.mm.find(), second.mm.find()]);

  assert.deepEqual(found, ['ROOM', 'ROOM'], 'one race, both drivers');
  assert.equal(first.rungs.length, 1, 'the rival was already waiting in the tight window');
  assert.equal(second.rungs.length, 1);
  assert.equal(first.rungs[0].span, 75);
  assert.equal(first.rungs[0].budgetMs, 6_000);
  assert.equal(first.mm.windows, 0, 'no window had to close');
  assert.equal(pool.waiting, 0);
});

test('RK-04 ladder: nobody nearby — the search widens and still matches anyone', async () => {
  // 600 points apart: not one window in the ladder holds both, until the last
  // one asks for Any rank — and then the ANY-RANK search can see the other
  // driver's still-narrow room (the pool's asymmetry).
  const pool = new RankPool();
  const first = search(pool, 1000);
  const second = search(pool, 1600);
  const firstFound = first.mm.find();
  const secondFound = second.mm.find();
  await settle();

  // Both are sitting in the tight window, and it cannot hold them: close them
  // one at a time, exactly as the platform closes a ticket nobody matched.
  const windowsClosed: number[] = [];
  for (let i = 0; i < 5; i++) {
    assert.equal(pool.waiting, 2, 'both drivers are still looking');
    pool.expireOldest();
    await settle();
  }
  await Promise.all([firstFound, secondFound]);

  assert.deepEqual(
    first.rungs.map((rung) => rung.span),
    [75, 200, 400, 0],
    'each closed window widened one rung, then Any rank',
  );
  assert.deepEqual(
    second.rungs.map((rung) => rung.span),
    [75, 200, 400],
    'the driver who started second reached Any rank at the moment the other did',
  );
  assert.deepEqual(first.rungs.map((rung) => rung.budgetMs), [6_000, 8_000, 8_000, 8_000]);
  assert.equal(rankRungs(1000)[first.rungs.length - 1].bucket, null, 'the match happened at Any rank');
  assert.equal(pool.waiting, 0, 'and neither driver is left holding a ticket');
});

test('RK-04 ladder: the ladder is walked once — after it, the search stays at Any rank', async () => {
  const rungs: MatchRung[] = [];
  let calls = 0;
  const mm = new Matchmaker<string>({
    steps: rankRungs(1000),
    // Six closed windows: more than the ladder has rungs.
    request: (rung) => {
      rungs.push(rung);
      calls++;
      return calls > 6 ? Promise.resolve('ROOM') : Promise.reject(new Error('Matchmaking timeout — no opponent found'));
    },
    isExpired: (err) => err instanceof Error && err.message.toLowerCase().includes('matchmaking timeout'),
    sleep: async () => {},
  });
  assert.equal(await mm.find(), 'ROOM');
  assert.deepEqual(rungs.map((rung) => rung.span), [75, 200, 400, 0, 0, 0, 0]);
  assert.deepEqual(rungs.map((rung) => rung.index), [0, 1, 2, 3, 3, 3, 3]);
  assert.equal(rungs[6].last, true);
  assert.equal(rankRungs(1000)[rungs[6].index].bucket, null, 'never narrower than Any rank, never out of rungs');
});
