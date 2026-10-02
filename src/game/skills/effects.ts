// P2-08 (#114): what the sixteen new skills DO in a race. The rules numbers live in catalog.ts; this file is the
// engine side: a preflight (can it be used now? is there a target?), the effect, and the per-step upkeep for
// projectiles, bombs, spikes and decoys. Everything runs on the host and uses the race rng, never Math.random.
import Matter from 'matter-js';
import type { Game, Marble } from '../engine';
import type { ItemType } from '../types';
import { MARBLE_RADIUS } from '../types';
import { SKILLS } from './catalog';
import { meta } from '../track';

const { Body, Query, Bodies } = Matter;

/** Timers (race time at which each effect ends) and counters, per marble. */
export interface SkillFx {
  shieldUntil?: number; shieldHp?: number; ramUntil?: number; hoverUntil?: number; overdriveUntil?: number;
  reflectUntil?: number; charmUntil?: number; empUntil?: number; drillUntil?: number;
  grappleTo?: { x: number; y: number; until: number };
  ironUsed?: number;
}
export const fxOf = (m: Marble): SkillFx => (m.fx ??= {});

/** P2-17: this marble's talent total for a stat (0 for computers). */
export const tfx = (m: Marble | null | undefined, stat: string): number => m?.tfx?.[stat] ?? 0;
const offence = (owner: Marble | null | undefined, base: number): number => Math.round(base * (1 + tfx(owner, 'offenceDamagePct') / 100));

export interface Projectile { speed: number; id: number; owner: number; target: number; x: number; y: number; vx: number; vy: number; until: number; lane: number }
export interface Bomb { target: number; owner: number; explodeAt: number }
export interface SpikePatch { x: number; y: number; w: number; owner: number; until: number; lane: number }
export interface Decoy { x: number; y: number; owner: number; until: number; lane: number; color: string }

const SPEED_BOLT = 11;
const lanePlatformer = (game: Game, m: Marble) => (game.track.platformer ? (m.lane ?? 1) : 0);
const sameLane = (game: Game, a: Marble, b: Marble) => !game.track.platformer || (a.lane ?? 1) === (b.lane ?? 1);

/** Nearest rival ahead (to the right on a platformer, below on a drop) within `range`, in the same lane. */
function nearestAhead(game: Game, m: Marble, range: number): Marble | null {
  const p = m.body.position;
  let best: Marble | null = null, bestD = Infinity;
  for (const o of game.marbles) {
    if (o === m || o.finishedAt !== null || o.dnf || o.hold || !sameLane(game, m, o)) continue;
    const dx = o.body.position.x - p.x, dy = o.body.position.y - p.y;
    const ahead = game.track.platformer ? dx > -20 : dy > -20;
    const d = Math.hypot(dx, dy);
    if (ahead && d < range && d < bestD) { best = o; bestD = d; }
  }
  return best;
}

function nearestAny(game: Game, m: Marble, range: number): Marble | null {
  const p = m.body.position;
  let best: Marble | null = null, bestD = Infinity;
  for (const o of game.marbles) {
    if (o === m || o.finishedAt !== null || o.dnf || o.hold || !sameLane(game, m, o)) continue;
    const d = Math.hypot(o.body.position.x - p.x, o.body.position.y - p.y);
    if (d < range && d < bestD) { best = o; bestD = d; }
  }
  return best;
}

function leaderOf(game: Game, m: Marble): Marble | null {
  const order = game.ranking().filter((r) => !r.finished && !r.dnf).map((r) => r.marble);
  return (order[0] !== m ? order[0] : order[1]) ?? null;
}

/** A decoy near this marble that homing skills prefer, if any. */
function decoyFor(game: Game, owner: Marble): Decoy | null {
  const lane = lanePlatformer(game, owner);
  return game.decoys.find((d) => d.owner !== owner.info.id && d.until > game.time && d.lane === lane) ?? null;
}

/** The ledge a Grapple Hook would reach: ahead within 300 px and not above the ball by more than 300. */
function grappleAnchor(game: Game, m: Marble): { x: number; y: number } | null {
  const plan = game.track.platformer?.plan;
  if (!plan?.ledges) return null;
  const p = m.body.position, lane = m.lane ?? 1;
  let best: { x: number; y: number } | null = null, bestD = Infinity;
  for (const l of plan.ledges) {
    if (l.lane !== lane) continue;
    const x = Math.max(l.x, Math.min(l.x + l.w, p.x + 60)), y = l.y - MARBLE_RADIUS - 2;
    const dx = x - p.x, dy = y - p.y;
    if (dx < -20 || dx > 300 || dy > 300 || dy < -300) continue;
    const d = Math.hypot(dx, dy);
    if (d < bestD) { best = { x, y }; bestD = d; }
  }
  return best;
}

function blinkDestination(game: Game, m: Marble): { x: number; y: number } | null {
  const p = m.body.position, v = m.body.velocity;
  const sp = Math.hypot(v.x, v.y);
  const dir = sp > 0.5 ? { x: v.x / sp, y: v.y / sp } : game.track.platformer ? { x: 1, y: 0 } : { x: 0, y: 1 };
  const dest = { x: p.x + dir.x * 140, y: p.y + dir.y * 140 };
  const probe = Bodies.circle(dest.x, dest.y, MARBLE_RADIUS + 2);
  const lane = m.lane;
  const solid = game.track.bodies.filter((b) => !b.isSensor && !meta(b).destroyed && (lane === undefined || meta(b).lane === undefined || meta(b).lane === lane) && meta(b).kind !== 'gate');
  return Query.collides(probe, solid).length ? null : dest;
}

/** Why this skill cannot be used right now, or null when it can. A refused skill keeps its charge. */
export function preflight(game: Game, m: Marble, item: ItemType): string | null {
  switch (item) {
    case 'shield': case 'charm': return game.healthOn ? null : 'Health is off on this track';
    case 'repair': return !game.healthOn ? 'Health is off on this track' : (m.health && m.health.hp >= 100 ? 'Already at full health' : null);
    case 'bolt': return nearestAhead(game, m, 600) || decoyFor(game, m) ? null : 'No rival in range';
    case 'bomb': return nearestAny(game, m, 250) ? null : 'No rival in range';
    case 'lightning': return leaderOf(game, m) ? null : 'Nobody to strike';
    case 'grapple': return grappleAnchor(game, m) ? null : 'Nothing to grab ahead';
    case 'blink': return blinkDestination(game, m) ? null : 'Blocked: Blink fizzled';
    default: return null;
  }
}

function pop(game: Game, m: Marble, color: string) {
  game.effects.push({ type: 'ring', x: m.body.position.x, y: m.body.position.y, ttl: 24, maxTtl: 24, color });
}

/** Run a new skill's effect (the charge is already spent). */
export function apply(game: Game, m: Marble, item: ItemType): void {
  const fx = fxOf(m), t = game.time, p = m.body.position;
  const dur = Math.round(((SKILLS as Record<string, { durationMs: number }>)[item]?.durationMs ?? 0) * (1 + tfx(m, 'skillDurationPct') / 100));
  switch (item) {
    case 'shield': fx.shieldUntil = t + dur; fx.shieldHp = 40; pop(game, m, '#60a5fa'); break;
    case 'repair': {
      if (m.health) m.health = { ...m.health, hp: Math.min(100, m.health.hp + 40) };
      game.effects.push({ type: 'text', x: p.x, y: p.y - 26, ttl: 40, maxTtl: 40, color: '#4ade80', text: '+40' });
      pop(game, m, '#4ade80');
      break;
    }
    case 'ram': fx.ramUntil = t + dur; m.rocketUntil = Math.max(m.rocketUntil, t + dur); pop(game, m, '#b45309'); break;
    case 'brake': {
      const v = Body.getVelocity(m.body);
      Body.setVelocity(m.body, { x: v.x * 0.2, y: v.y * 0.2 });
      fx.hoverUntil = t + dur;
      pop(game, m, '#94a3b8');
      break;
    }
    case 'overdrive': fx.overdriveUntil = t + dur; if (m.engine) m.engine = { ...m.engine, heat: 0, lockedUntil: 0 }; pop(game, m, '#ef4444'); break;
    case 'spikes': game.spikes.push({ x: p.x - 40, y: p.y + MARBLE_RADIUS, w: 80, owner: m.info.id, until: t + dur, lane: lanePlatformer(game, m) }); break;
    case 'decoy': game.decoys.push({ x: p.x, y: p.y, owner: m.info.id, until: t + dur, lane: lanePlatformer(game, m), color: m.info.color }); pop(game, m, '#fbbf24'); break;
    case 'grapple': {
      const a = grappleAnchor(game, m);
      if (a) fx.grappleTo = { x: a.x, y: a.y, until: t + 700 };
      break;
    }
    case 'bomb': {
      const target = nearestAny(game, m, 250);
      if (target) game.bombs.push({ target: target.info.id, owner: m.info.id, explodeAt: t + dur });
      break;
    }
    case 'reflect': fx.reflectUntil = t + dur; pop(game, m, '#e0f2fe'); break;
    case 'blink': {
      const d = blinkDestination(game, m);
      if (d) { pop(game, m, '#a78bfa'); Body.setPosition(m.body, d); pop(game, m, '#a78bfa'); }
      break;
    }
    case 'emp': {
      for (const o of game.marbles) {
        if (o === m || Math.hypot(o.body.position.x - p.x, o.body.position.y - p.y) > 300) continue;
        fxOf(o).empUntil = t + dur;
        pop(game, o, '#38bdf8');
      }
      game.effects.push({ type: 'ring', x: p.x, y: p.y, ttl: 30, maxTtl: 30, color: '#38bdf8' });
      break;
    }
    case 'lightning': {
      const target = leaderOf(game, m);
      if (!target) break;
      game.effects.push({ type: 'beam', x: target.body.position.x, y: target.body.position.y - 700, x2: target.body.position.x, y2: target.body.position.y, ttl: 14, maxTtl: 14, color: '#fde047' });
      if (absorb(game, target, m, 'lightning')) break;
      game.damage(target, offence(m, 30), m.info.id, 'lightning');
      if (!target.dnf) { target.frozenUntil = t + 1000; game.setFrozen(target, true); }
      break;
    }
    case 'drill': {
      fx.drillUntil = t + dur;
      game.applyMask(m);
      const v = Body.getVelocity(m.body);
      Body.setVelocity(m.body, { x: v.x, y: Math.max(v.y, 5) });
      pop(game, m, '#78716c');
      break;
    }
    case 'charm': fx.charmUntil = t + dur; pop(game, m, '#34d399'); break;
    case 'bolt': {
      const target = decoyFor(game, m) ? null : nearestAhead(game, m, 600);
      const speed = SPEED_BOLT * (1 + tfx(m, 'projectileSpeedPct') / 100);
      game.projectiles.push({ id: game.nextProjectileId++, owner: m.info.id, target: target ? target.info.id : -1, x: p.x, y: p.y - 6, vx: speed, vy: -2, speed, until: t + 3500, lane: lanePlatformer(game, m) });
      break;
    }
  }
}

/**
 * A homing skill reaches `victim`: a Bubble Shield soaks it (and pops); a Mirror Plate sends it back to `from`.
 * Returns true when the hit was stopped here.
 */
function absorb(game: Game, victim: Marble, from: Marble, kind: 'bolt' | 'bomb' | 'freeze' | 'lightning'): boolean {
  const fx = fxOf(victim), t = game.time;
  if ((fx.reflectUntil ?? 0) > t && kind !== 'lightning') {
    pop(game, victim, '#e0f2fe');
    if (kind === 'freeze') { from.frozenUntil = t + 2500; game.setFrozen(from, true); }
    return true;
  }
  if ((fx.shieldUntil ?? 0) > t && (kind === 'bolt' || kind === 'freeze')) {
    fx.shieldUntil = 0;
    pop(game, victim, '#60a5fa');
    return true;
  }
  return false;
}
export { absorb as absorbHoming };

/** A knock away from a point, scaled to the marble's mass. */
function knock(m: Marble, fromX: number, fromY: number, strength: number) {
  const dx = m.body.position.x - fromX, dy = m.body.position.y - fromY, d = Math.hypot(dx, dy) || 1;
  const v = Body.getVelocity(m.body), k = strength / Math.sqrt(m.body.mass / 0.8);
  Body.setVelocity(m.body, { x: v.x + (dx / d) * k, y: v.y + (dy / d) * k - 1.5 });
}

/** Called each physics step on the host while the race runs: projectiles, bombs, spikes, decoys, the grapple pull, hover. */
export function step(game: Game, dt: number): void {
  const t = game.time;
  // projectiles
  for (let i = game.projectiles.length - 1; i >= 0; i--) {
    const pr = game.projectiles[i];
    if (pr.until < t) { game.projectiles.splice(i, 1); continue; }
    let tx: number | null = null, ty: number | null = null;
    const owner = game.byIdOrNull(pr.owner);
    const decoy = owner ? decoyFor(game, owner) : null;
    const target = game.byIdOrNull(pr.target);
    if (decoy) { tx = decoy.x; ty = decoy.y; }
    else if (target && target.finishedAt === null && !target.dnf) { tx = target.body.position.x; ty = target.body.position.y; }
    else if (owner) {
      // no target (or it is gone): look for one ahead of the bolt
      let best: Marble | null = null, bestD = 600;
      for (const o of game.marbles) {
        if (o === owner || o.finishedAt !== null || o.dnf || (game.track.platformer && (o.lane ?? 1) !== pr.lane)) continue;
        const d = Math.hypot(o.body.position.x - pr.x, o.body.position.y - pr.y);
        if (d < bestD && (game.track.platformer ? o.body.position.x > pr.x - 30 : o.body.position.y > pr.y - 30)) { best = o; bestD = d; }
      }
      if (best) { pr.target = best.info.id; tx = best.body.position.x; ty = best.body.position.y; }
    }
    if (tx !== null && ty !== null) {
      const dx = tx - pr.x, dy = ty - pr.y, d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, 0.12 * (dt / 16.7));
      pr.vx += ((dx / d) * pr.speed - pr.vx) * k;
      pr.vy += ((dy / d) * pr.speed - pr.vy) * k;
      if (d < 22) {
        if (decoy) { game.decoys.splice(game.decoys.indexOf(decoy), 1); pop(game, { body: { position: { x: tx, y: ty } } } as unknown as Marble, '#fbbf24'); game.projectiles.splice(i, 1); continue; }
        if (target) {
          game.projectiles.splice(i, 1);
          const from = owner ?? target;
          if ((fxOf(target).reflectUntil ?? 0) > t) { pop(game, target, '#e0f2fe'); game.projectiles.push({ ...pr, id: game.nextProjectileId++, owner: target.info.id, target: from.info.id, vx: -pr.vx, vy: -pr.vy, until: t + 3000 }); continue; }
          if (absorb(game, target, from, 'bolt')) continue;
          knock(target, pr.x, pr.y, 5);
          game.damage(target, offence(owner, 25), pr.owner, 'bolt');
          game.effects.push({ type: 'flash', x: pr.x, y: pr.y, ttl: 12, maxTtl: 12, color: '#f97316' });
          game.sfx('bump', target, pr.x, pr.y);
          continue;
        }
      }
    }
    pr.x += pr.vx * (dt / 16.7);
    pr.y += pr.vy * (dt / 16.7);
  }
  // sticky bombs
  for (let i = game.bombs.length - 1; i >= 0; i--) {
    const b = game.bombs[i];
    const target = game.byIdOrNull(b.target);
    if (!target || target.finishedAt !== null || target.dnf) { game.bombs.splice(i, 1); continue; }
    if (t < b.explodeAt) continue;
    game.bombs.splice(i, 1);
    const p = target.body.position;
    game.effects.push({ type: 'ring', x: p.x, y: p.y, ttl: 26, maxTtl: 26, color: '#dc2626' });
    game.effects.push({ type: 'debris', x: p.x, y: p.y, ttl: 30, maxTtl: 30, color: '#fb923c', particles: game.makeParticles(p.x, p.y, 14, 5) });
    game.sfx('bang', target, p.x, p.y);
    game.shake = Math.max(game.shake, 8);
    for (const o of game.marbles) {
      if (o.finishedAt !== null || o.dnf || !sameLane(game, target, o)) continue;
      const d = Math.hypot(o.body.position.x - p.x, o.body.position.y - p.y);
      if (d < 140) knock(o, p.x, p.y, 8 * (1 - d / 160));
    }
    const from = game.byIdOrNull(b.owner) ?? target;
    if ((fxOf(target).reflectUntil ?? 0) > t) { pop(game, target, '#e0f2fe'); continue; }
    game.damage(target, offence(game.byIdOrNull(b.owner), 35), b.owner, 'bomb');
    void from;
  }
  // spikes: rolling over them hurts and costs grip
  for (let i = game.spikes.length - 1; i >= 0; i--) {
    const s = game.spikes[i];
    if (s.until < t) { game.spikes.splice(i, 1); continue; }
    for (const o of game.marbles) {
      if (o.info.id === s.owner || o.finishedAt !== null || o.dnf || (game.track.platformer && (o.lane ?? 1) !== s.lane)) continue;
      const p = o.body.position;
      if (p.x < s.x || p.x > s.x + s.w || Math.abs(p.y - s.y) > MARBLE_RADIUS + 14) continue;
      const v = Body.getVelocity(o.body);
      Body.setVelocity(o.body, { x: v.x * (1 - 0.03 * (dt / 16.7)), y: v.y });
      if (t - (o.spikedAt ?? -1000) > 1000) { o.spikedAt = t; game.damage(o, offence(game.byIdOrNull(s.owner), 8), s.owner, 'spikes'); }
    }
  }
  for (let i = game.decoys.length - 1; i >= 0; i--) if (game.decoys[i].until < t) game.decoys.splice(i, 1);
  // per marble: the grapple pull and hovering
  for (const m of game.marbles) {
    const fx = m.fx;
    if (!fx) continue;
    if (fx.grappleTo) {
      const g = fx.grappleTo, p = m.body.position, dx = g.x - p.x, dy = g.y - p.y, d = Math.hypot(dx, dy);
      if (t > g.until || d < 24) fx.grappleTo = undefined;
      else Body.setVelocity(m.body, { x: (dx / d) * 14, y: (dy / d) * 14 });
    }
    if ((fx.hoverUntil ?? 0) > t) { const v = Body.getVelocity(m.body); Body.setVelocity(m.body, { x: v.x, y: v.y * 0.35 - 0.1 }); }
  }
}

/** The ram, and what it does to a rival it hits. */
export function ramHit(game: Game, ram: Marble, other: Marble): void {
  const fx = fxOf(ram), t = game.time;
  if ((fx.ramUntil ?? 0) <= t || (ram.ramHitAt ?? -1000) + 500 > t) return;
  ram.ramHitAt = t;
  knock(other, ram.body.position.x, ram.body.position.y, 9);
  game.damage(other, offence(ram, 10), ram.info.id, 'ram');
  game.sfx('smash', other, other.body.position.x, other.body.position.y);
}
