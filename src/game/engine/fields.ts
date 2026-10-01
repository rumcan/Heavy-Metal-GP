// Fields and surfaces: wind (Updraft fans), magnets, mud, geysers and friends. P2-02 (fan bug) owns the wind part.
// Split out of engine.ts (P2-00a).
import { meta } from '../track';
import { elementBodies, hasElement } from '../elements';
import { Body } from '../engine';
import type { Game } from '../engine';

export function applyFields(game: Game): void {
// ---------------- MB-10E: fields and surfaces ----------------
// All of these are deterministic velocity nudges read straight off positions and the race
// clock — no state crosses the wire, only sound cues do.
if (hasElement(game.track, 'wind')) {
  for (const body of elementBodies(game.track, 'wind')) {
    const md = meta(body);
    const w = md.wind;
    if (!w) continue;
    // breathe: a pulsed fan swells and ebbs on the clock
    const k = w.pulseMs > 0 ? 0.35 + 0.65 * (0.5 + 0.5 * Math.cos((2 * Math.PI * (game.time + w.phaseMs)) / w.pulseMs)) : 1;
    const push = w.push * k;
    if (push < 0.005) continue;
    for (const m of game.marbles) {
      if (m.finishedAt !== null || m.frozen || m.hold) continue;
      const p = m.body.position;
      if (p.x < w.box.x - 12 || p.x > w.box.x + w.box.w + 12 || p.y < w.box.y - 12 || p.y > w.box.y + w.box.h + 12) continue;
      const v = Body.getVelocity(m.body);
      // light marbles sail; Heavy metal ignores the whole field; Slipstream doubles the gust
      const weight = m.info.stats.weight ?? 5;
      let f = 1.25 - weight * 0.075;
      if (game.time < m.anvilUntil) f = 0;
      else if (m.aeroUntil > game.time) f *= 2;
      if (f <= 0) continue;
      Body.setVelocity(m.body, { x: v.x + w.ux * push * f, y: v.y + w.uy * push * f });
    }
  }
}
if (hasElement(game.track, 'magnet')) {
  for (const body of elementBodies(game.track, 'magnet')) {
    const md = meta(body);
    const g = md.magnet;
    if (!g) continue;
    // thrum: an on/off cycle read off the clock
    if (g.periodMs > 0 && ((game.time + g.phaseMs) % g.periodMs) >= g.periodMs / 2) continue;
    for (const m of game.marbles) {
      if (m.finishedAt !== null || m.frozen || m.hold) continue;
      if (m.ghostUntil > game.time) continue; // Ghost has no iron in it
      const p = m.body.position;
      const dx = g.cx - p.x, dy = g.cy - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 1 || d > g.r) continue;
      const weight = m.info.stats.weight ?? 5;
      const anvil = game.time < m.anvilUntil;
      const fall = 0.3 + 0.7 * (1 - d / g.r) * 1.8;
      // iron = weight: the drag scales with it; Heavy metal is yanked three times as hard
      const acc = 0.045 * g.pull * (0.35 + 0.65 * (weight / 10)) * fall * (anvil ? 3 : 1);
      const v = Body.getVelocity(m.body);
      Body.setVelocity(m.body, { x: v.x + (dx / d) * acc, y: v.y + (dy / d) * acc });
      if (d > g.r * 0.55) m.magnetGrabAt = -1e9; // walked clear: the latch re-arms
      if (d < g.r * 0.5 && game.time - (m.magnetGrabAt ?? -1e9) > 1500) {
        m.magnetGrabAt = game.time;
        game.sfx('zap', m, g.cx, g.cy);
        game.emit({ kind: 'sound', cue: 'zap' });
      }
      if (anvil && d < g.r * 0.38 && game.time - (m.magnetGrabAt ?? -1e9) < 1400) {
        // Heavy metal sticks BRIEFLY — a beat and a half, then the iron lets go
        Body.setVelocity(m.body, { x: m.body.velocity.x * 0.6, y: m.body.velocity.y * 0.6 });
      }
    }
  }
}
if (hasElement(game.track, 'mud')) {
  for (const body of elementBodies(game.track, 'mud')) {
    const md = meta(body);
    const mud = md.mud;
    if (!mud) continue;
    for (const m of game.marbles) {
      if (m.finishedAt !== null || m.frozen || m.hold) continue;
      const p = m.body.position;
      if (p.x < mud.box.x || p.x > mud.box.x + mud.box.w || p.y < mud.box.y || p.y > mud.box.y + mud.box.h) continue;
      const speed = m.info.stats.speed ?? 5;
      let drag = mud.drag * (1.18 - speed * 0.06);
      if (m.aeroUntil > game.time) drag *= 0.15; // Slipstream sails over the tar
      const v = Body.getVelocity(m.body);
      Body.setVelocity(m.body, { x: v.x * (1 - drag), y: v.y * (1 - drag * 0.4) });
      if (game.time - (m.mudSquelchAt ?? -1e9) > 900 && Math.hypot(v.x, v.y) > 2.5) {
        m.mudSquelchAt = game.time;
        game.sfx('gurgle', m, p.x, p.y);
        game.emit({ kind: 'sound', cue: 'gurgle' });
      }
    }
  }
}
if (hasElement(game.track, 'geyser')) {
  for (const body of elementBodies(game.track, 'geyser')) {
    const md = meta(body);
    const g = md.geyser;
    if (!g) continue;
    const t = ((game.time + g.phaseMs) % g.periodMs + g.periodMs) % g.periodMs;
    const erupting = t >= 900 && t < 900 + g.burstMs;
    const wasHot = (md as unknown as { geyserHot?: boolean }).geyserHot ?? false;
    if (erupting !== wasHot) (md as unknown as { geyserHot?: boolean }).geyserHot = erupting;
    if (erupting && !wasHot) {
      game.sfx('steam', game.player, g.cx, g.topY);
      game.emit({ kind: 'sound', cue: 'steam' });
      game.effects.push({ type: 'debris', x: g.cx, y: g.topY, ttl: 20, maxTtl: 20, color: '#e2e8f0', particles: game.makeParticles(g.cx, g.topY, 12, 4.5) });
    }
    if (!erupting) continue;
    for (const m of game.marbles) {
      if (m.finishedAt !== null || m.frozen || m.hold) continue;
      const p = m.body.position;
      if (p.y > g.topY + 6 || p.y < g.topY - g.h) continue;
      if (Math.abs(p.x - g.cx) > 30) continue;
      const weight = m.info.stats.weight ?? 5;
      let up = 0.85 * (1.25 - weight * 0.07);
      if (game.time < m.anvilUntil) up *= 0.35;
      const v = Body.getVelocity(m.body);
      Body.setVelocity(m.body, { x: v.x, y: Math.min(v.y, v.y - up) });
    }
  }
}
}
