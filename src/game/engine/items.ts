// Items (skills): granting, availability, the speed limit, and what each item does when used.
// Split out of engine.ts (P2-00a). Every function takes the Game as `game`; Game's methods delegate here.

import { meta } from '../track';
import { elementBodies } from '../elements';

import { ItemType, MARBLE_RADIUS, ITEM_TYPES, ITEM_INFO, MAX_ITEM_STACK } from '../types';







import { Game, Body, Marble } from '../engine';
import * as skills from '../skills/effects';


export function grantItem(game: Game, m: Marble, item: ItemType): boolean  {
  if (m.inventory[item] >= MAX_ITEM_STACK) {
    if (m.info.isPlayer) game.onEvent?.(`${ITEM_INFO[item].name} storage full (${MAX_ITEM_STACK})`, '#a4b7c8');
    return false;
  }
  m.inventory[item]++;
  m.lastPickupAt = game.time;
  m.aiUseAt = game.time + 800 + game.rng() * 1800;
  if (m.info.isPlayer) {
    game.onInventoryChange?.({ ...m.inventory });
    game.onEvent?.(`+1 ${ITEM_INFO[item].name} / added to your loadout`, ITEM_INFO[item].color);
  }
  return true;
}

export function itemRemaining(game: Game, m: Marble, item: ItemType): number  {
  const fx = m.fx ?? {};
  const timers: Partial<Record<ItemType, number>> = {
    rocket: m.rocketUntil, jump: m.jumpUntil, aero: m.aeroUntil, anvil: m.anvilUntil, ghost: m.ghostUntil,
    shield: fx.shieldUntil, ram: fx.ramUntil, brake: fx.hoverUntil, overdrive: fx.overdriveUntil, reflect: fx.reflectUntil, charm: fx.charmUntil, drill: fx.drillUntil,
  };
  return Math.max(0, (timers[item] ?? 0) - game.time);
}

export function availableItem(game: Game, m: Marble = game.player): ItemType | undefined  {
  return ITEM_TYPES.find((item) => m.inventory[item] > 0 && game.itemRemaining(m, item) === 0);
}

export function canUseItem(game: Game, m: Marble, item: ItemType): boolean  {
  // P2-08: an EMP shuts skills off for a few seconds
  return game.gateOpen && !m.frozen && m.finishedAt === null && !m.dnf && m.inventory[item] > 0 && game.time >= m.itemCooldownUntil && game.itemRemaining(m, item) === 0 && game.time >= (m.fx?.empUntil ?? 0);
}

export function speedLimit(game: Game, m: Marble): number  {
  const base = m.maxSpeed + (game.time < m.rocketUntil ? 8 : 0) + (game.time < m.anvilUntil ? 4 : 0) + (game.time < m.aeroUntil ? 3 : 0);
  return Math.min(32, base * (1 + (m.tfx?.topSpeedPct ?? 0) / 100)); // P2-17: Streamline
}

export function usePlayerItem(game: Game, item = game.availableItem()): boolean  {
  return item ? game.useItem(game.player, item) : false;
}

export function useItem(game: Game, m: Marble, item = game.availableItem(m)): boolean  {
  if (!item || !game.canUseItem(m, item)) return false;
  const p = m.body.position;
  const freezeCandidates = item === 'freeze' ? game.marbles
    .filter((rival) => rival !== m && rival.finishedAt === null && !rival.frozen && rival.body.position.y > p.y - 20 && Math.hypot(rival.body.position.x - p.x, rival.body.position.y - p.y) < 900)
    : [];
  // STORY HOOK (ST-07): when a chapter gives game marble a target, its freeze goes for that rival first.
  const storyFreeze = game.story && item === 'freeze' ? game.storyTarget(m) : undefined;
  const freezeTarget = (storyFreeze && freezeCandidates.includes(storyFreeze) ? storyFreeze : undefined)
    ?? freezeCandidates
      .sort((a, b) => Math.hypot(a.body.position.x - p.x, a.body.position.y - p.y) - Math.hypot(b.body.position.x - p.x, b.body.position.y - p.y))[0];
  if (item === 'freeze' && !freezeTarget) {
    if (m.info.isPlayer) game.onEvent?.('No rival in range / freeze charge kept', '#7dd3fc');
    else m.aiUseAt = game.time + 1500;
    return false;
  }
  // P2-08: the new skills check they can work (a target, a clear spot, health on) before a charge is spent
  const refusal = skills.preflight(game, m, item);
  if (refusal) {
    if (m.info.isPlayer) game.onEvent?.(`${refusal} / charge kept`, '#a4b7c8');
    else m.aiUseAt = game.time + 1500;
    return false;
  }
  const fx = m.tfx;
  // P2-17: Quick Hands may keep the charge; Nimble/Rapid shorten the pause between skills
  const refunded = !!fx && (fx.refundChancePct ?? 0) > 0 && game.rng() * 100 < fx.refundChancePct;
  if (!game.unlimitedItems.has(item) && !refunded) m.inventory[item]--;
  m.itemCooldownUntil = game.time + Math.max(150, 450 * (1 + (fx?.skillCooldownPct ?? 0) / 100));
  game.sfx('item', m, p.x, p.y);
  game.emit({ kind: 'item', seat: m.info.id, item });
  switch (item) {
    case 'oil': {
      const slick = { x: p.x, y: p.y - 10, r: 48, ownerId: m.info.id, expiresAt: game.time + 9000 };
      game.oils.push(slick);
      game.emit({ kind: 'oil', x: slick.x, y: slick.y, r: slick.r, seat: m.info.id, until: slick.expiresAt });
      break;
    }
    case 'freeze': {
      const target = freezeTarget;
      if (target) {
        target.frozenUntil = game.time + 2500;
        game.setFrozen(target, true);
        game.effects.push({ type: 'beam', x: p.x, y: p.y, x2: target.body.position.x, y2: target.body.position.y, ttl: 20, maxTtl: 20, color: '#7dd3fc' });
        game.effects.push({ type: 'snow', x: target.body.position.x, y: target.body.position.y, ttl: 40, maxTtl: 40, color: '#bae6fd', particles: game.makeParticles(target.body.position.x, target.body.position.y, 12, 2) });
        game.emit({ kind: 'freeze', seat: target.info.id, by: m.info.id, until: target.frozenUntil });
        if (target.info.isPlayer) game.onEvent?.(`${m.info.name} froze you!`, '#7dd3fc');
        if (m.info.isPlayer) game.onEvent?.(`Froze ${target.info.name}!`, '#7dd3fc');
      }
      break;
    }
    case 'rocket': {
      m.rocketUntil = game.time + ITEM_INFO.rocket.duration * (1 + (fx?.skillDurationPct ?? 0) / 100);
      break;
    }
    case 'jump': {
      const v = Body.getVelocity(m.body);
      Body.setVelocity(m.body, { x: v.x, y: -11.5 - m.info.stats.bounce * 0.12 });
      m.jumpUntil = game.time + ITEM_INFO.jump.duration;
      game.effects.push({ type: 'ring', x: p.x, y: p.y + MARBLE_RADIUS, ttl: 22, maxTtl: 22, color: ITEM_INFO.jump.color });
      break;
    }
    case 'aero': {
      m.aeroUntil = game.time + ITEM_INFO.aero.duration * (1 + (fx?.skillDurationPct ?? 0) / 100);
      m.body.frictionAir = m.frictionAir * 0.05;
      m.body.friction = 0;
      game.effects.push({ type: 'ring', x: p.x, y: p.y, ttl: 24, maxTtl: 24, color: ITEM_INFO.aero.color });
      break;
    }
    case 'shock': {
      game.shake = 8;
      game.effects.push({ type: 'ring', x: p.x, y: p.y, ttl: 30, maxTtl: 30, color: '#facc15' });
      game.emit({ kind: 'shock', seat: m.info.id, x: p.x, y: p.y });
      // MB-10B: the fun interaction — a blast in range jams a mace sweeper for two seconds.
      for (const arm of elementBodies(game.track, 'mace')) {
        const amd = meta(arm);
        const motion = amd.motion;
        if (!motion || motion.mode !== 'sweep') continue;
        if (Math.hypot(motion.pivot.x - p.x, motion.pivot.y - p.y) < 280 || Math.hypot(arm.position.x - p.x, arm.position.y - p.y) < 280) {
          amd.stunUntil = game.time + 2000;
          game.effects.push({ type: 'text', x: motion.pivot.x, y: motion.pivot.y + 40, ttl: 60, maxTtl: 60, color: '#facc15', text: 'JAMMED' });
          game.sfx('clang', m, motion.pivot.x, motion.pivot.y);
        }
      }
      for (const o of game.marbles) {
        if (o === m || o.finishedAt !== null) continue;
        const dx = o.body.position.x - p.x;
        const dy = o.body.position.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d < 240 && d > 0.01) {
          game.setFrozen(o, false);
          const k = 11 * (1 - d / 240) / Math.sqrt(o.body.mass / 0.8);
          const v = Body.getVelocity(o.body);
          Body.setVelocity(o.body, { x: v.x + (dx / d) * k, y: v.y + (dy / d) * k - 2 });
        }
      }
      break;
    }
    case 'anvil': {
      m.anvilUntil = game.time + ITEM_INFO.anvil.duration * (1 + (fx?.skillDurationPct ?? 0) / 100);
      if (!m.frozen) Body.setDensity(m.body, m.baseDensity * 3);
      game.effects.push({ type: 'ring', x: p.x, y: p.y, ttl: 20, maxTtl: 20, color: '#cbd5e1' });
      break;
    }
    case 'ghost': {
      m.ghostUntil = game.time + ITEM_INFO.ghost.duration * (1 + (fx?.skillDurationPct ?? 0) / 100);
      game.applyMask(m);
      break;
    }
    default: skills.apply(game, m, item); // P2-08: the sixteen new skills
  }
  if (m.info.isPlayer) {
    game.onInventoryChange?.({ ...m.inventory });
    if (item !== 'freeze' && item !== 'lightning') game.onEvent?.(`${ITEM_INFO[item].name} deployed`, ITEM_INFO[item].color);
  }
  return true;
}
