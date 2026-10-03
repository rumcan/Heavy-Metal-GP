// P2-22: the platformer picker's two extra lists in Quick race: your saved courses (made in the Workshop) and the
// community's. Picking one sets the quick-race pick to `platformer:my-<key>`; the course is registered first so it resolves.
import { useEffect, useState } from 'react';
import { Check, Download, Loader2, ThumbsUp } from 'lucide-react';
import { PLATFORMER_PREFIX } from '../../game/platformer/course';
import { customCourseId, registerPlatformerDef } from '../../game/platformer/def';
import { loadSavedCourses, saveCourse } from '../../game/platformer/courses-store';
import type { SavedCourse } from '../../game/platformer/courses-store';
import { browseCommunity, decodeCommunityCourse, isLocalCommunity } from '../../game/community';
import type { CommunityTrack } from '../../game/community';

interface Props { customTrackId: string | null; onSelect: (id: string) => void }

const pickOf = (key: string) => PLATFORMER_PREFIX + customCourseId(key);

/** Your saved platformer courses. */
export function MyCourses({ customTrackId, onSelect }: Props) {
  const [courses] = useState<SavedCourse[]>(() => loadSavedCourses());
  if (!courses.length) return <p className="muted">Courses you build in the Workshop (New platformer course) appear here.</p>;
  return <div className="my-tracks-list" role="listbox" aria-label="My platformer courses">
    {courses.map((c) => <button key={c.id} role="option" aria-selected={customTrackId === pickOf(c.id)} className={`my-track-row ${customTrackId === pickOf(c.id) ? 'selected' : ''}`} onClick={() => onSelect(pickOf(c.id))}>
      <span className="my-track-meta">
        <strong>{c.def.name}</strong>
        <span className="muted">{Math.round(c.def.length / 1000)}k • {c.def.gates.length} gates • {c.def.style === 'flow' ? 'rolling slopes' : 'blocks'}</span>
      </span>
      <span className="my-track-check" aria-hidden>{customTrackId === pickOf(c.id) ? '●' : ''}</span>
    </button>)}
  </div>;
}

/** A key that is safe in a course id (letters, digits, dashes) for a community entry. */
const keyOf = (id: string) => `c${id.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'x'}`;

/** The community's platformer courses: race one, or keep it in your own list. */
export function CommunityCourses({ customTrackId, onSelect }: Props) {
  const [rows, setRows] = useState<CommunityTrack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [kept, setKept] = useState<string | null>(null);
  const [local, setLocal] = useState(false);
  useEffect(() => {
    let alive = true;
    void isLocalCommunity().then((l) => alive && setLocal(l));
    browseCommunity('top', undefined, 'course').then((page) => alive && setRows(page.tracks)).catch(() => alive && setError('Could not load community courses.'));
    return () => { alive = false; };
  }, []);

  const race = async (t: CommunityTrack) => {
    setBusy(t.id); setError(null);
    try {
      const def = await decodeCommunityCourse(t);
      registerPlatformerDef(keyOf(t.id), def);
      onSelect(pickOf(keyOf(t.id)));
    } catch (e) { setError(e instanceof Error ? e.message : 'That course could not be opened.'); } finally { setBusy(null); }
  };
  const keep = async (t: CommunityTrack) => {
    setBusy(t.id); setError(null);
    try {
      const r = saveCourse(await decodeCommunityCourse(t));
      if ('error' in r) setError(r.error); else { setKept(t.id); onSelect(pickOf(r.id)); }
    } catch (e) { setError(e instanceof Error ? e.message : 'That course could not be opened.'); } finally { setBusy(null); }
  };

  if (error && !rows) return <p className="community-error" role="alert">{error}</p>;
  if (!rows) return <p className="muted"><Loader2 size={14} className="spin" aria-hidden="true" /> Loading community courses…</p>;
  if (!rows.length) return <p className="muted">No community courses yet. Publish one from the course editor.{local ? ' (Local test mode: only courses published on this device show up.)' : ''}</p>;
  return <>
    {error && <p className="community-error" role="alert">{error}</p>}
    <div className="my-tracks-list" role="listbox" aria-label="Community platformer courses">
      {rows.map((t) => <div key={t.id} className={`my-track-row ${customTrackId === pickOf(keyOf(t.id)) ? 'selected' : ''}`}>
        <span className="my-track-meta">
          <strong>{t.name}</strong>
          <span className="muted">by {t.author} • <ThumbsUp size={11} aria-hidden="true" /> {t.upvotes}{t.tags.length ? ` • ${t.tags.join(', ')}` : ''}</span>
        </span>
        <button className="button-secondary" disabled={busy === t.id} onClick={() => void race(t)}>{customTrackId === pickOf(keyOf(t.id)) ? <><Check size={13} />Selected</> : 'Pick'}</button>
        <button className="icon-button" disabled={busy === t.id || kept === t.id} onClick={() => void keep(t)} aria-label={`Keep ${t.name} in my courses`} title="Keep in my courses"><Download size={14} /></button>
      </div>)}
    </div>
  </>;
}
