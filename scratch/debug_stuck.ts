import { planCourse } from '../src/game/course-plan.ts';
import { TRACK_THEMES } from '../src/game/types.ts';
const plan = planCourse(7, { segments: 10, weights: {}, theme: TRACK_THEMES.classic });
const start = 440 + 680; // 1120
plan.forEach((ch, i) => {
    console.log(`Ch ${i}: ${ch.layout} [${start + i*480} to ${start + (i+1)*480}]`);
});
