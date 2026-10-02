import { Droplets, Snowflake, Rocket, Radio, Weight, Ghost, MoveUp, Wind, Shield, Hammer, HeartPulse, Hand, Crosshair, Gauge, Triangle, Copy, Anchor, Bomb, Repeat, MoveRight, WifiOff, Zap, ArrowDownToLine, Sparkles } from 'lucide-react';
import type { ItemType } from '../game/types';

const GLYPHS = {
  oil: Droplets, freeze: Snowflake, rocket: Rocket, shock: Radio, anvil: Weight, ghost: Ghost, jump: MoveUp, aero: Wind,
  shield: Shield, ram: Hammer, repair: HeartPulse, brake: Hand, bolt: Crosshair, overdrive: Gauge, spikes: Triangle, decoy: Copy,
  grapple: Anchor, bomb: Bomb, reflect: Repeat, blink: MoveRight, emp: WifiOff, lightning: Zap, drill: ArrowDownToLine, charm: Sparkles,
} as const;

export default function ItemGlyph({ item, size = 24 }: { item: ItemType; size?: number }) {
  const Glyph = GLYPHS[item];
  return <Glyph size={size} strokeWidth={1.7} aria-hidden="true" />;
}
