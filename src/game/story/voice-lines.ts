// P2-14: how story lines map onto the voice set `story` (src/voice/manifests/story.json, built by
// scripts/voice/story-manifest.mjs). Pure functions, shared by the manifest builder and StoryScene.
import type { Line, Scene } from './types';

export const STORY_VOICE_SET = 'story';

/** The voice line id for line `index` of a scene: kebab-case, stable while the script keeps its order. */
export function storyVoiceId(sceneId: string, index: number): string {
  const slug = sceneId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${slug}-${index}`;
}

/** Story cast id → voice cast id (src/voice/cast.json). */
const SPEAKERS: Record<string, string> = {
  sprocket: 'sprocket',
  smokey: 'old-smokey',
  zapp: 'zapp-gutwrench',
  vex: 'duchess-vex',
  ace: 'ace-spadegrin',
  grubba: 'big-grubba',
  knuckles: 'knuckles-blau',
  scorch: 'scorch',
  red: 'red-morrigan',
  hood: 'the-hood',
  'hood-revealed': 'the-hood',
};

/** Portrait mood → an eleven_v3 performance tag (the caption strips it). */
const MOOD_TAGS: Record<string, string> = {
  happy: '[cheerful]',
  smug: '[smug]',
  smirk: '[smug]',
  surprised: '[surprised]',
  shocked: '[gasps]',
  angry: '[angry]',
  grimace: '[frustrated]',
  sad: '[sighs]',
  ashamed: '[quietly]',
  stern: '[firmly]',
  determined: '[determined]',
  relieved: '[relieved]',
};

export function storyVoiceSpeaker(who: string): string | null {
  return SPEAKERS[who] ?? null;
}

export function storyVoiceText(line: Line): string {
  const tag = MOOD_TAGS[line.mood];
  return tag ? `${tag} ${line.text}` : line.text;
}

export interface StoryVoiceEntry { id: string; speaker: string; text: string }

/** Every voiced line of the script, in order. Lines whose speaker has no voice are left silent. */
export function storyVoiceManifest(scenes: readonly Scene[]): StoryVoiceEntry[] {
  const out: StoryVoiceEntry[] = [];
  for (const scene of scenes) {
    scene.lines.forEach((line, index) => {
      const speaker = storyVoiceSpeaker(line.who);
      if (speaker && line.text.trim()) out.push({ id: storyVoiceId(scene.id, index), speaker, text: storyVoiceText(line) });
    });
  }
  return out;
}
