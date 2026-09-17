/**
 * Story mode art, ready to use. Every file under `src/assets/story/` is reachable through the typed helpers
 * below, so story code never hard-codes a path. See `src/assets/story/README.md` for previews and notes.
 *
 * Importing this module pulls every story image into the bundle (the game builds to one inlined file), so import it
 * only from story code.
 */

// Vite resolves `import.meta.glob` at build time. Node (the test runner) has no such function, and the story
// schema tests import this module for its NAME TABLES only, so the lookup degrades to an empty map there and
// `url()` — which only ever runs in the browser — is what throws if an asset is missing.
// Vite rewrites the literal `import.meta.glob(...)` call into an object of every matching file; there is no
// runtime implementation, so the same expression is `undefined` under the node test runner. The call has to
// stay literal for the transform to see it, hence the try/catch: node falls back to the name tables only.
let files: Record<string, string> = {};
try {
  files = import.meta.glob('../../assets/story/**/*.webp', { eager: true, import: 'default' });
} catch {
  files = {};
}

function url(folder: string, name: string): string {
  const hit = files[`../../assets/story/${folder}/${name}.webp`];
  if (!hit) throw new Error(`Missing story asset: ${folder}/${name}.webp`);
  return hit;
}

/** Portrait moods available per character. The Hood has two separate sets: before and after the chapter 5 reveal. */
export const STORY_PORTRAITS = {
  'sprocket': ['happy', 'sad', 'smug', 'shocked'],
  'ace-spadegrin': ['angry', 'happy', 'surprised', 'sad', 'smug', 'shocked'],
  'duchess-vex': ['angry', 'happy', 'surprised', 'sad', 'smug', 'shocked'],
  'old-smokey': ['angry', 'happy', 'surprised', 'sad', 'smug', 'shocked'],
  'zapp-gutwrench': ['angry', 'happy', 'surprised', 'sad', 'smug', 'shocked'],
  /** Face hidden in shadow. `stern` and `grimace` face LEFT, `smirk` and `snarl` face RIGHT. */
  'the-hood-hidden': ['stern', 'smirk', 'snarl', 'grimace'],
  /** Face visible. Only after the reveal. */
  'the-hood-revealed': ['ashamed', 'angry', 'determined', 'relieved'],
} as const;

export type StoryCharacter = keyof typeof STORY_PORTRAITS;
export type StoryMood<C extends StoryCharacter> = (typeof STORY_PORTRAITS)[C][number];

/** Which way the portrait faces, for placing speakers on the left/right of a dialogue scene. Default: right. */
export function portraitFacing(character: StoryCharacter, mood: string): 'left' | 'right' {
  return character === 'the-hood-hidden' && (mood === 'stern' || mood === 'grimace') ? 'left' : 'right';
}

export function storyPortrait<C extends StoryCharacter>(character: C, mood: StoryMood<C>): string {
  return url('portraits', `${character}_${mood}`);
}

export const STORY_BACKGROUNDS = [
  'scrapyard-at-dusk',
  'apex-racing-garage',
  'grandstand-race-day',
  'old-smokey-training-shack',
  'vex-gilded-office',
  'pit-lane-at-night',
  'mine-control-room',
  'finale-podium',
] as const;
export type StoryBackground = (typeof STORY_BACKGROUNDS)[number];
export const storyBackground = (name: StoryBackground) => url('backgrounds', name);

export const STORY_ENDINGS = ['champion-ending', 'bittersweet-ending', 'heartbreak-ending'] as const;
export type StoryEnding = (typeof STORY_ENDINGS)[number];
export const storyEnding = (name: StoryEnding) => url('endings', name);

export const STORY_ACTS = ['act-1-the-rookie', 'act-2-the-rise-and-the-fall', 'act-3-down-we-go'] as const;
export const STORY_CHAPTERS = [
  'chapter-1-the-scrapyard-kid',
  'chapter-2-street-smarts',
  'chapter-3-old-smokeys-lessons',
  'chapter-4-the-deal',
  'chapter-5-the-hood',
  'chapter-6-down-we-go',
] as const;
/** Act banner for act 1..3 (the lettering is part of the art). */
export const actBanner = (act: 1 | 2 | 3) => url('titles', STORY_ACTS[act - 1]);
/** Chapter plaque for chapter 1..6; chapter N is Grand Prix N-1 in `CALENDAR`. */
export const chapterPlaque = (chapter: 1 | 2 | 3 | 4 | 5 | 6) => url('titles', STORY_CHAPTERS[chapter - 1]);

export const STORY_PROPS = [
  'contract-scroll',
  'wrench-and-bolt',
  'cracked-marble',
  'folded-hood',
  'iron-trophy',
  'gold-coin-bag',
  'mine-blueprint',
  'old-racing-helmet',
  'framed-photo',
  'dynamite-bundle',
  'lantern',
  'checkered-flag',
] as const;
export type StoryProp = (typeof STORY_PROPS)[number];
export const storyProp = (name: StoryProp) => url('props', name);
