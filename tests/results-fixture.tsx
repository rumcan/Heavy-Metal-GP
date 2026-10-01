/** Isolated, deterministic review fixture. No engine, room, or production route changes. */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import '../src/powerups.css';
import '../src/layout.css';
import '../src/kit.css';
import RaceResults from '../src/components/RaceResults';
import LoadoutPreview from '../src/components/LoadoutPreview';
import PitShop from '../src/components/PitShop';
import { RIVALS } from '../src/game/characters';
import { emptyInventory, ITEM_TYPES, teamOf } from '../src/game/types';
import type { MarbleInfo } from '../src/game/types';
import { createAccount, loadAccount, purchaseItem, saveAccount, settleRace } from '../src/game/economy';

const params = new URLSearchParams(location.search);
const place = Math.max(1, Math.min(10, Number(params.get('rank')) || 7));
const roster: MarbleInfo[] = Array.from({ length: 10 }, (_, id) => ({
  id, name: id === 0 ? 'Sprocket' : RIVALS[id - 1].name + (params.has('longNames') ? ' the Unreasonably Fast Goblin' : ''),
  character: id === 0 ? 3 : id - 1, color: teamOf(id).color, stats: { weight: 5, speed: 5, bounce: 5 }, isPlayer: id === 0,
}));
const order = roster.filter((m) => !m.isPlayer).map((m) => m.id);
order.splice(place - 1, 0, 0);
const results = order.map((id, i) => ({ id, rank: i + 1, time: params.has('dnf') && id === 0 ? null : 25_240 + i * 2640, pegs: id === 0 ? 8 : (i * 7) % 11 }));
const startKit = { ...emptyInventory(), rocket: 1, jump: 2, oil: 1 };
const endKit = { ...startKit, rocket: 3, jump: 1, freeze: 2 };
if (params.has('empty')) Object.assign(endKit, startKit);
if (params.has('allSkills')) for (const item of ITEM_TYPES) { startKit[item] = 0; endKit[item] = 9; }
const initial = { ...createAccount(), inventory: endKit, trophies: { ...emptyInventory(), rocket: 14, freeze: 5 } };
const { account, payout } = settleRace(initial, `p2-05-fixture:${place}:${params.toString()}`, results.find((r) => r.id === 0)!);
saveAccount(account);

function Fixture() {
  const [garage, setGarage] = useState(params.has('garage'));
  const [iteration, setIteration] = useState(0);
  const [shopOpen, setShopOpen] = useState(false);
  const [currentAccount, setCurrentAccount] = useState(account);
  const buy = (item: typeof ITEM_TYPES[number]) => {
    const bought = purchaseItem(loadAccount(), item);
    if (!bought.error) { saveAccount(bought.account); setCurrentAccount(bought.account); }
    return bought.error;
  };
  return <>
    {garage ? <div className="app-shell fit-shell garage-page" data-pane="driver">
      <header className="app-header"><h1 style={{ fontSize: 22, margin: 0 }}>Garage / Sprocket</h1></header>
      <main className="fit-main garage-fit" style={{ gridTemplateColumns: 'minmax(0, 420px)', justifyContent: 'center' }}>
        <section className="fit-pane tuning-panel" data-pane-id="driver"><h2>Your haul, back home</h2><LoadoutPreview inventory={currentAccount.inventory} onShop={() => setShopOpen(true)} /></section>
      </main>
      <footer className="fit-actions"><button className="button-primary" onClick={() => { setIteration((i) => i + 1); setGarage(false); }}>Back to results</button></footer>
    </div> : <RaceResults key={iteration} results={results} roster={roster} title="Marblehurst Grand Prix" subtitle="ROUND 01 / HEAT 1 OF 3" championship={!params.has('single')}
      payout={payout} credits={currentAccount.credits} startKit={startKit} endKit={endKit} onShop={() => setShopOpen(true)}
      actions={[{ label: 'Back to the garage', primary: true, onClick: () => setGarage(true) }, { label: 'Race again', onClick: () => { document.title = 'Race again verified'; } }]} />}
    {shopOpen && <PitShop account={loadAccount()} onBuy={buy} onClose={() => setShopOpen(false)} />}
  </>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
