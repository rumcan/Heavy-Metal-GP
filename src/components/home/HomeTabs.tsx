import { useEffect, useRef } from 'react';
import { BookOpen, Flag, Hammer, Infinity as InfinityIcon, Radio, Trophy } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { MENU_TABS } from '../../game/garages';
import type { HomeTab } from '../../game/garages';

export const TAB_META: Record<HomeTab, { label: string; Icon: LucideIcon; blurb: string }> = {
  story: { label: 'Story', Icon: BookOpen, blurb: 'Down We Go: six chapters, one mine' },
  championship: { label: 'Championship', Icon: Trophy, blurb: 'Six Grands Prix of three heats each' },
  quick: { label: 'Quick race', Icon: Flag, blurb: 'One heat on any circuit, calendar or custom' },
  online: { label: 'Online', Icon: Radio, blurb: 'Host, join by code, or queue for a ranked race' },
  infinity: { label: 'Infinity', Icon: InfinityIcon, blurb: 'An endless roll: no rivals, no timer, 3 lives' },
  workshop: { label: 'Workshop', Icon: Hammer, blurb: 'Build, test and share your own circuits' },
};

interface Props {
  tab: HomeTab;
  onTab: (tab: HomeTab) => void;
}

/**
 * The game modes, as the header's tabs. They are plain buttons in a nav (the same pattern as every other
 * screen's `main-nav`), the current one marked `aria-current="page"`.
 */
export default function HomeTabs({ tab, onTab }: Props) {
  const ref = useRef<HTMLElement>(null);
  // Under the logo on a phone the strip scrolls sideways: keep the current tab in view (centred when it can be).
  useEffect(() => {
    const strip = ref.current;
    const active = strip?.querySelector<HTMLElement>('button.active');
    if (!strip || !active || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollTo({ left: Math.max(0, active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2) });
  }, [tab]);
  return <nav className="home-tabs" aria-label="Game modes" ref={ref}>
    {MENU_TABS.map((id) => {
      const { label, Icon, blurb } = TAB_META[id];
      return <button key={id} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} title={blurb} onClick={() => onTab(id)}>
        <Icon size={15} aria-hidden="true" /><span>{label}</span>
      </button>;
    })}
  </nav>;
}
