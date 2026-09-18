/**
 * MB-01. The track definition format (`TrackDef`) and its loader.
 *
 * Every circuit in the game is a list of `Builder` calls: `generateTrack` picks sectors with the seeded RNG and
 * pushes their bodies through the builder. A `TrackDef` is a versioned, JSON-safe **recording of exactly those
 * calls**, so
 *
 *     buildTrackFromDef(generateTrackDef(seed, profile))   ===   generateTrack(seed, profile)
 *
 * body for body — same count, same kinds, same positions, same angles, same RNG-rolled details (peg colours,
 * dropped items, wrecking-ball phases, spinner angles). That identity is what makes a procedural circuit an
 * editable starting point (MB-02…MB-09) without touching physics or rendering: collisions stay in the builder,
 * art stays in the skin.
 *
 * The start grid/gate and the finish stub are deliberately *not* part of a def. `buildTrackFromDef` always
 * synthesises them (`segStart`/`segFinish`), so every track starts and ends the same way and a def only
 * describes the part a player designs. Stored pieces use the generator's own coordinates, and `flip` mirrors a
 * piece about the centre line (`x → W − x`): the generator flips whole sectors, so a recording keeps the flag
 * instead of pre-mirroring every coordinate, which is what makes the replay exact. An editor-authored piece
 * simply leaves `flip` unset and is placed in world coordinates.
 */
import { ITEM_TYPES, THEME_IDS, themeFor, themeIdFor } from './types';
import type { ItemType, ThemeId, TrackProfile } from './types';
import { Builder, DEFAULT_PROFILE, FINISH_H, GATE_TOP, START_H, T, W, assembleTrack, meta, segFinish, segStart } from './track';
import type { Kind, PegColor, SegmentInfo, Track } from './track';

/** Only version 1 exists. A def from a newer build is refused rather than guessed at. */
export const TRACKDEF_VERSION = 1;

/** Defs from share codes and the network are never trusted: these are the hard ceilings the loader enforces. */
export const MAX_PIECES = 6000;
export const MAX_HEIGHT = 100_000;
export const MAX_SEGMENTS = 256;
/** Longest name we will store or show for a track. */
export const MAX_NAME = 48;

export type Vec = [number, number];

/** `flip` mirrors a piece about the track's centre line, exactly like `Builder.flip`. Unset = world coordinates. */
export interface PieceBase {
  flip?: boolean;
}

export interface RampPiece extends PieceBase { t: 'ramp'; a: Vec; b: Vec }
export interface CurvePiece extends PieceBase { t: 'curve'; a: Vec; c: Vec; b: Vec; n?: number }
export interface IcePiece extends PieceBase { t: 'ice'; a: Vec; b: Vec }
export interface LoopPiece extends PieceBase { t: 'loop'; x: number; bottom: number; r: number }
export interface HoopPiece extends PieceBase { t: 'hoop'; x: number; y: number; dir: Vec }
export interface WreckerPiece extends PieceBase { t: 'wrecker'; pivot: Vec; chain: number; amp: number; speed: number; phase?: number }
export interface PadPiece extends PieceBase { t: 'pad'; x: number; y: number; w: number; dir: -1 | 1 }
export interface BoostPiece extends PieceBase { t: 'boost'; x: number; y: number; len: number; thick: number; dir: Vec }
export interface SpinnerPiece extends PieceBase { t: 'spinner'; x: number; y: number; len: number; speed: number; angle?: number }
export interface BreakablePiece extends PieceBase { t: 'breakable'; x: number; y: number; w: number; h: number; req: number }
export interface PegPiece extends PieceBase { t: 'peg'; x: number; y: number; r: number }
export interface PPegPiece extends PieceBase { t: 'ppeg'; x: number; y: number; color: PegColor; r: number; item?: ItemType }
export interface ItemBoxPiece extends PieceBase { t: 'itembox'; x: number; y: number }
export interface BucketPiece extends PieceBase { t: 'bucket'; y: number; phase?: number }
export interface WallPiece extends PieceBase { t: 'wall'; x: number; y: number; w: number; h: number }
export interface BlockPiece extends PieceBase { t: 'block'; x: number; y: number; w: number; h: number }
// ---- MB-10A: shortcuts and secrets ----
/** NO ENTRY barricade over a tunnel entrance. `tough` is editor-friendly 1..10; hp derives from it. */
export interface BarricadePiece extends PieceBase { t: 'barricade'; x: number; y: number; w: number; h: number; tough: number }
/** Cliff tunnel: entrance at (x, y), exit hole at `exit`, launch dir `edir`, hidden ride `ms`, exit speed. */
export interface TunnelPiece extends PieceBase { t: 'tunnel'; x: number; y: number; exit: Vec; edir: Vec; ms: number; speed: number; two?: boolean }
/** Crumbling wall: pack-cumulative damage, permanent for the race. */
export interface CrumblePiece extends PieceBase { t: 'crumble'; x: number; y: number; w: number; h: number; tough: number }
/** Trapdoor floor: hinge side, `timer` (clock) or `weight` (pack threshold) mode. */
export interface TrapdoorPiece extends PieceBase {
  t: 'trapdoor'; x: number; y: number; w: number; hinge: -1 | 1;
  mode: 'timer' | 'weight'; open: number; closed: number; phase: number; kg: number; hold: number;
}
/** Track switch lever: plate of `len` leaning ±`angle` at a Y-junction; `side` is the initial route. */
export interface SwitchPiece extends PieceBase { t: 'switch'; x: number; y: number; len: number; angle: number; side: 0 | 1 }

export type Piece =
  | RampPiece | CurvePiece | IcePiece | LoopPiece | HoopPiece | WreckerPiece | PadPiece | BoostPiece
  | SpinnerPiece | BreakablePiece | PegPiece | PPegPiece | ItemBoxPiece | BucketPiece | WallPiece | BlockPiece
  | BarricadePiece | TunnelPiece | CrumblePiece | TrapdoorPiece | SwitchPiece;

export interface TrackDef {
  v: 1;
  name: string;
  /**
   * The generator seed. Art that never moves — torches, balconies, cliff and crowd skins — is hashed from
   * `Track.seed`, so keeping it in the def is what makes a rebuilt circuit *look* like the original too.
   * Optional; 0 when a hand-authored def does not care.
   */
  seed?: number;
  theme: ThemeId;
  /** Total height of the circuit. The finish stub always occupies its last `FINISH_H` pixels. */
  height: number;
  /** Sector list for the HUD, minimap and story hooks. Omitted defs get Start/Custom/Finish. */
  segments?: SegmentInfo[];
  pieces: Piece[];
}

/**
 * Drops keys that hold `undefined`, so a def compares equal to itself after `JSON.parse(JSON.stringify(def))` —
 * share codes and saves must not turn an unused optional field into a difference.
 */
function compact<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

// ---------------------------------------------------------------- recording

/**
 * A `Builder` that records the calls the generator makes between `beginDefinition()` and `endDefinition()`.
 * Composite calls (`curve`, `ice`, `scatterPegs`, `boostOnRamp`) record as the primitive pieces they emit, so
 * the def stays editable piece by piece. Anything the builder can do but a def cannot express (a `gate` wall, a
 * differently-thick ramp) throws here rather than silently dropping geometry out of the recording.
 */
class DefRecorder extends Builder {
  pieces: Piece[] = [];
  private capturing = false;
  /** Set while running a composite's own builder calls: they belong to the piece being recorded, not to new ones. */
  private quiet = false;

  override beginDefinition() { this.capturing = true; }
  override endDefinition() { this.capturing = false; }

  private capture<T>(build: () => T, piece: () => Piece): T {
    if (this.quiet || !this.capturing) return build();
    this.quiet = true;
    try {
      const out = build();
      this.pieces.push(piece());
      return out;
    } finally {
      this.quiet = false;
    }
  }

  private get mirrored(): boolean | undefined {
    return this.flip ? true : undefined;
  }

  override wall(cx: number, cy: number, w: number, h: number, kind: Kind = 'wall') {
    if (this.quiet || !this.capturing) return super.wall(cx, cy, w, h, kind);
    if (kind !== 'wall') throw new Error(`TrackDef cannot express a '${kind}' wall; extend src/game/trackdef.ts before a sector adds one.`);
    return this.capture(() => super.wall(cx, cy, w, h, kind), () => ({ t: 'wall', x: cx, y: cy, w, h, flip: this.mirrored }));
  }

  override block(x: number, y: number, w: number, h: number) {
    return this.capture(() => super.block(x, y, w, h), () => ({ t: 'block', x, y, w, h, flip: this.mirrored }));
  }

  override ramp(x1: number, y1: number, x2: number, y2: number, thickness = T, kind: Kind = 'ramp') {
    if (this.quiet || !this.capturing) return super.ramp(x1, y1, x2, y2, thickness, kind);
    if (kind !== 'ramp') throw new Error(`TrackDef cannot express a '${kind}' ramp; extend src/game/trackdef.ts before a sector adds one.`);
    if (thickness !== T) throw new Error(`TrackDef cannot express a ${thickness}px ramp; extend src/game/trackdef.ts before a sector adds one.`);
    return this.capture(() => super.ramp(x1, y1, x2, y2, thickness, kind), () => ({ t: 'ramp', a: [x1, y1], b: [x2, y2], flip: this.mirrored }));
  }

  override ice(x1: number, y1: number, x2: number, y2: number) {
    return this.capture(() => super.ice(x1, y1, x2, y2), () => ({ t: 'ice', a: [x1, y1], b: [x2, y2], flip: this.mirrored }));
  }

  override curve(x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, pieces = 12) {
    return this.capture(() => super.curve(x0, y0, cx, cy, x1, y1, pieces), () => ({ t: 'curve', a: [x0, y0], c: [cx, cy], b: [x1, y1], n: pieces, flip: this.mirrored }));
  }

  override loop(cx: number, bottomY: number, r: number) {
    return this.capture(() => super.loop(cx, bottomY, r), () => ({ t: 'loop', x: cx, bottom: bottomY, r, flip: this.mirrored }));
  }

  override hoop(x: number, y: number, dirX: number, dirY: number) {
    return this.capture(() => super.hoop(x, y, dirX, dirY), () => ({ t: 'hoop', x, y, dir: [dirX, dirY], flip: this.mirrored }));
  }

  override wrecker(px: number, py: number, chain: number, amp: number, speed: number) {
    if (this.quiet || !this.capturing) return super.wrecker(px, py, chain, amp, speed);
    // The phase is a rolled value, not a parameter: roll it here (same RNG draw, same order) and record it.
    const phase = this.rollPhase();
    return this.capture(() => super.wrecker(px, py, chain, amp, speed, phase), () => ({ t: 'wrecker', pivot: [px, py], chain, amp, speed, phase, flip: this.mirrored }));
  }

  override pad(cx: number, topY: number, w: number, launchDirX: number) {
    return this.capture(() => super.pad(cx, topY, w, launchDirX), () => ({ t: 'pad', x: cx, y: topY, w, dir: launchDirX < 0 ? -1 : 1, flip: this.mirrored }));
  }

  override boost(cx: number, cy: number, len: number, thick: number, dirX: number, dirY: number) {
    return this.capture(() => super.boost(cx, cy, len, thick, dirX, dirY), () => ({ t: 'boost', x: cx, y: cy, len, thick, dir: [dirX, dirY], flip: this.mirrored }));
  }

  override spinner(cx: number, cy: number, len: number, speed: number) {
    return this.capture(() => super.spinner(cx, cy, len, speed), () => ({ t: 'spinner', x: cx, y: cy, len, speed, flip: this.mirrored }));
  }

  override breakable(cx: number, cy: number, w: number, h: number, reqWeight: number) {
    return this.capture(() => super.breakable(cx, cy, w, h, reqWeight), () => ({ t: 'breakable', x: cx, y: cy, w, h, req: reqWeight, flip: this.mirrored }));
  }

  override peg(x: number, y: number, r = 11) {
    return this.capture(() => super.peg(x, y, r), () => ({ t: 'peg', x, y, r, flip: this.mirrored }));
  }

  override ppeg(x: number, y: number, color: PegColor, r = 10) {
    if (this.quiet || !this.capturing) return super.ppeg(x, y, color, r);
    // Glowing pegs drop a rolled item: roll it here (same draw, same order) and record it.
    const item = color === 'green' ? this.rollItem() : undefined;
    return this.capture(() => super.ppeg(x, y, color, r, item), () => ({ t: 'ppeg', x, y, color, r, item, flip: this.mirrored }));
  }

  override itemBox(x: number, y: number) {
    return this.capture(() => super.itemBox(x, y), () => ({ t: 'itembox', x, y, flip: this.mirrored }));
  }

  override bucket(y: number, phase: number) {
    return this.capture(() => super.bucket(y, phase), () => ({ t: 'bucket', y, phase, flip: this.mirrored }));
  }

  // ---- MB-10A ----

  override barricade(cx: number, cy: number, w: number, h: number, tough = 5) {
    return this.capture(() => super.barricade(cx, cy, w, h, tough), () => ({ t: 'barricade', x: cx, y: cy, w, h, tough, flip: this.mirrored }));
  }

  override tunnel(x: number, y: number, exitX: number, exitY: number, dirX: number, dirY: number, transit = 900, speed = 7, twoWay = false) {
    return this.capture(
      () => super.tunnel(x, y, exitX, exitY, dirX, dirY, transit, speed, twoWay),
      () => compact({ t: 'tunnel', x, y, exit: [exitX, exitY] as Vec, edir: [dirX, dirY] as Vec, ms: transit, speed, two: twoWay || undefined, flip: this.mirrored }),
    );
  }

  override crumble(cx: number, cy: number, w: number, h: number, tough = 6) {
    return this.capture(() => super.crumble(cx, cy, w, h, tough), () => ({ t: 'crumble', x: cx, y: cy, w, h, tough, flip: this.mirrored }));
  }

  override trapdoor(cx: number, y: number, w: number, hinge: -1 | 1 = -1, mode: 'timer' | 'weight' = 'timer', openMs = 1400, closedMs = 2800, phase = 0, kg = 2.4, holdMs = 300) {
    return this.capture(
      () => super.trapdoor(cx, y, w, hinge, mode, openMs, closedMs, phase, kg, holdMs),
      () => ({ t: 'trapdoor', x: cx, y, w, hinge, mode, open: openMs, closed: closedMs, phase, kg, hold: holdMs, flip: this.mirrored }),
    );
  }

  override switchLever(x: number, y: number, len = 120, angle = 0.65, side: 0 | 1 = 0) {
    return this.capture(() => super.switchLever(x, y, len, angle, side), () => ({ t: 'switch', x, y, len, angle, side, flip: this.mirrored }));
  }

  /** Spinners start at a rolled angle; stamp the angles the builder picked onto the pieces already recorded. */
  override randomiseSpinners() {
    super.randomiseSpinners();
    const recorded = this.pieces.filter((piece): piece is SpinnerPiece => piece.t === 'spinner');
    this.spinners.forEach((blade, index) => {
      const piece = recorded[index];
      if (piece) piece.angle = blade.angle;
    });
  }
}

/**
 * Records a procedural circuit as a def. `name` is the display name the editor and share codes show; pass the
 * Grand Prix name when the circuit came from the calendar.
 */
export function generateTrackDef(seed: number, profile: TrackProfile = DEFAULT_PROFILE, name = 'Untitled circuit'): TrackDef {
  const recorder = new DefRecorder(seed);
  const track = assembleTrack(recorder, seed, profile);
  return compact({
    v: TRACKDEF_VERSION,
    name: name.slice(0, MAX_NAME),
    seed,
    theme: themeIdFor(profile.theme),
    height: track.height,
    segments: track.segments.map((s) => ({ ...s })),
    pieces: recorder.pieces.map(compact),
  });
}

// ---------------------------------------------------------------- replay

function replayPiece(b: Builder, piece: Piece) {
  b.flip = piece.flip === true;
  try {
    switch (piece.t) {
      case 'ramp': b.ramp(piece.a[0], piece.a[1], piece.b[0], piece.b[1]); break;
      case 'curve': b.curve(piece.a[0], piece.a[1], piece.c[0], piece.c[1], piece.b[0], piece.b[1], piece.n ?? 12); break;
      case 'ice': b.ice(piece.a[0], piece.a[1], piece.b[0], piece.b[1]); break;
      case 'loop': b.loop(piece.x, piece.bottom, piece.r); break;
      case 'hoop': b.hoop(piece.x, piece.y, piece.dir[0], piece.dir[1]); break;
      case 'wrecker': b.wrecker(piece.pivot[0], piece.pivot[1], piece.chain, piece.amp, piece.speed, piece.phase); break;
      case 'pad': b.pad(piece.x, piece.y, piece.w, piece.dir); break;
      case 'boost': b.boost(piece.x, piece.y, piece.len, piece.thick, piece.dir[0], piece.dir[1]); break;
      case 'spinner': b.spinner(piece.x, piece.y, piece.len, piece.speed, piece.angle); break;
      case 'breakable': b.breakable(piece.x, piece.y, piece.w, piece.h, piece.req); break;
      case 'peg': b.peg(piece.x, piece.y, piece.r); break;
      case 'ppeg': b.ppeg(piece.x, piece.y, piece.color, piece.r, piece.item); break;
      case 'itembox': b.itemBox(piece.x, piece.y); break;
      case 'bucket': b.bucket(piece.y, piece.phase ?? 0); break;
      case 'wall': b.wall(piece.x, piece.y, piece.w, piece.h); break;
      case 'block': b.block(piece.x, piece.y, piece.w, piece.h); break;
      // ---- MB-10A ----
      case 'barricade': b.barricade(piece.x, piece.y, piece.w, piece.h, piece.tough); break;
      case 'tunnel': b.tunnel(piece.x, piece.y, piece.exit[0], piece.exit[1], piece.edir[0], piece.edir[1], piece.ms, piece.speed, piece.two === true); break;
      case 'crumble': b.crumble(piece.x, piece.y, piece.w, piece.h, piece.tough); break;
      case 'trapdoor': b.trapdoor(piece.x, piece.y, piece.w, piece.hinge, piece.mode, piece.open, piece.closed, piece.phase, piece.kg, piece.hold); break;
      case 'switch': b.switchLever(piece.x, piece.y, piece.len, piece.angle, piece.side); break;
    }
  } finally {
    b.flip = false;
  }
}

/**
 * Builds a `Track` from a def: the start grid and gate, every stored piece, then the finish stub and the outer
 * walls — the same order, and the same calls, as `generateTrack`. Malformed input never gets this far; a def
 * that fails validation throws a `TrackDefError` carrying the readable reasons.
 */
export function buildTrackFromDef(value: unknown): Track {
  const check = validateTrackDef(value);
  if (!check.ok) throw new TrackDefError(check.errors);
  const def = check.def;

  const b = new Builder(def.seed ?? 0);
  const startY = GATE_TOP - 14;
  const hStart = segStart(b, 0);
  for (const piece of def.pieces) replayPiece(b, piece);

  // The finish always closes the circuit: its stub occupies the last FINISH_H of the stored height.
  const finishTop = def.height - FINISH_H;
  const finishY = finishTop + 40;
  segFinish(b, finishTop);

  b.flip = false;
  b.wall(-20, def.height / 2, 40, def.height + 400);
  b.wall(W + 20, def.height / 2, 40, def.height + 400);
  b.wall(W / 2, -30, W, 20);

  const gate = b.bodies.find((body) => meta(body).kind === 'gate')!;
  const segments: SegmentInfo[] = def.segments?.length
    ? def.segments.map((s) => ({ ...s }))
    : [
      { name: 'Start', y: 0, h: hStart },
      { name: 'Custom', y: hStart, h: Math.max(1, finishTop - hStart) },
      { name: 'Finish', y: finishTop, h: FINISH_H },
    ];

  return {
    seed: def.seed ?? 0,
    bodies: b.bodies,
    height: def.height,
    segments,
    spinners: b.spinners,
    itemBoxes: b.itemBoxes,
    ramps: b.bodies.filter((body) => !!meta(body).surface),
    buckets: b.buckets,
    pegCount: b.pegCount,
    gate,
    startY,
    finishY,
    theme: themeFor(def.theme),
    decor: b.decor,
    wreckers: b.wreckers,
  };
}

// ---------------------------------------------------------------- validation

export class TrackDefError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`Track definition rejected: ${errors.join(' ')}`);
    this.name = 'TrackDefError';
    this.errors = errors;
  }
}

export type TrackDefCheck = { ok: true; def: TrackDef } | { ok: false; error: string; errors: string[] };

/** How many problems we report before collapsing the rest: enough to fix a share code, short enough to read. */
const MAX_REPORTED = 12;

/** Collects readable problems while a def is parsed. */
class Problems {
  readonly list: string[] = [];
  private hidden = 0;

  add(message: string) {
    if (this.list.length < MAX_REPORTED) this.list.push(message);
    else this.hidden++;
  }

  get failed() {
    return this.list.length > 0 || this.hidden > 0;
  }

  report(): string {
    return this.hidden ? `${this.list.join(' ')} (+${this.hidden} more)` : this.list.join(' ');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateTrackDef(value: unknown): TrackDefCheck {
  const problems = new Problems();
  const reject = (): TrackDefCheck => ({ ok: false, error: problems.report(), errors: [...problems.list] });

  if (!isRecord(value)) {
    problems.add('A track definition must be a JSON object.');
    return reject();
  }
  if (value.v !== TRACKDEF_VERSION) {
    problems.add(`Unsupported track definition version ${JSON.stringify(value.v)}; this build reads version ${TRACKDEF_VERSION}.`);
    return reject();
  }

  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name) problems.add('name must be a non-empty string.');
  else if (name.length > MAX_NAME) problems.add(`name is ${name.length} characters; the limit is ${MAX_NAME}.`);

  const theme = typeof value.theme === 'string' && (THEME_IDS as string[]).includes(value.theme)
    ? value.theme as ThemeId
    : undefined;
  if (theme === undefined) problems.add(`theme must be one of ${THEME_IDS.join(', ')}.`);

  const seed = value.seed === undefined ? 0 : number(value.seed, 'seed', 0, 0xffffffff, problems);
  const height = number(value.height, 'height', START_H + FINISH_H, MAX_HEIGHT, problems);

  const segments = value.segments === undefined ? undefined : parseSegments(value.segments, problems);

  const pieces: Piece[] = [];
  if (!Array.isArray(value.pieces)) {
    problems.add('pieces must be an array.');
  } else if (value.pieces.length > MAX_PIECES) {
    problems.add(`pieces has ${value.pieces.length} entries; the limit is ${MAX_PIECES}.`);
  } else {
    value.pieces.forEach((raw, index) => {
      const piece = parsePiece(raw, `pieces[${index}]`, problems);
      if (piece) pieces.push(piece);
    });
  }

  if (problems.failed) return reject();

  // Sizes, positions and heights are only meaningful once every number is known to be finite.
  for (const piece of pieces) {
    for (const y of pieceYs(piece)) {
      if (y > height) {
        problems.add(`A ${piece.t} piece sits at y=${round(y)}, below the circuit's height of ${height}.`);
        break;
      }
    }
  }
  if (problems.failed) return reject();

  return {
    ok: true,
    def: compact({
      v: TRACKDEF_VERSION,
      name: name.slice(0, MAX_NAME),
      seed: Math.floor(seed),
      theme: theme!,
      height,
      ...(segments ? { segments } : {}),
      pieces: pieces.map(compact),
    }),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function number(value: unknown, at: string, min: number, max: number, problems: Problems): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.add(`${at} must be a finite number.`);
    return NaN;
  }
  if (value < min || value > max) {
    problems.add(`${at} is ${round(value)}; expected ${min}..${max}.`);
    return NaN;
  }
  return value;
}

function real(value: unknown, at: string, problems: Problems): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.add(`${at} must be a finite number.`);
    return NaN;
  }
  return value;
}

/** A `[x, y]` pair: x lives inside the pipe, y inside the circuit. */
function vec(value: unknown, at: string, problems: Problems): Vec {
  if (!Array.isArray(value) || value.length !== 2) {
    problems.add(`${at} must be [x, y].`);
    return [NaN, NaN];
  }
  return [number(value[0], `${at}[0]`, 0, W, problems), real(value[1], `${at}[1]`, problems)];
}

/** A direction or boost vector. The builder normalises it, so only zero and nonsense are rejected. */
function direction(value: unknown, at: string, problems: Problems): Vec {
  if (!Array.isArray(value) || value.length !== 2) {
    problems.add(`${at} must be [dx, dy].`);
    return [NaN, NaN];
  }
  const dx = number(value[0], `${at}[0]`, -100, 100, problems);
  const dy = number(value[1], `${at}[1]`, -100, 100, problems);
  if (dx === 0 && dy === 0) problems.add(`${at} must not be [0, 0].`);
  return [dx, dy];
}

function flip(value: unknown, at: string, problems: Problems): boolean | undefined {
  if (value === undefined || typeof value === 'boolean') return value === true ? true : undefined;
  problems.add(`${at} must be true or false when present.`);
  return undefined;
}

function parseSegments(value: unknown, problems: Problems): SegmentInfo[] | undefined {
  if (!Array.isArray(value)) {
    problems.add('segments must be an array of { name, y, h }.');
    return undefined;
  }
  if (value.length > MAX_SEGMENTS) {
    problems.add(`segments has ${value.length} entries; the limit is ${MAX_SEGMENTS}.`);
    return undefined;
  }
  const segments: SegmentInfo[] = [];
  value.forEach((raw, index) => {
    const at = `segments[${index}]`;
    if (!isRecord(raw)) {
      problems.add(`${at} must be an object.`);
      return;
    }
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_NAME) : '';
    if (!name) problems.add(`${at}.name must be a non-empty string.`);
    segments.push({ name, y: number(raw.y, `${at}.y`, 0, MAX_HEIGHT, problems), h: number(raw.h, `${at}.h`, 1, MAX_HEIGHT, problems) });
  });
  return segments;
}

function parsePiece(raw: unknown, at: string, problems: Problems): Piece | null {
  if (!isRecord(raw)) {
    problems.add(`${at} must be an object.`);
    return null;
  }
  const mirror = flip(raw.flip, `${at}.flip`, problems);
  const body = mirror ? { flip: true } : {};
  switch (raw.t) {
    case 'ramp':
      return { t: 'ramp', a: vec(raw.a, `${at}.a`, problems), b: vec(raw.b, `${at}.b`, problems), ...body };
    case 'ice':
      return { t: 'ice', a: vec(raw.a, `${at}.a`, problems), b: vec(raw.b, `${at}.b`, problems), ...body };
    case 'curve':
      return {
        t: 'curve',
        a: vec(raw.a, `${at}.a`, problems),
        c: vec(raw.c, `${at}.c`, problems),
        b: vec(raw.b, `${at}.b`, problems),
        n: raw.n === undefined ? undefined : Math.round(number(raw.n, `${at}.n`, 2, 64, problems)),
        ...body,
      };
    case 'loop':
      return { t: 'loop', x: number(raw.x, `${at}.x`, 0, W, problems), bottom: real(raw.bottom, `${at}.bottom`, problems), r: number(raw.r, `${at}.r`, 40, 300, problems), ...body };
    case 'hoop':
      return { t: 'hoop', x: number(raw.x, `${at}.x`, 0, W, problems), y: real(raw.y, `${at}.y`, problems), dir: direction(raw.dir, `${at}.dir`, problems), ...body };
    case 'wrecker':
      return {
        t: 'wrecker',
        pivot: vec(raw.pivot, `${at}.pivot`, problems),
        chain: number(raw.chain, `${at}.chain`, 1, 2000, problems),
        amp: number(raw.amp, `${at}.amp`, 0.01, Math.PI / 2, problems),
        speed: number(raw.speed, `${at}.speed`, 0, 0.2, problems),
        phase: raw.phase === undefined ? undefined : real(raw.phase, `${at}.phase`, problems),
        ...body,
      };
    case 'pad': {
      const dir = raw.dir === -1 || raw.dir === 1 ? raw.dir : undefined;
      if (dir === undefined) problems.add(`${at}.dir must be -1 or 1.`);
      return { t: 'pad', x: number(raw.x, `${at}.x`, 0, W, problems), y: real(raw.y, `${at}.y`, problems), w: number(raw.w, `${at}.w`, 8, W, problems), dir: dir ?? 1, ...body };
    }
    case 'boost':
      return {
        t: 'boost',
        x: number(raw.x, `${at}.x`, 0, W, problems),
        y: real(raw.y, `${at}.y`, problems),
        len: number(raw.len, `${at}.len`, 8, 4000, problems),
        thick: number(raw.thick, `${at}.thick`, 4, 400, problems),
        dir: direction(raw.dir, `${at}.dir`, problems),
        ...body,
      };
    case 'spinner':
      return {
        t: 'spinner',
        x: number(raw.x, `${at}.x`, 0, W, problems),
        y: real(raw.y, `${at}.y`, problems),
        len: number(raw.len, `${at}.len`, 20, W, problems),
        speed: number(raw.speed, `${at}.speed`, -0.5, 0.5, problems),
        angle: raw.angle === undefined ? undefined : real(raw.angle, `${at}.angle`, problems),
        ...body,
      };
    case 'breakable':
      return {
        t: 'breakable',
        x: number(raw.x, `${at}.x`, 0, W, problems),
        y: real(raw.y, `${at}.y`, problems),
        w: number(raw.w, `${at}.w`, 8, W, problems),
        h: number(raw.h, `${at}.h`, 8, 4000, problems),
        req: number(raw.req, `${at}.req`, 1, 10, problems),
        ...body,
      };
    case 'peg':
      return { t: 'peg', x: number(raw.x, `${at}.x`, 0, W, problems), y: real(raw.y, `${at}.y`, problems), r: number(raw.r, `${at}.r`, 2, 100, problems), ...body };
    case 'ppeg': {
      const color = raw.color === 'blue' || raw.color === 'orange' || raw.color === 'green' ? raw.color : undefined;
      if (!color) problems.add(`${at}.color must be blue, orange or green.`);
      const item = raw.item === undefined
        ? undefined
        : (ITEM_TYPES as readonly string[]).includes(raw.item as string) ? raw.item as ItemType : undefined;
      if (raw.item !== undefined && item === undefined) problems.add(`${at}.item must be one of ${ITEM_TYPES.join(', ')}.`);
      return { t: 'ppeg', x: number(raw.x, `${at}.x`, 0, W, problems), y: real(raw.y, `${at}.y`, problems), color: color ?? 'blue', r: number(raw.r, `${at}.r`, 2, 100, problems), item, ...body };
    }
    case 'itembox':
      return { t: 'itembox', x: number(raw.x, `${at}.x`, 0, W, problems), y: real(raw.y, `${at}.y`, problems), ...body };
    case 'bucket':
      return { t: 'bucket', y: real(raw.y, `${at}.y`, problems), phase: raw.phase === undefined ? undefined : real(raw.phase, `${at}.phase`, problems), ...body };
    case 'wall':
    case 'block':
      return {
        t: raw.t,
        x: number(raw.x, `${at}.x`, 0, W, problems),
        y: real(raw.y, `${at}.y`, problems),
        w: number(raw.w, `${at}.w`, 2, 4000, problems),
        h: number(raw.h, `${at}.h`, 2, 4000, problems),
        ...body,
      };
    // ---- MB-10A ----
    case 'barricade':
      return {
        t: 'barricade',
        x: number(raw.x, `${at}.x`, 0, W, problems),
        y: real(raw.y, `${at}.y`, problems),
        w: number(raw.w, `${at}.w`, 8, W, problems),
        h: number(raw.h, `${at}.h`, 8, 2000, problems),
        tough: number(raw.tough, `${at}.tough`, 1, 10, problems),
        ...body,
      };
    case 'crumble':
      return {
        t: 'crumble',
        x: number(raw.x, `${at}.x`, 0, W, problems),
        y: real(raw.y, `${at}.y`, problems),
        w: number(raw.w, `${at}.w`, 8, W, problems),
        h: number(raw.h, `${at}.h`, 8, 2000, problems),
        tough: number(raw.tough, `${at}.tough`, 1, 10, problems),
        ...body,
      };
    case 'tunnel': {
      const two = raw.two === undefined ? undefined : raw.two === true ? true : undefined;
      if (raw.two !== undefined && two === undefined) problems.add(`${at}.two must be true when present.`);
      return compact({
        t: 'tunnel' as const,
        x: number(raw.x, `${at}.x`, 0, W, problems),
        y: real(raw.y, `${at}.y`, problems),
        exit: vec(raw.exit, `${at}.exit`, problems),
        edir: direction(raw.edir, `${at}.edir`, problems),
        ms: number(raw.ms, `${at}.ms`, 100, 20000, problems),
        speed: number(raw.speed, `${at}.speed`, 0, 30, problems),
        two,
        ...body,
      });
    }
    case 'trapdoor': {
      const hinge = raw.hinge === -1 || raw.hinge === 1 ? raw.hinge : undefined;
      if (hinge === undefined) problems.add(`${at}.hinge must be -1 (left) or 1 (right).`);
      const mode = raw.mode === 'timer' || raw.mode === 'weight' ? raw.mode : undefined;
      if (mode === undefined) problems.add(`${at}.mode must be 'timer' or 'weight'.`);
      return {
        t: 'trapdoor',
        x: number(raw.x, `${at}.x`, 0, W, problems),
        y: real(raw.y, `${at}.y`, problems),
        w: number(raw.w, `${at}.w`, 40, W, problems),
        hinge: hinge ?? 1,
        mode: mode ?? 'timer',
        open: number(raw.open, `${at}.open`, 200, 20000, problems),
        closed: number(raw.closed, `${at}.closed`, 200, 20000, problems),
        phase: real(raw.phase, `${at}.phase`, problems),
        kg: number(raw.kg, `${at}.kg`, 0.1, 50, problems),
        hold: number(raw.hold, `${at}.hold`, 0, 5000, problems),
        ...body,
      };
    }
    case 'switch': {
      const side = raw.side === 0 || raw.side === 1 ? raw.side : undefined;
      if (side === undefined) problems.add(`${at}.side must be 0 (left) or 1 (right).`);
      return {
        t: 'switch',
        x: number(raw.x, `${at}.x`, 0, W, problems),
        y: real(raw.y, `${at}.y`, problems),
        len: number(raw.len, `${at}.len`, 40, 400, problems),
        angle: number(raw.angle, `${at}.angle`, 0.1, 1.35, problems),
        side: side ?? 0,
        ...body,
      };
    }
    default:
      problems.add(`${at}.t is unknown piece type ${JSON.stringify(raw.t)}.`);
      return null;
  }
}

/** Every y a piece touches, used to keep stored geometry inside the declared height. */
function pieceYs(piece: Piece): number[] {
  switch (piece.t) {
    case 'ramp':
    case 'ice':
    case 'curve':
      return [piece.a[1], piece.b[1], ...(piece.t === 'curve' ? [piece.c[1]] : [])];
    case 'loop':
      return [piece.bottom - piece.r * 2, piece.bottom];
    case 'tunnel':
      return [piece.y, piece.exit[1]];
    case 'switch':
      return [piece.y - piece.len, piece.y];
    case 'hoop':
    case 'spinner':
    case 'breakable':
    case 'peg':
    case 'ppeg':
    case 'itembox':
    case 'wall':
    case 'block':
    case 'boost':
    case 'pad':
    case 'barricade':
    case 'crumble':
    case 'trapdoor':
      return [piece.y];
    case 'wrecker':
      return [piece.pivot[1] + piece.chain];
    case 'bucket':
      return [piece.y];
  }
}
