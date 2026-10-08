export interface MarbleStats {
  weight: number; // 1..10
  speed: number; // 1..10
  bounce: number; // 1..10
}

export const STAT_BUDGET = 15;
export const STAT_MIN = 1;
export const STAT_MAX = 10;

/** The eight original items first (their order is part of old saves and tests), then the sixteen P2-08 skills. */
export const LEGACY_ITEMS = ['rocket', 'jump', 'oil', 'shock', 'anvil', 'aero', 'freeze', 'ghost'] as const;
const NEW_SKILLS = ['shield', 'ram', 'repair', 'brake', 'bolt', 'overdrive', 'spikes', 'decoy', 'grapple', 'bomb', 'reflect', 'blink', 'emp', 'lightning', 'drill', 'charm'] as const;
/** The owner's twenty premium spells and weapons (skills/premium.ts), last: their order is part of saves from now on. */
export const PREMIUM_ITEMS = ['swap', 'telekinesis', 'well', 'warp', 'rewind', 'shrink', 'bubble', 'leech', 'chain', 'twin', 'thorns', 'spikewall', 'mines', 'cluster', 'megabomb', 'blades', 'boomerang', 'laser', 'turret', 'blank'] as const;
export const ITEM_TYPES = [...LEGACY_ITEMS, ...NEW_SKILLS, ...PREMIUM_ITEMS] as const;
export type ItemType = typeof ITEM_TYPES[number];
export type Inventory = Record<ItemType, number>;
export const MAX_ITEM_STACK = 9;

type ItemInfo = { name: string; short: string; desc: string; color: string; price: number; duration: number; category: 'Performance' | 'Disruption'; effect: string };

const LEGACY_INFO: Record<typeof LEGACY_ITEMS[number], ItemInfo> = {
  rocket: { name: 'Speed boost', short: 'BOOST', desc: 'Fire a forward thruster and raise your top speed for 3 seconds.', color: '#d63e2e', price: 90, duration: 3000, category: 'Performance', effect: 'Extra thrust / 3s' },
  jump: { name: 'Jump', short: 'JUMP', desc: 'Launch upward instantly. Keep your sideways momentum to clear a lip or dodge the pack.', color: '#b6a0ff', price: 65, duration: 1000, category: 'Performance', effect: 'Instant lift' },
  oil: { name: 'Oil slick', short: 'OIL', desc: 'Leave a slick behind you for 9 seconds. Rivals slow down; you keep your grip.', color: '#c084fc', price: 55, duration: 0, category: 'Disruption', effect: 'Trail hazard / 9s' },
  shock: { name: 'Shockwave', short: 'SHOCK', desc: 'Blast nearby rivals away. The shock also shatters their ice.', color: '#facc15', price: 100, duration: 0, category: 'Disruption', effect: 'Area knockback' },
  anvil: { name: 'Heavy metal', short: 'MASS', desc: 'Triple your mass for 5 seconds. Win collisions and break shortcut walls.', color: '#c5d1e1', price: 80, duration: 5000, category: 'Performance', effect: '3x weight / 5s' },
  aero: { name: 'Slipstream', short: 'AERO', desc: 'Cut air drag by 95% and remove surface friction for 6 seconds. Carry speed farther.', color: '#5eead4', price: 75, duration: 6000, category: 'Performance', effect: '-95% drag / 6s' },
  freeze: { name: 'Freeze ray', short: 'FREEZE', desc: 'Freeze the nearest rival ahead for 2.5 seconds. No target? Keep your charge.', color: '#7dd3fc', price: 110, duration: 0, category: 'Disruption', effect: 'Rival frozen / 2.5s' },
  ghost: { name: 'Ghost mode', short: 'GHOST', desc: 'Phase through other marbles for 3 seconds. Track walls still apply.', color: '#e2e8f0', price: 85, duration: 3000, category: 'Performance', effect: 'Phase through rivals / 3s' },
};

/** The sixteen P2-08 skills. These numbers mirror src/game/skills/catalog.ts (a test keeps the two in step); the
 *  protocol imports this file, so it cannot import the catalogue. */
const NEW_INFO: Record<typeof NEW_SKILLS[number], ItemInfo> = {
  shield: { name: 'Bubble Shield', short: 'SHIELD', desc: 'A bubble that absorbs the next 40 damage or lasts 4 seconds.', color: '#60a5fa', price: 80, duration: 4000, category: 'Performance', effect: 'Absorbs 40 damage / 4s' },
  ram: { name: 'Battering Ram', short: 'RAM', desc: 'A 2.5 second charge that smashes breakable walls and barricades.', color: '#b45309', price: 95, duration: 2500, category: 'Performance', effect: 'Wall buster / 2.5s' },
  repair: { name: 'Repair Kit', short: 'REPAIR', desc: 'Heal 40 HP instantly.', color: '#4ade80', price: 70, duration: 0, category: 'Performance', effect: '+40 HP' },
  brake: { name: 'Air Brake', short: 'BRAKE', desc: 'Kill most of your speed and hover for a second to line up a jump.', color: '#94a3b8', price: 60, duration: 1000, category: 'Performance', effect: 'Hover / 1s' },
  bolt: { name: 'Homing Bolt', short: 'BOLT', desc: 'Seeks the nearest rival ahead for 25 damage and a knock.', color: '#f97316', price: 105, duration: 0, category: 'Disruption', effect: '25 damage' },
  overdrive: { name: 'Overdrive', short: 'OVERDRIVE', desc: 'The Magic Engine never overheats for 5 seconds and pushes harder.', color: '#ef4444', price: 90, duration: 5000, category: 'Performance', effect: 'No overheat / 5s' },
  spikes: { name: 'Caltrops', short: 'SPIKES', desc: 'Drop spikes behind you for 6 seconds. Rivals take damage and lose grip.', color: '#a8a29e', price: 70, duration: 6000, category: 'Disruption', effect: 'Spike patch / 6s' },
  decoy: { name: 'Decoy', short: 'DECOY', desc: 'A fake marble that homing skills chase for 5 seconds.', color: '#fbbf24', price: 65, duration: 5000, category: 'Performance', effect: 'Fake marble / 5s' },
  grapple: { name: 'Grapple Hook', short: 'GRAPPLE', desc: 'Yanks you to the nearest ledge ahead.', color: '#a16207', price: 85, duration: 0, category: 'Performance', effect: 'Pull to ledge' },
  bomb: { name: 'Sticky Bomb', short: 'BOMB', desc: 'Sticks to a rival and explodes after 2 seconds for 35 damage.', color: '#dc2626', price: 115, duration: 2000, category: 'Disruption', effect: '35 damage / 2s' },
  reflect: { name: 'Mirror Plate', short: 'MIRROR', desc: 'Bounces freeze, bolts and bombs back at the sender for 3 seconds.', color: '#e0f2fe', price: 95, duration: 3000, category: 'Performance', effect: 'Reflect / 3s' },
  blink: { name: 'Blink', short: 'BLINK', desc: 'Teleport 140 px forward if the landing spot is clear.', color: '#a78bfa', price: 100, duration: 0, category: 'Performance', effect: 'Teleport 140 px' },
  emp: { name: 'EMP', short: 'EMP', desc: 'Nearby rivals cannot use skills for 4 seconds.', color: '#38bdf8', price: 120, duration: 4000, category: 'Disruption', effect: 'Skills off / 4s' },
  lightning: { name: 'Lightning Strike', short: 'STRIKE', desc: 'Strikes the race leader for 30 damage and a 1 second stun.', color: '#fde047', price: 130, duration: 1000, category: 'Disruption', effect: '30 damage + stun' },
  drill: { name: 'Drill', short: 'DRILL', desc: 'Drop straight through the next floor below you.', color: '#78716c', price: 110, duration: 1000, category: 'Performance', effect: 'Pass floors / 1s' },
  charm: { name: "Shaman's Charm", short: 'CHARM', desc: 'The next killing hit leaves you on 1 HP instead, for 8 seconds.', color: '#34d399', price: 150, duration: 8000, category: 'Performance', effect: 'Survive a KO / 8s' },
};

/** The twenty premium skills (mirroring catalog.ts like NEW_INFO). */
const PREMIUM_INFO: Record<typeof PREMIUM_ITEMS[number], ItemInfo> = {
  swap: { name: 'Soul Swap', short: 'SWAP', desc: 'Trade places with the racer one place ahead of you. They land where you were.', color: '#c026d3', price: 160, duration: 0, category: 'Disruption', effect: 'Swap places' },
  telekinesis: { name: 'Telekinesis', short: 'GRIP', desc: 'Lift the nearest rival into the air for 1.5 seconds, then hurl them back down the course.', color: '#a855f7', price: 150, duration: 1500, category: 'Disruption', effect: 'Lift + throw back' },
  well: { name: 'Gravity Well', short: 'WELL', desc: 'Leave a black hole behind you for 4 seconds that drags rivals in every lane toward it.', color: '#6d28d9', price: 140, duration: 4000, category: 'Disruption', effect: 'Pull rivals / 4s' },
  warp: { name: 'Time Warp', short: 'WARP', desc: 'Everyone but you crawls along at a slow speed for 3 seconds.', color: '#d97706', price: 170, duration: 3000, category: 'Disruption', effect: 'Rivals slowed / 3s' },
  rewind: { name: 'Rewind', short: 'REWIND', desc: 'Snap back to where you were 3 seconds ago, with the health you had then.', color: '#0ea5e9', price: 130, duration: 0, category: 'Performance', effect: 'Back 3s in time' },
  shrink: { name: 'Shrink Hex', short: 'SHRINK', desc: 'Shrink the race leader for 4 seconds: slow, and every hit throws them twice as far.', color: '#ec4899', price: 150, duration: 4000, category: 'Disruption', effect: 'Leader shrunk / 4s' },
  bubble: { name: 'Bubble Trap', short: 'BUBBLE', desc: 'Fire a bubble down your lane. The first rival it hits floats helplessly for 2 seconds.', color: '#67e8f9', price: 120, duration: 2000, category: 'Disruption', effect: 'Trap in a bubble / 2s' },
  leech: { name: 'Life Leech', short: 'LEECH', desc: 'Tether the nearest rival for 3 seconds and drain their health into yours.', color: '#e11d48', price: 140, duration: 3000, category: 'Disruption', effect: 'Drain 20 HP' },
  chain: { name: 'Chain Lightning', short: 'CHAIN', desc: 'Lightning hits the nearest rival and jumps to up to 3 more close by, 15 damage each.', color: '#93c5fd', price: 150, duration: 0, category: 'Disruption', effect: '15 damage x4' },
  twin: { name: 'Shadow Twin', short: 'TWIN', desc: 'A shadow of you follows your path a second behind for 8 seconds. It knocks rivals aside and draws homing shots.', color: '#475569', price: 140, duration: 8000, category: 'Performance', effect: 'Shadow escort / 8s' },
  thorns: { name: 'Thorn Shell', short: 'THORNS', desc: 'Grow thorns for 5 seconds. Any rival that touches you takes 15 damage and bounces off.', color: '#65a30d', price: 120, duration: 5000, category: 'Performance', effect: 'Thorns / 5s' },
  spikewall: { name: 'Spike Wall', short: 'WALL', desc: 'Raise a wall of spikes in front of the rival behind you. Jump it, or take 25 damage.', color: '#78716c', price: 130, duration: 4000, category: 'Disruption', effect: 'Spike wall / 4s' },
  mines: { name: 'Mine Field', short: 'MINES', desc: 'Scatter five mines behind you across the lanes. They arm in half a second and last 10.', color: '#b91c1c', price: 140, duration: 10000, category: 'Disruption', effect: '5 mines / 10s' },
  cluster: { name: 'Cluster Bomb', short: 'CLUSTER', desc: 'Lob a bomb ahead that bursts into four bomblets bouncing down the track.', color: '#f97316', price: 150, duration: 0, category: 'Disruption', effect: 'Bomb + 4 bomblets' },
  megabomb: { name: 'Mega Bomb', short: 'MEGA', desc: 'Drop a huge bomb with a 3 second fuse. It blasts every lane for 40 damage, you included if you are close.', color: '#7f1d1d', price: 200, duration: 3000, category: 'Disruption', effect: '40 damage, all lanes' },
  blades: { name: 'Orbit Blades', short: 'BLADES', desc: 'Three saw blades circle you for 8 seconds. Each one cuts a rival once for 12 damage, then breaks.', color: '#cbd5e1', price: 140, duration: 8000, category: 'Performance', effect: '3 blades / 8s' },
  boomerang: { name: 'Boomerang', short: 'RANG', desc: 'Throw a boomerang down your lane. It hits rivals on the way out and again on the way back.', color: '#ca8a04', price: 120, duration: 0, category: 'Disruption', effect: '15 damage, twice' },
  laser: { name: 'Laser Beam', short: 'LASER', desc: 'Fire a beam down your lane for 1.5 seconds. Rivals in it are slowed and burned. You slow a little too.', color: '#ef4444', price: 160, duration: 1500, category: 'Disruption', effect: 'Beam / 1.5s' },
  turret: { name: 'Sentry Turret', short: 'TURRET', desc: 'Set down a turret that fires at every rival passing it for 8 seconds.', color: '#64748b', price: 150, duration: 8000, category: 'Disruption', effect: 'Turret / 8s' },
  blank: { name: 'Blank', short: 'BLANK', desc: 'A white shockwave wipes out shots, mines, oil, bombs and hexes around you, and throws nearby rivals into other lanes.', color: '#f8fafc', price: 130, duration: 0, category: 'Performance', effect: 'Clear + push away' },
};

export const ITEM_INFO = Object.fromEntries(ITEM_TYPES.map((id) => [id, (LEGACY_INFO as Record<string, ItemInfo>)[id] ?? (NEW_INFO as Record<string, ItemInfo>)[id] ?? (PREMIUM_INFO as Record<string, ItemInfo>)[id]])) as Record<ItemType, ItemInfo>;

export function emptyInventory(): Inventory {
  return Object.fromEntries(ITEM_TYPES.map((id) => [id, 0])) as Inventory;
}

export function normalizeInventory(value: unknown): Inventory {
  const next = emptyInventory();
  if (!value || typeof value !== 'object') return next;
  for (const item of ITEM_TYPES) {
    const count = (value as Record<string, unknown>)[item];
    next[item] = typeof count === 'number' && Number.isFinite(count) ? Math.max(0, Math.min(MAX_ITEM_STACK, Math.floor(count))) : 0;
  }
  return next;
}

export function inventoryCount(inventory: Inventory): number {
  return ITEM_TYPES.reduce((sum, item) => sum + inventory[item], 0);
}

export const CIRCUIT_LENGTH_MULTIPLIER = 3;

export interface MarbleInfo {
  id: number;
  name: string;
  color: string;
  stats: MarbleStats;
  isPlayer: boolean;
  /** Online: a human driver (not AI). Their name tag is drawn bigger so people can tell who is real. */
  isHuman?: boolean;
  /** Rival sprite index, or the player's chosen portrait. */
  character?: number;
  /**
   * What this marble is carrying at the start (MP-09). Offline this is the
   * local player's own kit and nobody else has one; online every human seat
   * brings the items it bought.
   */
  inventory?: Inventory;
}

export interface PhysicsProps {
  density: number;
  mass: number;
  restitution: number;
  frictionAir: number;
  maxSpeed: number;
}

export const MARBLE_RADIUS = 14;

export function statsToPhysics(s: MarbleStats): PhysicsProps {
  const density = 0.0008 + s.weight * 0.00022;
  const area = Math.PI * MARBLE_RADIUS * MARBLE_RADIUS;
  return {
    density,
    mass: density * area,
    restitution: 0.15 + s.bounce * 0.08,
    frictionAir: 0.0011 - s.speed * 0.000075,
    maxSpeed: 13 + s.speed * 1.1,
  };
}

export function massForWeight(weight: number): number {
  return statsToPhysics({ weight, speed: 5, bounce: 5 }).mass;
}

/** Adjust one stat, pulling the difference from the other two so the sum stays at STAT_BUDGET. */
export function adjustStat(stats: MarbleStats, key: keyof MarbleStats, value: number): MarbleStats {
  const next = { ...stats };
  value = Math.max(STAT_MIN, Math.min(STAT_MAX, Math.round(value)));
  let delta = value - next[key];
  const others = (Object.keys(next) as (keyof MarbleStats)[]).filter((k) => k !== key);
  next[key] = value;
  let guard = 0;
  while (delta !== 0 && guard++ < 40) {
    if (delta > 0) {
      // take a point from the larger other stat
      const sorted = [...others].sort((a, b) => next[b] - next[a]);
      const target = sorted.find((k) => next[k] > STAT_MIN);
      if (!target) break;
      next[target] -= 1;
      delta -= 1;
    } else {
      const sorted = [...others].sort((a, b) => next[a] - next[b]);
      const target = sorted.find((k) => next[k] < STAT_MAX);
      if (!target) break;
      next[target] += 1;
      delta += 1;
    }
  }
  if (delta !== 0) {
    // couldn't fully redistribute; revert the remainder
    next[key] -= delta;
  }
  return next;
}

export function randomStats(rng: () => number): MarbleStats {
  const s: MarbleStats = { weight: 1, speed: 1, bounce: 1 };
  const keys: (keyof MarbleStats)[] = ['weight', 'speed', 'bounce'];
  let remaining = STAT_BUDGET - 3;
  // bias to create archetypes sometimes
  const fav = keys[Math.floor(rng() * 3)];
  while (remaining > 0) {
    const k = rng() < 0.45 ? fav : keys[Math.floor(rng() * 3)];
    if (s[k] < STAT_MAX) {
      s[k] += 1;
      remaining -= 1;
    }
  }
  return s;
}

export const AI_NAMES = ['Ace Spadegrin', 'Duchess Vex', 'Big Grubba', 'Knuckles Blau', 'Scorch', 'Rivet Rex', 'Lucky Thirteen', 'Red Morrigan', 'Violetta Voltz'];
export const AI_COLORS = ['#67e8f9', '#ef4444', '#fb7185', '#3b82f6', '#64748b', '#10b981', '#84cc16', '#f59e0b', '#8b5cf6'];

/** F1-style points for finishing positions 1..10 */
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
export const FASTEST_BONUS = 1;
export const HEATS_PER_GP = 3;

export interface Team {
  id: number;
  name: string;
  short: string;
  color: string;
  members: number[]; // marble ids
}

export const TEAMS: Team[] = [
  { id: 0, name: 'Apex Racing', short: 'APX', color: '#d63e2e', members: [0, 1] },
  { id: 1, name: 'Scuderia Viola', short: 'VIO', color: '#a78bfa', members: [2, 3] },
  { id: 2, name: 'Cobalt Grand Prix', short: 'COB', color: '#3b82f6', members: [4, 5] },
  { id: 3, name: 'Jade Motorsport', short: 'JDE', color: '#10b981', members: [6, 7] },
  { id: 4, name: 'Solar Amber F1', short: 'SOL', color: '#f59e0b', members: [8, 9] },
];

export function teamOf(marbleId: number): Team {
  return TEAMS.find((t) => t.members.includes(marbleId)) ?? TEAMS[0];
}

export function shadeHex(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * amt)));
  const r = c((n >> 16) & 255);
  const g = c((n >> 8) & 255);
  const b = c(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export interface HeatResult {
  id: number;
  rank: number;
  time: number | null; // ms; non-finishers earn no points
  pegs: number;
  /** P2-07: knocked out of the race (0 HP): Did Not Finish. Absent where health is off. */
  dnf?: boolean;
  /** P2-07: rivals this driver knocked out. */
  kos?: number;
}

export interface TrackTheme {
  bg1: string;
  bg2: string;
  track: string;
  pipe: string;
  pipeEdge: string;
}

export interface TrackProfile {
  /** Story uses legacy section indices; free races use connected courses by default. */
  generator?: 'legacy' | 'connected' | 'platformer';
  /** P2-00: which official platformer course (`PLATFORMER_COURSES` id); unset plans one from the seed. */
  course?: string;
  segments: number;
  weights: Record<string, number>;
  theme: TrackTheme;
}

/**
 * Every track skin the game draws, by id. `TrackDef` (MB-01) names a theme instead of embedding one, and the
 * calendar, story mode and quick race all resolve their `TrackProfile.theme` through here, so the palette of a
 * circuit is identical whichever way the circuit was generated.
 */
export const TRACK_THEMES = {
  default: { bg1: '#0b0e12', bg2: '#10161d', track: '#131b24', pipe: '#354454', pipeEdge: '#556778' },
  classic: { bg1: '#0b0f14', bg2: '#101820', track: '#141e28', pipe: '#354657', pipeEdge: '#62778c' },
  street: { bg1: '#140f1e', bg2: '#22162e', track: '#1c1530', pipe: '#5b4b7a', pipeEdge: '#2a1f3d' },
  silver: { bg1: '#0f1416', bg2: '#1a2226', track: '#151d21', pipe: '#52606d', pipeEdge: '#1f2a30' },
  forest: { bg1: '#07140f', bg2: '#0d2418', track: '#0b1e14', pipe: '#2f6b4f', pipeEdge: '#123324' },
  sakura: { bg1: '#1a0f16', bg2: '#2a1522', track: '#22131d', pipe: '#7a4b5e', pipeEdge: '#3a1f2d' },
  night: { bg1: '#05070f', bg2: '#0c1226', track: '#0a1022', pipe: '#3a4f8a', pipeEdge: '#182349' },
  // Art themes: full sprite skins (src/assets/game/skins/<id>/), not just colours. Keep new themes at the END:
  // share codes store a theme by its index in THEME_IDS.
  dwarven: { bg1: '#1a0c06', bg2: '#2a1208', track: '#1d120c', pipe: '#6b4a2e', pipeEdge: '#3a2414' },
  worg: { bg1: '#1f0f08', bg2: '#3a1a0c', track: '#2a150c', pipe: '#8a4a2a', pipeEdge: '#4a2412' },
} as const satisfies Record<string, TrackTheme>;

export type ThemeId = keyof typeof TRACK_THEMES;

export const THEME_IDS = Object.keys(TRACK_THEMES) as ThemeId[];

/** Player-facing theme names (the Workshop's theme picker). */
export const THEME_LABELS: Record<ThemeId, string> = {
  default: 'Goblin Works', classic: 'Classic', street: 'Street', silver: 'Silver', forest: 'Forest', sakura: 'Sakura', night: 'Night',
  dwarven: 'Dwarven Forge', worg: 'Worg Canyon',
};

/** Themes with their own art (sprite skin). The rest recolour the goblin art. */
export const ART_THEMES: readonly ThemeId[] = ['dwarven', 'worg'];

/** The sprite skin a theme draws with, or null for the default goblin art. */
export function skinFor(id: ThemeId): string | null {
  return (ART_THEMES as readonly string[]).includes(id) ? id : null;
}

export function themeFor(id: ThemeId): TrackTheme {
  return TRACK_THEMES[id];
}

function themeDistance(a: TrackTheme, b: TrackTheme): number {
  const channels: (keyof TrackTheme)[] = ['bg1', 'bg2', 'track', 'pipe', 'pipeEdge'];
  let sum = 0;
  for (const key of channels) {
    const [ar, ag, ab] = hexChannels(a[key]);
    const [br, bg, bb] = hexChannels(b[key]);
    sum += (ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2;
  }
  return sum;
}

function hexChannels(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * The id that draws `theme`: an exact match when the palette is one of the registered skins, otherwise the
 * nearest registered skin. Deterministic (ties resolve on `THEME_IDS` order) so a custom profile always
 * records the same id.
 */
export function themeIdFor(theme: TrackTheme): ThemeId {
  let best = THEME_IDS[0];
  let bestDistance = Infinity;
  for (const id of THEME_IDS) {
    const distance = themeDistance(TRACK_THEMES[id], theme);
    if (distance === 0) return id;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = id;
    }
  }
  return best;
}

export interface GrandPrix {
  id: number;
  name: string;
  short: string;
  location: string;
  flag: string;
  desc: string;
  profile: TrackProfile;
}
export const PLAYER_COLORS = ['#d63e2e', '#22d3ee', '#fb7185', '#fb923c', '#c084fc', '#ffffff', '#2dd4bf'];

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
