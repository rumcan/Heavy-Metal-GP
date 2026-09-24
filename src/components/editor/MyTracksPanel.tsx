/**
 * MB-06. My tracks list — thumbnail, name, length, last edited, validation badge
 * + rename / duplicate / delete. Lives in the Workshop left column, below palette.
 *
 * Thumbnails are drawn by TrackThumbnail (static preview like CircuitPreview).
 * Validation badges are computed lazily via validateTrack (full headless) so the
 * list stays responsive — while pending we show static validity only.
 */
import { useMemo, useState } from 'react';
import { Copy, Trash2, Edit3, Check, X, ShieldCheck, ShieldAlert, Clock3, Ruler, Save, CopyPlus } from 'lucide-react';
import TrackThumbnail from './TrackThumbnail';
import ConfirmDialog from '../ConfirmDialog';
import { formatUnits } from './camera';
import type { SavedTrack } from '../../game/tracks';
import type { TrackDef } from '../../game/trackdef';
import { cachedValidation } from './validationCache';
import { CALENDAR, gpSeed } from '../../game/season';
import { officialTrack } from '../../game/official-tracks';
import { generateTrackDef } from '../../game/trackdef';

interface Props {
  tracks: SavedTrack[];
  activeId: string | null;
  currentDef: TrackDef;
  onLoad: (id: string) => void;
  onRename: (id: string, name: string) => string | null; // returns error or null
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onSaveCurrent: () => void;
  /** Always save a new copy, even when a saved track is open. */
  onSaveNew: () => void;
  onNewBlank?: () => void;
  onDevLoadOfficial?: (def: TrackDef) => void;
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

/** PASS / FAIL from the last Validate of this exact track; nothing is simulated here (see validationCache). */
function ValidationBadge({ def }: { def: TrackDef }) {
  const result = useMemo(() => cachedValidation(def), [def]);
  if (result === undefined) return <span className="my-track-badge is-pending" title="Open it and press Validate to check it"><Clock3 size={10} /> not checked</span>;
  return result
    ? <span className="my-track-badge is-pass"><ShieldCheck size={10} /> PASS</span>
    : <span className="my-track-badge is-fail"><ShieldAlert size={10} /> FAIL</span>;
}

export default function MyTracksPanel({ tracks, activeId, currentDef, onLoad, onRename, onDuplicate, onDelete, onSaveCurrent, onSaveNew, onDevLoadOfficial }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter((t) => t.def.name.toLowerCase().includes(q));
  }, [tracks, filter]);

  // In-game confirmations only: RUN.world's frame blocks the browser's confirm()/alert() (confirm() answered "no",
  // so Delete never deleted there).
  const [confirmDelete, setConfirmDelete] = useState<SavedTrack | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const startRename = (t: SavedTrack) => { setEditingId(t.id); setEditName(t.def.name); setRenameError(null); };
  const commitRename = () => {
    if (!editingId) return;
    const err = onRename(editingId, editName);
    if (!err) { setEditingId(null); setRenameError(null); }
    else setRenameError(err);
  };

  return (
    <div className="my-tracks-panel">
      <header className="my-tracks-head">
        <span className="eyebrow"><b>04</b> MY TRACKS</span>
        <span className="my-tracks-count">{tracks.length} saved</span>
      </header>

      <div className="my-tracks-actions">
        <button className="button-primary my-tracks-save" onClick={onSaveCurrent} title={activeId ? 'Save your changes to this track' : 'Save the current track to My tracks'}>
          <Save size={13} /> {activeId ? 'Save' : 'Save current'}
        </button>
        {activeId && (
          <button className="button-secondary my-tracks-save" onClick={onSaveNew} title="Save a separate copy; the open track stays as it was saved">
            <CopyPlus size={13} /> Save as new
          </button>
        )}
        <input className="my-tracks-filter" placeholder="Filter by name…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter tracks" />
      </div>

      {tracks.length === 0 ? (
        <p className="prop-empty">No saved tracks yet. Save the current track to keep it here.</p>
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
                <button className="icon-button" onClick={() => setConfirmDelete(t)} title="Delete" aria-label={`Delete ${t.def.name}`}><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="my-tracks-foot">
        <span className="my-tracks-hint">Your open track saves itself as you build. Tracks saved here stay after a reload.</span>
      </div>

      {/* Current draft preview — helps verify autosave is working */}
      <details className="my-tracks-draft">
        <summary>Open draft — {currentDef.name} · {formatUnits(currentDef.height)} u · {currentDef.pieces.length} pcs</summary>
        <div className="my-tracks-draft-body">
          <TrackThumbnail def={currentDef} />
          <p className="prop-empty">This draft autosaves every 10 s. Reload the page to see it restore. Save it to My tracks to keep it permanently.</p>
        </div>
      </details>

      {import.meta.env.DEV && onDevLoadOfficial && (
        <div style={{ marginTop: 20, padding: 10, background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--line)', borderRadius: 4 }}>
          <header className="eyebrow" style={{ marginBottom: 6, display: 'block' }}>DEV TOOLS: CHAMPIONSHIP CIRCUITS</header>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 10 }}>
            The calendar races these archives — nothing is generated at race time. Generate a starting point (or load the saved circuit), fix it in the editor, then Archive to make it official. The page reloads and every demo and heat runs the new file.
          </p>
          {CALENDAR.map((gp) => {
            const archived = officialTrack(gp.id);
            return (
              // Name on its own line, then the three buttons in an even grid, so Archive never runs off the panel.
              <div key={gp.id} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 5, marginBottom: 8 }}>
                <span style={{ gridColumn: '1 / -1', fontSize: 10, color: 'var(--text-muted)' }} title={gp.name}>{gp.short}</span>
                <button
                  className="button-secondary"
                  style={{ minWidth: 0, padding: '4px 6px', fontSize: 10 }}
                  title={`Generate a fresh seeded ${gp.name} circuit into the editor`}
                  onClick={() => {
                    onDevLoadOfficial(generateTrackDef(gpSeed(0, gp.id), gp.profile, gp.name));
                  }}
                >
                  Generate
                </button>
                <button
                  className="button-secondary"
                  style={{ minWidth: 0, padding: '4px 6px', fontSize: 10 }}
                  disabled={!archived}
                  title={archived ? `Load the archived circuit round ${gp.id + 1} currently races (${archived.pieces.length} pieces)` : 'No valid archive for this round'}
                  onClick={() => {
                    if (archived) onDevLoadOfficial(archived);
                  }}
                >
                  Load saved
                </button>
                <button
                  className="button-primary"
                  style={{ minWidth: 0, padding: '4px 6px', fontSize: 10 }}
                  title={`Write the current editor circuit to src/game/official-tracks/champ-${gp.id}.json`}
                  onClick={() => {
                    fetch(`/__dev/save-official-track?round=${gp.id}`, {
                      method: 'POST',
                      body: JSON.stringify(currentDef, null, 2),
                    }).then((res) => {
                      if (res.ok) alert(`Saved to src/game/official-tracks/champ-${gp.id}.json — the game races it from the next reload.`);
                      else alert('Failed to save official track');
                    });
                  }}
                >
                  Archive
                </button>
              </div>
            );
          })}
        </div>
      )}
      {renameError && <p className="prop-empty" role="alert" style={{ color: '#fca5a5' }}>{renameError}</p>}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete this track?"
          message={`“${confirmDelete.def.name}” will be removed from My tracks. This can't be undone.`}
          confirmLabel="Delete"
          onConfirm={() => { onDelete(confirmDelete.id); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
