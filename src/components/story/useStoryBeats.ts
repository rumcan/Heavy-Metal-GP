import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Line, StoryBeat } from '../../game/story/types';

export interface ActiveBeat {
  line: Line;
  atSector: number;
  dismiss: () => void;
}

/**
 * Queue of mid-race story beats (ST-03/ST-07). Beats are handed over one at a time as the player's
 * sector index reaches them, and stay queued — never replayed — for the rest of the heat.
 */
export function useStoryBeats(
  beats: readonly StoryBeat[] | undefined,
  sectorIndex: number,
  live: boolean,
): ActiveBeat | null {
  const [active, setActive] = useState<StoryBeat | null>(null);
  const cursor = useRef(0);
  // Identity of the beat list: a new heat (or a new chapter) restarts the queue.
  const signature = (beats ?? []).map((beat) => `${beat.atSector}:${beat.line.who}:${beat.line.text}`).join('|');
  const ordered = useMemo(() => [...(beats ?? [])].sort((a, b) => a.atSector - b.atSector), [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    cursor.current = 0;
    setActive(null);
  }, [signature]);

  useEffect(() => {
    if (!live || active) return;
    const beat = ordered[cursor.current];
    if (!beat || sectorIndex < beat.atSector) return;
    cursor.current += 1;
    setActive(beat);
  }, [ordered, sectorIndex, live, active]);

  const dismiss = useCallback(() => setActive(null), []);
  return active ? { line: active.line, atSector: active.atSector, dismiss } : null;
}
