import buildDef from './def.mjs';
import { CHAINS } from './map.mjs';
const pieces = buildDef().pieces;
const K = [[560,2380],[595,2468],[545,2560],[480,2620],[490,2700],[455,2790],[420,2870],[395,2960],[400,3080],[430,3230],[450,3330]];
const S = [[560,2380],[700,2450],[775,2560],[778,2700],[740,2820],[770,2940],[690,3080],[600,3180],[490,3260],[450,3330]];
const distTo = (p, poly) => {
  let best = 1e9;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], b = poly[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t)));
  }
  return best;
};
pieces.forEach((p, i) => {
  if (p.t === 'ramp' && p.a) {
    const mid = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2];
    if (mid[1] > 2300 && mid[1] < 3400) {
      const dK = distTo(mid, K), dS = distTo(mid, S);
      console.log(String(i).padStart(3), 'ch', String(CHAINS.get(p)).padStart(2),
        (p.a.join(',')).padEnd(12), (p.b.join(',')).padEnd(12),
        'dK=' + dK.toFixed(0).padStart(4), 'dS=' + dS.toFixed(0).padStart(4),
        dS < dK ? 'S' : 'K');
    }
  }
});
