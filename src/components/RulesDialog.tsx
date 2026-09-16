import { Flag, SlidersHorizontal, Trophy, CircleDot, ArrowRight, Coins } from 'lucide-react';
import Dialog from './Dialog';
import ItemGlyph from './ItemGlyph';
import { ITEM_INFO } from '../game/types';
import type { ItemType } from '../game/types';
import loopRing from '../assets/game/loop-ring.webp';
import fireHoop from '../assets/game/fire-hoop.webp';
import wreckingBall from '../assets/game/wrecking-ball.webp';
import sheepSpring from '../assets/game/sheep-spring.webp';
import bumper from '../assets/game/bumper-crown.webp';
import minecart from '../assets/game/minecart.webp';
import crate from '../assets/game/crate-tall.webp';

const HAZARDS: [string, string, string][] = [
  [loopRing, 'Loop-the-loop', 'Carry speed in. Too slow and you roll back out the bottom.'],
  [fireHoop, 'Fire hoop', 'Fly through the flames for a burst of speed.'],
  [wreckingBall, 'Wrecking ball', 'Swings across the drop. Time it or get launched.'],
  [sheepSpring, 'Spring sheep', 'Land on its back to launch up to the high ledges.'],
  [minecart, 'Minecart', 'Shuttles under the peg boards. Land in it for an express launch down.'],
  [bumper, 'Crown bumper', 'Solid iron. Bounce off and find a line around it.'],
  [crate, 'SMASH crate', 'Heavy marbles break through to the shortcut.'],
];

export default function RulesDialog({ onClose }: { onClose: () => void }) {
  return <Dialog onClose={onClose} titleId="rules-title" className="rules-dialog">
    <span className="eyebrow"><Flag size={15} /> THE RACE BRIEFING</span>
    <h2 id="rules-title">Know your way down.</h2>
    <div className="rules-steps">
      <section><SlidersHorizontal /><div><h3>Build your advantage.</h3><p>Weight, speed, and bounce share 15 points. Heavy marbles break shortcut walls; bouncy ones clear jump lips. More speed means less drag.</p></div></section>
      <section><Trophy /><div><h3>Race for the championship.</h3><p>Six Grands Prix, three heats on the exact same circuit. Finishers score 25, 18, 15, 12, 10, 8, 6, 4, 2, or 1 point. The fastest heat of each GP adds one bonus point. Your teammate also scores for Apex Racing.</p></div></section>
      <section><CircleDot /><div><h3>Go three times farther.</h3><p>Circuits now have three times as many sectors. Hit blue or orange pegs and they pop away. Glowing, orbiting pegs contain the marked item. Drop into the minecart shuttling under a peg board for an express ride down. The course map shows the whole field and your camera position.</p></div></section>
      <section><Coins /><div><h3>Win credits. Stock your toolbar.</h3><p>Every finish pays 60 to 500 credits, plus 5 per orange peg. Spend them in the pit shop on eight single-use power-ups. Bought and collected charges carry over to your next race. Click a slot or press 1-8 to deploy; Space repeats your last selection. A/D or arrows nudge. P pauses the clock and every effect timer.</p></div></section>
    </div>
    <h3 className="rules-subhead">Track hazards</h3>
    <div className="rules-hazards">{HAZARDS.map(([src, name, desc]) => <div key={name}><img src={src} alt="" /><div><strong>{name}</strong><p>{desc}</p></div></div>)}</div>
    <h3 className="rules-subhead">Power-ups</h3>
    <div className="rules-items">{(Object.keys(ITEM_INFO) as ItemType[]).map((item) => <div key={item}><span style={{ color: ITEM_INFO[item].color }}><ItemGlyph item={item} /></span><div><strong>{ITEM_INFO[item].name}</strong><p>{ITEM_INFO[item].desc}</p></div></div>)}</div>
    <p className="rules-safety">A race marshal gently frees stationary marbles. A local reset is the last resort, applied equally to every racer. Freeze and oil penalties are never cancelled by recovery.</p>
    <button className="button-primary" onClick={onClose}>Let's race <ArrowRight size={17} /></button>
  </Dialog>;
}