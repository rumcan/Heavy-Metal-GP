import { useEffect, useRef, useState } from 'react';
import { Coins } from 'lucide-react';
import { RING_CREDITS } from '../../game/platformer/course';
import { formatKm } from '../../game/infinity-store';

interface Props {
  /** Gold rings collected on the road, and the distance bonus (in rings) for the distance rolled. */
  rings: number;
  bonus: number;
  km: number;
  /** The tally is over: pay these credits (the header's balance shows them). */
  onPaid: (credits: number) => void;
}

/**
 * The owner: after an Infinity run the rings are counted out arcade-style. Every ring flies from the stack into your
 * driver's portrait (a flash as each lands) while the count climbs; the distance bonus is added; the total turns into
 * credits that fly up into the wallet in the header. Collect skips to the end; reduced motion skips the show.
 * Nothing is paid until the count is done (an unfinished tally plays again next time: the rings stay banked).
 */
export default function RingTally({ rings, bonus, km, onPaid }: Props) {
  const total = rings + bonus;
  const credits = total * RING_CREDITS;
  const [count, setCount] = useState(0);
  const [stage, setStage] = useState<'rings' | 'bonus' | 'credits' | 'done'>('rings');
  const stackRef = useRef<HTMLDivElement>(null);
  const paidRef = useRef(false);
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;
  const finish = () => {
    if (paidRef.current) return;
    paidRef.current = true;
    setCount(total);
    setStage('done');
    onPaidRef.current(credits);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    if (paidRef.current) return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stack = stackRef.current;
    if (reduce || total === 0 || !stack) { finishRef.current(); return; }
    let cancelled = false;
    const timers: number[] = [];
    const flyers: HTMLElement[] = [];
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(() => { if (!cancelled) fn(); }, ms));
    const portrait = document.querySelector<HTMLElement>('.driver-portrait');
    const wallet = document.querySelector<HTMLElement>('.wallet-button');
    const centre = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const flash = (el: HTMLElement | null, cls: string) => {
      if (!el) return;
      el.classList.remove(cls);
      void el.offsetWidth; // restart the animation
      el.classList.add(cls);
    };
    /** One flying sprite from a to b (fixed position), landing after `delay + duration`. */
    const fly = (cls: string, a: { x: number; y: number }, b: { x: number; y: number }, delay: number, duration: number, onLand: () => void) => {
      const el = document.createElement('i');
      el.className = cls;
      el.setAttribute('aria-hidden', 'true');
      el.style.left = `${a.x}px`;
      el.style.top = `${a.y}px`;
      document.body.appendChild(el);
      flyers.push(el);
      const dx = b.x - a.x, dy = b.y - a.y;
      const lift = -Math.min(160, 60 + Math.abs(dx) * 0.25);
      const anim = el.animate([
        { transform: 'translate(-50%, -50%) scale(.6)', opacity: 0 },
        { transform: `translate(calc(-50% + ${dx * 0.45}px), calc(-50% + ${dy * 0.45 + lift}px)) scale(1.15)`, opacity: 1, offset: 0.45 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.45)`, opacity: 0.9 },
      ], { duration, delay, easing: 'cubic-bezier(.45,.05,.55,.95)', fill: 'forwards' });
      anim.finished.then(() => { el.remove(); if (!cancelled) onLand(); }).catch(() => el.remove());
    };

    // 1. the rings fly into the portrait, the count climbing as each lands (up to 40 sprites; each carries its share)
    const from = centre(stack);
    const to = portrait ? centre(portrait) : from;
    const shown = Math.min(rings, 40);
    const gap = Math.max(28, Math.min(70, 1400 / Math.max(1, shown)));
    for (let i = 0; i < shown; i++) {
      fly('tally-ring', from, to, i * gap, 560, () => {
        setCount(Math.round(((i + 1) / shown) * rings));
        flash(portrait, 'tally-flash');
      });
    }
    const afterRings = (shown ? (shown - 1) * gap + 560 : 0) + 250;
    // 2. the distance bonus counts on
    later(afterRings, () => {
      setStage('bonus');
      const steps = Math.min(20, Math.max(1, bonus));
      for (let s = 1; s <= steps; s++) later(s * 40, () => setCount(rings + Math.round((s / steps) * bonus)));
    });
    // 3. the total becomes credits, which fly up into the wallet in the header
    const afterBonus = afterRings + Math.min(20, Math.max(1, bonus)) * 40 + 450;
    later(afterBonus, () => {
      setStage('credits');
      const target = wallet ? centre(wallet) : to;
      const coins = 6;
      for (let c = 0; c < coins; c++) {
        fly('tally-coin', portrait ? centre(portrait) : from, target, c * 70, 650, () => {
          flash(wallet, 'tally-flash');
          if (c === coins - 1) finishRef.current();
        });
      }
    });
    return () => {
      cancelled = true;
      for (const t of timers) window.clearTimeout(t);
      for (const el of flyers) el.remove();
    };
    // run once per tally
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="ring-tally" role="status" aria-live="polite">
    <div className="ring-tally-stack" ref={stackRef} aria-hidden="true">
      {Array.from({ length: Math.max(1, Math.min(8, rings)) }, (_, i) => <i key={i} style={{ bottom: `${i * 5}px` }} />)}
    </div>
    <div className="ring-tally-count"><strong>{count}</strong><small>rings</small></div>
    <div className="ring-tally-lines">
      <span>{rings} gold rings collected</span>
      {stage !== 'rings' && <span>+{bonus} distance bonus ({formatKm(km)} km)</span>}
      {(stage === 'credits' || stage === 'done') && <span className="ring-tally-credits"><Coins size={13} />{total} × {RING_CREDITS} = <b>{credits.toLocaleString()} CR</b></span>}
    </div>
    {stage === 'done' ? <span className="ring-tally-paid">In your wallet</span> : <button className="button-secondary ring-tally-skip" onClick={finish}>Collect</button>}
  </div>;
}
