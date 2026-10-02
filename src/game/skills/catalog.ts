// Heavy Metal GP — the 24-skill catalogue (job ALPHA, P2-08 #114).
// Single source of truth for skill data plus a few pure lookups.
// No imports from other project files: this module is standalone.

export const SKILL_IDS = [
  'rocket', 'jump', 'shield', 'oil', 'ram', 'repair', 'shock', 'anvil',
  'brake', 'freeze', 'aero', 'bolt', 'ghost', 'overdrive', 'spikes', 'decoy',
  'grapple', 'bomb', 'reflect', 'blink', 'emp', 'lightning', 'drill', 'charm',
] as const;

export type SkillId = typeof SKILL_IDS[number];
export type SkillGroup = 'movement' | 'offence' | 'defence' | 'utility';
export type AiHint = 'ahead-rival' | 'behind' | 'danger' | 'wall' | 'low-hp' | 'gap';

export interface SkillDef {
  id: SkillId;
  name: string;
  short: string;
  group: SkillGroup;
  unlockLevel: number;
  price: number;
  durationMs: number;
  color: string;
  desc: string;
  aiHint: AiHint;
  legacy: boolean;
}

export const STARTER_SKILLS = ['rocket', 'jump', 'shield'] as const;

// Ids that old save files may hold; SkillDef.legacy is true exactly for these.
export const LEGACY_SKILLS = ['rocket', 'jump', 'oil', 'shock', 'anvil', 'aero', 'freeze', 'ghost'] as const;

export const GROUP_COLORS: Record<SkillGroup, string> = {
  movement: '#38bdf8',
  offence: '#ef4444',
  defence: '#22c55e',
  utility: '#f59e0b',
};

function def(
  id: SkillId, name: string, short: string, group: SkillGroup,
  unlockLevel: number, price: number, durationMs: number,
  color: string, aiHint: AiHint, desc: string,
): SkillDef {
  return {
    id, name, short, group, unlockLevel, price, durationMs, color, desc, aiHint,
    legacy: (LEGACY_SKILLS as readonly string[]).includes(id),
  };
}

export const SKILLS: Record<SkillId, SkillDef> = {
  rocket: def('rocket', 'Speed Boost', 'BOOST', 'movement', 1, 90, 3000, '#d63e2e', 'gap',
    'Gain +8 top speed and thrust for 3 seconds.'),
  jump: def('jump', 'Super Jump', 'JUMP', 'movement', 1, 65, 1000, '#b6a0ff', 'gap',
    'Leap about twice the height of your normal jump.'),
  shield: def('shield', 'Bubble Shield', 'SHIELD', 'defence', 1, 80, 4000, '#60a5fa', 'danger',
    'A bubble that absorbs the next 40 damage or lasts 4 seconds.'),
  oil: def('oil', 'Oil Slick', 'OIL', 'offence', 2, 55, 9000, '#c084fc', 'behind',
    'Lay a slippery oil trail behind you for 9 seconds.'),
  ram: def('ram', 'Battering Ram', 'RAM', 'utility', 3, 95, 2500, '#b45309', 'wall',
    'A 2.5 second charge that smashes breakable walls and barricades.'),
  repair: def('repair', 'Repair Kit', 'REPAIR', 'defence', 4, 70, 0, '#4ade80', 'low-hp',
    'Instantly heal 40 HP to patch up your marble.'),
  shock: def('shock', 'Shockwave', 'SHOCK', 'offence', 5, 100, 0, '#facc15', 'ahead-rival',
    'Blast nearby rivals away with a sudden shockwave.'),
  anvil: def('anvil', 'Heavy Metal', 'MASS', 'defence', 6, 80, 5000, '#c5d1e1', 'danger',
    'Triple your mass for 5 seconds to shrug off hits.'),
  brake: def('brake', 'Air Brake', 'BRAKE', 'movement', 7, 60, 1000, '#94a3b8', 'gap',
    'Kill most of your speed and hover in place for 1 second.'),
  freeze: def('freeze', 'Freeze Ray', 'FREEZE', 'offence', 8, 110, 2500, '#7dd3fc', 'ahead-rival',
    'Freeze the nearest rival ahead solid for 2.5 seconds.'),
  aero: def('aero', 'Slipstream', 'AERO', 'movement', 9, 75, 6000, '#5eead4', 'gap',
    'Cut your drag by 95 percent for 6 seconds.'),
  bolt: def('bolt', 'Homing Bolt', 'BOLT', 'offence', 10, 105, 0, '#f97316', 'ahead-rival',
    'Fire a bolt that seeks the nearest rival ahead for 25 damage.'),
  ghost: def('ghost', 'Ghost Mode', 'GHOST', 'defence', 11, 85, 3000, '#e2e8f0', 'danger',
    'Pass through hazards and other marbles for 3 seconds.'),
  overdrive: def('overdrive', 'Overdrive', 'OVERDRIVE', 'movement', 12, 90, 5000, '#ef4444', 'gap',
    'The Magic Engine never overheats for 5 seconds and pushes harder.'),
  spikes: def('spikes', 'Caltrops', 'SPIKES', 'offence', 13, 70, 6000, '#a8a29e', 'behind',
    'Scatter sharp spikes behind you for 6 seconds.'),
  decoy: def('decoy', 'Decoy', 'DECOY', 'defence', 14, 65, 5000, '#fbbf24', 'danger',
    'Drop a fake marble that homing skills chase for 5 seconds.'),
  grapple: def('grapple', 'Grapple Hook', 'GRAPPLE', 'movement', 15, 85, 0, '#a16207', 'gap',
    'Fire a hook that yanks you to the nearest ledge ahead.'),
  bomb: def('bomb', 'Sticky Bomb', 'BOMB', 'offence', 16, 115, 2000, '#dc2626', 'ahead-rival',
    'Stick a bomb to a rival that explodes after 2 seconds for 35 damage.'),
  reflect: def('reflect', 'Mirror Plate', 'MIRROR', 'defence', 17, 95, 3000, '#e0f2fe', 'danger',
    'Bounce freeze rays, bolts and bombs back at the attacker for 3 seconds.'),
  blink: def('blink', 'Blink', 'BLINK', 'movement', 18, 100, 0, '#a78bfa', 'gap',
    'Teleport 140 pixels forward if the spot is clear.'),
  emp: def('emp', 'EMP', 'EMP', 'offence', 19, 120, 4000, '#38bdf8', 'ahead-rival',
    'Nearby rivals cannot use their skills for 4 seconds.'),
  lightning: def('lightning', 'Lightning Strike', 'STRIKE', 'offence', 20, 130, 1000, '#fde047', 'ahead-rival',
    'Strike the race leader for 30 damage and a 1 second stun.'),
  drill: def('drill', 'Drill', 'DRILL', 'utility', 22, 110, 1000, '#78716c', 'wall',
    'Drill straight down through the next floor below you.'),
  charm: def('charm', "Shaman's Charm", 'CHARM', 'defence', 25, 150, 8000, '#34d399', 'low-hp',
    'The next killing hit leaves you on 1 HP instead, for 8 seconds.'),
};

/** A known skill id gives its def; anything else (including prototype keys) gives null. */
export function skillDef(id: string): SkillDef | null {
  return Object.prototype.hasOwnProperty.call(SKILLS, id) ? SKILLS[id as SkillId] : null;
}

/** All skills in a group, in catalogue order. */
export function skillsInGroup(group: SkillGroup): SkillDef[] {
  return SKILL_IDS.map((id) => SKILLS[id]).filter((d) => d.group === group);
}

/** Every skill unlocked at or below the level, in catalogue order. */
export function unlockedSkills(level: number): SkillId[] {
  return SKILL_IDS.filter((id) => SKILLS[id].unlockLevel <= level);
}

/** Skills unlocked when moving from one level to another (from exclusive, to inclusive). */
export function newUnlocks(fromLevel: number, toLevel: number): SkillId[] {
  return SKILL_IDS.filter((id) => {
    const l = SKILLS[id].unlockLevel;
    return fromLevel < l && l <= toLevel;
  });
}

/** The next skill to unlock above this level, or null when all are unlocked. */
export function nextUnlock(level: number): { id: SkillId; level: number } | null {
  for (const id of SKILL_IDS) {
    if (SKILLS[id].unlockLevel > level) return { id, level: SKILLS[id].unlockLevel };
  }
  return null;
}

/** Starters are always allowed online; anything else needs the campaign finished AND the level. */
export function allowedOnline(id: string, level: number, campaignComplete: boolean): boolean {
  const d = skillDef(id);
  if (!d) return false;
  if ((STARTER_SKILLS as readonly string[]).includes(d.id)) return true;
  return campaignComplete && d.unlockLevel <= level;
}

/** Keep known ids only, first occurrence wins, at most `max`; anything that is not an array gives []. */
export function sanitizeSkillList(raw: unknown, max = 8): SkillId[] {
  if (!Array.isArray(raw)) return [];
  const out: SkillId[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= max) break;
    if (typeof item !== 'string' || seen.has(item)) continue;
    const d = skillDef(item);
    if (!d) continue;
    seen.add(item);
    out.push(d.id);
  }
  return out;
}
