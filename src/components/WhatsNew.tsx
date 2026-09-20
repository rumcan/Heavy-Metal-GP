/** What's new: a small pop-up shown once per version when the game starts. */
import { ArrowRight, BookOpen, Hammer, Radio, Sparkles, Trophy, Wrench } from 'lucide-react';
import Dialog from './Dialog';
import { APP_VERSION } from '../game/version';

interface Props {
  onClose: () => void;
  onWorkshop: () => void;
}

const COMING = [
  ['A', 'Shortcuts and secrets', 'no-entry signs, cliff tunnels, crumbling walls, trapdoors, switches'],
  ['B', 'Blades and crushers', 'swinging blades, saws, crusher pistons, rolling boulders, mace sweepers'],
  ['C', 'Mechanical movers', 'water wheels, screw lifts, conveyors, seesaws, rope bridges'],
  ['D', 'Launchers and pinball', 'cannons, catapults, flippers, War Drums, scoops'],
  ['E', 'Fields and surfaces', 'wind fans, magnets, mud pits, water pools, geysers'],
  ['F', 'Big set pieces', 'trampolines, turnstiles, drop targets, vortex funnels, moving platforms'],
] as const;

export default function WhatsNew({ onClose, onWorkshop }: Props) {
  return <Dialog titleId="whats-new-title" onClose={onClose} className="whats-new">
    <span className="eyebrow"><Sparkles size={14} /> WHAT'S NEW <span className="whats-new-version">v{APP_VERSION}</span></span>
    <h2 id="whats-new-title">Fresh off the scrapheap</h2>

    <ul className="whats-new-list">
      <li className="whats-new-feature">
        <Hammer size={20} />
        <div>
          <strong>The Map Builder is here</strong>
          <p>Build your own tracks in the Workshop: drag, rotate and resize every piece (press E for the Select tool), set the track length, pick the new Dwarven Forge and Worg Canyon themes, test drive it, then publish it to Community tracks for everyone to upvote and race.</p>
          <button className="button-primary" onClick={onWorkshop}><Wrench size={15} />Take me to the Workshop<ArrowRight size={16} /></button>
        </div>
      </li>
      <li className="whats-new-feature">
        <Radio size={20} />
        <div><strong>Online matchmaking</strong><p>Race other players: quick match, or host a game and share the code with friends.</p></div>
      </li>
      <li className="whats-new-feature">
        <BookOpen size={20} />
        <div><strong>Story mode: Down We Go</strong><p>Follow Sprocket from the scrapyard to the championship, one chapter per Grand Prix.</p></div>
      </li>
    </ul>

    <p className="whats-new-subtitle">Coming next</p>
    <ul className="whats-new-coming">
      <li><Trophy size={15} /><div><strong>Elo ranks</strong><span>Online races earn you a rank.</span></div></li>
      <li><Hammer size={15} /><div><strong>New map building tools and pieces</strong><span>Thirty new track elements, in six sets:</span>
        <ol>{COMING.map(([id, name, what]) => <li key={id}><b>{id}</b> {name}<small>{what}</small></li>)}</ol>
      </div></li>
    </ul>

    <div className="pause-actions">
      <button className="button-secondary" onClick={onClose}>Let's race</button>
    </div>
  </Dialog>;
}
