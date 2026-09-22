import { CIRCUIT_LENGTH_MULTIPLIER, mulberry32, themeIdFor } from './types';
import type { TrackProfile } from './types';

export const SIGNATURE_LAYOUTS = [
  'fairground',
  'watermill',
  'funhouse',
  'tunnelrun',
  'cannonalley',
  'bladestreet',
  'pegboard',
  'targetrange',
  'turnstiles',
  'icecascade',
  'looprun',
  'rapids',
  'macealley',
  'magnetcave',
  'boulderrun',
] as const;

export type SignatureLayout = (typeof SIGNATURE_LAYOUTS)[number];

export interface CourseChapter {
  layout: SignatureLayout;
  mirror: boolean;
  variant: number;
}

const WEIGHTS: Record<SignatureLayout, readonly string[]> = {
  fairground: ['Bounce Ramp', 'Trampoline Alley', 'Rope Crossing'],
  watermill: ['Wheel Lift', 'Screw Tower', 'Drawbridge Gap'],
  funhouse: ['Flipper Alley', 'Spinners', 'Chicane'],
  tunnelrun: ['Tunnel Shortcut', 'Crumbling Wall', 'Crack Wall Shortcut'],
  cannonalley: ['Bounce Ramp', 'Splitter'],
  bladestreet: ['Blade Gauntlet', 'Crusher Alley', 'Mace Sweep'],
  pegboard: ['Peggle Board', 'Peg Field'],
  targetrange: ['Zigzag Pipes', 'Crack Wall Shortcut'],
  turnstiles: ['Turnstile Square', 'Spinners', 'Chicane'],
  icecascade: ['Ice Slide'],
  looprun: ['Loop', 'Zigzag Pipes', 'Beltway'],
  rapids: ['Ice Slide', 'Beltway'],
  macealley: ['Mace Sweep', 'Crusher Alley', 'Chicane'],
  magnetcave: ['Funnel', 'Curve Drop', 'Tunnel Shortcut'],
  boulderrun: ['Beltway', 'Crusher Alley', 'Blade Gauntlet'],
};

const THEME_SIGNATURE: Partial<Record<string, SignatureLayout>> = {
  silver: 'pegboard',
  forest: 'rapids',
  street: 'tunnelrun',
  dwarven: 'boulderrun',
  worg: 'macealley',
  sakura: 'icecascade',
  night: 'bladestreet',
  classic: 'fairground',
  default: 'funhouse',
};

function weight(value: number | undefined): number {
  if (value === undefined) return 1;
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

function pick<T extends string>(
  rng: () => number,
  choices: readonly T[],
  weights: readonly number[],
): T {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return choices[0];
  let draw = rng() * total;
  let last = choices[0];
  for (let i = 0; i < choices.length; i++) {
    if (weights[i] <= 0) continue;
    last = choices[i];
    if (draw < weights[i]) return choices[i];
    draw -= weights[i];
  }
  return last;
}

export function planCourse(seed: number, profile: TrackProfile): CourseChapter[] {
  const rng = mulberry32((seed ^ 0x43525345) >>> 0);
  const theme = themeIdFor(profile.theme);
  const signature = THEME_SIGNATURE[theme] ?? 'fairground';

  const segments = Number.isFinite(profile.segments) ? profile.segments : 30;
  const count = Math.max(8, Math.min(14, Math.round(segments / CIRCUIT_LENGTH_MULTIPLIER)));

  const layoutWeights = SIGNATURE_LAYOUTS.map((layout) => {
    const keys = WEIGHTS[layout];
    const configured = profile.weights[layout];
    const base =
      configured === undefined
        ? keys.reduce((sum, key) => sum + weight(profile.weights[key]), 0) / keys.length
        : weight(configured);
    const bias = layout === signature ? 2.4 : 1;
    return Math.max(0.05, base) * bias;
  });

  const plan: CourseChapter[] = [];
  const required = new Set<SignatureLayout>([signature, 'fairground', 'looprun', 'pegboard']);

  for (let i = 0; i < count; i++) {
    const previous = plan[i - 1];
    const weights = layoutWeights.map((w, index) => {
      const layout = SIGNATURE_LAYOUTS[index];
      let score = w;
      if (previous?.layout === layout) score *= 0.15;
      if (required.has(layout) && !plan.some((c) => c.layout === layout)) score *= 3;
      return score;
    });

    const remainingRequired = [...required].filter((l) => !plan.some((c) => c.layout === l));
    let layout: SignatureLayout;
    if (remainingRequired.length && i >= count - remainingRequired.length) {
      layout = remainingRequired[Math.floor(rng() * remainingRequired.length)];
    } else {
      layout = pick(rng, SIGNATURE_LAYOUTS, weights);
    }
    required.delete(layout);

    plan.push({
      layout,
      mirror: (seed & 1) === 1,
      variant: Math.floor(rng() * 3),
    });
  }

  return plan;
}