/**
 * The cast of "Down We Go" (#22 / ST-01).
 *
 * Data only, and node-safe: no art and no `characters.ts` here, so tests can import the cast without Vite.
 * Portrait URLs are resolved in `portraits.ts` (browser side) from `portrait` below.
 *
 * The story grid is FIXED — every cast member has the marble id they race with all season, so an objective
 * like "finish ahead of Ace" is `CAST.ace.gridId` and never a name lookup. Names and rival sprite indexes
 * match `RIVALS` in `src/game/characters.ts` (the schema test cross-checks them against that file).
 */
import { TEAMS, teamOf } from '../types';
import type { Team } from '../types';
import type { StoryCharacter } from './assets';
import type { Mood } from '../characters';

export type CastId =
  | 'sprocket'
  | 'smokey'
  | 'vex'
  | 'hood'
  | 'hood-revealed'
  | 'ace'
  | 'zapp'
  | 'grubba'
  | 'knuckles'
  | 'scorch'
  | 'red';

/** Painted story portrait, or the race portrait sheet every other rival already uses. */
export type PortraitRef =
  | { kind: 'story'; character: StoryCharacter }
  | { kind: 'rival'; index: number; moods: readonly Mood[] };

export interface CastMember {
  id: CastId;
  /** Display name in the dialogue box and on the timing tower. */
  name: string;
  /** Marble id this cast member races with all season (`hood` and `hood-revealed` share one). */
  gridId: number;
  teamId: number;
  /** Story role, shown in the hub. */
  role: string;
  /** One-line arc, shown in the hub. */
  arc: string;
  portrait: PortraitRef;
  /** Moods this cast member may be written with (checked against the art by the schema test). */
  moods: readonly string[];
  /** Default mood when a scene does not say. */
  defaultMood: string;
  /** Not on the grid: speaks in scenes only (never races). */
  offGrid?: boolean;
}

const RIVAL_MOODS: readonly Mood[] = ['angry', 'happy', 'surprised'];
const STORY_MOODS = ['angry', 'happy', 'surprised', 'sad', 'smug', 'shocked'] as const;

export const CAST: Record<CastId, CastMember> = {
  sprocket: {
    id: 'sprocket', name: 'Sprocket', gridId: 0, teamId: 0,
    role: 'The rookie', arc: 'Scrapyard goblin with a homemade marble. Talks their way onto the grid.',
    portrait: { kind: 'story', character: 'sprocket' },
    moods: ['happy', 'sad', 'smug', 'shocked'], defaultMood: 'happy',
  },
  smokey: {
    id: 'smokey', name: 'Old Smokey', gridId: 1, teamId: 0,
    role: 'The mentor', arc: 'Raced the first GP and lost it. Wants one more lap that counts.',
    portrait: { kind: 'story', character: 'old-smokey' },
    moods: STORY_MOODS, defaultMood: 'happy',
  },
  vex: {
    id: 'vex', name: 'Duchess Vex', gridId: 2, teamId: 1,
    role: 'The deal', arc: 'Buys drivers, races and referees. Collects debts in the dark.',
    portrait: { kind: 'story', character: 'duchess-vex' },
    moods: STORY_MOODS, defaultMood: 'smug',
  },
  hood: {
    id: 'hood', name: 'The Hood', gridId: 3, teamId: 1,
    role: 'The ghost', arc: 'Nobody has seen the face. Nobody asks twice.',
    portrait: { kind: 'story', character: 'the-hood-hidden' },
    moods: ['stern', 'smirk', 'snarl', 'grimace'], defaultMood: 'stern',
  },
  'hood-revealed': {
    id: 'hood-revealed', name: 'The Hood', gridId: 3, teamId: 1,
    role: 'The debt', arc: "Apex's missing star, racing for Vex to pay off a debt. Ashamed, then determined.",
    portrait: { kind: 'story', character: 'the-hood-revealed' },
    moods: ['ashamed', 'angry', 'determined', 'relieved'], defaultMood: 'ashamed',
  },
  ace: {
    id: 'ace', name: 'Ace Spadegrin', gridId: 4, teamId: 2,
    role: 'The champion', arc: 'Arrogant, quick, and the only ally worth having in a rigged finale.',
    portrait: { kind: 'story', character: 'ace-spadegrin' },
    moods: STORY_MOODS, defaultMood: 'smug',
  },
  zapp: {
    id: 'zapp', name: 'Zapp Gutwrench', gridId: 5, teamId: 2,
    role: 'The mechanic', arc: 'Loosened a bolt or two in his time. The perfect red herring.',
    portrait: { kind: 'story', character: 'zapp-gutwrench' },
    moods: STORY_MOODS, defaultMood: 'happy',
  },
  grubba: {
    id: 'grubba', name: 'Big Grubba', gridId: 6, teamId: 3,
    role: 'The wall', arc: 'Weighs more than his ball and sits on runts.',
    portrait: { kind: 'rival', index: 2, moods: RIVAL_MOODS },
    moods: RIVAL_MOODS, defaultMood: 'angry',
  },
  knuckles: {
    id: 'knuckles', name: 'Knuckles Blau', gridId: 7, teamId: 3,
    role: 'The fists', arc: 'Punches first, steers never.',
    portrait: { kind: 'rival', index: 3, moods: RIVAL_MOODS },
    moods: RIVAL_MOODS, defaultMood: 'angry',
  },
  scorch: {
    id: 'scorch', name: 'Scorch', gridId: 8, teamId: 4,
    role: 'The arsonist', arc: 'Set fire to the pit lane. Twice. Both times on purpose.',
    portrait: { kind: 'rival', index: 4, moods: RIVAL_MOODS },
    moods: RIVAL_MOODS, defaultMood: 'angry',
  },
  red: {
    id: 'red', name: 'Red Morrigan', gridId: 9, teamId: 4,
    role: 'The braid', arc: 'Braids tougher than rope, tongue sharper than the braid.',
    portrait: { kind: 'rival', index: 7, moods: RIVAL_MOODS },
    moods: RIVAL_MOODS, defaultMood: 'angry',
  },
};

export const CAST_IDS: readonly CastId[] = Object.keys(CAST) as CastId[];

/** The ten marbles on the story grid, in marble-id order. `hood` and `hood-revealed` share id 3. */
export const STORY_GRID: readonly CastId[] = ['sprocket', 'smokey', 'vex', 'hood', 'ace', 'zapp', 'grubba', 'knuckles', 'scorch', 'red'];

/** Cast members that race (one per marble id). */
export function racingCast(): CastMember[] {
  return STORY_GRID.map((id) => CAST[id]);
}

/** The cast member on a marble id, or null for the pre-reveal/post-reveal twin. */
export function castByGridId(gridId: number): CastMember | null {
  const id = STORY_GRID.find((castId) => CAST[castId].gridId === gridId);
  return id ? CAST[id] : null;
}

export function castTeam(cast: CastMember): Team {
  return TEAMS[cast.teamId] ?? teamOf(cast.gridId);
}

/** Team colour for a name plate. */
export function castColor(cast: CastMember): string {
  return castTeam(cast).color;
}

/** Sprocket's own marble is the player's garage goblin; everyone else keeps their team colours. */
export const CAST_BY_NAME: Record<string, CastId> = CAST_IDS.reduce((all, id) => {
  const member = CAST[id];
  if (!all[member.name]) all[member.name] = id;
  return all;
}, {} as Record<string, CastId>);
