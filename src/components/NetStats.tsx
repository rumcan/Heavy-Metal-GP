import { useEffect, useState } from 'react';
import type { NetStats as NetStatsValue, RaceSession } from '../net/session';

interface Props {
  session: RaceSession | null;
}

/** F8: a hidden network readout for online races (guest side), to diagnose freezes and catch-ups. */
export default function NetStats({ session }: Props) {
  const [visible, setVisible] = useState(false);
  const [stats, setStats] = useState<NetStatsValue | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F8') {
        e.preventDefault();
        setVisible((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const poll = () => {
      setStats(session?.netStats() ?? null);
    };
    poll();
    const id = setInterval(poll, 250);
    return () => clearInterval(id);
  }, [visible, session]);

  if (!visible) return null;

  const lagStr = stats && isFinite(stats.lagMs) ? String(Math.round(stats.lagMs)) : '-';
  const red = (bad: boolean) => (bad ? { color: '#ef4444' } : undefined);

  return (
    <div style={{
      position: 'fixed',
      bottom: 16,
      left: 16,
      fontFamily: 'monospace',
      fontSize: 13,
      lineHeight: 1.6,
      color: '#e2e8f0',
      background: 'rgba(15, 23, 42, 0.85)',
      padding: '8px 12px',
      borderRadius: 6,
      pointerEvents: 'none',
      zIndex: 9999,
    }}>
      {stats ? (
        <>
          <div style={red(stats.lagMs > 300)}>lag: {lagStr} ms</div>
          <div>buffered: {stats.buffered}</div>
          <div>jitter: {stats.jitterMs} ms</div>
          <div style={red(stats.maxGapMs > 300)}>max gap: {stats.maxGapMs} ms</div>
          <div>resyncs: {stats.resyncs}</div>
        </>
      ) : (
        <div>HOST (no stats)</div>
      )}
    </div>
  );
}
