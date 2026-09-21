const fs = require('fs');
let code = fs.readFileSync('src/game/course-builder.ts', 'utf8');

// Replace all flipper strength 6 with 2
code = code.replace(/b\.flipper\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*6\s*,/g, 'b.flipper($1, $2, $3, $4, $5, 2,');

fs.writeFileSync('src/game/course-builder.ts', code);
