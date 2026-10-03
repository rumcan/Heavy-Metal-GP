// P2-22: the piece a click lays on a platformer course. The classic defaults slope and sit inside a 900-unit pipe; on a
// course built sideways a floor is level, and everything stands where the pointer is.
import type { Piece } from '../../game/trackdef';

/** The default piece of a type at (x, y), or null for the types that keep their classic default (a sign, for one). */
export function sidePiece(type: Piece['t'], x: number, y: number): Piece | null {
  const cx = Math.round(x), cy = Math.round(y);
  switch (type) {
    case 'ramp': return { t: 'ramp', a: [cx - 200, cy], b: [cx + 200, cy] };
    case 'ice': return { t: 'ice', a: [cx - 200, cy], b: [cx + 200, cy] };
    case 'curve': return { t: 'curve', a: [cx - 300, cy], c: [cx, cy + 120], b: [cx + 300, cy] };
    case 'pad': return { t: 'pad', x: cx, y: cy, w: 60, dir: 1 };
    case 'boost': return { t: 'boost', x: cx, y: cy, len: 200, thick: 20, dir: [1, 0] };
    case 'itembox': return { t: 'itembox', x: cx, y: cy };
    case 'block': return { t: 'block', x: cx, y: cy, w: 60, h: 60 };
    case 'wrecker': return { t: 'wrecker', pivot: [cx, cy], chain: 140, amp: 0.9, speed: 0.0022 };
    case 'bridge': return { t: 'bridge', a: [cx - 150, cy], b: [cx + 150, cy], planks: 15, slack: 12 };
    case 'loop': return { t: 'loop', x: cx, bottom: cy, r: 90 };
    case 'gate': return { t: 'gate', kind: 'ramp', to: 0, x: cx - 85, y: cy, w: 170 };
    case 'ledge': return { t: 'ledge', x: cx - 200, y: cy, w: 400 };
    default: return null;
  }
}
