import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Check, Coins, LockKeyhole, Sparkles } from 'lucide-react';
import {
  CATEGORY_LABELS, PALETTE, cosmeticOptions, isUnlocked, lockedReset, sanitizeLook,
  unlockHint, unlockOf,
} from '../../game/cosmetics';
import type { BallLook, Category } from '../../game/cosmetics';
import { cosmeticProgressOf, loadCosmeticSave, purchaseCosmetic, saveAccount, saveCosmeticSave } from '../../game/economy';
import type { RacerAccount } from '../../game/economy';
import { drawCachedBall } from '../../game/ball-skin';

interface Props {
  account: RacerAccount;
  /** Called after the new global look is persisted. GaragePanel uses this to carry it into a SeatGarage. */
  onLookChange?: (look: BallLook) => void;
  /** Shop wrapper can keep its local wallet in sync; otherwise the shared account reference is refreshed in place. */
  onAccountChange?: (account: RacerAccount) => void;
  showPreview?: boolean;
}

type PanelTab = Category | 'colors';
const TABS: PanelTab[] = ['material', 'colors', 'pattern', 'trail', 'koBurst', 'finishFx'];
const buttonStyle = (active: boolean, locked = false) => ({
  display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-start', gap: 3, minWidth: 0,
  padding: '8px 9px', border: `1px solid ${active ? '#d63e2e' : locked ? '#55483d' : '#314253'}`,
  borderRadius: 5, background: active ? '#d63e2e22' : '#0a121b', color: '#f3e6cc',
  textAlign: 'left' as const, opacity: locked ? 0.85 : 1, cursor: locked ? 'default' : 'pointer',
});

export default function BallCustomizer({ account, onLookChange, onAccountChange, showPreview = true }: Props) {
  const progress = cosmeticProgressOf(account);
  const [tab, setTab] = useState<PanelTab>('material');
  const [look, setLook] = useState<BallLook>(() => lockedReset(loadCosmeticSave().look, cosmeticProgressOf(account)));
  const [status, setStatus] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewOwner = useRef<object>({});

  const publishLook = (candidate: unknown, gate: ReturnType<typeof cosmeticProgressOf> = progress) => {
    const next = lockedReset(sanitizeLook(candidate), gate);
    const saved = saveCosmeticSave({ version: 1, look: next });
    setLook(saved.look);
    setStatus('Ball look saved for every mode.');
    onLookChange?.(saved.look);
  };

  // A level reset or an account migration can make a once-valid item unavailable.
  useEffect(() => {
    const saved = loadCosmeticSave();
    const reset = lockedReset(saved.look, progress);
    if (JSON.stringify(reset) !== JSON.stringify(saved.look)) publishLook(reset);
    else if (JSON.stringify(reset) !== JSON.stringify(look)) setLook(reset);
    // publishLook is intentionally omitted: this effect runs only when progress changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.level, progress.achievements.join('|'), progress.owned.join('|')]);

  const lookKey = JSON.stringify(look);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = 280, height = 188;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    let frame = 0;
    const render = (now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const backdrop = ctx.createLinearGradient(0, 0, 0, height);
      backdrop.addColorStop(0, '#152434'); backdrop.addColorStop(1, '#08111a');
      ctx.fillStyle = backdrop; ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = 'rgba(148,163,184,0.13)'; ctx.lineWidth = 1;
      for (let x = 18; x < width; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
      for (let y = 12; y < height; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
      const angle = now * 0.00065;
      const cx = width / 2, cy = 82;
      ctx.beginPath(); ctx.ellipse(cx, 155, 49, 9, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, 61, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(214,62,46,0.34)'; ctx.lineWidth = 2; ctx.stroke();
      drawCachedBall(ctx, previewOwner.current, look, cx, cy, 53, angle);
      ctx.fillStyle = '#cbd5e1'; ctx.textAlign = 'center'; ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(`${look.material.toUpperCase()}  /  ${look.pattern.toUpperCase()}`, cx, 177);
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
    // The serialized appearance is the dependency: unrelated account renders keep the live preview running.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookKey]);

  const buy = (category: Category, id: string, label: string) => {
    const unlock = unlockOf(category, id);
    const result = purchaseCosmetic(account, category, id);
    if (result.error) { setStatus(result.error); return; }
    saveAccount(result.account);
    if (onAccountChange) onAccountChange(result.account);
    else {
      // App's accountRef and SetupScreen receive the same account object. Refresh that reference for
      // this legacy pane, whose public contract predates an account setter.
      Object.assign(account, result.account);
    }
    const price = unlock?.kind === 'credits' ? unlock.price : 0;
    publishLook({ ...look, [category]: id }, cosmeticProgressOf(result.account));
    setStatus(`${label} purchased for ${price} CR and equipped.`);
  };

  const changeColor = (key: 'primary' | 'secondary', value: string) => publishLook({ ...look, [key]: value });
  const options = tab === 'colors' ? [] : cosmeticOptions(tab);

  return <section className="ball-customizer" aria-label="Ball customisation">
    <style>{`
      .ball-customizer { display:flex; flex-direction:column; gap:9px; min-width:0; color:#e9e2d1; }
      .ball-customizer-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
      .ball-customizer-head strong { font:700 18px/1.1 var(--display, sans-serif); letter-spacing:.5px; }
      .ball-customizer-head small { color:#a9b3c0; font-size:10px; }
      .ball-customizer-preview { display:block; width:100%; max-width:320px; height:auto; margin:0 auto; border:1px solid #314253; border-radius:6px; }
      .ball-customizer-tabs { display:flex; gap:4px; overflow-x:auto; padding:2px 0 5px; scrollbar-width:thin; }
      .ball-customizer-tabs button { flex:0 0 auto; padding:6px 9px; border:1px solid #314253; border-radius:4px; background:#0a121b; color:#a9b3c0; font:600 10px var(--mono, monospace); text-transform:uppercase; }
      .ball-customizer-tabs button[aria-selected="true"] { border-color:#d63e2e; color:#fff3dc; background:#d63e2e22; }
      .ball-customizer-options { display:grid; grid-template-columns:repeat(auto-fit,minmax(92px,1fr)); gap:6px; max-height:230px; overflow:auto; padding:1px 3px 1px 0; }
      .ball-customizer-options button:hover:not(:disabled) { border-color:#a9b3c0 !important; }
      .ball-customizer-options small { color:#9aa8b8; font-size:9px; line-height:1.35; }
      .ball-customizer-options button[aria-pressed="true"] small { color:#e6c7a7; }
      .ball-customizer-color-row { display:flex; flex-direction:column; gap:7px; padding:9px; border:1px solid #314253; border-radius:5px; background:#0a121b; }
      .ball-customizer-color-row legend { color:#cbd5e1; font-size:11px; font-weight:700; }
      .ball-customizer-swatches { display:grid; grid-template-columns:repeat(8,minmax(20px,1fr)); gap:5px; }
      .ball-customizer-swatches button { aspect-ratio:1; min-width:20px; padding:2px; border:1px solid #475569; border-radius:50%; background:var(--swatch); }
      .ball-customizer-swatches button[aria-pressed="true"] { outline:2px solid #f4f1ea; outline-offset:2px; }
      .ball-customizer-number { display:flex; align-items:center; gap:8px; padding:8px 10px; border:1px solid #314253; border-radius:5px; background:#0a121b; font-size:11px; }
      .ball-customizer-number input { width:68px; padding:5px 7px; border:1px solid #475569; border-radius:4px; background:#080d13; color:#fff; }
      .ball-customizer-status { display:flex; align-items:flex-start; gap:6px; min-height:16px; margin:0; color:#cbd5e1; font-size:10px; line-height:1.4; }
      @media(max-width:430px) { .ball-customizer-swatches { grid-template-columns:repeat(6,minmax(20px,1fr)); } .ball-customizer-options { grid-template-columns:repeat(2,minmax(0,1fr)); } }
    `}</style>
    <div className="ball-customizer-head">
      <strong><Sparkles size={15} aria-hidden="true" /> THE BALL</strong>
      <small>{account.credits.toLocaleString()} CR available</small>
    </div>
    {showPreview && <canvas ref={canvasRef} className="ball-customizer-preview" width={560} height={376} aria-label="Live spinning ball preview" role="img" />}
    <div className="ball-customizer-tabs" role="tablist" aria-label="Ball categories">
      {TABS.map((id) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{id === 'colors' ? 'Colors' : CATEGORY_LABELS[id]}</button>)}
    </div>
    {tab === 'colors' ? <>
      {(['primary', 'secondary'] as const).map((key) => <fieldset key={key} className="ball-customizer-color-row">
        <legend>{key === 'primary' ? 'Primary color' : 'Secondary color'}</legend>
        <div className="ball-customizer-swatches">{PALETTE.map((color, index) => <button key={color} type="button" style={{ '--swatch': color } as CSSProperties} aria-label={`${key} swatch ${index + 1} ${color}`} aria-pressed={look[key] === color} onClick={() => changeColor(key, color)} />)}</div>
      </fieldset>)}
      {look.pattern === 'number' && <label className="ball-customizer-number">Race number <input type="number" min={0} max={99} step={1} value={look.number} onChange={(event) => publishLook({ ...look, number: Number(event.currentTarget.value) })} /></label>}
    </> : <>
      <div className="ball-customizer-options" role="tabpanel" aria-label={CATEGORY_LABELS[tab]}>
        {options.map(({ id, label }) => {
          const unlocked = isUnlocked(tab, id, progress);
          const hint = unlockHint(tab, id);
          const active = look[tab] === id;
          const unlock = unlockOf(tab, id);
          const purchasable = !unlocked && unlock?.kind === 'credits';
          return <button key={id} type="button" style={buttonStyle(active, !unlocked)} aria-pressed={active} disabled={!unlocked && !purchasable}
            aria-label={`${label}: ${unlocked ? active ? 'equipped' : 'select' : hint}`} title={unlocked ? label : hint}
            onClick={() => purchasable ? buy(tab, id, label) : publishLook({ ...look, [tab]: id })}>
            <span style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, fontWeight:700 }}>
              {active && <Check size={12} aria-hidden="true" />}{!unlocked && !purchasable && <LockKeyhole size={11} aria-hidden="true" />}{label}
            </span>
            <small>{unlocked ? active ? 'Equipped' : 'Choose' : hint}</small>
            {purchasable && <small style={{ color:account.credits >= (unlock?.kind === 'credits' ? unlock.price : 0) ? '#f6ca68' : '#e99b86' }}><Coins size={10} /> {unlock?.kind === 'credits' ? `${unlock.price} CR · buy & equip` : hint}</small>}
          </button>;
        })}
      </div>
      {tab === 'pattern' && look.pattern === 'number' && <label className="ball-customizer-number">Race number <input type="number" min={0} max={99} step={1} value={look.number} onChange={(event) => publishLook({ ...look, number: Number(event.currentTarget.value) })} /></label>}
    </>}
    <p className="ball-customizer-status" role="status" aria-live="polite">{status || <><Check size={12} /> The same saved ball follows you into every mode.</>}</p>
  </section>;
}
