/**
 * Community tracks: two columns, the most upvoted and the newest, 20 at a time with Load more. Each card shows a
 * scrollable map of the whole track, who built it, its tags, an upvote button with the count, and Add to My tracks.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowBigUp, Check, ChevronDown, Hammer, Plus, Trophy, Sparkles, Users } from 'lucide-react';
import Brand from './Brand';
import WalletButton from './WalletButton';
import TrackMap from './TrackMap';
import { COMMUNITY_TAGS, browseCommunity, decodeCommunityTrack, isLocalCommunity, recordTrackUse, setUpvote } from '../game/community';
import type { CommunitySort, CommunityTrack } from '../game/community';
import { createTrack, loadTracksSync } from '../game/tracks';
import type { TrackDef } from '../game/trackdef';
import type { RacerAccount } from '../game/economy';

interface Props {
  account: RacerAccount;
  onShop: () => void;
  onGarage: () => void;
  onWorkshop: () => void;
}

interface Column { tracks: CommunityTrack[]; cursor?: string; loading: boolean; error: string | null; loaded: boolean }
const EMPTY: Column = { tracks: [], loading: false, error: null, loaded: false };

export default function CommunityScreen({ account, onShop, onGarage, onWorkshop }: Props) {
  const [top, setTop] = useState<Column>(EMPTY);
  const [fresh, setFresh] = useState<Column>(EMPTY);
  const [local, setLocal] = useState(false);
  const [tag, setTag] = useState<string | null>(null);
  const [pane, setPane] = useState<CommunitySort>('top');

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

  useEffect(() => {
    void isLocalCommunity().then(setLocal);
    void load('top', false);
    void load('new', false);
  }, [load]);

  // An upvote changes the same track in both columns.
  const patch = (id: string, changes: Partial<CommunityTrack>) => {
    const apply = (c: Column) => ({ ...c, tracks: c.tracks.map((t) => (t.id === id ? { ...t, ...changes } : t)) });
    setTop(apply);
    setFresh(apply);
  };

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
          {local && <p className="community-local">Local test mode: you're not on RUN.world, so published tracks and upvotes are only saved on this device.</p>}
        </div>
        <button className="button-secondary" onClick={onWorkshop}><Hammer size={15} />Build and publish your own</button>
      </div>
      <div className="community-tags" role="group" aria-label="Filter by tag">
        <button className={tag === null ? 'selected' : ''} aria-pressed={tag === null} onClick={() => setTag(null)}>All</button>
        {COMMUNITY_TAGS.map((t) => <button key={t} className={tag === t ? 'selected' : ''} aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}>{t}</button>)}
      </div>
      <div className="community-columns">
        {columns.map(([sort, label, Icon, col]) => {
          const shown = tag ? col.tracks.filter((t) => t.tags.includes(tag)) : col.tracks;
          return <section key={sort} className="fit-pane community-column" data-pane-id={sort} aria-label={label}>
            <div className="section-topline"><h2><Icon size={18} /> {label}</h2><span className="eyebrow">{shown.length} shown</span></div>
            <div className="community-list">
              {shown.map((t, i) => <CommunityCard key={t.id} track={t} rank={sort === 'top' && !tag ? i + 1 : null} onPatch={patch} />)}
              {col.loaded && !col.loading && shown.length === 0 && !col.error && <p className="muted community-empty">{tag ? `No ${tag} tracks here yet.` : 'No community tracks yet. Be the first: build one in the Workshop and press Publish.'}</p>}
              {col.error && <p className="community-error">{col.error}</p>}
              {col.loading && <p className="muted community-empty">Loading tracks…</p>}
              {col.cursor && !col.loading && <button className="button-secondary community-more" onClick={() => void load(sort, true)}><ChevronDown size={15} />Load more</button>}
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

function CommunityCard({ track, rank, onPatch }: { track: CommunityTrack; rank: number | null; onPatch: (id: string, changes: Partial<CommunityTrack>) => void }) {
  const [def, setDef] = useState<TrackDef | null>(null);
  const [broken, setBroken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(() => loadTracksSync().some((t) => t.def.name === track.name));
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    decodeCommunityTrack(track).then((d) => { if (live) setDef(d); }).catch(() => { if (live) setBroken(true); });
    return () => { live = false; };
    // Only the code matters: an upvote replaces the track object but must not re-decode and redraw the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.code]);

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

  return <article className="community-card">
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
        <button className="button-secondary community-add" onClick={add} disabled={!def || added}>{added ? <><Check size={14} />In My tracks</> : <><Plus size={14} />Add to My tracks</>}</button>
      </div>
      {msg && <p className="community-msg" role="status">{msg}</p>}
    </div>
  </article>;
}
