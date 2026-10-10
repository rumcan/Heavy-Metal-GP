import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import logo from '../../assets/promo/tot-logo.webp';
import bg from '../../assets/promo/tot-bg.webp';
import shot1 from '../../assets/promo/tot-shot-1.webp';
import shot2 from '../../assets/promo/tot-shot-2.webp';
import shot3 from '../../assets/promo/tot-shot-3.webp';
import shot4 from '../../assets/promo/tot-shot-4.webp';

/** The studio's other game on RUN.world. */
export const MORE_GAMES_URL = 'https://run.world/maplephoenix/trick-or-treat-maple-falls';
const SHOTS = [shot1, shot2, shot3, shot4] as unknown as string[];
const SHOT_MS = 3200;

/**
 * "More games by MaplePhoenix": a banner on the main menu for Trick or Treat: Maple Falls. Its key art behind, the
 * logo and a call to action on the left, and its screenshots cycling on the right. The whole banner is one link
 * (opened in a new tab, so the race in progress here is not lost).
 */
export default function MoreGames() {
  const [shot, setShot] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => setShot((n) => (n + 1) % SHOTS.length), SHOT_MS);
    return () => window.clearInterval(id);
  }, []);

  return <a className="more-games" href={MORE_GAMES_URL} target="_blank" rel="noopener noreferrer" data-testid="more-games"
    aria-label="More games by MaplePhoenix: play Trick or Treat: Maple Falls on RUN.world (opens in a new tab)">
    <img className="more-games-bg" src={bg as unknown as string} alt="" draggable={false} />
    <span className="more-games-shade" aria-hidden="true" />
    <span className="more-games-copy">
      <span className="more-games-kicker">More games by MaplePhoenix</span>
      <img className="more-games-logo" src={logo as unknown as string} alt="Trick or Treat: Maple Falls" draggable={false} />
      <span className="more-games-line">Same streets. Scarier nights. Blast monsters, grab treats, survive Halloween.</span>
      <span className="more-games-cta">Play it free<ArrowRight size={16} aria-hidden="true" /></span>
    </span>
    <span className="more-games-shots" aria-hidden="true">
      {SHOTS.map((src, i) => <img key={src} src={src} alt="" draggable={false} className={i === shot ? 'is-on' : ''} />)}
      <span className="more-games-dots">{SHOTS.map((src, i) => <i key={src} className={i === shot ? 'is-on' : ''} />)}</span>
    </span>
  </a>;
}
