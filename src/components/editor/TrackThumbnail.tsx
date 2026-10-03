/**
 * MB-06. Small static preview for My tracks — like CircuitPreview but instant.
 *
 * Builds the track from the def and draws a vertical strip:
 * - Track height scaled to thumbnail height, width to W
 * - Segments alternating, start/finish, pieces as dots coloured by type
 * - No physics, no animation — one canvas paint, cheap for a list
 *
 * `wide` draws the same thing as a long, low strip instead: a platformer course's three lanes run left to right
 * (P2-22), so My tracks can show one the way it is raced. A classic circuit in a wide box is its vertical preview,
 * just squatter.
 */
import { useEffect, useRef } from 'react';
import { buildTrackFromDef } from '../../game/trackdef';
import { W } from '../../game/track';
import { isPlatformerDef, planFromTrackDef } from '../../game/platformer/def';
import type { Piece, TrackDef } from '../../game/trackdef';

const THUMB_W = 96;
const THUMB_H = 108;
/** A platformer course is long and low: the same drawing, sideways, under a row's name. */
const WIDE_W = 176;
const WIDE_H = 54;

/** Where a piece stands on a platformer course: floors are drawn as lines, everything else as a dot. */
function pieceSpot(p: Piece): { x: number; y: number } | null {
  if (p.t === 'ramp' || p.t === 'ice' || p.t === 'curve') return null;
  if (p.t === 'wrecker') return { x: p.pivot[0], y: p.pivot[1] + p.chain };
  const q = p as { x?: number; y?: number; bottom?: number; a?: [number, number]; b?: [number, number] };
  if (q.a && q.b) return { x: (q.a[0] + q.b[0]) / 2, y: (q.a[1] + q.b[1]) / 2 };
  if (q.x !== undefined) return { x: q.x, y: q.bottom ?? q.y ?? 0 };
  return null;
}

const PIECE_COLOR: Record<string, string> = {
  ramp: '#d8e0e6', ice: '#8ec8ff', curve: '#d8e0e6', loop: '#ff9a76', hoop: '#7ddf90',
  wrecker: '#f59e0b', pad: '#a78bfa', boost: '#f87171', spinner: '#facc15',
  breakable: '#f97316', peg: '#60a5fa', ppeg: '#a78bfa', itembox: '#fbbf24',
  bucket: '#34d399', wall: '#64748b', block: '#94a3b8',
};

export default function TrackThumbnail({ def, onClick, wide }: { def: TrackDef; onClick?: () => void; wide?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const boxW = wide ? WIDE_W : THUMB_W;
  const boxH = wide ? WIDE_H : THUMB_H;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = boxW, h = boxH;
    const dpr = Math.min(devicePixelRatio ?? 1, 2);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#0e131a';
    ctx.fillRect(0, 0, w, h);

    // P2-22: a platformer course is drawn sideways: each lane's floors across the thumbnail.
    if (isPlatformerDef(def)) {
      const plan = planFromTrackDef(def);
      let top = Infinity, bottom = -Infinity;
      for (const f of plan.floors) { top = Math.min(top, f.y0, f.y1); bottom = Math.max(bottom, f.y0, f.y1); }
      const k = (w - 12) / Math.max(1, plan.width), ky = Math.min(k * 3, (h - 16) / Math.max(1, bottom - top));
      const oy = h / 2 - ((top + bottom) / 2) * ky;
      const px = (x: number) => 6 + x * k;
      const py = (y: number) => oy + y * ky;
      ctx.lineWidth = 1.5;
      for (const lane of [0, 1, 2] as const) {
        ctx.strokeStyle = ['#4c6a86', '#d8e0e6', '#e4b86a'][lane];
        ctx.beginPath();
        for (const f of plan.floors) if (f.lane === lane) { ctx.moveTo(px(f.x0), py(f.y0)); ctx.lineTo(px(f.x1), py(f.y1)); }
        ctx.stroke();
      }
      // What stands on the floors: springs, crates, gates, boxes, boosts, wreckers, loops and bridges.
      for (const p of def.pieces) {
        const spot = pieceSpot(p);
        if (!spot) continue;
        ctx.fillStyle = PIECE_COLOR[p.t] ?? '#c3cdd7';
        ctx.beginPath();
        ctx.arc(px(spot.x), py(spot.y), 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#7ddf90';
      ctx.fillRect(px(plan.startX), h - 5, 1, 4);
      ctx.fillStyle = '#f2f5fa';
      ctx.fillRect(px(plan.finishX), 5, 1, h - 10);
      ctx.strokeStyle = '#1e2936';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      return;
    }
    let track = null;
    try { track = buildTrackFromDef(def); } catch { track = null; }
    if (!track) {
      ctx.fillStyle = '#5f6d7c';
      ctx.font = '7px var(--mono)';
      ctx.textAlign = 'center';
      ctx.fillText('No preview', w / 2, h / 2);
      return;
    }

    const trackH = track.height || def.height;
    const scaleY = (h - 8) / Math.max(1, trackH);
    const scaleX = (w - 16) / W;
    const ox = 8;

    // Segments
    if (track.segments?.length) {
      for (let i = 0; i < track.segments.length; i++) {
        const s = track.segments[i];
        const y = 4 + s.y * scaleY;
        const sh = Math.max(1, s.h * scaleY);
        ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)';
        ctx.fillRect(ox, y, w - 16, sh);
      }
    }

    // Finish line
    const fy = 4 + track.finishY * scaleY;
    ctx.strokeStyle = '#f2f5fa';
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(ox, fy);
    ctx.lineTo(w - 8, fy);
    ctx.stroke();
    ctx.setLineDash([]);

    // Pieces
    for (const p of def.pieces) {
      let x = W / 2, y = trackH / 2;
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
      if (sy < 2 || sy > h - 2) continue;
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
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }, [def, boxW, boxH]);

  return <canvas ref={ref} width={boxW} height={boxH} onClick={onClick} className={`track-thumb${wide ? ' is-wide' : ''}`} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} aria-label={onClick ? `Load ${def.name}` : `Preview of ${def.name}`} />;
}
