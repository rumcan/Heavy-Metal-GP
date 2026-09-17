/**
 * ACT II — THE RISE AND THE FALL (ST-05). Chapters 3–4: Silverpeg and Spa-Francoroll.
 *
 * The training montage, then the deal with the devil. Duchess Vex offers a factory drive, something is
 * loosened on Sprocket's marble at a set sector, Zapp Gutwrench holds the wrench, and the chapter ends
 * in a crash whatever the result. Old Smokey pays for pulling the kid out.
 *
 * Every line ≤ 90 characters. This file owns Act II scenes, dialogue and objectives — nothing else.
 */
import type { ChapterDef, Line, Scene } from '../types';
import type { StoryProp } from '../assets';
import type { CastId } from '../cast';

const L = (who: CastId, mood: string, text: string, prop?: StoryProp): Line => (prop ? { who, mood, text, prop } : { who, mood, text });

export const ACT2_CHAPTERS: readonly ChapterDef[] = [
  {
    chapter: 3, act: 2, gp: 2, title: "Old Smokey's Lessons",
    // The montage needs the pieces to be there: more crack walls, more loops, more curve drops (fire hoops).
    weights: { 'Crack Wall Shortcut': 2.4, Loop: 2, 'Curve Drop': 3.2 },
    completeFlag: 'trainingDone',
    objectives: [
      { id: 'c3-crate', label: 'Break a SMASH wall', kind: 'counter', counter: 'crates', target: 1, scope: 'chapter' },
      { id: 'c3-loop', label: 'Clear a loop', kind: 'counter', counter: 'loops', target: 1, scope: 'chapter' },
      { id: 'c3-hoops', label: 'Three fire hoops in a heat', kind: 'counter', counter: 'hoops', target: 3, scope: 'heat' },
    ],
  },
  {
    chapter: 4, act: 2, gp: 3, title: 'The Deal',
    ai: [
      { who: 'vex', target: 'player' },
      { who: 'hood', target: 'player' },
    ],
    events: [
      {
        id: 'c4-sabotage', kind: 'sabotage', atSector: 8, heats: [2], flag: 'sabotaged',
        message: 'SABOTAGE! Your item misfires',
      },
    ],
    objectives: [
      { id: 'c4-finish', label: 'Finish the Grand Prix', kind: 'finish', target: 1, scope: 'chapter' },
      { id: 'c4-topfive', label: 'Top five at Spa', kind: 'rank', rank: 5, scope: 'heat', bonus: true },
    ],
  },
];

export const ACT2_SCENES: readonly Scene[] = [
  // ── chapter 3: Old Smokey's Lessons (Silverpeg) ───────────────────────────
  {
    id: 'c3-intro-shack', chapter: 3, trigger: 'intro', background: 'old-smokey-training-shack',
    when: { flag: 'metSmokey' },
    lines: [
      L('smokey', 'happy', 'Three lessons. Silverpeg has the pieces for all of them.'),
      L('sprocket', 'happy', 'Pieces?'),
      L('smokey', 'smug', 'Crack walls. Loops. Fire hoops. The track teaches, I translate.'),
      L('smokey', 'angry', 'Break a wall, clear a loop, three hoops in one heat. Then we talk.'),
    ],
  },
  {
    id: 'c3-intro-alone', chapter: 3, trigger: 'intro', background: 'apex-racing-garage',
    when: { flag: 'metSmokey', not: true },
    lines: [
      L('zapp', 'surprised', 'Nobody to teach you? Fine. I will teach you. Worse.'),
      L('zapp', 'smug', 'Silverpeg: break things, jump things, burn things. Same lesson.'),
    ],
  },
  {
    id: 'c3-lesson-crate', chapter: 3, trigger: 'pre-race', background: 'old-smokey-training-shack',
    lines: [
      L('smokey', 'angry', 'Lesson three: a crack wall is a door you have to be heavy enough to open.', 'wrench-and-bolt'),
      L('sprocket', 'shocked', 'My marble weighs nothing.'),
      L('smokey', 'smug', 'Then arrive faster. Weight is a luxury, speed is a choice.'),
    ],
  },
  {
    id: 'c3-lesson-loop', chapter: 3, trigger: 'pre-race', background: 'old-smokey-training-shack',
    lines: [
      L('smokey', 'happy', 'Lesson four: a loop is not a trick. It is a promise you made in the last sector.', 'old-racing-helmet'),
      L('sprocket', 'happy', 'Carry the speed in.'),
      L('smokey', 'angry', 'Carry the speed in. Bail early and you rock at the bottom like a cradle.'),
    ],
  },
  {
    id: 'c3-lesson-hoops', chapter: 3, trigger: 'pre-race', background: 'old-smokey-training-shack',
    lines: [
      L('smokey', 'smug', 'Lesson five: fire hoops throw you. Aim for the middle, not the fire.'),
      L('sprocket', 'smug', 'Three in a heat.'),
      L('smokey', 'happy', 'Three in a heat. Miss one and you are a torch.'),
    ],
  },
  {
    id: 'c3-pre-smart', chapter: 3, trigger: 'pre-race', background: 'grandstand-race-day',
    when: { flag: 'streetSmart' },
    lines: [
      L('smokey', 'smug', 'Ten pegs at Monte Pipo. You listen. That is rarer than talent.'),
      L('knuckles', 'angry', 'Old goblin! Your kid is in my line again.'),
    ],
  },
  {
    id: 'c3-mid-smokey', chapter: 3, trigger: 'mid-race', atSector: 6, background: 'old-smokey-training-shack',
    lines: [L('smokey', 'angry', 'Wall ahead. Heavier or faster, kid. Pick one.')],
  },
  {
    id: 'c3-mid-hoops', chapter: 3, trigger: 'mid-race', atSector: 22, background: 'old-smokey-training-shack',
    lines: [L('smokey', 'happy', 'Middle of the hoop! Not the fire!')],
  },
  {
    id: 'c3-post-win', chapter: 3, trigger: 'post-win', outcome: 'win', background: 'old-smokey-training-shack',
    lines: [
      L('smokey', 'shocked', 'A win and all three lessons. In one weekend.'),
      L('sprocket', 'smug', 'You teach well.'),
      L('smokey', 'sad', 'I taught one other goblin like this. Won everything. Then the mine.'),
      L('sprocket', 'shocked', 'The mine?'),
      L('smokey', 'angry', 'Spa next. Do not sign anything at Spa.'),
    ],
  },
  {
    id: 'c3-post-podium', chapter: 3, trigger: 'post-podium', outcome: 'podium', background: 'old-smokey-training-shack',
    lines: [
      L('smokey', 'happy', 'Podium and a broken wall. That is a lesson learned, not luck.'),
      L('sprocket', 'happy', 'Spa is next. Fastest track of the year.'),
      L('smokey', 'angry', 'Fastest track, fastest offers. Do not sign anything at Spa.'),
    ],
  },
  {
    id: 'c3-post-loss', chapter: 3, trigger: 'post-loss', outcome: 'loss', background: 'old-smokey-training-shack',
    lines: [
      L('sprocket', 'sad', 'I rocked at the bottom of the loop. Like a cradle.'),
      L('smokey', 'happy', 'You remembered the word cradle. That is progress.'),
      L('smokey', 'angry', 'Spa next. Bring speed, and bring nothing you can sign.'),
    ],
  },
  {
    id: 'c3-outro-shack', chapter: 3, trigger: 'outro', background: 'old-smokey-training-shack',
    lines: [
      L('zapp', 'surprised', 'A Duchess wants a word with the kid. In the gilded office. At Spa.'),
      L('smokey', 'angry', 'Vex. Of course it is Vex.'),
      L('sprocket', 'happy', 'What does she want?'),
      L('smokey', 'sad', 'Whatever you are. That is what she buys.'),
    ],
  },

  // ── chapter 4: The Deal (Spa-Francoroll) ──────────────────────────────────
  {
    id: 'c4-intro-office', chapter: 4, trigger: 'intro', background: 'vex-gilded-office',
    choice: {
      prompt: 'The contract is one page. The pen is heavier than your marble.',
      options: [
        { label: 'Sign it', set: 'acceptedVexDeal' },
        { label: 'Walk out', set: 'refusedVex' },
      ],
    },
    lines: [
      L('vex', 'smug', 'Sit. That chair cost more than your scrapyard.'),
      L('sprocket', 'shocked', 'It is very soft.'),
      L('vex', 'happy', 'Factory drive. Scuderia Viola. Marble, mechanics, and no more dents.', 'contract-scroll'),
      L('sprocket', 'happy', 'And in return?'),
      L('vex', 'smug', 'In return you finish where I ask, when I ask. Twice a season.'),
      L('vex', 'angry', 'Apex will not pay your entry fee forever, child. Someone will.'),
      L('sprocket', 'smug', 'Someone always does.'),
    ],
  },
  {
    id: 'c4-pre-grid', chapter: 4, trigger: 'pre-race', background: 'grandstand-race-day',
    lines: [
      L('scorch', 'happy', 'Spa! Ice slides and boost pads. Somebody always burns.'),
      L('sprocket', 'smug', 'Somebody is usually you.'),
      L('ace', 'angry', 'Rookie. Whatever she offered you, it was not free.'),
      L('hood', 'stern', '...nothing she offers is free.'),
    ],
  },
  {
    id: 'c4-pre-trained', chapter: 4, trigger: 'pre-race', background: 'old-smokey-training-shack',
    when: { flag: 'trainingDone' },
    lines: [
      L('smokey', 'happy', 'Wall, loop and hoops. You finished the course, kid.'),
      L('smokey', 'angry', 'Spa is long and fast. If something feels loose, it is loose.'),
    ],
  },
  {
    id: 'c4-mid-sabotage', chapter: 4, trigger: 'mid-race', atSector: 8, background: 'grandstand-race-day',
    lines: [
      L('sprocket', 'shocked', 'My item just died in the tube! Something is loose!'),
      L('zapp', 'surprised', 'Not from here! Hold your line, kid!'),
    ],
  },
  {
    id: 'c4-post-win-deal', chapter: 4, trigger: 'post-win', outcome: 'win', background: 'vex-gilded-office',
    when: { flag: 'acceptedVexDeal' },
    lines: [
      L('vex', 'happy', 'A win on my paperwork. You see? We suit each other.'),
      L('sprocket', 'smug', 'I see a pen and a very soft chair.'),
      L('vex', 'smug', 'Two finishes where I ask. Remember the number.'),
    ],
  },
  {
    id: 'c4-post-win-free', chapter: 4, trigger: 'post-win', outcome: 'win', background: 'grandstand-race-day',
    when: { flag: 'refusedVex' },
    lines: [
      L('ace', 'shocked', 'You turned her down and still won. That is either brave or stupid.'),
      L('sprocket', 'smug', 'Both. It is a scrapyard trait.'),
      L('vex', 'angry', 'Enjoy the podium. Nobody refuses me twice.'),
    ],
  },
  {
    id: 'c4-post-podium-deal', chapter: 4, trigger: 'post-podium', outcome: 'podium', background: 'vex-gilded-office',
    when: { flag: 'acceptedVexDeal' },
    lines: [
      L('vex', 'smug', 'Second or third. Both are useful numbers, you know.'),
      L('sprocket', 'sad', 'Is that what the pen bought?'),
      L('vex', 'happy', 'The pen bought you a future. The numbers keep it.'),
    ],
  },
  {
    id: 'c4-post-podium-free', chapter: 4, trigger: 'post-podium', outcome: 'podium', background: 'grandstand-race-day',
    when: { flag: 'refusedVex' },
    lines: [
      L('smokey', 'happy', 'Podium at Spa with your own bolts. That is a real one.'),
      L('sprocket', 'happy', 'No contract. No numbers.'),
      L('vex', 'angry', 'For now, child. For now.'),
    ],
  },
  {
    id: 'c4-post-loss-deal', chapter: 4, trigger: 'post-loss', outcome: 'loss', background: 'vex-gilded-office',
    when: { flag: 'acceptedVexDeal' },
    sets: ['midpointCrash'],
    lines: [
      L('vex', 'angry', 'A crash. On my paperwork. Do you know what that costs?'),
      L('sprocket', 'sad', 'My marble. Mostly.'),
      L('vex', 'smug', 'Then we are even. Get it fixed. I need you at Suzuka.'),
    ],
  },
  {
    id: 'c4-post-loss-free', chapter: 4, trigger: 'post-loss', outcome: 'loss', background: 'pit-lane-at-night',
    when: { flag: 'refusedVex' },
    sets: ['midpointCrash'],
    lines: [
      L('sprocket', 'sad', 'Something let go at sector eight. Then the wall arrived.'),
      L('ace', 'surprised', 'You refused her and your marble fails? Convenient.'),
      L('sprocket', 'shocked', 'Whose convenience?'),
    ],
  },
  {
    id: 'c4-outro-pitlane', chapter: 4, trigger: 'outro', background: 'pit-lane-at-night',
    sets: ['smokeyInjured'],
    choice: {
      prompt: 'Zapp is standing over the wreck with a wrench he did not need.',
      options: [
        { label: 'Believe Zapp', set: 'trustedZapp' },
        { label: 'Blame Zapp', set: 'blamedZapp' },
      ],
    },
    lines: [
      L('sprocket', 'sad', 'It is in three pieces. One of them is my marble.', 'cracked-marble'),
      L('smokey', 'angry', 'Bolt sheared clean. That is not wear. That is a saw.'),
      L('smokey', 'sad', 'Kid— the wall— hold still. Somebody pull the kid out!'),
      L('zapp', 'shocked', 'I checked that bolt myself. I checked it!'),
      L('sprocket', 'sad', 'Smokey is on the floor and you have a wrench.'),
    ],
  },
  {
    id: 'c4-outro-sabotage', chapter: 4, trigger: 'outro', background: 'pit-lane-at-night',
    when: { flag: 'sabotaged' },
    lines: [
      L('smokey', 'angry', 'Item tube scorched at sector eight. Somebody reached in there.'),
      L('sprocket', 'shocked', 'In a race? At speed?'),
      L('smokey', 'sad', 'In this sport, yes. Welcome to the middle of the season.'),
    ],
  },
  {
    id: 'c4-outro-zapp-trust', chapter: 4, trigger: 'outro', background: 'apex-racing-garage',
    when: { flag: 'trustedZapp' },
    lines: [
      L('zapp', 'happy', 'You believe me? Nobody ever believes me.', 'wrench-and-bolt'),
      L('sprocket', 'smug', 'You talk too much to be subtle.'),
      L('zapp', 'angry', 'Then it is somebody quiet. Somebody with a plan and a mine.'),
    ],
  },
  {
    id: 'c4-outro-zapp-blame', chapter: 4, trigger: 'outro', background: 'apex-racing-garage',
    when: { flag: 'blamedZapp' },
    lines: [
      L('zapp', 'sad', 'You think I did this. To my own garage.', 'wrench-and-bolt'),
      L('sprocket', 'sad', 'You had the wrench.'),
      L('zapp', 'angry', 'Everybody has a wrench! That is the whole sport!'),
    ],
  },
];
