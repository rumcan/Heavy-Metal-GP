/**
 * P2-22. The course map for a platformer course: the classic map turned on its side. A strip along the bottom of the
 * stage draws the whole course (each lane's floors in its own colour, the finish), and the red window is what the
 * canvas shows; press or drag it and the camera follows.
 */
import { useRef } from 'react';
import { Flag, MoveHorizontal } from 'lucide-react';
import type { Track } from '../../game/track';
import { formatUnits } from './camera';

interface Props {
  track: Track | null;
  /** The world window the canvas shows. */
  left: number;
  right: number;
  /** Move the camera's centre to a world x. */
  onJump: (worldX: number) => void;
}

const LANE_COLOURS = ['#4c6a86', '#9bb2c7', '#e4b86a'] as const;

export default function EditorMapSide({ track, left, right, onJump }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const plan = track?.platformer?.plan;
  if (!track || !plan) return <aside className="editor-map editor-map-side" aria-label="Course map"><div className="editor-map-head"><span>COURSE MAP</span></div><p className="editor-map-empty">No course yet.</p></aside>;

  const width = Math.max(1, plan.width);
  let top = Infinity, bottom = -Infinity;
  for (const f of plan.floors) { top = Math.min(top, f.y0, f.y1); bottom = Math.max(bottom, f.y0, f.y1); }
  top -= 120; bottom += 120;
  const span = Math.max(1, bottom - top);
  const jumpFrom = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width < 1) return;
    onJump(Math.max(0, Math.min(width, ((clientX - rect.left) / rect.width) * width)));
  };
  const winL = Math.max(0, Math.min(width, left)), winR = Math.max(0, Math.min(width, right));

  return <aside className="editor-map editor-map-side" aria-label="Course map: drag to move the camera">
    <div className="editor-map-head"><span>COURSE MAP</span><MoveHorizontal size={11} /></div>
    <svg
      ref={svgRef}
      className="editor-map-svg"
      viewBox={`0 0 ${width} ${span}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Whole course, ${formatUnits(width)} units long`}
      onPointerDown={(event) => { dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); jumpFrom(event.clientX); }}
      onPointerMove={(event) => { if (dragging.current) jumpFrom(event.clientX); }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
    >
      <rect width={width} height={span} fill="#101a26" stroke="#3a4d61" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      {plan.floors.map((f, i) => <line
        key={i}
        x1={f.x0} y1={f.y0 - top} x2={f.x1} y2={f.y1 - top}
        stroke={LANE_COLOURS[f.lane]} strokeWidth="1.5" vectorEffect="non-scaling-stroke"
      />)}
      <rect x={winL} y={0} width={Math.max(width / 200, winR - winL)} height={span} fill="#d63e2e1f" stroke="#d63e2e" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <line x1={plan.finishX} x2={plan.finishX} y1={0} y2={span} stroke="#f2f5fa" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
    </svg>
    <div className="editor-map-foot"><span>START</span><Flag size={10} style={{ marginLeft: 'auto' }} /><span>FINISH</span><b>{formatUnits(width)} u</b></div>
  </aside>;
}
