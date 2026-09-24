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
  /** Stat influences on this piece: -100 to 100 for gauge display. */
  effects?: {
    weight?: number;
    speed?: number;
    bounce?: number;
  };
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
    note: 'Tracks for marbles to roll on',
    tiles: [
      { id: 'ramp', t: 'ramp', label: 'Ramp', sprite: 'rail-wood', hint: 'A straight rail. Drag its ends to set the angle.', effects: { speed: 30 } },
      { id: 'curve', t: 'curve', label: 'Curve', sprite: 'rail-wood', hint: 'A bent rail. Drag the middle dot to set the bend.', effects: { speed: 30 } },
      { id: 'ring', t: 'ring', label: 'Ring rail', sprite: 'rail-wood', hint: 'A perfect plank circle. Drag the side dot for its size, the top dot for its thickness.', effects: { speed: 30 } },
      { id: 'ice', t: 'ice', label: 'Ice rail', sprite: 'strip-ice', hint: 'Almost frictionless — carry speed, lose control.', effects: { speed: 80 } },
      { id: 'wall', t: 'wall', label: 'Wall', sprite: 'strip-metal', hint: 'A plain barrier. Rails, ledges and catch walls.' },
      { id: 'sign', t: 'sign', label: 'Sign', sprite: null, hint: 'A wooden sign with your own words. Pure decoration: marbles pass through it. Write it in the settings cog.' },
    ],
  },
  {
    id: 'features',
    label: 'Features',
    note: 'Things that happen to a marble',
    tiles: [
      { id: 'loop', t: 'loop', label: 'Loop', sprite: 'loop-ring', hint: 'A loop ride. Touch it from any side and it spins the marble round and throws it out the opposite side.', effects: { speed: 80, weight: -20 } },
      { id: 'hoop', t: 'hoop', label: 'Fire hoop', sprite: 'fire-hoop', hint: 'A hoop that launches a marble at speed.', effects: { speed: 60 } },
      { id: 'pad', t: 'pad', label: 'Spring sheep', sprite: 'sheep-spring', hint: 'A bouncy launch pad pointed left or right.', effects: { bounce: 70, weight: -80 } },
      { id: 'boost', t: 'boost', label: 'Boost', sprite: 'rail-chevron', hint: 'A chevron strip that accelerates whatever crosses it.', effects: { speed: 30 } },
      { id: 'spinner', t: 'spinner', label: 'Spinner', sprite: 'spinner-blade', hint: 'A blade that sweeps marbles aside.', effects: { weight: 60, speed: -40 } },
      { id: 'wrecker', t: 'wrecker', label: 'Wrecking ball', sprite: 'wrecking-ball', hint: 'A swinging ball on a chain.', effects: { weight: 70, speed: -30 } },
      { id: 'bucket', t: 'bucket', label: 'Minecart', sprite: 'minecart', hint: 'A cart that shuttles across the track.', effects: { speed: 40 } },
    ],
  },
  {
    id: 'pegs',
    label: 'Pegs',
    note: 'Score, bounce, arm',
    tiles: [
      { id: 'peg', t: 'peg', label: 'Crown bumper', sprite: 'bumper-crown', hint: 'Bounces a marble away. Every one is a point.', effects: { bounce: 50, speed: -20 } },
      { id: 'ppeg', t: 'ppeg', label: 'Blue peg', sprite: 'gem-blue', hint: 'A Peggle peg: bounces the marble and disappears when hit.', effects: { bounce: 40 } },
      { id: 'ppeg-orange', t: 'ppeg', label: 'Orange peg', sprite: 'gem-orange', preset: { color: 'orange' }, hint: 'A Peggle peg worth credits: every orange peg hit pays out at the finish.', effects: { bounce: 40 } },
      { id: 'ppeg-item', t: 'ppeg', label: 'Item peg', sprite: 'gem-purple', preset: { color: 'green', r: 13 }, hint: 'A glowing Peggle peg that gives the marble a free item.', effects: { bounce: 40 } },
      { id: 'itembox', t: 'itembox', label: 'Item box', sprite: 'crate', hint: 'Gives the marble that hits it an item.', effects: { speed: 40 } },
    ],
  },
  {
    id: 'walls',
    label: 'Walls',
    note: 'Breakables and blockers',
    tiles: [
      { id: 'breakable', t: 'breakable', label: 'SMASH crate', sprite: 'crate-tall', hint: 'Breaks under a heavy enough marble.', effects: { weight: 90, speed: 40 } },
      { id: 'block', t: 'block', label: 'Block', sprite: 'tile-metal', hint: 'A solid steel block. Nothing breaks it.' },
    ],
  },
  {
    id: 'secrets',
    label: 'Secrets',
    note: 'Shortcuts and hatches',
    tiles: [
      { id: 'barricade', t: 'barricade', label: 'No entry barricade', sprite: 'barricade', hint: 'NO ENTRY planks over a shortcut. Smash through with speed and weight.', effects: { speed: 80, weight: 80 } },
      { id: 'barricade-tough', t: 'barricade', label: 'Tough barricade', sprite: 'barricade', preset: { tough: 8 }, hint: 'Heavily boarded. Very few marbles are getting through here.', effects: { speed: 80, weight: 80 } },
      { id: 'tunnel', t: 'tunnel', label: 'Cliff tunnel', sprite: 'tunnel', hint: 'An entrance burrow. Where the arrow lands is the exit hole.', effects: { speed: 50 } },
      { id: 'crumble', t: 'crumble', label: 'Crumbling wall', sprite: 'crumble', hint: 'Weak stone the whole pack slowly knocks down.', effects: { weight: 70 } },
      { id: 'trapdoor', t: 'trapdoor', label: 'Trapdoor (clock)', sprite: 'trapdoor', hint: 'A hinged hatch that opens and shuts on a tick-tock.', effects: { speed: 50 } },
      { id: 'trapdoor-weight', t: 'trapdoor', label: 'Trapdoor (weight)', sprite: 'trapdoor', preset: { mode: 'weight' }, hint: 'A scale pan: enough marbles resting on it drops the hatch.', effects: { weight: 80 } },
    ],
  },
  {
    id: 'danger',
    label: 'Danger',
    note: 'Blades and crushers',
    tiles: [
      { id: 'blade', t: 'blade', label: 'Swinging blade', sprite: 'blade', hint: 'A huge axe swinging across the track. Time the swing or eat the flat.', effects: { speed: 70, weight: 30 } },
      { id: 'saw', t: 'saw', label: 'Saw blade', sprite: 'saw', hint: 'A spinning disc set into the track. Drag a slot end and it slides.', effects: { speed: 60 } },
      { id: 'crusher', t: 'crusher', label: 'Crusher piston', sprite: 'crusher', hint: 'A stamper slamming down on a timer. Watch the shadow, dash on the rise.', effects: { speed: 70 } },
      { id: 'boulder', t: 'boulder', label: 'Rolling boulder', sprite: 'boulder', hint: 'A goblin-faced rock rolling down its path on a timer. Jump hops it.', effects: { bounce: 60, speed: 50 } },
      { id: 'mace', t: 'mace', label: 'Mace sweeper', sprite: 'mace', hint: 'A spiked ball scything the lane. A Shockwave jams it for two seconds.', effects: { weight: 50, speed: 50 } },
    ],
  },
  {
    id: 'movers',
    label: 'Movers',
    note: 'Wheels, lifts and belts',
    tiles: [
      { id: 'wheel', t: 'wheel', label: 'Water wheel', sprite: 'wheel', hint: 'A bucket wheel: marbles drop in, ride round and tip out at the marker. Carries uphill.', effects: { bounce: -40, weight: -30 } },
      { id: 'screw', t: 'screw', label: 'Screw lift', sprite: 'screw', hint: 'A turning screw inside a tube that carries marbles up and over a section. Queues at capacity.', effects: { weight: -30 } },
      { id: 'conveyor', t: 'conveyor', label: 'Conveyor belt', sprite: 'conveyor', hint: 'A belt that pushes marbles along the surface. Can flip its direction on a timer.', effects: { speed: 40 } },
      { id: 'conveyor-back', t: 'conveyor', label: 'Belt (reversed)', sprite: 'conveyor', preset: { dir: 1 }, hint: 'A belt fighting downhill. Speed marbles push through it best.', effects: { speed: 60 } },
      { id: 'seesaw', t: 'seesaw', label: 'Seesaw', sprite: 'seesaw', hint: 'A plank on a pivot. Heavy tips it; whoever sits light on the far end launches.', effects: { weight: 70 } },
      { id: 'bridge', t: 'bridge', label: 'Rope bridge', sprite: 'bridge', hint: 'A sagging plank chain between two anchors. The pack dips it; bouncy balls bounce it.', effects: { bounce: 60 } },
    ],
  },
  {
    id: 'launchers',
    label: 'Launchers',
    note: 'Cannons, catapults and pinball',
    tiles: [
      { id: 'cannon', t: 'cannon', label: 'Goblin cannon', sprite: 'cannon', hint: 'Swallows a marble and fires it along the swinging aim fan. Heavy flies shorter; the player can nudge to fire early.', effects: { weight: -50 } },
      { id: 'catapult', t: 'catapult', label: 'Catapult', sprite: 'catapult', hint: 'A spoon cradle on a long arm. Land in it, wait for the reload, fly up to the shelf.', effects: { weight: -45, bounce: 30 } },
      { id: 'flipper', t: 'flipper', label: 'Flipper (left)', sprite: 'flipper', hint: 'A pinball bat pivoted on the left. Rest on it and it snaps you up-right — or set a timer.', effects: { weight: -60, bounce: 50 } },
      { id: 'flipper-right', t: 'flipper', label: 'Flipper (right)', sprite: 'flipper', preset: { side: 1 }, hint: 'The right-handed bat: snaps marbles up-left.', effects: { weight: -60, bounce: 50 } },
      { id: 'sling', t: 'sling', label: 'War Drum', sprite: 'sling', hint: 'A heavy war drum. Strike its face to launch a marble in the kick direction; light marbles bounce higher, heavy ones barely bounce.', effects: { weight: -80, bounce: 60 } },
    ],
  },
  {
    id: 'fields',
    label: 'Fields & surfaces',
    note: 'Wind, magnets, tar and steam',
    tiles: [
      { id: 'wind', t: 'wind', label: 'Updraft vent', sprite: 'wind', hint: 'A large vent whose dust vortex fills the rectangle. Light marbles sail on it, Heavy metal ignores it, Slipstream catches twice. Pulse it to breathe.', effects: { weight: -75 } },
      { id: 'magnet', t: 'magnet', label: 'Horseshoe magnet', sprite: 'magnet', hint: 'Pulls marbles off their line; heavier marbles are pulled harder. Heavy metal sticks for a moment, then lets go. Set a period to switch it on and off.', effects: { weight: 80 } },
      { id: 'mud', t: 'mud', label: 'Tar band', sprite: 'mud', hint: 'A strip of sticky tar that slows marbles down. Bouncy marbles hop across it, fast ones push through, and Slipstream sails over.', effects: { speed: 60 } },
      { id: 'geyser', t: 'geyser', label: 'Geyser vent', sprite: 'geyser', hint: 'Bubbles for a beat, then blasts upward on a timer. Park on it and get chucked. All on the race clock.', effects: { weight: -50 } },
    ],
  },
  {
    id: 'setpieces',
    label: 'Big set pieces',
    note: 'Nets, turnstiles, targets, funnels and ferries',
    tiles: [
      { id: 'trampoline', t: 'trampoline', label: 'Trampoline net', sprite: 'trampoline', hint: 'A stretchy net over a gully. Land hard, spring high; bounce doubles it, heavy barely springs.', effects: { weight: -70, bounce: 80 } },
      { id: 'turnstile', t: 'turnstile', label: 'Turnstile diverter', sprite: 'turnstile', hint: 'Arms on a ratchet (or free spin on a period) reshuffling who comes out left and right.', effects: { weight: 50, speed: 40 } },
      { id: 'targets', t: 'targets', label: 'Drop-target bank', sprite: 'targets', hint: 'A row of pinball pins blocking the lane. Knock every pin and the lane is open — pins re-arm on a timer.', effects: { speed: 60, weight: 40 } },
      { id: 'vortex', t: 'vortex', label: 'Vortex funnel', sprite: 'vortex', hint: 'A spiral funnel: speed keeps you circling, weight sinks you to the drain. Exits rewrite the order.', effects: { weight: 60, speed: -40 } },
      { id: 'platform', t: 'platform', label: 'Moving platform', sprite: 'platform', hint: 'A shuttling ferry pad. Catch its window or take the low road — timing decides the jump.', effects: { speed: 70 } },
    ],
  },
];

/** Every tile, flat — for looking one up by piece type. */
export const TILES: PaletteTile[] = PALETTE.flatMap((group) => group.tiles);

/** A tile by its id, falling back to the plain tile of a piece type. */
export const tileFor = (idOrType: string): PaletteTile | undefined =>
  TILES.find((tile) => tile.id === idOrType) ?? TILES.find((tile) => tile.t === idOrType);
