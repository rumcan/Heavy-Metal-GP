import { test } from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import { planCourse } from '../src/game/course-plan';
import { Game } from '../src/game/engine';
import { generateTrackDef, buildTrackFromDef } from '../src/game/trackdef';
import { meta } from '../src/game/track';
import { TRACK_THEMES, emptyInventory } from '../src/game/types';
import type { MarbleStats } from '../src/game/types';

const profile = { segments: 30, weights: {}, theme: TRACK_THEMES.classic };
const builds: MarbleStats[] = [{weight:3,speed:9,bounce:3},{weight:9,speed:3,bounce:3},
  {weight:3,speed:3,bounce:9},{weight:5,speed:5,bounce:5}];
const roster = (n = 10) => Array.from({length:n}, (_,id) => ({id,name:`M${id}`,color:'#fff',
  stats:builds[id % builds.length],isPlayer:id === 0}));

test('planner terminates, preserves specialist opportunities and never repeats adjacent chapters', () => {
  for (let seed = 0; seed < 1000; seed++) {
    const plan = planCourse(seed, profile);
    assert.equal(plan.length, 10);
    for (const feature of ['mass','rebound','burrow','lift','peggle','crane']) {
      assert.ok(plan.some(p=>p.feature===feature), `${seed}: missing ${feature}`);
    }
    assert.ok(plan.every((p,i)=>i===0 || p.feature!==plan[i-1].feature));
    // A chapter cannot independently flip away from the previous chapter's exit.
    assert.equal(new Set(plan.map(p=>p.mirror)).size,1);
    assert.deepEqual(planCourse(seed,profile),plan);
  }
});

test('Workshop recording preserves deliberate supply items, not newly rolled random drops', () => {
  const def = generateTrackDef(42,profile,'Course');
  const expected = def.pieces.filter(p=>p.t==='ppeg' && p.color==='green').map(p=>p.t==='ppeg' ? p.item : null);
  const actual = buildTrackFromDef(def).bodies.map(meta).filter(m=>m.kind==='ppeg' && m.pegColor==='green').map(m=>m.itemDrop);
  assert.deepEqual(actual,expected);
  assert.ok(expected.includes('jump') && expected.includes('anvil') && expected.includes('ghost'));
});

for (const seed of [2,3,7,42,777,2026]) {
  test(`seed ${seed}: ten mixed builds finish with no recovery assistance`, () => {
    const game = new Game(seed,roster(),{profile,recovery:false,effects:false,aiItems:false});
    game.openGate();
    for(let i=0;i<60*150 && !game.allFinished();i++) game.step(1000/60);
    assert.ok(game.allFinished(),JSON.stringify(game.marbles.filter(m=>m.finishedAt===null).map(m=>m.body.position)));
    assert.equal(game.marbles.reduce((n,m)=>n+m.recoveries,0),0);
  });
}

test('seed 17: extreme kits leave the flat weight hatch without recovery', () => {
  const extremes = [...builds, {weight:1,speed:10,bounce:4}, {weight:10,speed:1,bounce:4}, {weight:1,speed:4,bounce:10}];
  const racers = roster().map((r,i)=>({...r,isPlayer:false,stats:extremes[i % extremes.length]}));
  const game = new Game(17,racers,{profile:{...profile,theme:TRACK_THEMES.dwarven},recovery:false,effects:false,aiItems:false});
  try {
    game.openGate();
    for(let i=0;i<60*150 && !game.allFinished();i++) game.step(1000/60);
    assert.ok(game.allFinished(),'a stopped light marble must be carried off the hatch');
    assert.ok(game.marbles.every(m=>m.recoveries===0));
  } finally { game.destroy(); }
});

for (const seed of [2,3]) {
  test(`seed ${seed}: timed Jump enters the burrow and beats the item-free road`, () => {
    const run = (jump: boolean) => {
      const game = new Game(seed,roster(1),{profile,recovery:false,effects:false,aiItems:false,
        inventory:{...emptyInventory(),jump:1}});
      const section = game.track.segments.find(s=>s.name.startsWith('Smuggler'))!;
      game.openGate();
      // Isolate the route's real run-up; full-start pack completion is checked separately above.
      Matter.Body.setPosition(game.player.body,{x:seed%2 ? 700 : 200,y:section.y+80});
      Matter.Body.setVelocity(game.player.body,{x:seed%2 ? -8 : 8,y:1});
      let fired=false, captured=false;
      for(let i=0;i<60*20 && game.player.body.position.y<section.y+section.h;i++) {
        const p=game.player.body.position, x=seed%2 ? 900-p.x : p.x;
        if(jump && !fired && x>425 && x<490 && p.y>section.y+90) fired=game.useItem(game.player,'jump');
        captured ||= game.player.hold?.kind==='tunnel';
        game.step(1000/60);
      }
      assert.ok(game.player.body.position.y>=section.y+section.h,'route must rejoin without rescue');
      return {time:game.time,captured};
    };
    const normal=run(false), shortcut=run(true);
    assert.equal(normal.captured,false);
    assert.equal(shortcut.captured,true);
    assert.ok(shortcut.time < normal.time - 500, 'shortcut must have a real net time saving');
  });
}

test('the weight route opens for a heavy kit; a lighter kit can take the intact outer road', () => {
  const cross = (stats: MarbleStats) => {
    const game = new Game(2,[{...roster(1)[0],stats}],{profile,recovery:false,effects:false,aiItems:false});
    const section=game.track.segments.find(s=>s.name.startsWith('Foundry'))!;
    game.openGate();
    // A player deliberately slows on the hatch; merely flying over it need not activate it.
    Matter.Body.setPosition(game.player.body,{x:400,y:section.y+130});
    Matter.Body.setVelocity(game.player.body,{x:3,y:0});
    let opened=false, x=0;
    for(let i=0;i<600 && game.player.body.position.y<section.y+section.h;i++) {
      game.step(1000/60);
      opened ||= game.track.bodies.some(b=>meta(b).kind==='trapdoor' && meta(b).openNow===true);
      if(!x && game.player.body.position.y>section.y+320) x=game.player.body.position.x;
    }
    assert.ok(game.player.body.position.y>=section.y+section.h);
    return {opened,x};
  };
  const heavy=cross(builds[1]), regular=cross(builds[3]);
  assert.equal(heavy.opened,true);
  assert.equal(regular.opened,false);
  assert.ok(heavy.x<650 && regular.x>700,'heavy route must actually bypass the outside turn');
});

test('board the moving lift, jump towards its upper dock and rejoin through the shortcut', () => {
  const game=new Game(2,[{...roster(1)[0],stats:builds[3]}],{profile,recovery:false,effects:false,
    aiItems:false,inventory:{...emptyInventory(),jump:1}});
  const section=game.track.segments.find(s=>s.name.startsWith('Sky Ferry'))!;
  game.openGate();
  Matter.Body.setPosition(game.player.body,{x:280,y:section.y+103});
  Matter.Body.setVelocity(game.player.body,{x:7,y:1});
  let boarded=false, fired=false, captured=false;
  for(let i=0;i<900 && game.player.body.position.y<section.y+section.h;i++) {
    captured ||= game.player.hold?.kind==='tunnel';
    if(fired) {
      // Only the real left/right nudge input: aim the airborne marble at the visible dock.
      const m=game.player;
      game.nudge=Math.sign(Math.max(-6,Math.min(6,(750-m.body.position.x)*0.06))-m.body.velocity.x);
    }
    game.step(1000/60);
    const contact=game.engine.pairs.list.some(p=>p.isActive && (p.bodyA===game.player.body || p.bodyB===game.player.body)
      && [meta(p.bodyA).kind,meta(p.bodyB).kind].includes('platform'));
    boarded ||= contact;
    if(contact && !fired) fired=game.useItem(game.player,'jump');
  }
  assert.ok(boarded && fired && captured,'the shortcut must use an accessible platform and dock');
  assert.ok(game.player.body.position.y>=section.y+section.h);
});
