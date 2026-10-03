// P2-22: the Workshop's platformer course editor. The course is drawn from the side as a strip (three lanes of floor);
// pick a thing, click a lane to place it, click one to select it, drag it along the strip, change it in the panel, delete it.
// Test drive races it for real; Save keeps it in My platformer courses; Share makes a pf1- code; Publish sends it to the community.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Copy, Dices, Flag, Play, Save, Share2, Trash2, Users } from 'lucide-react';
import Dialog from '../Dialog';
import ConfirmDialog from '../ConfirmDialog';
import { COMMUNITY_TAGS, MAX_TAGS, PublishError, publishCourse } from '../../game/community';
import { SPRING_W, floorAt } from '../../game/platformer/course';
import type { Lane } from '../../game/platformer/course';
import { KINDS, KIND_LABEL, MAX_LENGTH, MIN_LENGTH, basePlan, defFromSeed, validatePlatformerDef } from '../../game/platformer/def';
import type { CourseStyle, Kind, PlatformerDef } from '../../game/platformer/def';
import { saveCourse } from '../../game/platformer/courses-store';
import { PlatformerCodeError, decodePlatformerCode, encodePlatformerCode } from '../../game/platformer/share';
import { THEME_IDS } from '../../game/types';
import type { ThemeId } from '../../game/types';
import './platformer-editor.css';

export interface PlatformerEditorProps {
  /** The saved course id this opened from (null = a new, unsaved one) and the def to start from. */
  initial: { id: string | null; def: PlatformerDef; dirty?: boolean };
  onExit: () => void;
  /** Race the def for real (the App starts a quick race on it and brings the player back here, with this state). */
  onTestDrive: (def: PlatformerDef, state: { id: string | null; dirty: boolean }) => void;
}

type Selection = { kind: Kind; index: number } | null;
const VIEW_W = 900;
const VIEW_H = 250;
const LANE_COLORS = ['#3f6a52', '#6f9a5e', '#b3d28f'] as const;
const LANE_NAMES = ['Back', 'Middle', 'Front'] as const;
const snap10 = (v: number) => Math.round(v / 10) * 10;
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Where on the floor a thing of this kind sits, given where along and in which lane. Returns the item with its heights set. */
function place<K extends Kind>(kind: K, item: PlatformerDef[K][number], plan: ReturnType<typeof basePlan>): PlatformerDef[K][number] {
  const it = { ...item } as Record<string, number | string>;
  const lane = it.lane as Lane, x = it.x as number;
  const f = (px: number) => floorAt(plan, lane, px);
  const mid = f(x + ((it.w as number | undefined) ?? SPRING_W) / 2) ?? f(x) ?? 0;
  switch (kind) {
    case 'springs': it.y = round1(f(x + SPRING_W / 2) ?? mid); break;
    case 'gates': it.y = round1(f(x + (it.w as number) / 2) ?? mid); break;
    case 'itemBoxes': it.y = round1(mid - 46); break;
    case 'bumps': it.y = round1(Math.min(f(x) ?? mid, f(x + (it.w as number)) ?? mid) - (it.h as number) + 6); break;
    case 'wreckers': it.pivotY = round1(mid - (it.chain as number) - 38); break;
    case 'ledges': break; // a ledge keeps its own height (it is a shortcut high over the track)
    default: break;
  }
  return it as unknown as PlatformerDef[K][number];
}

/** A fresh thing of `kind` at (lane, x). */
function fresh(kind: Kind, lane: Lane, x: number, plan: ReturnType<typeof basePlan>): PlatformerDef[Kind][number] {
  const floor = floorAt(plan, lane, x + 40) ?? 0;
  switch (kind) {
    case 'springs': return place('springs', { lane, x, y: 0 }, plan);
    case 'ledges': return { lane, x, w: 320, y: round1(floor - 190) };
    case 'gates': return place('gates', { kind: 'ramp', lane, to: (lane === 1 ? 0 : 1) as Lane, x, w: 170, y: 0 }, plan);
    case 'boosts': return { lane, x, w: 160 };
    case 'itemBoxes': return place('itemBoxes', { lane, x, y: 0 }, plan);
    case 'wreckers': return place('wreckers', { lane, x, pivotY: 0, chain: 140, amp: 0.9, speed: 0.0022, phase: 0 }, plan);
    case 'bumps': return place('bumps', { lane, x, w: 60, y: 0, h: 40 }, plan);
  }
}


export default function PlatformerEditor({ initial, onExit, onTestDrive }: PlatformerEditorProps) {
  const [def, setDef] = useState<PlatformerDef>(initial.def);
  const [savedId, setSavedId] = useState<string | null>(initial.id);
  const [dirty, setDirty] = useState(initial.dirty ?? initial.id === null);
  const [tool, setTool] = useState<Kind | null>(null);
  const [sel, setSel] = useState<Selection>(null);
  const [scrollX, setScrollX] = useState(Math.max(0, 600));
  const [zoom, setZoom] = useState(0.16);
  const [note, setNote] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [share, setShare] = useState<{ code: string } | null>(null);
  const [importText, setImportText] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [layout, setLayout] = useState({ seed: initial.def.seed, length: initial.def.length, style: initial.def.style as CourseStyle });
  const drag = useRef<{ kind: Kind; index: number; grab: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // The floors come from the seed: planned again only when the seed, length or style changes.
  const plan = useMemo(() => basePlan(def), [def.seed, def.length, def.style]); // eslint-disable-line react-hooks/exhaustive-deps
  const check = useMemo(() => validatePlatformerDef(def), [def]);
  const errors = check.ok ? [] : check.errors;

  const edit = (fn: (d: PlatformerDef) => PlatformerDef) => { setDef((d) => fn(d)); setDirty(true); setNote(null); };
  const setItem = (kind: Kind, index: number, patch: Record<string, unknown>) => edit((d) => {
    const list = [...d[kind]] as unknown[];
    list[index] = place(kind, { ...(list[index] as object), ...patch } as never, plan);
    return { ...d, [kind]: list } as PlatformerDef;
  });
  const remove = (s: NonNullable<Selection>) => { edit((d) => ({ ...d, [s.kind]: d[s.kind].filter((_, i) => i !== s.index) }) as PlatformerDef); setSel(null); };

  // Delete removes the selection (not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); remove(sel); }
      if (e.key === 'Escape') { setTool(null); setSel(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---- the strip: the world window, and where its centre sits vertically (it follows the middle lane's hill)
  const worldW = VIEW_W / zoom;
  const centreX = scrollX + worldW / 2;
  const centreY = floorAt(plan, 1, centreX) ?? floorAt(plan, 1, centreX - 200) ?? plan.startY;
  const sx = (x: number) => (x - scrollX) * zoom;
  const sy = (y: number) => (y - centreY) * zoom + VIEW_H * 0.55;
  const toWorld = (clientX: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return scrollX + ((clientX - r.left) / r.width) * worldW;
  };
  const laneAtPointer = (clientY: number, x: number): Lane => {
    const r = svgRef.current!.getBoundingClientRect();
    const py = ((clientY - r.top) / r.height) * VIEW_H;
    let best: Lane = 1, bestD = Infinity;
    for (const l of [0, 1, 2] as Lane[]) { const f = floorAt(plan, l, x); if (f === null) continue; const d = Math.abs(sy(f) - py); if (d < bestD) { bestD = d; best = l; } }
    return best;
  };

  const floorPoints = (lane: Lane) => {
    const segs: string[] = [];
    let cur: string[] = [];
    for (let x = Math.floor(scrollX / 40) * 40; x <= scrollX + worldW + 40; x += 40) {
      const f = floorAt(plan, lane, x);
      if (f === null) { if (cur.length > 1) segs.push(cur.join(' ')); cur = []; continue; }
      cur.push(`${sx(x).toFixed(1)},${sy(f).toFixed(1)}`);
    }
    if (cur.length > 1) segs.push(cur.join(' '));
    return segs;
  };

  const onStripDown = (e: React.PointerEvent) => {
    if (!tool) { setSel(null); return; }
    const x = snap10(toWorld(e.clientX));
    const lane = laneAtPointer(e.clientY, x);
    if (floorAt(plan, lane, x) === null && tool !== 'ledges') { setNote('There is no floor there: that is a chasm. Pick a lane with floor.'); return; }
    const item = fresh(tool, lane, x, plan);
    edit((d) => ({ ...d, [tool]: [...d[tool], item] }) as PlatformerDef);
    setSel({ kind: tool, index: def[tool].length });
    setTool(null);
  };
  const startDrag = (e: React.PointerEvent, kind: Kind, index: number) => {
    e.stopPropagation();
    setSel({ kind, index });
    setTool(null);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { kind, index, grab: toWorld(e.clientX) - (def[kind][index] as { x: number }).x };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const x = snap10(toWorld(e.clientX) - d.grab);
    const lane = laneAtPointer(e.clientY, x);
    const cur = def[d.kind][d.index] as unknown as { x: number; lane: Lane; to?: Lane };
    if (cur.x === x && cur.lane === lane) return;
    const patch: Record<string, unknown> = { x, lane };
    if (d.kind === 'gates' && (cur.to === lane || Math.abs((cur.to ?? 1) - lane) !== 1)) patch.to = lane === 1 ? 0 : 1;
    setItem(d.kind, d.index, patch);
  };
  const endDrag = () => { drag.current = null; };

  // ---- actions
  const regrow = () => {
    edit(() => ({ ...defFromSeed(layout.seed, layout.length, layout.style, def.name, def.theme) }));
    setSel(null);
    setNote('The land was grown again from the new seed, and everything on it was reset.');
  };
  const layoutChanged = layout.seed !== def.seed || layout.length !== def.length || layout.style !== def.style;
  const save = () => {
    const r = saveCourse(def, savedId);
    if ('error' in r) { setNote(r.error); return; }
    setSavedId(r.id);
    setDirty(false);
    setNote('Saved to My platformer courses.');
  };
  const doShare = async () => {
    try { setShare({ code: await encodePlatformerCode(def) }); } catch (e) { setNote(e instanceof Error ? e.message : 'Could not make a code.'); }
  };
  const doImport = async () => {
    try {
      const next = await decodePlatformerCode(importText);
      setDef(next);
      setLayout({ seed: next.seed, length: next.length, style: next.style });
      setDirty(true);
      setSel(null);
      setImportText('');
      setNote(`Loaded “${next.name}”.`);
    } catch (e) { setNote(e instanceof PlatformerCodeError ? e.message : 'That code could not be read.'); }
  };

  const selected = sel ? (def[sel.kind][sel.index] as unknown as Record<string, number | string>) : null;

  const itemShape = (kind: Kind, it: Record<string, number | string>, index: number) => {
    const lane = it.lane as Lane;
    const x = it.x as number;
    const isSel = sel?.kind === kind && sel.index === index;
    const stroke = isSel ? '#fff' : 'none';
    const props = { key: `${kind}${index}`, onPointerDown: (e: React.PointerEvent) => startDrag(e, kind, index), style: { cursor: 'grab' }, stroke, strokeWidth: 2 } as const;
    const f = floorAt(plan, lane, x + 20) ?? centreY;
    switch (kind) {
      case 'springs': return <rect {...props} x={sx(x)} y={sy(it.y as number) - 16 * zoom * 6} width={SPRING_W * zoom} height={16 * zoom * 6} fill="#4ade80" rx="2" />;
      case 'ledges': return <rect {...props} x={sx(x)} y={sy(it.y as number)} width={(it.w as number) * zoom} height={5} fill="#c08a4a" rx="2" />;
      case 'gates': {
        const to = it.to as Lane;
        const yTo = floorAt(plan, to, x + (it.w as number) / 2) ?? f;
        const top = Math.min(sy(it.y as number), sy(yTo)), h = Math.abs(sy(it.y as number) - sy(yTo)) || 6;
        return <g {...props}><rect x={sx(x)} y={top} width={(it.w as number) * zoom} height={h} fill={it.kind === 'door' ? '#a78bfa' : '#38bdf8'} fillOpacity="0.45" stroke={isSel ? '#fff' : LANE_COLORS[to]} strokeWidth={2} /><text x={sx(x) + 2} y={top + 11} fontSize="9" fill="#fff">{it.kind === 'door' ? 'door' : 'ramp'}</text></g>;
      }
      case 'boosts': return <rect {...props} x={sx(x)} y={sy(f) - 7} width={(it.w as number) * zoom} height={7} fill="#fb923c" rx="2" />;
      case 'itemBoxes': return <rect {...props} x={sx(x) - 6} y={sy(it.y as number) - 6} width={12} height={12} fill="#fde047" rx="2" />;
      case 'wreckers': {
        const px = sx(x), py = sy(it.pivotY as number), bx = px, by = py + (it.chain as number) * zoom;
        return <g {...props}><line x1={px} y1={py} x2={bx} y2={by} stroke="#9ca3af" strokeWidth="2" /><circle cx={bx} cy={by} r={6} fill="#6b7280" /><rect x={px - 10} y={py - 4} width={20} height={4} fill="#a16207" /></g>;
      }
      case 'bumps': return <rect {...props} x={sx(x)} y={sy(it.y as number)} width={(it.w as number) * zoom} height={Math.max(4, (it.h as number) * zoom)} fill="#9ca3af" rx="1" />;
    }
  };

  return <div className="app-shell platformer-editor">
    <header className="pe-head">
      <button className="button-secondary" onClick={() => (dirty ? setLeaving(true) : onExit())}><ArrowLeft size={14} />Back</button>
      <input className="pe-name" value={def.name} maxLength={48} aria-label="Course name" onChange={(e) => edit((d) => ({ ...d, name: e.target.value }))} />
      <span className="pe-state">{dirty ? 'unsaved' : 'saved'}</span>
      <span className="pe-spacer" />
      <button className="button-secondary" onClick={save} disabled={!check.ok}><Save size={14} />Save</button>
      <button className="button-secondary" onClick={() => void doShare()} disabled={!check.ok}><Share2 size={14} />Share</button>
      <button className="button-secondary" onClick={() => setPublishing(true)} disabled={!check.ok}><Users size={14} />Publish</button>
      <button className="button-primary" onClick={() => onTestDrive(def, { id: savedId, dirty })} disabled={!check.ok}><Play size={14} />Test drive</button>
    </header>

    <main className="pe-main">
      <section className="pe-strip" aria-label="Course side view">
        <svg ref={svgRef} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={`Side view of ${def.name}: three lanes, ${def.gates.length} gates`} onPointerDown={onStripDown} onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag} style={{ cursor: tool ? 'crosshair' : 'default', touchAction: 'none' }}>
          <rect width={VIEW_W} height={VIEW_H} fill="#0d1620" />
          {([0, 1, 2] as Lane[]).flatMap((l) => floorPoints(l).map((pts, i) => <polyline key={`f${l}-${i}`} points={pts} fill="none" stroke={LANE_COLORS[l]} strokeWidth={l === 1 ? 3 : 2} opacity={l === 1 ? 1 : 0.8} />))}
          {plan.loops?.map((l, i) => <circle key={`lp${i}`} cx={sx(l.x + l.pitch / 2)} cy={sy(l.y - l.r)} r={l.r * zoom} fill="none" stroke="#d6a45a" strokeWidth="3" />)}
          {plan.bridges?.map((b, i) => <line key={`br${i}`} x1={sx(b.x0)} y1={sy(b.y0)} x2={sx(b.x1)} y2={sy(b.y1)} stroke="#a16207" strokeWidth="3" strokeDasharray="4 2" />)}
          <line x1={sx(plan.startX)} x2={sx(plan.startX)} y1="0" y2={VIEW_H} stroke="#38bdf8" strokeDasharray="3 3" opacity="0.6" />
          <line x1={sx(plan.finishX)} x2={sx(plan.finishX)} y1="0" y2={VIEW_H} stroke="#f97316" strokeDasharray="3 3" opacity="0.8" />
          {KINDS.flatMap((kind) => (def[kind] as unknown as Record<string, number | string>[]).map((it, i) => itemShape(kind, it, i)))}
        </svg>
        <div className="pe-scroll">
          <button className="icon-button" onClick={() => setScrollX((x) => Math.max(0, x - worldW * 0.5))} aria-label="Scroll left">◀</button>
          <input type="range" min={0} max={def.length} step={20} value={Math.round(scrollX)} aria-label="Position along the course" onChange={(e) => setScrollX(Number(e.target.value))} />
          <button className="icon-button" onClick={() => setScrollX((x) => Math.min(def.length, x + worldW * 0.5))} aria-label="Scroll right">▶</button>
          <button className="icon-button" onClick={() => setZoom((z) => Math.max(0.05, z / 1.4))} aria-label="Zoom out">−</button>
          <button className="icon-button" onClick={() => setZoom((z) => Math.min(0.6, z * 1.4))} aria-label="Zoom in">+</button>
          <span className="pe-where">{Math.round(scrollX).toLocaleString('en-US')} / {def.length.toLocaleString('en-US')}</span>
        </div>
      </section>

      <section className="pe-tools" aria-label="Things to place">
        {KINDS.map((k) => <button key={k} className={`button-secondary ${tool === k ? 'is-armed' : ''}`} aria-pressed={tool === k} onClick={() => { setTool(tool === k ? null : k); setSel(null); }}>{KIND_LABEL[k]}<small>{def[k].length}</small></button>)}
        <span className="pe-hint">{tool ? `Click a lane on the strip to place a ${KIND_LABEL[tool]}.` : 'Pick a thing, then click a lane. Click a thing to select it; drag it along the strip.'}</span>
      </section>

      <div className="pe-panels">
        <section className="pe-panel" aria-label="Selected thing">
          {sel && selected ? <>
            <h3>{KIND_LABEL[sel.kind]} {sel.index + 1}</h3>
            <div className="pe-row" role="group" aria-label="Lane">{([0, 1, 2] as Lane[]).map((l) => <button key={l} className={`button-secondary ${selected.lane === l ? 'is-armed' : ''}`} aria-pressed={selected.lane === l} onClick={() => setItem(sel.kind, sel.index, sel.kind === 'gates' && Math.abs((selected.to as number) - l) !== 1 ? { lane: l, to: l === 1 ? 0 : 1 } : { lane: l })}>{LANE_NAMES[l]}</button>)}</div>
            <label className="pe-field">Along <input type="number" step={10} value={Math.round(selected.x as number)} onChange={(e) => setItem(sel.kind, sel.index, { x: snap10(Number(e.target.value)) })} /></label>
            {'w' in selected && sel.kind !== 'gates' && <label className="pe-field">Width <input type="number" step={10} value={selected.w as number} onChange={(e) => setItem(sel.kind, sel.index, { w: Number(e.target.value) })} /></label>}
            {sel.kind === 'gates' && <>
              <div className="pe-row" role="group" aria-label="Kind">{(['ramp', 'door'] as const).map((k) => <button key={k} className={`button-secondary ${selected.kind === k ? 'is-armed' : ''}`} aria-pressed={selected.kind === k} onClick={() => setItem('gates', sel.index, { kind: k })}>{k}</button>)}</div>
              <div className="pe-row" role="group" aria-label="Leads to">{([0, 1, 2] as Lane[]).filter((l) => Math.abs(l - (selected.lane as number)) === 1).map((l) => <button key={l} className={`button-secondary ${selected.to === l ? 'is-armed' : ''}`} aria-pressed={selected.to === l} onClick={() => setItem('gates', sel.index, { to: l })}>to {LANE_NAMES[l]}</button>)}</div>
            </>}
            {sel.kind === 'ledges' && <label className="pe-field">Height above floor <input type="number" step={10} value={Math.round((floorAt(plan, selected.lane as Lane, (selected.x as number) + 20) ?? 0) - (selected.y as number))} onChange={(e) => setItem('ledges', sel.index, { y: round1((floorAt(plan, selected.lane as Lane, (selected.x as number) + 20) ?? 0) - Number(e.target.value)) })} /></label>}
            {sel.kind === 'bumps' && <label className="pe-field">Height <input type="number" step={4} value={selected.h as number} onChange={(e) => setItem('bumps', sel.index, { h: Number(e.target.value) })} /></label>}
            {sel.kind === 'wreckers' && <>
              <label className="pe-field">Chain <input type="number" step={10} value={selected.chain as number} onChange={(e) => setItem('wreckers', sel.index, { chain: Number(e.target.value) })} /></label>
              <label className="pe-field">Swing <input type="range" min={0.3} max={1.3} step={0.05} value={selected.amp as number} onChange={(e) => setItem('wreckers', sel.index, { amp: Number(e.target.value) })} /></label>
              <label className="pe-field">Speed <input type="range" min={0.001} max={0.004} step={0.0002} value={selected.speed as number} onChange={(e) => setItem('wreckers', sel.index, { speed: Number(e.target.value) })} /></label>
            </>}
            <button className="button-secondary" onClick={() => remove(sel)}><Trash2 size={14} />Delete</button>
          </> : <>
            <h3>Course</h3>
            <label className="pe-field">Seed <input type="number" min={0} value={layout.seed} onChange={(e) => setLayout((l) => ({ ...l, seed: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))} /><button className="icon-button" aria-label="Random seed" onClick={() => setLayout((l) => ({ ...l, seed: Math.floor(Math.random() * 1e6) }))}><Dices size={15} /></button></label>
            <label className="pe-field">Length <input type="range" min={MIN_LENGTH} max={MAX_LENGTH} step={1000} value={layout.length} onChange={(e) => setLayout((l) => ({ ...l, length: Number(e.target.value) }))} /><span>{(layout.length / 1000).toFixed(0)}k</span></label>
            <div className="pe-row" role="group" aria-label="Style">{(['flow', 'blocks'] as const).map((s) => <button key={s} className={`button-secondary ${layout.style === s ? 'is-armed' : ''}`} aria-pressed={layout.style === s} onClick={() => setLayout((l) => ({ ...l, style: s }))}>{s === 'flow' ? 'Rolling slopes' : 'Blocks'}</button>)}</div>
            <label className="pe-field">Theme <select value={def.theme} onChange={(e) => edit((d) => ({ ...d, theme: e.target.value as ThemeId }))}>{THEME_IDS.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
            {layoutChanged && <button className="button-secondary" onClick={regrow}><Flag size={14} />Grow the land again (resets the things on it)</button>}
          </>}
        </section>

        <section className="pe-panel" aria-label="Problems and sharing">
          <h3>{errors.length ? `${errors.length} problem${errors.length === 1 ? '' : 's'}` : 'Ready to race'}</h3>
          {errors.length > 0 && <ul className="pe-errors" role="alert">{errors.map((m) => <li key={m}>{m}</li>)}</ul>}
          {note && <p className="pe-note" role="status">{note}</p>}
          <label className="pe-field pe-import">Load a code <input value={importText} placeholder="pf1-…" onChange={(e) => setImportText(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /><button className="button-secondary" onClick={() => void doImport()} disabled={!importText.trim()}>Load</button></label>
        </section>
      </div>
    </main>

    {share && <Dialog titleId="pe-share-title" onClose={() => setShare(null)} className="publish-dialog">
      <h2 id="pe-share-title">Share this course</h2>
      <p className="dialog-intro">Send this code to a friend. They paste it into “Load a code” in their Workshop.</p>
      <textarea className="pe-code" readOnly value={share.code} rows={4} onFocus={(e) => e.currentTarget.select()} aria-label="Course code" />
      <div className="pause-actions">
        <button className="button-secondary" onClick={() => setShare(null)}>Close</button>
        <button className="button-primary" onClick={() => { void navigator.clipboard?.writeText(share.code); setNote('Code copied.'); }}><Copy size={14} />Copy</button>
      </div>
    </Dialog>}
    {publishing && <PublishCourseDialog def={def} onClose={() => setPublishing(false)} />}
    {leaving && <ConfirmDialog title="Leave without saving?" message="This course has changes that are not saved." confirmLabel="Leave anyway" onConfirm={onExit} onCancel={() => setLeaving(false)} />}
  </div>;
}

/** Publish the course to the community: pick up to three tags, publish. */
function PublishCourseDialog({ def, onClose }: { def: PlatformerDef; onClose: () => void }) {
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const toggle = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : cur.length >= MAX_TAGS ? cur : [...cur, t]));
  const go = async () => {
    setBusy(true); setError(null);
    try { await publishCourse(def, tags); setDone(true); } catch (e) { setError(e instanceof PublishError ? e.message : 'Publishing failed. Try again.'); } finally { setBusy(false); }
  };
  return <Dialog titleId="pe-publish-title" onClose={onClose} className="publish-dialog">
    <span className="eyebrow"><Users size={14} /> COMMUNITY</span>
    <h2 id="pe-publish-title">{done ? 'Published!' : 'Publish your course'}</h2>
    <p className="dialog-intro">{done ? 'Everyone can now find it in Quick race > Platformer > Community and race it.' : `“${def.name}” goes up for everyone to race, with your username on it. Pick up to ${MAX_TAGS} tags.`}</p>
    {!done && <div className="community-tags publish-tags" role="group" aria-label="Tags">{COMMUNITY_TAGS.map((t) => <button key={t} type="button" className={tags.includes(t) ? 'selected' : ''} aria-pressed={tags.includes(t)} disabled={!tags.includes(t) && tags.length >= MAX_TAGS} onClick={() => toggle(t)}>{t}</button>)}</div>}
    {error && <p className="community-error" role="alert">{error}</p>}
    <div className="pause-actions">
      {done ? <button className="button-primary" onClick={onClose}>Done</button> : <>
        <button className="button-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="button-primary" onClick={() => void go()} disabled={busy}>{busy ? 'Publishing…' : 'Publish'}</button>
      </>}
    </div>
  </Dialog>;
}
