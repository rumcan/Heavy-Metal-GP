// Moving machines and elements: per-step state of every element, dynamic movers, bridge chains.
// Split out of engine.ts (P2-00a). Every function takes the Game as `game`; Game's methods delegate here.
import Matter from 'matter-js';
import { meta, bridgePlankPose, flipperAngle } from '../track';
import { elementBodies, hasElement, hingeTimerState, pistonState, rollAt } from '../elements';









import * as fields from './fields';
import { Game, Body, Query } from '../engine';


export function moverDynamics(game: Game, dt: number) {
  // ---- seesaw ----
  for (const plank of elementBodies(game.track, 'seesaw')) {
    const ss = meta(plank).seesaw;
    if (!ss) continue;
    // torque from riders: mass × signed distance along the plank
    let torque = 0;
    const cos = Math.cos(ss.angle), sin = Math.sin(ss.angle);
    for (const m of game.marbles) {
      if (m.finishedAt !== null || m.hold) continue;
      const dx = m.body.position.x - plank.position.x, dy = m.body.position.y - plank.position.y;
      const along = dx * cos + dy * sin, across = -dx * sin + dy * cos;
      if (Math.abs(along) > ss.len * 0.55 || across < -22 || across > 6) continue;
      torque += m.body.mass * along;
      // plank tip velocity shoves the rider out of the way — the catapult
      if (Math.abs(ss.angVel) > 0.0004) {
        const tipVy = ss.angVel * along;
        const v = Body.getVelocity(m.body);
        if (tipVy < v.y - 0.2) Body.setVelocity(m.body, { x: v.x, y: v.y + (tipVy - v.y) * 0.4 });
      }
    }
    // angle ODE: gravity torque vs damping, clamped at the stone stops
    ss.angVel += torque * 0.0002 * dt;
    ss.angVel *= Math.pow(ss.damp, dt / 16.667);
    ss.angle += ss.angVel * dt;
    if (ss.angle < ss.min) { ss.angle = ss.min; if (ss.angVel < 0) ss.angVel = 0; }
    if (ss.angle > ss.max) { ss.angle = ss.max; if (ss.angVel > 0) ss.angVel = 0; }
    (Body.setAngle as unknown as (b: Matter.Body, a: number, u: boolean) => void)(plank, ss.angle, true);
    // stream the state, throttled — a resting plank barely talks
    if ((ss.emittedAt === undefined ? Infinity : game.time - ss.emittedAt) > (Math.abs(ss.angVel) > 0.0002 ? 150 : 1200) && Math.abs(ss.angle) + Math.abs(ss.angVel * 400) > 0.004) {
      ss.emittedAt = game.time;
      game.emit({ kind: 'seesaw', i: game.track.bodies.indexOf(plank), angle: ss.angle, angVel: ss.angVel });
    }
  }
  // ---- rope bridge ----
  for (const chain of game.bridgeChains()) {
    const headFull = meta(chain[0]);
    const n = chain.length;
    const sags: number[] = new Array(n);
    let groan = 0;
    for (let i = 0; i < n; i++) {
      const bd = chain[i];
      const mdp = meta(bd);
      const br = mdp.bridge!;
      // riders press game plank down — spring toward the pressed depth
      let load = 0;
      for (const m of game.marbles) {
        if (m.finishedAt !== null || m.hold) continue;
        const dx = m.body.position.x - bd.position.x, dy = m.body.position.y - bd.position.y;
        if (Math.abs(dx) < br.plankLen * 0.75 && dy > -28 && dy < 8) load += m.body.mass;
      }
      // neighbour planks share the dip — a chain pulls its neighbours
      const left = (meta(chain[Math.max(0, i - 1)]).sag ?? 0), right = (meta(chain[Math.min(n - 1, i + 1)]).sag ?? 0);
      const target = Math.min(90, load * 5.2) + (left + right) * 0.14 - (mdp.sag ?? 0) * (i > 0 || i < n - 1 ? 0.06 : 0);
      mdp.sagVel = (mdp.sagVel ?? 0) + (target - (mdp.sag ?? 0)) * 0.030 * (dt / 16.667);
      mdp.sagVel *= Math.pow(0.94, dt / 16.667);
      mdp.sag = (mdp.sag ?? 0) + mdp.sagVel * (dt / 16.667);
      sags[i] = mdp.sag;
      groan += load;
    }
    for (let i = 0; i < n; i++) {
      const mdp = meta(chain[i]);
      const br = mdp.bridge!;
      const pose = bridgePlankPose(br.anchor, br.slack, i, n, sags);
      (Body.setPosition as unknown as (b: Matter.Body, p: Matter.Vector, u: boolean) => void)(chain[i], { x: pose.x, y: pose.y }, true);
      (Body.setAngle as unknown as (b: Matter.Body, a: number, u: boolean) => void)(chain[i], pose.angle, true);
    }
    // a heavy pack groans the whole span (host-side cue, throttled)
    if (groan > 6 && game.time - (headFull.hitAt ?? -9999) > 2400) {
      headFull.hitAt = game.time;
      const mid = chain[Math.floor(n / 2)];
      game.sfx('groan', null, mid.position.x, mid.position.y);
      game.emit({ kind: 'sound', cue: 'groan' });
    }
    // stream the chain, throttled at a low rate while it moves
    const moving = sags.some((v, i) => Math.abs(v) > 1 || Math.abs(meta(chain[i]).sagVel ?? 0) > 0.05);
    const headMd = meta(chain[0]);
    if (moving && game.time - (headMd.syncAt ?? 0) > 250) {
      headMd.syncAt = game.time;
      game.emit({ kind: 'bridge', i: game.track.bodies.indexOf(chain[0]), sag: sags.map((v) => Math.round(v * 10) / 10) });
    }
  }
}

export function bridgeChains(game: Game): Matter.Body[][]  {
  if (!game.bridgeCache) {
    const bridges = elementBodies(game.track, 'bridge');
    const chains: Matter.Body[][] = [];
    let cur: Matter.Body[] = [];
    for (const b of bridges) {
      const br = meta(b).bridge;
      if (!br) continue;
      if (br.idx === 0 && cur.length) { chains.push(cur); cur = []; }
      cur.push(b);
    }
    if (cur.length) chains.push(cur);
    // state arrays guests blend toward arrive filled with the resting chain
    game.bridgeCache = chains;
  }
  return game.bridgeCache;
}

export function elementState(game: Game, dt: number) {
  for (const door of elementBodies(game.track, 'trapdoor')) {
    const md = meta(door);
    if (md.destroyed || !md.motion || md.motion.mode !== 'hinge') continue;
    if (md.mode === 'timer') {
      // The clock drives the pose; the creak rides the cable so every client hears the swing.
      const st = hingeTimerState(md.motion, game.time);
      const k = md.motion.openAngle !== 0 ? Math.min(1, Math.abs(st.angle / md.motion.openAngle)) : st.angle !== 0 ? 1 : 0;
      const prev = md.eased ?? 0;
      if ((prev < 0.5) !== (k < 0.5)) {
        game.sfx('creak', game.player, door.position.x, door.position.y);
        game.emit({ kind: 'sound', cue: 'creak' });
      }
      md.eased = k;
      continue;
    }
    if (md.openNow) {
      if (game.time - (md.openedAt ?? 0) >= (md.openMs ?? 1200)) {
        md.openNow = false;
        md.restSince = 0;
        game.sfx('creak', game.player, door.position.x, door.position.y);
        game.emit({ kind: 'trapdoor', i: game.indexOf(door), open: false });
        game.emit({ kind: 'sound', cue: 'creak' });
      }
      continue;
    }
    // the pack weight resting on the closed door: heavy marbles — or a whole pile — open it
    let mass = 0;
    let playerResting = false;
    const motion = md.motion;
    const top = motion.pivot.y;
    for (const m of game.marbles) {
      if (m.finishedAt !== null || m.frozen || m.hold) continue;
      const p = m.body.position;
      if (Math.abs(p.x - door.position.x) < motion.len / 2 + 10 && p.y > top - 34 && p.y < top + 12 && Math.abs(m.body.velocity.y) < 2.5) {
        mass += m.body.mass;
        if (m.info.isPlayer) playerResting = true;
      }
    }
    if (mass >= (md.weightKg ?? 2.4)) {
      md.restSince = (md.restSince ?? 0) + dt;
      if (md.restSince >= (md.holdMs ?? 300)) {
        md.openNow = true;
        md.openedAt = game.time;
        md.restSince = 0;
        game.sfx('creak', game.player, door.position.x, door.position.y);
        game.emit({ kind: 'trapdoor', i: game.indexOf(door), open: true });
        game.emit({ kind: 'sound', cue: 'creak' });
        if (playerResting) game.onEvent?.('The hatch gives way!', '#fbbf24');
      }
    } else md.restSince = 0;
  }

  // MB-10B crushers: the slam docks, dust flies, and whatever was under the plate is pinned for
  // a beat (Heavy-metal marbles shrug it off; Slipstream slips free early). All pose is clock —
  // the pin affects only marble bodies, which MP guests mirror from the frames they receive.
  for (const plate of elementBodies(game.track, 'crusher')) {
    const md = meta(plate);
    const motion = md.motion;
    if (!motion || motion.mode !== 'piston' || md.destroyed) continue;
    const st = pistonState(motion, game.time);
    const was = md.eased ?? 0;
    md.eased = st.k;
    if (st.warn && game.time - (md.rumbledAt ?? -1e9) > motion.periodMs * 0.9) {
      let near = false;
      for (const m of game.marbles) {
        if (m.finishedAt !== null) continue;
        const p = m.body.position;
        if (p.y > motion.top.y && p.y < motion.top.y + motion.travel + 320 && Math.abs(p.x - motion.top.x) < 340) { near = true; break; }
      }
      if (near) {
        md.rumbledAt = game.time;
        game.sfx('rumble', game.player, motion.top.x, motion.top.y + motion.travel);
        game.emit({ kind: 'sound', cue: 'rumble' });
      }
    }
    if (was < 0.995 && st.k >= 0.995) {
      // the slam lands
      const floorY = motion.top.y + 22 + motion.travel;
      game.shake = Math.max(game.shake, 6);
      game.sfx('slam', game.player, motion.top.x, floorY);
      game.emit({ kind: 'sound', cue: 'slam' });
      game.effects.push({ type: 'snow', x: motion.top.x, y: floorY + 14, ttl: 26, maxTtl: 26, color: '#d6d3d1', particles: game.makeParticles(motion.top.x, floorY + 12, 12, 3) });
      game.effects.push({ type: 'flash', x: motion.top.x, y: floorY + 10, ttl: 8, maxTtl: 8, color: '#e7e5e4' });
      const bounds = plate.bounds;
      for (const m of game.marbles) {
        const p = m.body.position;
        if (m.finishedAt !== null || m.hold || m.frozen) continue;
        if (game.time - m.crushMarkAt < 400) continue;
        if (p.x < bounds.min.x - 20 || p.x > bounds.max.x + 20) continue;
        if (p.y < floorY - 40 || p.y > floorY + 40) continue;
        m.crushMarkAt = game.time;
        // Heavy metal never pins; Slipstream slips out early; everyone else eats 600ms of deck.
        if (game.time < m.anvilUntil || m.body.mass >= 9) continue;
        m.crushCount++;
        if (m.crushCount === 1) {
          m.crushedUntil = game.time + (game.time < m.aeroUntil ? 180 : 600);
          Body.setVelocity(m.body, { x: 0, y: 0 });
          if (m.info.isPlayer) game.onEvent?.('SQUASHED!', '#d6d3d1');
          else game.effects.push({ type: 'text', x: p.x, y: p.y - 24, ttl: 40, maxTtl: 40, color: '#e7e5e4', text: 'SQUASHED' });
        } else {
          const side = p.x < motion.top.x ? -1 : 1;
          Body.setVelocity(m.body, { x: side * 35, y: -5 });
          m.crushCount = 0;
          if (m.info.isPlayer) game.onEvent?.('EJECTED!', '#f87171');
          else game.effects.push({ type: 'text', x: p.x, y: p.y - 24, ttl: 40, maxTtl: 40, color: '#f87171', text: 'EJECTED' });
        }
      }
    }
  }

  for (const boulder of elementBodies(game.track, 'boulder')) {
    const md = meta(boulder);
    const motion = md.motion;
    if (!motion || motion.mode !== 'roll') continue;

    if (md.triggeredAt === undefined) {
      let near = false;
      for (const m of game.marbles) {
        if (m.finishedAt !== null) continue;
        if (Math.hypot(m.body.position.x - boulder.position.x, m.body.position.y - boulder.position.y) < 500) {
          near = true;
          break;
        }
      }
      if (near) md.triggeredAt = game.time + motion.delay;
    } else {
      const { rolling } = rollAt(motion, game.time, md.triggeredAt);
      if (rolling) {
        for (const other of game.track.bodies) {
          const omd = meta(other);
          if (omd.kind !== 'barricade' && omd.kind !== 'crumble') continue;
          if (omd.hp !== undefined && omd.hp <= 0) continue;

          if (Query.collides(boulder, [other]).length > 0) {
            omd.hp = 0;
            if (omd.kind === 'crumble') {
              game.emit({ kind: 'crate', i: game.indexOf(other), hp: 0, broken: true });
              game.sfx('crack', game.player, other.position.x, other.position.y);
              game.effects.push({
                type: 'debris', x: other.position.x, y: other.position.y, ttl: 40, maxTtl: 40, color: '#fcd34d',
                particles: game.makeParticles(other.position.x, other.position.y, 22, 6),
              });
            } else if (omd.kind === 'barricade') {
              game.emit({ kind: 'crate', i: game.indexOf(other), hp: 0, broken: true });
              game.sfx('smash', game.player, other.position.x, other.position.y);
              game.effects.push({
                type: 'debris', x: other.position.x, y: other.position.y, ttl: 50, maxTtl: 50, color: '#d6a04e',
                particles: game.makeParticles(other.position.x, other.position.y, 22, 7),
              });
              game.effects.push({ type: 'text', x: other.position.x, y: other.position.y - 30, ttl: 70, maxTtl: 70, color: '#fca5a5', text: 'NO ENTRY!' });
            }
            if (!game.pendingBreaks.some((p) => p.body === other)) {
              game.pendingBreaks.push({ body: other, marble: game.marbles[0], v: { x: 0, y: 0 } });
            }
          }
        }
      }
    }
  }
  // pinned marbles wait it out
  for (const m of game.marbles) {
    if (m.crushedUntil > game.time && m.finishedAt === null) {
      Body.setVelocity(m.body, { x: 0, y: 0 });
      m.stuckTime = 0;
    }
  }
  // MB-10D launcher catch-up scans: contact START misses a marble that crept into the mouth
  // while the launcher was busy. Once it's free, the next frame claims the parked marble — game
  // is also the AI's guarantee that a launcher never leaves somebody waiting forever.
  if (hasElement(game.track, 'cannon')) {
    for (const body of elementBodies(game.track, 'cannon')) {
      if (!body.isSensor) continue;
      const md = meta(body);
      if (!md.cannon || md.cannon.loaded) continue;
      for (const m of game.marbles) {
        if (m.hold || m.frozen || m.finishedAt !== null) continue;
        if (Math.hypot(m.body.position.x - body.position.x, m.body.position.y - body.position.y) <= 52) { game.tryLoadCannon(m, body); break; }
      }
    }
  }
  if (hasElement(game.track, 'catapult')) {
    for (const body of elementBodies(game.track, 'catapult')) {
      if (!body.isSensor) continue;
      const md = meta(body);
      if (!md.catapult || md.catapult.loadedAt !== null) continue;
      for (const m of game.marbles) {
        if (m.hold || m.frozen || m.finishedAt !== null) continue;
        if (Math.hypot(m.body.position.x - body.position.x, m.body.position.y - body.position.y) <= 46) { game.tryLoadCatapult(m, body); break; }
      }
    }
  }
  // MB-10E fields and surfaces (wind, magnets, mud, geysers…): see ./fields.ts
  fields.applyFields(game);

  // ---------------- MB-10F: set pieces ----------------
  // Drop-target banks: re-arm pins, and the lane is "open" while every pin is down. All state
  // is the pinned dropAt clocks (events carry those), so hosts and guests play the same film.
  for (const bank of game.track.targetBanks) {
    let allDown = true;
    for (let k = 0; k < bank.count; k++) {
      const pin = bank.pins[k];
      const pmd = meta(pin);
      if (!pmd.target) continue;
      if (pmd.target.dropAt >= 0 && game.time - pmd.target.dropAt > bank.resetMs) {
        pmd.target.dropAt = -1;
        pin.isSensor = false;
        bank.downAt[k] = -1;
        game.emit({ kind: 'targets', i: game.track.bodies.indexOf(pin), down: 0, at: game.time });
      }
      if (pmd.target.dropAt < 0) allDown = false;
    }
    if (allDown && bank.openedAt < 0) {
      bank.openedAt = game.time;
      game.sfx('bonus', game.player, bank.pins[0].position.x, bank.pins[0].position.y);
      game.emit({ kind: 'sound', cue: 'bonus' });
    } else if (!allDown) bank.openedAt = -1;
  }
  // Vortex funnels: studio bowl. Orbit tangentially; heavy marbles sink sooner; the centre
  // hole drops you out with your arrival speed — pure field, so guests see the same drift.
  if (hasElement(game.track, 'vortex')) {
    for (const body of elementBodies(game.track, 'vortex')) {
      const md = meta(body);
      const vo = md.vortex;
      if (!vo) continue;
      for (const m of game.marbles) {
        if (m.finishedAt !== null || m.frozen || m.hold) continue;
        if (m.ghostUntil > game.time) continue; // Ghost falls straight through the spiral
        const p = m.body.position;
        const dx = vo.cx - p.x, dy = vo.cy - p.y;
        const d = Math.hypot(dx, dy);
        if (d < 1 || d > vo.r) continue;
        const v = Body.getVelocity(m.body);
        const st = m.info.stats;
        const weight = st.weight ?? 5, speed = Math.hypot(v.x, v.y);
        // tangential shove scales with how fast you arrive (speed keeps you circling)
        const tx = -dy / d, ty = dx / d;
        const spin_ = vo.spin * (0.55 + Math.min(1, speed / 14));
        const inward = 0.09 * (0.6 + weight * 0.11) * (1 - d / vo.r + 0.25);
        Body.setVelocity(m.body, {
          x: v.x + tx * spin_ * 0.09 + (dx / d) * inward,
          y: v.y + ty * spin_ * 0.09 + (dy / d) * inward,
        });
        if (d < vo.holeR && game.time - (m.vortexDropAt ?? -1e9) > 900) {
          m.vortexDropAt = game.time;
          // #99: with two or more funnels the marble teleports to a random OTHER vortex and
          // pours out below it. A lone funnel keeps the old drop-straight-through swirl exit.
          const others = elementBodies(game.track, 'vortex').filter((b2) => {
            const vo2 = meta(b2)?.vortex;
            return b2 !== body && !!vo2;
          });
          game.sfx('whoosh', m, vo.cx, vo.cy);
          game.emit({ kind: 'sound', cue: 'whoosh' });
          if (others.length) {
            const pick = others[Math.floor(game.rng() * others.length)];
            const out = meta(pick).vortex!;
            // MP-05: hop the hidden-transit channel (the tunnels' own glide): an instant
            // setPosition crosses the wire as a teleport guests chase frame by frame; a hold
            // with a transit keeps the position stream continuous — to a screen the marble
            // still vanishes into one funnel and materialises from another.
            const speed = Math.max(9, Math.abs(v.y));
            // Transit proportional to the hop: the ease-in-out's peak rate is 1.5× its mean, and
            // MP-05 budgets a guest frame at ~120 px, so the peak stays ≲ 74 px/frame.
            const dist = Math.hypot(out.cx - vo.cx, out.cy + out.r + 40 - vo.cy);
            const transit = Math.max(450, Math.min(2400, dist * 0.34));
            const until = game.time + transit;
            m.hold = {
              kind: 'tunnel',
              until,
              transit,
              from: { x: vo.cx, y: vo.cy },
              body,
              exit: { x: out.cx, y: out.cy + out.r + 40, dir: { x: 0, y: 1 }, speed },
            };
            m.tunnelSafeUntil = until + 600;
            game.emit({ kind: 'hold', seat: m.info.id, until, of: 'tunnel' });
            continue;
          }
          Body.setVelocity(m.body, { x: v.x * 0.5, y: Math.max(9, v.y) });
          Body.setPosition(m.body, { x: vo.cx, y: vo.cy + vo.r + 40 });
        }
      }
    }
  }

  // MB-10D flippers: timer program and (any) marble resting on the bat fires the snap; while
  // the bat is swinging it shoves every marble it sweeps through with its angular velocity.
  // All state is the firedAt clock, so guests replay the identical pose from the event stream.
  if (hasElement(game.track, 'flipper')) {
    for (const bat of elementBodies(game.track, 'flipper')) {
      const md = meta(bat);
      const fl = md.flipper;
      if (!fl) continue;
      const ready = game.time - fl.firedAt > fl.swingMs + fl.dropMs;
      // timer mode: fire on the seeded period
      if (fl.periodMs > 0 && ready) {
        const age = (((game.time + fl.phaseMs) % fl.periodMs) + fl.periodMs) % fl.periodMs;
        if (age < dt) {
          fl.firedAt = game.time;
          game.emit({ kind: 'flipper', i: game.track.bodies.indexOf(bat), at: fl.firedAt });
          game.sfx('snap', game.player, fl.px, fl.py);
          game.emit({ kind: 'sound', cue: 'snap' });
        }
      }
      // sensor: a marble lounging on the resting bat is asking for it
      if (ready && game.time - fl.firedAt > 160) {
        const a = fl.restA;
        const ux = Math.cos(a), uy = Math.sin(a);
        for (const m of game.marbles) {
          if (m.finishedAt !== null || m.frozen || m.hold) continue;
          const rx = m.body.position.x - fl.px, ry = m.body.position.y - fl.py;
          const along = rx * ux + ry * uy;
          if (along < 8 || along > fl.len + 10) continue;
          const across = Math.abs(-rx * uy + ry * ux);
          if (across > 24) continue;
          fl.firedAt = game.time;
          game.emit({ kind: 'flipper', i: game.track.bodies.indexOf(bat), at: fl.firedAt });
          game.sfx('snap', game.player, fl.px, fl.py);
          game.emit({ kind: 'sound', cue: 'snap' });
          break;
        }
      }
      // swing contact: transfer the bat's angular velocity to whatever it sweeps through
      const swingAge = game.time - fl.firedAt;
      if (swingAge >= 0 && swingAge < fl.swingMs) {
        const k = swingAge / fl.swingMs;
        const a = flipperAngle(fl, game.time);
        const ux = Math.cos(a), uy = Math.sin(a);
        // d(angle)/dt at the eased swing: 2k * (swingA - restA) / swingMs — rad/ms
        const omega = ((fl.swingA - fl.restA) * 2 * k) / fl.swingMs;
        const sign = Math.sign(fl.swingA - fl.restA) || 1;
        for (const m of game.marbles) {
          if (m.finishedAt !== null || m.frozen || m.hold) continue;
          if (game.time < (m.flipperKickAt ?? -1e9) + 150) continue;
          const rx = m.body.position.x - fl.px, ry = m.body.position.y - fl.py;
          const along = rx * ux + ry * uy;
          if (along < 10 || along > fl.len + 6) continue;
          const across = -rx * uy + ry * ux;
          if (Math.abs(across) > 26) continue;
          // surface velocity of the contact point: omega × r; only sweep marbles on the moving face
          const vPerp = omega * along;
          if (across * sign < 0 && Math.abs(vPerp) > 0.6) {
            m.flipperKickAt = game.time;
            // bounce stat adds rebound; heavy metal barely moves (same mass gate as the crusher)
            const heavy = Math.min(1.35, Math.max(0.2, 3.2 / Math.max(1, m.body.mass)));
            const bnc = 0.75 + 0.06 * (m.info.stats.bounce ?? 5);
            const kick = Math.abs(vPerp) * 16.667 * 0.16 * fl.strength * heavy * bnc;
            const dir = { x: -uy * sign, y: ux * sign };
            const v = Body.getVelocity(m.body);
            Body.setVelocity(m.body, { x: v.x + dir.x * kick, y: v.y + dir.y * kick });
            game.effects.push({ type: 'ring', x: m.body.position.x, y: m.body.position.y, ttl: 10, maxTtl: 10, color: '#a5f3fc' });
            game.sfx('spring', m, m.body.position.x, m.body.position.y);
          }
        }
      }
    }
  }
  // MB-10B maces: a Shockwave within range jams the sweeper for two seconds (and guests replay
  // the same decision from the shock event they receive).
}
