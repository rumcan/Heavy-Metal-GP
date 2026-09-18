// ══════════════════════════════════════════════════════════════════════════
// RK-05 — THE RANK SURFACES: badges, chips and the ladder, in a real browser.
//
// The ticket's acceptance is visual — "badges and deltas render at 375 px and
// 1280 px without overlap" — so the honest way to prove it is a browser that
// really lays the page out, at both widths, with real badge art.
//
// Two specs:
//
//   1. a seeded rating FILE reaches the garage header, and the ladder panel
//      opens from it — including the graceful line when the platform's
//      leaderboard is not there (a dev page has no RUN account, which is
//      exactly the `isLadderAvailable` case the ticket calls out);
//   2. two ranked drivers land in one lobby, each seat showing its own badge,
//      and the phone layout does not push anything out of its row.
//
// What is NOT here: the results screen's live delta. That needs a whole race to
// finish between two browsers, which is RK-06's spec (`mp-ranked-race`) — this
// one is about the surfaces, and the results panel's three states are pinned
// without a browser in `tests/lobby-ui.test.ts`.
// ══════════════════════════════════════════════════════════════════════════
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import { MpSuite, unavailable } from './mp-harness';

const skip = await unavailable();
let suite: MpSuite | null = null;
async function open(): Promise<MpSuite> {
  suite ??= await MpSuite.open();
  return suite;
}
after(async () => void (await Promise.resolve(suite?.close())));

/**
 * The seeded ratings this spec expects to see on screen, and their bands.
 *
 * 12 points apart and inside one span-75 bucket (19), so the FIRST rung of the
 * ladder pairs them and the lobby is on screen in seconds — the spec is about
 * what the lobby prints. Vary the PAIR (or restart the sidecar) when re-running
 * against a standing dev server: sidecar rooms outlive the run that made them,
 * and a pair that matches a stale room's criteria joins it, seats and all.
 */
const A = { rating: 1450, tier: 'steel' };      // 1400–1550
const B = { rating: 1462, tier: 'steel' };      // same band, 12 points up

test('RK-05 rank surfaces: the garage header wears the seeded badge, and the ladder opens on it', { skip: skip || false, timeout: 180_000 }, async () => {
  const mp = await open();
  const player = await mp.player('rank-ui-header');

  // Seed, then reload: the header reads the file once per page (the way the
  // game boots), so the seed has to be there before the app mounts.
  await player.seedRating(A.rating, 14);
  await player.reload();

  const header = await player.headerRank();
  assert.equal(header.tier, A.tier, 'the garage shows the band the seeded rating is in');
  assert.equal(header.rating, String(A.rating));

  // Tapping it opens the ladder, which prints this driver's own card whatever
  // the board behind it does.
  const panel = await player.openLadder();
  const text = await panel.innerText();
  assert.match(text, /Top ratings/i);
  assert.match(text, /Your card/i);
  assert.match(text, new RegExp(String(A.rating)), 'the driver’s own number, from their own file');
  // A dev page has no RUN account behind the leaderboard, so one of the two
  // graceful lines must be what the board says — never an empty table and never
  // a spinner left spinning.
  assert.match(text, /not reachable from this page|did not answer|Nobody has filed/, 'the board degrades in one line');
  assert.doesNotMatch(text, /Reading the board/, 'and it is not still loading when the panel has painted');

  await player.page.getByRole('button', { name: /^close$/i }).first().click();

  // ── 375 px ────────────────────────────────────────────────────────────────
  // The header row at this width is three icon buttons and the wallet; the badge
  // moves into the driver pane's title line rather than pushing the wallet off
  // the edge, and the width it gives back is checked, not assumed.
  await player.page.setViewportSize({ width: 375, height: 720 });
  await player.page.waitForTimeout(250);
  const narrow = await player.page.evaluate(() => {
    const header = document.querySelector('.garage-page .app-header') as HTMLElement | null;
    const inline = document.querySelector('.rank-button-inline .rank-chip') as HTMLElement | null;
    const inHeader = document.querySelector('.garage-page .app-header .rank-button') as HTMLElement | null;
    const box = inline?.getBoundingClientRect();
    return {
      headerOverflow: header ? header.scrollWidth - header.clientWidth : 999,
      tier: inline?.getAttribute('data-tier') ?? null,
      number: inline?.querySelector('small')?.textContent?.trim() ?? '',
      visible: !!box && box.width > 8,
      headerButtonShown: !!inHeader && getComputedStyle(inHeader).display !== 'none',
    };
  });
  assert.equal(narrow.tier, A.tier, 'the badge is still on the garage, in the driver pane');
  assert.equal(narrow.number, String(A.rating));
  assert.equal(narrow.visible, true, 'and it is really painted, not just in the DOM');
  assert.equal(narrow.headerButtonShown, false, 'the header duplicate is the one that goes');
  assert.ok(narrow.headerOverflow <= 1, `the garage header no longer clips the wallet (${narrow.headerOverflow}px over)`);
});

test('RK-05 rank surfaces: a ranked lobby badges every human seat, and the phone layout holds 375 px', { skip: skip || false, timeout: 240_000 }, async () => {
  const mp = await open();
  const first = await mp.player('rank-ui-a');
  const second = await mp.player('rank-ui-b');

  await first.seedRating(A.rating, 14);
  await second.seedRating(B.rating, 14);
  await first.reload();
  await second.reload();

  await first.quickRace();
  await second.quickRace();

  // Rows are found by what they ARE (mine, a rival's), not by index: a standing
  // sidecar room can seat the pair anywhere on the grid.
  const mine = first.page.locator('.driver-grid li.is-player .rank-chip');
  const theirs = first.page.locator('.driver-grid li:not(.is-ai):not(.is-player) .rank-chip');
  await mine.first().waitFor();
  await theirs.first().waitFor();

  // My own seat: my badge and my number, from my own file.
  assert.equal(await mine.first().getAttribute('data-tier'), A.tier);
  assert.equal((await mine.first().locator('small').innerText()).trim(), String(A.rating));

  // The rival's seat, seen from my screen: the room's board carried their
  // rating in the greeting, so the chip is theirs and not a placeholder.
  assert.equal(await theirs.first().getAttribute('data-tier'), B.tier, 'the rival’s badge came off the room’s board');
  assert.equal((await theirs.first().locator('small').innerText()).trim(), String(B.rating));

  // And the same two numbers, mirrored on the guest's screen.
  const mineAtGuest = second.page.locator('.driver-grid li.is-player .rank-chip');
  const theirsAtGuest = second.page.locator('.driver-grid li:not(.is-ai):not(.is-player) .rank-chip');
  assert.equal(await mineAtGuest.first().getAttribute('data-tier'), B.tier);
  assert.equal((await mineAtGuest.first().locator('small').innerText()).trim(), String(B.rating));
  assert.equal(await theirsAtGuest.first().getAttribute('data-tier'), A.tier);
  assert.equal((await theirsAtGuest.first().locator('small').innerText()).trim(), String(A.rating));

  // The machines get no chip: an unranked medal on an AI seat would read as a
  // player who has not raced yet.
  const machines = await second.page.locator('.driver-grid li.is-ai .rank-chip').count();
  assert.equal(machines, 0);

  // ── 375 px: the phone layout from #53, with badges ────────────────────────
  await second.page.setViewportSize({ width: 375, height: 720 });
  await second.page.locator('.driver-grid li').first().waitFor();

  const rows = await second.page.locator('.driver-grid li:not(.is-ai)').evaluateAll((nodes) =>
    nodes.slice(0, 2).map((node) => {
      const chip = node.querySelector<HTMLElement>('.rank-chip');
      const badge = node.querySelector<HTMLElement>('.rank-badge');
      const row = node.getBoundingClientRect();
      const box = chip?.getBoundingClientRect();
      return {
        overflow: node.scrollWidth - node.clientWidth,
        hasChip: !!chip,
        chipInside: !!box && box.left >= row.left - 1 && box.right <= row.right + 1,
        badgeVisible: !!badge && badge.getBoundingClientRect().width > 8,
        number: chip?.querySelector('small')?.textContent?.trim() ?? '',
      };
    }),
  );
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.hasChip, true, 'every human seat still badges on a phone');
    assert.ok(row.overflow <= 1, `the seat row does not push its content out (${row.overflow}px over)`);
    assert.equal(row.chipInside, true, 'and the chip sits inside the row it belongs to');
    assert.equal(row.badgeVisible, true, 'with the badge itself still painted');
    assert.match(row.number, /\d{3,4}/, 'and the number beside it');
  }

  // The lobby's own header keeps its badge and its ladder door at this width,
  // and nothing in the header spills out of it.
  const header = await second.page.locator('.lobby-page .app-header').evaluate((node) => ({
    overflow: node.scrollWidth - node.clientWidth,
    chip: !!node.querySelector('.rank-button-lobby .rank-chip'),
  }));
  assert.equal(header.chip, true, 'the lobby header still opens the ladder');
  assert.ok(header.overflow <= 1, `the header does not overlap its own title (${header.overflow}px over)`);
});
