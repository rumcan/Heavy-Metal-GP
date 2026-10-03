/**
 * Community tracks: the most upvoted and the newest, 20 at a time with Load more. Each card shows a scrollable map of
 * the whole track, who built it, its tags, an upvote button with the count, and a button to use the track.
 *
 * One list, two faces (P2-04):
 *   - `CommunityScreen` (default export) is the full page with its two columns. The Workshop's own Community button
 *     still opens it.
 *   - `CommunityPicker` is the same list as a panel inside the Quick race track picker: one column with a sort toggle,
 *     and each card's button PICKS the track for the race (it is saved to My tracks first, so the race can find it).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowBigUp, Check, ChevronDown, Flag, Hammer, Plus, Trophy, Sparkles, Users } from 'lucide-react';
import Brand from './Brand';
import WalletButton from './WalletButton';
import TrackMap from './TrackMap';
import { COMMUNITY_TAGS, browseCommunity, decodeCommunityTrack, isLocalCommunity, recordTrackUse, setUpvote } from '../game/community';
import type { CommunitySort, CommunityTrack } from '../game/community';
import { entriesOfKind } from '../game/platformer/lists';
import type { CommunityKind } from '../game/platformer/lists';
import { createTrack, loadTracksSync } from '../game/tracks';
import type { TrackDef } from '../game/trackdef';
import type { RacerAccount } from '../game/economy';
import { savedCopyOf } from './home/trackIdentity';

interface Props {
  account: RacerAccount;
  onShop: () => void;
  onGarage: () => void;
  onWorkshop: () => void;
}

interface Column { tracks: CommunityTrack[]; cursor?: string; loading: boolean; error: string | null; loaded: boolean }
const EMPTY: Column = { tracks: [], loading: false, error: null, loaded: false };

/** Both feeds, their paging, and an upvote that is patched into both. */
function useCommunityFeed() {
  const [top, setTop] = useState<Column>(EMPTY);
  const [fresh, setFresh] = useState<Column>(EMPTY);
  const [local, setLocal] = useState(false);

  // Next-page cursors, kept outside state so `load` reads the current one synchronously.
  const cursors = useRef<Record<CommunitySort, string | undefined>>({ top: undefined, new: undefined });
  const load = useCallback(async (sort: CommunitySort, more: boolean) => {
    const set = sort === 'top' ? setTop : setFresh;
    const cursor = more ? cursors.current[sort] : undefined;
    set((c) => ({ ...c, loading: true, error: null }));
    try {
      const page = await browseCommunity(sort, cursor);
      cursors.current[sort] = page.cursor;
      set((c) => ({ tracks: more ? [...c.tracks, ...page.tracks.filter((t) => !c.tracks.some((o) => o.id === t.id))] : page.tracks, cursor: page.cursor, loading: false, error: null, loaded: true }));
    } catch {
      set((c) => ({ ...c, loading: false, error: 'Could not load community tracks. Check your connection and try again.', loaded: true }));
    }
  }, []);

  useEffect(() => { void isLocalCommunity().then(setLocal); }, []);

  // An upvote changes the same track in both columns.
  const patch = useCallback((id: string, changes: Partial<CommunityTrack>) => {
    const apply = (c: Column) => ({ ...c, tracks: c.tracks.map((t) => (t.id === id ? { ...t, ...changes } : t)) });
    setTop(apply);
    setFresh(apply);
  }, []);

  return { top, fresh, local, load, patch };
}

const LOCAL_NOTE = "Local test mode: you're not on RUN.world, so published tracks and upvotes are only saved on this device.";

export default function CommunityScreen({ account, onShop, onGarage, onWorkshop }: Props) {
  const { top, fresh, local, load, patch } = useCommunityFeed();
  const [tag, setTag] = useState<string | null>(null);
  const [pane, setPane] = useState<CommunitySort>('top');

  useEffect(() => {
    void load('top', false);
    void load('new', false);
  }, [load]);

  const columns: [CommunitySort, string, typeof Trophy, Column][] = [
    ['top', 'Most upvoted', Trophy, top],
    ['new', 'Just added', Sparkles, fresh],
  ];

  return <div className="app-shell community-page fit-shell" data-pane={pane}>
    <header className="app-header">
      <Brand onClick={onGarage} />
      <nav className="main-nav" aria-label="Main navigation">
        <button onClick={onGarage}>Garage</button>
        <button onClick={onWorkshop}>Workshop</button>
        <button className="active" aria-current="page">Community</button>
      </nav>
      <div className="header-tools"><WalletButton credits={account.credits} onClick={onShop} /></div>
    </header>

    <main className="fit-main community-main">
      <div className="community-intro">
        <div>
          <span className="eyebrow"><Users size={14} /> COMMUNITY TRACKS</span>
          <p>Tracks built by other goblins. Scroll a map to see what's on it, upvote the good ones, and add any to My tracks to race or edit it.</p>
          {local && <p className="community-local">{LOCAL_NOTE}</p>}
        </div>
        <button className="button-secondary" onClick={onWorkshop}><Hammer size={15} />Build and publish your own</button>
      </div>
      <TagFilter tag={tag} onTag={setTag} />
      <div className="community-columns">
        {columns.map(([sort, label, Icon, col]) => {
          const shown = tag ? col.tracks.filter((t) => t.tags.includes(tag)) : col.tracks;
          return <section key={sort} className="fit-pane community-column" data-pane-id={sort} aria-label={label}>
            <div className="section-topline"><h2><Icon size={18} /> {label}</h2><span className="eyebrow">{shown.length} shown</span></div>
            <div className="community-list">
              {shown.map((t, i) => <CommunityCard key={t.id} track={t} rank={sort === 'top' && !tag ? i + 1 : null} onPatch={patch} />)}
              <FeedStatus col={col} shown={shown.length} tag={tag} onMore={() => void load(sort, true)} />
            </div>
          </section>;
        })}
      </div>
    </main>
    <nav className="pane-tabs" aria-label="Community lists">
      <button className={pane === 'top' ? 'selected' : ''} aria-pressed={pane === 'top'} onClick={() => setPane('top')}>Most upvoted</button>
      <button className={pane === 'new' ? 'selected' : ''} aria-pressed={pane === 'new'} onClick={() => setPane('new')}>Just added</button>
    </nav>
  </div>;
}

interface PickerProps {
  /** The saved track the quick race is set to run (a My tracks id), if any: its card shows as selected. */
  selectedId: string | null;
  /** The player picked a track. It has been saved to My tracks; `id` is its My tracks id. */
  onPick: (id: string) => void;
  /** Open the Workshop to build and publish a track of your own. */
  onWorkshop?: () => void;
  /**
   * P2-22: which half of the community this list shows. Circuits (the default) appear under Quick race → Community,
   * platformer courses under Quick race → Platformer, and never in each other's list.
   */
  kind?: CommunityKind;
}

/**
 * The community list as a picker panel (Quick race → Community, and the courses half of Quick race → Platformer).
 * One column with a sort toggle and the tag filter; only the feed that is on screen is fetched.
 */
export function CommunityPicker({ selectedId, onPick, onWorkshop, kind = 'track' }: PickerProps) {
  const { top, fresh, local, load, patch } = useCommunityFeed();
  const [sort, setSort] = useState<CommunitySort>('top');
  const [tag, setTag] = useState<string | null>(null);
  const col = sort === 'top' ? top : fresh;
  const course = kind === 'platformer';

  useEffect(() => {
    if (!col.loaded && !col.loading) void load(sort, false);
  }, [sort, col.loaded, col.loading, load]);

  const ofKind = useMemo(() => entriesOfKind(col.tracks, kind), [col.tracks, kind]);
  const shown = tag ? ofKind.filter((t) => t.tags.includes(tag)) : ofKind;
  return <section className="community-picker" aria-label={course ? 'Community platformer courses' : 'Community tracks'}>
    <p className="community-picker-intro">{course
      ? 'Platformer courses built by other goblins. Pick one to race it — it is saved to My tracks too.'
      : 'Tracks built by other goblins. Pick one to race it — it is saved to My tracks too.'} Races on your own or community tracks pay 30 % of the usual winnings.</p>
    {local && <p className="community-local">{LOCAL_NOTE}</p>}
    <div className="community-picker-bar">
      <div className="circuit-tabs" role="group" aria-label="Sort community tracks">
        <button className={sort === 'top' ? 'selected' : ''} aria-pressed={sort === 'top'} onClick={() => setSort('top')}><Trophy size={12} /> Most upvoted</button>
        <button className={sort === 'new' ? 'selected' : ''} aria-pressed={sort === 'new'} onClick={() => setSort('new')}><Sparkles size={12} /> Just added</button>
      </div>
      {onWorkshop && <button className="text-button" onClick={onWorkshop}><Hammer size={14} />Build your own</button>}
    </div>
    <TagFilter tag={tag} onTag={setTag} />
    <div className="community-list">
      {shown.map((t, i) => <CommunityCard key={t.id} track={t} rank={sort === 'top' && !tag ? i + 1 : null} onPatch={patch} pick={{ selectedId, onPick }} />)}
      <FeedStatus col={col} shown={shown.length} tag={tag} onMore={() => void load(sort, true)} empty={course
        ? 'No community courses yet. Build one in the Workshop (New track → Platformer course) and press Publish.'
        : 'No community tracks yet. Be the first: build one in the Workshop and press Publish.'} />
    </div>
  </section>;
}

function TagFilter({ tag, onTag }: { tag: string | null; onTag: (tag: string | null) => void }) {
  return <div className="community-tags" role="group" aria-label="Filter by tag">
    <button className={tag === null ? 'selected' : ''} aria-pressed={tag === null} onClick={() => onTag(null)}>All</button>
    {COMMUNITY_TAGS.map((t) => <button key={t} className={tag === t ? 'selected' : ''} aria-pressed={tag === t} onClick={() => onTag(tag === t ? null : t)}>{t}</button>)}
  </div>;
}

/** What a feed says when it is empty, failed, loading, or has another page. */
function FeedStatus({ col, shown, tag, onMore, empty }: { col: Column; shown: number; tag: string | null; onMore: () => void; empty?: string }) {
  return <>
    {col.loaded && !col.loading && shown === 0 && !col.error && <p className="muted community-empty">{tag ? `No ${tag} tracks here yet.` : empty ?? 'No community tracks yet. Be the first: build one in the Workshop and press Publish.'}</p>}
    {col.error && <p className="community-error">{col.error}</p>}
    {col.loading && <p className="muted community-empty">Loading tracks…</p>}
    {col.cursor && !col.loading && <button className="button-secondary community-more" onClick={onMore}><ChevronDown size={15} />Load more</button>}
  </>;
}

interface Pick { selectedId: string | null; onPick: (id: string) => void }

function CommunityCard({ track, rank, onPatch, pick }: { track: CommunityTrack; rank: number | null; onPatch: (id: string, changes: Partial<CommunityTrack>) => void; pick?: Pick }) {
  const [def, setDef] = useState<TrackDef | null>(null);
  const [broken, setBroken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(() => loadTracksSync().some((t) => t.def.name === track.name));
  /** Picker only: the My tracks id of this track's saved copy. */
  const [savedId, setSavedId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    decodeCommunityTrack(track).then((d) => { if (live) setDef(d); }).catch(() => { if (live) setBroken(true); });
    return () => { live = false; };
    // Only the code matters: an upvote replaces the track object but must not re-decode and redraw the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.code]);

  useEffect(() => {
    if (pick && def) setSavedId(savedCopyOf(def, track.name)?.id ?? null);
  }, [pick, def, track.name]);

  const vote = async () => {
    if (busy) return;
    const on = !track.upvotedByMe;
    setBusy(true);
    onPatch(track.id, { upvotedByMe: on, upvotes: Math.max(0, track.upvotes + (on ? 1 : -1)) });
    try {
      const count = await setUpvote(track, on);
      onPatch(track.id, { upvotes: count });
    } catch {
      onPatch(track.id, { upvotedByMe: !on, upvotes: track.upvotes });
      setMsg('Upvote failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    if (!def) return;
    const res = createTrack({ ...def, name: track.name });
    if ('error' in res) { setMsg(res.error); return; }
    setAdded(true);
    setMsg('Added to My tracks.');
    void recordTrackUse(track);
  };

  /** Picker: make sure the track is in My tracks (the race finds it there), then hand its id over. */
  const choose = () => {
    if (!def || !pick) return;
    let id = savedId ?? savedCopyOf(def, track.name)?.id ?? null;
    if (!id) {
      const res = createTrack({ ...def, name: track.name });
      if ('error' in res) { setMsg(res.error); return; }
      id = res.id;
      void recordTrackUse(track);
    }
    setSavedId(id);
    setMsg(null);
    pick.onPick(id);
  };
  const selected = !!pick && savedId !== null && pick.selectedId === savedId;

  return <article className={`community-card ${selected ? 'is-selected' : ''}`}>
    <div className="community-map" tabIndex={0} aria-label={`Map of ${track.name}, scroll to see the whole track`}>
      {def ? <TrackMap def={def} width={112} /> : <div className="community-map-placeholder">{broken ? 'Map unavailable' : 'Loading…'}</div>}
    </div>
    <div className="community-info">
      <div className="community-title">
        {rank !== null && <span className="community-rank">#{rank}</span>}
        <h3>{track.name}</h3>
      </div>
      <p className="community-author">by <b>{track.author}</b></p>
      {track.tags.length > 0 && <div className="community-card-tags">{track.tags.map((t) => <span key={t}>{t}</span>)}</div>}
      {def && <p className="community-stats">{def.pieces.length} pieces · {Math.round(def.height).toLocaleString()} u long</p>}
      <div className="community-actions">
        <button className={`community-vote ${track.upvotedByMe ? 'voted' : ''}`} onClick={() => void vote()} aria-pressed={track.upvotedByMe} aria-label={`${track.upvotedByMe ? 'Remove upvote from' : 'Upvote'} ${track.name}, ${track.upvotes} upvotes`}>
          <ArrowBigUp size={20} /><span>{track.upvotes}</span>
        </button>
        {pick
          ? <button className={`button-secondary community-add community-pick ${selected ? 'selected' : ''}`} onClick={choose} disabled={!def} aria-pressed={selected} aria-label={`${selected ? 'Selected' : 'Race this track'}, ${track.name}`}>
            {selected ? <><Check size={14} />Selected</> : <><Flag size={14} />Race this track</>}
          </button>
          : <button className="button-secondary community-add" onClick={add} disabled={!def || added}>{added ? <><Check size={14} />In My tracks</> : <><Plus size={14} />Add to My tracks</>}</button>}
      </div>
      {msg && <p className="community-msg" role="status">{msg}</p>}
    </div>
  </article>;
}
