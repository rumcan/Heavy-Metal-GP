/**
 * Scaffold tunnels: premade, long, curved tubes of wooden scaffolding, stamped into the Workshop as one group.
 *
 * Every kit is a centre line (the path a marble rides) wrapped in two rails: an inner and an outer one, a marble of
 * clearance apart. The rails are ordinary `curve` pieces (quadratic Bezier spans of ramp segments), so a kit adds no
 * physics: only the optional `skin: 'scaffold'` on each piece, which draws the planks, braces and bolts.
 * Every kit is centred on (0, 0) like a peg picture and ships its entry and exit points for the roll-through test.
 */
import type { CurvePiece, Vec } from './trackdef';
import { T } from './track';
import { MARBLE_RADIUS } from './types';

/** Distance between the two rail centre lines: a rail thickness plus a gap a marble rolls through with room to spare. */
export const TUBE_HALF = 30;
/** The clear gap between the rails' faces. Never less than this (a marble is 28 px across). */
export const TUBE_GAP = TUBE_HALF * 2 - T;

export interface ScaffoldKit {
  id: string;
  name: string;
  /** What the kit is for, one line. */
  blurb: string;
  /** The rails, centred on (0, 0), all tagged `skin: 'scaffold'` and in one group. */
  pieces: CurvePiece[];
  /** Where a marble enters and leaves (centre of the tube), in the same centred coordinates. */
  entry: Vec;
  exit: Vec;
  /** The centre line a marble rides, sampled every few pixels (centred like the rails). */
  centre: Vec[];
  /** Half the distance between the rail centre lines at each centre sample (30 in a tube, wider in a funnel). */
  half: number[];
  /** Overall size of the drawn kit (rails included). */
  width: number;
  height: number;
}

type P = [number, number];
/** A centre line sampled densely, with the half-width of the tube at each sample. */
interface Path { pts: P[]; half: number[] }

const TAU = Math.PI * 2;
const STEP = 8;

// ------------------------------------------------------------------ path building blocks
const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Lays a centre line down heading by heading, like a turtle: `run` goes straight on, `turn` bends it about a circle
 * (positive degrees turn clockwise on screen, negative anticlockwise). `half` is the tube's half-width and may change
 * along a run, which is how the funnel narrows.
 */
class PathBuilder {
  pts: P[] = [];
  half: number[] = [];
  private h: number;
  constructor(start: P, headingDeg: number, half0 = TUBE_HALF) { this.pts.push(start); this.half.push(half0); this.h = rad(headingDeg); }
  private get last(): P { return this.pts[this.pts.length - 1]; }
  private get lastHalf(): number { return this.half[this.half.length - 1]; }
  /** A straight run of `len` px, the half-width easing to `half` on the way. */
  run(len: number, half = this.lastHalf): this {
    const from = this.last, n = Math.max(1, Math.round(len / STEP)), h0 = this.lastHalf;
    for (let i = 1; i <= n; i++) {
      const u = i / n;
      this.pts.push([from[0] + Math.cos(this.h) * len * u, from[1] + Math.sin(this.h) * len * u]);
      this.half.push(h0 + (half - h0) * u);
    }
    return this;
  }
  /** A bend of `deg` degrees about a circle of radius `r`. */
  turn(r: number, deg: number): this {
    const p = this.last, sign = deg >= 0 ? 1 : -1, h = this.lastHalf;
    const theta0 = this.h - sign * Math.PI / 2;
    const c: P = [p[0] - Math.cos(theta0) * r, p[1] - Math.sin(theta0) * r];
    const sweep = rad(deg), n = Math.max(2, Math.round(Math.abs(sweep) * r / STEP));
    for (let i = 1; i <= n; i++) {
      const th = theta0 + sweep * (i / n);
      this.pts.push([c[0] + Math.cos(th) * r, c[1] + Math.sin(th) * r]);
      this.half.push(h);
    }
    this.h += sweep;
    return this;
  }
  /** A parametric run p(t), t = 0..1, `samples` points. */
  curve(p: (t: number) => P, samples: number): this {
    const h = this.lastHalf;
    for (let i = 1; i <= samples; i++) { this.pts.push(p(i / samples)); this.half.push(h); }
    const a = this.pts[this.pts.length - 2], z = this.last;
    this.h = Math.atan2(z[1] - a[1], z[0] - a[0]);
    return this;
  }
  build(): Path { return { pts: this.pts, half: this.half }; }
}

const tangentAt = (pts: P[], i: number): P => {
  const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
};

const round1 = (v: number) => Math.round(v * 10) / 10;

type Span = { a: P; c: P; b: P };

/** The quadratic Bezier point at u. */
const bez = (s: Span, u: number): P => {
  const v = 1 - u;
  return [v * v * s.a[0] + 2 * v * u * s.c[0] + u * u * s.b[0], v * v * s.a[1] + 2 * v * u * s.c[1] + u * u * s.b[1]];
};

/** Split a span at its middle (de Casteljau). */
function halves(s: Span): [Span, Span] {
  const ac: P = [(s.a[0] + s.c[0]) / 2, (s.a[1] + s.c[1]) / 2], cb: P = [(s.c[0] + s.b[0]) / 2, (s.c[1] + s.b[1]) / 2];
  const m: P = [(ac[0] + cb[0]) / 2, (ac[1] + cb[1]) / 2];
  return [{ a: s.a, c: ac, b: m }, { a: m, c: cb, b: s.b }];
}

/**
 * A `curve` piece's line is the TOP surface of a slab hanging T below it, on the lower side of the first chord
 * (Builder.curve picks the normal that points up there, then keeps it smooth). So the slab's side is not the rail's
 * to choose: for a span whose first chord heads right the slab lies to the left of travel, for one heading left to
 * the right of it, turning smoothly with the bend. This shifts a slab-centre span onto the line that puts the slab
 * exactly on it, or splits the span when its first chord is too close to vertical to tell which side it will pick.
 */
function placeSpan(s: Span, n: number, depth = 0): Span[] {
  const guess = bez(s, 1 / n);
  const dir = (guess[0] - s.a[0]) >= 0 ? 1 : -1;
  for (const sigma of [dir, -dir]) {
    const slab = (t: P): P => (sigma > 0 ? [-t[1], t[0]] : [t[1], -t[0]]);
    const shifted = (p: P, t: P): P => { const k = slab(t); return [p[0] - k[0] * T / 2, p[1] - k[1] * T / 2]; };
    const unit = (x: number, y: number): P => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
    const ta = unit(s.c[0] - s.a[0], s.c[1] - s.a[1]), tb = unit(s.b[0] - s.c[0], s.b[1] - s.c[1]);
    const out: Span = { a: shifted(s.a, ta), c: shifted(s.c, unit(ta[0] + tb[0], ta[1] + tb[1])), b: shifted(s.b, tb) };
    const chord = bez(out, 1 / n);
    const picked = (chord[0] - out.a[0]) >= 0 ? 1 : -1;
    // A chord within a hair of vertical could read either way once the body is built: do not trust it.
    if (depth >= 3 || (picked === sigma && Math.abs(chord[0] - out.a[0]) > 0.5)) return [out];
  }
  const [l, r] = halves(s);
  return [...placeSpan(l, n, depth + 1), ...placeSpan(r, n, depth + 1)];
}

/**
 * One rail: the centre line offset by `side * half` at every sample (the middle of the slab), cut into spans that
 * each turn less than 40 degrees and run no longer than 200 px, each span one quadratic `curve` piece whose control
 * point is where the tangents at its two ends meet, then shifted onto the slab's surface line.
 */
function rail(path: Path, side: 1 | -1): CurvePiece[] {
  const { pts, half } = path;
  const off: P[] = pts.map((p, i) => {
    const t = tangentAt(pts, i);
    return [p[0] - t[1] * (half[i] + T / 2) * side, p[1] + t[0] * (half[i] + T / 2) * side];
  });
  const out: CurvePiece[] = [];
  let i = 0;
  while (i < off.length - 1) {
    const t0 = tangentAt(off, i);
    let j = i + 1, len = 0;
    while (j < off.length - 1) {
      len += Math.hypot(off[j][0] - off[j - 1][0], off[j][1] - off[j - 1][1]);
      const tj = tangentAt(off, j + 1);
      const turn = Math.acos(Math.max(-1, Math.min(1, t0[0] * tj[0] + t0[1] * tj[1])));
      // Cut at a bend or a length, but only where the line is clearly not vertical: a span that starts straight down
      // gives Builder.curve no clear side to hang its slab on.
      if ((turn > 0.9 && Math.abs(tj[0]) >= 0.2) || turn > 1.5 || len > 320) break;
      j++;
    }
    const a = off[i], b = off[j], t1 = tangentAt(off, j);
    // Control point: where the end tangents cross. Parallel tangents (a straight span) use the midpoint.
    const det = t0[0] * -t1[1] - t0[1] * -t1[0];
    let c: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (Math.abs(det) > 1e-3) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const s = (dx * -t1[1] - dy * -t1[0]) / det;
      const cand: P = [a[0] + t0[0] * s, a[1] + t0[1] * s];
      if (s > 0 && Math.hypot(cand[0] - c[0], cand[1] - c[1]) < Math.hypot(dx, dy)) c = cand;
    }
    const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(4, Math.min(24, Math.ceil(chord / 16)));
    for (const span of placeSpan({ a: [a[0], a[1]], c, b: [b[0], b[1]] }, n)) {
      const sub = Math.hypot(span.b[0] - span.a[0], span.b[1] - span.a[1]);
      out.push({ t: 'curve', a: span.a, c: span.c, b: span.b, n: Math.max(4, Math.min(24, Math.ceil(sub / 16))), skin: 'scaffold', grp: 1 });
    }
    i = j;
  }
  return out;
}

/** Wrap a centre line into a kit: both rails, shifted so the whole thing is centred on (0, 0). */
function kitFrom(id: string, name: string, blurb: string, path: Path): ScaffoldKit {
  const rails = [...rail(path, 1), ...rail(path, -1)];
  const xs: number[] = [], ys: number[] = [];
  for (const r of rails) for (const v of [r.a, r.b, r.c]) { xs.push(v[0]); ys.push(v[1]); }
  const x0 = Math.min(...xs) - T / 2, x1 = Math.max(...xs) + T / 2, y0 = Math.min(...ys) - T / 2, y1 = Math.max(...ys) + T / 2;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const mv = (v: Vec): Vec => [round1(v[0] - cx), round1(v[1] - cy)];
  const first = path.pts[0], last = path.pts[path.pts.length - 1];
  return {
    id, name, blurb,
    pieces: rails.map((r) => ({ ...r, a: mv(r.a), c: mv(r.c), b: mv(r.b) })),
    entry: mv([first[0], first[1]]), exit: mv([last[0], last[1]]),
    centre: path.pts.map((p) => mv([p[0], p[1]])),
    half: path.half.map(round1),
    width: Math.round(x1 - x0), height: Math.round(y1 - y0),
  };
}

/** Mirror a path left to right (the other-handed sweeper). */
const mirrored = (p: Path): Path => ({ pts: p.pts.map(([x, y]) => [-x, y] as P), half: p.half });

// ------------------------------------------------------------------ the ten kits
// Bends never get tighter than about 60 px radius on the centre line: the inner rail is 43 px in from it.
const sweeperLeft = (): Path => new PathBuilder([300, -150], 160).curve((t) => [300 - 640 * t, -150 + 300 * t - 60 * Math.sin(Math.PI * t)], 90).build();

const sBend = (): Path => new PathBuilder([0, -380], 90).curve((t) => [150 * Math.sin(TAU * t), -380 + 760 * t], 150).build();

const uTurn = (): Path => new PathBuilder([-270, -190], 12).run(460).turn(85, 156).run(460).build();

const spiralDrop = (): Path => new PathBuilder([0, -950], 90).curve((t) => [170 * Math.sin(TAU * 3 * t), -950 + 1900 * t], 460).build();

/** Three lanes joined by two half-circle bends: right, back left, right again, each lane a little downhill. */
const hairpinStack = (): Path => new PathBuilder([-270, -170], 7).run(530).turn(80, 166).run(530).turn(80, -166).run(530).build();

/** A wide mouth that narrows into the tube over its first run. */
const funnelToTube = (): Path => new PathBuilder([-310, -120], 24, 150).run(280, TUBE_HALF).turn(260, -4).run(440).build();

const waveRider = (): Path => new PathBuilder([-350, -150], 20).curve((t) => [-350 + 700 * t, -150 + 300 * t + 30 * Math.sin(TAU * 2 * t)], 110).build();

/** Down one steep side of a valley and up the other, leaving lower than it entered. */
const halfPipeSwing = (): Path => new PathBuilder([-330, -190], 55).curve((t) => [-330 + 660 * t, -190 + 300 * Math.sin(Math.PI * t) + 60 * t], 110).build();

/** A short run, a bend into a steep drop, and a bend back out to the right. */
const cliffDropChute = (): Path => new PathBuilder([-240, -340], 14).run(150).turn(95, 61).run(480).turn(95, -65).run(260).build();

const LIST: [string, string, string, () => Path][] = [
  ['sweeper-left', 'Long Sweeper (left)', 'One long, lazy curve down to the left.', sweeperLeft],
  ['sweeper-right', 'Long Sweeper (right)', 'One long, lazy curve down to the right.', () => mirrored(sweeperLeft())],
  ['s-bend', 'S-Bend', 'Left, right, left: a tube that snakes down the track.', sBend],
  ['u-turn', 'U-Turn', 'Roll in, swing round the end and come back underneath.', uTurn],
  ['spiral-drop', 'Spiral Drop (3 turns)', 'Three full coils in a long drop. Tall.', spiralDrop],
  ['hairpin-stack', 'Hairpin Stack', 'Two switchbacks stacked: back and forth, down you go.', hairpinStack],
  ['funnel-tube', 'Funnel-to-Tube', 'A wide mouth that swallows the pack and squeezes it into a tube.', funnelToTube],
  ['wave-rider', 'Wave Rider', 'A tube that rolls over two gentle waves.', waveRider],
  ['half-pipe', 'Half-Pipe Swing', 'Down one side of a valley and up the other.', halfPipeSwing],
  ['cliff-chute', 'Cliff Drop Chute', 'A short run, then straight down a chute and out the bottom.', cliffDropChute],
];

let cache: ScaffoldKit[] | null = null;
/** Every premade kit, built once. */
export function scaffoldKits(): ScaffoldKit[] {
  cache ??= LIST.map(([id, name, blurb, make]) => kitFrom(id, name, blurb, make()));
  return cache;
}

export function scaffoldKitById(id: string): ScaffoldKit {
  return scaffoldKits().find((k) => k.id === id) ?? scaffoldKits()[0];
}

/** The kit the Scaffold tile stamps next (chosen from the Workshop's dropdown). */
let chosen = 'sweeper-left';
export function chosenScaffoldKit(): string { return chosen; }
export function chooseScaffoldKit(id: string): void { chosen = id; }

/** A marble is this far across: the tube must always be wider. */
export const MIN_TUBE_GAP = MARBLE_RADIUS * 2 + 2;
