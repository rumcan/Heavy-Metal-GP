import type { CSSProperties } from 'react';
import { Trophy } from 'lucide-react';
import type { HeatResult, MarbleInfo } from '../../game/types';
import { teamOf } from '../../game/types';
import { formatTime } from '../../game/physics';
import Portrait from '../Portrait';

interface Props { results: HeatResult[]; roster: MarbleInfo[] }
const PLACES = [2, 1, 3] as const;
const CONFETTI = Array.from({ length: 14 }, (_, i) => ({
  '--burst-x': `${(i - 6.5) * 13}px`,
  '--burst-y': `${-32 - (i % 4) * 13}px`,
  '--burst-turn': `${(i % 2 ? 1 : -1) * (100 + i * 29)}deg`,
  '--burst-color': ['#f3c875', '#ede3c7', '#d63e2e', '#5eead4'][i % 4],
  animationDelay: `${(i % 3) * 45}ms`,
} as CSSProperties));

export default function Podium({ results, roster }: Props) {
  const me = results.find((result) => roster.find((m) => m.id === result.id)?.isPlayer);
  const onPodium = me && me.time !== null && me.rank <= 3;
  return <section className="race-podium" aria-label="Race podium">
    <ol className="podium-blocks">
      {PLACES.map((rank) => {
        // A DNF is not a podium finish, even if fewer than three drivers finish.
        const result = results.find((r) => r.rank === rank && r.time !== null);
        const marble = result && roster.find((m) => m.id === result.id);
        const team = marble && teamOf(marble.id);
        return <li key={rank} className={`podium-block podium-place-${rank}${marble?.isPlayer ? ' podium-player' : ''}`} data-rank={rank} style={{ '--podium-team': team?.color ?? '#5b6677' } as CSSProperties}>
          <div className="podium-driver">
            {rank === 1 && marble && <span className="podium-burst" aria-hidden="true">{CONFETTI.map((style, i) => <i key={i} style={style} />)}<span className="podium-flag" /></span>}
            {marble ? <Portrait marble={marble} mood="happy" size={rank === 1 ? 64 : 52} ring={rank === 1 ? 'spiked' : undefined} /> : <span className="podium-empty" aria-hidden="true">—</span>}
            <strong className="podium-name">{marble?.name ?? 'No finisher'}{marble?.isPlayer && <small>YOU</small>}</strong>
            <span className="podium-team">{team?.name ?? 'Unclaimed'}</span>
            <time className="podium-time">{result ? formatTime(result.time!) : '—'}</time>
          </div>
          <div className="podium-plinth">{rank === 1 && marble && <Trophy size={18} aria-hidden="true" />}</div>
        </li>;
      })}
    </ol>
    {me && !onPodium && <p className="podium-your-place">YOU: {me.time === null ? `DNF · P${me.rank}` : `P${me.rank}`}</p>}
  </section>;
}
