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
  /**
   * Unique tile id: what the palette arms. For the plain tile of a piece type it IS the type (so tutorial hooks
   * like `palette-ramp` keep working); variants of the same piece (e.g. the orange Peggle peg) get their own id.
   */
  id: string;
  /** The `TrackDef` piece this tile places. */
  t: PieceType;
  /** Fields laid over the piece's defaults when it is placed, e.g. `{ color: 'orange' }`. */
  preset?: Partial<Piece>;
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
      { id: 'ramp', t: 'ramp', label: 'Ramp', sprite: 'rail-wood', hint: 'A straight rail. Drag its ends to set the angle.' },
      { id: 'curve', t: 'curve', label: 'Curve', sprite: 'rail-wood', hint: 'A quadratic bend between two rails.' },
      { id: 'ice', t: 'ice', label: 'Ice rail', sprite: 'strip-ice', hint: 'Almost frictionless — carry speed, lose control.' },
      { id: 'wall', t: 'wall', label: 'Wall', sprite: 'strip-metal', hint: 'A plain barrier. Rails, ledges and catch walls.' },
    ],
  },
  {
    id: 'features',
    label: 'Features',
    note: 'Things that happen to a marble',
    tiles: [
      { id: 'loop', t: 'loop', label: 'Loop', sprite: 'loop-ring', hint: 'A full loop the marble has to carry speed through.' },
      { id: 'hoop', t: 'hoop', label: 'Fire hoop', sprite: 'fire-hoop', hint: 'A hoop that launches a marble at speed.' },
      { id: 'pad', t: 'pad', label: 'Spring sheep', sprite: 'sheep-spring', hint: 'A bouncy launch pad pointed left or right.' },
      { id: 'boost', t: 'boost', label: 'Boost', sprite: 'rail-chevron', hint: 'A chevron strip that accelerates whatever crosses it.' },
      { id: 'spinner', t: 'spinner', label: 'Spinner', sprite: 'spinner-blade', hint: 'A blade that sweeps marbles aside.' },
      { id: 'wrecker', t: 'wrecker', label: 'Wrecking ball', sprite: 'wrecking-ball', hint: 'A swinging ball on a chain.' },
      { id: 'bucket', t: 'bucket', label: 'Minecart', sprite: 'minecart', hint: 'A cart that shuttles across the track.' },
    ],
  },
  {
    id: 'pegs',
    label: 'Pegs',
    note: 'Score, bounce, arm',
    tiles: [
      { id: 'peg', t: 'peg', label: 'Crown bumper', sprite: 'bumper-crown', hint: 'Bounces a marble away. Every one is a point.' },
      { id: 'ppeg', t: 'ppeg', label: 'Blue peg', sprite: 'gem-blue', hint: 'A Peggle peg: bounces the marble and disappears when hit.' },
      { id: 'ppeg-orange', t: 'ppeg', label: 'Orange peg', sprite: 'gem-orange', preset: { color: 'orange' }, hint: 'A Peggle peg worth credits: every orange peg hit pays out at the finish.' },
      { id: 'ppeg-item', t: 'ppeg', label: 'Item peg', sprite: 'gem-purple', preset: { color: 'green', r: 13 }, hint: 'A glowing Peggle peg that gives the marble a free item.' },
      { id: 'itembox', t: 'itembox', label: 'Item box', sprite: 'crate', hint: 'Gives the marble that hits it an item.' },
    ],
  },
  {
    id: 'walls',
    label: 'Walls',
    note: 'Breakables and blockers',
    tiles: [
      { id: 'breakable', t: 'breakable', label: 'SMASH crate', sprite: 'crate-tall', hint: 'Breaks under a heavy enough marble.' },
      { id: 'block', t: 'block', label: 'Block', sprite: 'tile-metal', hint: 'A solid steel block. Nothing breaks it.' },
    ],
  },
  {
    id: 'secrets',
    label: 'Secrets',
    note: 'Shortcuts and hatches',
    tiles: [
      { id: 'barricade', t: 'barricade', label: 'No entry barricade', sprite: 'barricade', hint: 'NO ENTRY planks over a shortcut. Smash through with speed and weight.' },
      { id: 'barricade-tough', t: 'barricade', label: 'Tough barricade', sprite: 'barricade', preset: { tough: 8 }, hint: 'Heavily boarded. Very few marbles are getting through here.' },
      { id: 'tunnel', t: 'tunnel', label: 'Cliff tunnel', sprite: 'tunnel', hint: 'An entrance burrow. Where the arrow lands is the exit hole.' },
      { id: 'crumble', t: 'crumble', label: 'Crumbling wall', sprite: 'crumble', hint: 'Weak stone the whole pack slowly knocks down.' },
      { id: 'trapdoor', t: 'trapdoor', label: 'Trapdoor (clock)', sprite: 'trapdoor', hint: 'A hinged hatch that opens and shuts on a tick-tock.' },
      { id: 'trapdoor-weight', t: 'trapdoor', label: 'Trapdoor (weight)', sprite: 'trapdoor', preset: { mode: 'weight' }, hint: 'A scale pan: enough marbles resting on it drops the hatch.' },
      { id: 'switch', t: 'switch', label: 'Track switch lever', sprite: 'switchplate', hint: 'Every marble that crosses it flips the split for the next one.' },
    ],
  },
  {
    id: 'danger',
    label: 'Danger',
    note: 'Blades and crushers',
    tiles: [
      { id: 'blade', t: 'blade', label: 'Swinging blade', sprite: 'blade', hint: 'A huge axe swinging across the track. Time the swing or eat the flat.' },
      { id: 'saw', t: 'saw', label: 'Saw blade', sprite: 'saw', hint: 'A spinning disc set into the track. Drag a slot end and it slides.' },
      { id: 'crusher', t: 'crusher', label: 'Crusher piston', sprite: 'crusher', hint: 'A stamper slamming down on a timer. Watch the shadow, dash on the rise.' },
      { id: 'crusher-rapid', t: 'crusher', label: 'Rapid crusher', sprite: 'crusher', preset: { period: 2400, floor: 450 }, hint: 'A twitchy stamper on a short cycle. Relentless.' },
      { id: 'boulder', t: 'boulder', label: 'Rolling boulder', sprite: 'boulder', hint: 'A goblin-faced rock rolling down its path on a timer. Jump hops it.' },
      { id: 'mace', t: 'mace', label: 'Mace sweeper', sprite: 'mace', hint: 'A spiked ball scything the lane. A Shockwave jams it for two seconds.' },
    ],
  },
  {
    id: 'movers',
    label: 'Movers',
    note: 'Wheels, lifts and belts',
    tiles: [
      { id: 'wheel', t: 'wheel', label: 'Water wheel', sprite: 'wheel', hint: 'A bucket wheel: marbles drop in, ride round and tip out at the marker. Carries uphill.' },
      { id: 'screw', t: 'screw', label: 'Screw lift', sprite: 'screw', hint: 'A turning screw inside a tube that carries marbles up and over a section. Queues at capacity.' },
      { id: 'conveyor', t: 'conveyor', label: 'Conveyor belt', sprite: 'conveyor', hint: 'A belt that pushes marbles along the surface. Can flip its direction on a timer.' },
      { id: 'conveyor-back', t: 'conveyor', label: 'Belt (reversed)', sprite: 'conveyor', preset: { dir: 1 }, hint: 'A belt fighting downhill. Speed marbles push through it best.' },
      { id: 'seesaw', t: 'seesaw', label: 'Seesaw', sprite: 'seesaw', hint: 'A plank on a pivot. Heavy tips it; whoever sits light on the far end launches.' },
      { id: 'bridge', t: 'bridge', label: 'Rope bridge', sprite: 'bridge', hint: 'A sagging plank chain between two anchors. The pack dips it; bouncy balls bounce it.' },
    ],
  },
];

/** Every tile, flat — for looking one up by piece type. */
export const TILES: PaletteTile[] = PALETTE.flatMap((group) => group.tiles);

/** A tile by its id, falling back to the plain tile of a piece type. */
export const tileFor = (idOrType: string): PaletteTile | undefined =>
  TILES.find((tile) => tile.id === idOrType) ?? TILES.find((tile) => tile.t === idOrType);
