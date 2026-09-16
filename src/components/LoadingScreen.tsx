import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import wide from '../assets/bg/loading-wide.webp';
import tall from '../assets/bg/loading-tall.webp';
import type { Line } from '../game/characters';
import Banter from './Banter';
import Brand from './Brand';

export const MIN_LOADING_MS = 3200;
const TIPS = ['Glowing pegs hide free items.', 'Heavy balls break shortcut walls.', 'Bounce gets you onto the high ledges.', 'Setups lock for all three heats of a Grand Prix.', 'Oil behind you. Rivals in it.', 'Fire hoops throw you forward. Aim for the middle.', 'Loops need speed. Hit the chevrons first.', 'Wrecking balls swing on a beat. Wait for it.', 'The sheep do not move. You do.'];

interface Props { eyebrow: string; title: string; banter?: Line[]; cta: string; onContinue: () => void }

export default function LoadingScreen({ eyebrow, title, banter, cta, onContinue }: Props) {
  const [ready, setReady] = useState(false);
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);
  useEffect(() => { const t = setTimeout(() => setReady(true), MIN_LOADING_MS); return () => clearTimeout(t); }, []);
  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onContinue(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ready, onContinue]);

  return <div className="loading-screen" role="dialog" aria-modal="true" aria-label={title}>
    <picture className="loading-bg"><source media="(orientation: portrait)" srcSet={tall} /><img src={wide} alt="" /></picture>
    <div className="loading-shade" />
    <header className="loading-top"><Brand /><span className="eyebrow">{eyebrow}</span></header>
    {banter && <Banter lines={banter} className="loading-banter" delay={500} interval={900} />}
    <footer className="loading-bottom">
      <h1>{title}</h1>
      {ready
        ? <button className="button-primary loading-cta" onClick={onContinue} autoFocus>{cta}<ArrowRight size={19} /></button>
        : <div className="loading-bar" role="progressbar" aria-label="Loading"><span style={{ animationDuration: `${MIN_LOADING_MS}ms` }} /></div>}
      <p className="loading-tip">TIP / {tip}</p>
    </footer>
  </div>;
}
