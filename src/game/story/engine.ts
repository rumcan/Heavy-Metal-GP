/**
 * Story engine (ST-02): scene selection, objective evaluation and heat settlement.
 *
 * Pure functions only — no React, no DOM, and no writes. Every transition takes a `StoryState` and returns
 * a new one; the caller (ST-08's story screen) decides when to save. Failing an objective never blocks
 * progress: it only sets flags and picks scene variants.
 */
import { CAST } from './cast';
import type { CastId } from './cast';
import { CHAPTERS, chapterDef, chapterSceneIds, sceneById } from './outline';
import { chapterCounters, chapterObjectives, setFlags, storyEnding, storyPosition, withCounters, withObjectives } from './state';
import type { StoryState } from './state';
import { recordHeat } from '../season';
import { HEATS_PER_GP } from '../types';
import type { HeatResult } from '../types';
import {
  OUTCOME_TRIGGERS, PLAYER_MARBLE_ID, emptyRaceCounters, endingForPosition, flagsMatch,
  outcomeForRank, triggerForOutcome,
} from './types';
import type {
  ChapterDef, ChapterNumber, EndingId, FlagMap, ObjectiveDef, ObjectiveOutcome, RaceCounters,
  Scene, StoryBeat, StoryFlag, StoryOutcome, Trigger,
} from './types';

/** DNF stands for "no position", which sorts worse than last place in every objective below. */
const NO_RANK = 99;

// ─────────────────────────── scene selection ───────────────────────────

/** The outcome implied by a `post-*` trigger, if any. */
export function triggerOutcome(trigger: Trigger): StoryOutcome | null {
  return trigger === 'post-win' ? 'win' : trigger === 'post-podium' ? 'podium' : trigger === 'post-loss' ? 'loss' : null;
}

/** Would this scene play right now? Flags, outcome, ending and seen-scenes all gate it. */
export function sceneMatches(state: StoryState, scene: Scene, outcome?: StoryOutcome | null, chapter: number = state.chapter): boolean {
  if (!flagsMatch(scene.when, state.flags)) return false;
  const effective = outcome ?? triggerOutcome(scene.trigger);
  if (scene.outcome && effective && scene.outcome !== effective) return false;
  if (OUTCOME_TRIGGERS.includes(scene.trigger) && effective && triggerForOutcome(effective) !== scene.trigger) return false;
  // Ending scenes belong to one of the three finales; everything else ignores the ending.
  if (scene.ending && scene.ending !== (state.ending ?? storyEnding(state))) return false;
  // Already-played scenes are never offered again. A chapter-select replay gets a copy with an empty
  // `seenScenes` (see `startReplay`), which is how "unless replaying" works without a second rule.
  if (state.seenScenes.includes(scene.id)) return false;
  return scene.chapter === chapter;
}

/**
 * Scenes offered for the current chapter and trigger, in outline order, filtered by flags, outcome and
 * already-seen scenes (unless the player is replaying a chapter).
 */
export function nextScenes(state: StoryState, trigger: Trigger, outcome?: StoryOutcome | null, chapter: number = state.chapter): Scene[] {
  const implied = triggerOutcome(trigger);
  if (implied && outcome && outcome !== implied) return [];
  const effective = outcome ?? implied;
  return chapterSceneIds(chapter, trigger)
    .map((id) => sceneById(id))
    .filter((scene): scene is Scene => !!scene && sceneMatches(state, scene, effective, chapter));
}

/**
 * The next scene to play, or null when the queue for this trigger is empty. Play it, then call
 * `markScenePlayed()` and ask again: scenes later in the queue may gate on flags this one sets.
 */
export function nextScene(state: StoryState, trigger: Trigger, outcome?: StoryOutcome | null, chapter: number = state.chapter): Scene | null {
  return nextScenes(state, trigger, outcome, chapter)[0] ?? null;
}

/** Mark a scene played: it is not offered again, and any flags it carries are set. */
export function markScenePlayed(state: StoryState, scene: Scene): StoryState {
  const seen = state.seenScenes.includes(scene.id) ? state : { ...state, seenScenes: [...state.seenScenes, scene.id] };
  return scene.sets?.length ? setFlags(seen, scene.sets) : seen;
}

/** Mid-race bubbles for a chapter, in sector order (ST-03 renders them, ST-07 counts the sectors). */
export function storyBeats(chapter: number, flags: FlagMap): StoryBeat[] {
  return chapterSceneIds(chapter, 'mid-race')
    .map((id) => sceneById(id))
    .filter((scene): scene is Scene => !!scene && flagsMatch(scene.when, flags))
    .flatMap((scene) => scene.lines.map((line, index) => ({ atSector: Math.max(1, (scene.atSector ?? 4) + index * 2), line })));
}

/** Objective chips for the race HUD, from what the chapter has achieved so far. */
export function objectiveChips(state: StoryState, chapter: number = state.chapter): { id: string; label: string; progress: number; target: number; met: boolean; bonus: boolean }[] {
  return chapterObjectives(state, chapter).map((outcome) => ({
    id: outcome.id, label: outcome.label, progress: outcome.progress, target: outcome.target, met: outcome.met, bonus: outcome.bonus,
  }));
}

/** Live chips during a heat: the stored chapter progress plus this heat's counters. */
export function liveObjectiveChips(def: ChapterDef, stored: ObjectiveOutcome[], counters: RaceCounters) {
  return def.objectives.map((objective) => {
    const previous = stored.find((entry) => entry.id === objective.id);
    return previous ?? outcomeFor(objective, dnfResult(), counters);
  }).map((outcome) => ({ id: outcome.id, label: outcome.label, progress: outcome.progress, target: outcome.target, met: outcome.met, bonus: outcome.bonus }));
}

// ─────────────────────────── objectives ───────────────────────────

function dnfResult(): HeatResult {
  return { id: PLAYER_MARBLE_ID, rank: NO_RANK, time: null, pegs: 0 };
}

/** The player's own result from a classification (a missing entry is a DNF). */
export function playerResult(classification: readonly HeatResult[]): HeatResult {
  return classification.find((result) => result.id === PLAYER_MARBLE_ID) ?? dnfResult();
}

/** Fill in `rivalRanks` from a classification so `ahead` objectives can be checked. */
export function countersWithRanks(counters: RaceCounters, classification: readonly HeatResult[]): RaceCounters {
  const rivalRanks: Record<number, number> = { ...counters.rivalRanks };
  for (const result of classification) rivalRanks[result.id] = result.time === null ? NO_RANK : result.rank;
  return { ...counters, rivalRanks };
}

function rivalRank(counters: RaceCounters, rival: CastId | undefined): number {
  if (!rival) return NO_RANK;
  const gridId = CAST[rival]?.gridId;
  if (gridId === undefined) return NO_RANK;
  return counters.rivalRanks[gridId] ?? NO_RANK;
}

function counterValue(counters: RaceCounters, objective: ObjectiveDef): number {
  const counter = objective.counter;
  if (!counter) return 0;
  if (counter !== 'overtakes') return counters[counter] ?? 0;
  const gridId = objective.rival ? CAST[objective.rival]?.gridId : undefined;
  const entries = Object.entries(counters.overtakes ?? {});
  if (gridId === undefined) return entries.reduce((sum, [, count]) => sum + count, 0);
  return entries.reduce((sum, [id, count]) => (Number(id) === gridId ? sum + count : sum), 0);
}

/** One objective, for one heat. `progress` is the measured value, `target` the threshold. */
export function outcomeFor(objective: ObjectiveDef, heatResult: HeatResult, counters: RaceCounters): ObjectiveOutcome {
  const finished = heatResult.time !== null;
  const rank = finished ? heatResult.rank : NO_RANK;
  const base = { id: objective.id, label: objective.label, bonus: objective.bonus === true, ...(objective.flag ? { flag: objective.flag } : {}) };
  switch (objective.kind) {
    case 'finish': {
      const target = objective.target ?? 1;
      return { ...base, target, progress: finished ? 1 : 0, met: finished };
    }
    case 'rank': {
      const target = objective.rank ?? 1;
      return { ...base, target, progress: rank, met: finished && rank <= target };
    }
    case 'counter': {
      const target = objective.target ?? 1;
      const progress = counterValue(counters, objective);
      return { ...base, target, progress, met: progress >= target };
    }
    case 'ahead': {
      const rival = rivalRank(counters, objective.rival);
      const met = finished && rival !== NO_RANK && rank < rival;
      return { ...base, target: 1, progress: met ? 1 : 0, met };
    }
    default:
      return { ...base, target: 1, progress: 0, met: false };
  }
}

/**
 * `evaluateObjectives(chapterDef, heatResult, raceCounters)` — every objective of the chapter scored for one
 * heat. Failing never blocks progress; the flags below only choose scene variants.
 */
export function evaluateObjectives(def: ChapterDef, heatResult: HeatResult, raceCounters: RaceCounters): ObjectiveOutcome[] {
  return def.objectives.map((objective) => outcomeFor(objective, heatResult, raceCounters));
}

/** Fold one heat's outcomes into the chapter's cumulative results (chapter scope adds up, heat scope keeps the best). */
export function mergeOutcome(objective: ObjectiveDef, previous: ObjectiveOutcome | undefined, next: ObjectiveOutcome): ObjectiveOutcome {
  if (!previous) return next;
  const cumulative = (objective.scope ?? 'heat') === 'chapter';
  const progress = objective.kind === 'rank'
    ? Math.min(previous.progress, next.progress)
    : cumulative
      ? previous.progress + next.progress
      : Math.max(previous.progress, next.progress);
  const met = objective.kind === 'rank' ? progress <= next.target : progress >= next.target;
  return { ...next, progress, met: met || previous.met };
}

export function mergeObjectives(def: ChapterDef, previous: ObjectiveOutcome[], heatOutcomes: ObjectiveOutcome[]): ObjectiveOutcome[] {
  return def.objectives.map((objective) => {
    const next = heatOutcomes.find((outcome) => outcome.id === objective.id) ?? outcomeFor(objective, dnfResult(), emptyRaceCounters());
    return mergeOutcome(objective, previous.find((outcome) => outcome.id === objective.id), next);
  });
}

/** Cumulative counters for a chapter: numeric fields add up, ranks keep the latest heat. */
export function addCounters(previous: RaceCounters, next: RaceCounters): RaceCounters {
  const sum = (key: 'orangePegs' | 'crates' | 'hoops' | 'loops' | 'buckets' | 'pads' | 'itemBoxes' | 'sectors') => (previous[key] ?? 0) + (next[key] ?? 0);
  const mergeRecords = (a: Record<number, number>, b: Record<number, number>, add: boolean): Record<number, number> => {
    const out: Record<number, number> = { ...a };
    for (const [key, value] of Object.entries(b ?? {})) {
      const id = Number(key);
      out[id] = add ? (out[id] ?? 0) + value : value;
    }
    return out;
  };
  return {
    orangePegs: sum('orangePegs'), crates: sum('crates'), hoops: sum('hoops'), loops: sum('loops'),
    buckets: sum('buckets'), pads: sum('pads'), itemBoxes: sum('itemBoxes'), sectors: Math.max(previous.sectors ?? 0, next.sectors ?? 0),
    overtakes: mergeRecords(previous.overtakes, next.overtakes, true),
    rivalRanks: mergeRecords(previous.rivalRanks, next.rivalRanks, false),
    eventsFired: [...new Set([...(previous.eventsFired ?? []), ...(next.eventsFired ?? [])])],
  };
}

// ─────────────────────────── heat settlement ───────────────────────────

export interface HeatSettlement {
  /** The story after the heat: season recorded, objectives merged, flags set, chapter/heat advanced. */
  state: StoryState;
  outcome: StoryOutcome;
  player: HeatResult;
  /** Chapter-cumulative objective results after this heat. */
  objectives: ObjectiveOutcome[];
  /** Flags this heat turned on, in the order they were set. */
  flagsSet: StoryFlag[];
  /** Which `post-*` trigger to play. */
  trigger: Trigger;
  /** The chapter that was raced. The state has usually already moved on to the next one. */
  chapterRaced: number;
  /** The chapter's three heats are in. */
  chapterDone: boolean;
  /** The whole story season is classified. */
  storyDone: boolean;
  ending: EndingId | null;
  /** The player's championship position after this heat. */
  position: number | null;
}

/** Flags a chapter's scripted events earn when they fire (ST-07 reports them through the counters). */
export function eventFlags(def: ChapterDef, counters: RaceCounters): StoryFlag[] {
  const fired = counters.eventsFired ?? [];
  return (def.events ?? [])
    .filter((event) => event.flag && fired.includes(event.id))
    .map((event) => event.flag as StoryFlag);
}

/**
 * Score a heat WITHOUT touching the season: what a chapter-select replay uses, so re-racing a chapter you
 * have already won cannot move the saved run along.
 */
export function evaluateHeat(def: ChapterDef, classification: readonly HeatResult[], counters: RaceCounters = emptyRaceCounters()) {
  const player = playerResult(classification);
  const withRanks = countersWithRanks(counters, classification);
  return {
    outcome: outcomeForRank(player.time === null ? null : player.rank),
    player,
    objectives: evaluateObjectives(def, player, withRanks),
    flagsSet: eventFlags(def, withRanks),
  };
}

/**
 * Record one finished heat: score the objectives, set their flags, add the classification to the story's own
 * season and move the chapter along. This is the single step the story screen and the tests both drive.
 */
export function settleHeat(state: StoryState, classification: readonly HeatResult[], counters: RaceCounters = emptyRaceCounters()): HeatSettlement {
  const def = chapterDef(state.chapter);
  const player = playerResult(classification);
  const withRanks = countersWithRanks(counters, classification);
  const outcome = outcomeForRank(player.time === null ? null : player.rank);
  const heatOutcomes = evaluateObjectives(def, player, withRanks);
  const previous = chapterObjectives(state, state.chapter);
  const objectives = mergeObjectives(def, previous, heatOutcomes);

  const flagsSet: StoryFlag[] = [];
  for (const result of objectives) {
    if (result.met && result.flag && !state.flags[result.flag] && !flagsSet.includes(result.flag)) flagsSet.push(result.flag);
  }
  for (const flag of eventFlags(def, withRanks)) if (!state.flags[flag] && !flagsSet.includes(flag)) flagsSet.push(flag);
  if (def.completeFlag && !state.flags[def.completeFlag] && def.objectives.filter((objective) => !objective.bonus).every((objective) => objectives.find((result) => result.id === objective.id)?.met)) {
    flagsSet.push(def.completeFlag);
  }

  const chapter = state.chapter;
  let season = state.season;
  if (!season.complete) season = recordHeat(season, [...classification]);

  const nextChapter = (season.complete ? CHAPTERS.length : Math.min(CHAPTERS.length, season.round + 1)) as ChapterNumber;
  const heat = season.complete ? HEATS_PER_GP : (season.results[season.round]?.length ?? 0);
  const position = storyPosition({ ...state, season });
  const ending = season.complete ? endingForPosition(position ?? CHAPTERS.length) : null;
  const chapterHeats = season.results[chapter - 1]?.length ?? 0;

  const next: StoryState = {
    ...setFlags(state, flagsSet),
    season,
    heat,
    chapter: season.complete ? chapter : nextChapter,
    ending: ending ?? state.ending,
    finishedAt: season.complete ? state.finishedAt || Date.now() : state.finishedAt,
  };
  return {
    state: withCounters(withObjectives(next, chapter, objectives), chapter, addCounters(chapterCounters(state, chapter), withRanks)),
    outcome,
    player,
    objectives,
    flagsSet,
    trigger: triggerForOutcome(outcome),
    chapterRaced: chapter,
    chapterDone: chapterHeats >= HEATS_PER_GP,
    storyDone: season.complete,
    ending: next.ending,
    position,
  };
}

/** The ending the story is heading for, once the finale is classified. */
export function endingOf(state: StoryState): EndingId | null {
  return state.ending ?? storyEnding(state);
}

// ─────────────────────────── small read helpers ───────────────────────────

export function chapterTitle(chapter: number): string {
  return chapterDef(chapter).title;
}

export function actOf(chapter: number): 1 | 2 | 3 {
  return chapterDef(chapter).act;
}

export function chaptersForAct(act: 1 | 2 | 3): ChapterDef[] {
  return CHAPTERS.filter((def) => def.act === act);
}

export function rivalName(cast: CastId): string {
  return CAST[cast]?.name ?? cast;
}

export { storyPosition };
