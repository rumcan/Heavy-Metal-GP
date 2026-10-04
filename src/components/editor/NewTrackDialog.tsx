import { useState, useMemo } from 'react';
import { X, Sparkles, LayoutGrid, Zap, Target, ShoppingCart, Dices, Flag, ArrowRight, ArrowLeft, MoveRight, MoveDown } from 'lucide-react';
import { CALENDAR } from '../../game/season';
import { championshipTrack as officialTrack } from '../../game/championship-tracks';
import { generateExperimentalTrackDef } from '../../game/trackdef';
import type { TrackDef } from '../../game/trackdef';
import { TEMPLATES, blankTemplate } from '../../game/templates';
import TrackThumbnail from './TrackThumbnail';
import { defFromPlan, newPlatformerDef } from '../../game/platformer/def';
import { PLATFORMER_COURSES, planOfficial } from '../../game/platformer/course';
import { planFlow } from '../../game/platformer/flow';

interface Props {
  onClose: () => void;
  onCreate: (def: TrackDef) => void;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

/** The two kinds of track. The player picks one first, so nobody lands in the wrong editor by accident. */
export type TrackKind = 'platformer' | 'drop';

export const KIND_INFO: Record<TrackKind, { title: string; tagline: string; points: string[] }> = {
  platformer: {
    title: 'Platformer course',
    tagline: 'Side-scrolling. You build sideways and down.',
    points: ['Marbles race left to right, downhill', 'Three lanes, front to back', 'Floors, curves, springs, loops, bridges'],
  },
  drop: {
    title: 'Drop track',
    tagline: 'The classic marble run. You build top to bottom.',
    points: ['Marbles fall down a tall shaft', 'Pegs, ramps, rails, ferries', 'Like the championship circuits'],
  },
};

/** Little pictures of each kind: the shape of the track tells the player what they will be building. */
function KindArt({ kind }: { kind: TrackKind }) {
  if (kind === 'platformer') {
    return <svg viewBox="0 0 200 110" aria-hidden="true" className="new-track-kind-art">
      <path d="M8 26 H48 L86 46 C104 56 118 56 134 48 L192 76" fill="none" stroke="#e4b86a" strokeWidth="2.5" opacity="0.6" />
      <path d="M8 40 H48 L86 60 C104 70 118 70 134 62 L192 90" fill="none" stroke="#cfe0ef" strokeWidth="4" />
      <path d="M8 54 H48 L86 74 C104 84 118 84 134 76 L192 104" fill="none" stroke="#4c6a86" strokeWidth="2.5" opacity="0.7" />
      <circle cx="30" cy="33" r="6" fill="#d63e2e" />
      <path d="M150 18 h34 m-8 -6 l8 6 l-8 6" fill="none" stroke="#ffb347" strokeWidth="2.5" />
    </svg>;
  }
  return <svg viewBox="0 0 200 110" aria-hidden="true" className="new-track-kind-art">
    <rect x="62" y="4" width="76" height="102" rx="4" fill="none" stroke="#2a3a52" strokeWidth="2" />
    <path d="M70 20 L118 34 M130 48 L82 62 M70 76 L118 90" stroke="#cfe0ef" strokeWidth="4" strokeLinecap="round" />
    {[[92, 44], [108, 70], [86, 96], [124, 20]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="3" fill="#ff7a3d" />)}
    <circle cx="80" cy="12" r="6" fill="#d63e2e" />
    <path d="M168 18 v34 m-6 -8 l6 8 l6 -8" fill="none" stroke="#ffb347" strokeWidth="2.5" />
  </svg>;
}

/**
 * New track, in two steps. First WHAT KIND: a platformer course (built sideways) or a drop track (built top to
 * bottom), as two big pictures. Then WHERE TO START for that kind: blank, a copy of an official track, a starter,
 * or a generated layout. The second step always says which kind it is making and has a Back link.
 */
export default function NewTrackDialog({ onClose, onCreate }: Props) {
  const [kind, setKind] = useState<TrackKind | null>(null);
  const use = (def: TrackDef) => { onCreate(def); onClose(); };

  return (
    <div className="new-track-overlay" role="dialog" aria-modal="true" aria-labelledby="new-track-title" onClick={onClose}>
      <div className="new-track-sheet" onClick={(e) => e.stopPropagation()}>
        <header className="new-track-head">
          {kind && <button className="text-button new-track-back" onClick={() => setKind(null)}><ArrowLeft size={13} /> Track type</button>}
          <h2 id="new-track-title">{kind ? `New ${KIND_INFO[kind].title.toLowerCase()}` : 'New track: pick a type'}</h2>
          <p>{kind ? `${KIND_INFO[kind].tagline} Now choose where to start.` : 'Two kinds of track, built in the same Workshop. You can make as many of each as you like.'}</p>
          <button className="icon-button new-track-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>
        <div className="new-track-body">
          {!kind && <KindPicker onPick={setKind} />}
          {kind === 'platformer' && <PlatformerStarts use={use} />}
          {kind === 'drop' && <DropStarts use={use} />}
        </div>
      </div>
    </div>
  );
}

function KindPicker({ onPick }: { onPick: (kind: TrackKind) => void }) {
  return <div className="new-track-kinds">
    {(['platformer', 'drop'] as const).map((k) => {
      const info = KIND_INFO[k];
      const Arrow = k === 'platformer' ? MoveRight : MoveDown;
      return <button key={k} className="new-track-kind" data-testid={`kind-${k}`} onClick={() => onPick(k)}>
        <KindArt kind={k} />
        <strong><Arrow size={16} /> {info.title}</strong>
        <span className="new-track-kind-tag">{info.tagline}</span>
        <ul>{info.points.map((p) => <li key={p}>{p}</li>)}</ul>
        <em className="new-track-cta">Choose {info.title.toLowerCase()} <ArrowRight size={12} /></em>
      </button>;
    })}
  </div>;
}

function Card({ def, title, desc, cta, onPick, testId }: { def: TrackDef; title: React.ReactNode; desc: string; cta: string; onPick: () => void; testId?: string }) {
  return <button className="new-track-card" data-testid={testId} onClick={onPick}>
    <TrackThumbnail def={def} wide={def.mode === 'platformer'} />
    <strong>{title}</strong>
    <span>{desc}</span>
    <em className="new-track-cta">{cta} <ArrowRight size={12} /></em>
  </button>;
}

function PlatformerStarts({ use }: { use: (def: TrackDef) => void }) {
  const blank = useMemo(() => newPlatformerDef('My platformer course'), []);
  const copies = useMemo(() => PLATFORMER_COURSES.filter((c) => !c.tutorial).map((c) => ({ c, def: defFromPlan(planOfficial(c), `${c.name} copy`) })), []);
  const [seed, setSeed] = useState(() => randomSeed());
  const generated = useMemo(() => defFromPlan(planFlow(seed), `Random course #${seed % 10000}`), [seed]);
  return <>
    <section className="new-track-section">
      <h3><LayoutGrid size={14} /> Start from scratch</h3>
      <div className="new-track-grid">
        <Card testId="new-platformer" def={blank} title="Blank course" desc="Just the start platform and the finish line. Draw the floors yourself with Ramp and Curve: drag their handles to make them as steep as you like." cta="Start building" onPick={() => use(newPlatformerDef('My platformer course'))} />
        <Card testId="generate-platformer" def={generated} title={<><Dices size={13} /> Random course</>} desc="Rolling hills made for you. Reshape any piece afterwards." cta="Use this one" onPick={() => use(generated)} />
      </div>
      <button className="text-button" onClick={() => setSeed(randomSeed())}><Dices size={13} /> Roll another random course</button>
    </section>
    <section className="new-track-section">
      <h3><Flag size={14} /> Copy an official course</h3>
      <p className="new-track-hint">An editable copy. The original is not changed.</p>
      <div className="new-track-grid">
        {copies.map(({ c, def }) => <Card key={c.id} testId={`copy-${c.id}`} def={def} title={c.name} desc={c.blurb} cta="Edit a copy" onPick={() => use(def)} />)}
      </div>
    </section>
  </>;
}

function DropStarts({ use }: { use: (def: TrackDef) => void }) {
  const blank = useMemo(() => blankTemplate(), []);
  const handMade = useMemo(() => TEMPLATES.filter((t) => t.id !== 'blank').map((t) => ({ ...t, preview: t.build() })), []);
  const circuits = useMemo(() => CALENDAR.map((gp) => ({ gp, def: officialTrack(gp.id) })).filter((c): c is { gp: typeof CALENDAR[number]; def: TrackDef } => !!c.def), []);
  const [style, setStyle] = useState(0);
  const [seed, setSeed] = useState(() => randomSeed());
  const gp = CALENDAR[style] ?? CALENDAR[0];
  const generated = useMemo(() => {
    const def = generateExperimentalTrackDef(seed, gp.profile, `${gp.short} style #${seed % 10000}`);
    return { ...def, name: def.name.slice(0, 48) };
  }, [seed, gp]);
  return <>
    <section className="new-track-section">
      <h3><LayoutGrid size={14} /> Start from scratch</h3>
      <div className="new-track-grid">
        <Card testId="new-drop" def={blank} title="Blank drop track" desc="Just the start grid and the finish. Build anything, top to bottom." cta="Start building" onPick={() => use(blankTemplate())} />
        <Card testId="generate-drop" def={generated} title={<><Dices size={13} /> Random track</>} desc={`Generated in the style of ${gp.name}: ${gp.desc}`} cta="Use this one" onPick={() => use(generated)} />
      </div>
      <div className="new-track-generate">
        <label htmlFor="new-track-style">Random track style</label>
        <select id="new-track-style" value={style} onChange={(e) => setStyle(Number(e.target.value))}>
          {CALENDAR.map((g, i) => <option key={g.id} value={i}>{g.flag} {g.short} style</option>)}
        </select>
        <button className="text-button" onClick={() => setSeed(randomSeed())}><Dices size={13} /> Roll another</button>
      </div>
    </section>
    <section className="new-track-section">
      <h3><Flag size={14} /> Copy a championship circuit</h3>
      <p className="new-track-hint">An editable copy. The championship itself is not changed.</p>
      <div className="new-track-grid">
        {circuits.map(({ gp: g, def }) => <Card key={g.id} def={def} title={<><small className="new-track-flag">{g.flag}</small> {g.name}</>} desc={`${def.pieces.length} pieces · ${g.desc}`} cta="Edit a copy" onPick={() => use({ ...JSON.parse(JSON.stringify(def)), name: `${g.short} copy` })} />)}
      </div>
    </section>
    <section className="new-track-section">
      <h3><Sparkles size={14} /> Starter templates</h3>
      <p className="new-track-hint">Small hand-made starters for one kind of drop track.</p>
      <div className="new-track-grid">
        {handMade.map((e) => {
          const Icon = e.id === 'loop' ? Zap : e.id === 'peggle' ? Target : ShoppingCart;
          return <Card key={e.id} def={e.preview} title={<><Icon size={13} /> {e.label}</>} desc={e.desc} cta="Use this" onPick={() => use(e.build())} />;
        })}
      </div>
    </section>
  </>;
}
