// Where story mode opens. The chapter is picked ONCE, on the home screen's Story tab (a chapter card, or the big
// button); story mode then goes straight into that chapter. It used to open on a second copy of the chapter list,
// so every chapter had to be picked twice. A save that has not learned to race yet sees the tutorial prologue first.

import { CHAPTERS } from './outline';
import { chapterTitle } from './engine';
import { chapterUnlocked, chaptersCleared, startReplay } from './state';
import type { StoryState } from './state';
import { HEATS_PER_GP } from '../types';
import type { ChapterNumber } from './types';

/** A chapter picked on the home screen, and whether it is a replay (a cleared chapter, played without the save). */
export interface StoryPick {
  chapter: ChapterNumber;
  replay: boolean;
}

/** All three heats of the chapter are banked. */
export function chapterCleared(state: StoryState, chapter: number): boolean {
  return (state.season.results[chapter - 1]?.length ?? 0) >= HEATS_PER_GP;
}

/** What the home screen's one big Story button reads and starts: the next chapter to play (a replay once it is all done). */
export function storyPrimary(state: StoryState): StoryPick & { label: string } {
  const finished = state.season.complete;
  const current = Math.min(6, Math.max(1, state.chapter)) as ChapterNumber;
  const chapter = (finished ? 1 : CHAPTERS.find((def) => chapterUnlocked(state, def.chapter) && !chapterCleared(state, def.chapter))?.chapter ?? current) as ChapterNumber;
  const label = finished ? `Replay · ${chapterTitle(chapter)}` : chaptersCleared(state) ? `Continue · ${chapterTitle(chapter)}` : 'Start the story';
  return { chapter, replay: chapterCleared(state, chapter), label };
}

/** A save with no tutorial and no progress yet: the first race of the campaign is the tutorial. */
export function needsTutorial(saved: StoryState | null): boolean {
  return !saved || (!saved.tutorialDone && !saved.seenScenes.length && !saved.season.results.some((heats) => heats.length));
}

/** The chapter to start: the pick when it is open (a replay exactly when it is cleared), else the next one to play. */
export function checkedPick(state: StoryState, pick: StoryPick | null): StoryPick {
  if (pick && chapterUnlocked(state, pick.chapter)) return { chapter: pick.chapter, replay: chapterCleared(state, pick.chapter) };
  const { chapter, replay } = storyPrimary(state);
  return { chapter, replay };
}

/** Enter a chapter: the state to race on, the save to go back to after a replay, and the heat that is up next. */
export function enterChapter(state: StoryState, pick: StoryPick): { state: StoryState; base: StoryState | null; heat: number } {
  if (pick.replay) return { state: startReplay(state, pick.chapter), base: state, heat: 1 };
  return {
    state: { ...state, chapter: pick.chapter, replaying: false },
    base: null,
    heat: (state.season.results[pick.chapter - 1]?.length ?? 0) + 1,
  };
}

export interface StoryOpening {
  state: StoryState;
  base: StoryState | null;
  heat: number;
  /** Open on the tutorial prologue; the chapter starts after it. */
  tutorial: boolean;
  pick: StoryPick;
}

/** Story mode's first screen: the prologue for a save that has not learned to race, otherwise the picked chapter. */
export function openStory(saved: StoryState | null, pick: StoryPick | null, fresh: () => StoryState): StoryOpening {
  const state = saved ?? fresh();
  const chosen = checkedPick(state, pick);
  if (needsTutorial(saved)) return { state, base: null, heat: 1, tutorial: true, pick: chosen };
  return { ...enterChapter(state, chosen), tutorial: false, pick: chosen };
}
