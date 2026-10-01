import type { ItemType } from '../../game/types';

// The same bundled skill cards as the race toolbar — no fetches or new art.
const art = import.meta.glob<string>('../../assets/ui/item-*.webp', { eager: true, import: 'default' });

export default function SkillArt({ item, className = '' }: { item: ItemType; className?: string }) {
  return <img className={`results-skill-art ${className}`} src={art[`../../assets/ui/item-${item}.webp`]} alt="" draggable={false} />;
}
