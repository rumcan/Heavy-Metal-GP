/**
 * MB-06. Small static preview for My tracks — like CircuitPreview but instant.
 *
 * Builds the track from the def and draws a vertical strip:
 * - Track height scaled to thumbnail height, width to W
 * - Segments alternating, start/finish, pieces as dots coloured by type
 * - No physics, no animation — one canvas paint, cheap for a list
 */
import { useEffect, useRef } from 'react';
import { buildTrackFromDef } from '../../game/trackdef';
import { W } from '../../game/track';
import type { TrackDef } from '../../game/trackdef';

const THUMB_W = 96;
const THUMB_H = 108;

const PIECE_COLOR: Record<string, string> = {
  ramp: '#d8e0e6', ice: '#8ec8ff', curve: '#d8e0e6', loop: '#ff9a76', hoop: '#7ddf90',
  wrecker: '#f59e0b', pad: '#a78bfa', boost: '#f87171', spinner: '#facc15',
  breakable: '#f97316', peg: '#60a5fa', ppeg: '#a78bfa', itembox: '#fbbf24',
  bucket: '#34d399', wall: '#64748b', block: '#94a3b8',
};

export default function TrackThumbnail({ def, onClick }: { def: TrackDef; onClick?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(devicePixelRatio ?? 1, 2);
    canvas.width = THUMB_W * dpr;
    canvas.height = THUMB_H * dpr;
    canvas.style.width = `${THUMB_W}px`;
    canvas.style.height = `${THUMB_H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, THUMB_W, THUMB_H);

    // Background
    ctx.fillStyle = '#0e131a';
    ctx.fillRect(0, 0, THUMB_W, THUMB_H);

    let track = null;
    try { track = buildTrackFromDef(def); } catch { track = null; }
    if (!track) {
      ctx.fillStyle = '#5f6d7c';
      ctx.font = '7px var(--mono)';
      ctx.textAlign = 'center';
      ctx.fillText('No preview', THUMB_W / 2, THUMB_H / 2);
      return;
    }

    const h = track.height || def.height;
    const scaleY = (THUMB_H - 8) / Math.max(1, h);
    const scaleX = (THUMB_W - 16) / W;
    const ox = 8;

    // Segments
    if (track.segments?.length) {
      for (let i = 0; i < track.segments.length; i++) {
        const s = track.segments[i];
        const y = 4 + s.y * scaleY;
        const sh = Math.max(1, s.h * scaleY);
        ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)';
        ctx.fillRect(ox, y, THUMB_W - 16, sh);
      }
    }

    // Finish line
    const fy = 4 + track.finishY * scaleY;
    ctx.strokeStyle = '#f2f5fa';
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(ox, fy);
    ctx.lineTo(THUMB_W - 8, fy);
    ctx.stroke();
    ctx.setLineDash([]);

    // Pieces
    for (const p of def.pieces) {
      let x = W / 2, y = h / 2;
      switch (p.t) {
        case 'ramp': case 'ice': { x = (p.a[0] + p.b[0]) / 2; y = (p.a[1] + p.b[1]) / 2; break; }
        case 'curve': { x = (p.a[0] + p.c[0] + p.b[0]) / 3; y = (p.a[1] + p.c[1] + p.b[1]) / 3; break; }
        case 'loop': { x = p.x; y = p.bottom - p.r; break; }
        case 'wrecker': { x = p.pivot[0]; y = p.pivot[1] + p.chain / 2; break; }
        case 'bucket': { x = W / 2; y = p.y; break; }
        default: { const q = p as { x?: number; y?: number }; if (q.x !== undefined) x = q.x; if (q.y !== undefined) y = q.y; break; }
      }
      const sx = ox + x * scaleX;
      const sy = 4 + y * scaleY;
      if (sy < 2 || sy > THUMB_H - 2) continue;
      ctx.fillStyle = PIECE_COLOR[p.t] ?? '#c3cdd7';
      ctx.beginPath();
      // differentiate by type
      if (p.t === 'loop') ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
      else if (p.t === 'peg' || p.t === 'ppeg') ctx.arc(sx, sy, 2, 0, Math.PI * 2);
      else if (p.t === 'wall' || p.t === 'block') ctx.rect(sx - 3, sy - 1.5, 6, 3);
      else ctx.arc(sx, sy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Border
    ctx.strokeStyle = '#1e2936';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, THUMB_W - 1, THUMB_H - 1);
  }, [def]);

  return <canvas ref={ref} width={THUMB_W} height={THUMB_H} onClick={onClick} className="track-thumb" role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} aria-label={onClick ? `Load ${def.name}` : `Preview of ${def.name}`} />;
}
