import * as storage from './game/storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import SetupScreen from './components/SetupScreen';
import RaceScreen, { RaceAction } from './components/RaceScreen';
import ChampionshipScreen from './components/ChampionshipScreen';
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
import { loadStory } from './game/story/state';

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

type Phase = 'menu' | 'retune' | 'hub' | 'race' | 'quick' | 'story';

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
  // A story counts as "to continue" once it has progress and the finale has not been played out yet.
  // Re-read whenever the garage is shown, so leaving story mode updates the button.
  const storyInProgress = useMemo(() => {
    if (phase !== 'menu') return false;
    const saved = loadStory();
    return !!saved && saved.finishedAt === null && (saved.chapter > 1 || saved.heat > 0 || saved.seenScenes.length > 0);
  }, [phase]);
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
        storyInProgress={storyInProgress}
      />
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
