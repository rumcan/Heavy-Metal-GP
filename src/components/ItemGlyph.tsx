import { Droplets, Snowflake, Rocket, Radio, Weight, Ghost, MoveUp, Wind, Shield, Hammer, HeartPulse, Hand, Crosshair, Gauge, Triangle, Copy, Anchor, Bomb, Repeat, MoveRight, WifiOff, Zap, ArrowDownToLine, Sparkles, ArrowLeftRight, HandMetal, Orbit, Hourglass, History, Shrink, CircleDot, Syringe, Workflow, Users, Asterisk, Fence, Target, Boxes, Radiation, Disc3, Redo2, ScanLine, Castle, CircleSlash } from 'lucide-react';
import type { ItemType } from '../game/types';

const GLYPHS = {
  oil: Droplets, freeze: Snowflake, rocket: Rocket, shock: Radio, anvil: Weight, ghost: Ghost, jump: MoveUp, aero: Wind,
  shield: Shield, ram: Hammer, repair: HeartPulse, brake: Hand, bolt: Crosshair, overdrive: Gauge, spikes: Triangle, decoy: Copy,
  grapple: Anchor, bomb: Bomb, reflect: Repeat, blink: MoveRight, emp: WifiOff, lightning: Zap, drill: ArrowDownToLine, charm: Sparkles,
  // the premium spells and weapons
  swap: ArrowLeftRight, telekinesis: HandMetal, well: Orbit, warp: Hourglass, rewind: History, shrink: Shrink, bubble: CircleDot,
  leech: Syringe, chain: Workflow, twin: Users, thorns: Asterisk, spikewall: Fence, mines: Target, cluster: Boxes, megabomb: Radiation,
  blades: Disc3, boomerang: Redo2, laser: ScanLine, turret: Castle, blank: CircleSlash,
} as const;

export default function ItemGlyph({ item, size = 24 }: { item: ItemType; size?: number }) {
  const Glyph = GLYPHS[item];
  return <Glyph size={size} strokeWidth={1.7} aria-hidden="true" />;
}
