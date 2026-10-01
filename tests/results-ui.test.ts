// P2-05 render smoke: use Vite for bundled portraits / skill art and import.meta.glob.
// Effects/animation are not run here; the pure clock below proves the count order.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import type { HeatResult, MarbleInfo } from '../src/game/types';
import { emptyInventory, ITEM_TYPES, teamOf } from '../src/game/types';
import { createAccount, keptSkills, settleCustomRace, settleRace } from '../src/game/economy';
import { PAYOUT_LINE_MS, PAYOUT_TICK_MS, payoutFrame } from '../src/components/results/payout';

const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error', esbuild: { jsx: 'automatic' } });
after(() => server.close());
const Podium = (await server.ssrLoadModule('/src/components/results/Podium.tsx')).default;
const KeptSkills = (await server.ssrLoadModule('/src/components/results/KeptSkills.tsx')).default;
const TrophyShelf = (await server.ssrLoadModule('/src/components/results/TrophyShelf.tsx')).default;
const PayoutCounter = (await server.ssrLoadModule('/src/components/results/PayoutCounter.tsx')).default;
const RaceResults = (await server.ssrLoadModule('/src/components/RaceResults.tsx')).default;
const LoadoutPreview = (await server.ssrLoadModule('/src/components/LoadoutPreview.tsx')).default;

const roster: MarbleInfo[] = Array.from({ length: 10 }, (_, id) => ({ id, name: id === 0 ? 'Sprocket' : `Rival ${id}`, color: '#d63e2e', stats: { weight: 5, speed: 5, bounce: 5 }, isPlayer: id === 0, character: id === 0 ? 0 : id - 1 }));
const classification: HeatResult[] = [1, 2, 3, 4, 5, 6, 0, 7, 8, 9].map((id, i) => ({ id, rank: i + 1, time: 25_240 + i * 2640, pegs: 3 }));
const paint = (component: Parameters<typeof createElement>[0], props: Record<string, unknown>) => renderToStaticMarkup(createElement(component, props));

// The supplied rows need not arrive sorted: actual rank, not array position, wins.
test('Podium: 2nd · 1st · 3rd have happy portraits, team colours, names and times', () => {
  const html = paint(Podium, { results: [...classification].reverse(), roster });
  assert.deepEqual([...html.matchAll(/data-rank="(\d)"/g)].map((m) => m[1]), ['2', '1', '3']);
  for (const id of [1, 2, 3]) {
    assert.match(html, new RegExp(`Rival ${id}`));
    assert.ok(html.includes(teamOf(id).color));
    assert.ok(html.includes(`r0${id - 1}_happy.webp`), 'the happy art is bundled');
  }
  assert.match(html, /0:25\.24/);
  assert.match(html, /podium-burst/);
  assert.match(html, /podium-place-1/);
  assert.match(html, /YOU: P7/);
});

test('Podium: the local podium finisher is marked, and DNFs never get invented trophies', () => {
  const mine = [{ id: 0, rank: 1, time: 12_000, pegs: 0 }, { id: 2, rank: 2, time: null, pegs: 1 }, { id: 3, rank: 3, time: null, pegs: 0 }];
  const html = paint(Podium, { results: mine, roster });
  assert.match(html, /podium-player/);
  assert.match(html, /Sprocket/);
  assert.match(html, />YOU</);
  assert.doesNotMatch(html, /YOU: P1/);
  assert.equal((html.match(/No finisher/g) ?? []).length, 2);
  assert.doesNotMatch(html, /Rival [23]/);
  const dnf = paint(Podium, { results: classification.map((r) => ({ ...r, time: null })), roster });
  assert.doesNotMatch(dnf, /podium-burst/);
  assert.match(dnf, /YOU: DNF · P7/);
  assert.equal((dnf.match(/No finisher/g) ?? []).length, 3);
});

test('KeptSkills: only net new skills appear as art + ×count, with a garage destination', () => {
  const start = { ...emptyInventory(), rocket: 2, oil: 3 };
  const end = { ...start, rocket: 4, oil: 1, freeze: 1 };
  const html = paint(KeptSkills, { kept: keptSkills(start, end) });
  assert.match(html, /Skills you brought home/);
  assert.match(html, /data-item="rocket"/);
  assert.match(html, /data-item="freeze"/);
  assert.match(html, /item-rocket\.webp/);
  assert.match(html, /item-freeze\.webp/);
  assert.match(html, /×2/);
  assert.match(html, /×1/);
  assert.doesNotMatch(html, /data-item="oil"/);
  assert.match(html, /Trophy shelf/);
  assert.match(html, /Find them in your garage/);
  assert.match(html, /is-instant/, 'SSR (and reduced motion) shows the landing state');
});

test('KeptSkills: empty or fully spent loot says so without empty flying cards', () => {
  const html = paint(KeptSkills, { kept: emptyInventory() });
  assert.match(html, /No new skills this time/);
  assert.match(html, /Unused charges are still in your loadout/);
  assert.doesNotMatch(html, /skill-flight/);
});

test('TrophyShelf: all owned skills are shown separately from uncapped lifetime pickups', () => {
  const inventory = { ...emptyInventory(), rocket: 3 };
  const trophies = { ...emptyInventory(), rocket: 42, freeze: 7 };
  const html = paint(TrophyShelf, { inventory, trophies });
  assert.equal((html.match(/data-item=/g) ?? []).length, ITEM_TYPES.length);
  assert.match(html, /×3 <small>owned/);
  assert.match(html, /42 brought home/);
  assert.match(html, /7 brought home/);
  assert.match(html, /49 brought home · lifetime/);
  const loadout = paint(LoadoutPreview, { inventory, trophies, onShop() {} });
  assert.match(loadout, /Your saved race loadout/);
  assert.match(loadout, /Stock up/);
  assert.match(loadout, /Trophy shelf/);
  assert.match(loadout, /42 brought home/);
});

test('Arcade clock: placement, pegs, points, then CR total roll sequentially and stop exactly', () => {
  const targets = [500, 15, 25, 515];
  assert.deepEqual(payoutFrame(targets, 0).values, [0, 0, 0, 0]);
  assert.deepEqual(payoutFrame(targets, PAYOUT_TICK_MS).values, [62, 0, 0, 0]);
  assert.deepEqual(payoutFrame(targets, PAYOUT_LINE_MS).values, [500, 0, 0, 0]);
  assert.deepEqual(payoutFrame(targets, 2 * PAYOUT_LINE_MS).values, [500, 15, 0, 0]);
  assert.deepEqual(payoutFrame(targets, 3 * PAYOUT_LINE_MS).values, [500, 15, 25, 0]);
  const final = payoutFrame(targets, 4 * PAYOUT_LINE_MS);
  assert.deepEqual(final.values, targets);
  assert.equal(final.done, true);
  assert.deepEqual(payoutFrame(targets, 1e6), final, 'a throttled/background tab catches up without overshooting');
  assert.deepEqual(payoutFrame(targets, -10).values, [0, 0, 0, 0]);
});

test('Arcade clock: zero/DNF lines and non-championship totals finish without phantom points', () => {
  assert.deepEqual(payoutFrame([0, 0, 0], 3 * PAYOUT_LINE_MS), { values: [0, 0, 0], active: 3, done: true });
  const payout = settleRace(createAccount(), 'single', classification[0]).payout;
  const html = paint(PayoutCounter, { payout, pegs: 3 });
  assert.match(html, /3 pegs × 5 CR/);
  assert.match(html, /data-counter="total">\+515/);
  assert.match(html, /is-complete/);
  assert.doesNotMatch(html, /Championship points/);
});

test('Results: the payoff preserves classification, online rating, banter, custom note and actions', () => {
  const result = classification.find((r) => r.id === 0)!;
  const payout = settleCustomRace(createAccount(), 'custom', result, true).payout;
  const props = { results: classification, roster, title: 'Test circuit', subtitle: 'ONLINE', actions: [{ label: 'Race again', onClick() {}, primary: true }, { label: 'Back to the garage', onClick() {} }], championship: true, payout, startKit: emptyInventory(), endKit: { ...emptyInventory(), jump: 1 }, isCustom: true, onShop() {} };
  const rating = { state: 'pending', self: null, current: null, bySeat: {}, rows: [], promoted: false, demoted: false, forfeit: false, stored: true };
  const html = paint(RaceResults, { ...props, rating });
  assert.match(html, /Race podium/);
  assert.match(html, /Skills you brought home/);
  assert.match(html, /Final race classification/);
  assert.equal((html.match(/<tr/g) ?? []).length, 11, 'the whole classification remains');
  assert.match(html, /Filed with the room/);
  assert.match(html, />RATING</);
  assert.match(html, /results-banter/);
  assert.match(html, /Custom circuits pay 30%/);
  assert.match(html, /scaled purse/);
  assert.match(html, /Championship points/);
  assert.ok(html.includes(`data-counter="total">+${payout.total}`), 'points never inflate the CR total');
  assert.match(html, /Race again/);
  assert.match(html, /Back to the garage/);
  assert.match(html, /Spend winnings/);
  const offline = paint(RaceResults, props);
  assert.doesNotMatch(offline, /results-ranking/);
  assert.doesNotMatch(offline, />RATING</);
});
