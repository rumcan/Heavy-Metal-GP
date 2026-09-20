import buildDef from './def.mjs';
import { ROLES, CHAINS } from './map.mjs';
const def = buildDef();
const at = (p) => {
  if (Array.isArray(p.a) && Array.isArray(p.a.map)) return `${p.a.map((v) => v.toFixed(1))} -> ${p.b.map((v) => v.toFixed(1))}`;
  return JSON.stringify(p).slice(0, 100);
};
for (const [i, p] of def.pieces.entries()) {
  const want = process.argv.slice(2).map(Number);
  if (want.length && !want.includes(i)) continue;
  console.log(String(i).padStart(3), p.t.padEnd(10), String(ROLES.get(p)).padEnd(9), 'ch' + String(CHAINS.get(p)).padStart(3), at(p));
}
console.log('total', def.pieces.length, 'height', def.height);
