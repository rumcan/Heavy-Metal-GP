import { CIRCUIT_LENGTH_MULTIPLIER, mulberry32, themeIdFor } from './types';
import type { TrackProfile } from './types';

export const COURSE_LAYOUTS = ['sweeper', 'split', 'slalom', 'terraces', 'arena'] as const;
export const COURSE_FEATURES = ['banking', 'peggle', 'ice', 'boost', 'machines'] as const;
export type CourseLayout = typeof COURSE_LAYOUTS[number];
export type CourseFeature = typeof COURSE_FEATURES[number];

export interface CourseChapter {
  layout: CourseLayout;
  feature: CourseFeature;
  mirror: boolean;
  variant: number;
}

const WEIGHTS: Record<CourseFeature, readonly string[]> = {
  banking: ['Curve Drop', 'Chicane', 'Funnel'],
  peggle: ['Peggle Board', 'Peg Field'],
  ice: ['Ice Slide', 'Skipping Pools'],
  boost: ['Zigzag Pipes', 'Splitter', 'Bounce Ramp', 'Trampoline Alley', 'Tunnel Shortcut', 'Scoop Subway'],
  machines: ['Spinners', 'Beltway', 'Mace Sweep', 'Crusher Alley', 'Blade Gauntlet',
    'Wheel Lift', 'Screw Tower', 'Drawbridge Gap', 'Turnstile Square'],
};

// Layout and feature are independent choices, with affinities rather than mandatory sectors.
const AFFINITY: Record<CourseFeature, Record<CourseLayout, number>> = {
  banking: { sweeper: 4, split: 1, slalom: 2, terraces: 1, arena: 2 },
  peggle: { sweeper: 1, split: 1, slalom: 1, terraces: 2, arena: 4 },
  ice: { sweeper: 3, split: 2, slalom: 3, terraces: 2, arena: 1 },
  boost: { sweeper: 2, split: 5, slalom: 3, terraces: 2, arena: 1 },
  machines: { sweeper: 1, split: 2, slalom: 3, terraces: 2, arena: 3 },
};

function weight(value: number | undefined): number {
  if (value === undefined) return 1;
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

function pick<T extends string>(rng: () => number, choices: readonly T[], weights: readonly number[]): T {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total === 0) return choices[0];
  let draw = rng() * total;
  let last = choices[0];
  for (let i = 0; i < choices.length; i++) {
    if (weights[i] === 0) continue;
    last = choices[i];
    if (draw < weights[i]) return choices[i];
    draw -= weights[i];
  }
  return last;
}

/** Plan locally: neither the builder's RNG nor pickup/art draws can change the route. */
export function planCourse(seed: number, profile: TrackProfile): CourseChapter[] {
  const rng = mulberry32((seed ^ 0x43525345) >>> 0);
  const theme = themeIdFor(profile.theme);
  const bias: Partial<Record<CourseFeature, number>> = theme === 'silver'
    ? { peggle: 3, banking: 2 }
    : theme === 'classic' || theme === 'default' ? { peggle: 2, banking: 2 }
      : theme === 'forest' ? { ice: 3, boost: 2 }
        : theme === 'dwarven' ? { machines: 3 }
          : theme === 'worg' ? { machines: 2, boost: 1.5 }
            : theme === 'street' ? { banking: 2, machines: 1.5 } : {};
  const segments = Number.isFinite(profile.segments) ? profile.segments : 30;
  const count = Math.max(8, Math.min(14, Math.round(segments / CIRCUIT_LENGTH_MULTIPLIER)));
  const featureWeights = COURSE_FEATURES.map(feature => {
    const keys = WEIGHTS[feature];
    const configured = profile.weights[feature];
    const multiplier = configured === undefined
      ? keys.reduce((sum, key) => sum + weight(profile.weights[key]), 0) / keys.length
      : weight(configured);
    return multiplier * (bias[feature] ?? 1);
  });
  const plan: CourseChapter[] = [];
  for (let i = 0; i < count; i++) {
    const previous = plan[i - 1];
    const feature = pick(rng, COURSE_FEATURES, featureWeights.map((w, index) =>
      w * (previous?.feature === COURSE_FEATURES[index] ? 0.5 : 1)));
    const layoutWeights = COURSE_LAYOUTS.map(layout =>
      weight(profile.weights[layout]) * AFFINITY[feature][layout]);
    // A single enabled layout still terminates; zero weights are not resurrected to fill a quota.
    if (COURSE_LAYOUTS.some((layout, index) => layout !== previous?.layout && layoutWeights[index] > 0)) {
      const repeated = COURSE_LAYOUTS.findIndex(layout => layout === previous?.layout);
      if (repeated >= 0) layoutWeights[repeated] = 0;
    }
    plan.push({
      layout: pick(rng, COURSE_LAYOUTS, layoutWeights),
      feature,
      mirror: ((seed & 1) ^ (i & 1)) === 1,
      variant: Math.floor(rng() * 3),
    });
  }
  return plan;
}
