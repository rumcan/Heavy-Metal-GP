/**
 * MB-03 / #75. What an armed click is about to place, and what its preview looks like.
 *
 * The ghost used to be a second, hand-written copy of the palette defaults: a block on the armed
 * *string* with its own numbers (ramp 300, loop r 95, trapdoor width 110 centred on the cursor)
 * that never resolved a variant tile and had no template support at all. It has since become a
 * projection of the real placement instead:
 *
 *   - `placementPieces` is the one place that turns an armed id (palette tile **or** template) plus a
 *     cursor into the `Piece[]` a click commits. `TrackEditor.handlePlace` calls it, so the ghost can
 *     not disagree with the piece that lands. A template group is handed to `placeTemplate`, which is
 *     also where the group's anchor convention and its edge fitting live (#74).
 *   - `ghostParts` draws an outline from the fields of that `Piece` — its route, orientation and
 *     extent — using the same anchors `src/game/track.ts` builds its bodies from. Nothing here holds a
 *     default size of its own.
 *
 * Everything is computed in the piece's *stored* space and then mirrored about the centre line when
 * `flip` is set, exactly like `handlesFor`; that is why the builders below can read `dir`, `side` and
 * `facing` straight off the piece and still land the art where the race draws it.
 */
import type { Piece, Vec } from '../../game/trackdef';
import { bridgeRestX, bridgeRestY, T, W } from '../../game/track';
import { CRUSHER_PLATE_H, handlesFor } from './handles';
import { defaultPiece } from './defaults';
import { tileFor } from './palette';
import { getTemplates, placeTemplate, type SavedTemplate } from './templates';
import type { Point } from './camera';

/** One primitive of the ghost outline, in world units. */
export type GhostPart =
  | { kind: 'box'; x: number; y: number; w: number; h: number }
  | { kind: 'ring'; x: number; y: number; r: number; fill?: boolean }
  | { kind: 'path'; pts: Vec[]; close?: boolean; width?: number }
  | { kind: 'arrow'; from: Vec; to: Vec };

export interface GhostPiece {
  /** The piece a click places — the very object `handlePlace` commits. */
  piece: Piece;
  /** Outline for it, already mirrored into world space when the piece carries `flip`. */
  parts: GhostPart[];
  /** Where its handles will be, so a route or a resize grab is visible before the first click. */
  handles: { id: string; x: number; y: number }[];
  /** Accent for variants that differ only by colour (the Peggle pegs). */
  tint?: string;
}

export interface GhostPreview {
  /** Tile or template name, drawn under the ghost. */
  label: string;
  pieces: GhostPiece[];
  /** An armed template group that would not fit at this cursor: show the refusal, not a piece. */
  invalid?: boolean;
}

/** Armed ids for a saved template group share this prefix. */
export const TEMPLATE_ARM = 'template-';

const isTemplateArmed = (armed: string) => armed.startsWith(TEMPLATE_ARM);

/**
 * The pieces an armed click at `at` would place: one for most palette tiles (variant presets included), a complete route for the loop,
 * the whole group for a saved template. `TrackEditor.handlePlace` commits exactly this array, so the
 * preview cannot disagree with the placement. `[]` means the armed id names nothing placeable; `null`
 * means an armed template group that must not be placed as it is — missing, emptied, or too wide for
 * the track, which is `placeTemplate`'s refusal (#74) and worth telling the player about.
 */
export function placementPieces(armed: string, at: Point, snap: boolean, templates: SavedTemplate[] = getTemplates()): Piece[] | null {
  if (isTemplateArmed(armed)) {
    const tpl = templates.find((t) => t.id === armed);
    return tpl ? placeTemplate(tpl, at, snap) : null;
  }
  const tile = tileFor(armed);
  if (!tile) return [];

  return [{ ...defaultPiece(tile.t, at, snap), ...tile.preset } as Piece];
}

/** The full preview for an armed id at a cursor, or null when nothing would be placed. */
export function ghostPreview(armed: string, at: Point, snap: boolean, templates: SavedTemplate[] = getTemplates()): GhostPreview | null {
  const label = isTemplateArmed(armed)
    ? (templates.find((t) => t.id === armed)?.name ?? 'Template')
    : (tileFor(armed)?.label ?? armed);
  const pieces = placementPieces(armed, at, snap, templates);
  if (!pieces) return { label, pieces: [], invalid: true };
  if (!pieces.length) return null;
  return {
    label,
    pieces: pieces.map((piece) => {
      return {
        piece,
        parts: ghostPartsWorld(piece),
        // The grab points the piece will expose once placed, so a route or a resize handle is
        // visible before the first click. `handlesFor` applies the flip mirror itself.
        handles: handlesFor(piece),
        ...(piece.t === 'ppeg' ? { tint: PEG_TINT[piece.color] } : {}),
      };
    }),
  };
}

/** The colours the race skin uses for the three Peggle peg kinds. */
const PEG_TINT: Record<'blue' | 'orange' | 'green', string> = {
  blue: '#60a5fa',
  orange: '#fb923c',
  green: '#4ade80',
};

// ---------------- outline helpers ----------------

const pt = (x: number, y: number): Vec => [x, y];
const dirOf = (deg: number): Vec => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
const unit = (v: Vec): Vec => {
  const m = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / m, v[1] / m];
};
const along = (from: Vec, d: Vec, len: number): Vec => [from[0] + d[0] * len, from[1] + d[1] * len];
const midpoint = (a: Vec, b: Vec): Vec => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

const box = (c: Vec, w: number, h: number): GhostPart => ({ kind: 'box', x: c[0], y: c[1], w, h });
const ring = (c: Vec, r: number, fill = false): GhostPart => ({ kind: 'ring', x: c[0], y: c[1], r, fill });
const path = (pts: Vec[], width = 2, close = false): GhostPart => ({ kind: 'path', pts, width, close });
const arrow = (from: Vec, to: Vec): GhostPart => ({ kind: 'arrow', from, to });

/** A rotated rectangle as four points, so the `flip` mirror below stays a plain x negation. */
function slanted(c: Vec, w: number, h: number, d: Vec): GhostPart {
  const u = unit(d);
  const n: Vec = [-u[1], u[0]];
  const corners = [-1, 1].flatMap((sw) =>
    [-1, 1].map((sh) => pt(
      c[0] + u[0] * (w / 2) * sw + n[0] * (h / 2) * sh,
      c[1] + u[1] * (w / 2) * sw + n[1] * (h / 2) * sh,
    )),
  );
  return path([corners[0], corners[2], corners[3], corners[1]], 2, true);
}

/**
 * The rail slab `Builder.ramp` creates: the collider hangs `thickness` off the authored line, on the
 * side marbles ride. Shared by ramps, ice, belts and tar so their ghosts sit on the rail, not across it.
 */
function slab(a: Vec, b: Vec, thickness: number): GhostPart {
  const t = unit([b[0] - a[0], b[1] - a[1]]);
  const n: Vec = [-t[1], t[0]];
  const c = pt(midpoint(a, b)[0] - n[0] * (thickness / 2), midpoint(a, b)[1] - n[1] * (thickness / 2));
  return slanted(c, Math.hypot(b[0] - a[0], b[1] - a[1]) + 4, thickness, t);
}

/** Sampled quadratic, matching the `pieces = 12` chord count of `Builder.curve`. */
function bezier(a: Vec, c: Vec, b: Vec, n = 12): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const m = 1 - t;
    out.push(pt(m * m * a[0] + 2 * m * t * c[0] + t * t * b[0], m * m * a[1] + 2 * m * t * c[1] + t * t * b[1]));
  }
  return out;
}

/** Points on a circle from `a0` to `a1` (radians), for the swing ghosts of blades, maces and fans. */
function arc(c: Vec, r: number, a0: number, a1: number, n = 10): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push(pt(c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r));
  }
  return out;
}

/** Mirror a part's x about the centre line — the same map `handlesFor` applies to a flipped piece. */
function mirrorPart(part: GhostPart): GhostPart {
  const mx = (x: number) => W - x;
  switch (part.kind) {
    case 'box':
      return { ...part, x: mx(part.x) };
    case 'ring':
      return { ...part, x: mx(part.x) };
    case 'path':
      return { ...part, pts: part.pts.map(([x, y]) => pt(mx(x), y)) };
    case 'arrow':
      return { ...part, from: pt(mx(part.from[0]), part.from[1]), to: pt(mx(part.to[0]), part.to[1]) };
  }
}

// ---------------- outline per piece type ----------------

/**
 * The outline of `piece` in world space: the piece's stored geometry, mirrored about the centre line
 * when `flip` is set. Same rule `handlesFor` uses, so a preview and its handles always agree.
 */
export function ghostPartsWorld(piece: Piece): GhostPart[] {
  const parts = ghostParts(piece);
  return piece.flip ? parts.map(mirrorPart) : parts;
}

/**
 * The outline of one piece in its stored space. Sizes come from the piece's own fields; the few
 * fixed numbers are the collider dimensions `src/game/track.ts` gives pieces that have no size field
 * (an item box's r=17 sensor, a minecart's 110×34 body, …).
 */
export function ghostParts(piece: Piece): GhostPart[] {
  switch (piece.t) {
    case 'ramp':
      return [slab(piece.a, piece.b, T), path([piece.a, piece.b], 4)];
    case 'ice':
      return [slab(piece.a, piece.b, T), path([piece.a, piece.b], 4)];
    case 'curve':
      return [path(bezier(piece.a, piece.c, piece.b, piece.n ?? 12), 4)];
    case 'loop':
      return [ring(pt(piece.x, piece.bottom - piece.r), piece.r), ring(pt(piece.x, piece.bottom - piece.r), 3, true)];
    case 'hoop':
      return [ring(pt(piece.x, piece.y), 34), arrow(pt(piece.x, piece.y), along(pt(piece.x, piece.y), unit(piece.dir), 48))];
    case 'wrecker': {
      // The ball hangs `chain` under the pivot and swings ±amp, exactly like `Builder.wrecker`.
      const pv = pt(piece.pivot[0], piece.pivot[1]);
      const rest = pt(pv[0], pv[1] + piece.chain);
      return [
        ring(pv, 5, true),
        path([pv, rest], 2),
        ring(rest, 24),
        path(arc(pv, piece.chain, Math.PI / 2 - piece.amp, Math.PI / 2 + piece.amp)),
      ];
    }
    case 'pad': {
      const c = pt(piece.x, piece.y + T / 2);
      return [box(c, piece.w, T), arrow(pt(piece.x, piece.y), pt(piece.x + piece.dir * 46, piece.y - 34))];
    }
    case 'boost': {
      const d = unit(piece.dir);
      return [
        slanted(pt(piece.x, piece.y), piece.len, piece.thick, d),
        arrow(pt(piece.x, piece.y), along(pt(piece.x, piece.y), d, piece.len / 2)),
      ];
    }
    case 'spinner':
      return [ring(pt(piece.x, piece.y), piece.len / 2), path([pt(piece.x - piece.len / 2, piece.y), pt(piece.x + piece.len / 2, piece.y)], 4)];
    case 'breakable':
    case 'wall':
    case 'block':
    case 'barricade':
    case 'crumble':
      return [box(pt(piece.x, piece.y), piece.w, piece.h)];
    case 'peg':
      return [ring(pt(piece.x, piece.y), piece.r)];
    case 'sign':
      return [box(pt(piece.x, piece.y), piece.w, piece.w * 0.42)];
    case 'ring':
      return [ring(pt(piece.x, piece.y), piece.r + piece.thick / 2), ring(pt(piece.x, piece.y), Math.max(4, piece.r - piece.thick / 2))];
    case 'ppeg':
      return [ring(pt(piece.x, piece.y), piece.r), ring(pt(piece.x, piece.y), Math.max(3, piece.r * 0.35), true)];
    case 'itembox':
      return [ring(pt(piece.x, piece.y), 17)];
    case 'bucket':
      return [box(pt(W / 2, piece.y), 110, 34)];
    case 'tunnel': {
      const e = pt(piece.exit[0], piece.exit[1]);
      return [box(pt(piece.x, piece.y), 44, 100), ring(e, 22), path([pt(piece.x, piece.y), e]), arrow(e, along(e, unit(piece.edir), 40))];
    }
    case 'trapdoor': {
      // The hinge is the anchor the click sets, so mark it explicitly: it is what the old ghost lost.
      const hinge = pt(piece.x + (piece.hinge * piece.w) / 2, piece.y);
      const tip = pt(piece.x - (piece.hinge * piece.w) / 2, piece.y);
      // …and the leaf through its travel: a copy of the box swung 60° open off that hinge.
      const open = along(hinge, pt(-Math.sin(Math.PI / 3) * piece.hinge, -Math.cos(Math.PI / 3)), piece.w);
      return [box(pt(piece.x, piece.y), piece.w, 12), ring(hinge, 6, true), path([hinge, open], 2), path([hinge, tip], 4)];
    }
    case 'blade': {
      const pv = pt(piece.pivot[0], piece.pivot[1]);
      // `Builder.blade` swings from straight down, ±amp.
      const sweep = arc(pv, piece.len, Math.PI / 2 - piece.amp, Math.PI / 2 + piece.amp);
      return [
        ring(pv, 6, true),
        path(sweep),
        path([pv, along(pv, dirOf(90), piece.len)], 3),
        slanted(along(pv, dirOf(90), piece.len / 2), piece.thin, piece.len, dirOf(0)),
      ];
    }
    case 'saw':
      return [ring(pt(piece.a[0], piece.a[1]), piece.r), ring(pt(piece.b[0], piece.b[1]), piece.r), path([piece.a, piece.b])];
    case 'crusher': {
      const rest = pt(piece.x, piece.y + CRUSHER_PLATE_H / 2);
      const slam = pt(piece.x, piece.y + piece.travel + CRUSHER_PLATE_H / 2);
      return [
        box(rest, piece.w, CRUSHER_PLATE_H),
        box(slam, piece.w, CRUSHER_PLATE_H),
        path([pt(piece.x - piece.w / 2, piece.y), pt(piece.x - piece.w / 2, piece.y + piece.travel + CRUSHER_PLATE_H)]),
        path([pt(piece.x + piece.w / 2, piece.y), pt(piece.x + piece.w / 2, piece.y + piece.travel + CRUSHER_PLATE_H)]),
      ];
    }
    case 'boulder':
      return [path([...piece.pts], 2), ring(pt(piece.pts[0][0], piece.pts[0][1]), piece.r)];
    case 'mace': {
      const pv = pt(piece.x, piece.y);
      return [
        ring(pv, 5, true),
        path(arc(pv, piece.arm + piece.r, Math.PI / 2 - piece.arc, Math.PI / 2 + piece.arc)),
        ring(along(pv, dirOf(90), piece.arm + piece.r), piece.r),
      ];
    }
    case 'wheel': {
      const c = pt(piece.x, piece.y);
      const release = along(c, dirOf(piece.release), piece.r);
      return [ring(c, piece.r), ring(c, 12), ring(release, 6, true), path([c, release])];
    }
    case 'screw':
      return [slanted(midpoint(piece.a, piece.b), Math.hypot(piece.b[0] - piece.a[0], piece.b[1] - piece.a[1]), 26, unit([piece.b[0] - piece.a[0], piece.b[1] - piece.a[1]])), arrow(piece.a, piece.b)];
    case 'conveyor': {
      const t = unit([piece.b[0] - piece.a[0], piece.b[1] - piece.a[1]]);
      // `Builder.conveyor`'s belt sense, including the extra reversal a mirrored piece carries.
      const sense = (piece.flip ? piece.dir === 0 ? -1 : 1 : piece.dir === 0 ? 1 : -1) as 1 | -1;
      const mid = midpoint(piece.a, piece.b);
      return [slab(piece.a, piece.b, T * 1.6), arrow(mid, along(mid, pt(t[0] * sense, t[1] * sense), 44))];
    }
    case 'seesaw':
      return [box(pt(piece.x, piece.y), piece.len, 12), ring(pt(piece.x, piece.y), 5, true)];
    case 'bridge': {
      const anchor = [{ x: piece.a[0], y: piece.a[1] }, { x: piece.b[0], y: piece.b[1] }];
      const n = Math.max(1, piece.planks);
      const deck: Vec[] = [piece.a];
      for (let i = 0; i < n; i++) deck.push(pt(bridgeRestX(anchor, i, n), bridgeRestY(anchor, piece.slack, i, n)));
      deck.push(piece.b);
      return [path(deck, 3)];
    }
    case 'cannon': {
      const pv = pt(piece.x, piece.y);
      const lo = (piece.aimMin * Math.PI) / 180;
      const hi = (piece.aimMax * Math.PI) / 180;
      return [ring(along(pv, dirOf(90), 6), 16), path(arc(pv, 60, lo, hi)), path([pv, along(pv, dirOf(piece.aimMin), 60)]), path([pv, along(pv, dirOf(piece.aimMax), 60)])];
    }
    case 'catapult': {
      const pv = pt(piece.x, piece.y);
      // The resting arm, exactly as `Builder.catapult` poses it: 135° for `dir` 0, 45° for 1.
      const restA = ((piece.dir === 0 ? 135 : 45) * Math.PI) / 180;
      const tip = along(pv, [Math.cos(restA), Math.sin(restA)], piece.len);
      return [ring(pv, 6, true), path([pv, tip], 6), ring(tip, 15)];
    }
    case 'flipper': {
      const pv = pt(piece.x, piece.y);
      const restA = piece.side === 0 ? 8 : 172;
      return [ring(pv, 6), slanted(along(pv, dirOf(restA), piece.len / 2), piece.len, 12, dirOf(restA))];
    }
    case 'sling':
      return [...slingWedge(piece), arrow(pt(piece.x, piece.y), along(pt(piece.x, piece.y), dirOf(piece.facing), piece.size * 0.8))];
    case 'wind': {
      const boxPart = fieldBox(piece.a, piece.b);
      return [boxPart, arrow(midpoint(piece.a, piece.b), along(midpoint(piece.a, piece.b), dirOf(piece.dir), 56))];
    }
    case 'magnet':
      return [ring(pt(piece.x, piece.y), piece.r), ring(pt(piece.x, piece.y), 12, true)];
    case 'mud':
      return [slab(piece.a, piece.b, 18)];
    case 'geyser':
      return [box(pt(piece.x, piece.y + 8), 56, 18), box(pt(piece.x, piece.y - piece.h / 2), 44, piece.h), arrow(pt(piece.x, piece.y), pt(piece.x, piece.y - piece.h))];
    case 'trampoline':
      return [box(pt(piece.x, piece.y), piece.w, 12)];
    case 'turnstile':
      return [ring(pt(piece.x, piece.y), piece.r), box(pt(piece.x, piece.y), piece.r * 2, 12)];
    case 'targets': {
      const pins: GhostPart[] = [];
      for (let k = 0; k < piece.count; k++) pins.push(box(pt(piece.x + (k - (piece.count - 1) / 2) * 26, piece.y - 7), 18, 14));
      return pins;
    }
    case 'vortex':
      return [ring(pt(piece.x, piece.y), piece.r), ring(pt(piece.x, piece.y), piece.hole)];
    case 'platform': {
      const a = pt(piece.ax, piece.ay);
      const b = pt(piece.bx, piece.by);
      // The deck rides the path midpoint, so show it there and ghost the two ends it shuttles between.
      return [
        path([a, b]),
        box(midpoint(a, b), piece.w, 16),
        box(a, piece.w, 16),
        box(b, piece.w, 16),
      ];
    }
  }
}

/** The wedge `Builder.sling` collides with, rebuilt from the same size / facing arithmetic. */
function slingWedge(piece: Extract<Piece, { t: 'sling' }>): GhostPart[] {
  const f = dirOf(piece.facing);
  const n: Vec = [-f[1], f[0]];
  const s = piece.size;
  const b = pt(piece.x - f[0] * s * 0.36, piece.y - f[1] * s * 0.36);
  const v = [
    pt(b[0] - n[0] * s * 0.55 - f[0] * s * 0.18, b[1] - n[1] * s * 0.55 - f[1] * s * 0.18),
    pt(b[0] + n[0] * s * 0.55 - f[0] * s * 0.18, b[1] + n[1] * s * 0.55 - f[1] * s * 0.18),
    pt(b[0] + f[0] * s * 0.32, b[1] + f[1] * s * 0.32),
  ];
  return [path(v, 2, true)];
}

const corners = (a: Vec, b: Vec) => ({
  min: pt(Math.min(a[0], b[0]), Math.min(a[1], b[1])),
  max: pt(Math.max(a[0], b[0]), Math.max(a[1], b[1])),
});

/** Axis-aligned field box between two authored corners, as the wind and pool fields are built. */
function fieldBox(a: Vec, b: Vec): GhostPart {
  const { min, max } = corners(a, b);
  return box(pt((min[0] + max[0]) / 2, (min[1] + max[1]) / 2), Math.max(10, max[0] - min[0]), Math.max(10, max[1] - min[1]));
}
