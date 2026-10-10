import { ArrowRight } from 'lucide-react';
import { MENU_TABS } from '../../game/garages';
import type { HomeTab } from '../../game/garages';
import { TAB_META } from './HomeTabs';
import MoreGames from './MoreGames';
import storyArt from '../../assets/story/backgrounds/scrapyard-at-dusk.webp';
import championshipArt from '../../assets/story/backgrounds/finale-podium.webp';
import quickArt from '../../assets/story/backgrounds/grandstand-race-day.webp';
import onlineArt from '../../assets/story/backgrounds/pit-lane-at-night.webp';
import infinityArt from '../../assets/game/platformer/sky-islands.webp';
import workshopArt from '../../assets/editor/workshop-banner.webp';

const ART: Record<HomeTab, string> = {
  story: storyArt as unknown as string,
  championship: championshipArt as unknown as string,
  quick: quickArt as unknown as string,
  online: onlineArt as unknown as string,
  infinity: infinityArt as unknown as string,
  workshop: workshopArt as unknown as string,
};

interface Props {
  onPick: (tab: HomeTab) => void;
  /** The mode the player was last in: its card is marked so they can pick up where they left off. */
  last?: HomeTab | null;
}

/**
 * The main menu: every game mode as a big picture card. Picking one opens that mode's screen; the header's back
 * button comes back here. Two columns on a phone, three on a landscape phone or desktop.
 */
export default function MainMenu({ onPick, last }: Props) {
  return <main className="main-menu" aria-label="Main menu">
    <h1 className="main-menu-title">Choose your race</h1>
    <div className="main-menu-grid">
      {MENU_TABS.map((id) => {
        const { label, Icon, blurb } = TAB_META[id];
        return <button key={id} className={`main-menu-card${last === id ? ' is-last' : ''}`} data-testid={`menu-${id}`} onClick={() => onPick(id)}>
          <img src={ART[id]} alt="" draggable={false} />
          <span className="main-menu-shade" aria-hidden="true" />
          {last === id && <span className="main-menu-last">Last played</span>}
          <span className="main-menu-text">
            <strong><Icon size={18} aria-hidden="true" />{label}</strong>
            <span>{blurb}</span>
          </span>
          <ArrowRight className="main-menu-go" size={20} aria-hidden="true" />
        </button>;
      })}
      {/* the advert for the studio's other game, in the slot the Online card had */}
      <MoreGames />
    </div>
  </main>;
}
