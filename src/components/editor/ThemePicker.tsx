/**
 * The Workshop's theme switcher: a button showing the current theme, opening cards for the art themes (each
 * with its own sprites and background) and swatches for the colour variants of the goblin art.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Palette } from 'lucide-react';
import { ART_THEMES, THEME_IDS, THEME_LABELS, TRACK_THEMES } from '../../game/types';
import type { ThemeId } from '../../game/types';
import goblinBg from '../../assets/bg/repeating.webp';
import dwarvenBg from '../../assets/game/skins/dwarven/backdrop.webp';
import worgBg from '../../assets/game/skins/worg/backdrop.webp';

/** The art themes shown as big cards; 'default' is the goblin art every colour variant shares. */
const CARDS: { id: ThemeId; image: string; blurb: string }[] = [
  { id: 'default', image: goblinBg, blurb: 'Wooden goblin rails, scaffold towers and cliffs.' },
  { id: 'dwarven', image: dwarvenBg, blurb: 'Iron and gold rails in a lava-lit dwarven forge.' },
  { id: 'worg', image: worgBg, blurb: 'Bone-and-rope rails in a red-rock worg canyon.' },
];
const VARIANTS = THEME_IDS.filter((id) => id !== 'default' && !(ART_THEMES as readonly string[]).includes(id));

export default function ThemePicker({ value, onChange }: { value: ThemeId; onChange: (id: ThemeId) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const pick = (id: ThemeId) => { onChange(id); setOpen(false); };
  const theme = TRACK_THEMES[value];

  return <div className="theme-picker" ref={ref}>
    <span className="eyebrow">Theme</span>
    <button type="button" className="theme-picker-button" aria-haspopup="dialog" aria-expanded={open} aria-label={`Track theme: ${THEME_LABELS[value]}. Change theme`} onClick={() => setOpen((v) => !v)}>
      <i className="theme-swatch" style={{ background: `linear-gradient(135deg, ${theme.pipe}, ${theme.bg2})` }} />
      {THEME_LABELS[value]}<ChevronDown size={13} />
    </button>
    {open && <div className="theme-picker-pop" role="dialog" aria-label="Choose a track theme">
      <p className="theme-picker-title"><Palette size={13} /> Art themes <span>new sprites and background</span></p>
      <div className="theme-cards">
        {CARDS.map((card) => <button key={card.id} type="button" className={`theme-card ${value === card.id ? 'selected' : ''}`} aria-pressed={value === card.id} onClick={() => pick(card.id)}>
          <span className="theme-card-art" style={{ backgroundImage: `url(${card.image})` }}>{value === card.id && <Check size={16} />}</span>
          <strong>{THEME_LABELS[card.id]}</strong>
          <small>{card.blurb}</small>
        </button>)}
      </div>
      <p className="theme-picker-title">Colour variants <span>goblin art, recoloured</span></p>
      <div className="theme-variants">
        {VARIANTS.map((id) => <button key={id} type="button" className={value === id ? 'selected' : ''} aria-pressed={value === id} onClick={() => pick(id)}>
          <i className="theme-swatch" style={{ background: `linear-gradient(135deg, ${TRACK_THEMES[id].pipe}, ${TRACK_THEMES[id].bg2})` }} />{THEME_LABELS[id]}
        </button>)}
      </div>
    </div>}
  </div>;
}
