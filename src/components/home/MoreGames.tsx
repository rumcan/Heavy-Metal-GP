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
/** The key art first, then the screenshots. */
const SLIDES = [bg, shot1, shot2, shot3, shot4] as unknown as string[];
const SLIDE_MS = 3200;

/**
 * "More games by MaplePhoenix": the advert card for Trick or Treat: Maple Falls, in the main menu's grid where the
 * Online card was. Its key art and screenshots cycle behind the logo and a call to action. The whole card is one link
 * (opened in a new tab, so nothing here is lost).
 */
export default function MoreGames() {
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => setSlide((n) => (n + 1) % SLIDES.length), SLIDE_MS);
    return () => window.clearInterval(id);
  }, []);

  return <a className="more-games" href={MORE_GAMES_URL} target="_blank" rel="noopener noreferrer" data-testid="more-games"
    aria-label="More games by MaplePhoenix: play Trick or Treat: Maple Falls on RUN.world (opens in a new tab)">
    {SLIDES.map((src, i) => <img key={src} className={`more-games-slide${i === slide ? ' is-on' : ''}`} src={src} alt="" draggable={false} />)}
    <span className="more-games-shade" aria-hidden="true" />
    <span className="more-games-kicker">More games by MaplePhoenix</span>
    <img className="more-games-logo" src={logo as unknown as string} alt="Trick or Treat: Maple Falls" draggable={false} />
    <span className="more-games-cta">Play it free<ArrowRight size={15} aria-hidden="true" /></span>
    <span className="more-games-dots" aria-hidden="true">{SLIDES.map((src, i) => <i key={src} className={i === slide ? 'is-on' : ''} />)}</span>
  </a>;
}
