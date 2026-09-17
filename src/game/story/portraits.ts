/**
 * Cast → art (browser side). The one place story code turns a `CastId` and a mood into an image: story
 * portraits through the typed helpers in `assets.ts`, every other rival through the race portrait sheets.
 * Tests never import this module — they check the cast's portrait *names* against the art on disk instead.
 */
import { portraitFacing, storyPortrait } from './assets';
import type { StoryCharacter } from './assets';
import { rivalPortrait } from '../characters';
import type { Mood } from '../characters';
import { CAST, castColor, castTeam } from './cast';
import type { CastId, CastMember } from './cast';

function member(who: CastId): CastMember {
  const cast = CAST[who];
  if (!cast) throw new Error(`Unknown story cast member: ${who}`);
  return cast;
}

/** Moods this cast member can be written with. */
export function castMoods(who: CastId): readonly string[] {
  return member(who).moods;
}

/** Portrait URL for a line. An unsupported mood falls back to the cast member's default instead of breaking. */
export function castPortrait(who: CastId, mood: string): string {
  const cast = member(who);
  const safe = cast.moods.includes(mood) ? mood : cast.defaultMood;
  if (cast.portrait.kind === 'story') {
    return storyPortrait(cast.portrait.character as StoryCharacter, safe as never);
  }
  return rivalPortrait(cast.portrait.index, safe as Mood);
}

/** Which way the portrait faces, so speakers can be turned to look at each other. */
export function castFacing(who: CastId, mood: string): 'left' | 'right' {
  const cast = member(who);
  if (cast.portrait.kind !== 'story') return 'right';
  const safe = cast.moods.includes(mood) ? mood : cast.defaultMood;
  return portraitFacing(cast.portrait.character as StoryCharacter, safe);
}

export function castName(who: CastId): string {
  return member(who).name;
}

export function castTeamName(who: CastId): string {
  return castTeam(member(who)).name;
}

/** Name-plate colour: the cast member's team. */
export function castPlateColor(who: CastId): string {
  return castColor(member(who));
}

/** The ring frame used for a speaker: Sprocket wears the crown, villains the spiked ring. */
export function castRing(who: CastId): 'steel' | 'crown' | 'spiked' {
  if (who === 'sprocket') return 'crown';
  if (who === 'vex' || who === 'hood' || who === 'hood-revealed') return 'spiked';
  return 'steel';
}
