// P2-08: how the new skills look. Vector drawing, so it works with any skin. Two parts: an aura around a ball
// (shield, ram, mirror, charm, EMP), and the things that live in the world (bolts, bombs, spike patches, decoys).
import type { Game, Marble } from '../engine';
import { MARBLE_RADIUS } from '../types';
import { drawPremiumAura, drawPremiumWorld } from './premium-draw';

/** Rings and glows around one ball, drawn in world space at its position. */
export function drawAura(ctx: CanvasRenderingContext2D, game: Game, m: Marble, t: number) {
  const fx = m.fx;
  if (!fx) return;
  const { x, y } = m.body.position, now = game.time;
  const r = MARBLE_RADIUS;
  ctx.save();
  if ((fx.shieldUntil ?? 0) > now) {
    const k = Math.max(0.35, (fx.shieldHp ?? 0) / 40);
    const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 2.1);
    g.addColorStop(0, 'rgba(96,165,250,0)');
    g.addColorStop(0.75, `rgba(96,165,250,${(0.18 * k).toFixed(2)})`);
    g.addColorStop(1, `rgba(147,197,253,${(0.65 * k).toFixed(2)})`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r * 2.1, 0, Math.PI * 2); ctx.fill();
  }
  if ((fx.reflectUntil ?? 0) > now) {
    ctx.strokeStyle = 'rgba(224,242,254,0.9)';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.arc(x, y, r * 2.2, t / 300, t / 300 + Math.PI * 1.6); ctx.stroke();
    ctx.setLineDash([]);
  }
  if ((fx.ramUntil ?? 0) > now) {
    ctx.fillStyle = 'rgba(180,83,9,0.35)';
    ctx.beginPath(); ctx.arc(x, y, r * 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r * 1.8, 0, Math.PI * 2); ctx.stroke();
  }
  if ((fx.charmUntil ?? 0) > now) {
    ctx.fillStyle = `rgba(52,211,153,${(0.55 + 0.35 * Math.sin(t / 150)).toFixed(2)})`;
    for (let i = 0; i < 3; i++) { const a = t / 400 + (i * Math.PI * 2) / 3; ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 2, y + Math.sin(a) * r * 2, 2.6, 0, Math.PI * 2); ctx.fill(); }
  }
  if ((fx.empUntil ?? 0) > now) {
    ctx.strokeStyle = 'rgba(56,189,248,0.9)'; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) { const a = t / 80 + i * 2.1; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.lineTo(x + Math.cos(a + 0.4) * r * 1.9, y + Math.sin(a + 0.4) * r * 1.9); ctx.stroke(); }
  }
  if ((fx.hoverUntil ?? 0) > now) {
    ctx.strokeStyle = 'rgba(148,163,184,0.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, y + r + 3, r * 1.4, 3, 0, 0, Math.PI * 2); ctx.stroke();
  }
  if ((fx.overdriveUntil ?? 0) > now) {
    ctx.fillStyle = 'rgba(239,68,68,0.3)';
    ctx.beginPath(); ctx.arc(x, y, r * 1.5, 0, Math.PI * 2); ctx.fill();
  }
  drawPremiumAura(ctx, game, m, t);
  if (fx.grappleTo) {
    ctx.strokeStyle = '#a16207'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(fx.grappleTo.x, fx.grappleTo.y); ctx.stroke();
  }
  ctx.restore();
}

/** Bolts, bombs, spike patches and decoys in one lane (`lane` null = the whole world, for classic tracks). */
export function drawSkillWorld(ctx: CanvasRenderingContext2D, game: Game, lane: number | null, t: number) {
  const platformer = !!game.track.platformer;
  drawPremiumWorld(ctx, game, lane, t);
  for (const s of game.spikes) {
    if (platformer && lane !== null && s.lane !== lane) continue;
    ctx.fillStyle = '#a8a29e';
    for (let x = s.x; x < s.x + s.w; x += 10) { ctx.beginPath(); ctx.moveTo(x, s.y); ctx.lineTo(x + 5, s.y - 12); ctx.lineTo(x + 10, s.y); ctx.closePath(); ctx.fill(); }
  }
  for (const d of game.decoys) {
    if (platformer && lane !== null && d.lane !== lane) continue;
    ctx.save();
    ctx.globalAlpha = 0.5 + 0.2 * Math.sin(t / 120);
    ctx.fillStyle = d.color;
    ctx.beginPath(); ctx.arc(d.x, d.y, MARBLE_RADIUS, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.arc(d.x, d.y, MARBLE_RADIUS + 3, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  for (const p of game.projectiles) {
    if (platformer && lane !== null && p.lane !== lane) continue;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(p.vy, p.vx));
    ctx.fillStyle = 'rgba(249,115,22,0.35)';
    ctx.beginPath(); ctx.ellipse(-8, 0, 16, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fdba74';
    ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-5, -5); ctx.lineTo(-2, 0); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  for (const b of game.bombs) {
    const target = game.byIdOrNull(b.target);
    if (!target || (platformer && lane !== null && (target.lane ?? 1) !== lane)) continue;
    const { x, y } = target.body.position;
    const left = Math.max(0, b.explodeAt - game.time);
    const blink = left < 700 ? Math.sin(t / 40) > 0 : Math.sin(t / 160) > 0.3;
    ctx.fillStyle = '#1f2937';
    ctx.beginPath(); ctx.arc(x + 8, y - MARBLE_RADIUS - 2, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = blink ? '#ef4444' : '#7f1d1d';
    ctx.beginPath(); ctx.arc(x + 8, y - MARBLE_RADIUS - 8, 2.5, 0, Math.PI * 2); ctx.fill();
  }
}
