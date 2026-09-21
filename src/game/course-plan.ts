import { mulberry32, themeIdFor } from './types';
import type { TrackProfile } from './types';

export type CourseFeature = 'mass' | 'rebound' | 'burrow' | 'sprint' | 'peggle' | 'crane' | 'lift';
export interface CourseChapter {
  feature: CourseFeature;
  mirror: boolean;
  variant: number;
}

const WEIGHTS: Record<CourseFeature, string[]> = {
  mass: ['Crack Wall Shortcut', 'Crumbling Wall', 'Trapdoor Drop'],
  rebound: ['Bounce Ramp', 'Trampoline Alley', 'Flipper Alley'],
  burrow: ['Tunnel Shortcut', 'Scoop Subway'],
  sprint: ['Ice Slide', 'Beltway', 'Zigzag Pipes'],
  peggle: ['Peggle Board', 'Peg Field'],
  crane: ['Chicane', 'Crusher Alley', 'Mace Sweep', 'Blade Gauntlet'],
  lift: ['Wheel Lift', 'Screw Tower', 'Drawbridge Gap'],
};

/** Choose the experience first. Geometry is built afterwards against a shared entry/exit contract. */
export function planCourse(seed: number, profile: TrackProfile): CourseChapter[] {
  const rng = mulberry32((seed ^ 0x43525345) >>> 0);
  const theme = themeIdFor(profile.theme);
  const signature: CourseFeature = theme === 'silver' ? 'peggle'
    : theme === 'forest' ? 'sprint' : theme === 'street' ? 'burrow'
      : theme === 'dwarven' ? 'mass' : theme === 'worg' ? 'crane' : 'rebound';
  const count = Math.max(8, Math.min(14, Math.round(profile.segments / 3)));
  // Opening, varied middle, then the builder's clean home straight. No RNG from art or pickups here.
  const opening: CourseFeature[] = ['mass', 'rebound', 'sprint'];
  const required: CourseFeature[] = ['mass', 'rebound', 'burrow', 'peggle', 'crane', 'lift', signature];
  const pool: CourseFeature[] = ['mass', 'rebound', 'burrow', 'sprint', 'peggle', 'crane', 'lift', signature];
  const features: CourseFeature[] = [opening[Math.floor(rng() * opening.length)]];
  const already = required.indexOf(features[0]);
  if (already >= 0) required.splice(already, 1);
  while (features.length < count) {
    const remaining = required.filter(f => f !== features.at(-1));
    let candidates = remaining.length ? remaining : pool.filter(f => f !== features.at(-1));
    if (['crane', 'lift'].includes(features.at(-1)!)) {
      const calmer = candidates.filter(f => f !== 'crane' && f !== 'lift');
      if (calmer.length) candidates = calmer;
    }
    const weights = candidates.map(f => (f === signature ? 2 : 1) * Math.max(0.1,
      WEIGHTS[f].reduce((sum, key) => sum + Math.max(0, Math.min(5, profile.weights[key] ?? 1)), 0) / WEIGHTS[f].length));
    let draw = rng() * weights.reduce((a, b) => a + b, 0);
    const next = candidates.find((_, i) => (draw -= weights[i]) <= 0) ?? candidates[candidates.length - 1];
    const index = required.indexOf(next);
    if (index >= 0) required.splice(index, 1);
    features.push(next);
  }
  return features.map(feature => ({ feature, mirror: (seed & 1) === 1, variant: Math.floor(rng() * 3) }));
}
