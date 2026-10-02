// P2-17: spend talent points in five trees. Tiers are rows; a locked tier says what it needs. Readable at 375 px
// (one tree at a time, picked with the tabs).
import { useState } from 'react';
import Dialog from '../Dialog';
import {
  TALENTS, TREES, canRankUp, rankUp, pointsInTree, pointsSpent, tierLevel, tierPointsNeeded, respecCost,
} from '../../game/talents';
import type { Build } from '../../game/talents';
import { freeTalentPoints, progressOf, respec, setTalents } from '../../game/economy';
import type { RacerAccount } from '../../game/economy';

const TREE_INFO: Record<string, { label: string; blurb: string; color: string }> = {
  engine: { label: 'Engine', blurb: 'Speed and the Magic Engine', color: '#ef4444' },
  chassis: { label: 'Chassis', blurb: 'Health and survival', color: '#22c55e' },
  arsenal: { label: 'Arsenal', blurb: 'Offence skills', color: '#f97316' },
  tactics: { label: 'Tactics', blurb: 'Skill duration and cooldown', color: '#38bdf8' },
  fortune: { label: 'Fortune', blurb: 'Credits and XP', color: '#facc15' },
};

interface Props { account: RacerAccount; onChange: (next: RacerAccount) => void; onClose: () => void }

export default function TalentsScreen({ account, onChange, onClose }: Props) {
  const [tree, setTree] = useState<string>(TREES[0]);
  const [note, setNote] = useState<string | null>(null);
  const progress = progressOf(account);
  const build: Build = account.talents ?? {};
  const free = freeTalentPoints(account);
  const cost = respecCost(account.respecs ?? 0);

  const raise = (id: string) => {
    const next = rankUp(build, id, progress.level, progress.talentPoints);
    if (!next) return;
    setNote(null);
    onChange(setTalents(account, next));
  };
  const reset = () => {
    const r = respec(account);
    if (!r.ok) { setNote(`A respec costs ${r.cost} CR`); return; }
    setNote(r.cost ? `Respec: -${r.cost} CR` : 'Free respec used. The next one costs 500 CR');
    onChange(r.account);
  };
  /** Why this talent cannot be raised, in the player's words. */
  const why = (id: string): string | null => {
    const d = TALENTS.find((t) => t.id === id)!;
    if ((build[id] ?? 0) >= d.maxRank) return 'Maxed';
    if (progress.level < tierLevel(d.tier)) return `Reach level ${tierLevel(d.tier)}`;
    const need = tierPointsNeeded(d.tier) - pointsInTree(build, d.tree, d.tier);
    if (need > 0) return `Spend ${need} more point${need === 1 ? '' : 's'} in this tree`;
    if (free <= 0) return 'No points left';
    return null;
  };

  const tiers = [1, 2, 3, 4];
  return <Dialog titleId="talents-title" onClose={onClose} className="talents-dialog">
    <div className="talents-head"><h2 id="talents-title">TALENTS</h2><span className="talents-points" aria-live="polite"><b>{free}</b> point{free === 1 ? '' : 's'} left · level {progress.level} · {pointsSpent(build)} spent</span></div>
    <div className="talents-tabs" role="tablist" aria-label="Talent trees">
      {TREES.map((t) => <button key={t} role="tab" aria-selected={tree === t} className={tree === t ? 'selected' : ''} style={{ '--tree': TREE_INFO[t].color } as React.CSSProperties} onClick={() => setTree(t)}>{TREE_INFO[t].label}<small>{pointsInTree(build, t)}</small></button>)}
    </div>
    <p className="dialog-intro" style={{ color: TREE_INFO[tree].color }}>{TREE_INFO[tree].blurb}</p>
    <div className="talents-tiers">
      {tiers.map((tier) => {
        const open = progress.level >= tierLevel(tier) && pointsInTree(build, tree, tier) >= tierPointsNeeded(tier);
        return <section key={tier} className={`talents-tier ${open ? '' : 'is-locked'}`} aria-label={`Tier ${tier}`}>
          <h3>Tier {tier}<small>{open ? 'open' : progress.level < tierLevel(tier) ? `level ${tierLevel(tier)}` : `${tierPointsNeeded(tier) - pointsInTree(build, tree, tier)} more points below`}</small></h3>
          <div className="talents-row">
            {TALENTS.filter((t) => t.tree === tree && t.tier === tier).map((t) => {
              const rank = build[t.id] ?? 0, can = canRankUp(build, t.id, progress.level, progress.talentPoints), reason = why(t.id);
              return <button key={t.id} className={`talent ${rank ? 'has-rank' : ''} ${can ? 'can' : ''}`} style={{ '--tree': TREE_INFO[tree].color } as React.CSSProperties} disabled={!can} onClick={() => raise(t.id)} title={reason ? `${t.desc} (${reason})` : t.desc} aria-label={`${t.name}, rank ${rank} of ${t.maxRank}. ${t.desc}${reason ? ` ${reason}.` : ''}`}>
                <b>{t.name}</b>
                <span className="talent-ranks" aria-hidden="true">{Array.from({ length: t.maxRank }, (_, i) => <i key={i} className={i < rank ? 'on' : ''} />)}</span>
                <small>{t.desc}</small>
                {reason && !can && <em>{reason}</em>}
              </button>;
            })}
          </div>
        </section>;
      })}
    </div>
    {note && <p className="loadout-error" role="status">{note}</p>}
    <div className="pause-actions">
      <button className="button-secondary" onClick={reset} disabled={pointsSpent(build) === 0}>Respec{cost ? ` (${cost} CR)` : ' (free)'}</button>
      <button className="button-primary" onClick={onClose} autoFocus>Done</button>
    </div>
  </Dialog>;
}
