// P2-25: how an Infinity run looks as it goes on. Pure functions of the distance rolled and the seed: the biome you are
// in (and the slow blend into the next), the time of day, the colour grade the painter lays over the world, and the
// particle budget. Nothing here draws; `src/components/infinity/InfinityPainter.ts` does, from these numbers.

export type Particle = 'motes' | 'petals' | 'leaves' | 'mist' | 'snow' | 'fireflies' | 'drops';

export interface Biome {
  id: string;
  name: string;
  /** The colour grade laid over the world: a tint (multiplied in) and a glow (screen-added), as [r, g, b] 0..255. */
  tint: [number, number, number];
  glow: [number, number, number];
  /** How much of the tint and glow apply (0..1). */
  tintAmount: number;
  glowAmount: number;
  /** Ground haze that thickens toward the bottom of the screen (0..1). */
  haze: number;
  /** What drifts through the air, and how much of it. */
  particle: Particle;
  density: number;
  /** The musical colour of the place: a scale (semitones from the root) and the root note (MIDI). */
  scale: number[];
  root: number;
}

/** The biomes, in the order a run meets them (the seed picks where in the cycle a run starts). */
export const BIOMES: readonly Biome[] = [
  { id: 'meadow', name: 'Sunrise meadow', tint: [255, 226, 196], glow: [255, 180, 120], tintAmount: 0.18, glowAmount: 0.10, haze: 0.10, particle: 'petals', density: 0.55, scale: [0, 2, 4, 7, 9], root: 60 },
  { id: 'valley', name: 'Green valley', tint: [214, 255, 210], glow: [170, 230, 160], tintAmount: 0.12, glowAmount: 0.06, haze: 0.08, particle: 'motes', density: 0.45, scale: [0, 2, 4, 7, 11], root: 62 },
  { id: 'forest', name: 'Pine forest', tint: [190, 214, 206], glow: [200, 220, 220], tintAmount: 0.24, glowAmount: 0.08, haze: 0.14, particle: 'motes', density: 0.5, scale: [0, 2, 3, 7, 10], root: 57 },
  { id: 'autumn', name: 'Autumn hills', tint: [255, 196, 140], glow: [255, 140, 70], tintAmount: 0.26, glowAmount: 0.12, haze: 0.14, particle: 'leaves', density: 0.6, scale: [0, 3, 5, 7, 10], root: 55 },
  { id: 'lake', name: 'Still lake', tint: [184, 214, 255], glow: [140, 190, 255], tintAmount: 0.20, glowAmount: 0.08, haze: 0.22, particle: 'drops', density: 0.3, scale: [0, 2, 4, 7, 9], root: 64 },
  { id: 'snow', name: 'Snowfields', tint: [226, 238, 255], glow: [240, 248, 255], tintAmount: 0.22, glowAmount: 0.14, haze: 0.30, particle: 'snow', density: 0.8, scale: [0, 2, 5, 7, 9], root: 59 },
  { id: 'night', name: 'Starry night', tint: [96, 110, 190], glow: [120, 255, 200], tintAmount: 0.50, glowAmount: 0.06, haze: 0.18, particle: 'fireflies', density: 0.7, scale: [0, 3, 5, 7, 10], root: 53 },
];

/** How long each biome lasts, and how long the blend into the next takes (km). */
export const BIOME_KM = 2.4;
export const BLEND_KM = 1.2;

/** Where in the cycle a seed starts (so two seeds do not always open in the same meadow at the same moment). */
export const startOffset = (seed: number) => ((seed >>> 0) % BIOMES.length);

const smooth = (t: number) => t * t * (3 - 2 * t);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

export interface BiomeMoment {
  /** The biome you are in, the next one, and how far into the blend toward it (0 = all `from`, 1 = all `to`). */
  from: Biome;
  to: Biome;
  t: number;
  /** The blended look. */
  tint: [number, number, number];
  glow: [number, number, number];
  tintAmount: number;
  glowAmount: number;
  haze: number;
}

/** The biome at `km` on a run of `seed`: the blend starts `BLEND_KM` before a biome ends and eases in and out. */
export function biomeAt(km: number, seed: number): BiomeMoment {
  const k = Math.max(0, km);
  const n = BIOMES.length;
  const index = Math.floor(k / BIOME_KM);
  const into = k - index * BIOME_KM;
  const from = BIOMES[(index + startOffset(seed)) % n];
  const to = BIOMES[(index + 1 + startOffset(seed)) % n];
  const t = into <= BIOME_KM - BLEND_KM ? 0 : smooth((into - (BIOME_KM - BLEND_KM)) / BLEND_KM);
  return {
    from, to, t,
    tint: mix3(from.tint, to.tint, t), glow: mix3(from.glow, to.glow, t),
    tintAmount: mix(from.tintAmount, to.tintAmount, t), glowAmount: mix(from.glowAmount, to.glowAmount, t), haze: mix(from.haze, to.haze, t),
  };
}

/** One full day lasts this many km (a slow drift), plus a little real time when you stand still. */
export const DAY_KM = 9;
export const DAY_MS = 6 * 60 * 1000;

export interface DayMoment {
  /** 0..1 around the day: 0 dawn, 0.25 noon, 0.5 dusk, 0.75 midnight. */
  phase: number;
  /** How dark it is (0 bright day .. 1 deep night) and how warm the low sun is (0..1). */
  dark: number;
  warm: number;
  /** Sun (day) or moon (night) height, -1..1, for the sky painter. */
  sunHeight: number;
  /** How many stars show (0..1). */
  stars: number;
}

/** The time of day from the distance rolled and the time spent (both only ever move forward, so it never jumps). */
export function dayAt(km: number, elapsedMs: number): DayMoment {
  const phase = ((km / DAY_KM + elapsedMs / DAY_MS) % 1 + 1) % 1;
  const sun = Math.sin(phase * Math.PI * 2); // +1 at noon, -1 at midnight
  const dark = smooth(Math.max(0, Math.min(1, (0.15 - sun) / 0.7)));
  const warm = smooth(Math.max(0, 1 - Math.abs(sun) / 0.45)) * (1 - dark * 0.6);
  return { phase, dark, warm, sunHeight: sun, stars: smooth(Math.max(0, Math.min(1, (-sun - 0.05) / 0.4))) };
}

export interface Grade {
  /** Multiply layer: colour and strength. */
  tint: [number, number, number];
  tintAlpha: number;
  /** Screen layer: colour and strength. */
  glow: [number, number, number];
  glowAlpha: number;
  haze: number;
  /** Night darkening (a deep blue multiply) on top. */
  night: number;
}

/** The colour grade for this moment: the biome's tint and glow, warmed at dawn and dusk and deepened at night. */
export function gradeAt(km: number, elapsedMs: number, seed: number): Grade {
  const b = biomeAt(km, seed);
  const d = dayAt(km, elapsedMs);
  const sunset: [number, number, number] = [255, 150, 90];
  return {
    tint: mix3(b.tint, sunset, d.warm * 0.45),
    tintAlpha: Math.min(0.6, b.tintAmount + d.warm * 0.12),
    glow: mix3(b.glow, sunset, d.warm * 0.6),
    glowAlpha: Math.min(0.3, b.glowAmount + d.warm * 0.08) * (1 - d.dark * 0.7),
    haze: b.haze,
    night: d.dark * 0.62,
  };
}

/** The drift particles a biome blend shows: both biomes' kinds while blending, each at its share of the density. */
export function particlesAt(km: number, seed: number): { kind: Particle; share: number }[] {
  const b = biomeAt(km, seed);
  const out = [{ kind: b.from.particle, share: b.from.density * (1 - b.t) }];
  if (b.t > 0) out.push({ kind: b.to.particle, share: b.to.density * b.t });
  return out.filter((p) => p.share > 0.01);
}

/** Most particles on screen: scaled by the screen's area, halved with Reduce motion, and cut when frames run slow. */
export function particleBudget(width: number, height: number, frameMs: number, reduceMotion: boolean): number {
  const area = Math.max(0, width * height) / (1280 * 720);
  let budget = Math.round(140 * Math.min(2, area));
  if (frameMs > 24) budget = Math.round(budget * Math.max(0.2, 24 / frameMs) * 0.6);
  if (reduceMotion) budget = Math.round(budget * 0.25);
  return Math.max(0, Math.min(260, budget));
}
