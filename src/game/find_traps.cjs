const fs = require('fs');

const code = fs.readFileSync('src/game/track.ts', 'utf-8');
const lines = code.split('\n');

const traps = [];

lines.forEach((line, idx) => {
  const match = line.match(/b\.ramp\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/);
  if (!match) return;

  const x1_str = match[1].trim();
  const x2_str = match[3].trim();
  
  // We're looking for x2 >= W (800) or x2 <= 0 when sloping down.
  // We also know W = 800.
  // Evaluate roughly.
  const evalX = (str) => {
    if (str === 'W') return 800;
    if (str === '0') return 0;
    if (str.includes('W / 2')) return 400;
    if (str.match(/^\d+$/)) return parseInt(str, 10);
    if (str === 'W - 10') return 790;
    if (str === 'W - 20') return 780;
    // Just return null for complex ones.
    return null;
  };

  const x1 = evalX(x1_str);
  const x2 = evalX(x2_str);

  if (x1 !== null && x2 !== null) {
    if (x1 < x2 && x2 >= 800) {
      traps.push({ line: idx + 1, type: 'right-wall trap', code: line.trim() });
    }
    if (x1 > x2 && x2 <= 0) {
      traps.push({ line: idx + 1, type: 'left-wall trap', code: line.trim() });
    }
  }
});

console.log(JSON.stringify(traps, null, 2));
