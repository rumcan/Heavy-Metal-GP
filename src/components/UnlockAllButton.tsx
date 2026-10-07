// The one "Unlock everything" button (src/game/premium.ts): about a dollar of RUN Bits opens every skill, cosmetic,
// talent tier and story chapter. RUN shows its own confirmation (and a top-up when the player is short). Once owned it
// is a small badge.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useBitsIcon } from './useBitsIcon';
import { Check, Sparkles } from 'lucide-react';
import { UNLOCK_ALL_PRICE_BITS, buyUnlockAll, onUnlockAll, unlockAllOwned } from '../game/premium';
import { raceAudio } from '../game/audio';
import '../premium.css';

export default function UnlockAllButton() {
  const owned = useSyncExternalStore((fn) => onUnlockAll(fn), unlockAllOwned, unlockAllOwned);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const icon = useBitsIcon();
  useEffect(() => { if (!note) return; const id = window.setTimeout(() => setNote(null), 4000); return () => window.clearTimeout(id); }, [note]);

  if (owned) return <span className="unlock-all owned" title="Every skill, cosmetic, talent tier and story chapter is yours"><Check size={13} />Everything unlocked</span>;

  const buy = async () => {
    if (busy) return;
    setBusy(true);
    const result = await buyUnlockAll();
    setBusy(false);
    if (result === 'unlocked') { raceAudio.ui('unlock'); setNote('Everything is unlocked. Enjoy!'); }
    else if (result === 'unavailable') setNote('The unlock is not available here yet.');
    else if (result === 'error') setNote('Something went wrong. Nothing was charged; try again.');
  };

  return (
    <span className="unlock-all-wrap">
      <button
        type="button"
        className="unlock-all"
        onClick={buy}
        disabled={busy}
        data-sound="none"
        title="Unlock every skill, every ball cosmetic, every talent tier and every story chapter now, for good"
        aria-label={`Unlock everything for ${UNLOCK_ALL_PRICE_BITS} RUN Bits`}
      >
        <Sparkles size={13} />
        <span className="unlock-all-label">Unlock everything</span>
        <span className="unlock-all-price">{icon ? <img src={icon} alt="" /> : null}{UNLOCK_ALL_PRICE_BITS}{icon ? '' : ' Bits'}</span>
      </button>
      {note && <span className="unlock-all-note" role="status">{note}</span>}
    </span>
  );
}
