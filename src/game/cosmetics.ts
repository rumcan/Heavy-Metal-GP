/**
 * Heavy Metal GP — src/game/cosmetics.ts  (job BRAVO, P2-18 / #126)
 *
 * The ball-customisation catalogue: what exists, what it costs to unlock, and
 * how to keep a saved/off-the-wire look legal. Purely cosmetic — nothing here
 * touches physics, health or scoring.
 *
 * Everything is pure data + pure functions. No imports, no state.
 */

/* ------------------------------------------------------------------ *
 * Catalogue
 * ------------------------------------------------------------------ */

/** What the ball is made of. */
export const MATERIALS = [
  'steel',
  'chrome',
  'brass',
  'rust',
  'oak',
  'granite',
  'glass',
  'lava',
  'ice',
  'gold',
] as const;

/** Paint jobs and decals drawn over the material. */
export const PATTERNS = [
  'plain',
  'stripes',
  'band',
  'checker',
  'flames',
  'skull',
  'goblin',
  'number',
  'team',
  'stars',
  'cracks',
  'rivets',
] as const;

/** Particle wake left behind while rolling. */
export const TRAILS = [
  'none',
  'smoke',
  'sparks',
  'fire',
  'ice',
  'rainbow',
  'coins',
  'wisps',
] as const;

/** Burst played when you KO a rival. */
export const KO_BURSTS = ['classic', 'confetti', 'scrap', 'ghost'] as const;

/** Stinger played when you cross the line. */
export const FINISH_FX = ['flag', 'fireworks', 'crown', 'spin'] as const;

/** The 24 house colours. [0] is race red, [1] is charcoal. */
export const PALETTE: readonly string[] = [
  '#d63e2e', // 0  race red
  '#1f2937', // 1  charcoal
  '#f4f1ea', // 2  bone white
  '#ff7a1a', // 3  hazard orange
  '#ffb703', // 4  brass yellow
  '#ffe45e', // 5  highlighter
  '#a3e635', // 6  acid lime
  '#22c55e', // 7  pit green
  '#0f9d76', // 8  jade
  '#14b8a6', // 9  teal
  '#22d3ee', // 10 ice cyan
  '#38bdf8', // 11 sky
  '#2563eb', // 12 race blue
  '#4338ca', // 13 deep indigo
  '#7c3aed', // 14 violet
  '#c026d3', // 15 magenta
  '#ec4899', // 16 bubblegum
  '#fb7185', // 17 rose
  '#9f1239', // 18 oxblood
  '#8b5a2b', // 19 leather brown
  '#c084fc', // 20 orchid
  '#94a3b8', // 21 gunmetal
  '#0b0f14', // 22 midnight
  '#e2e8f0', // 23 silver
];

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export type MaterialId = typeof MATERIALS[number];
export type PatternId = typeof PATTERNS[number];
export type TrailId = typeof TRAILS[number];
export type KoBurstId = typeof KO_BURSTS[number];
export type FinishFxId = typeof FINISH_FX[number];

export type Category = 'material' | 'pattern' | 'trail' | 'koBurst' | 'finishFx';

/** Device-cache key for the one global ball look (shared by every race mode). */
export const COSMETICS_STORAGE_KEY = 'heavy-metal-gp:cosmetics:v1';

export type AchievementId = 'first-win' | 'ten-kos' | 'campaign' | 'pegs-50';

/** How a cosmetic becomes available: free, by level, bought with CR, or earned. */
export type Unlock =
  | { kind: 'free' }
  | { kind: 'level'; level: number }
  | { kind: 'credits'; price: number }
  | { kind: 'achievement'; id: AchievementId };

/** A fully specified ball appearance. */
export interface BallLook {
  material: string;
  primary: string;
  secondary: string;
  pattern: string;
  number: number;
  trail: string;
  koBurst: string;
  finishFx: string;
}

/** What a player has: their level, paid-for ids ('material:oak') and trophies. */
export interface Progress {
  level: number;
  owned: string[];
  achievements: AchievementId[];
}

/** The look every player starts with — all free choices. */
export const DEFAULT_LOOK: BallLook = {
  material: 'steel',
  primary: PALETTE[0],
  secondary: PALETTE[1],
  pattern: 'plain',
  number: 7,
  trail: 'none',
  koBurst: 'classic',
  finishFx: 'flag',
};

/** Versioned, deliberately small save: ownership and progression live with the wallet in economy.ts. */
export interface CosmeticsSave {
  version: 1;
  look: BallLook;
}

export function defaultCosmeticsSave(): CosmeticsSave {
  return { version: 1, look: { ...DEFAULT_LOOK } };
}

/* ------------------------------------------------------------------ *
 * Unlock table
 * ------------------------------------------------------------------ */

const UNLOCKS: Record<Category, Record<string, Unlock>> = {
  material: {
    steel: { kind: 'free' },
    chrome: { kind: 'level', level: 3 },
    brass: { kind: 'level', level: 5 },
    rust: { kind: 'free' },
    oak: { kind: 'credits', price: 300 },
    granite: { kind: 'credits', price: 400 },
    glass: { kind: 'level', level: 10 },
    lava: { kind: 'achievement', id: 'campaign' },
    ice: { kind: 'credits', price: 500 },
    gold: { kind: 'achievement', id: 'first-win' },
  },
  pattern: {
    plain: { kind: 'free' },
    stripes: { kind: 'free' },
    band: { kind: 'level', level: 2 },
    checker: { kind: 'credits', price: 200 },
    flames: { kind: 'level', level: 6 },
    skull: { kind: 'achievement', id: 'ten-kos' },
    goblin: { kind: 'credits', price: 250 },
    number: { kind: 'free' },
    team: { kind: 'level', level: 4 },
    stars: { kind: 'credits', price: 150 },
    cracks: { kind: 'level', level: 8 },
    rivets: { kind: 'free' },
  },
  trail: {
    none: { kind: 'free' },
    smoke: { kind: 'free' },
    sparks: { kind: 'level', level: 3 },
    fire: { kind: 'level', level: 7 },
    ice: { kind: 'credits', price: 350 },
    rainbow: { kind: 'achievement', id: 'pegs-50' },
    coins: { kind: 'achievement', id: 'ten-kos' },
    wisps: { kind: 'level', level: 12 },
  },
  koBurst: {
    classic: { kind: 'free' },
    confetti: { kind: 'level', level: 5 },
    scrap: { kind: 'credits', price: 200 },
    ghost: { kind: 'level', level: 9 },
  },
  finishFx: {
    flag: { kind: 'free' },
    fireworks: { kind: 'level', level: 4 },
    crown: { kind: 'achievement', id: 'first-win' },
    spin: { kind: 'credits', price: 150 },
  },
};

const LABELS: Record<Category, Record<string, string>> = {
  material: { steel: 'Steel', chrome: 'Chrome', brass: 'Brass', rust: 'Rusty Iron', oak: 'Oak', granite: 'Granite', glass: 'Glass', lava: 'Lava', ice: 'Ice', gold: 'Gold' },
  pattern: { plain: 'Plain', stripes: 'Stripes', band: 'Racing band', checker: 'Checker', flames: 'Flames', skull: 'Skull', goblin: 'Goblin face', number: 'Number', team: 'Team logo', stars: 'Stars', cracks: 'Cracks', rivets: 'Rivets' },
  trail: { none: 'None', smoke: 'Smoke', sparks: 'Sparks', fire: 'Fire', ice: 'Ice crystals', rainbow: 'Rainbow', coins: 'Coins', wisps: 'Ghost wisps' },
  koBurst: { classic: 'Classic', confetti: 'Confetti', scrap: 'Scrap', ghost: 'Ghost wisps' },
  finishFx: { flag: 'Flag', fireworks: 'Fireworks', crown: 'Crown', spin: 'Victory spin' },
};

/** Category tabs in the ball customizer. */
export const CATEGORY_LABELS: Readonly<Record<Category, string>> = {
  material: 'Material', pattern: 'Pattern', trail: 'Trail', koBurst: 'KO burst', finishFx: 'Finish',
};

/** Display-ready catalogue rows for the garage and cosmetics shop. */
export function cosmeticOptions(category: Category): { id: string; label: string }[] {
  const ids: readonly string[] = category === 'material' ? MATERIALS
    : category === 'pattern' ? PATTERNS
      : category === 'trail' ? TRAILS
        : category === 'koBurst' ? KO_BURSTS : FINISH_FX;
  return ids.map((id) => ({ id, label: LABELS[category][id] ?? id }));
}

const ACHIEVEMENT_HINTS: Record<AchievementId, string> = {
  'first-win': 'Win your first race',
  'ten-kos': 'Knock out 10 rivals',
  campaign: 'Finish the campaign',
  'pegs-50': 'Hit 50 orange pegs in one race',
};

/** How a cosmetic unlocks, or null when `id` is not in the catalogue. */
export function unlockOf(category: Category, id: string): Unlock | null {
  const table = UNLOCKS[category];
  if (!table) return null;
  const unlock = table[id];
  return unlock ?? null;
}

/**
 * Whether this player may equip `id`: level gates compare against `p.level`,
 * credit items must have been bought (`'material:oak'` in `p.owned`), and
 * trophies must be in `p.achievements`. Unknown ids are never unlocked.
 */
export function isUnlocked(category: Category, id: string, p: Progress): boolean {
  const unlock = unlockOf(category, id);
  if (unlock === null) return false;
  if (unlock.kind === 'free') return true;
  if (unlock.kind === 'level') return p.level >= unlock.level;
  if (unlock.kind === 'credits') return p.owned.includes(`${category}:${id}`);
  return p.achievements.includes(unlock.id);
}

/** One plain sentence describing how to get it; '' for unknown ids. */
export function unlockHint(category: Category, id: string): string {
  const unlock = unlockOf(category, id);
  if (unlock === null) return '';
  if (unlock.kind === 'free') return 'Free';
  if (unlock.kind === 'level') return `Reach level ${unlock.level}`;
  if (unlock.kind === 'credits') return `Buy for ${unlock.price} CR`;
  return ACHIEVEMENT_HINTS[unlock.id];
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

/** Field reader: a string that is on the list passes, anything else falls back. */
function pick(
  list: readonly string[],
  raw: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = raw[key];
  return typeof value === 'string' && list.includes(value) ? value : fallback;
}

/** Race numbers are whole, 0..99. */
function pickNumber(raw: Record<string, unknown>, fallback: number): number {
  const value = raw['number'];
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  if (value < 0 || value > 99) return fallback;
  return value;
}

/**
 * Turn anything — a save file, a network message, garbage — into a legal look.
 * Missing or invalid fields fall back to DEFAULT_LOOK, field by field.
 */
export function sanitizeLook(raw: unknown): BallLook {
  const source: Record<string, unknown> =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};

  return {
    material: pick(MATERIALS, source, 'material', DEFAULT_LOOK.material),
    primary: pick(PALETTE, source, 'primary', DEFAULT_LOOK.primary),
    secondary: pick(PALETTE, source, 'secondary', DEFAULT_LOOK.secondary),
    pattern: pick(PATTERNS, source, 'pattern', DEFAULT_LOOK.pattern),
    number: pickNumber(source, DEFAULT_LOOK.number),
    trail: pick(TRAILS, source, 'trail', DEFAULT_LOOK.trail),
    koBurst: pick(KO_BURSTS, source, 'koBurst', DEFAULT_LOOK.koBurst),
    finishFx: pick(FINISH_FX, source, 'finishFx', DEFAULT_LOOK.finishFx),
  };
}

/**
 * Strip everything the player is no longer entitled to (level downgrade, reset
 * save, anti-cheat). Colours and the race number are never locked, so they stay.
 */
export function lockedReset(look: BallLook, p: Progress): BallLook {
  return {
    ...look,
    material: isUnlocked('material', look.material, p) ? look.material : DEFAULT_LOOK.material,
    pattern: isUnlocked('pattern', look.pattern, p) ? look.pattern : DEFAULT_LOOK.pattern,
    trail: isUnlocked('trail', look.trail, p) ? look.trail : DEFAULT_LOOK.trail,
    koBurst: isUnlocked('koBurst', look.koBurst, p) ? look.koBurst : DEFAULT_LOOK.koBurst,
    finishFx: isUnlocked('finishFx', look.finishFx, p) ? look.finishFx : DEFAULT_LOOK.finishFx,
  };
}

/**
 * Migrate a device-cache value. A missing/old save receives the default ball;
 * an unversioned pre-release look is accepted and normalized field by field.
 */
export function parseCosmeticsSave(raw: string | null): CosmeticsSave {
  if (!raw) return defaultCosmeticsSave();
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultCosmeticsSave();
    const record = value as Record<string, unknown>;
    if (record.version !== undefined && record.version !== 0 && record.version !== 1) return defaultCosmeticsSave();
    // v0 stored the look at the root; v1 wraps it. This also means an old account
    // with no cosmetics key naturally loads the default look without touching its wallet.
    const candidate = record.version === 1 ? record.look : record.look ?? record;
    return { version: 1, look: sanitizeLook(candidate) };
  } catch {
    return defaultCosmeticsSave();
  }
}

// The active look is an in-memory fast path for the renderer. Persistence stays
// in economy.ts via storage.ts; 600 frames/second must never parse a save file.
let activeLook: BallLook = { ...DEFAULT_LOOK };

export function currentBallLook(): BallLook {
  return { ...activeLook };
}

export function setCurrentBallLook(raw: unknown): BallLook {
  activeLook = sanitizeLook(raw);
  return currentBallLook();
}
