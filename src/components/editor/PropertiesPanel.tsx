/**
 * MB-03. Properties panel for the selected piece(s).
 *
 * Shows exact numbers for one selected piece: position, size, radius,
 * weight requirement, peg colour, etc.  Multi-selection shows a
 * count and bulk actions; empty selection shows a hint.
 *
 * All writes go through `onChange(pieceIndex, updater)` so the editor
 * can push one undo entry for the whole transaction.
 */
import type { Piece } from '../../game/trackdef';
import { W } from '../../game/track';

interface Props {
  selected: number[];
  pieces: Piece[];
  onChange: (index: number, next: Piece) => void;
  onChangeMany?: (indices: number[], updater: (p: Piece) => Piece) => void;
}

function NumField(props: { label: string; value: number; min?: number; max?: number; step?: number; onValue: (v: number) => void }) {
  const { label, value, min, max, step = 1, onValue } = props;
  return (
    <label className="prop-field">
      <span>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onValue(v);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </label>
  );
}

function clampNum(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export default function PropertiesPanel({ selected, pieces, onChange }: Props) {
  if (selected.length === 0) {
    return <p className="prop-empty">Select a piece to edit its properties. Shift+click or drag to select multiple.</p>;
  }
  if (selected.length > 1) {
    return (
      <div className="prop-group">
        <p className="prop-empty">{selected.length} pieces selected — drag to move, Delete to remove, Ctrl+D to duplicate, Mirror to flip.</p>
      </div>
    );
  }
  const index = selected[0];
  const piece = pieces[index];
  if (!piece) return <p className="prop-empty">Selection out of range.</p>;

  const update = (patch: Partial<Piece> | ((p: Piece) => Piece)) => {
    if (typeof patch === 'function') onChange(index, (patch as (p: Piece) => Piece)(piece));
    else onChange(index, { ...piece, ...patch } as Piece);
  };

  return (
    <div className="prop-panel">
      <header className="prop-head">
        <strong>{piece.t.toUpperCase()}</strong>
        <span>#{index}</span>
      </header>

      {(piece.t === 'ramp' || piece.t === 'ice') && (
        <>
          <NumField label="Ax" value={piece.a[0]} min={0} max={W} onValue={(v) => update({ a: [clampNum(v, 0, W), piece.a[1]] } as unknown as Piece)} />
          <NumField label="Ay" value={piece.a[1]} onValue={(v) => update({ a: [piece.a[0], v] } as unknown as Piece)} />
          <NumField label="Bx" value={piece.b[0]} min={0} max={W} onValue={(v) => update({ b: [clampNum(v, 0, W), piece.b[1]] } as unknown as Piece)} />
          <NumField label="By" value={piece.b[1]} onValue={(v) => update({ b: [piece.b[0], v] } as unknown as Piece)} />
        </>
      )}

      {piece.t === 'curve' && (
        <>
          <NumField label="Ax" value={piece.a[0]} min={0} max={W} onValue={(v) => update({ a: [clampNum(v, 0, W), piece.a[1]] } as unknown as Piece)} />
          <NumField label="Ay" value={piece.a[1]} onValue={(v) => update({ a: [piece.a[0], v] } as unknown as Piece)} />
          <NumField label="Cx" value={piece.c[0]} min={0} max={W} onValue={(v) => update({ c: [clampNum(v, 0, W), piece.c[1]] } as unknown as Piece)} />
          <NumField label="Cy" value={piece.c[1]} onValue={(v) => update({ c: [piece.c[0], v] } as unknown as Piece)} />
          <NumField label="Bx" value={piece.b[0]} min={0} max={W} onValue={(v) => update({ b: [clampNum(v, 0, W), piece.b[1]] } as unknown as Piece)} />
          <NumField label="By" value={piece.b[1]} onValue={(v) => update({ b: [piece.b[0], v] } as unknown as Piece)} />
          <NumField label="Segments" value={piece.n ?? 12} min={2} max={64} step={1} onValue={(v) => update({ n: Math.round(clampNum(v, 2, 64)) } as unknown as Piece)} />
        </>
      )}

      {piece.t === 'loop' && (
        <>
          <NumField label="X" value={piece.x} min={0} max={W} onValue={(v) => update({ x: clampNum(v, 0, W) } as unknown as Piece)} />
          <NumField label="Bottom" value={piece.bottom} onValue={(v) => update({ bottom: v } as unknown as Piece)} />
          <NumField label="Radius" value={piece.r} min={40} max={300} onValue={(v) => update({ r: clampNum(v, 40, 300) } as unknown as Piece)} />
        </>
      )}

      {piece.t === 'hoop' && (
        <>
          <NumField label="X" value={piece.x} min={0} max={W} onValue={(v) => update({ x: clampNum(v, 0, W) } as unknown as Piece)} />
          <NumField label="Y" value={piece.y} onValue={(v) => update({ y: v } as unknown as Piece)} />
          <NumField label="Dir X" value={piece.dir[0]} step={0.1} onValue={(v) => update({ dir: [v, piece.dir[1]] } as unknown as Piece)} />
          <NumField label="Dir Y" value={piece.dir[1]} step={0.1} onValue={(v) => update({ dir: [piece.dir[0], v] } as unknown as Piece)} />
        </>
      )}

      {piece.t === 'wrecker' && (
        <>
          <NumField label="Pivot X" value={piece.pivot[0]} min={0} max={W} onValue={(v) => update({ pivot: [clampNum(v, 0, W), piece.pivot[1]] } as unknown as Piece)} />
          <NumField label="Pivot Y" value={piece.pivot[1]} onValue={(v) => update({ pivot: [piece.pivot[0], v] } as unknown as Piece)} />
          <NumField label="Chain" value={piece.chain} min={8} max={2000} onValue={(v) => update({ chain: clampNum(v, 8, 2000) } as unknown as Piece)} />
          <NumField label="Amplitude" value={piece.amp} min={0.05} max={1.55} step={0.05} onValue={(v) => update({ amp: clampNum(v, 0.05, 1.55) } as unknown as Piece)} />
          <NumField label="Speed" value={piece.speed} min={0} max={0.2} step={0.001} onValue={(v) => update({ speed: clampNum(v, 0, 0.2) } as unknown as Piece)} />
        </>
      )}

      {(piece.t === 'pad') && (
        <>
          <NumField label="X" value={piece.x} min={0} max={W} onValue={(v) => update({ x: clampNum(v, 0, W) } as unknown as Piece)} />
          <NumField label="Y" value={piece.y} onValue={(v) => update({ y: v } as unknown as Piece)} />
          <NumField label="Width" value={piece.w} min={8} max={W} onValue={(v) => update({ w: clampNum(v, 8, W) } as unknown as Piece)} />
          <label className="prop-field">
            <span>Dir</span>
            <select value={piece.dir} onChange={(e) => update({ dir: Number(e.target.value) as -1 | 1 } as unknown as Piece)} onKeyDown={(e) => e.stopPropagation()}>
              <option value={1}>Right (+1)</option>
              <option value={-1}>Left (−1)</option>
            </select>
          </label>
        </>
      )}

      {piece.t === 'boost' && (
        <>
          <NumField label="X" value={piece.x} min={0} max={W} onValue={(v) => update({ x: clampNum(v, 0, W) } as unknown as Piece)} />
          <NumField label="Y" value={piece.y} onValue={(v) => update({ y: v } as unknown as Piece)} />
          <NumField label="Length" value={piece.len} min={8} max={4000} onValue={(v) => update({ len: clampNum(v, 8, 4000) } as unknown as Piece)} />
          <NumField label="Thickness" value={piece.thick} min={4} max={400} onValue={(v) => update({ thick: clampNum(v, 4, 400) } as unknown as Piece)} />
          <NumField label="Dir X" value={piece.dir[0]} step={0.1} onValue={(v) => update({ dir: [v, piece.dir[1]] } as unknown as Piece)} />
          <NumField label="Dir Y" value={piece.dir[1]} step={0.1} onValue={(v) => update({ dir: [piece.dir[0], v] } as unknown as Piece)} />
        </>
      )}

      {piece.t === 'spinner' && (
        <>
          <NumField label="X" value={piece.x} min={0} max={W} onValue={(v) => update({ x: clampNum(v, 0, W) } as unknown as Piece)} />
          <NumField label="Y" value={piece.y} onValue={(v) => update({ y: v } as unknown as Piece)} />
          <NumField label="Length" value={piece.len} min={20} max={W} onValue={(v) => update({ len: clampNum(v, 20, W) } as unknown as Piece)} />
          <NumField label="Speed" value={piece.speed} min={-0.5} max={0.5} step={0.01} onValue={(v) => update({ speed: clampNum(v, -0.5, 0.5) } as unknown as Piece)} />
        </>
      )}

      {piece.t === 'breakable' && (
        <>
          <NumField label="X" value={piece.x} min={0} max={W} onValue={(v) => update({ x: clampNum(v, 0, W) } as unknown as Piece)} />
          <NumField label="Y" value={piece.y} onValue={(v) => update({ y: v } as unknown as Piece)} />
          <NumField label="W" value={piece.w} min={8} max={W} onValue={(v) => update({ w: clampNum(v, 8, W) } as unknown as Piece)} />
          <NumField label="H" value={piece.h} min={8} max={4000} onValue={(v) => update({ h: clampNum(v, 8, 4000) } as unknown as Piece)} />
          <NumField label="Weight req." value={piece.req} min={1} max={10} step={1} onValue={(v) => update({ req: Math.round(clampNum(v, 1, 10)) } as unknown as Piece)} />
        </>
      )}

      {(piece.t === 'peg') && (
        <>
          <NumField label="X" value={piece.x} min={0} max={W} onValue={(v) => update({ x: clampNum(v, 0, W) } as unknown as Piece)} />
          <NumField label="Y" value={piece.y} onValue={(v) => update({ y: v } as unknown as Piece)} />
          <NumField label="Radius" value={piece.r} min={2} max={100} onValue={(v) => update({ r: clampNum(v, 2, 100) } as unknown as Piece)} />
        </>
      )}

      {piece.t === 'ppeg' && (
        <>
          <NumField label="X" value={piece.x} min={0} max={W} onValue={(v) => update({ x: clampNum(v, 0, W) } as unknown as Piece)} />
          <NumField label="Y" value={piece.y} onValue={(v) => update({ y: v } as unknown as Piece)} />
          <NumField label="Radius" value={piece.r} min={2} max={100} onValue={(v) => update({ r: clampNum(v, 2, 100) } as unknown as Piece)} />
          <label className="prop-field">
            <span>Colour</span>
            <select value={piece.color} onChange={(e) => update({ color: e.target.value as 'blue' | 'orange' | 'green' } as unknown as Piece)} onKeyDown={(e) => e.stopPropagation()}>
              <option value="blue">Blue</option>
              <option value="orange">Orange (+score & kick)</option>
              <option value="green">Green (item drop)</option>
            </select>
          </label>
          {piece.color === 'green' && (
            <label className="prop-field">
              <span>Item</span>
              <select
                value={piece.item ?? ''}
                onChange={(e) => {
                  const v = e.target.value || undefined;
                  update({ item: v as never } as unknown as Piece);
                }}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <option value="">Random</option>
                <option value="rocket">rocket</option>
                <option value="jump">jump</option>
                <option value="oil">oil</option>
                <option value="shock">shock</option>
                <option value="anvil">anvil</option>
                <option value="aero">aero</option>
                <option value="freeze">freeze</option>
                <option value="ghost">ghost</option>
              </select>
            </label>
          )}
        </>
      )}

      {(piece.t === 'itembox') && (
        <>
          <NumField label="X" value={piece.x} min={0} max={W} onValue={(v) => update({ x: clampNum(v, 0, W) } as unknown as Piece)} />
          <NumField label="Y" value={piece.y} onValue={(v) => update({ y: v } as unknown as Piece)} />
        </>
      )}

      {piece.t === 'bucket' && (
        <>
          <NumField label="Y" value={piece.y} onValue={(v) => update({ y: v } as unknown as Piece)} />
          <NumField label="Phase" value={piece.phase ?? 0} step={0.1} onValue={(v) => update({ phase: v } as unknown as Piece)} />
        </>
      )}

      {(piece.t === 'wall' || piece.t === 'block') && (
        <>
          <NumField label="X" value={piece.x} min={0} max={W} onValue={(v) => update({ x: clampNum(v, 0, W) } as unknown as Piece)} />
          <NumField label="Y" value={piece.y} onValue={(v) => update({ y: v } as unknown as Piece)} />
          <NumField label="W" value={piece.w} min={2} max={W} onValue={(v) => update({ w: clampNum(v, 2, W) } as unknown as Piece)} />
          <NumField label="H" value={piece.h} min={2} max={4000} onValue={(v) => update({ h: clampNum(v, 2, 4000) } as unknown as Piece)} />
        </>
      )}

      {(piece.t === 'barricade' || piece.t === 'crumble') && (
        <>
          <NumField label="X" value={piece.x} min={0} max={W} onValue={(v) => update({ x: clampNum(v, 0, W) } as unknown as Piece)} />
          <NumField label="Y" value={piece.y} onValue={(v) => update({ y: v } as unknown as Piece)} />
          <NumField label="W" value={piece.w} min={8} max={W} onValue={(v) => update({ w: clampNum(v, 8, W) } as unknown as Piece)} />
          <NumField label="H" value={piece.h} min={8} max={2000} onValue={(v) => update({ h: clampNum(v, 8, 2000) } as unknown as Piece)} />
          <NumField label="Toughness" value={piece.tough} min={1} max={10} step={1} onValue={(v) => update({ tough: Math.round(clampNum(v, 1, 10)) } as unknown as Piece)} />
        </>
      )}

      {piece.t === 'tunnel' && (
        <>
          <NumField label="In X" value={piece.x} min={0} max={W} onValue={(v) => update({ x: clampNum(v, 0, W) } as unknown as Piece)} />
          <NumField label="In Y" value={piece.y} onValue={(v) => update({ y: v } as unknown as Piece)} />
          <NumField label="Out X" value={piece.exit[0]} min={0} max={W} onValue={(v) => update({ exit: [clampNum(v, 0, W), piece.exit[1]] } as unknown as Piece)} />
          <NumField label="Out Y" value={piece.exit[1]} onValue={(v) => update({ exit: [piece.exit[0], v] } as unknown as Piece)} />
          <NumField label="Ride (ms)" value={piece.ms} min={100} max={20000} step={50} onValue={(v) => update({ ms: Math.round(clampNum(v, 100, 20000)) } as unknown as Piece)} />
          <NumField label="Exit speed" value={piece.speed} min={0} max={30} step={0.5} onValue={(v) => update({ speed: clampNum(v, 0, 30) } as unknown as Piece)} />
          <label className="prop-field">
            <span>Two-way</span>
            <select value={piece.two ? 'yes' : 'no'} onChange={(e) => update({ two: e.target.value === 'yes' ? true : undefined } as unknown as Piece)} onKeyDown={(e) => e.stopPropagation()}>
              <option value="no">No — entrance only</option>
              <option value="yes">Yes — exit accepts marbles too</option>
            </select>
          </label>
        </>
      )}

      {piece.t === 'trapdoor' && (
        <>
          <NumField label="X" value={piece.x} min={0} max={W} onValue={(v) => update({ x: clampNum(v, 0, W) } as unknown as Piece)} />
          <NumField label="Y" value={piece.y} onValue={(v) => update({ y: v } as unknown as Piece)} />
          <NumField label="W" value={piece.w} min={40} max={W} onValue={(v) => update({ w: clampNum(v, 40, W) } as unknown as Piece)} />
          <label className="prop-field">
            <span>Hinge</span>
            <select value={piece.hinge} onChange={(e) => update({ hinge: Number(e.target.value) as -1 | 1 } as unknown as Piece)} onKeyDown={(e) => e.stopPropagation()}>
              <option value={-1}>Left</option>
              <option value={1}>Right</option>
            </select>
          </label>
          <label className="prop-field">
            <span>Mode</span>
            <select value={piece.mode} onChange={(e) => update({ mode: e.target.value as 'timer' | 'weight' } as unknown as Piece)} onKeyDown={(e) => e.stopPropagation()}>
              <option value="timer">Clock (timer)</option>
              <option value="weight">Scale (weight)</option>
            </select>
          </label>
          {piece.mode === 'timer' ? (
            <>
              <NumField label="Open (ms)" value={piece.open} min={200} max={20000} step={100} onValue={(v) => update({ open: Math.round(clampNum(v, 200, 20000)) } as unknown as Piece)} />
              <NumField label="Closed (ms)" value={piece.closed} min={200} max={20000} step={100} onValue={(v) => update({ closed: Math.round(clampNum(v, 200, 20000)) } as unknown as Piece)} />
              <NumField label="Phase (ms)" value={piece.phase} step={100} onValue={(v) => update({ phase: v } as unknown as Piece)} />
            </>
          ) : (
            <>
              <NumField label="Needs (kg)" value={piece.kg} min={0.1} max={50} step={0.1} onValue={(v) => update({ kg: clampNum(v, 0.1, 50) } as unknown as Piece)} />
              <NumField label="Hold (ms)" value={piece.hold} min={0} max={5000} step={50} onValue={(v) => update({ hold: Math.round(clampNum(v, 0, 5000)) } as unknown as Piece)} />
            </>
          )}
        </>
      )}

      {piece.t === 'switch' && (
        <>
          <NumField label="X" value={piece.x} min={0} max={W} onValue={(v) => update({ x: clampNum(v, 0, W) } as unknown as Piece)} />
          <NumField label="Y" value={piece.y} onValue={(v) => update({ y: v } as unknown as Piece)} />
          <NumField label="Blade len" value={piece.len} min={40} max={400} step={5} onValue={(v) => update({ len: clampNum(v, 40, 400) } as unknown as Piece)} />
          <NumField label="Lean (rad)" value={piece.angle} min={0.1} max={1.35} step={0.05} onValue={(v) => update({ angle: clampNum(v, 0.1, 1.35) } as unknown as Piece)} />
          <label className="prop-field">
            <span>Starts to</span>
            <select value={piece.side} onChange={(e) => update({ side: Number(e.target.value) as 0 | 1 } as unknown as Piece)} onKeyDown={(e) => e.stopPropagation()}>
              <option value={0}>Left</option>
              <option value={1}>Right</option>
            </select>
          </label>
        </>
      )}

      {piece.t === 'blade' && (
        <>
          <NumField label="Pivot X" value={piece.pivot[0]} min={0} max={W} onValue={(v) => update({ pivot: [clampNum(v, 0, W), piece.pivot[1]] } as unknown as Piece)} />
          <NumField label="Pivot Y" value={piece.pivot[1]} onValue={(v) => update({ pivot: [piece.pivot[0], v] } as unknown as Piece)} />
          <NumField label="Arm length" value={piece.len} min={60} max={600} step={5} onValue={(v) => update({ len: clampNum(v, 60, 600) } as unknown as Piece)} />
          <NumField label="Amplitude (rad)" value={piece.amp} min={0.1} max={1.5} step={0.05} onValue={(v) => update({ amp: clampNum(v, 0.1, 1.5) } as unknown as Piece)} />
          <NumField label="Period (ms)" value={piece.period} min={800} max={20000} step={100} onValue={(v) => update({ period: Math.round(clampNum(v, 800, 20000)) } as unknown as Piece)} />
          <NumField label="Phase (ms)" value={piece.phase} step={100} onValue={(v) => update({ phase: v } as unknown as Piece)} />
          <NumField label="Blade half-thick" value={piece.thin} min={4} max={24} step={1} onValue={(v) => update({ thin: Math.round(clampNum(v, 4, 24)) } as unknown as Piece)} />
        </>
      )}

      {piece.t === 'saw' && (
        <>
          <NumField label="Slot A x" value={piece.a[0]} min={0} max={W} onValue={(v) => update({ a: [clampNum(v, 0, W), piece.a[1]] } as unknown as Piece)} />
          <NumField label="Slot A y" value={piece.a[1]} onValue={(v) => update({ a: [piece.a[0], v] } as unknown as Piece)} />
          <NumField label="Slot B x" value={piece.b[0]} min={0} max={W} onValue={(v) => update({ b: [clampNum(v, 0, W), piece.b[1]] } as unknown as Piece)} />
          <NumField label="Slot B y" value={piece.b[1]} onValue={(v) => update({ b: [piece.b[0], v] } as unknown as Piece)} />
          <NumField label="Radius" value={piece.r} min={14} max={60} step={1} onValue={(v) => update({ r: Math.round(clampNum(v, 14, 60)) } as unknown as Piece)} />
          <NumField label="Spin (rad/ms)" value={piece.spin} min={0.05} max={3} step={0.05} onValue={(v) => update({ spin: clampNum(v, 0.05, 3) } as unknown as Piece)} />
          <NumField label="Period (ms)" value={piece.period} min={600} max={60000} step={100} onValue={(v) => update({ period: Math.round(clampNum(v, 600, 60000)) } as unknown as Piece)} />
          <NumField label="Phase (ms)" value={piece.phase} step={100} onValue={(v) => update({ phase: v } as unknown as Piece)} />
        </>
      )}

      {piece.t === 'crusher' && (
        <>
          <NumField label="X" value={piece.x} min={0} max={W} onValue={(v) => update({ x: clampNum(v, 0, W) } as unknown as Piece)} />
          <NumField label="Top Y" value={piece.y} onValue={(v) => update({ y: v } as unknown as Piece)} />
          <NumField label="Plate W" value={piece.w} min={40} max={400} step={5} onValue={(v) => update({ w: clampNum(v, 40, 400) } as unknown as Piece)} />
          <NumField label="Travel" value={piece.travel} min={30} max={600} step={5} onValue={(v) => update({ travel: clampNum(v, 30, 600) } as unknown as Piece)} />
          <NumField label="Period (ms)" value={piece.period} min={1400} max={30000} step={100} onValue={(v) => update({ period: Math.round(clampNum(v, 1400, 30000)) } as unknown as Piece)} />
          <NumField label="At floor (ms)" value={piece.floor} min={100} max={5000} step={50} onValue={(v) => update({ floor: Math.round(clampNum(v, 100, 5000)) } as unknown as Piece)} />
          <NumField label="Phase (ms)" value={piece.phase} step={100} onValue={(v) => update({ phase: v } as unknown as Piece)} />
        </>
      )}

      {piece.t === 'boulder' && (
        <>
          <NumField label="Radius" value={piece.r} min={12} max={60} step={1} onValue={(v) => update({ r: Math.round(clampNum(v, 12, 60)) } as unknown as Piece)} />
          <NumField label="Interval (ms)" value={piece.interval} min={1800} max={30000} step={100} onValue={(v) => update({ interval: Math.round(clampNum(v, 1800, 30000)) } as unknown as Piece)} />
          <NumField label="Rest at top (ms)" value={piece.rest} min={0} max={10000} step={100} onValue={(v) => update({ rest: Math.round(clampNum(v, 0, 10000)) } as unknown as Piece)} />
          <NumField label="Phase (ms)" value={piece.phase} step={100} onValue={(v) => update({ phase: v } as unknown as Piece)} />
        </>
      )}

      {piece.t === 'mace' && (
        <>
          <NumField label="Pivot X" value={piece.x} min={0} max={W} onValue={(v) => update({ x: clampNum(v, 0, W) } as unknown as Piece)} />
          <NumField label="Pivot Y" value={piece.y} onValue={(v) => update({ y: v } as unknown as Piece)} />
          <NumField label="Arm length" value={piece.arm} min={60} max={400} step={5} onValue={(v) => update({ arm: clampNum(v, 60, 400) } as unknown as Piece)} />
          <NumField label="Sweep arc (rad)" value={piece.arc} min={0.4} max={2.6} step={0.05} onValue={(v) => update({ arc: clampNum(v, 0.4, 2.6) } as unknown as Piece)} />
          <NumField label="Sweep (ms)" value={piece.sweep} min={300} max={6000} step={50} onValue={(v) => update({ sweep: Math.round(clampNum(v, 300, 6000)) } as unknown as Piece)} />
          <NumField label="Pause (ms)" value={piece.rest} min={0} max={6000} step={50} onValue={(v) => update({ rest: Math.round(clampNum(v, 0, 6000)) } as unknown as Piece)} />
          <NumField label="Phase (ms)" value={piece.phase} step={100} onValue={(v) => update({ phase: v } as unknown as Piece)} />
          <NumField label="Ball r" value={piece.r} min={12} max={48} step={1} onValue={(v) => update({ r: Math.round(clampNum(v, 12, 48)) } as unknown as Piece)} />
        </>
      )}

      {piece.t === 'wheel' && (
        <>
          <NumField label="X" value={piece.x} min={0} max={W} onValue={(v) => update({ x: clampNum(v, 0, W) } as unknown as Piece)} />
          <NumField label="Y" value={piece.y} onValue={(v) => update({ y: v } as unknown as Piece)} />
          <NumField label="Radius" value={piece.r} min={60} max={200} step={5} onValue={(v) => update({ r: Math.round(clampNum(v, 60, 200)) } as unknown as Piece)} />
          <NumField label="Buckets" value={piece.buckets} min={4} max={10} step={1} onValue={(v) => update({ buckets: Math.round(clampNum(v, 4, 10)) } as unknown as Piece)} />
          <NumField label="RPM" value={piece.rpm} min={0.5} max={10} step={0.5} onValue={(v) => update({ rpm: clampNum(v, 0.5, 10) } as unknown as Piece)} />
          <NumField label="Direction" value={piece.dir} min={0} max={1} step={1} onValue={(v) => update({ dir: (v >= 1 ? 1 : 0) as 0 | 1 } as unknown as Piece)} />
          <NumField label="Tip-out (deg)" value={piece.release} min={20} max={340} step={5} onValue={(v) => update({ release: Math.round(clampNum(v, 20, 340)) } as unknown as Piece)} />
          <NumField label="Phase (ms)" value={piece.phase} step={100} onValue={(v) => update({ phase: v } as unknown as Piece)} />
        </>
      )}

      {piece.t === 'screw' && (
        <>
          <NumField label="Ax" value={piece.a[0]} min={0} max={W} onValue={(v) => update({ a: [clampNum(v, 0, W), piece.a[1]] } as unknown as Piece)} />
          <NumField label="Ay" value={piece.a[1]} onValue={(v) => update({ a: [piece.a[0], v] } as unknown as Piece)} />
          <NumField label="Bx" value={piece.b[0]} min={0} max={W} onValue={(v) => update({ b: [clampNum(v, 0, W), piece.b[1]] } as unknown as Piece)} />
          <NumField label="By" value={piece.b[1]} onValue={(v) => update({ b: [piece.b[0], v] } as unknown as Piece)} />
          <NumField label="Transit (ms)" value={piece.ms} min={1200} max={12000} step={100} onValue={(v) => update({ ms: Math.round(clampNum(v, 1200, 12000)) } as unknown as Piece)} />
          <NumField label="Capacity" value={piece.cap} min={1} max={4} step={1} onValue={(v) => update({ cap: Math.round(clampNum(v, 1, 4)) } as unknown as Piece)} />
        </>
      )}

      {piece.t === 'conveyor' && (
        <>
          <NumField label="Ax" value={piece.a[0]} min={0} max={W} onValue={(v) => update({ a: [clampNum(v, 0, W), piece.a[1]] } as unknown as Piece)} />
          <NumField label="Ay" value={piece.a[1]} onValue={(v) => update({ a: [piece.a[0], v] } as unknown as Piece)} />
          <NumField label="Bx" value={piece.b[0]} min={0} max={W} onValue={(v) => update({ b: [clampNum(v, 0, W), piece.b[1]] } as unknown as Piece)} />
          <NumField label="By" value={piece.b[1]} onValue={(v) => update({ b: [piece.b[0], v] } as unknown as Piece)} />
          <NumField label="Belt speed" value={piece.v} min={0.02} max={0.45} step={0.01} onValue={(v) => update({ v: clampNum(v, 0.02, 0.45) } as unknown as Piece)} />
          <NumField label="Flip every (ms, 0 = never)" value={piece.flipMs} min={0} max={30000} step={500} onValue={(v) => update({ flipMs: Math.round(clampNum(v, 0, 30000)) } as unknown as Piece)} />
          <NumField label="Direction" value={piece.dir} min={0} max={1} step={1} onValue={(v) => update({ dir: (v >= 1 ? 1 : 0) as 0 | 1 } as unknown as Piece)} />
        </>
      )}

      {piece.t === 'seesaw' && (
        <>
          <NumField label="X" value={piece.x} min={0} max={W} onValue={(v) => update({ x: clampNum(v, 0, W) } as unknown as Piece)} />
          <NumField label="Y" value={piece.y} onValue={(v) => update({ y: v } as unknown as Piece)} />
          <NumField label="Plank length" value={piece.len} min={140} max={420} step={10} onValue={(v) => update({ len: clampNum(v, 140, 420) } as unknown as Piece)} />
          <NumField label="Limit (deg)" value={piece.lim} min={6} max={28} step={1} onValue={(v) => update({ lim: clampNum(v, 6, 28) } as unknown as Piece)} />
          <NumField label="Damping" value={piece.damp} min={0.6} max={0.995} step={0.005} onValue={(v) => update({ damp: clampNum(v, 0.6, 0.995) } as unknown as Piece)} />
        </>
      )}

      {piece.t === 'bridge' && (
        <>
          <NumField label="Ax" value={piece.a[0]} min={0} max={W} onValue={(v) => update({ a: [clampNum(v, 0, W), piece.a[1]] } as unknown as Piece)} />
          <NumField label="Ay" value={piece.a[1]} onValue={(v) => update({ a: [piece.a[0], v] } as unknown as Piece)} />
          <NumField label="Bx" value={piece.b[0]} min={0} max={W} onValue={(v) => update({ b: [clampNum(v, 0, W), piece.b[1]] } as unknown as Piece)} />
          <NumField label="By" value={piece.b[1]} onValue={(v) => update({ b: [piece.b[0], v] } as unknown as Piece)} />
          <NumField label="Planks" value={piece.planks} min={6} max={12} step={1} onValue={(v) => update({ planks: Math.round(clampNum(v, 6, 12)) } as unknown as Piece)} />
          <NumField label="Slack" value={piece.slack} min={8} max={90} step={2} onValue={(v) => update({ slack: clampNum(v, 8, 90) } as unknown as Piece)} />
        </>
      )}
    </div>
  );
}
