/**
 * MB-03 (issue #72). Selection bounds for the map builder.
 *
 * A piece is selected where it is DRAWN.  The renderer paints every piece from
 * its built bodies and their metadata — and the Builder has already mirrored
 * those into world coordinates for `flip` pieces — so these bounds are derived
 * from the same bodies/metadata.  The raw `piece.x/piece.y` numbers live in the
 * authoring (un-mirrored) space and must never be used as a world centre: doing
 * that is what left mirrored pieces selectable only where nothing is drawn.
 *
 * Each piece's box is the union of
 *   1. its physics / field extents — the built bodies' own AABBs, so routes,
 *      sensor fields and multi-body pieces stay selectable in full, and
 *   2. its sprite art's world AABB, computed by pushing the sprite's local
 *      rect — the exact (x, y, w, h) the renderer hands to `drawSprite` —
 *      through the same anchor and rotation the renderer uses,
 * then padded by `PADDING` so clicks and the dashed highlight have slack.
 *
 * The sprite geometry below mirrors `src/game/render.ts` draw-for-draw; every
 * entry names the function it must stay in step with.  When a piece's art is
 * anchored on metadata (wind fan corner, magnet centre, geyser vent…), the
 * anchor is read from the built body's plugin — already mirrored — never
 * recomputed from the piece.
 */
import type { Piece } from '../../game/trackdef';
import type Matter from 'matter-js';
import { meta, W } from '../../game/track';
import type { Meta } from '../../game/track';
import { CATAPULT_BASE, CATAPULT_ARM, CATAPULT_ARM_LENGTH, CATAPULT_ARM_AXIS, flipperArtRect, warDrumArtRect, warDrumArtAngle } from '../../game/launcher-art';

export type Bounds = { min: { x: number; y: number }, max: { x: number; y: number } };

/** Slack around the drawn art so a click does not have to be pixel-perfect. */
const PADDING = 15;

/**
 * A sprite's local rect: the (x, y, w, h) passed to the renderer's
 * `drawSprite`, i.e. the image is CENTRED at (x, y) in the renderer's current
 * translate/rotate frame (`sprites.ts` draws from `x - w/2, y - h/2`).
 */
interface SpriteRect { x: number; y: number; w: number; h: number }

/** Sprite local rects — the single set of render dimensions the editor uses. */
const SPRITES = {
  /** `drawWind`: translate(windFanAnchor), drawSprite('wind', 0, 0, 28, 20). */
  windFan: { x: 0, y: 0, w: 28, h: 20 },
  /** `drawMagnet`: translate(centre), drawSprite('magnet', 0, 0, 48, 45). */
  magnet: { x: 0, y: 0, w: 48, h: 45 },
  /** `drawGeyser`: translate(cx, topY - 8), drawSprite('geyser', 0, -6, 34, 44). */
  geyser: { x: 0, y: -6, w: 34, h: 44 },
  /** `drawScoop`: translate(pocket), drawSprite('scoop', 0, 0, 40, 24). */
  scoop: { x: 0, y: 0, w: 40, h: 24 },
  /** render.ts `case 'itembox'`: drawSprite('crate', 0, 0, 34, 30) at the body. */
  crate: { x: 0, y: 0, w: 34, h: 30 },
} as const satisfies Record<string, SpriteRect>;

/** The painted tunnel portal: `drawTunnelHole` draws a 34·3.1 square centred on each hole. */
const TUNNEL_HOLE: SpriteRect = { x: 0, y: 0, w: 34 * 3.1, h: 34 * 3.1 };

/** Plugin metadata of a built body, if it carries any. */
function metaOf(b: Matter.Body | undefined): Meta | undefined {
  return b ? (meta(b) as Meta | undefined) : undefined;
}

/**
 * Where `drawWind` paints the fan box: the leading corner of the field along
 * the blow direction.  Exported so the renderer (and its upcoming alignment
 * pass) can share the one placement formula instead of growing a second copy.
 */
export function windFanAnchor(wind: { ux: number; uy: number; box: { x: number; y: number; w: number; h: number } }): { x: number; y: number } {
  const { x: lx, y: ly, w: bw, h: bh } = wind.box;
  return {
    x: wind.ux <= 0 ? lx + 14 : lx + bw - 14,
    y: wind.uy >= 0 ? ly + 12 : ly + bh - 12,
  };
}

/** Mutable AABB accumulator. */
class Box {
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;

  get empty(): boolean {
    return this.minX === Infinity;
  }

  addPoint(x: number, y: number): void {
    if (x < this.minX) this.minX = x;
    if (y < this.minY) this.minY = y;
    if (x > this.maxX) this.maxX = x;
    if (y > this.maxY) this.maxY = y;
  }

  addRect(minX: number, minY: number, maxX: number, maxY: number): void {
    this.addPoint(minX, minY);
    this.addPoint(maxX, maxY);
  }

  /** Axis-aligned box of `w × h` centred on (cx, cy). */
  addCentred(cx: number, cy: number, w: number, h: number): void {
    this.addRect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
  }

  /** A physics body's own AABB (world coordinates once the Builder has mirrored it). */
  addBody(b: Matter.Body): void {
    if (!b.bounds) return;
    this.addRect(b.bounds.min.x, b.bounds.min.y, b.bounds.max.x, b.bounds.max.y);
  }

  /**
   * A sprite's world AABB.  `anchor` and `angle` are the renderer's
   * translate/rotate; `s` is the drawSprite rect whose centre sits at
   * (s.x, s.y) in that local frame.  All four corners are transformed so a
   * rotated sprite gets its true extent, not its axis-aligned local size.
   */
  addSprite(anchor: { x: number; y: number }, angle: number, s: SpriteRect): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (const [lx, ly] of [
      [s.x - s.w / 2, s.y - s.h / 2],
      [s.x + s.w / 2, s.y - s.h / 2],
      [s.x - s.w / 2, s.y + s.h / 2],
      [s.x + s.w / 2, s.y + s.h / 2],
    ] as const) {
      this.addPoint(anchor.x + cos * lx - sin * ly, anchor.y + sin * lx + cos * ly);
    }
  }
}

/** The body in `bodies` carrying `kind` in its plugin metadata, if any. */
function bodyWith(bodies: Matter.Body[], kind: string): Matter.Body | undefined {
  return bodies.find((b) => metaOf(b)?.kind === kind);
}

/**
 * Returns the visual bounding box of a piece in RENDERED world coordinates:
 * physics/field extents ∪ sprite art, plus {@link PADDING}.  Falls back to a
 * small box at the piece's anchor (mirrored for `flip` pieces) when the piece
 * built no bodies at all.
 */
export function visualBoundsForPiece(piece: Piece, bodies: Matter.Body[]): Bounds {
  const box = new Box();
  for (const b of bodies) box.addBody(b);

  switch (piece.t) {
    case 'peg': {
      // render.ts case 'peg': bumper-crown, r·2.9 × r·2.35, centred on the body.
      const b = bodyWith(bodies, 'peg');
      if (b) {
        const r = metaOf(b)?.radius ?? piece.r;
        box.addSprite(b.position, 0, { x: 0, y: 0, w: r * 2.9, h: r * 2.35 });
      }
      break;
    }
    case 'ppeg': {
      // render.ts case 'ppeg': the gem art, r·2.5 square, centred on the body (rest pulse = 1).
      const b = bodyWith(bodies, 'ppeg');
      if (b) {
        const r = metaOf(b)?.radius ?? piece.r;
        box.addCentred(b.position.x, b.position.y, r * 2.5, r * 2.5);
      }
      break;
    }
    case 'itembox': {
      const b = bodyWith(bodies, 'itembox');
      if (b) box.addSprite(b.position, 0, SPRITES.crate); // bob/tilt stay inside the padding
      break;
    }
    case 'sling': {
      // The drum's head follows the kick direction; its body extends behind it.
      const b = bodyWith(bodies, 'sling');
      const md = metaOf(b)?.sling;
      if (b && md) box.addSprite(b.position, warDrumArtAngle(md.facing), warDrumArtRect(md.size ?? 90));
      break;
    }
    case 'wind': {
      // The editable field stays selectable in full, and the fan box joins it
      // at the corner the renderer paints it — the old fixed 28×20 box at the
      // field's centre covered nothing that was drawn there.
      const md = metaOf(bodyWith(bodies, 'wind'))?.wind;
      if (md) {
        box.addRect(md.box.x, md.box.y, md.box.x + md.box.w, md.box.y + md.box.h);
        const fan = windFanAnchor(md);
        box.addSprite(fan, 0, SPRITES.windFan); // painted fan
        box.addCentred(fan.x, fan.y, SPRITES.windFan.w, SPRITES.windFan.h); // procedural fallback fan
      }
      break;
    }
    case 'magnet': {
      // Deliberate union: the editable field circle AND the horseshoe icon —
      // neither replaces the other.
      const md = metaOf(bodyWith(bodies, 'magnet'))?.magnet;
      if (md) {
        box.addCentred(md.cx, md.cy, md.r * 2, md.r * 2);
        box.addSprite({ x: md.cx, y: md.cy }, 0, SPRITES.magnet);
        box.addRect(md.cx - 20, md.cy - 16, md.cx + 20, md.cy + 16); // procedural horseshoe
      }
      break;
    }
    case 'geyser': {
      // Same policy: the eruption column (a built body, already in the union)
      // plus the vent plinth icon at the mound.
      const md = metaOf(bodyWith(bodies, 'geyser'))?.geyser;
      if (md) {
        // renderer translates to (cx, topY - 8): the sit-on-mound offset
        box.addSprite({ x: md.cx, y: md.topY - 8 }, 0, SPRITES.geyser);
        box.addRect(md.cx - 12, md.topY - 20, md.cx + 12, md.topY + 16); // procedural mound
      }
      break;
    }
    case 'turnstile': {
      const b = bodyWith(bodies, 'turnstile');
      const md = metaOf(b)?.turnstile;
      if (b && md) {
        const side = md.r * 2 + 16;
        box.addSprite(b.position, b.angle, { x: 0, y: 0, w: side, h: side });
      }
      break;
    }
    case 'vortex': {
      const md = metaOf(bodyWith(bodies, 'vortex'))?.vortex;
      if (md) box.addCentred(md.cx, md.cy, md.r * 2.35, md.r * 2.35);
      break;
    }
    case 'platform': {
      // drawPlatform offsets the art (0, −12) above the slab; the slab also
      // shuttles between its route ends, so every resting pose — and the
      // dashed rail — stays selectable.
      const b = bodyWith(bodies, 'platform');
      const md = metaOf(b)?.motion;
      if (b && md?.mode === 'platform') {
        const w = b.bounds.max.x - b.bounds.min.x;
        const slab: SpriteRect = { x: 0, y: -12, w: w + 10, h: (w + 10) * 0.43 };
        box.addSprite(b.position, 0, slab);
        box.addSprite(md.a, 0, slab);
        box.addSprite(md.b, 0, slab);
      }
      break;
    }
    case 'scoop': {
      const b = bodyWith(bodies, 'scoop');
      if (b) box.addSprite(b.position, 0, SPRITES.scoop); // chevrons stay within the pocket + padding
      break;
    }
    case 'tunnel': {
      // Every tunnel body is a hole, and each paints its glowing exit hole too
      // (two-way tunnels are a body at each end). The portal sprite is a square
      // centred on the hole, so it covers the rotated exit art as well.
      for (const b of bodies) {
        const md = metaOf(b);
        if (md?.kind !== 'tunnel') continue;
        box.addSprite(b.position, 0, TUNNEL_HOLE);
        if (md.exit) box.addSprite(md.exit, 0, TUNNEL_HOLE);
      }
      break;
    }
    case 'flipper': {
      const fl = metaOf(bodyWith(bodies, 'flipper'))?.flipper;
      if (fl) {
        // Include the visible bat through its preview swing, while retaining the saved hinge.
        for (let i = 0; i <= 12; i++) {
          box.addSprite({ x: fl.px, y: fl.py }, fl.restA + (fl.swingA - fl.restA) * i / 12, flipperArtRect(fl.len));
        }
      }
      break;
    }
    case 'catapult': {
      const ct = metaOf(bodyWith(bodies, 'catapult'))?.catapult;
      if (ct) {
        const pivot = { x: ct.px, y: ct.py };
        const mirror = Math.cos(ct.restA) < 0 ? -1 : 1;
        const k = ct.len / 600;
        box.addSprite(pivot, 0, { x: mirror * (CATAPULT_BASE.width / 2 - CATAPULT_BASE.pivotX) * k, y: (CATAPULT_BASE.height / 2 - CATAPULT_BASE.pivotY) * k, w: CATAPULT_BASE.width * k, h: CATAPULT_BASE.height * k });
        const s = ct.len / CATAPULT_ARM_LENGTH;
        for (let i = 0; i <= 24; i++) {
          box.addSprite(pivot, ct.restA + (ct.releaseA - ct.restA) * i / 24 - mirror * CATAPULT_ARM_AXIS, {
            x: (CATAPULT_ARM.width / 2 - CATAPULT_ARM.pivotX) * s,
            y: mirror * (CATAPULT_ARM.height / 2 - CATAPULT_ARM.pivotY) * s,
            w: CATAPULT_ARM.width * s, h: CATAPULT_ARM.height * s,
          });
        }
      }
      break;
    }
    case 'bridge': {
      for (const b of bodies) {
        if (!metaOf(b)?.bridge) continue;
        box.addCentred(b.position.x, b.position.y - 10, 12, 38);
        for (const anchor of metaOf(b)!.bridge!.anchor) box.addCentred(anchor.x, anchor.y - 15, 16, 50);
      }
      break;
    }
    case 'wheel':
      // The ring sensor (r + 18) already wraps the rim, the bucket paddles and
      // the painted skin, so the built bodies are the drawn extent.
      break;
    default:
      // Everything else selects by its physics extent: cannon/catapult/flipper
      // art is anchored on the body, crushers and target banks move or span
      // several bodies, and their body-bounds union is the honest box.
      break;
  }

  if (box.empty) {
    const a = fallbackAnchor(piece);
    box.addCentred(a.x, a.y, 40, 40);
  }

  return {
    min: { x: box.minX - PADDING, y: box.minY - PADDING },
    max: { x: box.maxX + PADDING, y: box.maxY + PADDING },
  };
}

/**
 * Authoring-space anchor of a piece that built no bodies, mirrored into world
 * coordinates when the piece carries the `flip` flag.
 */
function fallbackAnchor(piece: Piece): { x: number; y: number } {
  const mirror = (x: number) => (piece.flip ? W - x : x);
  const p = piece as { x?: number; y?: number; a?: [number, number] };
  if (typeof p.x === 'number' && typeof p.y === 'number') return { x: mirror(p.x), y: p.y };
  if (p.a) return { x: mirror(p.a[0]), y: p.a[1] };
  return { x: W / 2, y: 0 };
}
