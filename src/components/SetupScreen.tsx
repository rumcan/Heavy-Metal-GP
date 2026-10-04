/**
 * P2-04 — the home screen: the five game modes as tabs.
 *
 *     [Story] [Championship] [Quick race] [Online] [Workshop]        (?) rank wallet
 *     ┌ LEFT: the event ─────┬ MIDDLE: your goblin ─┬ RIGHT: the field ────┐
 *     │ chapters / season /  │ portrait, livery,    │ dossier / standings /│
 *     │ track picker / doors │ stats, loadout       │ grid / seats         │
 *     └──────────────────────┴──────────────────────┴──────────────────────┘
 *     footer: ONE primary button (Start · Race · Host · New track)
 *
 * The frame is the same in every tab; what fills it lives in `./home/`. Each mode keeps its own garage
 * (`src/game/garages.ts`) and the screen reopens on the tab the player left it on. On a phone in portrait the three
 * columns become the pane switcher at the bottom, and the tabs a scrollable strip under the logo.
 *
 * `seasonMode` is the championship's retune screen: the same frame with the Championship tab only, the garage open,
 * and "Save setup" as its one button.
 */
import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CircleHelp, FlaskConical, LockKeyhole } from 'lucide-react';
import { CALENDAR, roundName } from '../game/season';
import type { SeasonState } from '../game/season';
import type { MarbleInfo } from '../game/types';
import { garageOfPlayer, loadHomeTab, saveHomeTab, seasonLocksGarage } from '../game/garages';
import type { Garage, GarageMode, Garages, HomeTab } from '../game/garages';
import { loadStory, newStory } from '../game/story/state';
import type { StoryState } from '../game/story/state';
import { loadTracksSync } from '../game/tracks';
import type { RacerAccount } from '../game/economy';
import type { RankChipModel } from '../game/rank-view';
import { NO_ROOM_SERVER_MESSAGE, isOfflineMockRealtime } from '../net/transport';
import Brand from './Brand';
import PhysicsLab from './PhysicsLab';
import RankChip from './RankChip';
import RulesDialog from './RulesDialog';
import WalletButton from './WalletButton';
import { storyPrimary } from '../game/story/opening';
import type { StoryPick } from '../game/story/opening';
import type { StoryNotice } from './story/StoryHub';
import ChampionshipTab from './home/ChampionshipTab';
import { TAB_META } from './home/HomeTabs';
import MainMenu from './home/MainMenu';
import OnlineTab from './home/OnlineTab';
import QuickRaceTab from './home/QuickRaceTab';
import StoryTab from './home/StoryTab';
import WorkshopTab from './home/WorkshopTab';
import InfinityTab from './home/InfinityTab';
import type { QuickSub } from './home/TrackPicker';
import { isPlatformerPick, platformerCourse } from '../game/platformer/course';
import './home/home.css';

export interface SetupScreenProps {
  /** One garage per mode (`src/game/garages.ts`). */
  garages: Garages;
  onGarage: (mode: GarageMode, garage: Garage) => void;

  /** Championship: the saved season (null until one is started), and the doors into it. */
  season: SeasonState | null;
  onStartSeason: () => void;
  onContinueSeason?: () => void;
  /** Open the retune screen (between Grands Prix). */
  onRetune?: () => void;
  /** The retune screen: the Championship tab only, the garage open, "Save setup" the one button. */
  seasonMode?: boolean;
  onBackToSeason?: () => void;

  /** Quick race. */
  rivals: MarbleInfo[];
  onRerollRivals: () => void;
  seed: number;
  onNewSeed: () => void;
  onStart: () => void;
  circuitIndex: number;
  onCircuit: (index: number) => void;
  /** MB-08: quick race can run a player-built circuit (a My tracks id) instead of the calendar. */
  customTrackId?: string | null;
  onSelectCustom?: (id: string | null) => void;

  /** Story mode (ST-08): start this chapter (the big button starts the next one). Omitted when the story is not available. */
  onStartStory?: (pick?: StoryPick) => void;
  /** Banner for the chapter story mode just banked, shown on the Story tab. */
  storyNotice?: StoryNotice | null;

  /** MP-06: the online doors — host, join by code, quick race (MP-07) — and the race a returning player can rejoin (MP-08). */
  mpBusy?: boolean;
  mpError?: string | null;
  onHostGame?: () => void;
  onJoinGame?: (code: string) => void;
  onQuickGame?: () => void;
  searching?: boolean;
  windows?: number;
  onCancelSearch?: () => void;
  rejoin?: { roomCode: string } | null;
  onRejoin?: () => void;
  onDismissRejoin?: () => void;

  account: RacerAccount;
  onShop: () => void;
  /** RK-05: this driver's own rank. The header prints the badge and the number; tapping either opens the ladder. */
  rank?: RankChipModel | null;
  onRank?: () => void;
  /** MB-02: open the full-screen Workshop (the track editor). */
  onWorkshop?: () => void;
  /** P2-24: roll an Infinity run. */
  onStartInfinity?: () => void;

  /** Open on this tab instead of the one the player left on. */
  initialTab?: HomeTab;
}

type PaneId = 'event' | 'garage' | 'field';

/**
 * The mode the player is in during this visit. The game opens on the main menu; coming back from a race (the screen
 * mounts again) returns to the mode the race was started from. The back button clears it.
 */
let visitTab: HomeTab | null = null;

/** What the bottom switcher calls the three columns, per tab. */
function paneLabels(tab: HomeTab, seasonStarted: boolean): [string, string, string] {
  switch (tab) {
    case 'story': return ['Chapters', 'Driver', 'Dossier'];
    case 'championship': return ['Season', 'Driver', seasonStarted ? 'Standings' : 'Grid'];
    case 'quick': return ['Circuit', 'Driver', 'Grid'];
    case 'online': return ['Play', 'Driver', 'Field'];
    case 'infinity': return ['Roll', 'Driver', 'Records'];
    case 'workshop': return ['Tracks', 'Draft', 'Community'];
  }
}

interface Primary { label: string; onClick: () => void; disabled?: boolean; hint: string; locked?: boolean }

export default function SetupScreen(props: SetupScreenProps) {
  const { garages, onGarage, season, onStartSeason, onContinueSeason, onRetune, onBackToSeason, rivals, onRerollRivals, seed, onNewSeed, onStart, circuitIndex, onCircuit } = props;
  const { account, onShop, onStartStory, storyNotice = null, onHostGame, onJoinGame, onQuickGame, rank = null, onRank, onWorkshop } = props;
  const { mpBusy = false, mpError = null, searching = false, windows = 0, rejoin = null } = props;
  const customTrackId = props.customTrackId ?? null;
  const onSelectCustom = props.onSelectCustom ?? (() => undefined);
  const seasonMode = !!props.seasonMode;

  const [tab, setTab] = useState<HomeTab>(() => (seasonMode ? 'championship' : props.initialTab ?? visitTab ?? loadHomeTab()));
  /** The main menu is showing (every mode is picked from it; the header's back button returns to it). */
  const [menu, setMenu] = useState(() => !seasonMode && !props.initialTab && !visitTab);
  // A mode with something waiting for the player (a race to rejoin, a search running) opens on it; every other mode
  // opens on the goblin, as the garage always did.
  const [pane, setPane] = useState<PaneId>(() => (tab === 'workshop' || (tab === 'online' && (rejoin || searching)) ? 'event' : 'garage'));
  const [quickSub, setQuickSub] = useState<QuickSub>(isPlatformerPick(customTrackId) ? 'platformer' : customTrackId ? 'mine' : 'calendar');
  const [dialog, setDialog] = useState<'rules' | 'lab' | null>(null);
  const [newTrackOpen, setNewTrackOpen] = useState(false);
  const [storyVersion, setStoryVersion] = useState(0);

  const selectTab = (next: HomeTab) => {
    setMenu(false);
    visitTab = next;
    if (next === tab) return;
    setTab(next);
    setPane(next === 'workshop' ? 'event' : 'garage');
    saveHomeTab(next);
  };
  const backToMenu = () => { visitTab = null; setMenu(true); };
  const openWorkshopTab = () => selectTab('workshop');
  const browseCommunity = () => { setQuickSub('community'); selectTab('quick'); };

  // Story: the saved run, or a fresh one for show. Read again whenever the screen mounts or the story is restarted.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const story = useMemo<StoryState | null>(() => (tab === 'story' ? loadStory() ?? newStory(1, { name: 'Sprocket', ...garages.story }, 0) : null), [tab, storyVersion]);

  // Championship: a season that is running owns the garage (read-only) until the retune screen opens it again.
  const seasonRunning = seasonLocksGarage(season);
  const championshipLocked = seasonRunning && !seasonMode;
  const seasonPlayer = season?.roster.find((m) => m.isPlayer);
  const championshipGarage = useMemo<Garage>(
    () => (championshipLocked && seasonPlayer ? garageOfPlayer(seasonPlayer, garages.championship) : garages.championship),
    [championshipLocked, seasonPlayer, garages.championship],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const selectedCustom = useMemo(() => (customTrackId ? loadTracksSync().find((t) => t.id === customTrackId) ?? null : null), [customTrackId, tab]);
  const seasonRound = season ? Math.min(season.round, CALENDAR.length - 1) : 0;

  /** The one big button, per tab. */
  const primary = ((): Primary => {
    if (seasonMode) return { label: 'Save setup', onClick: onBackToSeason ?? (() => undefined), hint: 'Locked for all three heats once the GP begins.', locked: true };
    switch (tab) {
      case 'story': {
        const next = story ? storyPrimary(story) : null;
        return { label: next?.label ?? 'Start the story', onClick: () => onStartStory?.(next ? { chapter: next.chapter, replay: next.replay } : undefined), disabled: !onStartStory, hint: 'Story mode keeps its own save.' };
      }
      case 'championship':
        if (season && !season.complete) return { label: 'Continue season', onClick: onContinueSeason ?? (() => undefined), disabled: !onContinueSeason, hint: `Round ${seasonRound + 1} of ${CALENDAR.length} · ${roundName(season, seasonRound)}` };
        if (season) return { label: 'New season', onClick: onStartSeason, hint: 'This season is finished.' };
        return { label: 'Start season', onClick: onStartSeason, hint: 'Six Grands Prix, three heats each.' };
      case 'quick':
        return { label: 'Race', onClick: onStart, hint: `${isPlatformerPick(customTrackId) ? platformerCourse(customTrackId).name : selectedCustom ? selectedCustom.def.name : CALENDAR[circuitIndex].name} · one heat` };
      case 'online': {
        const doors = !!(onHostGame && onJoinGame && onQuickGame);
        const offline = isOfflineMockRealtime();
        return { label: 'Host', onClick: onHostGame ?? (() => undefined), disabled: !doors || mpBusy || searching || offline, hint: !doors || offline ? NO_ROOM_SERVER_MESSAGE : 'A friendly room, up to six drivers.' };
      }
      case 'infinity':
        return { label: 'Roll', onClick: props.onStartInfinity ?? (() => undefined), disabled: !props.onStartInfinity, hint: 'No rivals, no timer. Roll for as long as you like.' };
      case 'workshop':
        return { label: 'New track', onClick: () => setNewTrackOpen(true), hint: 'Build it, test it, race it.' };
    }
  })();

  const panes = paneLabels(tab, !!season);
  const paneIds: PaneId[] = ['event', 'garage', 'field'];

  const header = <header className="app-header home-header">
      <Brand />
      {seasonMode
        ? <div className="home-retune"><span className="eyebrow accent"><LockKeyhole size={13} aria-hidden="true" /> RETUNE</span><strong>{season ? roundName(season, seasonRound) : 'Championship'}</strong></div>
        : null}
      <div className="header-tools">
        <button className="text-button help-link" onClick={() => setDialog('rules')} aria-label="How to play" title="How to play"><CircleHelp size={17} /><span>How to play</span></button>
        {/* RK-05: the rank badge and rating live in the header — the one row every player sees before they pick a
            door. Tapping it opens the ladder. (At 375 px it moves into the goblin pane's title line.) */}
        {rank && <button
          className="rank-button"
          onClick={onRank}
          aria-label={`Rank: ${rank.label}${rank.rating != null ? `, ${rank.rating} rating` : ', unranked'} — open the ladder`}
          title="Your rank — open the ladder"
        ><RankChip model={rank} compact /></button>}
        {import.meta.env.DEV && <button className="text-button lab-link" onClick={() => setDialog('lab')}><FlaskConical size={16} /><span>Physics lab</span></button>}
        <WalletButton credits={account.credits} onClick={onShop} />
      </div>
    </header>;

  if (menu) {
    return <div className="app-shell home-page main-menu-page">
      {header}
      <MainMenu onPick={selectTab} last={loadHomeTab()} />
      {import.meta.env.DEV && dialog === 'lab' && <PhysicsLab onClose={() => setDialog(null)} />}
      {dialog === 'rules' && <RulesDialog onClose={() => setDialog(null)} />}
    </div>;
  }

  return <div className="app-shell home-page garage-page fit-shell" data-pane={pane} data-tab={tab}>
    <div className="home-top">
      {header}
      {/* A second row under the logo: the red Back button to the main menu and the mode's name. */}
      {!seasonMode && <div className="home-subbar">
        <button className="home-back-button" onClick={backToMenu} aria-label="Back to the main menu"><ArrowLeft size={16} aria-hidden="true" />Back</button>
        <strong className="home-mode-name">{TAB_META[tab].label}</strong>
      </div>}
    </div>

    <main className="fit-main home-main garage-fit" aria-label={`${TAB_META[tab].label} mode`}>
      {tab === 'story' && story && <StoryTab
        story={story}
        garage={garages.story}
        onGarage={(g) => onGarage('story', g)}
        onPlay={(pick) => onStartStory?.(pick)}
        notice={storyNotice}
        onRestarted={() => setStoryVersion((v) => v + 1)}
        account={account}
        onShop={onShop}
        rank={rank}
        onRank={onRank}
      />}
      {tab === 'championship' && <ChampionshipTab
        season={season}
        garage={championshipGarage}
        onGarage={(g) => onGarage('championship', g)}
        locked={championshipLocked}
        retune={seasonMode}
        rivals={rivals}
        onRerollRivals={onRerollRivals}
        seed={seed}
        circuitIndex={circuitIndex}
        onRetune={onRetune}
        onNewSeason={onStartSeason}
        account={account}
        onShop={onShop}
        rank={rank}
        onRank={onRank}
      />}
      {tab === 'quick' && <QuickRaceTab
        garage={garages.quick}
        onGarage={(g) => onGarage('quick', g)}
        rivals={rivals}
        onRerollRivals={onRerollRivals}
        seed={seed}
        onNewSeed={onNewSeed}
        circuitIndex={circuitIndex}
        onCircuit={onCircuit}
        customTrackId={customTrackId}
        onSelectCustom={onSelectCustom}
        sub={quickSub}
        onSub={setQuickSub}
        account={account}
        onShop={onShop}
        rank={rank}
        onRank={onRank}
        onWorkshop={openWorkshopTab}
      />}
      {tab === 'online' && <OnlineTab
        garage={garages.online}
        onGarage={(g) => onGarage('online', g)}
        online={onHostGame && onJoinGame && onQuickGame ? {
          busy: mpBusy,
          error: mpError,
          onHost: onHostGame,
          onJoin: onJoinGame,
          onQuick: onQuickGame,
          searching,
          windows,
          onCancelSearch: props.onCancelSearch,
          rejoin,
          onRejoin: props.onRejoin,
          onDismissRejoin: props.onDismissRejoin,
        } : undefined}
        account={account}
        onShop={onShop}
        rank={rank}
        onRank={onRank}
      />}
      {tab === 'infinity' && <InfinityTab
        garage={garages.infinity}
        onGarage={(g) => onGarage('infinity', g)}
        account={account}
        onShop={onShop}
        rank={rank}
        onRank={onRank}
      />}
      {tab === 'workshop' && <WorkshopTab
        onOpenEditor={onWorkshop ?? (() => undefined)}
        onBrowseCommunity={browseCommunity}
        newTrackOpen={newTrackOpen}
        onNewTrackClose={() => setNewTrackOpen(false)}
      />}
    </main>

    <footer className="fit-actions home-actions">
      <p className="home-hint">{primary.hint}</p>
      <button className="button-primary launch-button" onClick={primary.onClick} disabled={primary.disabled}>
        {primary.locked && <LockKeyhole size={17} aria-hidden="true" />}{primary.label}<ArrowRight size={20} aria-hidden="true" />
      </button>
    </footer>
    <nav className="pane-tabs" aria-label="Sections">{paneIds.map((id, i) => <button key={id} className={pane === id ? 'selected' : ''} aria-pressed={pane === id} onClick={() => setPane(id)}>{panes[i]}</button>)}</nav>
    {import.meta.env.DEV && dialog === 'lab' && <PhysicsLab onClose={() => setDialog(null)} />}
    {dialog === 'rules' && <RulesDialog onClose={() => setDialog(null)} />}
  </div>;
}
