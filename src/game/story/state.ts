/**
 * Story state (ST-02): the save record for "Down We Go", plus the helpers that move it around.
 *
 * The story keeps its OWN championship — a season built with `newSeason()` and stored inside `StoryState` —
 * and its own device-cache key. It never touches `mrr-season-v1` (the free championship save), so quitting
 * one mode cannot damage the other. Pure functions and one storage key; no React, no DOM.
 */
import * as storage from '../storage';
import { CALENDAR, computeStandings, newSeason } from '../season';
import type { SeasonState } from '../season';
import { AI_COLORS, HEATS_PER_GP, STAT_BUDGET, STAT_MAX, STAT_MIN } from '../types';
import type { MarbleInfo, MarbleStats, TrackProfile } from '../types';
import { CAST, STORY_GRID, castTeam, racingCast } from './cast';
import type { CastId } from './cast';
import { CHAPTERS, chapterDef } from './outline';
import {
  CHAPTER_COUNT, PLAYER_MARBLE_ID, STORY_FLAGS, emptyFlags, emptyRaceCounters, endingForPosition, flagsMatch,
} from './types';
import type { ChapterNumber, EndingId, FlagMap, ObjectiveOutcome, RaceCounters, StoryFlag } from './types';

/** Appended to `STORAGE_KEYS` in `src/game/storage.ts` so the save is in the preloaded device cache. */
export const STORY_KEY = 'heavy-metal-gp:story';
export const STORY_VERSION = 1;

/** The player's garage goblin, carried into the story grid so Sprocket looks like the driver they tuned. */
export interface StoryDriver {
  name: string;
  color: string;
  portrait: number;
  stats: MarbleStats;
}

export interface StoryState {
  version: 1;
  /** Everything in a story run is derived from this seed: rivals, tracks, forced events. */
  seed: number;
  startedAt: number;
  /** Chapter being played, 1..6. Mirrors `season.round + 1` while the season is running. */
  chapter: ChapterNumber;
  /** Heats already finished in this chapter, 0..HEATS_PER_GP. */
  heat: number;
  seenScenes: string[];
  flags: FlagMap;
  /** Cumulative objective outcomes per chapter (1..6). */
  objectiveResults: Record<number, ObjectiveOutcome[]>;
  /** Cumulative race counters per chapter (1..6). */
  counters: Record<number, RaceCounters>;
  /** The story's own championship. Never the garage's `mrr-season-v1` save. */
  season: SeasonState;
  /** Chosen once the finale is classified. */
  ending: EndingId | null;
  finishedAt: number | null;
  /** Chapter select replay: nothing is written back to the save while this is set. */
  replaying: boolean;
  driver: StoryDriver;
  /**
   * Cosmetic unlocks banked per chapter (ST-08). Story-save only: the racer account keeps credits, the
   * story keeps the flags, and `applyChapterReward()` uses this list as its paid-marker.
   */
  unlocks: string[];
}

/** Fixed stats per cast member: every one sums to `STAT_BUDGET`, and the story grid never re-rolls them. */
const CAST_STATS: Readonly<Record<Exclude<CastId, 'hood-revealed' | 'sprocket'>, MarbleStats>> = {
  smokey: { weight: 6, speed: 5, bounce: 4 },
  vex: { weight: 5, speed: 7, bounce: 3 },
  hood: { weight: 3, speed: 9, bounce: 3 },
  ace: { weight: 4, speed: 8, bounce: 3 },
  zapp: { weight: 5, speed: 6, bounce: 4 },
  grubba: { weight: 10, speed: 3, bounce: 2 },
  knuckles: { weight: 8, speed: 4, bounce: 3 },
  scorch: { weight: 4, speed: 7, bounce: 4 },
  red: { weight: 5, speed: 6, bounce: 4 },
};

/** Rival sprite sheet index for the race renderer (story portraits are used by the dialogue UI instead). */
function spriteIndex(cast: CastId): number {
  const portrait = CAST[cast].portrait;
  return portrait.kind === 'rival' ? portrait.index : RIVAL_SPRITE[cast] ?? 0;
}
const RIVAL_SPRITE: Partial<Record<CastId, number>> = { ace: 0, vex: 1, smokey: 9, zapp: 11, hood: 12, 'hood-revealed': 12 };

/**
 * The ten marbles of the story grid, in marble-id order. Deterministic: no `Math.random()` anywhere in
 * story mode, so a saved seed always rebuilds the same season, grid and circuits.
 */
export function storyRoster(driver: StoryDriver): MarbleInfo[] {
  return racingCast().map((cast) => {
    if (cast.gridId === PLAYER_MARBLE_ID) {
      return { id: PLAYER_MARBLE_ID, name: driver.name || CAST.sprocket.name, color: driver.color, stats: driver.stats, isPlayer: true, character: driver.portrait };
    }
    const stats = CAST_STATS[cast.id as keyof typeof CAST_STATS];
    return {
      id: cast.gridId,
      name: cast.name,
      color: AI_COLORS[(cast.gridId - 1) % AI_COLORS.length],
      stats: { ...stats },
      isPlayer: false,
      character: spriteIndex(cast.id),
    };
  });
}

/** A fresh story run: chapter 1, no flags, and its own season over the fixed story grid. */
export function newStory(seed: number, driver: StoryDriver, startedAt = 0): StoryState {
  const roster = storyRoster(driver);
  // `newSeason()` rolls its own seed with `Math.random()`; the story derives every track from `seed` instead.
  const season: SeasonState = { ...newSeason(roster), seed: seed >>> 0 };
  return {
    version: STORY_VERSION as 1,
    seed: seed >>> 0,
    startedAt,
    chapter: 1,
    heat: 0,
    seenScenes: [],
    flags: emptyFlags(),
    objectiveResults: {},
    counters: {},
    season,
    ending: null,
    finishedAt: null,
    replaying: false,
    driver,
    unlocks: [],
  };
}

// ─────────────────────────── pure state transitions ───────────────────────────

/** Record a played scene so it is not offered again (unless the player is replaying a chapter). */
export function markSceneSeen(state: StoryState, sceneId: string): StoryState {
  if (state.seenScenes.includes(sceneId)) return state;
  return { ...state, seenScenes: [...state.seenScenes, sceneId] };
}

/** Set (or clear) one flag. Choices and scenes both go through here. */
export function setFlag(state: StoryState, flag: StoryFlag, value = true): StoryState {
  if (state.flags[flag] === value) return state;
  return { ...state, flags: { ...state.flags, [flag]: value } };
}

export function setFlags(state: StoryState, flags: readonly StoryFlag[], value = true): StoryState {
  return flags.reduce((next, flag) => setFlag(next, flag, value), state);
}

/** `applyChoice(state, flag)` from the ticket: a dialogue choice is just a flag the player picked. */
export function applyChoice(state: StoryState, flag: StoryFlag, value = true): StoryState {
  return setFlag(state, flag, value);
}

/** Store cumulative objective results for a chapter. */
export function withObjectives(state: StoryState, chapter: number, outcomes: ObjectiveOutcome[]): StoryState {
  return { ...state, objectiveResults: { ...state.objectiveResults, [chapter]: outcomes } };
}

export function withCounters(state: StoryState, chapter: number, counters: RaceCounters): StoryState {
  return { ...state, counters: { ...state.counters, [chapter]: counters } };
}

export function chapterObjectives(state: StoryState, chapter: number): ObjectiveOutcome[] {
  return state.objectiveResults[chapter] ?? [];
}

export function chapterCounters(state: StoryState, chapter: number): RaceCounters {
  return state.counters[chapter] ?? emptyRaceCounters();
}

/** True when every non-bonus objective of the chapter has been met. */
export function chapterComplete(state: StoryState, chapter: number): boolean {
  const def = chapterDef(chapter);
  const results = chapterObjectives(state, chapter);
  return def.objectives.filter((objective) => !objective.bonus)
    .every((objective) => results.find((result) => result.id === objective.id)?.met === true);
}

/**
 * Move to a chapter for a chapter-select replay. The copy has seen nothing, so every scene of that chapter
 * plays again; `saveStory()` refuses to write it, so the real run's chapter, flags and seen scenes are safe.
 */
export function startReplay(state: StoryState, chapter: ChapterNumber): StoryState {
  return { ...state, chapter, heat: 0, replaying: true, ending: null, seenScenes: [] };
}

export function endReplay(state: StoryState): StoryState {
  return { ...state, replaying: false };
}

// ─────────────────────────── race wiring ───────────────────────────

/** Race seed for a chapter: the story seed through the same GP hashing the championship uses. */
export function storyRaceSeed(state: StoryState, chapter: number): number {
  const def = chapterDef(chapter);
  return ((state.seed ^ (0x51ed270b + def.gp * 0x9e3779b9)) >>> 0);
}

/** The chapter's circuit profile: the Grand Prix profile with the chapter's extra weights merged in. */
export function storyProfile(chapter: number): TrackProfile {
  const def = chapterDef(chapter);
  const base = CALENDAR[def.gp]?.profile;
  if (!base) throw new Error(`Story chapter ${chapter} points at Grand Prix ${def.gp}, which does not exist.`);
  if (!def.weights) return base;
  return { ...base, weights: { ...base.weights, ...def.weights } };
}

export function storyGrandPrix(chapter: number) {
  return CALENDAR[chapterDef(chapter).gp];
}

/** Heats still to run in the current chapter. */
export function heatsLeft(state: StoryState): number {
  if (state.season.complete) return 0;
  return Math.max(0, HEATS_PER_GP - (state.season.results[state.chapter - 1]?.length ?? 0));
}

/** The player's championship position in the story season (1-based), or null while nobody has scored. */
export function storyPosition(state: StoryState): number | null {
  const standings = computeStandings(state.season);
  if (standings.every((entry) => entry.points === 0)) return null;
  const index = standings.findIndex((entry) => entry.id === PLAYER_MARBLE_ID);
  return index < 0 ? null : index + 1;
}

/** Ending chosen by the final classification: P1 champion, P2–3 bittersweet, anything else heartbreak. */
export function storyEnding(state: StoryState): EndingId | null {
  if (state.ending) return state.ending;
  if (!state.season.complete) return null;
  return endingForPosition(storyPosition(state) ?? CHAPTER_COUNT);
}

export function chapterUnlocked(state: StoryState, chapter: number): boolean {
  if (chapter <= 1) return true;
  // A chapter is unlocked once the previous Grand Prix has all three heats in the story season.
  return (state.season.results[chapter - 2]?.length ?? 0) >= HEATS_PER_GP;
}

export function chaptersCleared(state: StoryState): number {
  return CHAPTERS.filter((def) => (state.season.results[def.chapter - 1]?.length ?? 0) >= HEATS_PER_GP).length;
}

/** Every flag-driven line a scene may gate on, for the hub's "your story so far" list. */
export function activeFlags(state: StoryState): StoryFlag[] {
  return STORY_FLAGS.filter((flag) => state.flags[flag]);
}

export function flagMatches(state: StoryState, condition: Parameters<typeof flagsMatch>[0]): boolean {
  return flagsMatch(condition, state.flags);
}

export function castName(cast: CastId): string {
  return CAST[cast].name;
}

export function castTeamName(cast: CastId): string {
  return castTeam(CAST[cast]).name;
}

export function storyGridIds(): number[] {
  return STORY_GRID.map((id) => CAST[id].gridId);
}

// ─────────────────────────── persistence ───────────────────────────

const safeNumber = (value: unknown, fallback: number, max = 1e12): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : fallback;

function normalizeCounters(value: unknown): RaceCounters {
  const base = emptyRaceCounters();
  if (!value || typeof value !== 'object') return base;
  const raw = value as Partial<RaceCounters> & Record<string, unknown>;
  for (const key of ['orangePegs', 'crates', 'hoops', 'loops', 'buckets', 'pads', 'itemBoxes', 'sectors'] as const) {
    base[key] = safeNumber(raw[key], 0, 100000);
  }
  const numericRecord = (input: unknown): Record<number, number> => {
    if (!input || typeof input !== 'object') return {};
    const out: Record<number, number> = {};
    for (const [key, count] of Object.entries(input as Record<string, unknown>)) {
      const id = Number(key);
      if (Number.isInteger(id) && id >= 0 && id < 64) out[id] = safeNumber(count, 0, 100000);
    }
    return out;
  };
  base.overtakes = numericRecord(raw.overtakes);
  base.rivalRanks = numericRecord(raw.rivalRanks);
  base.eventsFired = Array.isArray(raw.eventsFired) ? [...new Set(raw.eventsFired.filter((id): id is string => typeof id === 'string' && id.length < 64))] : [];
  return base;
}

function normalizeObjectives(value: unknown): ObjectiveOutcome[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ObjectiveOutcome => !!entry && typeof entry === 'object' && typeof (entry as ObjectiveOutcome).id === 'string')
    .map((entry) => ({
      id: entry.id,
      label: typeof entry.label === 'string' ? entry.label : entry.id,
      bonus: entry.bonus === true,
      met: entry.met === true,
      progress: safeNumber(entry.progress, 0, 100000),
      target: safeNumber(entry.target, 1, 100000),
      ...(entry.flag && STORY_FLAGS.includes(entry.flag) ? { flag: entry.flag } : {}),
    }));
}

/** A tampered stat line is not trusted: anything off-budget goes back to the balanced 5/5/5. */
function safeStats(value: unknown): MarbleStats {
  const balanced: MarbleStats = { weight: 5, speed: 5, bounce: 5 };
  if (!value || typeof value !== 'object') return balanced;
  const stats = value as Partial<MarbleStats>;
  const within = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= STAT_MIN && n <= STAT_MAX;
  if (!within(stats.weight) || !within(stats.speed) || !within(stats.bounce)) return balanced;
  if (stats.weight! + stats.speed! + stats.bounce! !== STAT_BUDGET) return balanced;
  return { weight: stats.weight!, speed: stats.speed!, bounce: stats.bounce! };
}

function normalizeFlags(value: unknown): FlagMap {
  const flags = emptyFlags();
  if (!value || typeof value !== 'object') return flags;
  const raw = value as Record<string, unknown>;
  for (const flag of STORY_FLAGS) flags[flag] = raw[flag] === true;
  return flags;
}

/**
 * Validate a saved story. Anything unreadable returns null, which the caller turns into a fresh run —
 * the same contract `parseAccount()` uses for the pit-shop save.
 */
export function parseStory(raw: string | null): StoryState | null {
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const story = value as Partial<StoryState> & Record<string, unknown>;
  if (story.version !== STORY_VERSION) return null;
  const season = story.season as SeasonState | undefined;
  if (!season || !Array.isArray(season.roster) || !Array.isArray(season.results) || !season.roster.length) return null;
  if (!season.roster.some((marble) => marble && marble.isPlayer)) return null;
  const chapter = safeNumber(story.chapter, 1, CHAPTER_COUNT);
  const driver = (story.driver ?? {}) as Partial<StoryDriver>;
  const objectiveResults: Record<number, ObjectiveOutcome[]> = {};
  const counters: Record<number, RaceCounters> = {};
  if (story.objectiveResults && typeof story.objectiveResults === 'object') {
    for (const [key, outcomes] of Object.entries(story.objectiveResults as Record<string, unknown>)) {
      const index = Number(key);
      if (Number.isInteger(index) && index >= 1 && index <= CHAPTER_COUNT) objectiveResults[index] = normalizeObjectives(outcomes);
    }
  }
  if (story.counters && typeof story.counters === 'object') {
    for (const [key, entry] of Object.entries(story.counters as Record<string, unknown>)) {
      const index = Number(key);
      if (Number.isInteger(index) && index >= 1 && index <= CHAPTER_COUNT) counters[index] = normalizeCounters(entry);
    }
  }
  const ending = story.ending;
  return {
    version: STORY_VERSION as 1,
    seed: safeNumber(story.seed, 1, 0xffffffff) || 1,
    startedAt: safeNumber(story.startedAt, 0),
    chapter: Math.max(1, Math.min(CHAPTER_COUNT, chapter)) as ChapterNumber,
    heat: Math.max(0, Math.min(HEATS_PER_GP, safeNumber(story.heat, 0, HEATS_PER_GP))),
    seenScenes: Array.isArray(story.seenScenes) ? [...new Set(story.seenScenes.filter((id): id is string => typeof id === 'string' && id.length < 96))] : [],
    flags: normalizeFlags(story.flags),
    objectiveResults,
    counters,
    season,
    ending: ending === 'champion' || ending === 'bittersweet' || ending === 'heartbreak' ? ending : null,
    finishedAt: typeof story.finishedAt === 'number' && Number.isFinite(story.finishedAt) ? story.finishedAt : null,
    replaying: false,
    driver: {
      name: typeof driver.name === 'string' && driver.name.length < 40 ? driver.name : CAST.sprocket.name,
      color: typeof driver.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(driver.color) ? driver.color : '#d63e2e',
      portrait: safeNumber(driver.portrait, 0, 64),
      stats: safeStats(driver.stats),
    },
    unlocks: Array.isArray(story.unlocks)
      ? [...new Set(story.unlocks.filter((id): id is string => typeof id === 'string' && id.length < 48))]
      : [],
  };
}

export function loadStory(): StoryState | null {
  try { return parseStory(storage.getItem(STORY_KEY)); } catch { return null; }
}

/** Replays are never persisted: chapter select must not move the saved run along. */
export function saveStory(state: StoryState): void {
  if (state.replaying) return;
  try { storage.setItem(STORY_KEY, JSON.stringify(state)); } catch { /* play continues without storage */ }
}

export function clearStory(): void {
  try { storage.removeItem(STORY_KEY); } catch { /* nothing to clear */ }
}
