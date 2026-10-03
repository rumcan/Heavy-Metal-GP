/**
 * Publish a Workshop track to Community tracks: confirm the name, pick up to three tags, publish.
 * Only reachable once the track passes Validate (the Workshop disables the button otherwise).
 */
import { useEffect, useState } from 'react';
import { Check, Tag, Users } from 'lucide-react';
import Dialog from '../Dialog';
import TrackMap from '../TrackMap';
import { COMMUNITY_TAGS, MAX_TAGS, PublishError, isLocalCommunity, publishTrack } from '../../game/community';
import type { TrackDef } from '../../game/trackdef';
import { isPlatformerDef } from '../../game/platformer/def';

interface Props { def: TrackDef; onClose: () => void; onViewCommunity?: () => void }

export default function PublishDialog({ def, onClose, onViewCommunity }: Props) {
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [local, setLocal] = useState(false);
  useEffect(() => { void isLocalCommunity().then(setLocal); }, []);
  // P2-22: a platformer course is published as a course, and its length runs left to right.
  const course = isPlatformerDef(def);
  const noun = course ? 'course' : 'track';

  const toggle = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : cur.length >= MAX_TAGS ? cur : [...cur, t]));

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      await publishTrack(def, tags);
      setDone(true);
    } catch (e) {
      setError(e instanceof PublishError ? e.message : 'Publishing failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return <Dialog titleId="publish-title" onClose={onClose} className="publish-dialog">
    <span className="eyebrow"><Users size={14} /> {course ? 'COMMUNITY COURSES' : 'COMMUNITY TRACKS'}</span>
    <h2 id="publish-title">{done ? 'Published!' : `Publish your ${noun}`}</h2>
    <div className="publish-body">
      <div className="publish-map community-map"><TrackMap def={def} width={96} /></div>
      <div className="publish-form">
        <p className="publish-name"><b>{def.name.trim() || `Untitled ${noun}`}</b><span>{def.pieces.length} {def.pieces.length === 1 ? 'piece' : 'pieces'} · {Math.round(course ? def.width ?? 0 : def.height).toLocaleString()} u long</span></p>
        {done ? (
          <p className="dialog-intro">Everyone can now find it under <b>Just added</b> in Community {course ? 'courses (Quick race → Platformer)' : 'tracks'}, upvote it and add it to their own {course ? 'courses' : 'tracks'}.{local ? ' (Local test mode: only on this device.)' : ''}</p>
        ) : (
          <>
            <p className="dialog-intro">Everyone on RUN.world will be able to see it, race it and upvote it, with your username on it. Rename it in the Track name field first if you like.{course ? ' It is published as a platformer course, so it is listed with the other courses.' : ''}{local ? ' Local test mode: it will only be saved on this device.' : ''}</p>
            <p className="publish-tags-label"><Tag size={13} /> Pick up to {MAX_TAGS} tags <span>{tags.length}/{MAX_TAGS}</span></p>
            <div className="community-tags publish-tags" role="group" aria-label="Tags">
              {COMMUNITY_TAGS.map((t) => <button key={t} type="button" className={tags.includes(t) ? 'selected' : ''} aria-pressed={tags.includes(t)} disabled={!tags.includes(t) && tags.length >= MAX_TAGS} onClick={() => toggle(t)}>{t}</button>)}
            </div>
          </>
        )}
        {error && <p className="community-error" role="alert">{error}</p>}
      </div>
    </div>
    <div className="pause-actions">
      {done ? (
        <>
          <button className="button-secondary" onClick={onClose}>Back to the Workshop</button>
          {onViewCommunity && <button className="button-primary" onClick={onViewCommunity}><Users size={15} />View Community tracks</button>}
        </>
      ) : (
        <>
          <button className="button-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="button-primary" onClick={() => void publish()} disabled={busy}>{busy ? 'Publishing…' : <><Check size={15} />Publish</>}</button>
        </>
      )}
    </div>
  </Dialog>;
}
