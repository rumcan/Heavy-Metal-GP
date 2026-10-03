// P2-13 (#119): the tutorial lesson state machine.
//
// The first race of the campaign is a short, skippable ride on the Training Grounds
// (`planTutorial()` in src/game/platformer/course.ts). Six lessons run in order and EACH
// ONE WAITS FOR THE PLAYER: the voice line plays, a big key prompt shows up, and the
// lesson only advances when the action it teaches actually happens.
//
// This module is the pure heart of that: no React, no Matter, no DOM — just a reducer the
// overlay feeds frames into (`tutorialStep`) and the lesson table the voice manifest and
// the key prompts both read from. Detection is deliberately forgiving (trigger zones are
// x-ranges, every signal is a plain boolean), so the wiring in RaceScreen/the overlay can
// stay tiny.

import { AI_COLORS, AI_NAMES } from '../types';
import type { MarbleInfo } from '../types';
import type { StoryDriver } from './state';

/** The voice set the tutorial speaks from (`src/voice/manifests/tutorial.json`). */
export const TUTORIAL_VOICE_SET = 'tutorial';

/** The platformer course the tutorial races (the hand-built Training Grounds). */
export const TUTORIAL_COURSE_ID = 'training';

/** Deterministic seed: the tutorial course is hand-built, so one seed is the only seed. */
export const TUTORIAL_SEED = 20260213;

export type LessonId = 'steer' | 'engine' | 'skills' | 'jump' | 'shortcut' | 'finish';

export interface LessonDef {
  id: LessonId;
  /** Voice line id inside the `tutorial` manifest — one spoken line per lesson. */
  line: string;
  /** The caption text (what the narrator says, without performance tags). */
  text: string;
  /**
   * The key prompt shown while the lesson waits. `keyboard` is the kbd labels on desktop;
   * `touch` names the on-screen control the overlay highlights on phones. `null` for the
   * finish lesson, which waits for the race itself.
   */
  keys: { keyboard: string[]; touch: string } | null;
  /** The lesson arms once the player's course x reaches this (0 = from the start). */
  enterAt: number;
}

/**
 * The six lessons, in the order the course teaches them: one of each thing, matching the
 * Training Grounds layout (start flat → crate → gap → ramp/door → slope → climb → finish).
 */
export const TUTORIAL_LESSONS: readonly LessonDef[] = [
  {
    id: 'steer',
    line: 'tutorial-steer',
    text: 'Press left and right to steer.',
    keys: { keyboard: ['←', '→'], touch: 'the ◀ and ▶ buttons' },
    enterAt: 0,
  },
  {
    id: 'engine',
    line: 'tutorial-engine',
    text: 'Hold down to fire your Magic Engine. Watch the heat bar.',
    keys: { keyboard: ['↓'], touch: 'the ENGINE button' },
    enterAt: 850,
  },
  {
    id: 'skills',
    line: 'tutorial-skills',
    text: 'Your skills live on Q W E R and A S D F.',
    keys: { keyboard: ['Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F'], touch: 'a skill on your toolbar' },
    enterAt: 1000,
  },
  {
    id: 'jump',
    line: 'tutorial-jump',
    text: 'Press up or Space to jump the gap.',
    keys: { keyboard: ['↑', 'SPACE'], touch: 'the JUMP button' },
    enterAt: 1450,
  },
  {
    id: 'shortcut',
    line: 'tutorial-shortcut',
    text: 'See that tunnel in the cliff? Jump into it to skip a whole section.',
    keys: { keyboard: ['↑', 'SPACE'], touch: 'the JUMP button' },
    enterAt: 3950,
  },
  {
    id: 'finish',
    line: 'tutorial-finish',
    text: 'That is it. Now let us go racing.',
    keys: null,
    enterAt: 5100,
  },
];

/**
 * The shortcut piece of the Training Grounds (the lesson-5 ledge). Geometry mirrors
 * `planTutorial()`: the ledge runs over the long slope, and a marble counts as having
 * taken the shortcut while it is inside the x-range and above the slope floor.
 */
export const TUTORIAL_SHORTCUT = { x0: 4080, x1: 5060, aboveY: 665 } as const;

/** A frame of what the player is doing, pushed in by the race wiring. */
export interface TutorialFrame {
  /** The player marble's course x (the trigger zones are x-ranges). */
  x: number;
  /** Left/right steering happened since the last frame (both are needed for lesson 1). */
  steerLeft?: boolean;
  steerRight?: boolean;
  /** The Magic Engine actually fired (heat climbed), since the last frame. */
  engineFired?: boolean;
  /** A skill was used since the last frame. */
  skillUsed?: boolean;
  /** A jump happened since the last frame. */
  jumped?: boolean;
  /** The player is on the shortcut ledge right now. */
  shortcutTaken?: boolean;
  /** The player crossed the finish line. */
  finished?: boolean;
}

export interface TutorialState {
  /** Index of the lesson currently waiting for its action. */
  index: number;
  /** True once the finish lesson completed or the player skipped. */
  done: boolean;
  /** True when the player skipped instead of riding the lessons out. */
  skipped: boolean;
  /** Lesson ids completed so far, in order. */
  completed: readonly LessonId[];
  /** Lesson-1 progress: steering wants BOTH directions before it counts. */
  steerLeftDone: boolean;
  steerRightDone: boolean;
}

export function newTutorial(): TutorialState {
  return { index: 0, done: false, skipped: false, completed: [], steerLeftDone: false, steerRightDone: false };
}

/** Restart the machine (replaying the tutorial from How to play is a fresh ride). */
export function replayTutorial(): TutorialState {
  return newTutorial();
}

/** The lesson the machine is waiting on right now, or null when the ride is over. */
export function currentLesson(state: TutorialState): LessonDef | null {
  if (state.done) return null;
  return TUTORIAL_LESSONS[state.index] ?? null;
}

/** Skip every remaining lesson at once (the big Skip button and mid-race bail both land here). */
export function skipTutorial(state: TutorialState): TutorialState {
  if (state.done) return state;
  return {
    ...state,
    index: TUTORIAL_LESSONS.length,
    done: true,
    skipped: true,
    completed: TUTORIAL_LESSONS.map((lesson) => lesson.id),
  };
}

function complete(state: TutorialState, at: number): TutorialState {
  const lesson = TUTORIAL_LESSONS[at];
  const index = at + 1;
  return {
    ...state,
    index,
    completed: [...state.completed, lesson.id],
    done: index >= TUTORIAL_LESSONS.length,
  };
}

/**
 * Advance the machine with one frame of player input. Pure: the same state + frame always
 * yields the same next state. Rules:
 *  - a finished or skipped machine never moves again;
 *  - a lesson only arms once the player reaches its `enterAt` x — actions before that are
 *    ignored (jumping the crate early does not pass the gap lesson);
 *  - only the CURRENT lesson consumes signals, in order, one completion per lesson;
 *  - steering needs both directions; the shortcut also passes when the player rolls the
 *    long way past the section (the tutorial must never soft-lock);
 *  - the finish lesson completes on the chequered flag.
 */
export function tutorialStep(state: TutorialState, frame: TutorialFrame): TutorialState {
  if (state.done) return state;
  const lesson = TUTORIAL_LESSONS[state.index];
  if (!lesson || frame.x < lesson.enterAt) return state;

  switch (lesson.id) {
    case 'steer': {
      const steerLeftDone = state.steerLeftDone || !!frame.steerLeft;
      const steerRightDone = state.steerRightDone || !!frame.steerRight;
      if (!steerLeftDone || !steerRightDone) {
        if (steerLeftDone === state.steerLeftDone && steerRightDone === state.steerRightDone) return state;
        return { ...state, steerLeftDone, steerRightDone };
      }
      return complete({ ...state, steerLeftDone, steerRightDone }, state.index);
    }
    case 'engine':
      return frame.engineFired ? complete(state, state.index) : state;
    case 'skills':
      return frame.skillUsed ? complete(state, state.index) : state;
    case 'jump':
      return frame.jumped ? complete(state, state.index) : state;
    case 'shortcut':
      return frame.shortcutTaken || frame.x >= TUTORIAL_SHORTCUT.x1 ? complete(state, state.index) : state;
    case 'finish':
      return frame.finished ? complete(state, state.index) : state;
    default:
      return state;
  }
}

/**
 * The tutorial grid: the player plus two deliberately SLOW rivals (nobody should be
 * beating up a learner). Same ids/stats shape as every other roster; the wiring decides
 * there is no damage.
 */
export function tutorialRoster(driver: StoryDriver): MarbleInfo[] {
  const slow: { name: string; stats: MarbleInfo['stats'] }[] = [
    { name: AI_NAMES[2], stats: { weight: 9, speed: 2, bounce: 4 } },
    { name: AI_NAMES[3], stats: { weight: 8, speed: 3, bounce: 4 } },
  ];
  return [
    { id: 0, name: driver.name || 'You', color: driver.color, stats: { ...driver.stats }, isPlayer: true, character: driver.portrait },
    ...slow.map((ai, i) => ({ id: i + 1, name: ai.name, color: AI_COLORS[i], stats: { ...ai.stats }, isPlayer: false, character: i })),
  ];
}
