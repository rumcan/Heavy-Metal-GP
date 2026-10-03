import { useMemo } from 'react';
import { Check, Hammer, Shuffle } from 'lucide-react';
import { CALENDAR } from '../../game/season';
import { officialTrack } from '../../game/official-tracks';
import { loadTracksSync } from '../../game/tracks';
import type { MarbleInfo } from '../../game/types';
import CircuitPreview from '../CircuitPreview';
import { CommunityPicker } from '../CommunityScreen';
import TrackThumbnail from '../editor/TrackThumbnail';
import { splitEntries } from '../../game/platformer/lists';
import { PLATFORMER_COURSES, PLATFORMER_PREFIX, PLATFORMER_TRACK_ID, isPlatformerPick, platformerCourse } from '../../game/platformer/course';

/** Where the quick race's circuit comes from. */
export type QuickSub = 'calendar' | 'mine' | 'community' | 'platformer';

interface Props {
  sub: QuickSub;
  onSub: (sub: QuickSub) => void;
  circuitIndex: number;
  onCircuit: (index: number) => void;
  seed: number;
  onNewSeed: () => void;
  /** The grid the preview races: the player first. Keep it stable between renders, or the preview restarts. */
  roster: MarbleInfo[];
  /** The saved track the race will run (a My tracks id), or null for the calendar circuit. */
  customTrackId: string | null;
  onSelectCustom: (id: string | null) => void;
  /** Go and build one: there is nothing in My tracks yet. */
  onWorkshop: () => void;
}

const SUBS: [QuickSub, string][] = [['calendar', 'Calendar'], ['mine', 'My tracks'], ['community', 'Community'], ['platformer', 'Platformer']];

/**
 * The quick race's circuit picker (the left column). Three sources: the six calendar circuits with their live
 * preview, your own saved tracks, and the community's — which used to be a page of their own behind a header button.
 * Whatever is picked is what the footer's Race button runs.
 */
export default function TrackPicker({ sub, onSub, circuitIndex, onCircuit, seed, onNewSeed, roster, customTrackId, onSelectCustom, onWorkshop }: Props) {
  const circuit = CALENDAR[circuitIndex];
  // The official archive for the selected circuit — the fixed layout the demo and any quick heat race. Null only if
  // the archive is missing/refused, in which case the old seeded preview (and its Regenerate button) come back.
  const official = officialTrack(circuitIndex);
  // Parsing saved tracks checks every one of them: once per visit to the sub-tab or pick, not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allTracks = useMemo(() => loadTracksSync(), [customTrackId, sub]);
  // P2-22: a platformer course made in the Workshop lives in My tracks too, but it is raced from the Platformer tab:
  // the classic list shows circuits only, and the Platformer tab shows the courses only.
  const { circuits: myTracks, courses: myCourses } = useMemo(() => splitEntries(allTracks), [allTracks]);
  const selectedCustom = myTracks.find((t) => t.id === customTrackId) ?? null;
  const selectedMyCourse = myCourses.find((t) => t.id === customTrackId) ?? null;

  const pickSub = (next: QuickSub) => {
    // Going back to the calendar drops a picked track: the race is on the calendar again.
    if (next === 'calendar') onSelectCustom(null);
    // P2-00: the platformer preview is its own pick; leaving its tab puts the calendar back.
    if (next === 'platformer') { if (!isPlatformerPick(customTrackId) && !selectedMyCourse) onSelectCustom(PLATFORMER_TRACK_ID); }
    else if (isPlatformerPick(customTrackId) || selectedMyCourse) onSelectCustom(null);
    onSub(next);
  };

  return <section className="fit-pane circuit-panel home-event" data-pane-id="event" aria-label="The circuit">
    <div className="section-topline"><span className="eyebrow"><b>01</b> THE CIRCUIT</span>{sub === 'calendar' && !official && <button className="text-button" onClick={onNewSeed}><Shuffle size={14} />Regenerate</button>}</div>
    <div className="circuit-tabs" role="tablist" aria-label="Circuit source">
      {SUBS.map(([id, label]) => <button key={id} id={`picker-tab-${id}`} role="tab" aria-selected={sub === id} aria-controls="picker-panel" className={sub === id ? 'selected' : ''} onClick={() => pickSub(id)}>{label}{id === 'mine' && myTracks.length ? ` (${myTracks.length})` : ''}</button>)}
    </div>

    <div className="home-picker-panel" id="picker-panel" role="tabpanel" aria-labelledby={`picker-tab-${sub}`}>
      {sub === 'calendar' && <>
        <div className="circuit-title-row"><div><h2 id="circuit-title">{circuit.short}</h2><span>{circuit.location}</span></div>{official ? <span className="circuit-seed">OFFICIAL<br /><b>{official.pieces.length} PCS</b></span> : <span className="circuit-seed">SEED<br /><b>{seed.toString(16).slice(0, 6).toUpperCase()}</b></span>}</div>
        <CircuitPreview seed={seed} roster={roster} profile={circuit.profile} def={official} />
        <div className="circuit-selector" aria-label="Select a circuit">{CALENDAR.map((gp, i) => <button key={gp.id} className={i === circuitIndex ? 'selected' : ''} aria-pressed={i === circuitIndex} onClick={() => { onSelectCustom(null); onCircuit(i); }}><span>{String(i + 1).padStart(2, '0')}</span><strong>{gp.short}</strong></button>)}</div>
      </>}

      {sub === 'mine' && <div className="custom-circuit-pane" aria-label="My tracks">
        {selectedCustom ? (
          <div className="custom-selected">
            <div className="circuit-title-row"><div><h2 id="circuit-title">{selectedCustom.def.name.toUpperCase()}</h2><span>CUSTOM • {selectedCustom.def.pieces.length} pieces • {selectedCustom.def.height}px</span></div><span className="circuit-seed">CUSTOM<br /><b>{selectedCustom.id.slice(0, 6).toUpperCase()}</b></span></div>
            <div className="custom-preview"><TrackThumbnail def={selectedCustom.def} /><p className="muted">{selectedCustom.def.name} — a player-built circuit. Quick race payout is reduced (30 %) to keep farming in check; calendar races pay full purse.</p></div>
            <div className="custom-actions"><button className="text-button" onClick={() => pickSub('calendar')}>Back to Calendar</button></div>
          </div>
        ) : myTracks.length === 0 ? null : (
          <p className="muted">Click one of your tracks below to select it, then press <b>Race</b>. Races on your own tracks pay 30 % of the usual winnings.</p>
        )}
        <div className="my-tracks-list" role="listbox" aria-label="Saved tracks">
          {myTracks.length === 0 ? (
            <div className="my-tracks-empty">
              <p>You have no saved tracks yet.</p>
              <button className="button-secondary" onClick={onWorkshop}><Hammer size={14} />Go to the Workshop</button>
              <p className="muted">Build a circuit, save it, and it appears here for quick races. Or pick one from the Community tab.</p>
            </div>
          ) : myTracks.map((t) => <button key={t.id} role="option" aria-selected={t.id === customTrackId} className={`my-track-row ${t.id === customTrackId ? 'selected' : ''}`} onClick={() => onSelectCustom(t.id)}>
            <TrackThumbnail def={t.def} />
            <span className="my-track-meta">
              <strong>{t.def.name}</strong>
              <span className="muted">{t.def.pieces.length} pcs • {t.def.height}px • {t.def.theme}</span>
            </span>
            <span className="my-track-check" aria-hidden>{t.id === customTrackId ? '●' : ''}</span>
          </button>)}
        </div>
      </div>}

      {sub === 'platformer' && (() => {
        const course = platformerCourse(customTrackId);
        const pickedName = selectedMyCourse ? selectedMyCourse.def.name : course.name;
        // A course of the player's own has no official blurb, and none of the official buttons is the pick.
        const pickedBlurb = selectedMyCourse
          ? `Your own platformer course: ${selectedMyCourse.def.pieces.length} pieces, ${Math.round((selectedMyCourse.def.width ?? 0) / 100) / 10}k long.`
          : course.blurb;
        const officialPicked = !selectedMyCourse;
        return <div className="custom-circuit-pane" aria-label="Platformer courses">
          <div className="circuit-title-row"><div><h2 id="circuit-title">{pickedName.toUpperCase()}</h2><span>{selectedMyCourse ? 'PLATFORMER • YOUR COURSE' : 'PLATFORMER • PREVIEW'} • three depth lanes • turn your phone sideways</span></div></div>
          <p className="muted">{pickedBlurb}</p>
          {selectedMyCourse && <div className="custom-preview"><TrackThumbnail def={selectedMyCourse.def} wide /></div>}
          <p className="muted">Roll right with ← →, jump with ↑ or Space. A ramp takes you to the next lane when you roll through it on the ground (jump over it to stay). In a door, press ↑ to go through.</p>
          <div className="circuit-selector" aria-label="Select a platformer course">{PLATFORMER_COURSES.map((c, i) => <button key={c.id} className={officialPicked && c.id === course.id ? 'selected' : ''} aria-pressed={officialPicked && c.id === course.id} onClick={() => onSelectCustom(PLATFORMER_PREFIX + c.id)}><span>{String(i + 1).padStart(2, '0')}</span><strong>{c.name}</strong></button>)}</div>
          {myCourses.length > 0 && <div className="my-tracks-list" role="listbox" aria-label="My courses">
            <p className="muted">Your own platformer courses:</p>
            {myCourses.map((t) => <button key={t.id} role="option" aria-selected={t.id === customTrackId} className={`my-track-row ${t.id === customTrackId ? 'selected' : ''}`} onClick={() => onSelectCustom(t.id)}>
              <span className="my-track-meta"><strong>{t.def.name}</strong><span className="muted">{t.def.pieces.length} pieces • {Math.round((t.def.width ?? 0) / 100) / 10}k long</span></span>
              <span className="my-track-check" aria-hidden>{t.id === customTrackId ? '●' : ''}</span>
            </button>)}
          </div>}
          {myCourses.length === 0 && <p className="muted">Build your own in the Workshop: New track, then Platformer course.</p>}
          <p className="picker-selected" role="status"><Check size={14} aria-hidden="true" />Selected for the race: <b>{pickedName}</b></p>
          <h3 className="picker-subhead">Community courses</h3>
          <CommunityPicker kind="platformer" selectedId={customTrackId} onPick={onSelectCustom} onWorkshop={onWorkshop} />
        </div>;
      })()}
      {sub === 'community' && <>
        {selectedCustom && <p className="picker-selected" role="status"><Check size={14} aria-hidden="true" />Selected for the race: <b>{selectedCustom.def.name}</b></p>}
        <CommunityPicker kind="track" selectedId={customTrackId} onPick={onSelectCustom} onWorkshop={onWorkshop} />
      </>}
    </div>
  </section>;
}
