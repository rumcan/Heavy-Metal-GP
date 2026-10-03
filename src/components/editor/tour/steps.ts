// P2-15: the Workshop tour. Zapp walks a new builder through the Workshop, one highlighted control at a time.
// Each step's `say` is spoken (voice set `workshop`, line `tour-<id>`, built by scripts/voice/workshop-manifest.mjs)
// and its caption is the same words without the performance tag. Pure data, tested in tests/workshop-tour.test.ts.

export const TOUR_VOICE_SET = 'workshop';
export const TOUR_SPEAKER = 'zapp-gutwrench';

/** How a step moves on: the Next button, or the player doing the thing (Next always works too). */
export type TourAdvance = 'next' | 'testing' | 'valid';

export interface TourStep {
  id: string;
  title: string;
  /** The spoken line; `[tag]`s are voice directions and never shown. */
  say: string;
  /** `data-coach` value of the control to spotlight; null for a step with nothing to point at. */
  target: string | null;
  advance: TourAdvance;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'new', title: 'New track', target: 'new-track', advance: 'next',
    say: "[cheerful] Oi, builder! Zapp here. Every track starts with New track: a blank one, a copy of a championship track, a starter, or one I generate for you.",
  },
  {
    id: 'palette', title: 'The pieces', target: 'palette', advance: 'next',
    say: 'These are your pieces, sorted into groups. Tap one, then tap the map to drop it. Each picture shows what it does, pegs and all.',
  },
  {
    id: 'edit', title: 'Editing', target: 'editbar', advance: 'next',
    say: 'Tap a piece to select it. Drag to move it, use the handles to turn and stretch it. The cog opens its settings, Group glues pieces together, the bin deletes, and the arrows undo and redo.',
  },
  {
    id: 'settings', title: 'Track settings', target: 'track-settings', advance: 'next',
    say: 'Up here you name your track, pick its theme, and set how long it runs.',
  },
  {
    id: 'test', title: 'Test drive', target: 'testdrive', advance: 'testing',
    say: "[excited] Now the fun bit! Test drive rolls a marble through it right away. Escape brings you back, nothing lost.",
  },
  {
    id: 'validate', title: 'Validate', target: 'validate', advance: 'valid',
    say: 'Validate races ten marbles down your track. Nine must finish and nobody may get stuck. Each warning says what is wrong; tap it to jump to the spot.',
  },
  {
    id: 'save', title: 'Save and My tracks', target: 'save', advance: 'next',
    say: 'Save draft any time, even half built. Your tracks wait in My tracks, ready to load, rename or copy.',
  },
  {
    id: 'publish', title: 'Publish', target: 'publish', advance: 'next',
    say: "Once it passes, Publish puts it in Community tracks. Give it a name and tags, and goblins everywhere can race it and upvote it.",
  },
  {
    id: 'play', title: 'Where to play it', target: null, advance: 'next',
    say: "[laughs] And to race it: Quick Race, then My tracks or Community. Or host an online lobby and pick it as the circuit. Off you go, build something mad!",
  },
];

export const tourVoiceId = (step: TourStep) => `tour-${step.id}`;

/** The caption: the spoken line without its `[tags]`. */
export const tourCaption = (step: TourStep) => step.say.replace(/\[[^\]]{1,40}\]\s*/g, '').trim();

/** The step after `index` once the player has done something: test driving or a passing validation. */
export function tourAutoAdvance(index: number, state: { testing: boolean; valid: boolean }): number {
  const step = TOUR_STEPS[index];
  if (!step) return index;
  if (step.advance === 'testing' && state.testing) return index + 1;
  if (step.advance === 'valid' && state.valid) return index + 1;
  return index;
}

/** The voice manifest for the tour. */
export function tourVoiceManifest() {
  return TOUR_STEPS.map((step) => ({ id: tourVoiceId(step), speaker: TOUR_SPEAKER, text: step.say }));
}
