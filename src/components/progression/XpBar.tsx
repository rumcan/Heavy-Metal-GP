// P2-09: the level badge and XP bar in the garage, with the next skill to unlock.
import { levelForXp } from '../../game/progression';
import type { ProgressState } from '../../game/progression';
import { SKILLS, nextUnlock } from '../../game/skills/catalog';

export default function XpBar({ progress }: { progress: ProgressState }) {
  const { level, into, toNext } = levelForXp(progress.xp);
  const next = nextUnlock(level);
  const pct = toNext === 0 ? 100 : Math.round((into / toNext) * 100);
  return <div className="xp-bar" aria-label={`Level ${level}, ${into} of ${toNext} XP`}>
    <span className="xp-level">LV {level}</span>
    <div className="xp-track"><i style={{ width: `${pct}%` }} /></div>
    <small>{toNext === 0 ? 'MAX LEVEL' : `${into} / ${toNext} XP`}{progress.talentPoints > 0 ? ` · ${progress.talentPoints} talent pts` : ''}{next ? ` · next: ${SKILLS[next.id].name} at level ${next.level}` : ''}</small>
  </div>;
}
