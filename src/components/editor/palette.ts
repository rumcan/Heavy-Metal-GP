/**
 * MB-02. The piece palette: the pieces a player can build with, grouped the way the ticket groups them, each
 * with the real sprite the race draws it with (`src/assets/game/*`, via `src/game/sprites.ts`).
 *
 * This is data, not UI: MB-03 wires picking a piece to placing one, and the same table feeds the palette's
 * tiles, their titles and (later) the inspector. Keys are `TrackDef` piece types, so a tile can only ever arm
 * a piece the format can store.
 */
import type { Piece } from '../../game/trackdef';

export type PieceType = Piece['t'];

export interface PaletteTile {
  /** The `TrackDef` piece this tile places. */
  t: PieceType;
  label: string;
  /** Sprite name in `src/assets/game`, or null for pieces the skin draws from vectors only. */
  sprite: string | null;
  /** One line about what the piece does, shown as the tile's tooltip. */
  hint: string;
}

export interface PaletteGroup {
  id: string;
  label: string;
  /** What the group is for, shown under its heading. */
  note: string;
  tiles: PaletteTile[];
}

export const PALETTE: PaletteGroup[] = [
  {
    id: 'rails',
    label: 'Rails',
    note: 'The pipe itself',
    tiles: [
      { t: 'ramp', label: 'Ramp', sprite: 'rail-wood', hint: 'A straight rail. Drag its ends to set the angle.' },
      { t: 'curve', label: 'Curve', sprite: 'rail-chevron', hint: 'A quadratic bend between two rails.' },
      { t: 'ice', label: 'Ice rail', sprite: 'strip-ice', hint: 'Almost frictionless — carry speed, lose control.' },
      { t: 'wall', label: 'Wall', sprite: 'tile-metal', hint: 'A plain barrier. Rails, ledges and catch walls.' },
    ],
  },
  {
    id: 'features',
    label: 'Features',
    note: 'Things that happen to a marble',
    tiles: [
      { t: 'loop', label: 'Loop', sprite: 'loop-ring', hint: 'A full loop the marble has to carry speed through.' },
      { t: 'hoop', label: 'Fire hoop', sprite: 'fire-hoop', hint: 'A hoop that launches a marble at speed.' },
      { t: 'pad', label: 'Spring sheep', sprite: 'sheep-spring', hint: 'A bouncy launch pad pointed left or right.' },
      { t: 'boost', label: 'Boost', sprite: 'spring', hint: 'A chevron strip that accelerates whatever crosses it.' },
      { t: 'spinner', label: 'Spinner', sprite: 'spinner-blade', hint: 'A blade that sweeps marbles aside.' },
      { t: 'wrecker', label: 'Wrecking ball', sprite: 'wrecking-ball', hint: 'A swinging ball on a chain.' },
      { t: 'bucket', label: 'Minecart', sprite: 'minecart', hint: 'A cart that shuttles across the track.' },
    ],
  },
  {
    id: 'pegs',
    label: 'Pegs',
    note: 'Score, bounce, arm',
    tiles: [
      { t: 'peg', label: 'Crown bumper', sprite: 'bumper-crown', hint: 'Bounces a marble away. Every one is a point.' },
      { t: 'ppeg', label: 'Peggle peg', sprite: 'gem-blue', hint: 'Coloured, score-bearing peg the marble erases.' },
      { t: 'itembox', label: 'Item box', sprite: 'crate', hint: 'Gives the marble that hits it an item.' },
    ],
  },
  {
    id: 'walls',
    label: 'Walls',
    note: 'Breakables and blockers',
    tiles: [
      { t: 'breakable', label: 'SMASH crate', sprite: 'crate-tall', hint: 'Breaks under a heavy enough marble.' },
    ],
  },
];

/** Every tile, flat — for looking one up by piece type. */
export const TILES: PaletteTile[] = PALETTE.flatMap((group) => group.tiles);

export const tileFor = (t: PieceType): PaletteTile | undefined => TILES.find((tile) => tile.t === t);
