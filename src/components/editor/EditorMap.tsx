/**
 * MB-02. The course map strip: the race screens' minimap, wearing the editor's job.
 *
 * Same source data as `RaceMinimap` in a race — the circuit's sectors, the rail surfaces and the finish line —
 * but drawn to a fixed strip so a world height maps straight onto a pixel row (`preserveAspectRatio="none"`,
 * no text inside the SVG, strokes kept at 1px). That makes the strip a scrollbar: press or drag it and the
 * camera follows, and the accent rectangle shows the window the canvas is currently drawing.
 */
import { useRef } from 'react';
import { Flag, MoveVertical } from 'lucide-react';
import { meta, W } from '../../game/track';
import type { Track } from '../../game/track';
import { formatUnits } from './camera';

interface Props {
  track: Track | null;
  /** The world window the canvas shows. */
  top: number;
  bottom: number;
  /** Move the camera's centre to a world height. */
  onJump: (worldY: number) => void;
}

const X0 = 12;
const XW = 80;

export default function EditorMap({ track, top, bottom, onJump }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

  if (!track) return <aside className="editor-map" aria-label="Course map"><div className="editor-map-head"><span>COURSE MAP</span></div><p className="editor-map-empty">No circuit yet.</p></aside>;

  const height = Math.max(1, track.height);
  const x = (worldX: number) => X0 + Math.max(0, Math.min(W, worldX)) / W * XW;
  const jumpFrom = (clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.height < 1) return;
    onJump(Math.max(0, Math.min(height, ((clientY - rect.top) / rect.height) * height)));
  };
  const windowTop = Math.max(0, Math.min(height, top));
  const windowBottom = Math.max(0, Math.min(height, bottom));

  return <aside className="editor-map" aria-label="Course map — drag to move the camera">
    <div className="editor-map-head"><span>COURSE MAP</span><MoveVertical size={11} /></div>
    <svg
      ref={svgRef}
      className="editor-map-svg"
      viewBox={`0 0 104 ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Full circuit, ${formatUnits(height)} units long`}
      onPointerDown={(event) => { dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); jumpFrom(event.clientY); }}
      onPointerMove={(event) => { if (dragging.current) jumpFrom(event.clientY); }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
    >
      <rect x={X0} width={XW} height={height} fill="#101a26" stroke="#3a4d61" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      {track.segments.map((segment, index) => <g key={`${segment.name}-${index}`}>
        <rect className="editor-map-sector" x={X0} y={segment.y} width={XW} height={Math.max(2, segment.h)} fill={index % 2 ? '#ffffff05' : 'transparent'} />
        <line x1={X0 - 4} x2={X0 - 1} y1={segment.y} y2={segment.y} stroke="#66809a" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </g>)}
      {track.ramps.filter((ramp) => meta(ramp).surface).map((ramp) => {
        const surface = meta(ramp).surface!;
        return <line
          key={ramp.id}
          className="editor-map-rail"
          x1={x(surface.start.x)}
          y1={surface.start.y}
          x2={x(surface.end.x)}
          y2={surface.end.y}
          stroke={meta(ramp).kind === 'ice' ? '#64bad7' : '#7b93a8'}
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />;
      })}
      <rect className="editor-map-window" x={X0} y={windowTop} width={XW} height={Math.max(2, windowBottom - windowTop)} fill="#d63e2e1f" stroke="#d63e2e" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <rect className="editor-map-finish" x={X0} y={Math.max(0, track.finishY - 6)} width={XW} height={12} fill="none" stroke="#f2f5fa" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
    </svg>
    <div className="editor-map-foot"><Flag size={10} /><span>FINISH</span><b>{formatUnits(height)} u</b></div>
    <p className="editor-map-hint">Drag to scroll · the red window is what the canvas shows</p>
  </aside>;
}
