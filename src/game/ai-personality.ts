// P2-16b (#122): each rival drives like themselves. A personality is three numbers:
//   skill 1..5       how sharp the driver is: reaction distance, jump timing mistakes, top steering speed, how soon it
//                    fires a skill again (never extra forces: the same steer, jump and engine rules as a person)
//   aggression 0..1  how keen on offence skills (ram, rockets, bombs...) and how far ahead it looks for a target
//   caution 0..1     how early it jumps a chasm or crate, and whether it takes lane gates into the risky outer lanes
// Pure data and arithmetic: the engine reads it in engine/platformer.ts and the brain (ai-brain.ts) decides with it.
// The order is RIVALS' order in characters.ts (kept separate: that module loads the portrait art).

export interface Personality { skill: number; aggression: number; caution: number }

/**
 *                    skill  aggr  caution
 * Ace Spadegrin        5    0.55   0.55   fast and precise, a cheat when it pays
 * Duchess Vex          4    0.45   0.80   cautious and haughty: never the risky line
 * Big Grubba           2    0.90   0.15   aggressive and clumsy
 * Knuckles Blau        2    1.00   0.10   punches first, steers never
 * Scorch               3    0.85   0.25   sets fire to everything
 * Rivet Rex            3    0.80   0.20   doesn't brake
 * Lucky Thirteen       2    0.35   0.60   never lucky
 * Red Morrigan         4    0.60   0.45   pretty and fast
 * Violetta Voltz       4    0.70   0.40   hot-wired
 * Old Smokey           4    0.25   0.85   old and canny
 * Barrelbeard          3    0.50   0.50   steady
 * Zapp Gutwrench       3    0.65   0.35   tinkers with everyone's bolts
 * The Hood             5    0.75   0.60   the final boss
 * Jinx                 3    0.70   0.40   bad luck on purpose
 * Skullcap Morg        4    0.85   0.30   collects helmets
 * Grimbolt             3    0.55   0.55   pays no tolls
 */
export const PERSONALITIES: readonly Personality[] = [
  { skill: 5, aggression: 0.55, caution: 0.55 },
  { skill: 4, aggression: 0.45, caution: 0.8 },
  { skill: 2, aggression: 0.9, caution: 0.15 },
  { skill: 2, aggression: 1, caution: 0.1 },
  { skill: 3, aggression: 0.85, caution: 0.25 },
  { skill: 3, aggression: 0.8, caution: 0.2 },
  { skill: 2, aggression: 0.35, caution: 0.6 },
  { skill: 4, aggression: 0.6, caution: 0.45 },
  { skill: 4, aggression: 0.7, caution: 0.4 },
  { skill: 4, aggression: 0.25, caution: 0.85 },
  { skill: 3, aggression: 0.5, caution: 0.5 },
  { skill: 3, aggression: 0.65, caution: 0.35 },
  { skill: 5, aggression: 0.75, caution: 0.6 },
  { skill: 3, aggression: 0.7, caution: 0.4 },
  { skill: 4, aggression: 0.85, caution: 0.3 },
  { skill: 3, aggression: 0.55, caution: 0.55 },
];

/** A race's difficulty: shifts every rival's skill down or up by one (clamped to 1..5). */
export type RaceDifficulty = 'easy' | 'normal' | 'hard';
const SHIFT: Record<RaceDifficulty, number> = { easy: -1, normal: 0, hard: 1 };

/** The rival character a computer marble is (the same rule as characters.ts characterOf). */
export function rivalIndexOf(info: { id: number; character?: number }): number {
  const n = PERSONALITIES.length;
  return (((info.character ?? info.id - 1) % n) + n) % n;
}

export function personalityOf(info: { id: number; character?: number }, difficulty: RaceDifficulty = 'normal'): Personality {
  const p = PERSONALITIES[rivalIndexOf(info)];
  return { ...p, skill: Math.max(1, Math.min(5, p.skill + SHIFT[difficulty])) };
}

/** The brain's numbers for a personality (skill 1 matches the old 'easy', 3 is between 'normal' and 'hard', 5 is 'hard'). */
export function tuningOf(p: Personality): { speedCap: number; reactPx: number; mistakeChance: number; skillDelayMs: number } {
  const k = (p.skill - 1) / 4;
  return {
    speedCap: 7 + 3 * k,
    reactPx: 20 + 28 * k,
    mistakeChance: 0.15 * (1 - k),
    // an aggressive driver fires again sooner, a gentle one waits
    skillDelayMs: (2500 - 2100 * k) * (1.35 - 0.7 * p.aggression),
  };
}
