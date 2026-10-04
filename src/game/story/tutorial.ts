// P2-13 (#119), rebuilt: the tutorial, casual-game style.
//
// The first race of the campaign is a short ride on the Training Grounds (`planTutorial()` in
// src/game/platformer/course.ts). Between lessons the ball drives itself (the learner cannot stop, roll back or miss a
// spot). At each lesson's spot the race FREEZES, the screen dims, and one big key (the on-screen button on a phone)
// says exactly what to press. Only that key does anything; pressing it lights it up and the race carries on with the
// action at exactly the right place (the jump happens at the gap). Two steps need no key: rolling through the green
// arrows to the back lane, and the finish.
//
// This module is the pure heart of it: the step table and a tiny state machine the overlay and the race read.

import { AI_COLORS, AI_NAMES } from '../types';
import type { MarbleInfo } from '../types';
import type { StoryDriver } from './state';

/** The voice set the tutorial speaks from (`src/voice/manifests/tutorial.json`). */
export const TUTORIAL_VOICE_SET = 'tutorial';

/** The platformer course the tutorial races (the hand-built Training Grounds). */
export const TUTORIAL_COURSE_ID = 'training';

/** Deterministic seed: the tutorial course is hand-built, so one seed is the only seed. */
export const TUTORIAL_SEED = 20260213;

/** What the learner can press. `left` exists only so it can be refused. */
export type TutorialInput = 'jump' | 'right' | 'left' | 'engine' | 'skill';

export type StepId = 'fire' | 'roll' | 'engine' | 'skill' | 'crate' | 'gap' | 'lane' | 'door' | 'shortcut' | 'finish';

export interface StepDef {
  id: StepId;
  /** Voice line id inside the `tutorial` manifest. */
  line: string;
  /** What the narrator says (the caption, without performance tags). */
  text: string;
  /** The big call to action on the frozen screen, e.g. "Press SPACE". Null for the steps that need no key. */
  prompt: string | null;
  /** The key(s) shown, the KeyboardEvent codes that count, and the on-screen button for touch. */
  keys: { keyboard: string[]; codes: string[]; touch: string; touchSelector: string } | null;
  /** The input that completes the step; `lane` = reach the back lane, `finish` = the chequered flag. */
  expect: TutorialInput | 'lane' | 'finish';
  /** Freeze here (course x); 'gate' = the moment the lights go out; null = never freeze. */
  freezeAt: number | 'gate' | null;
  /**
   * For a jump at an obstacle: freeze `lead` physics steps before the ball reaches x `before`, at whatever speed it
   * is going (a boosted ball is three times faster: a fixed spot was too late and it hit the crate).
   */
  obstacle?: { before: number; lead: number };
}

const JUMP_KEYS = { keyboard: ['SPACE', '↑'], codes: ['Space', 'ArrowUp', 'KeyW'], touch: 'JUMP', touchSelector: '[aria-label="Jump"]' };

/**
 * The steps, in course order. Spots follow `planTutorial()`: crate at x 1300, the gap 1900..2040, the lane ramp to the
 * back lane at 2900, the door back to the middle at 3700..3870, the shortcut ledge from 4120 (60 above the floor).
 * Each freeze spot is where the self-driving ball's jump clears the obstacle (checked in tests/tutorial.test.ts).
 */
export const TUTORIAL_STEPS: readonly StepDef[] = [
  { id: 'fire', line: 'tutorial-fire', text: 'You start in a cannon. Press Space to fire it!', prompt: 'Press SPACE to fire', keys: JUMP_KEYS, expect: 'jump', freezeAt: 'gate' },
  { id: 'roll', line: 'tutorial-roll', text: 'Press right to roll forward.', prompt: 'Press → to roll', keys: { keyboard: ['→'], codes: ['ArrowRight', 'KeyD'], touch: '▶', touchSelector: '[aria-label="Nudge right"]' }, expect: 'right', freezeAt: 700 },
  { id: 'engine', line: 'tutorial-engine', text: 'Hold down to fire your Magic Engine for a burst of speed. Watch the heat bar!', prompt: 'Hold ↓ for a boost', keys: { keyboard: ['↓'], codes: ['ArrowDown', 'KeyS'], touch: 'ENGINE', touchSelector: '[aria-label="Magic Engine (hold)"]' }, expect: 'engine', freezeAt: 900 },
  { id: 'skill', line: 'tutorial-skills', text: 'Press Q to use your Speed Boost. Your skills live on Q W E R and A S D F.', prompt: 'Press Q for a Speed Boost', keys: { keyboard: ['Q'], codes: ['KeyQ'], touch: 'SPEED BOOST', touchSelector: '.loadout-slot' }, expect: 'skill', freezeAt: 1030 },
  { id: 'crate', line: 'tutorial-crate', text: 'A crate! Press Space to jump over it.', prompt: 'Press SPACE to jump', keys: JUMP_KEYS, expect: 'jump', freezeAt: null, obstacle: { before: 1300, lead: 10 } },
  { id: 'gap', line: 'tutorial-jump', text: 'Mind the gap! Press Space to jump it.', prompt: 'Press SPACE to jump the gap', keys: JUMP_KEYS, expect: 'jump', freezeAt: null, obstacle: { before: 1895, lead: 3 } },
  { id: 'lane', line: 'tutorial-lane', text: 'See the green arrows? Roll through them and you switch to the back lane.', prompt: null, keys: null, expect: 'lane', freezeAt: null },
  { id: 'door', line: 'tutorial-door', text: 'A door back to the middle lane. Press up to go through it.', prompt: 'Press ↑ to go through the door', keys: { keyboard: ['↑'], codes: ['ArrowUp', 'KeyW', 'Space'], touch: 'JUMP', touchSelector: '[aria-label="Jump"]' }, expect: 'jump', freezeAt: 3725 },
  { id: 'shortcut', line: 'tutorial-shortcut', text: 'A shortcut ledge! Jump onto it to skip the long way round.', prompt: 'Press SPACE to jump on the ledge', keys: JUMP_KEYS, expect: 'jump', freezeAt: null, obstacle: { before: 4120, lead: 11 } },
  { id: 'finish', line: 'tutorial-finish', text: 'That is it. Roll to the finish and let us go racing!', prompt: null, keys: null, expect: 'finish', freezeAt: null },
];

export interface TutorialState {
  /** Index of the step that is waiting. */
  index: number;
  /** The race is frozen on this step until its key is pressed. */
  frozen: boolean;
  done: boolean;
  skipped: boolean;
}

export const newTutorial = (): TutorialState => ({ index: 0, frozen: false, done: false, skipped: false });
export const replayTutorial = newTutorial;

export function currentStep(state: TutorialState): StepDef | null {
  return state.done ? null : TUTORIAL_STEPS[state.index] ?? null;
}

function advance(state: TutorialState): TutorialState {
  const index = state.index + 1;
  return { ...state, index, frozen: false, done: index >= TUTORIAL_STEPS.length };
}

/** A frame of where the learner is. Freezes on the step's spot; completes the steps that need no key. */
export function tutorialFrame(state: TutorialState, f: { x: number; vx?: number; lane: number; gateOpen: boolean; finished: boolean }): TutorialState {
  const step = currentStep(state);
  if (!step || state.frozen) return state;
  if (step.expect === 'lane') return f.lane === 0 ? advance(state) : state;
  if (step.expect === 'finish') return f.finished ? advance(state) : state;
  const at = step.freezeAt;
  const reach = step.obstacle ? f.x + Math.max(3, f.vx ?? 0) * step.obstacle.lead >= step.obstacle.before : false;
  if (reach || (at === 'gate' ? f.gateOpen : at !== null && f.x >= at)) return { ...state, frozen: true };
  return state;
}

/** May this input reach the race right now? Only the waiting step's key, and only while frozen on it. */
export function allows(state: TutorialState, input: TutorialInput): boolean {
  const step = currentStep(state);
  return !!step && state.frozen && step.expect === input;
}

/** The learner pressed something: the frozen step's key completes it (the race unfreezes and does the action). */
export function tutorialInput(state: TutorialState, input: TutorialInput): TutorialState {
  return allows(state, input) ? advance(state) : state;
}

/** Between lessons the ball drives itself; frozen, nothing moves. */
export const autopilot = (state: TutorialState): boolean => !state.done && !state.frozen;

/** Skip the rest (a real click on Skip, or leaving the race). */
export function skipTutorial(state: TutorialState): TutorialState {
  return state.done ? state : { ...state, index: TUTORIAL_STEPS.length, frozen: false, done: true, skipped: true };
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

/** The self-driving ball's top speed (px per step): steady and predictable, so every lesson spot comes up right. */
export const CRUISE_SPEED = 9;
/** Just after the engine and boost lessons, a taste of the speed they give. */
export const BOOSTED_SPEED = 15;
export const BOOST_TASTE_MS = 1500;

/** The speed cap for the self-driving ball right now (`boostedAt` = race time the engine/boost lesson was done). */
export function speedCap(time: number, boostedAt: number | null): number {
  return boostedAt !== null && time - boostedAt < BOOST_TASTE_MS ? BOOSTED_SPEED : CRUISE_SPEED;
}
