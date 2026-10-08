import type { ItemType } from '../../game/types';
import ItemGlyph from '../ItemGlyph';

// The same bundled skill cards as the race toolbar — no fetches or new art. A skill whose card is not painted yet shows
// its glyph instead (like the toolbar does).
const art = import.meta.glob<string>('../../assets/ui/item-*.webp', { eager: true, import: 'default' });

export default function SkillArt({ item, className = '' }: { item: ItemType; className?: string }) {
  const src = art[`../../assets/ui/item-${item}.webp`];
  if (!src) return <span className={`results-skill-art results-skill-glyph ${className}`} aria-hidden="true"><ItemGlyph item={item} size={20} /></span>;
  return <img className={`results-skill-art ${className}`} src={src} alt="" draggable={false} />;
}
