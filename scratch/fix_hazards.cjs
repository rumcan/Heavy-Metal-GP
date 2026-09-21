const fs = require('fs');
let code = fs.readFileSync('src/game/course-builder.ts', 'utf8');

// Reduce sling strengths
code = code.replace(/b\.sling\(([^,]+),([^,]+),\s*6\s*,/g, 'b.sling($1, $2, 2,');
code = code.replace(/b\.sling\(([^,]+),([^,]+),\s*8\s*,/g, 'b.sling($1, $2, 3,');
code = code.replace(/b\.sling\(([^,]+),([^,]+),\s*5\s*,/g, 'b.sling($1, $2, 2,');

// Reduce cannon power
code = code.replace(/b\.cannon\(([^,]+),([^,]+),([^,]+),\s*18\s*,/g, 'b.cannon($1, $2, $3, 10,');

// Reduce flipper strength
code = code.replace(/b\.flipper\(([^,]+),([^,]+),([^,]+),\s*1\.2\s*,/g, 'b.flipper($1, $2, $3, 0.8,');
code = code.replace(/b\.flipper\(([^,]+),([^,]+),([^,]+),\s*1\.5\s*,/g, 'b.flipper($1, $2, $3, 1.0,');

fs.writeFileSync('src/game/course-builder.ts', code);
