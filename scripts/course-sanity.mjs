// Real physics, no recovery assistance. Usage: node --import tsx scripts/course-sanity.mjs [seed ...]
import { Game } from '../src/game/engine.ts';
import { TRACK_THEMES } from '../src/game/types.ts';
const builds = [{weight:3,speed:9,bounce:3},{weight:9,speed:3,bounce:3},
  {weight:3,speed:3,bounce:9},{weight:5,speed:5,bounce:5}];
const seeds = process.argv.slice(2).map(Number);
let failures = 0;
for (const seed of seeds.length ? seeds : [2,3,7,42,777,2026]) {
  const theme = ['classic','street','silver','forest','worg','dwarven'][Math.abs(seed) % 6];
  const roster = Array.from({length:10}, (_,id) => ({id,name:`M${id}`,color:'#fff',
    stats:builds[id % 4],isPlayer:false}));
  const game = new Game(seed,roster,{profile:{segments:30,weights:{},theme:TRACK_THEMES[theme]},
    recovery:false,effects:false,aiItems:false});
  game.openGate();
  for (let i=0; i<60*150 && !game.allFinished(); i++) game.step(1000/60);
  const stuck = game.marbles.filter(m=>m.finishedAt===null);
  console.log(JSON.stringify({seed,theme,height:game.track.height,seconds:+(game.time/1000).toFixed(2),
    finished:10-stuck.length,recoveries:game.marbles.reduce((n,m)=>n+m.recoveries,0),
    stuck:stuck.map(m=>({id:m.info.id,x:Math.round(m.body.position.x),y:Math.round(m.body.position.y)}))}));
  if(stuck.length) failures++;
}
if(failures) process.exitCode=1;
