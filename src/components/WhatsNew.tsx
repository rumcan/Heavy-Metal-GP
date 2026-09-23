/** What's new: a small pop-up shown once per version when the game starts. */
import { Globe, Hammer, Sparkles } from 'lucide-react';
import Dialog from './Dialog';
import { APP_VERSION } from '../game/version';

interface Props {
  onClose: () => void;
}

export default function WhatsNew({ onClose }: Props) {
  return <Dialog titleId="whats-new-title" onClose={onClose} className="whats-new">
    <span className="eyebrow"><Sparkles size={14} /> WHAT'S NEW <span className="whats-new-version">v{APP_VERSION}</span></span>
    <h2 id="whats-new-title">Workshop &amp; Online</h2>

    <ul className="whats-new-list">
      <li className="whats-new-feature">
        <Hammer size={20} />
        <div>
          <strong>Workshop</strong>
          <p>Every item now rotates and resizes. Locked items stay locked until you click the padlock. Tick <strong>Watch AI</strong> to see 10 AI marbles race your map.</p>
        </div>
      </li>

      <li className="whats-new-feature">
        <Globe size={20} />
        <div>
          <strong>Online matchmaking</strong>
          <p>Online races now run on the same hand-built circuits as the championship. No more random layouts.</p>
        </div>
      </li>
    </ul>

    <div className="pause-actions">
      <button className="button-secondary" onClick={onClose}>Let's race</button>
    </div>
  </Dialog>;
}
