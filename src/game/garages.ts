/**
 * P2-04 — a separate garage per game mode.
 *
 * Until now the home screen had ONE setup (stats, livery, portrait) that every mode borrowed: tune for a quick
 * race and the championship, the story and an online room all raced with it. Each mode now keeps its own:
 *
 *     { story, championship, quick, online }  →  { stats, color, portrait }
 *
 * (The pit-shop loadout stays the wallet's: it is shared by every mode, so it is not part of a garage yet.)
 *
 * Persistence: ONE device-cache key, `heavy-metal-gp:garages:v1`, through `storage.ts` — never localStorage. The
 * same record also remembers which home tab the player was last on (`tab`), so the screen reopens where they left
 * it. First load migrates what used to be the single setup into all four garages, so nobody starts over.
 *
 * Pure module: types and storage only. It deliberately does not import `characters.ts` (that file pulls the
 * portrait art in through `import.meta.glob`, which node cannot load), so the number of portraits is a parameter.
 */
import * as storage from './storage';
import { PLAYER_COLORS, STAT_BUDGET, STAT_MAX, STAT_MIN } from './types';
import type { MarbleInfo, MarbleStats } from './types';
import type { SeasonState } from './season';
import type { StoryState } from './story/state';

/** The modes that have a goblin. The Workshop has none. */
export type GarageMode = 'story' | 'championship' | 'quick' | 'online' | 'infinity';
export const GARAGE_MODES: readonly GarageMode[] = ['story', 'championship', 'quick', 'online', 'infinity'];

/** The home screen's tabs, in the order they are drawn. */
export type HomeTab = GarageMode | 'workshop';
export const HOME_TABS: readonly HomeTab[] = ['story', 'championship', 'quick', 'online', 'infinity', 'workshop'];
/** Multiplayer is hidden from the game for now (the owner's call, 2026-10-10): flip this to bring Online back. */
export const MULTIPLAYER_ENABLED: boolean = false;
/** The modes the menus offer. */
export const MENU_TABS: readonly HomeTab[] = HOME_TABS.filter((tab) => MULTIPLAYER_ENABLED || tab !== 'online');
/** Where a player who has never picked a tab lands: the live circuit preview and one big button. */
export const DEFAULT_HOME_TAB: HomeTab = 'quick';

/** One goblin's setup. */
export interface Garage {
  stats: MarbleStats;
  /** One of `PLAYER_COLORS`. */
  color: string;
  /** Index into the player portraits. */
  portrait: number;
}
export type Garages = Record<GarageMode, Garage>;

export const GARAGES_KEY = 'heavy-metal-gp:garages:v1';
/**
 * Where the single, pre-garages setup kept its portrait. (Stats and livery were session state and were never
 * stored — a running season keeps the player's in its own roster.)
 */
export const LEGACY_PORTRAIT_KEY = 'heavy-metal-gp:portrait';

export function defaultGarage(): Garage {
  return { stats: { weight: 5, speed: 5, bounce: 5 }, color: PLAYER_COLORS[0], portrait: 0 };
}

export function cloneGarage(garage: Garage): Garage {
  return { stats: { ...garage.stats }, color: garage.color, portrait: garage.portrait };
}

/** The same setup in every mode: how the single setup is migrated. */
export function uniformGarages(garage: Garage): Garages {
  return { story: cloneGarage(garage), championship: cloneGarage(garage), quick: cloneGarage(garage), online: cloneGarage(garage), infinity: cloneGarage(garage) };
}

/** `garages` with one mode's garage replaced. The others are the same objects. */
export function setGarage(garages: Garages, mode: GarageMode, garage: Garage): Garages {
  return { ...garages, [mode]: garage };
}

// ── validation ──────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validStats(value: unknown): MarbleStats | null {
  if (!isRecord(value)) return null;
  const { weight, speed, bounce } = value;
  for (const stat of [weight, speed, bounce]) {
    if (typeof stat !== 'number' || !Number.isInteger(stat) || stat < STAT_MIN || stat > STAT_MAX) return null;
  }
  const stats = { weight, speed, bounce } as MarbleStats;
  return stats.weight + stats.speed + stats.bounce === STAT_BUDGET ? stats : null;
}

/**
 * A stored garage, repaired field by field: a bad livery does not cost the player their stats. `fallback` supplies
 * whatever is missing or out of range.
 */
export function normalizeGarage(value: unknown, fallback: Garage, portraitCount: number): Garage {
  const next = cloneGarage(fallback);
  if (!isRecord(value)) return next;
  const stats = validStats(value.stats);
  if (stats) next.stats = stats;
  if (typeof value.color === 'string' && PLAYER_COLORS.includes(value.color)) next.color = value.color;
  if (typeof value.portrait === 'number' && Number.isInteger(value.portrait) && value.portrait >= 0 && value.portrait < portraitCount) next.portrait = value.portrait;
  return next;
}

export function isHomeTab(value: unknown): value is HomeTab {
  return typeof value === 'string' && (HOME_TABS as readonly string[]).includes(value);
}

// ── persistence ─────────────────────────────────────────────────────────────

function readRecord(): Record<string, unknown> | null {
  const raw = storage.getItem(GARAGES_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The portrait the single, pre-garages setup had (0 when there was none). */
function legacyPortrait(portraitCount: number): number {
  try {
    const stored = storage.getItem(LEGACY_PORTRAIT_KEY);
    const n = stored === null ? NaN : Number(stored);
    return Number.isInteger(n) && n >= 0 && n < portraitCount ? n : 0;
  } catch {
    return 0;
  }
}

/** The one setup the player had before there were four. */
export function legacyGarage(portraitCount: number): Garage {
  return { ...defaultGarage(), portrait: legacyPortrait(portraitCount) };
}

/**
 * Read the four garages. A missing record is the first load of this version: the single setup becomes all four
 * (and is written straight away, so the migration happens once). A damaged record is repaired mode by mode.
 */
export function loadGarages(portraitCount: number): Garages {
  const record = readRecord();
  // The record may hold the four garages at the top level, or nested under `garages`; read both.
  const holder = record && isRecord(record.garages) ? record.garages : record;
  const hasGarages = !!holder && GARAGE_MODES.some((mode) => isRecord(holder[mode]));
  const fallback = legacyGarage(portraitCount);
  if (!hasGarages) {
    const migrated = uniformGarages(fallback);
    saveGarages(migrated);
    return migrated;
  }
  const garages = {} as Garages;
  for (const mode of GARAGE_MODES) garages[mode] = normalizeGarage(holder![mode], fallback, portraitCount);
  return garages;
}

/** Write the four garages. The remembered tab, which lives in the same record, is kept. */
export function saveGarages(garages: Garages): void {
  const tab = readTab();
  const record: Record<string, unknown> = { ...garages };
  if (tab) record.tab = tab;
  storage.setItem(GARAGES_KEY, JSON.stringify(record));
}

function readTab(): HomeTab | null {
  const tab = readRecord()?.tab;
  return isHomeTab(tab) ? tab : null;
}

/** The tab the home screen was last left on. */
export function loadHomeTab(): HomeTab {
  const tab = readTab() ?? DEFAULT_HOME_TAB;
  return MENU_TABS.includes(tab) ? tab : DEFAULT_HOME_TAB;
}

/** Remember the tab. The garages in the same record are kept. */
export function saveHomeTab(tab: HomeTab): void {
  const record = readRecord() ?? {};
  record.tab = tab;
  storage.setItem(GARAGES_KEY, JSON.stringify(record));
}

// ── what a running mode owns ────────────────────────────────────────────────

/**
 * A championship that is still running owns its player's setup: the season's roster is the garage, and the
 * garage is read-only (Retune, between Grands Prix, is the one door back in). A finished season frees it.
 */
export function seasonLocksGarage(season: SeasonState | null): boolean {
  return !!season && !season.complete;
}

/** The garage a season's player is racing with. */
export function garageOfPlayer(player: Pick<MarbleInfo, 'stats' | 'color' | 'character'>, fallback: Garage): Garage {
  return { stats: { ...player.stats }, color: player.color, portrait: player.character ?? fallback.portrait };
}

/** `garages` with the championship garage taken from a season's player, when the season is running. */
export function withSeasonSetup(garages: Garages, season: SeasonState | null): Garages {
  const player = season?.roster.find((m) => m.isPlayer);
  if (!season || !player || !seasonLocksGarage(season)) return garages;
  return setGarage(garages, 'championship', garageOfPlayer(player, garages.championship));
}

/**
 * Has this story run started? Mirrors the story's own rule (a saved run keeps the setup it started with; only a
 * fresh one picks up the garage tune), so the story garage is read-only exactly when the tune would be ignored.
 */
export function storyRunStarted(story: StoryState | null): boolean {
  return !!story && (story.season.results.some((heats) => heats.length > 0) || story.seenScenes.length > 0);
}
