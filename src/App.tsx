import * as storage from './game/storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import SetupScreen from './components/SetupScreen';
import RaceScreen, { RaceAction } from './components/RaceScreen';
import ChampionshipScreen from './components/ChampionshipScreen';
import OnlineLobby from './components/OnlineLobby';
import type { OnlineRaceStart } from './components/OnlineLobby';
import type { OnlineRace } from './components/RaceScreen';
import {
  createRoom,
  isAccessDenied,
  isMatchmakeWindowExpired,
  isOfflineMockRealtime,
  joinRoomByCode,
  NO_ROOM_SERVER_MESSAGE,
  promptLogin,
  quickMatch,
  writeActiveMatch,
  type RaceRoom,
} from './net/transport';
import { Matchmaker } from './net/matchmake';
import type { RaceProtocol } from './net/transport';
import type { RaceLink } from './net/session';
import { circuitIndexOf, gridOrderOf, rosterOf } from './net/lobby';
import type { SeatGarage } from './net/lobby';
import { MarbleInfo, MarbleStats, AI_COLORS, randomStats, mulberry32, PLAYER_COLORS, HeatResult, HEATS_PER_GP } from './game/types';
import { SeasonState, newSeason, recordHeat, gridOrder, gpSeed, CALENDAR, saveSeason, loadSeason } from './game/season';
import { loadAccount, saveAccount, purchaseItem, settleRace } from './game/economy';
import type { RacerAccount, RacePayout } from './game/economy';
import type { Inventory, ItemType } from './game/types';
import PitShop from './components/PitShop';
import { RIVALS, PLAYER_PORTRAIT_COUNT, preRaceBanter } from './game/characters';
import type { Line } from './game/characters';
import LoadingScreen from './components/LoadingScreen';
import StoryMode from './components/story/StoryMode';

const PORTRAIT_KEY = 'heavy-metal-gp:portrait';
function loadPortrait(): number {
  try { const n = Number(storage.getItem(PORTRAIT_KEY)); return Number.isInteger(n) && n >= 0 && n < PLAYER_PORTRAIT_COUNT ? n : 0; } catch { return 0; }
}
interface Loading { eyebrow: string; title: string; cta: string; banter?: Line[]; next: Phase }

function makeRivals(seed: number): MarbleInfo[] {
  const rng = mulberry32(seed);
  const pool = RIVALS.map((_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return AI_COLORS.map((color, i) => ({
    id: i + 1,
    name: RIVALS[pool[i]].name,
    character: pool[i],
    color,
    stats: randomStats(rng),
    isPlayer: false,
  }));
}

type Phase = 'menu' | 'retune' | 'hub' | 'race' | 'quick' | 'story' | 'lobby' | 'online';

export default function App() {
  const [phase, setPhase] = useState<Phase>('menu');
  const [loading, setLoading] = useState<Loading | null>({ eyebrow: 'SMALL GOBLINS. BIG BALLS. BIGGER DREAMS.', title: 'WELCOME TO THE GRID', cta: 'Enter the paddock', next: 'menu' });
  const [portrait, setPortrait] = useState(loadPortrait);
  useEffect(() => { try { storage.setItem(PORTRAIT_KEY, String(portrait)); } catch { /* storage unavailable */ } }, [portrait]);
  const [stats, setStats] = useState<MarbleStats>({ weight: 5, speed: 5, bounce: 5 });
  const [color, setColor] = useState(PLAYER_COLORS[0]);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 0xffffffff));
  const [rivalSeed, setRivalSeed] = useState(() => Math.floor(Math.random() * 0xffffffff));
  const [raceKey, setRaceKey] = useState(0);
  const [circuitIndex, setCircuitIndex] = useState(0);
  const [season, setSeason] = useState<SeasonState | null>(() => loadSeason());
  const [account, setAccount] = useState(loadAccount);
  const accountRef = useRef(account);
  const [shopOpen, setShopOpen] = useState(false);
  const [raceId, setRaceId] = useState('');
  const [payout, setPayout] = useState<RacePayout | null>(null);

  // ---- online (MP-06) -----------------------------------------------------
  // The room lives here, not in a screen: a lobby, a race and the next race are
  // three screens on one socket, and the socket has to outlive all of them.
  const [room, setRoom] = useState<RaceRoom | null>(null);
  const [online, setOnline] = useState<OnlineRaceStart | null>(null);
  const [mpBusy, setMpBusy] = useState(false);
  const [mpError, setMpError] = useState<string | null>(null);
  /** MP-07: a quick-match search, and how many windows it has burned through. */
  const [search, setSearch] = useState<{ windows: number } | null>(null);
  const searchRef = useRef<Matchmaker<RaceRoom> | null>(null);
  /** True when this lobby came from matchmaking rather than a typed code. */
  const [quick, setQuick] = useState(false);
  /**
   * The room, as the screens see it: intents go out through `send`, frames come
   * in through `onMessage`/`onPlayerLeft`, and whichever screen is live is the
   * one that has registered itself. The room is subscribed ONCE, below.
   */
  const link = useMemo<RaceLink>(() => ({ send: (msg: RaceProtocol) => room?.send(msg), onMessage: null, onPlayerLeft: null }), [room]);

  useEffect(() => {
    if (!room) return;
    room.on({
      onMessage: (msg) => link.onMessage?.(msg),
      onPlayerLeft: (id) => link.onPlayerLeft?.(id),
      onError: (message) => setMpError(message),
      onDisconnect: () => setMpError('Lost the room — trying to get back in.'),
      onReconnected: () => setMpError(null),
    });
    // Unmounting (leaving the lobby, closing the tab) drops the room rather
    // than leaving a live socket — and a live seat — behind.
    return () => { room.leave(); void writeActiveMatch(null); };
  }, [room, link]);

  /** This driver's garage: the tune from the garage panes, plus the livery. */
  const garage = useMemo<SeatGarage>(
    () => ({ name: room?.players.find((p) => p.id === room.playerId)?.username || 'You', color, stats, portrait }),
    [room, color, stats, portrait],
  );

  /** Why a room did not open, in words a player can act on. */
  const explain = useCallback(async (err: unknown): Promise<string> => {
    if (isAccessDenied(err)) {
      // Anonymous: the platform's login sheet, and the AI is still there to race.
      const { success } = await promptLogin();
      return success ? 'Signed in — press Host, Join or Quick race again.' : 'Multiplayer needs a signed-in RUN.world account.';
    }
    return err instanceof Error ? err.message : String(err);
  }, []);

  const openRoom = useCallback(async (action: () => Promise<RaceRoom>) => {
    if (isOfflineMockRealtime()) { setMpError(NO_ROOM_SERVER_MESSAGE); return; }
    setMpBusy(true);
    setMpError(null);
    try {
      const next = await action();
      // The rejoin memo (MP-08): a drop is precisely the case that CANNOT clear
      // it, which is what lets a return offer the same race back.
      void writeActiveMatch({ roomCode: next.roomCode, at: Date.now() });
      setQuick(false);
      setRoom(next);
      setPhase('lobby');
    } catch (err) {
      setMpError(await explain(err));
    } finally {
      setMpBusy(false);
    }
  }, [explain]);

  /**
   * MP-07: QUICK RACE. One SDK request is one thirty-second window, so the loop
   * lives here — press the button, be in a race when somebody else presses it.
   */
  const findRace = useCallback(async () => {
    if (isOfflineMockRealtime()) { setMpError(NO_ROOM_SERVER_MESSAGE); return; }
    setMpError(null);
    setMpBusy(true);
    setSearch({ windows: 0 });
    const matchmaker = new Matchmaker<RaceRoom>({
      request: () => quickMatch(),
      isExpired: isMatchmakeWindowExpired,
      onWindowClosed: (windows) => setSearch({ windows }),
      // Paired on the way out: nobody is waiting in it, so leave it rather than
      // hold a seat in a room nobody can see.
      abandon: (room) => room.leave(),
    });
    searchRef.current = matchmaker;
    try {
      const next = await matchmaker.find();
      if (next) {
        void writeActiveMatch({ roomCode: next.roomCode, at: Date.now() });
        setQuick(true);
        setRoom(next);
        setPhase('lobby');
      } else {
        setMpError('Search cancelled — nobody was paired.');
      }
    } catch (err) {
      setMpError(await explain(err));
    } finally {
      setMpBusy(false);
      setSearch(null);
      searchRef.current = null;
    }
  }, [explain]);

  const cancelSearch = useCallback(() => searchRef.current?.cancel(), []);

  const leaveRoom = useCallback(() => {
    setRoom(null);
    setOnline(null);
    setQuick(false);
    setMpError(null);
    setPhase('menu');
  }, []);

  const startOnlineRace = useCallback((race: OnlineRaceStart) => {
    setOnline(race);
    setPayout(null);
    setRaceKey((k) => k + 1);
    setPhase('online');
  }, []);

  const onlineView = useMemo<OnlineRace | null>(
    () => (online ? { seats: online.seats, settings: online.settings, localSeat: online.localSeat, isHost: online.isHost, countdownAt: online.countdownAt, link } : null),
    [online, link],
  );
  const onlineRoster = useMemo(() => (online ? rosterOf(online.seats, online.localSeat) : []), [online]);
  const onlineGrid = useMemo(() => (online ? gridOrderOf(online.seats) : []), [online]);

  const publishAccount = useCallback((next: RacerAccount) => {
    accountRef.current = next;
    saveAccount(next);
    setAccount(next);
  }, []);
  useEffect(() => saveAccount(accountRef.current), []);
  const buy = useCallback((item: ItemType) => {
    const result = purchaseItem(accountRef.current, item);
    if (!result.error) publishAccount(result.account);
    return result.error;
  }, [publishAccount]);
  const inventoryChanged = useCallback((inventory: Inventory) => {
    publishAccount({ ...accountRef.current, inventory: { ...inventory } });
  }, [publishAccount]);
  const awardWinnings = (results: HeatResult[]) => {
    const result = results.find((r) => r.id === 0);
    if (!result) return;
    const paid = settleRace(accountRef.current, raceId, result);
    publishAccount(paid.account);
    setPayout(paid.payout);
  };
  const openShop = () => setShopOpen(true);
  const withShop = (screen: ReactNode) => <>{screen}{shopOpen && <PitShop account={account} onBuy={buy} onClose={() => setShopOpen(false)} />}</>;
  const launchQuickRace = () => {
    setRaceId(`quick:${crypto.randomUUID()}`);
    setPayout(null);
    setRaceKey((k) => k + 1);
    const circuit = CALENDAR[circuitIndex];
    setLoading({ eyebrow: 'QUICK RACE / SINGLE HEAT', title: circuit.name.toUpperCase(), cta: 'Lights out', banter: preRaceBanter(quickRoster, Math.random), next: 'quick' });
  };

  useEffect(() => saveSeason(season), [season]);

  const rivals = useMemo(() => makeRivals(rivalSeed), [rivalSeed]);
  const quickRoster = useMemo<MarbleInfo[]>(() => [{ id: 0, name: 'You', color, stats, isPlayer: true, character: portrait }, ...rivals], [rivals, color, stats, portrait]);
  const quickGrid = useMemo(() => quickRoster.map((m) => m.id), [quickRoster]);
  const newSeed = useCallback(() => setSeed(Math.floor(Math.random() * 0xffffffff)), []);

  // ---- season helpers ----
  const startSeason = () => {
    if (season && !season.complete && season.results.some((gp) => gp.length) && !window.confirm('Start a new championship? This replaces your saved season.')) return;
    const s = newSeason(quickRoster);
    setSeason(s);
    setPhase('hub');
  };

  const seasonRoster = useMemo<MarbleInfo[]>(() => {
    if (!season) return [];
    return season.roster.map((m) => (m.isPlayer ? { ...m, stats, color, character: portrait } : m));
  }, [season, stats, color, portrait]);

  // sync player tune into the saved season roster when returning from retune
  const lockSetup = () => {
    if (season) setSeason({ ...season, roster: season.roster.map((m) => (m.isPlayer ? { ...m, stats, color } : m)) });
    setPhase('hub');
  };

  const enterSeason = (s: SeasonState) => {
    const me = s.roster.find((m) => m.isPlayer);
    if (me) {
      setStats(me.stats);
      setColor(me.color);
    }
    setSeason(s);
    setPhase('hub');
  };

  const seasonGrid = useMemo(() => (season && !season.complete ? gridOrder(season) : []), [season]);

  const [pendingResult, setPendingResult] = useState<HeatResult[] | null>(null);
  const onHeatFinished = (results: HeatResult[]) => {
    awardWinnings(results);
    setPendingResult(results);
    // Persist immediately, without replacing the active race's immutable roster or track.
    if (season) saveSeason(recordHeat(season, results));
  };
  const commitHeat = () => {
    if (season && pendingResult) {
      setSeason(recordHeat(season, pendingResult));
      setPendingResult(null);
    }
    setPhase('hub');
  };

  // ---- render ----
  if (loading) {
    const done = loading;
    return <LoadingScreen key={`${done.next}:${raceKey}`} eyebrow={done.eyebrow} title={done.title} cta={done.cta} banter={done.banter} onContinue={() => { setPhase(done.next); setLoading(null); }} />;
  }
  if (phase === 'menu' || phase === 'retune') {
    return withShop(
      <SetupScreen
        stats={stats}
        onStats={setStats}
        color={color}
        onColor={setColor}
        rivals={phase === 'retune' && season ? season.roster.filter((m) => !m.isPlayer) : rivals}
        onRerollRivals={() => setRivalSeed(Math.floor(Math.random() * 0xffffffff))}
        seed={seed}
        onNewSeed={newSeed}
        onStart={launchQuickRace}
        onStartSeason={startSeason}
        onContinueSeason={season && phase === 'menu' ? () => enterSeason(season) : undefined}
        seasonMode={phase === 'retune'}
        onBackToSeason={lockSetup}
        circuitIndex={circuitIndex}
        onCircuit={setCircuitIndex}
        account={account}
        onShop={openShop}
        portrait={portrait}
        onPortrait={setPortrait}
        onStartStory={() => setPhase('story')}
        mpBusy={mpBusy}
        mpError={mpError}
        onHostGame={() => void openRoom(createRoom)}
        onJoinGame={(code) => void openRoom(() => joinRoomByCode(code))}
        onQuickGame={() => void findRace()}
        searching={search !== null}
        windows={search?.windows ?? 0}
        onCancelSearch={cancelSearch}
      />
    );
  }

  // Online lobby (MP-06): the room the host opened, seen from either end.
  if (phase === 'lobby' && room) {
    return withShop(
      <OnlineLobby
        room={room}
        garage={garage}
        circuitIndex={circuitIndex}
        onCircuit={setCircuitIndex}
        onLeave={leaveRoom}
        onStart={startOnlineRace}
        link={link}
        autoStart={quick}
        error={mpError}
        onError={setMpError}
      />,
    );
  }

  // Story mode owns its own save, season and flow (ST-08); it only shares the wallet.
  if (phase === 'story') {
    return withShop(
      <StoryMode
        driver={{ name: 'Sprocket', color, portrait, stats }}
        account={account}
        onAccount={publishAccount}
        onShop={openShop}
        onExit={() => setPhase('menu')}
      />
    );
  }

  if (phase === 'hub' && season) {
    return withShop(
      <ChampionshipScreen
        season={season}
        onStartHeat={() => {
          setRaceId(`champ:${season.seed}:${season.round}:${season.results[season.round].length}`);
          setPayout(null);
          setRaceKey((k) => k + 1);
          const heatNo = season.results[season.round].length + 1;
          setLoading({ eyebrow: `ROUND ${String(season.round + 1).padStart(2, '0')} / HEAT ${heatNo} OF ${HEATS_PER_GP}`, title: CALENDAR[season.round].name.toUpperCase(), cta: 'Lights out', banter: preRaceBanter(seasonRoster, Math.random), next: 'race' });
        }}
        onRetune={() => { setCircuitIndex(season.round); setPhase('retune'); }}
        onAbandon={() => setPhase('menu')}
        onNewSeason={startSeason}
        account={account}
        onShop={openShop}
      />
    );
  }

  if (phase === 'race' && season) {
    const gp = CALENDAR[season.round];
    const heatNo = (season.results[season.round]?.length ?? 0) + 1;
    const isLastHeat = heatNo === HEATS_PER_GP;
    const actions: RaceAction[] = [
      { label: isLastHeat ? 'View Grand Prix results' : 'Standings & next heat', onClick: commitHeat, primary: true },
    ];
    return withShop(
      <RaceScreen
        key={raceKey}
        seed={gpSeed(season.seed, season.round)}
        roster={seasonRoster}
        profile={gp.profile}
        gridOrder={seasonGrid}
        title={gp.name}
        subtitle={`ROUND ${String(season.round + 1).padStart(2, '0')} / HEAT ${heatNo} OF ${HEATS_PER_GP}`}
        championship
        onExit={() => {
          setPendingResult(null);
          setPhase('hub');
        }}
        onFinished={onHeatFinished}
        actions={actions}
        inventory={account.inventory}
        credits={account.credits}
        onInventoryChange={inventoryChanged}
        payout={payout}
        onShop={openShop}
      />
    );
  }

  // online race (MP-06): the same screen, driven by a `RaceSession` instead of
  // its own `Game`. The host simulates and publishes; a guest draws the frames.
  if (phase === 'online' && online && onlineView) {
    const gp = CALENDAR[circuitIndexOf(online.settings)] ?? CALENDAR[0];
    const drivers = online.seats.filter((s) => !s.isAI).length;
    return withShop(
      <RaceScreen
        key={raceKey}
        seed={online.seed}
        roster={onlineRoster}
        profile={gp.profile}
        gridOrder={onlineGrid}
        title={gp.name}
        subtitle={`ONLINE / ${online.isHost ? 'HOSTING' : 'JOINED'} / ${drivers} DRIVERS`}
        onExit={leaveRoom}
        // MP-09 pays an online race out; until then there is nothing to settle.
        onFinished={() => {}}
        actions={[{ label: 'Back to the garage', onClick: leaveRoom, primary: true }]}
        inventory={account.inventory}
        credits={account.credits}
        onInventoryChange={inventoryChanged}
        payout={null}
        onShop={openShop}
        online={onlineView}
      />,
    );
  }

  // quick race
  const quickActions: RaceAction[] = [
    { label: 'Race again', onClick: launchQuickRace, primary: true },
    {
      label: 'New layout',
      onClick: () => {
        newSeed();
        launchQuickRace();
      },
    },
    { label: 'Back to garage', onClick: () => setPhase('menu') },
  ];
  return withShop(
    <RaceScreen
      key={raceKey}
      seed={seed}
      roster={quickRoster}
      profile={CALENDAR[circuitIndex].profile}
      gridOrder={quickGrid}
      title={CALENDAR[circuitIndex].name}
      subtitle="QUICK RACE / SINGLE HEAT"
      onExit={() => setPhase('menu')}
      onFinished={awardWinnings}
      actions={quickActions}
      inventory={account.inventory}
      credits={account.credits}
      onInventoryChange={inventoryChanged}
      payout={payout}
      onShop={openShop}
    />
  );
}
