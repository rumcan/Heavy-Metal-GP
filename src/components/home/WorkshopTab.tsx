import { useMemo, useState } from 'react';
import { FilePenLine, Hammer, Share2, Trash2, Users } from 'lucide-react';
import '../../editor.css';
import bannerUrl from '../../assets/editor/workshop-banner.webp';
import { deleteTrack, loadDraftSync, loadTracksSync, saveDraft } from '../../game/tracks';
import type { SavedTrack } from '../../game/tracks';
import type { TrackDef } from '../../game/trackdef';
import { removeItem, setItem } from '../../game/storage';
import ConfirmDialog from '../ConfirmDialog';
import NewTrackDialog from '../editor/NewTrackDialog';
import TrackThumbnail from '../editor/TrackThumbnail';
import { draftNeedsSaving } from './trackIdentity';
import { isPlatformerDef } from '../../game/platformer/def';
import { splitEntries } from '../../game/platformer/lists';

/** The id of the saved track the editor has open: the key `TrackEditor.tsx` remembers it under. */
const ACTIVE_TRACK_KEY = 'heavy-metal-gp:workshop-active-track';

interface Props {
  /** Open the full-screen Workshop. It opens on whatever the open draft holds. */
  onOpenEditor: () => void;
  /** The community's tracks live in the Quick race picker now: take the player there. */
  onBrowseCommunity: () => void;
  /** The footer's New track button opens the dialog: the screen owns that one primary button, so it owns the flag. */
  newTrackOpen: boolean;
  onNewTrackClose: () => void;
}

type Pending =
  | { kind: 'open'; track: SavedTrack }
  | { kind: 'new'; def: TrackDef }
  | { kind: 'delete'; track: SavedTrack };

/** P2-22: My tracks holds circuits and platformer courses; this chooses which of the two the list shows. */
type KindFilter = 'all' | 'track' | 'platformer';

const when = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/**
 * The Workshop's landing page: what you have built, a way to start something new, and a way back into what you were
 * doing. Opening anything goes to the full-screen editor — which loads its open draft on mount, so this page hands
 * it a track by writing the draft first. The editor itself is unchanged.
 */
export default function WorkshopTab({ onOpenEditor, onBrowseCommunity, newTrackOpen, onNewTrackClose }: Props) {
  const [version, setVersion] = useState(0);
  /** P2-22: circuits and platformer courses are built in the same Workshop, so the list can show either. */
  const [kind, setKind] = useState<KindFilter>('all');
  // Parsing saved tracks checks every one of them: once per change, not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tracks = useMemo(() => loadTracksSync(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const draft = useMemo(() => loadDraftSync(), [version]);
  const [pending, setPending] = useState<Pending | null>(null);
  const { circuits, courses } = useMemo(() => splitEntries(tracks), [tracks]);
  const shown = kind === 'track' ? circuits : kind === 'platformer' ? courses : tracks;

  /** Write the draft the editor will open on, and the saved track it belongs to, then go. */
  const launch = (def: TrackDef, savedId: string | null) => {
    saveDraft(def);
    if (savedId) setItem(ACTIVE_TRACK_KEY, savedId); else removeItem(ACTIVE_TRACK_KEY);
    onOpenEditor();
  };
  // A draft that is not saved anywhere is the player's work in progress: it must not be replaced without asking.
  const guarded = draftNeedsSaving(draft, tracks);
  const open = (track: SavedTrack) => (guarded ? setPending({ kind: 'open', track }) : launch(track.def, track.id));
  const create = (def: TrackDef) => (guarded ? setPending({ kind: 'new', def }) : launch(def, null));

  const confirm = () => {
    if (!pending) return;
    if (pending.kind === 'delete') {
      deleteTrack(pending.track.id);
      setVersion((v) => v + 1);
    } else if (pending.kind === 'open') launch(pending.track.def, pending.track.id);
    else launch(pending.def, null);
    setPending(null);
  };

  return <>
    <section className="fit-pane home-event workshop-tracks" data-pane-id="event" aria-labelledby="workshop-tracks-title">
      <div className="section-topline"><span className="eyebrow" id="workshop-tracks-title"><b>01</b> MY TRACKS</span><span className="eyebrow">{circuits.length} CIRCUIT{circuits.length === 1 ? '' : 'S'} • {courses.length} COURSE{courses.length === 1 ? '' : 'S'}</span></div>
      {tracks.length === 0
        ? <div className="my-tracks-empty">
          <p>You have no saved tracks yet.</p>
          <p className="muted">Press New track to start one: a classic circuit, or a platformer course built sideways in three lanes. Save it inside the Workshop and it is listed here, and under My tracks in Quick race.</p>
        </div>
        : <>
          <div className="workshop-kind-filter" role="group" aria-label="Show circuits or platformer courses">
            {([['all', `All ${tracks.length}`], ['track', `Circuits ${circuits.length}`], ['platformer', `Courses ${courses.length}`]] as const).map(([id, label]) => (
              <button key={id} type="button" className={kind === id ? 'selected' : ''} aria-pressed={kind === id} onClick={() => setKind(id)}>{label}</button>
            ))}
          </div>
          <ul className="workshop-list" aria-label="Saved tracks">{shown.map((t) => <li key={t.id} className="my-track-row workshop-row">
            <TrackThumbnail def={t.def} />
            <span className="my-track-meta">
              <strong>{t.def.name}</strong>
              <span className="muted">{isPlatformerDef(t.def)
                ? `${t.def.pieces.length} pcs • ${Math.round((t.def.width ?? 0) / 100) / 10}k long • ${t.def.theme} • ${when(t.updatedAt)}`
                : `${t.def.pieces.length} pcs • ${Math.round(t.def.height).toLocaleString()}px • ${t.def.theme} • ${when(t.updatedAt)}`}</span>
              {isPlatformerDef(t.def) && <span className="my-track-badge is-platformer" title="A platformer course: three lanes, raced left to right">PLATFORMER</span>}
            </span>
            <span className="workshop-row-actions">
              <button className="button-secondary" onClick={() => open(t)} aria-label={`Open ${t.def.name} in the Workshop`}><FilePenLine size={14} />Open</button>
              <button className="icon-button" onClick={() => setPending({ kind: 'delete', track: t })} aria-label={`Delete ${t.def.name}`} title="Delete"><Trash2 size={15} /></button>
            </span>
          </li>)}</ul>
          {shown.length === 0 && <p className="muted workshop-blurb">{kind === 'platformer'
            ? 'You have no platformer courses yet. Press New track, then Platformer course, to build one.'
            : 'You have no classic circuits yet. Press New track to start one.'}</p>}
        </>}
    </section>

    <section className="fit-pane home-garage workshop-hero" data-pane-id="garage" aria-labelledby="workshop-title">
      <div className="section-topline"><span className="eyebrow"><b>02</b> THE WORKSHOP</span></div>
      <div className="workshop-banner-card"><img src={bannerUrl as unknown as string} alt="" draggable={false} /><div><strong id="workshop-title">Workshop</strong><span>GOBLIN MECHANICS AT WORK — BUILD, TEST, SHARE</span></div></div>
      <p className="workshop-blurb">Lay ramps, loops, pegs and hazards on your own circuit, test-drive it with the real physics, then race it in Quick race or publish it for everyone.</p>
      <div className="workshop-draft">
        <span className="eyebrow">LAST DRAFT</span>
        {draft
          ? <>
            <div className="workshop-draft-card">
              <TrackThumbnail def={draft} />
              <span className="my-track-meta">
                <strong>{draft.name}</strong>
                <span className="muted">{draft.pieces.length} pcs • {Math.round(draft.height).toLocaleString()}px • {guarded ? 'not saved to My tracks yet' : 'saved'}</span>
              </span>
            </div>
            <button className="button-secondary" onClick={onOpenEditor}><Hammer size={14} />Continue last draft</button>
          </>
          : <p className="muted">No draft yet. Your open track saves itself while you build, so it is waiting here next time.</p>}
      </div>
    </section>

    <section className="fit-pane home-field workshop-community" data-pane-id="field" aria-labelledby="workshop-community-title">
      <div className="section-topline"><span className="eyebrow" id="workshop-community-title"><b>03</b> COMMUNITY</span></div>
      <p className="workshop-blurb">Tracks built by other goblins live in Quick race, under Community: upvote the good ones and race them. Publish your own from inside the Workshop.</p>
      <div className="workshop-links">
        <button className="button-secondary" onClick={onBrowseCommunity}><Users size={14} />Browse community tracks</button>
        <button className="button-secondary" onClick={onOpenEditor}><Share2 size={14} />Publish a track</button>
      </div>
    </section>

    {newTrackOpen && <NewTrackDialog onClose={onNewTrackClose} onCreate={create} />}
    {pending && <ConfirmDialog
      title={pending.kind === 'delete' ? 'Delete this track?' : 'Replace your unsaved draft?'}
      message={pending.kind === 'delete'
        ? `“${pending.track.def.name}” will be removed from My tracks. This can't be undone.`
        : `Your open draft “${draft?.name ?? ''}” is not saved to My tracks. ${pending.kind === 'open' ? `Opening “${pending.track.def.name}”` : 'Starting a new track'} replaces it.`}
      confirmLabel={pending.kind === 'delete' ? 'Delete' : pending.kind === 'open' ? 'Open anyway' : 'Start new anyway'}
      onConfirm={confirm}
      onCancel={() => setPending(null)}
    />}
  </>;
}
