import { mulberry32, themeIdFor } from './types';
import type { TrackProfile } from './types';

export type CourseFeature = 'mass' | 'rebound' | 'burrow' | 'sprint' | 'peggle' | 'crane';
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
  const count = Math.max(6, Math.min(14, Math.round(profile.segments / 3)));
  // Each act has a different job. A calm run-up always precedes the first machinery.
  const opening: CourseFeature[] = ['mass', 'rebound', 'sprint'];
  const required: CourseFeature[] = ['burrow', 'peggle', 'crane', signature];
  const pool: CourseFeature[] = ['mass', 'rebound', 'burrow', 'sprint', 'peggle', 'crane', signature];
  const features: CourseFeature[] = [opening[Math.floor(rng() * opening.length)]];
  while (features.length < count) {
    const next = required.length ? required.splice(Math.floor(rng() * required.length), 1)[0]
      : pool[Math.floor(rng() * pool.length)];
    if (next === features.at(-1)) { required.push(next); continue; }
    features.push(next);
  }
  return features.map((feature, i) => ({ feature, mirror: false,
    variant: Math.floor(rng() * 3), seed: (seed + i * 0x9e3779b9) >>> 0 }));
}
