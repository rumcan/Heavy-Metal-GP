// ══════════════════════════════════════════════════════════════════════════
// P2-04 — a separate garage per mode.
//
// The model behind the home screen's four garages (`src/game/garages.ts`): what a
// first load migrates, that the modes really are independent, that a reload gives
// every mode its own setup back, how a damaged record is repaired, and the two
// rules that lock a garage (a running season, a started story). Pure node — the
// module is storage and types only, and storage's device cache is an in-memory map
// when there is no browser.
// ══════════════════════════════════════════════════════════════════════════
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as storage from '../src/game/storage';
import { PLAYER_COLORS, STAT_BUDGET } from '../src/game/types';
import type { MarbleInfo } from '../src/game/types';
import type { SeasonState } from '../src/game/season';
import type { StoryState } from '../src/game/story/state';
import {
  DEFAULT_HOME_TAB, GARAGES_KEY, GARAGE_MODES, HOME_TABS, MENU_TABS, MULTIPLAYER_ENABLED, LEGACY_PORTRAIT_KEY,
  defaultGarage, garageOfPlayer, loadGarages, loadHomeTab, normalizeGarage, saveGarages, saveHomeTab,
  seasonLocksGarage, setGarage, storyRunStarted, uniformGarages, withSeasonSetup,
} from '../src/game/garages';

const PORTRAITS = 15;

beforeEach(() => {
  storage.removeItem(GARAGES_KEY);
  storage.removeItem(LEGACY_PORTRAIT_KEY);
});

const sum = (stats: { weight: number; speed: number; bounce: number }) => stats.weight + stats.speed + stats.bounce;

test('The shared key is registered, so the device cache preloads it at boot', () => {
  assert.ok((storage.STORAGE_KEYS as readonly string[]).includes(GARAGES_KEY));
});

test('First load migrates the single setup into all four garages, once', () => {
  storage.setItem(LEGACY_PORTRAIT_KEY, '7');
  const first = loadGarages(PORTRAITS);
  for (const mode of GARAGE_MODES) {
    assert.equal(first[mode].portrait, 7, `${mode} starts from the portrait the player had`);
    assert.equal(sum(first[mode].stats), STAT_BUDGET);
    assert.equal(first[mode].color, PLAYER_COLORS[0]);
  }
  assert.ok(storage.getItem(GARAGES_KEY), 'the migration is written straight away');
  // The old key is not read again once the new record exists.
  storage.setItem(LEGACY_PORTRAIT_KEY, '2');
  assert.equal(loadGarages(PORTRAITS).quick.portrait, 7);
});

test('A player with no old setup starts from the default goblin in every mode', () => {
  const garages = loadGarages(PORTRAITS);
  for (const mode of GARAGE_MODES) assert.deepEqual(garages[mode], defaultGarage());
});

test('A stored portrait that no longer exists falls back instead of crashing the garage', () => {
  storage.setItem(LEGACY_PORTRAIT_KEY, '99');
  assert.equal(loadGarages(PORTRAITS).story.portrait, 0);
  storage.removeItem(GARAGES_KEY);
  storage.setItem(LEGACY_PORTRAIT_KEY, 'not a number');
  assert.equal(loadGarages(PORTRAITS).story.portrait, 0);
});

test('Each mode keeps its own garage: changing one leaves the other three alone, and a reload brings them all back', () => {
  let garages = loadGarages(PORTRAITS);
  garages = setGarage(garages, 'quick', { stats: { weight: 9, speed: 3, bounce: 3 }, color: PLAYER_COLORS[1], portrait: 4 });
  garages = setGarage(garages, 'online', { stats: { weight: 2, speed: 8, bounce: 5 }, color: PLAYER_COLORS[5], portrait: 11 });
  for (const mode of ['story', 'championship'] as const) assert.deepEqual(garages[mode], defaultGarage(), `${mode} is untouched`);
  saveGarages(garages);

  const reloaded = loadGarages(PORTRAITS);
  assert.deepEqual(reloaded, garages);
  assert.deepEqual(reloaded.quick.stats, { weight: 9, speed: 3, bounce: 3 });
  assert.equal(reloaded.online.color, PLAYER_COLORS[5]);
  assert.notDeepEqual(reloaded.quick, reloaded.online);
});

test('uniformGarages hands every mode its own copy, not one shared object', () => {
  const garages = uniformGarages(defaultGarage());
  garages.quick.stats.weight = 6;
  assert.equal(garages.story.stats.weight, 5);
  assert.equal(garages.online.stats.weight, 5);
});

test('The last tab is remembered, and saving it never costs the garages (or the other way round)', () => {
  assert.equal(loadHomeTab(), DEFAULT_HOME_TAB, 'nothing stored yet');
  let garages = loadGarages(PORTRAITS);
  garages = setGarage(garages, 'story', { stats: { weight: 4, speed: 6, bounce: 5 }, color: PLAYER_COLORS[2], portrait: 3 });
  saveGarages(garages);

  for (const tab of MENU_TABS) {
    saveHomeTab(tab);
    assert.equal(loadHomeTab(), tab);
    assert.deepEqual(loadGarages(PORTRAITS), garages, `the garages survive saving the ${tab} tab`);
  }
  saveHomeTab('workshop');
  saveGarages(setGarage(garages, 'online', { ...garages.online, color: PLAYER_COLORS[3] }));
  assert.equal(loadHomeTab(), 'workshop', 'saving the garages keeps the tab');
});

test('The tab can be remembered before any garage has been saved, and the migration keeps it', () => {
  saveHomeTab('infinity');
  assert.equal(loadHomeTab(), 'infinity');
  const garages = loadGarages(PORTRAITS);
  assert.deepEqual(garages.quick, defaultGarage());
  assert.equal(loadHomeTab(), 'infinity');
});

test('Every tab the screen draws can be remembered, and an unknown one is ignored', () => {
  assert.deepEqual([...HOME_TABS], ['story', 'championship', 'quick', 'online', 'infinity', 'workshop']);
  // Multiplayer is hidden: Online is not on the menus, and a save that was last on it opens on the default mode.
  assert.equal(MENU_TABS.includes('online'), MULTIPLAYER_ENABLED);
  saveHomeTab('online');
  assert.equal(loadHomeTab(), MULTIPLAYER_ENABLED ? 'online' : DEFAULT_HOME_TAB);
  saveGarages(loadGarages(PORTRAITS));
  storage.setItem(GARAGES_KEY, JSON.stringify({ ...JSON.parse(storage.getItem(GARAGES_KEY)!), tab: 'community' }));
  assert.equal(loadHomeTab(), DEFAULT_HOME_TAB, 'the Community button is gone, and so is its tab');
});

test('A damaged record is repaired mode by mode, never thrown away wholesale', () => {
  storage.setItem(LEGACY_PORTRAIT_KEY, '5');
  storage.setItem(GARAGES_KEY, JSON.stringify({
    story: { stats: { weight: 9, speed: 3, bounce: 3 }, color: PLAYER_COLORS[4], portrait: 8 },
    // 12 points: the budget is 15, so the stats are refused — but the livery and portrait are good.
    championship: { stats: { weight: 4, speed: 4, bounce: 4 }, color: PLAYER_COLORS[2], portrait: 9 },
    // A colour that is not on the paint chart, a portrait that does not exist, a stat that is not a whole number.
    quick: { stats: { weight: 5.5, speed: 5, bounce: 4.5 }, color: '#123456', portrait: 99 },
    // `online` is missing altogether.
    tab: 'championship',
  }));
  const garages = loadGarages(PORTRAITS);
  assert.deepEqual(garages.story, { stats: { weight: 9, speed: 3, bounce: 3 }, color: PLAYER_COLORS[4], portrait: 8 });
  assert.deepEqual(garages.championship, { stats: defaultGarage().stats, color: PLAYER_COLORS[2], portrait: 9 });
  assert.deepEqual(garages.quick, { stats: defaultGarage().stats, color: PLAYER_COLORS[0], portrait: 5 });
  assert.deepEqual(garages.online, { ...defaultGarage(), portrait: 5 }, 'a missing mode starts from the old setup');
  assert.equal(loadHomeTab(), 'championship');
});

test('Garbage in the key is a first load, not a crash', () => {
  for (const junk of ['{not json', '42', 'null', '[]', '"story"', '{"tab":"quick"}']) {
    storage.setItem(GARAGES_KEY, junk);
    const garages = loadGarages(PORTRAITS);
    for (const mode of GARAGE_MODES) assert.deepEqual(garages[mode], defaultGarage(), `${junk} → default`);
  }
});

test('A record with the garages nested under `garages` reads the same as the flat one', () => {
  const wanted = { stats: { weight: 7, speed: 4, bounce: 4 }, color: PLAYER_COLORS[6], portrait: 2 };
  storage.setItem(GARAGES_KEY, JSON.stringify({ garages: { story: wanted, championship: wanted, quick: wanted, online: wanted } }));
  assert.deepEqual(loadGarages(PORTRAITS).online, wanted);
});

test('normalizeGarage keeps what is good and replaces only what is not', () => {
  const fallback = { stats: { weight: 6, speed: 5, bounce: 4 }, color: PLAYER_COLORS[3], portrait: 1 };
  assert.deepEqual(normalizeGarage(undefined, fallback, PORTRAITS), fallback);
  assert.deepEqual(normalizeGarage('x', fallback, PORTRAITS), fallback);
  assert.deepEqual(normalizeGarage({ color: PLAYER_COLORS[5] }, fallback, PORTRAITS), { ...fallback, color: PLAYER_COLORS[5] });
  assert.deepEqual(normalizeGarage({ portrait: -1 }, fallback, PORTRAITS), fallback);
  assert.deepEqual(normalizeGarage({ portrait: PORTRAITS }, fallback, PORTRAITS), fallback);
  assert.deepEqual(normalizeGarage({ portrait: PORTRAITS - 1 }, fallback, PORTRAITS).portrait, PORTRAITS - 1);
  // the result never aliases the fallback
  normalizeGarage({}, fallback, PORTRAITS).stats.weight = 1;
  assert.equal(fallback.stats.weight, 6);
});

// ── what a running mode owns ──────────────────────────────────────────────

const player: MarbleInfo = { id: 0, name: 'You', color: PLAYER_COLORS[1], stats: { weight: 8, speed: 4, bounce: 3 }, isPlayer: true, character: 6 };
const rival: MarbleInfo = { id: 1, name: 'Ace', color: '#67e8f9', stats: { weight: 5, speed: 5, bounce: 5 }, isPlayer: false, character: 0 };
const season = (complete: boolean): SeasonState => ({ seed: 1, roster: [player, rival], round: 1, heat: 0, results: [], fastest: [], complete });

test('A running season owns the championship garage; a finished one frees it', () => {
  assert.equal(seasonLocksGarage(null), false);
  assert.equal(seasonLocksGarage(season(false)), true);
  assert.equal(seasonLocksGarage(season(true)), false);

  const garages = loadGarages(PORTRAITS);
  const synced = withSeasonSetup(garages, season(false));
  assert.deepEqual(synced.championship, { stats: { weight: 8, speed: 4, bounce: 3 }, color: PLAYER_COLORS[1], portrait: 6 });
  for (const mode of ['story', 'quick', 'online'] as const) assert.strictEqual(synced[mode], garages[mode], `${mode} is not the season's business`);
  assert.strictEqual(withSeasonSetup(garages, season(true)), garages, 'a finished season changes nothing');
  assert.strictEqual(withSeasonSetup(garages, null), garages);
});

test('garageOfPlayer keeps the garage portrait for a season saved before portraits were stored', () => {
  const fallback = { ...defaultGarage(), portrait: 12 };
  assert.equal(garageOfPlayer({ ...player, character: undefined }, fallback).portrait, 12);
  assert.equal(garageOfPlayer(player, fallback).portrait, 6);
  // a copy: tuning the garage must not reach back into the season
  const copy = garageOfPlayer(player, fallback);
  copy.stats.weight = 1;
  assert.equal(player.stats.weight, 8);
});

test('A story run has started once a heat is banked or a scene has been seen — the same rule as the story itself', () => {
  const story = (results: number[][], seenScenes: string[]) => ({ season: { results }, seenScenes }) as unknown as StoryState;
  assert.equal(storyRunStarted(null), false);
  assert.equal(storyRunStarted(story([[], [], []], [])), false, 'a fresh save is still tunable');
  assert.equal(storyRunStarted(story([[1], [], []], [])), true, 'a heat has been raced');
  assert.equal(storyRunStarted(story([[], [], []], ['ch1-intro'])), true, 'a scene has been played');
});
