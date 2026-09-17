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
    </div>
  );
}
