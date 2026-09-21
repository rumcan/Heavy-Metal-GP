import { mulberry32, themeIdFor } from './types';
import type { TrackProfile } from './types';

export type CourseFeature = 'mass' | 'rebound' | 'burrow' | 'sprint' | 'peggle' | 'crane' | 'lift';
export interface CourseChapter {
  feature: CourseFeature;
  mirror: boolean;
  variant: number;
  /** A separate seed keeps decoration/Builder RNG from changing course topology. */
  seed: number;
}

/** Choose the experience first. Geometry is built afterwards against a shared entry/exit contract. */
export function planCourse(seed: number, profile: TrackProfile): CourseChapter[] {
  const rng = mulberry32((seed ^ 0x43525345) >>> 0);
  const theme = themeIdFor(profile.theme);
  const signature: CourseFeature = theme === 'silver' ? 'peggle'
    : theme === 'forest' ? 'sprint' : theme === 'street' ? 'burrow'
      : theme === 'dwarven' ? 'mass' : theme === 'worg' ? 'crane' : 'rebound';
  const count = Math.max(8, Math.min(14, Math.round(profile.segments / 3)));
  // Each act has a different job. A calm run-up always precedes the first machinery.
  const opening: CourseFeature[] = ['mass', 'rebound', 'sprint'];
  const required: CourseFeature[] = ['mass', 'rebound', 'burrow', 'peggle', 'crane', 'lift', signature];
  const pool: CourseFeature[] = ['mass', 'rebound', 'burrow', 'sprint', 'peggle', 'crane', 'lift', signature];
  const features: CourseFeature[] = [opening[Math.floor(rng() * opening.length)]];
  const already = required.indexOf(features[0]);
  if (already >= 0) required.splice(already, 1);
  while (features.length < count) {
    const remaining = required.filter(f => f !== features.at(-1));
    const candidates = remaining.length ? remaining : pool.filter(f => f !== features.at(-1));
    const next = candidates[Math.floor(rng() * candidates.length)];
    const index = required.indexOf(next);
    if (index >= 0) required.splice(index, 1);
    features.push(next);
  }
  return features.map((feature, i) => ({ feature, mirror: (seed & 1) === 1,
    variant: Math.floor(rng() * 3), seed: (seed + i * 0x9e3779b9) >>> 0 }));
}
