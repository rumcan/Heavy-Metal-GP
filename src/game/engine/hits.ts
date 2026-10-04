// Collisions: what happens when a marble touches a track body (loops, trampolines, machines, pegs, walls).
// Split out of engine.ts (P2-00a). Every function takes the Game as `game`; Game's methods delegate here.
import Matter from 'matter-js';
import { meta } from '../track';
import * as holds from './holds';
import { pendulumOmega, slideDir, rollAt, pathAt, beltDir } from '../elements';

import { MAX_ITEM_STACK, LEGACY_ITEMS } from '../types';
import type { ItemType } from '../types';


import { BASE_TICK } from '../physics';
import { DAMAGE, recordBump } from '../health';
import { ramHit } from '../skills/effects';




import { Game, Body, ITEM_POOL, Marble } from '../engine';


export function onCollisionStart(game: Game, e: Matter.IEventCollision<Matter.Engine>) {
  for (const pair of e.pairs) {
    const a = pair.bodyA;
    const b = pair.bodyB;
    const ma = game.marbleOf(a);
    const mb = game.marbleOf(b);
    if (ma && !mb) {
      game.contactSurface(ma, b, pair, true);
      game.marbleHits(ma, b);
    } else if (mb && !ma) {
      game.contactSurface(mb, a, pair, true);
      game.marbleHits(mb, a);
    }
    else if (ma && mb) {
      if (ma.hold || mb.hold) continue; // a hidden marble clacks with nobody
      // P2-08: a ramming marble hurts and shoves what it hits
      ramHit(game, ma, mb);
      ramHit(game, mb, ma);
      // P2-07: a hard enough bump is remembered, so a rival who knocks you into a hazard gets the KO
      if (game.healthOn && ma.health && mb.health && Math.hypot(ma.body.velocity.x - mb.body.velocity.x, ma.body.velocity.y - mb.body.velocity.y) > 4) {
        ma.health = recordBump(ma.health, mb.info.id, game.time);
        mb.health = recordBump(mb.health, ma.info.id, game.time);
      }
      const sp = Math.hypot(ma.body.velocity.x - mb.body.velocity.x, ma.body.velocity.y - mb.body.velocity.y);
      if (sp > 4) {
        game.sfx('clack', ma.info.isPlayer ? ma : mb, a.position.x, a.position.y);
        game.effects.push({
          type: 'flash',
          x: (a.position.x + b.position.x) / 2,
          y: (a.position.y + b.position.y) / 2,
          ttl: 10,
          maxTtl: 10,
          color: '#ffffff',
        });
      }
    }
  }
}

export function marbleHits(game: Game, m: Marble, other: Matter.Body) {
  if (m.finishedAt !== null || m.frozen || !game.gateOpen) return;
  const md = meta(other);
  if (!md) return;
  switch (md.kind) {
    case 'loopTop':
      if (m.loopStage === 0) game.sfx('loop', m, other.position.x, other.position.y);
      if (m.loopStage === 0) game.storyCounter('loops', m); // STORY HOOK (ST-07)
      game.setLoopStage(m, 1);
      break;
    case 'loopExit':
      game.setLoopStage(m, 0);
      break;
    case 'trampoline': {
      // land on the net: the harder you come down, the higher you spring back.
      if (!md.trampoline) break;
      const v = Body.getVelocity(m.body);
      const fromAbove = m.body.position.y < other.position.y - 4;
      if (!fromAbove || v.y < 2.5) break;
      if (game.time - (m.trampAt ?? -1e9) < 350) break; // one spring per landing
      m.trampAt = game.time;
      const st = m.info.stats;
      const weight = st.weight ?? 5, bounce = st.bounce ?? 5;
      const k = Math.min(2.2, (0.55 + bounce * 0.06)) * md.trampoline.tension * Math.max(0.18, 1.35 - weight * 0.105);
      const anvil = game.time < m.anvilUntil ? 0.2 : 1;
      const vy = Math.min(24, v.y * k) * anvil;
      Body.setVelocity(m.body, { x: v.x * 0.92, y: -vy });
      md.tramp = { depth: Math.min(1, v.y / 14), at: game.time }; // skin sag read by render
      if (m.finishedAt === null) {
        game.sfx('boing', m, other.position.x, other.position.y);
        game.emit({ kind: 'sound', cue: v.y > 10 ? 'boing' : 'boing' });
      }
      break;
    }
    case 'turnstile': {
      // ratchet: one eased step per shove, debounced; guests replay from the event.
      const ts = md.turnstile;
      if (!ts || ts.mode !== 0) break;
      if (ts.stepAt >= 0 && game.time - ts.stepAt < 380) break;
      const v = Body.getVelocity(m.body);
      if (Math.hypot(v.x, v.y) < 1.2) break;
      ts.stepIndex++;
      ts.stepAt = game.time;
      game.emit({ kind: 'turnstile', i: game.track.bodies.indexOf(other), steps: ts.stepIndex, at: ts.stepAt });
      game.sfx('crank', m, other.position.x, other.position.y);
      game.emit({ kind: 'sound', cue: 'crank' });
      break;
    }
    case 'target': {
      // a pin drops on any firm touch; the bank loop re-arms it after resetMs.
      const tg = md.target;
      if (!tg || tg.dropAt >= 0) break;
      const v = Body.getVelocity(m.body);
      if (Math.hypot(v.x, v.y) < 0.3) break;
      tg.dropAt = game.time;
      other.isSensor = true;
      const bank = game.track.targetBanks[tg.bank];
      if (bank) bank.downAt[tg.slot] = game.time;
      game.emit({ kind: 'targets', i: game.track.bodies.indexOf(other), down: 1, at: game.time });
      game.sfx('ding', m, other.position.x, other.position.y);
      game.emit({ kind: 'sound', cue: 'ding' });
      break;
    }
    case 'hoop': {
      const v = Body.getVelocity(m.body);
      const speed = Math.hypot(v.x, v.y);
      const dir = speed > 1.5 ? { x: v.x / speed, y: v.y / speed } : md.dir ?? { x: 0, y: 1 };
      const boosted = Math.min(20, Math.max(speed * 1.35, speed + 5));
      Body.setVelocity(m.body, { x: dir.x * boosted, y: dir.y * boosted });
      game.effects.push({ type: 'ring', x: other.position.x, y: other.position.y, ttl: 22, maxTtl: 22, color: '#fb923c' });
      game.sfx('hoop', m, other.position.x, other.position.y);
      game.storyCounter('hoops', m); // STORY HOOK (ST-07)
      break;
    }
    case 'wrecker': {
      const dx = m.body.position.x - other.position.x, dy = m.body.position.y - other.position.y;
      const d = Math.hypot(dx, dy) || 1;
      const v = Body.getVelocity(m.body);
      const push = 7;
      Body.setVelocity(m.body, { x: v.x * 0.4 + dx / d * push, y: v.y * 0.4 + dy / d * push });
      game.shake = Math.max(game.shake, 5);
      game.damage(m, DAMAGE.wrecker, null, 'wrecker'); // P2-07 (platformer races)
      game.sfx('clang', m, other.position.x, other.position.y);
      game.effects.push({ type: 'ring', x: m.body.position.x, y: m.body.position.y, ttl: 14, maxTtl: 14, color: '#e2e8f0' });
      break;
    }
    case 'breakable': {
      const speed = Body.getSpeed(m.body);
      const rammed = game.time < (m.fx?.ramUntil ?? 0); // P2-08: a Battering Ram shatters any wall
      const dmg = rammed ? (md.hp ?? 0) + 1 : m.body.mass * speed;
      md.hp = (md.hp ?? 0) - dmg;
      if (md.hp > 0 && dmg > 0.5) game.sfx('crack', m, other.position.x, other.position.y);
      game.emit({ kind: 'crate', i: game.indexOf(other), hp: Math.max(0, md.hp), broken: md.hp <= 0 });
      game.effects.push({
        type: 'debris',
        x: other.position.x,
        y: other.position.y,
        ttl: 25,
        maxTtl: 25,
        color: '#fbbf24',
        particles: game.makeParticles(other.position.x, other.position.y, 6, 3),
      });
      if (md.hp <= 0) {
        md.hp = 0;
        // defer removal until after game physics step, and restore the marble's momentum so it plows through
        const v = Body.getVelocity(m.body);
        if (!game.pendingBreaks.some((p) => p.body === other)) {
          game.pendingBreaks.push({ body: other, marble: m, v: { x: v.x * 0.85, y: v.y } });
        }
        game.shake = 10;
        game.sfx('smash', m, other.position.x, other.position.y);
        game.storyCounter('crates', m); // STORY HOOK (ST-07)
        game.effects.push({
          type: 'debris',
          x: other.position.x,
          y: other.position.y,
          ttl: 50,
          maxTtl: 50,
          color: '#f59e0b',
          particles: game.makeParticles(other.position.x, other.position.y, 22, 7),
        });
        if (m.info.isPlayer) game.onEvent?.('SMASH! Shortcut opened', '#f59e0b');
      } else if (m.info.isPlayer && game.time - game.lastWallToast > 1200 && dmg > 0.5) {
        game.lastWallToast = game.time;
        game.onEvent?.(`Too light! Wall at ${Math.round((md.hp / (md.maxHp ?? 1)) * 100)}%`, '#94a3b8');
      }
      break;
    }
    // ---- MB-10A: shortcuts and secrets ----
    case 'barricade': {
      // A NO ENTRY barricade: damage is weight × speed like a SMASH crate; Heavy metal one-hits it.
      const anvil = game.time < m.anvilUntil || game.time < (m.fx?.ramUntil ?? 0);
      const speed = Body.getSpeed(m.body);
      const dmg = anvil ? (md.hp ?? 1) + 1 : m.body.mass * speed;
      md.hp = (md.hp ?? 0) - dmg;
      if (md.hp > 0 && dmg > 0.5) game.sfx('crack', m, other.position.x, other.position.y);
      game.emit({ kind: 'crate', i: game.indexOf(other), hp: Math.max(0, md.hp), broken: md.hp <= 0 });
      game.effects.push({
        type: 'debris', x: other.position.x, y: other.position.y, ttl: 25, maxTtl: 25, color: '#d6a04e',
        particles: game.makeParticles(other.position.x, other.position.y, 6, 3),
      });
      if (md.hp <= 0) {
        md.hp = 0;
        const v = Body.getVelocity(m.body);
        if (!game.pendingBreaks.some((p) => p.body === other)) {
          game.pendingBreaks.push({ body: other, marble: m, v: { x: v.x * 0.85, y: v.y } });
        }
        game.shake = 8;
        game.sfx('smash', m, other.position.x, other.position.y);
        game.sfx('cheer', m, other.position.x, other.position.y);
        game.emit({ kind: 'sound', cue: 'cheer' });
        game.effects.push({
          type: 'debris', x: other.position.x, y: other.position.y, ttl: 50, maxTtl: 50, color: '#d6a04e',
          particles: game.makeParticles(other.position.x, other.position.y, 22, 7),
        });
        game.effects.push({ type: 'text', x: other.position.x, y: other.position.y - 30, ttl: 70, maxTtl: 70, color: '#fca5a5', text: 'NO ENTRY!' });
        if (m.info.isPlayer) game.onEvent?.('Barricade smashed! The tunnel is open', '#fca5a5');
      } else if (m.info.isPlayer && game.time - game.lastWallToast > 1200 && dmg > 0.5) {
        game.lastWallToast = game.time;
        game.onEvent?.(anvil ? 'HEAVY HIT!' : `Barricade at ${Math.round((md.hp / (md.maxHp ?? 1)) * 100)}%`, '#94a3b8');
      }
      break;
    }
    case 'crumble': {
      // A crumbling wall: cumulative pack damage, permanent for the race; Heavy metal counts triple.
      const anvil = game.time < m.anvilUntil;
      const speed = Body.getSpeed(m.body);
      const dmg = game.time < (m.fx?.ramUntil ?? 0) ? (md.hp ?? 0) + 1 : m.body.mass * speed * (anvil ? 3 : 1); // P2-08: the ram shatters it
      md.hp = (md.hp ?? 0) - dmg;
      if (md.hp > 0 && dmg > 0.5) game.sfx('crack', m, other.position.x, other.position.y);
      game.emit({ kind: 'crate', i: game.indexOf(other), hp: Math.max(0, md.hp), broken: md.hp <= 0 });
      if (dmg > 0.5) game.shake = Math.max(game.shake, 3);
      if (md.hp <= 0) {
        md.hp = 0;
        const v = Body.getVelocity(m.body);
        if (!game.pendingBreaks.some((p) => p.body === other)) {
          game.pendingBreaks.push({ body: other, marble: m, v: { x: v.x * 0.9, y: v.y } });
        }
        game.shake = 12;
        game.sfx('smash', m, other.position.x, other.position.y);
        game.emit({ kind: 'sound', cue: 'rumble' });
        game.effects.push({
          type: 'debris', x: other.position.x, y: other.position.y, ttl: 60, maxTtl: 60, color: '#a8a29e',
          particles: game.makeParticles(other.position.x, other.position.y, 26, 7),
        });
        if (m.info.isPlayer) game.onEvent?.('The wall crumbled! Shortcut open', '#d6d3d1');
      }
      break;
    }
    case 'tunnel': {
      // A hole in the cliff: swallow the marble for a hidden transit, then pop it out the far hole.
      if (m.hold || game.time < m.tunnelSafeUntil || !md.exit) break;
      const visits = game.tunnelVisits.get(m.info.id) ?? new Map<number, number>();
      game.tunnelVisits.set(m.info.id, visits);
      const used = visits.get(other.id) ?? 0;
      if (used >= 3) break; // up-exits must never loop forever
      visits.set(other.id, used + 1);
      const transit = md.transit ?? 900;
      const until = game.time + transit;
      m.hold = { kind: 'tunnel', until, transit, from: { x: other.position.x, y: other.position.y }, body: other, exit: md.exit };
      m.body.isSensor = true;
      Body.setPosition(m.body, { x: other.position.x, y: other.position.y });
      Body.setVelocity(m.body, { x: 0, y: 0 });
      Body.setAngularVelocity(m.body, 0);
      m.trail = [];
      game.sfx('rumble', m, other.position.x, other.position.y);
      game.emit({ kind: 'sound', cue: 'rumble', seat: m.info.id });
      game.emit({ kind: 'hold', seat: m.info.id, until, of: 'tunnel' });
      game.effects.push({ type: 'snow', x: other.position.x, y: other.position.y, ttl: 30, maxTtl: 30, color: '#b8a88f', particles: game.makeParticles(other.position.x, other.position.y, 10, 2) });
      break;
    }
    case 'loopRide': {
      // Any touch, from any side and at any speed, starts the ride: one and a half turns inside the ring, the way the
      // marble was already going, then out of the opposite side, straight away from where it came in.
      if (m.hold || game.time < m.tunnelSafeUntil || !md.loopRide) break;
      const { cx, cy, r } = md.loopRide;
      const p = m.body.position, v = m.body.velocity;
      const dx = p.x - cx, dy = p.y - cy;
      const a0 = Math.atan2(dy, dx);
      const spin = (dx * v.y - dy * v.x) >= 0 ? 1 : -1; // + = clockwise on screen
      const rideMs = Math.max(900, Math.min(1600, r * 7));
      const omega = (spin * Math.PI * 3) / rideMs;
      const out = a0 + Math.PI; // the opposite side
      const speed = Math.max(Math.hypot(v.x, v.y), 9);
      const until = game.time + rideMs;
      m.hold = {
        kind: 'loop', until, at: game.time,
        arc: { x: cx, y: cy, r: Math.max(8, r - 16), fromA: a0, omega, release: out },
        exit: { x: cx + Math.cos(out) * (r + 22), y: cy + Math.sin(out) * (r + 22), dir: { x: Math.cos(out), y: Math.sin(out) }, speed },
      };
      m.body.isSensor = true;
      Body.setVelocity(m.body, { x: 0, y: 0 });
      Body.setAngularVelocity(m.body, 0);
      game.sfx('loop', m, cx, cy);
      game.storyCounter('loops', m); // STORY HOOK (ST-07)
      // Guests only need to know the marble is carried: 'wheel' is a hold every build's guests understand.
      game.emit({ kind: 'hold', seat: m.info.id, until, of: 'wheel' });
      break;
    }
    // ---- MB-10C: movers ----
    case 'wheel': {
      // A bucket catches the marble at the rim band and carries it to the release angle.
      if (m.hold || game.time < m.tunnelSafeUntil) break;
      const motion = md.motion;
      if (!motion || motion.mode !== 'spin' || !md.wheel) break;
      const P = motion.pivot;
      const dxw = m.body.position.x - P.x, dyw = m.body.position.y - P.y;
      const dist = Math.hypot(dxw, dyw);
      if (Math.abs(dist - motion.radius) > 34) break; // only the rim band rides — through-swingers pass
      const buckets = md.wheel.buckets;
      const tau = Math.PI * 2;
      const aFrom = Math.atan2(dyw, dxw);
      // nearest bucket anchor, and it must be near enough to genuinely be a bucket hit
      let bi = 0, bDiff = Infinity;
      for (let i = 0; i < buckets; i++) {
        const theta = motion.omega * (game.time + motion.phaseMs) + (i * tau) / buckets;
        let diff = (aFrom - theta) % tau;
        if (diff > Math.PI) diff -= tau;
        if (diff < -Math.PI) diff += tau;
        if (Math.abs(diff) < Math.abs(bDiff)) { bDiff = diff; bi = i; }
      }
      if (Math.abs(bDiff) * motion.radius > 30) break;
      if (md.wheel.slots[bi] > game.time) break; // someone is already riding game bucket
      // ride the arc around to the release angle, then tip out with the tangential speed
      let span = (md.wheel.release - aFrom) * Math.sign(motion.omega);
      span = ((span % tau) + tau) % tau;
      if (span < 0.35) span += tau;
      const ride = md.wheel.rideMs || span / Math.abs(motion.omega);
      let until = game.time + ride;
      // a bouncy marble can bounce out of a bucket early — the best track kits have feel
      if (!md.wheel.rideMs && (m.info.stats.bounce ?? 5) >= 8 && game.rng() < 0.3) until = game.time + Math.min(ride * 0.45, 1400);
      const tip = Math.abs(motion.omega) * motion.radius * 16.667;
      const release = md.wheel.rideMs ? aFrom + motion.omega * ride : md.wheel.release;
      const rx = P.x + Math.cos(release) * motion.radius, ry = P.y + Math.sin(release) * motion.radius;
      const sense2 = Math.sign(motion.omega) || 1;
      m.hold = {
        kind: 'wheel', until, at: game.time,
        arc: { x: P.x, y: P.y, r: motion.radius, fromA: aFrom, omega: motion.omega, release },
        exit: { x: rx, y: ry, dir: { x: -Math.sin(release) * sense2, y: Math.cos(release) * sense2 }, speed: Math.max(3, tip + 1.2) },
      };
      m.body.isSensor = true;
      Body.setVelocity(m.body, { x: 0, y: 0 });
      Body.setAngularVelocity(m.body, 0);
      md.wheel.slots[bi] = until + 700;
      game.sfx('splash', m, other.position.x, other.position.y);
      game.emit({ kind: 'sound', cue: 'splash', seat: m.info.id });
      game.emit({ kind: 'hold', seat: m.info.id, until, of: 'wheel' });
      game.effects.push({ type: 'ring', x: m.body.position.x, y: m.body.position.y, ttl: 18, maxTtl: 18, color: '#7dd3fc' });
      break;
    }
    case 'screw': {
      // The tube swallows the marble and turns it up to the far end; capacity queues it.
      if (m.hold || game.time < m.tunnelSafeUntil || !md.screw) break;
      const sc = md.screw;
      sc.seats = sc.seats.filter((seat) => seat.until > game.time - 500);
      if (sc.seats.length >= sc.cap) break;
      if (Math.hypot(m.body.position.x - sc.a.x, m.body.position.y - sc.a.y) > 85) break;
      let slip = 0;
      let ms = sc.ms;
      // light marbles slip back occasionally — a seeded wobble that costs a little time
      if ((m.info.stats.weight ?? 5) <= 3 && game.rng() < 0.5) { slip = 1; ms += 650; }
      const until = game.time + ms;
      const len = Math.hypot(sc.b.x - sc.a.x, sc.b.y - sc.a.y) || 1;
      m.hold = {
        kind: 'screw', until, at: game.time, transit: ms, slip,
        from: { x: sc.a.x, y: sc.a.y },
        exit: { x: sc.b.x, y: sc.b.y, dir: { x: (sc.b.x - sc.a.x) / len, y: (sc.b.y - sc.a.y) / len }, speed: 3.4 },
      };
      m.body.isSensor = true;
      Body.setVelocity(m.body, { x: 0, y: 0 });
      Body.setAngularVelocity(m.body, 0);
      sc.seats.push({ seat: m.info.id, until });
      game.sfx('whirr', m, sc.a.x, sc.a.y);
      game.emit({ kind: 'sound', cue: 'whirr', seat: m.info.id });
      game.emit({ kind: 'hold', seat: m.info.id, until, of: 'screw' });
      break;
    }
    // ---- MB-10D: launchers and pinball ----
    case 'cannon': {
      // Only the capture mouth loads (the collar itself is solid); the elementState scan also
      // calls game, because a marble that parked on the collar while it was occupied earns a load.
      if (!other.isSensor) break;
      game.tryLoadCannon(m, other);
      break;
    }

    case 'catapult': {
      // Only the spoon catches (the arm is a solid blur while it swings); the elementState scan
      // shares game so a marble resting in the bowl while it was occupied still gets its fling.
      if (!other.isSensor) break;
      game.tryLoadCatapult(m, other);
      break;
    }
    case 'sling': {
      // The rubber face shoves back along its set normal, scaled by the marble's bounce stat.
      if (!md.sling) break;
      const side = (m.body.position.x - other.position.x) * md.sling.facing.x + (m.body.position.y - other.position.y) * md.sling.facing.y;
      if (side < -6) break; // came around the frame — only the band face is springy
      if (game.time < (m.slingAt ?? -1e9) + 900) break;
      m.slingAt = game.time;
      const bnc = 0.7 + 0.09 * (m.info.stats.bounce ?? 5);
      const weightFactor = 1 + (5 - (m.info.stats.weight ?? 5)) * 0.1;
      const k = md.sling.strength * bnc * weightFactor;
      const v = Body.getVelocity(m.body);
      Body.setVelocity(m.body, { x: v.x + md.sling.facing.x * k, y: v.y + md.sling.facing.y * k });
      md.sling.flashAt = game.time;
      game.emit({ kind: 'sling', i: game.indexOf(other) });
      game.sfx('twang', m, other.position.x, other.position.y);
      game.emit({ kind: 'sound', cue: 'twang' });
      break;
    }
    case 'bridge': {
      // Bounce marbles bounce the planks: a little downward shove the spring chain answers.
      const imp = 0.4 + (m.info.stats.bounce ?? 5) * 0.18;
      if (game.time >= (md.cooldownUntil ?? 0)) {
        md.cooldownUntil = game.time + 300;
        md.sagVel = (md.sagVel ?? 0) + imp;
        if (imp > 1.2) game.sfx('groan', m, other.position.x, other.position.y);
      }
      break;
    }
    // ---- MB-10B: blades and crushers (all kinematic; guests never simulate these contacts) ----
    case 'blade': {
      // grazing touches don't count: the flat scrubs you, the edge writes you a flight plan.
      // (Start pairs do, and the matter solver usually blurs blade contacts into 'active'
      // contactSurface hits — game one fires when a mid-swing blade meets a marble.)
      const relSpeed = Body.getSpeed(m.body) + (md.motion?.mode === 'pendulum' ? Math.abs(pendulumOmega(md.motion, game.time)) * md.motion.arm : 0);
      if (relSpeed < 0.5) break;
      // one shove per swing — the blade sweeps through the pack once, not every sub-step
      if (game.time < (md.cooldownUntil ?? 0)) break;
      md.cooldownUntil = game.time + 600;
      // Timed wrong: knocked back with a shriek. Heavy marbles shrug more of it off; a frozen
      // marble is brittle and gets launched twice as hard. (Ghosts never meet it.)
      const motion = md.motion;
      let pvx = 0, pvy = 0;
      if (motion && motion.mode === 'pendulum') {
        const omega = pendulumOmega(motion, game.time);
        pvx = -omega * (m.body.position.y - motion.pivot.y);
        pvy = omega * (m.body.position.x - motion.pivot.x);
      }
      const dx = m.body.position.x - other.position.x, dy = m.body.position.y - other.position.y;
      const d = Math.hypot(dx, dy) || 1;
      const frozen = game.time < m.frozenUntil;
      const light = 1 / Math.sqrt(m.body.mass / 0.8);
      const k = 2.6 * light * (frozen ? 2.2 : 1);
      const v = Body.getVelocity(m.body);
      Body.setVelocity(m.body, {
        // backwards scrape: kill most uphill speed, give a little tip-velocity shove
        x: v.x * 0.55 + pvx * 0.6 + (dx / d) * k,
        y: Math.min(v.y * 0.4, 2) + pvy * 0.5 + (dy / d) * k - 1,
      });
      game.shake = Math.max(game.shake, 5);
      game.sfx('shriek', m, other.position.x, other.position.y);
      game.emit({ kind: 'sound', cue: 'shriek', seat: m.info.id });
      game.effects.push({ type: 'debris', x: m.body.position.x, y: m.body.position.y, ttl: 14, maxTtl: 14, color: '#fef08a', particles: game.makeParticles(m.body.position.x, m.body.position.y, 7, 4).map((p) => ({ ...p, vy: -Math.abs(p.vy) })) });
      game.effects.push({ type: 'ring', x: m.body.position.x, y: m.body.position.y, ttl: 12, maxTtl: 12, color: '#e2e8f0' });
      break;
    }
    case 'saw': {
      // one hop per pass — a marble sitting on the slot isn't machine-gunned
      if (game.time < (md.cooldownUntil ?? 0)) break;
      md.cooldownUntil = game.time + 700;
      // The disc's rim throws marbles up and away from its travel direction. Bounce raises the
      // toss; a Heavy-metal marble ploughs over with a small bump instead.
      const motion = md.motion;
      const v = Body.getVelocity(m.body);
      const bounce = m.info.stats.bounce;
      const anvil = game.time < m.anvilUntil;
      const above = m.body.position.y < other.position.y - 6;
      if (anvil) {
        Body.setVelocity(m.body, { x: v.x, y: above ? -2.5 : v.y * 0.4 });
        game.sfx('clang', m, other.position.x, other.position.y);
        break;
      }
      const spin = motion && motion.mode === 'slide' ? motion.spinW : 0;
      const slide = motion && motion.mode === 'slide' ? slideDir(motion, game.time) : 1;
      const spinSide = Math.sign(spin || 1) * slide;
      const toss = above ? -(5.2 + bounce * 0.5) : -(2.5 + bounce * 0.3);
      Body.setVelocity(m.body, { x: v.x * 0.5 + spinSide * (2 + Math.abs(spin) * 3), y: v.y * 0.2 + toss });
      game.sfx('grind', m, other.position.x, other.position.y);
      game.emit({ kind: 'sound', cue: 'grind', seat: m.info.id });
      game.shake = Math.max(game.shake, 4);
      game.effects.push({ type: 'debris', x: m.body.position.x, y: m.body.position.y, ttl: 16, maxTtl: 16, color: '#fca5a5', particles: game.makeParticles(m.body.position.x, m.body.position.y, 9, 4.5) });
      break;
    }
    case 'boulder': {
      // bowled over once per contact — the boulder keeps rolling, the marble keeps racing
      if (game.time < (md.cooldownUntil ?? 0)) break;
      md.cooldownUntil = game.time + 650;
      // Bowled over: thrown along the boulder's travel; Jump hops it instead. Weight decides
      // the shove — a heavy marble guts it out where a light one is sent flying.
      const motion = md.motion;
      const v = Body.getVelocity(m.body);
      if (game.time < m.jumpUntil) {
        Body.setVelocity(m.body, { x: v.x, y: -9.5 - m.info.stats.bounce * 0.2 });
        game.sfx('spring', m, m.body.position.x, m.body.position.y);
        game.effects.push({ type: 'ring', x: m.body.position.x, y: m.body.position.y, ttl: 16, maxTtl: 16, color: '#a7f3d0' });
        break;
      }
      const dir = motion && motion.mode === 'roll' ? pathAt(motion, rollAt(motion, game.time, md.triggeredAt ?? null).d).dir : { x: 0, y: 1 };
      const k = 6.2 * (1 / Math.sqrt(m.body.mass / 0.8));
      Body.setVelocity(m.body, { x: v.x * 0.35 + dir.x * k, y: v.y * 0.35 + dir.y * k - 2 });
      game.sfx('thud', m, other.position.x, other.position.y);
      game.sfx('clack', m, other.position.x, other.position.y);
      game.shake = Math.max(game.shake, 4);
      game.effects.push({ type: 'snow', x: other.position.x, y: other.position.y, ttl: 22, maxTtl: 22, color: '#b8a88f', particles: game.makeParticles(other.position.x, other.position.y, 8, 2.5) });
      break;
    }
    case 'mace': {
      // one scything per pass
      if (game.time < (md.cooldownUntil ?? 0)) break;
      md.cooldownUntil = game.time + 550;
      // Scythed: knocked radially away from the pivot with the arm's sweep behind it; bouncy
      // marbles ricochet further, frozen ones shatter-fly, and the ball is never mistaken for
      // the track: it sparks on contact.
      const motion = md.motion;
      const v = Body.getVelocity(m.body);
      let nx = 0, ny = 1, sweepX = 0;
      if (motion && motion.mode === 'sweep') {
        nx = m.body.position.x - motion.pivot.x;
        ny = m.body.position.y - motion.pivot.y;
        const d = Math.hypot(nx, ny) || 1;
        nx /= d; ny /= d;
        // sweep drive: while the program is moving, add a push along the current sweep side
        const half = motion.sweepMs + motion.pauseMs;
        const t = (md.eased ?? 0) * (half * 2);
        const sliding = t < motion.sweepMs || (t >= half && t < half + motion.sweepMs);
        sweepX = sliding ? (t < half ? 2.4 : -2.4) : 0;
      }
      const frozen = game.time < m.frozenUntil;
      const k = 8.5 * (1 + m.info.stats.bounce * 0.07) * (1 / Math.sqrt(m.body.mass / 0.8)) * (frozen ? 1.8 : 1);
      Body.setVelocity(m.body, { x: v.x * 0.2 + nx * k + sweepX, y: v.y * 0.2 + ny * k - 2 });
      game.sfx('clang', m, other.position.x, other.position.y);
      game.shake = Math.max(game.shake, 5);
      game.effects.push({ type: 'ring', x: m.body.position.x, y: m.body.position.y, ttl: 14, maxTtl: 14, color: '#cbd5e1' });
      game.effects.push({ type: 'debris', x: m.body.position.x, y: m.body.position.y, ttl: 14, maxTtl: 14, color: '#fef08a', particles: game.makeParticles(m.body.position.x, m.body.position.y, 6, 4) });
      break;
    }
    case 'crusher': {
      // Brushed by the plate casing: a dull clunk (the pin itself is handled by docking).
      if (Body.getSpeed(m.body) > 4) game.sfx('thud', m, other.position.x, other.position.y);
      break;
    }
    case 'pad': {
      if (game.time < m.padCooldownUntil) break;
      m.padCooldownUntil = game.time + 600;
      const dir = md.dir ?? { x: -1, y: -1 };
      const vy = Math.min(12.2, 3.5 + 9.5 * m.restitution);
      game.pendingLaunches.set(m.info.id, { x: dir.x * 4.5, y: -vy });
      game.sfx('spring', m, other.position.x, other.position.y);
      game.storyCounter('pads', m); // STORY HOOK (ST-07)
      game.effects.push({ type: 'ring', x: other.position.x, y: other.position.y - 10, ttl: 20, maxTtl: 20, color: '#34d399' });
      // Pad, bucket, gate and countdown have no event of their own, so they
      // cross as a cue. A booster does not: it fires every step, and a guest
      // can see a marble is on a booster from the track it already built.
      game.emit({ kind: 'sound', cue: 'pad', seat: m.info.id });
      if (m.info.isPlayer) game.onEvent?.(`Boing! Bounce power ${(m.restitution * 100).toFixed(0)}%`, '#34d399');
      break;
    }
    case 'itembox': {
      if (!md.active) break;
      const pool = game.dropPool ?? (game.track.platformer ? ITEM_POOL : LEGACY_ITEMS); // classic drops keep the original eight
      const available = pool.filter((item) => m.inventory[item] < MAX_ITEM_STACK);
      if (!available.length) break;
      md.active = false;
      md.respawnAt = game.time + 7000;
      game.grantItem(m, available[Math.floor(game.rng() * available.length)]);
      // P2-20: Lucky Draw — a slice of boxes pays out twice. The talent check comes FIRST so a
      // marble without it never spends an rng roll (the classic race stream stays byte-identical).
      if ((m.tfx?.boxLuckPct ?? 0) > 0 && game.rng() * 100 < (m.tfx?.boxLuckPct ?? 0)) {
        const spare = pool.filter((item) => m.inventory[item] < MAX_ITEM_STACK);
        if (spare.length) game.grantItem(m, spare[Math.floor(game.rng() * spare.length)]);
      }
      game.sfx('pickup', m, other.position.x, other.position.y);
      game.storyCounter('itemBoxes', m); // STORY HOOK (ST-07)
      game.emit({ kind: 'box', i: game.indexOf(other), taken: true, seat: m.info.id });
      game.effects.push({ type: 'ring', x: other.position.x, y: other.position.y, ttl: 18, maxTtl: 18, color: '#facc15' });
      break;
    }
    case 'ppeg': {
      if (md.hit) break;
      md.hit = true;
      md.hitAt = game.time;
      game.poppingPegs.add(other);
      game.emit({ kind: 'peg', i: game.indexOf(other), seat: m.info.id });
      const col = md.pegColor ?? 'blue';
      game.sfx('peg', m, other.position.x, other.position.y, { color: col });
      const pc = col === 'orange' ? '#fb923c' : col === 'green' ? '#4ade80' : '#60a5fa';
      game.effects.push({ type: 'ring', x: other.position.x, y: other.position.y, ttl: 14, maxTtl: 14, color: pc });
      game.effects.push({ type: 'debris', x: other.position.x, y: other.position.y, ttl: 22, maxTtl: 22, color: pc, particles: game.makeParticles(other.position.x, other.position.y, 6, 2.5) });
      if (col === 'orange') {
        m.pegs++;
        game.storyCounter('orangePegs', m); // STORY HOOK (ST-07)
        // orange pegs give a little kick of speed
        const v = Body.getVelocity(m.body);
        const sp = Math.hypot(v.x, v.y) || 1;
        Body.setVelocity(m.body, { x: v.x + (v.x / sp) * 1.5, y: v.y + (v.y / sp) * 1.5 + 0.5 });
        game.effects.push({ type: 'text', x: other.position.x, y: other.position.y - 20, ttl: 40, maxTtl: 40, color: '#fdba74', text: '+1 PEG' });
      } else if (col === 'green') {
        const drops: readonly ItemType[] = game.dropPool ?? LEGACY_ITEMS;
        game.grantItem(m, md.itemDrop && drops.includes(md.itemDrop) ? md.itemDrop : drops[Math.floor(game.rng() * drops.length)]);
        game.effects.push({ type: 'text', x: other.position.x, y: other.position.y - 20, ttl: 40, maxTtl: 40, color: '#86efac', text: 'POWER!' });
      }
      break;
    }
    case 'bucket': {
      if (game.time < (md.cooldownUntil ?? 0)) break;
      // P2-26c: on a platformer course the cart is a shuttle over a chasm: hop in, ride to the far end, roll off.
      if (game.track.platformer && md.cartX !== undefined) { holds.boardCart(game, m, other); break; }
      md.cooldownUntil = game.time + 250;
      Body.setPosition(m.body, { x: other.position.x, y: other.position.y + 30 });
      game.pendingLaunches.set(m.info.id, { x: 0, y: 17 });
      game.sfx('bucket', m, other.position.x, other.position.y);
      game.storyCounter('buckets', m); // STORY HOOK (ST-07)
      m.trail = [];
      game.shake = 6;
      game.effects.push({ type: 'ring', x: other.position.x, y: other.position.y, ttl: 24, maxTtl: 24, color: '#fbbf24' });
      game.effects.push({ type: 'text', x: other.position.x, y: other.position.y - 30, ttl: 60, maxTtl: 60, color: '#fbbf24', text: 'ALL ABOARD!' });
      if (m.info.isPlayer) game.onEvent?.('ALL ABOARD! Minecart express', '#fbbf24');
      game.emit({ kind: 'sound', cue: 'bucket', seat: m.info.id });
      break;
    }
    case 'finish': {
      game.finishMarble(m);
      break;
    }
    case 'peg': {
      if (Body.getSpeed(m.body) > 2) game.sfx('bump', m, other.position.x, other.position.y);
      break;
    }
    case 'ramp':
    case 'wall':
    case 'loop':
      if (m.info.isPlayer && Body.getSpeed(m.body) > 6) game.sfx('thud', m, m.body.position.x, m.body.position.y);
      break;
    default:
      break;
  }
}

export function onCollisionActive(game: Game, e: Matter.IEventCollision<Matter.Engine>) {
  for (const pair of e.pairs) {
    const a = pair.bodyA;
    const b = pair.bodyB;
    const ma = game.marbleOf(a);
    const mb = game.marbleOf(b);
    const m = ma ?? mb;
    const other = ma ? b : a;
    if (!m || (ma && mb) || m.frozen || m.finishedAt !== null || !game.gateOpen) continue;
    const md = meta(other);
    if (!md) continue;
    // P2-00: touching a platformer floor below the marble's middle counts as grounded.
    if (md.kind === 'floor' || md.kind === 'ledge') {
      const support = pair.collision.supports[0];
      if (support && support.y > m.body.position.y + 6) m.grounded = 0;
    }
    // MB-10B skins paint contact flashes; reuse the one-shove-per-pass debounce so a marble
    // resting on a machine doesn't redraw its burst 120 times a second.
    if ((md.kind === 'blade' || md.kind === 'saw' || md.kind === 'mace' || md.kind === 'boulder') && game.time < (md.cooldownUntil ?? 0)) continue;
    game.contactSurface(m, other, pair);
    // A marble too slow to make the loop settles at the bottom; let it roll out instead of rocking forever.
    if (md.kind === 'loopBail' && m.loopStage === 0 && Body.getSpeed(m.body) < 2.5) game.setLoopStage(m, 1);
    if (md.kind === 'boost' && md.dir) {
      const v = Body.getVelocity(m.body);
      const k = 0.45 * Math.sqrt(1 / m.body.mass) * game.engine.timing.lastDelta / BASE_TICK;
      Body.setVelocity(m.body, { x: v.x + md.dir.x * k, y: v.y + md.dir.y * k });
      if (game.rng() < 0.3) {
        game.effects.push({
          type: 'debris',
          x: m.body.position.x,
          y: m.body.position.y,
          ttl: 14,
          maxTtl: 14,
          color: '#fb923c',
          particles: game.makeParticles(m.body.position.x, m.body.position.y, 2, 1.5),
        });
      }
    }
  }
}

export function contactSurface(game: Game, m: Marble, obstacle: Matter.Body, pair: Matter.Pair, landing = false) {
  const omd = meta(obstacle);
  // MB-10B: danger bodies carry no ramp surface, so a marble resting on (or grinding against)
  // one falls here instead of marbleHits. Apply the same one-shove-per-beat knock the
  // collision-start path gives, straight from game pair.
  if (omd && !m.frozen && m.finishedAt === null && (omd.kind === 'blade' || omd.kind === 'saw' || omd.kind === 'mace' || omd.kind === 'crusher' || omd.kind === 'boulder') && game.time >= (omd.cooldownUntil ?? 0)) {
    game.marbleHits(m, obstacle);
  }
  // P2-20: Steady Hands — the FIRST contact of a hard landing (impact over the same 1.3 the stick
  // rule uses) hands back a slice of the roll as tangential speed. The normal comes from the pair,
  // so platformer floors (which carry no ramp surface) get it too. Talent only: a marble without
  // `landingKeepPct` runs the exact physics it always did — the engine checksum covers this path.
  if (landing) {
    const keep = m.tfx?.landingKeepPct ?? 0;
    const n = pair.collision?.normal;
    if (keep > 0 && n) {
      const v = Body.getVelocity(m.body);
      const impact = Math.abs(v.x * n.x + v.y * n.y);
      if (impact >= 1.3) {
        const tx = -n.y, ty = n.x;
        const along = v.x * tx + v.y * ty;
        Body.setVelocity(m.body, { x: v.x + tx * along * keep / 100, y: v.y + ty * along * keep / 100 });
      }
    }
  }
  const surface = omd?.surface;
  if (!surface || m.frozen || m.finishedAt !== null) return;
  const offset = { x: m.body.position.x - surface.start.x, y: m.body.position.y - surface.start.y };
  if (offset.x * surface.normal.x + offset.y * surface.normal.y < 0) return;
  game.supports.set(m.info.id, surface);
  pair.friction = game.time < m.aeroUntil ? 0 : 0.002;
  pair.frictionStatic = 0;
  const velocity = Body.getVelocity(m.body);
  const impact = Math.abs(velocity.x * surface.normal.x + velocity.y * surface.normal.y);
  if (impact < 1.3) pair.restitution = 0;
  // MB-10C conveyor: the belt shoves marbles along its tangent. Slipstream friction-free
  // marbles ignore it; the Speed stat helps you fight a belt running against you.
  if (omd.kind === 'conveyor' && omd.belt && game.time >= m.aeroUntil) {
    const belt = omd.belt;
    const dir = beltDir(belt, game.time);
    const tangent = surface.tangent;
    const along = velocity.x * tangent.x + velocity.y * tangent.y;
    const fighting = dir * along < 0;
    const scale = fighting ? 1 - 0.45 * ((m.info.stats.speed - 1) / 9) : 1;
    const targetV = dir * belt.v * 50; // Convert 0.16 into ~8 px/step so it actually shoves the marble
    const pull = (targetV - along) * 0.09 * scale;
    Body.setVelocity(m.body, { x: velocity.x + tangent.x * pull, y: velocity.y + tangent.y * pull });
    pair.friction = 0.015;
  }
}
