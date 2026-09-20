// node --import tsx scripts/champ3/where.mjs X Y [radius]
import { buildTrackFromDef } from '../../src/game/trackdef.ts';
import { meta } from '../../src/game/track.ts';
import { buildDef } from './def.mjs';
const track = buildTrackFromDef(buildDef());
const q = { x: Number(process.argv[2]), y: Number(process.argv[3]) };
const r = Number(process.argv[4] ?? 30);
for (const b of track.bodies) {
  const bb = b.bounds;
  if (q.x > bb.min.x - r && q.x < bb.max.x + r && q.y > bb.min.y - r && q.y < bb.max.y + r) {
    const m = meta(b) ?? {};
    console.log(b.label, JSON.stringify(m.kind ?? ''), m.plugin ? JSON.stringify(m.plugin) : '', 'bounds', [bb.min.x, bb.min.y, bb.max.x, bb.max.y].map(Math.round).join(','), b.isSensor ? 'SENSOR' : '');
  }
}
