// P2-22: a platformer course made in the Workshop. A PlatformerDef is versioned JSON: the seed and length that grow the
// hills and chasms (the floors), and the editable things on them (springs, ledges, lane gates, boosts, power-up boxes,
// wrecking balls, crates), each list replacing what the seed would have planned. `planFromDef` turns it into the
// CoursePlan the engine races; `validatePlatformerDef` says in plain words what is wrong with one that is not fit to race.
// Defs from share codes and the network are never trusted: everything is re-checked here, with hard ceilings.
import { COURSE_TUNING, SPRING_W, floorAt, planCourse, registerCustomCourse } from './course';
import type { BoostSpot, Bump, CoursePlan, ItemBoxSpot, Lane, LaneGate, Ledge, Spring, WreckerSpot } from './course';
import { FLOW_TUNING, planFlow } from './flow';
import { THEME_IDS } from '../types';
import type { ThemeId } from '../types';

export const PLATFORMER_DEF_VERSION = 1;
export const MAX_DEF_NAME = 48;
export const MIN_LENGTH = 6000;
export const MAX_LENGTH = 60000;
/** Most of each kind a course may hold (a ceiling for imports, far above what anyone builds). */
export const MAX_PER_KIND = 300;
/** A lane gate is this wide; ramps and doors both. */
export const GATE_W = 170;
/** Things in one lane keep this far apart. */
const GAP = 60;

export type CourseStyle = 'flow' | 'blocks';

export interface PlatformerDef {
  version: typeof PLATFORMER_DEF_VERSION;
  name: string;
  /** Grows the floors: hills, chasms and the start and finish flats. */
  seed: number;
  length: number;
  style: CourseStyle;
  theme: ThemeId;
  springs: Spring[];
  ledges: Ledge[];
  gates: LaneGate[];
  boosts: BoostSpot[];
  itemBoxes: ItemBoxSpot[];
  wreckers: WreckerSpot[];
  bumps: Bump[];
}

/** The things on a course, by the name the editor and the error messages use. */
export const KIND_LABEL = {
  springs: 'spring', ledges: 'ledge', gates: 'lane gate', boosts: 'boost pad', itemBoxes: 'power-up box', wreckers: 'wrecking ball', bumps: 'crate',
} as const;
export type Kind = keyof typeof KIND_LABEL;
export const KINDS = Object.keys(KIND_LABEL) as Kind[];
const LANE_NAME = ['back lane', 'middle lane', 'front lane'] as const;

/** The plan the seed grows (floors, hills, chasms, and whatever the seed would have placed). */
export function basePlan(def: Pick<PlatformerDef, 'seed' | 'length' | 'style'>): CoursePlan {
  return def.style === 'flow'
    ? planFlow(def.seed, { ...FLOW_TUNING, length: def.length })
    : planCourse(def.seed, { ...COURSE_TUNING, length: def.length });
}

const round = (v: number) => Math.round(v * 10) / 10;

/** A new def holding exactly what the seed plans: the starting point of the editor. */
export function defFromSeed(seed: number, length: number, style: CourseStyle, name = 'My platformer', theme: ThemeId = 'forest' as ThemeId): PlatformerDef {
  const plan = basePlan({ seed, length, style });
  return {
    version: PLATFORMER_DEF_VERSION, name, seed, length, style, theme,
    springs: (plan.springs ?? []).map((s) => ({ ...s, y: round(s.y) })),
    ledges: (plan.ledges ?? []).map((l) => ({ ...l, y: round(l.y) })),
    gates: plan.gates.map((g) => ({ ...g, y: round(g.y) })),
    boosts: (plan.boosts ?? []).map((b) => ({ ...b })),
    itemBoxes: (plan.itemBoxes ?? []).map((b) => ({ ...b, y: round(b.y) })),
    wreckers: (plan.wreckers ?? []).map((w) => ({ ...w, pivotY: round(w.pivotY), amp: round(w.amp * 1000) / 1000, speed: Math.round(w.speed * 1e5) / 1e5, phase: round(w.phase * 1000) / 1000 })),
    bumps: plan.bumps.map((b) => ({ ...b, y: round(b.y) })),
  };
}

/** The CoursePlan a def races: the seed's floors and path with the def's lists in place of the planned ones. */
export function planFromDef(def: PlatformerDef): CoursePlan {
  const base = basePlan(def);
  return {
    ...base,
    springs: def.springs.map((s) => ({ ...s })),
    ledges: def.ledges.map((l) => ({ ...l })),
    gates: def.gates.map((g) => ({ ...g })),
    boosts: def.boosts.map((b) => ({ ...b })),
    itemBoxes: def.itemBoxes.map((b) => ({ ...b })),
    wreckers: def.wreckers.map((w) => ({ ...w })),
    bumps: def.bumps.map((b) => ({ ...b })),
  };
}

// ------------------------------------------------------------------ JSON

/** The def as stable JSON (the form that is saved, shared and sent). */
export function serializePlatformerDef(def: PlatformerDef): string {
  return JSON.stringify(def);
}

export type DefCheck = { ok: true; def: PlatformerDef } | { ok: false; errors: string[] };

/** Parse and validate JSON text. */
export function parsePlatformerDef(text: string): DefCheck {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { ok: false, errors: ['That is not a platformer course: the text is not valid JSON.'] }; }
  return validatePlatformerDef(value);
}

// ------------------------------------------------------------------ validation

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

class Problems {
  list: string[] = [];
  add(message: string) { if (this.list.length < 25) this.list.push(message); }
}

function num(v: unknown, at: string, lo: number, hi: number, p: Problems): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) { p.add(`${at} must be a number.`); return lo; }
  if (v < lo || v > hi) { p.add(`${at} must be between ${lo} and ${hi} (it is ${Math.round(v * 100) / 100}).`); return Math.min(hi, Math.max(lo, v)); }
  return v;
}

const lane = (v: unknown, at: string, p: Problems): Lane => {
  if (v !== 0 && v !== 1 && v !== 2) { p.add(`${at} must be 0 (back), 1 (middle) or 2 (front).`); return 1; }
  return v;
};

/** Where in the lane a thing stands, for messages: "a spring in the front lane at 4,200". */
const where = (kind: Kind, i: number, l: number, x: number) => `${KIND_LABEL[kind][0].toUpperCase()}${KIND_LABEL[kind].slice(1)} ${i + 1} (${LANE_NAME[l]}, at ${Math.round(x).toLocaleString('en-US')})`;

/** Does the lane have unbroken floor from x0 to x1? (Sampled every 20 px, ends included.) */
function solid(plan: CoursePlan, l: Lane, x0: number, x1: number): boolean {
  for (let x = x0; x < x1; x += 20) if (floorAt(plan, l, x) === null) return false;
  return floorAt(plan, l, x1) !== null;
}

/** Validate anything that claims to be a PlatformerDef. Never throws; the errors read as sentences. */
export function validatePlatformerDef(value: unknown): DefCheck {
  const p = new Problems();
  if (!isRec(value)) return { ok: false, errors: ['A platformer course must be an object.'] };
  if (value.version !== PLATFORMER_DEF_VERSION) {
    return { ok: false, errors: [typeof value.version === 'number' && value.version > PLATFORMER_DEF_VERSION ? 'This course was made by a newer version of the game.' : `The course version must be ${PLATFORMER_DEF_VERSION}.`] };
  }
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, MAX_DEF_NAME) : '';
  if (!name) p.add('The course needs a name.');
  const seed = num(value.seed, 'The seed', 0, 0xffffffff, p);
  if (!Number.isInteger(seed)) p.add('The seed must be a whole number.');
  const length = num(value.length, 'The length', MIN_LENGTH, MAX_LENGTH, p);
  const style = value.style === 'flow' || value.style === 'blocks' ? value.style : (p.add('The style must be "flow" (rolling slopes) or "blocks".'), 'flow' as CourseStyle);
  const theme = typeof value.theme === 'string' && (THEME_IDS as string[]).includes(value.theme) ? (value.theme as ThemeId) : (p.add(`The theme must be one of: ${THEME_IDS.join(', ')}.`), 'forest' as ThemeId);

  const out: Record<Kind, unknown[]> = { springs: [], ledges: [], gates: [], boosts: [], itemBoxes: [], wreckers: [], bumps: [] };
  const list = (kind: Kind, parse: (raw: Rec, at: string) => unknown) => {
    const raw = value[kind];
    if (!Array.isArray(raw)) { p.add(`The ${KIND_LABEL[kind]} list is missing.`); return; }
    if (raw.length > MAX_PER_KIND) { p.add(`Too many ${KIND_LABEL[kind]}s: ${raw.length} (the most is ${MAX_PER_KIND}).`); return; }
    raw.forEach((r, i) => {
      if (!isRec(r)) { p.add(`${KIND_LABEL[kind][0].toUpperCase()}${KIND_LABEL[kind].slice(1)} ${i + 1} must be an object.`); return; }
      out[kind].push(parse(r, `${KIND_LABEL[kind][0].toUpperCase()}${KIND_LABEL[kind].slice(1)} ${i + 1}`));
    });
  };
  const X = (r: Rec, k: string, at: string) => num(r[k], `${at}'s ${k}`, -400, MAX_LENGTH + 400, p);
  const Y = (r: Rec, k: string, at: string) => num(r[k], `${at}'s ${k}`, -2000, 30000, p);
  list('springs', (r, at) => ({ lane: lane(r.lane, `${at}'s lane`, p), x: X(r, 'x', at), y: Y(r, 'y', at) } satisfies Spring));
  list('ledges', (r, at) => ({ lane: lane(r.lane, `${at}'s lane`, p), x: X(r, 'x', at), w: num(r.w, `${at}'s width`, 120, 4000, p), y: Y(r, 'y', at) } satisfies Ledge));
  list('gates', (r, at) => {
    const kind = r.kind === 'ramp' || r.kind === 'door' ? r.kind : (p.add(`${at} must be a ramp or a door.`), 'ramp' as const);
    return { kind, lane: lane(r.lane, `${at}'s lane`, p), to: lane(r.to, `${at}'s destination lane`, p), x: X(r, 'x', at), w: num(r.w, `${at}'s width`, 100, 400, p), y: Y(r, 'y', at) } satisfies LaneGate;
  });
  list('boosts', (r, at) => ({ lane: lane(r.lane, `${at}'s lane`, p), x: X(r, 'x', at), w: num(r.w, `${at}'s width`, 60, 600, p) } satisfies BoostSpot));
  list('itemBoxes', (r, at) => ({ lane: lane(r.lane, `${at}'s lane`, p), x: X(r, 'x', at), y: Y(r, 'y', at) } satisfies ItemBoxSpot));
  list('wreckers', (r, at) => ({
    lane: lane(r.lane, `${at}'s lane`, p), x: X(r, 'x', at), pivotY: Y(r, 'pivotY', at), chain: num(r.chain, `${at}'s chain`, 60, 300, p),
    amp: num(r.amp, `${at}'s swing`, 0.2, 1.4, p), speed: num(r.speed, `${at}'s speed`, 0.0005, 0.006, p), phase: num(r.phase, `${at}'s phase`, 0, Math.PI * 2 + 0.01, p),
  } satisfies WreckerSpot));
  list('bumps', (r, at) => ({ lane: lane(r.lane, `${at}'s lane`, p), x: X(r, 'x', at), w: num(r.w, `${at}'s width`, 30, 400, p), y: Y(r, 'y', at), h: num(r.h, `${at}'s height`, 16, 140, p) } satisfies Bump));

  if (p.list.length) return { ok: false, errors: p.list };

  const def: PlatformerDef = { version: PLATFORMER_DEF_VERSION, name, seed, length, style, theme, ...(out as unknown as Pick<PlatformerDef, Kind>) };
  const plan = basePlan(def);
  const problems = new Problems();

  // The course must be finishable: floor under every lane at the start and the finish.
  for (const l of [0, 1, 2] as Lane[]) {
    if (floorAt(plan, l, plan.startX - 100) === null) problems.add(`There is no floor under the ${LANE_NAME[l]} at the start.`);
    if (floorAt(plan, l, plan.finishX) === null) problems.add(`There is no floor under the ${LANE_NAME[l]} at the finish.`);
  }
  // Everything stands inside the course.
  const inside = (kind: Kind, i: number, l: number, x0: number, x1: number) => {
    if (x0 < 0 || x1 > plan.width) problems.add(`${where(kind, i, l, x0)} is outside the course (it runs from 0 to ${plan.width.toLocaleString('en-US')}).`);
    else if (x1 > plan.finishX - 100 && kind !== 'bumps' && kind !== 'itemBoxes') problems.add(`${where(kind, i, l, x0)} is too close to the finish line.`);
    else if (x0 < plan.startX + 120) problems.add(`${where(kind, i, l, x0)} is too close to the start grid.`);
  };
  def.springs.forEach((s, i) => { inside('springs', i, s.lane, s.x, s.x + SPRING_W); if (!solid(plan, s.lane, s.x, s.x + SPRING_W)) problems.add(`${where('springs', i, s.lane, s.x)} is not on solid floor: there is a gap under it.`); });
  def.boosts.forEach((b, i) => { inside('boosts', i, b.lane, b.x, b.x + b.w); if (!solid(plan, b.lane, b.x, b.x + b.w)) problems.add(`${where('boosts', i, b.lane, b.x)} is not on solid floor: there is a gap under it.`); });
  def.bumps.forEach((b, i) => { inside('bumps', i, b.lane, b.x, b.x + b.w); if (!solid(plan, b.lane, b.x, b.x + b.w)) problems.add(`${where('bumps', i, b.lane, b.x)} is not on solid floor: there is a gap under it.`); });
  def.gates.forEach((g, i) => {
    inside('gates', i, g.lane, g.x, g.x + g.w);
    if (Math.abs(g.to - g.lane) !== 1) problems.add(`${where('gates', i, g.lane, g.x)} must join neighbouring lanes (the back and front lanes only meet through the middle one).`);
    for (const l of [g.lane, g.to]) if (!solid(plan, l, g.x, g.x + g.w)) problems.add(`${where('gates', i, g.lane, g.x)} needs solid floor under it in the ${LANE_NAME[l]} too: there is a gap.`);
  });
  def.ledges.forEach((l, i) => inside('ledges', i, l.lane, l.x, l.x + l.w));
  def.itemBoxes.forEach((b, i) => inside('itemBoxes', i, b.lane, b.x, b.x));
  def.wreckers.forEach((w, i) => { inside('wreckers', i, w.lane, w.x, w.x); const f = floorAt(plan, w.lane, w.x); if (f === null) problems.add(`${where('wreckers', i, w.lane, w.x)} hangs over a gap: it needs floor to swing over.`); else if (w.pivotY + w.chain > f + 10) problems.add(`${where('wreckers', i, w.lane, w.x)} swings into the floor: raise its gantry or shorten its chain.`); });

  // Nothing overlaps: in one lane, the things that sit on the track keep a gap between them.
  type Span = { kind: Kind; i: number; lane: number; x0: number; x1: number };
  const spans: Span[] = [
    ...def.springs.map((s, i) => ({ kind: 'springs' as Kind, i, lane: s.lane, x0: s.x, x1: s.x + SPRING_W })),
    ...def.boosts.map((b, i) => ({ kind: 'boosts' as Kind, i, lane: b.lane, x0: b.x, x1: b.x + b.w })),
    ...def.bumps.map((b, i) => ({ kind: 'bumps' as Kind, i, lane: b.lane, x0: b.x, x1: b.x + b.w })),
    ...def.wreckers.map((w, i) => ({ kind: 'wreckers' as Kind, i, lane: w.lane, x0: w.x - w.chain * 0.4, x1: w.x + w.chain * 0.4 })),
    ...def.gates.flatMap((g, i) => [g.lane, g.to].map((l) => ({ kind: 'gates' as Kind, i, lane: l, x0: g.x, x1: g.x + g.w }))),
  ];
  for (let a = 0; a < spans.length; a++) for (let b = a + 1; b < spans.length; b++) {
    const s = spans[a], t = spans[b];
    if (s.lane !== t.lane || (s.kind === t.kind && s.i === t.i)) continue;
    if (s.x1 + GAP > t.x0 && t.x1 + GAP > s.x0) problems.add(`${where(s.kind, s.i, s.lane, s.x0)} overlaps ${where(t.kind, t.i, t.lane, t.x0)}: keep them at least ${GAP} px apart.`);
  }
  def.ledges.forEach((l, i) => def.ledges.forEach((o, j) => { if (j > i && o.lane === l.lane && o.x < l.x + l.w && l.x < o.x + o.w) problems.add(`${where('ledges', i, l.lane, l.x)} overlaps ${where('ledges', j, o.lane, o.x)}.`); }));

  return problems.list.length ? { ok: false, errors: problems.list } : { ok: true, def };
}

// ------------------------------------------------------------------ registry: custom courses race like official ones

/** The pick id of a custom course made from `key` (a saved course's id): `platformer:my-<key>`. */
export const customCourseId = (key: string) => `my-${key}`;

/** Make a validated def raceable under `platformer:my-<key>`. Returns the course id (without the `platformer:` prefix). */
export function registerPlatformerDef(key: string, def: PlatformerDef): string {
  const id = customCourseId(key);
  registerCustomCourse({ id, name: def.name, blurb: `Made in the Workshop. ${def.style === 'flow' ? 'Rolling slopes' : 'Blocks'}, ${Math.round(def.length / 1000)} km of lanes, ${def.gates.length} gates.`, seed: def.seed, length: def.length, flow: def.style === 'flow', def, plan: () => planFromDef(def) });
  return id;
}
