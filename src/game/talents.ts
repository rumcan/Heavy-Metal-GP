// P2-17 (#125): talent trees, like Gunfire Reborn. Each driver level gives a talent point; points buy ranks in
// five trees. A tier opens at a driver level AND after enough points in the lower tiers of the same tree.
// Pure: no imports. The engine and economy read talentEffects() at their hook points.

export const TREES = ['engine', 'chassis', 'arsenal', 'tactics', 'fortune'] as const;
export type Tree = typeof TREES[number];
export const RESPEC_PRICE = 500;

export interface TalentDef { id: string; tree: Tree; tier: number; maxRank: number; stat: string; perRank: number; name: string; desc: string }
export type Build = Record<string, number>;

const t = (id: string, tree: Tree, tier: number, maxRank: number, stat: string, perRank: number, name: string, desc: string): TalentDef =>
  ({ id, tree, tier, maxRank, stat, perRank, name, desc });

export const TALENTS: TalentDef[] = [
  t('heat-sink', 'engine', 1, 3, 'engineHeatPct', 10, 'Heat Sink', 'The Magic Engine holds 10 % more heat per rank.'),
  t('coolant', 'engine', 1, 3, 'engineCoolPct', 10, 'Coolant', 'The engine cools 10 % faster per rank.'),
  t('turbo', 'engine', 2, 3, 'thrustPct', 5, 'Turbo', 'Engine thrust +5 % per rank.'),
  t('streamline', 'engine', 2, 3, 'topSpeedPct', 2, 'Streamline', 'Top speed +2 % per rank.'),
  t('big-tank', 'engine', 3, 2, 'engineHeatPct', 10, 'Big Tank', 'Another 10 % heat capacity per rank.'),
  t('nitro', 'engine', 3, 2, 'thrustPct', 5, 'Nitro', 'Another 5 % engine thrust per rank.'),
  t('afterburner', 'engine', 4, 1, 'overheatLockPct', -50, 'Afterburner', 'An overheat locks the engine for half as long.'),
  t('plating', 'chassis', 1, 3, 'maxHp', 10, 'Plating', 'Max HP +10 per rank.'),
  t('patch-up', 'chassis', 1, 3, 'regenDelayMs', -1000, 'Patch-up', 'Health starts coming back 1 s sooner per rank.'),
  t('padding', 'chassis', 2, 3, 'damageTakenPct', -4, 'Padding', 'Take 4 % less damage per rank.'),
  t('mender', 'chassis', 2, 3, 'regenPct', 10, 'Mender', 'Health comes back 10 % faster per rank.'),
  t('bulwark', 'chassis', 3, 2, 'maxHp', 10, 'Bulwark', 'Another 10 max HP per rank.'),
  t('thick-skin', 'chassis', 3, 2, 'damageTakenPct', -4, 'Thick Skin', 'Another 4 % less damage per rank.'),
  t('iron-belly', 'chassis', 4, 1, 'ironBelly', 1, 'Iron Belly', 'Your first hazard hit each race does no damage.'),
  t('sharpened', 'arsenal', 1, 3, 'offenceDamagePct', 6, 'Sharpened', 'Offence skills do 6 % more damage per rank.'),
  t('quick-fuse', 'arsenal', 1, 3, 'projectileSpeedPct', 10, 'Quick Fuse', 'Bolts and bombs fly 10 % faster per rank.'),
  t('stockpile', 'arsenal', 2, 1, 'firstOffenceCharge', 1, 'Stockpile', 'One extra charge in your first offence slot.'),
  t('heavy-hitter', 'arsenal', 2, 3, 'offenceDamagePct', 6, 'Heavy Hitter', 'Another 6 % offence damage per rank.'),
  t('long-range', 'arsenal', 3, 2, 'projectileSpeedPct', 10, 'Long Range', 'Another 10 % projectile speed per rank.'),
  t('demolition', 'arsenal', 3, 2, 'offenceDamagePct', 6, 'Demolition', 'Another 6 % offence damage per rank.'),
  t('bounty-hunter', 'arsenal', 4, 1, 'koBountyPct', 50, 'Bounty Hunter', 'Knock-out bounties pay 50 % more.'),
  t('lingering', 'tactics', 1, 3, 'skillDurationPct', 8, 'Lingering', 'Skills last 8 % longer per rank.'),
  t('nimble', 'tactics', 1, 3, 'skillCooldownPct', -10, 'Nimble', 'Skill cooldowns 10 % shorter per rank.'),
  t('organised', 'tactics', 2, 1, 'boxFavourLoadout', 1, 'Organised', 'Item boxes favour the skills in your loadout.'),
  t('extended', 'tactics', 2, 3, 'skillDurationPct', 8, 'Extended', 'Another 8 % skill duration per rank.'),
  t('rapid', 'tactics', 3, 2, 'skillCooldownPct', -10, 'Rapid', 'Another 10 % shorter cooldowns per rank.'),
  t('focus', 'tactics', 3, 2, 'skillDurationPct', 8, 'Focus', 'Another 8 % skill duration per rank.'),
  t('quick-hands', 'tactics', 4, 1, 'refundChancePct', 15, 'Quick Hands', 'A used skill has a 15 % chance to keep its charge.'),
  t('sponsor', 'fortune', 1, 3, 'prizePct', 5, 'Sponsor', 'Race prizes +5 % per rank.'),
  t('peg-hunter', 'fortune', 1, 3, 'pegBonusPct', 10, 'Peg Hunter', 'Peg bonuses +10 % per rank.'),
  t('haggler', 'fortune', 2, 3, 'shamanFeePct', -10, 'Haggler', 'The Shaman charges 10 % less per rank.'),
  t('big-sponsor', 'fortune', 2, 3, 'prizePct', 5, 'Big Sponsor', 'Another 5 % race prize per rank.'),
  t('collector', 'fortune', 3, 2, 'pegBonusPct', 10, 'Collector', 'Another 10 % peg bonus per rank.'),
  t('thrifty', 'fortune', 3, 2, 'shamanFeePct', -10, 'Thrifty', 'Another 10 % off the Shaman fee per rank.'),
  t('lucky-goblin', 'fortune', 4, 1, 'xpPct', 15, 'Lucky Goblin', 'Earn 15 % more XP from every race.'),
];

export const STAT_KEYS: readonly string[] = [...new Set(TALENTS.map((d) => d.stat))];
const BY_ID = new Map(TALENTS.map((d) => [d.id, d]));

export function talentDef(id: string): TalentDef | null { return BY_ID.get(id) ?? null; }
export function tierLevel(tier: number): number { return 5 * (tier - 1) + 1; }
export function tierPointsNeeded(tier: number): number { return 3 * (tier - 1); }
export function pointsSpent(b: Build): number { return Object.values(b).reduce((a, v) => a + v, 0); }

export function pointsInTree(b: Build, tree: string, belowTier = Infinity): number {
  return TALENTS.filter((d) => d.tree === tree && d.tier < belowTier).reduce((a, d) => a + (b[d.id] ?? 0), 0);
}

function tierOpen(b: Build, d: TalentDef, level: number): boolean {
  return level >= tierLevel(d.tier) && pointsInTree(b, d.tree, d.tier) >= tierPointsNeeded(d.tier);
}

export function canRankUp(b: Build, id: string, level: number, points: number): boolean {
  const d = talentDef(id);
  return !!d && (b[id] ?? 0) < d.maxRank && pointsSpent(b) < points && tierOpen(b, d, level);
}

export function rankUp(b: Build, id: string, level: number, points: number): Build | null {
  return canRankUp(b, id, level, points) ? { ...b, [id]: (b[id] ?? 0) + 1 } : null;
}

/** Anything (a save, the wire) becomes a legal build for this level and point total. */
export function validateBuild(raw: unknown, level: number, points: number): Build {
  const b: Build = {};
  if (!raw || typeof raw !== 'object') return b;
  for (const d of TALENTS) {
    const v = (raw as Record<string, unknown>)[d.id];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const rank = Math.min(d.maxRank, Math.floor(v));
    if (rank >= 1) b[d.id] = rank;
  }
  const byTier = [...TALENTS].sort((a, c) => a.tier - c.tier);
  const enforceTiers = () => { for (const d of byTier) if (b[d.id] && !tierOpen(b, d, level)) delete b[d.id]; };
  enforceTiers();
  // over budget: drop whole talents from the highest tier down (the last in table order first)
  const dropOrder = TALENTS.map((d, i) => ({ d, i })).sort((a, c) => c.d.tier - a.d.tier || c.i - a.i);
  for (const { d } of dropOrder) { if (pointsSpent(b) <= points) break; delete b[d.id]; }
  enforceTiers();
  return b;
}

export function talentEffects(b: Build): Record<string, number> {
  const fx: Record<string, number> = Object.fromEntries(STAT_KEYS.map((k) => [k, 0]));
  for (const d of TALENTS) fx[d.stat] += (b[d.id] ?? 0) * d.perRank;
  return fx;
}

export function respecCost(respecsUsed: number): number { return respecsUsed <= 0 ? 0 : RESPEC_PRICE; }
