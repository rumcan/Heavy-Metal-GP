import { useMemo, useState } from 'react';
import { Map, ChevronDown, ChevronUp, Flag } from 'lucide-react';
import { meta, W } from '../game/track';
import type { Track } from '../game/track';
import type { MarbleInfo } from '../game/types';

export interface MapRacer { id: number; x: number; y: number; time: number | null }
interface Props { track: Track; racers: MapRacer[]; roster: MarbleInfo[]; viewTop: number; viewBottom: number; progress: number }

export default function RaceMinimap({ track, racers, roster, viewTop, viewBottom, progress }: Props) {
  const [open, setOpen] = useState(true);
  const width = 82;
  const height = 252;
  const y = (value: number) => Math.max(0, Math.min(height, value / track.finishY * height));
  const x = (value: number) => 10 + Math.max(0, Math.min(W, value)) / W * width;
  const geometry = useMemo(() => track.ramps.filter((ramp) => ramp.position.y < track.finishY).map((ramp) => {
    const surface = meta(ramp).surface!;
    return { id: ramp.id, x1: 10 + surface.start.x / W * width, x2: 10 + surface.end.x / W * width, y1: surface.start.y / track.finishY * height, y2: surface.end.y / track.finishY * height, ice: meta(ramp).kind === 'ice' };
  }), [track]);
  if (track.platformer) return <PlatformMap track={track} racers={racers} roster={roster} progress={progress} open={open} setOpen={setOpen} />;
  return <aside className={`race-minimap ${open ? '' : 'map-collapsed'}`} aria-label="Circuit minimap"><button className="minimap-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? 'Collapse minimap' : 'Expand minimap'}><Map size={13} /><span>COURSE MAP</span>{open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button>
    {open && <><div className="minimap-edge-labels"><span>START</span><span>3X CIRCUIT</span></div><svg viewBox="0 -7 102 268" className="minimap-svg" role="img" aria-label={`Full circuit with all ten racers. You have completed ${Math.round(progress * 100)} percent.`}>
      <rect x="9" y="0" width="84" height={height} rx="1" fill="#101a26" stroke="#3a4d61" strokeWidth=".7" />
      {track.segments.filter((s) => s.name !== 'Start' && s.name !== 'Finish').map((s, i) => <g key={i}><rect x="10" y={y(s.y)} width={width} height={Math.max(1, y(s.y + s.h) - y(s.y))} fill={s.name === 'Peggle Board' || s.name === 'Peg Field' ? '#3477a72b' : i % 2 ? '#ffffff03' : 'transparent'} /><line x1="4" x2="8" y1={y(s.y)} y2={y(s.y)} stroke="#66809a" strokeWidth=".6" /></g>)}
      {geometry.map((ramp) => <line key={ramp.id} x1={ramp.x1} y1={ramp.y1} x2={ramp.x2} y2={ramp.y2} stroke={ramp.ice ? '#64bad7' : '#6b8194'} strokeWidth=".8" />)}
      <rect className="minimap-viewport" x="9" y={y(viewTop)} width="84" height={Math.max(5, y(viewBottom) - y(viewTop))} fill="#d63e2e12" stroke="#d63e2e" strokeWidth="1" />
      <line x1="9" x2="93" y1={height} y2={height} stroke="#f2f5fa" strokeWidth="2" strokeDasharray="3 3" />
      {[...racers].sort((a, b) => Number(roster.find((m) => m.id === a.id)?.isPlayer) - Number(roster.find((m) => m.id === b.id)?.isPlayer)).map((racer) => { const m = roster.find((r) => r.id === racer.id)!; return <circle className={m.isPlayer ? 'minimap-player' : ''} key={racer.id} cx={x(racer.x)} cy={y(racer.time !== null ? track.finishY : racer.y)} r={m.isPlayer ? 3.5 : 2} fill={m.color} stroke={m.isPlayer ? '#fff' : '#132233'} strokeWidth={m.isPlayer ? 1.25 : .65}><title>{m.isPlayer ? 'You' : m.name}{racer.time !== null ? ' / Finished' : ''}</title></circle>; })}
    </svg><div className="minimap-finish"><Flag size={11} /><span>FINISH</span><b>{Math.round(progress * 100)}%</b></div><div className="minimap-legend"><i />YOU <span />CAMERA</div></>}
  </aside>;
}
/** P2-00: a platformer course seen from the side — the middle lane's floors, the finish flag and every racer. */
function PlatformMap({ track, racers, roster, progress, open, setOpen }: { track: Track; racers: MapRacer[]; roster: MarbleInfo[]; progress: number; open: boolean; setOpen: (open: boolean) => void }) {
  const plan = track.platformer!.plan;
  const top = plan.startY - 120;
  const bottom = plan.finishY + 120;
  const x = (v: number) => 4 + Math.max(0, Math.min(plan.width, v)) / plan.width * 94;
  const y = (v: number) => 4 + Math.max(0, Math.min(1, (v - top) / (bottom - top))) * 52;
  const floors = useMemo(() => plan.floors.filter((f) => f.lane === 1), [plan]);
  return <aside className={`race-minimap ${open ? '' : 'map-collapsed'}`} aria-label="Course map"><button className="minimap-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? 'Collapse minimap' : 'Expand minimap'}><Map size={13} /><span>COURSE MAP</span>{open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button>
    {open && <><div className="minimap-edge-labels"><span>START</span><span>FINISH</span></div><svg viewBox="0 0 102 60" className="minimap-svg" role="img" aria-label={`The course from the side with all ten racers. You have completed ${Math.round(progress * 100)} percent.`}>
      <rect x="2" y="2" width="98" height="56" rx="1" fill="#101a26" stroke="#3a4d61" strokeWidth=".7" />
      {floors.map((f, i) => <line key={i} x1={x(f.x0)} y1={y(f.y0)} x2={x(f.x1)} y2={y(f.y1)} stroke="#6aa232" strokeWidth="1.2" />)}
      <line x1={x(plan.finishX)} x2={x(plan.finishX)} y1={y(plan.finishY) - 8} y2={y(plan.finishY)} stroke="#f2f5fa" strokeWidth="1" strokeDasharray="1.5 1.5" />
      {[...racers].sort((a, b) => Number(roster.find((m) => m.id === a.id)?.isPlayer) - Number(roster.find((m) => m.id === b.id)?.isPlayer)).map((racer) => { const m = roster.find((r) => r.id === racer.id)!; return <circle className={m.isPlayer ? 'minimap-player' : ''} key={racer.id} cx={x(racer.time !== null ? plan.finishX : racer.x)} cy={y(racer.time !== null ? plan.finishY : racer.y) - 1.5} r={m.isPlayer ? 2.6 : 1.6} fill={m.color} stroke={m.isPlayer ? '#fff' : '#132233'} strokeWidth={m.isPlayer ? 1 : .5}><title>{m.isPlayer ? 'You' : m.name}{racer.time !== null ? ' / Finished' : ''}</title></circle>; })}
    </svg><div className="minimap-finish"><Flag size={11} /><span>FINISH</span><b>{Math.round(progress * 100)}%</b></div></>}
  </aside>;
}
