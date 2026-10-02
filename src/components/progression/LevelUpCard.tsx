// P2-09: the "LEVEL UP!" card: the new level, the talent points earned, and every skill it unlocks.
import Dialog from '../Dialog';
import { GROUP_COLORS, SKILLS, newUnlocks } from '../../game/skills/catalog';

interface Props { from: number; to: number; xp: number; onClose: () => void }

export default function LevelUpCard({ from, to, xp, onClose }: Props) {
  const unlocked = newUnlocks(from, to).map((id) => SKILLS[id]);
  return <Dialog titleId="levelup-title" onClose={onClose} className="levelup-dialog">
    <span className="eyebrow accent">+{xp} XP</span>
    <h2 id="levelup-title">LEVEL UP!</h2>
    <p className="levelup-level">Level <b>{to}</b></p>
    <p className="dialog-intro">+{to - from} talent point{to - from === 1 ? '' : 's'} to spend.</p>
    {unlocked.length > 0 && <ul className="levelup-skills" aria-label="New skills unlocked">
      {unlocked.map((d) => <li key={d.id} style={{ borderColor: GROUP_COLORS[d.group] }}>
        <b style={{ color: d.color }}>{d.name}</b><small>{d.group.toUpperCase()}</small><span>{d.desc}</span>
      </li>)}
    </ul>}
    <div className="pause-actions"><button className="button-primary" onClick={onClose} autoFocus>Continue</button></div>
  </Dialog>;
}
