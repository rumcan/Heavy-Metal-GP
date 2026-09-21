const fs = require('fs');
let code = fs.readFileSync('src/game/course-builder.ts', 'utf8');

// Connect left ramps to outer wall
code = code.replace(/b\.ramp\(0,/g, 'b.ramp(-100,');

// Connect right ramps to outer wall
code = code.replace(/b\.ramp\(W,/g, 'b.ramp(W + 100,');

fs.writeFileSync('src/game/course-builder.ts', code);
