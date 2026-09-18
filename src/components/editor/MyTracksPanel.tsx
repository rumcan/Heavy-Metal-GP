/**
 * MB-06. My tracks list — thumbnail, name, length, last edited, validation badge
 * + rename / duplicate / delete. Lives in the Workshop left column, below palette.
 *
 * Thumbnails are drawn by TrackThumbnail (static preview like CircuitPreview).
 * Validation badges are computed lazily via validateTrack (full headless) so the
 * list stays responsive — while pending we show static validity only.
 */
import { useEffect, useMemo, useState } from 'react';
import { Copy, Trash2, Edit3, Check, X, ShieldCheck, ShieldAlert, Clock3, Ruler, Save } from 'lucide-react';
import TrackThumbnail from './TrackThumbnail';
import { formatUnits } from './camera';
import type { SavedTrack } from '../../game/tracks';
import type { TrackDef } from '../../game/trackdef';
import { validateTrack } from './validate';
import type { ValidationResult } from './validate';

interface Props {
  tracks: SavedTrack[];
  activeId: string | null;
  currentDef: TrackDef;
  onLoad: (id: string) => void;
  onRename: (id: string, name: string) => string | null; // returns error or null
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onSaveCurrent: () => void;
  onNewBlank?: () => void;
}

function timeAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

function ValidationBadge({ def }: { def: TrackDef }) {
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [pending, setPending] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setPending(true);
    // Yield to paint, then run heavy headless off the main tick
    const t = setTimeout(async () => {
      const r = await new Promise<ValidationResult>((resolve) => setTimeout(() => resolve(validateTrack(def)), 10));
      if (!cancelled) { setResult(r); setPending(false); }
    }, 20);
    return () => { cancelled = true; clearTimeout(t); };
  }, [def]);

  if (pending) return <span className="my-track-badge is-pending"><Clock3 size={10} /> checking</span>;
  if (!result) return null;
  return result.canShare
    ? <span className="my-track-badge is-pass"><ShieldCheck size={10} /> PASS</span>
    : <span className="my-track-badge is-fail"><ShieldAlert size={10} /> FAIL</span>;
}

export default function MyTracksPanel({ tracks, activeId, currentDef, onLoad, onRename, onDuplicate, onDelete, onSaveCurrent }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter((t) => t.def.name.toLowerCase().includes(q));
  }, [tracks, filter]);

  const startRename = (t: SavedTrack) => { setEditingId(t.id); setEditName(t.def.name); };
  const commitRename = () => {
    if (!editingId) return;
    const err = onRename(editingId, editName);
    if (!err) setEditingId(null);
    else alert(err);
  };

  return (
    <div className="my-tracks-panel">
      <header className="my-tracks-head">
        <span className="eyebrow"><b>03</b> MY TRACKS</span>
        <span className="my-tracks-count">{tracks.length} saved</span>
      </header>

      <div className="my-tracks-actions">
        <button className="button-primary my-tracks-save" onClick={onSaveCurrent} title="Save current circuit to My tracks (compressed, size-checked)">
          <Save size={13} /> Save current
        </button>
        <input className="my-tracks-filter" placeholder="Filter by name…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter tracks" />
      </div>

      {tracks.length === 0 ? (
        <p className="prop-empty">No saved tracks yet. Save the current circuit to keep it between reloads. Drafts autosave every 10 s and when you leave the Workshop.</p>
      ) : filtered.length === 0 ? (
        <p className="prop-empty">No tracks match “{filter}”.</p>
      ) : (
        <div className="my-tracks-list" role="list">
          {filtered.map((t) => (
            <div key={t.id} role="listitem" className={`my-track-row ${activeId === t.id ? 'is-active' : ''}`}>
              <TrackThumbnail def={t.def} onClick={() => onLoad(t.id)} />
              <div className="my-track-main">
                {editingId === t.id ? (
                  <div className="my-track-rename">
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={48} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingId(null); }} />
                    <button className="icon-button" onClick={commitRename} aria-label="Confirm rename"><Check size={12} /></button>
                    <button className="icon-button" onClick={() => setEditingId(null)} aria-label="Cancel rename"><X size={12} /></button>
                  </div>
                ) : (
                  <button className="my-track-name" onClick={() => onLoad(t.id)} title="Load into editor">{t.def.name}</button>
                )}
                <div className="my-track-meta">
                  <span className="my-track-stat"><Ruler size={10} />{formatUnits(t.def.height)} u</span>
                  <span className="my-track-stat"><Clock3 size={10} />{timeAgo(t.updatedAt)}</span>
                  <ValidationBadge def={t.def} />
                </div>
                <div className="my-track-length">{t.def.pieces.length} pieces · {t.def.theme}</div>
              </div>
              <div className="my-track-ops">
                <button className="icon-button" onClick={() => startRename(t)} title="Rename" aria-label={`Rename ${t.def.name}`}><Edit3 size={12} /></button>
                <button className="icon-button" onClick={() => onDuplicate(t.id)} title="Duplicate" aria-label={`Duplicate ${t.def.name}`}><Copy size={12} /></button>
                <button className="icon-button" onClick={() => { if (confirm(`Delete “${t.def.name}”?`)) onDelete(t.id); }} title="Delete" aria-label={`Delete ${t.def.name}`}><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="my-tracks-foot">
        <span className="my-tracks-hint">Your open track saves itself every 10 seconds and when you leave the Workshop. Tracks here stay after a reload.</span>
      </div>

      {/* Current draft preview — helps verify autosave is working */}
      <details className="my-tracks-draft">
        <summary>Open draft — {currentDef.name} · {formatUnits(currentDef.height)} u · {currentDef.pieces.length} pcs</summary>
        <div className="my-tracks-draft-body">
          <TrackThumbnail def={currentDef} />
          <p className="prop-empty">This draft autosaves every 10 s. Reload the page to see it restore. Save it to My tracks to keep it permanently.</p>
        </div>
      </details>
    </div>
  );
}
