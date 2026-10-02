// P2-16 (#122): the computer driver's decisions on platformer courses. Pure: the engine builds a Sense each step
// and applies the returned controls. Randomness only through s.rng (the race rng on the host).
export const SAMPLE_STEP = 20;
export const DIFFICULTY = {
  easy: { speedCap: 7, reactPx: 20, mistakeChance: 0.15, skillDelayMs: 2500 },
  normal: { speedCap: 8.5, reactPx: 34, mistakeChance: 0.05, skillDelayMs: 1200 },
  hard: { speedCap: 10, reactPx: 48, mistakeChance: 0, skillDelayMs: 400 },
};
export type Difficulty = keyof typeof DIFFICULTY;
export type AiHint = 'ahead-rival' | 'behind' | 'danger' | 'wall' | 'low-hp' | 'gap';
export interface Sense {
  time: number; difficulty: Difficulty; grounded: boolean; vx: number; ahead: (number | null)[]; crateAt: number | null; wallAt: number | null; dangerAt: number | null;
  heat: number; overheated: boolean; hp: number; rivalAhead: { dx: number; dy: number } | null; rivalBehind: { dx: number } | null;
  slots: { charges: number; hint: AiHint }[]; lastSkillAt: number; door: { dist: number; better: boolean } | null; ramp: { dist: number; better: boolean } | null; rng: () => number;
}
export function decide(s: Sense) {
  const d = DIFFICULTY[s.difficulty];
  const nudge = s.vx < d.speedCap ? 1 : 0;
  const reach = (k: number) => d.reactPx + k * s.vx;
  const gapWithin = (px: number) => s.ahead.some((h, i) => h === null && (i + 1) * SAMPLE_STEP <= px);
  let stepUp = false;
  let prev = 0;
  for (let i = 0; i < s.ahead.length && (i + 1) * SAMPLE_STEP <= reach(7); i++) { const h = s.ahead[i]; if (h === null) { prev = 0; continue; } if (h - prev <= -12) stepUp = true; prev = h; }
  let jump = false;
  if (s.grounded) {
    const want = gapWithin(reach(7)) || (s.crateAt !== null && s.crateAt <= reach(5)) || stepUp;
    if (want && s.rng() >= d.mistakeChance) jump = true;
    if (s.ramp && !s.ramp.better && s.ramp.dist <= 40) jump = true;
  }
  const last = s.ahead[s.ahead.length - 1];
  const engine = s.grounded && !s.overheated && s.heat < 0.7 && s.vx < d.speedCap - 1 && !(last !== null && last > 40);
  const fits = (h: AiHint) => h === 'ahead-rival' ? !!s.rivalAhead && s.rivalAhead.dx > 0 && s.rivalAhead.dx <= 300
    : h === 'behind' ? !!s.rivalBehind && s.rivalBehind.dx <= 200
    : h === 'danger' ? s.dangerAt !== null && s.dangerAt <= 200
    : h === 'wall' ? s.wallAt !== null && s.wallAt <= 150
    : h === 'low-hp' ? s.hp < 40
    : gapWithin(200);
  let slot: number | null = null;
  if (s.time - s.lastSkillAt >= d.skillDelayMs) {
    const lowHp = s.slots.findIndex((x) => x.charges > 0 && x.hint === 'low-hp' && fits('low-hp'));
    slot = lowHp >= 0 ? lowHp : null;
    if (slot === null) { const i = s.slots.findIndex((x) => x.charges > 0 && fits(x.hint)); slot = i >= 0 ? i : null; }
  }
  const takeDoor = !!s.door && s.door.dist <= 20 && s.door.better;
  return { nudge, jump, engine, slot, takeDoor };
}
