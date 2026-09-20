/** What's new: a small pop-up shown once per version when the game starts. */
import { ArrowRight, Hammer, MessageSquare, Sparkles, Trophy, Wrench } from 'lucide-react';
import Dialog from './Dialog';
import { APP_VERSION } from '../game/version';

interface Props {
  onClose: () => void;
  onWorkshop: () => void;
}

const WORKSHOP_SETS = [
  ['A', 'Shortcuts & Secrets', 'Barricades, Cliff tunnels, Crumbling walls, Trapdoors (Clock & Weight)'],
  ['B', 'Blades & Crushers', 'Saw blades (with slider handles), Swinging blades, Crusher pistons, Rolling boulders, Mace sweepers'],
  ['C', 'Mechanical Movers', 'Water wheels, Screw lifts, Conveyor belts, Reversed belts, Seesaws, Rope bridges'],
  ['D', 'Launchers & Pinball', 'Goblin cannons, Catapults, Left & Right flippers, War Drums, Scoops'],
  ['E', 'Fields & Surfaces', 'Updraft vents, Horseshoe magnets, Tar bands, Geyser vents'],
  ['F', 'Big Set Pieces', 'Trampoline nets, Turnstile diverters, Drop-target banks, Vortex funnels, Moving platforms'],
] as const;

const RANK_TIERS = [
  { name: 'Scrap', score: '0+' },
  { name: 'Bronze Bolt', score: '1100+' },
  { name: 'Iron', score: '1250+' },
  { name: 'Steel', score: '1400+' },
  { name: 'Gold Gear', score: '1550+' },
  { name: 'Heavy Metal', score: '1750+' },
] as const;

export default function WhatsNew({ onClose, onWorkshop }: Props) {
  return <Dialog titleId="whats-new-title" onClose={onClose} className="whats-new">
    <span className="eyebrow"><Sparkles size={14} /> WHAT'S NEW <span className="whats-new-version">v{APP_VERSION}</span></span>
    <h2 id="whats-new-title">The Grand Scrapyard Expansion</h2>

    <ul className="whats-new-list">
      <li className="whats-new-feature">
        <Hammer size={20} />
        <div>
          <strong>Workshop Expansion: 30 New Items & Universal Handles</strong>
          <p>
            Build extreme circuits with thirty new interactive elements across six categories. Every item in the workshop now features full <strong>resize and rotate transform handles</strong> on selection!
          </p>
          <div className="whats-new-item-grid">
            <ol>
              {WORKSHOP_SETS.map(([id, name, items]) => (
                <li key={id}>
                  <b>{id}</b> <span className="set-name">{name}:</span>
                  <small>{items}</small>
                </li>
              ))}
            </ol>
          </div>
          <button className="button-primary" onClick={onWorkshop} style={{ marginTop: 10 }}>
            <Wrench size={15} />Open Workshop<ArrowRight size={16} />
          </button>
        </div>
      </li>

      <li className="whats-new-feature">
        <Trophy size={20} />
        <div>
          <strong>Multiplayer Ranks & Elo Ladder</strong>
          <p>
            Competitive matchmaking is here! Compete against other players in online races to earn your rating and climb the RUN.world leaderboard across six distinct rank tiers:
          </p>
          <div className="whats-new-tiers-row">
            {RANK_TIERS.map((tier) => (
              <span key={tier.name} className="whats-new-tier-pill">
                <span className="tier-name">{tier.name}</span>
                <span className="tier-score">{tier.score}</span>
              </span>
            ))}
          </div>
        </div>
      </li>

      <li className="whats-new-feature">
        <MessageSquare size={20} />
        <div>
          <strong>Multiplayer Chat & Speech Bubbles</strong>
          <p>
            Talk with rival drivers in real time during multiplayer races! Send messages via the pit wall chat bar (or hotkey) to show floating speech bubbles directly over your marble on track.
          </p>
        </div>
      </li>
    </ul>

    <div className="pause-actions">
      <button className="button-secondary" onClick={onClose}>Let's race</button>
    </div>
  </Dialog>;
}
