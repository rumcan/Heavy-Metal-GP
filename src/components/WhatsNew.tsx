/** What's new: a small pop-up shown once per version when the game starts. */
import { Flag, Hammer, Sparkles } from 'lucide-react';
import Dialog from './Dialog';
import { APP_VERSION } from '../game/version';

interface Props {
  onClose: () => void;
}

export default function WhatsNew({ onClose }: Props) {
  return <Dialog titleId="whats-new-title" onClose={onClose} className="whats-new">
    <span className="eyebrow"><Sparkles size={14} /> WHAT'S NEW <span className="whats-new-version">v{APP_VERSION}</span></span>
    <h2 id="whats-new-title">Official Circuits Update</h2>

    <ul className="whats-new-list">
      <li className="whats-new-feature">
        <Flag size={20} />
        <div>
          <strong>Hand-fixed official circuits</strong>
          <p>
            The six Grands Prix now race <strong>fixed official layouts</strong> — generated once in the Workshop, hand-fixed and archived with the game, instead of a fresh procedural circuit every season. The live demo in the menu shows <strong>exactly the circuit the heats race</strong>: what you see is what you play.
          </p>
        </div>
      </li>

      <li className="whats-new-feature">
        <Hammer size={20} />
        <div>
          <strong>Generation lives in the Workshop</strong>
          <p>
            Want a different layout? Generate one in the Workshop's New track dialog, fix it until it races the way you want, save it, and swap it in for any round before its first heat. Custom tracks still pay 30% of the usual winnings.
          </p>
        </div>
      </li>
    </ul>

    <div className="pause-actions">
      <button className="button-secondary" onClick={onClose}>Let's race</button>
    </div>
  </Dialog>;
}
