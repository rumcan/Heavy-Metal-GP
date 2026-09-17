/**
 * ACT II — THE RISE AND THE FALL (ST-05). Chapters 3–4: Silverpeg and Spa-Francoroll.
 *
 * The training montage, then the deal with the devil. Duchess Vex offers a factory drive, something is
 * loosened on Sprocket's marble at a set sector, Zapp Gutwrench holds the wrench, and the chapter ends
 * in a crash whatever the result. Old Smokey pays for pulling the kid out.
 *
 * Voice: full, plain sentences (see act1.ts). Every line ≤ 90 characters.
 * This file owns Act II scenes, dialogue and objectives — nothing else.
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
      { id: 'c3-crate', label: 'Break through a SMASH wall', kind: 'counter', counter: 'crates', target: 1, scope: 'chapter' },
      { id: 'c3-loop', label: 'Make it all the way round a loop', kind: 'counter', counter: 'loops', target: 1, scope: 'chapter' },
      { id: 'c3-hoops', label: 'Fly through 3 fire hoops in one race', kind: 'counter', counter: 'hoops', target: 3, scope: 'heat' },
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
      { id: 'c4-finish', label: 'Finish all three races', kind: 'finish', target: 1, scope: 'chapter' },
      { id: 'c4-topfive', label: 'Finish a race in the top five', kind: 'rank', rank: 5, scope: 'heat', bonus: true },
    ],
  },
];

export const ACT2_SCENES: readonly Scene[] = [
  // ── chapter 3: Old Smokey's Lessons (Silverpeg) ───────────────────────────
  {
    id: 'c3-intro-shack', chapter: 3, trigger: 'intro', background: 'old-smokey-training-shack',
    when: { flag: 'metSmokey' },
    lines: [
      L('smokey', 'happy', 'Our third track is Silverpeg, and it is the best place in the season to train.'),
      L('sprocket', 'happy', 'Why is Silverpeg so good for training?'),
      L('smokey', 'smug', 'It is packed with the three things that beat new drivers: walls, loops and hoops.'),
      L('smokey', 'happy', 'Some walls have cracks in them, and a hard enough hit smashes a shortcut open.'),
      L('smokey', 'happy', 'The loops spin your marble in a full circle, if you are fast enough.'),
      L('smokey', 'happy', 'The fire hoops launch you through the air, if you aim for the middle.'),
      L('smokey', 'angry', 'Smash one wall, finish one loop, and fly through three hoops in a single race.'),
      L('smokey', 'smug', 'Do all of that, and you will have learned what took me ten years.'),
    ],
  },
  {
    id: 'c3-intro-alone', chapter: 3, trigger: 'intro', background: 'apex-racing-garage',
    when: { flag: 'metSmokey', not: true },
    lines: [
      L('zapp', 'surprised', 'You have nobody to teach you? Fine, then I will teach you, but I am not good at it.'),
      L('zapp', 'smug', 'Our next track is Silverpeg. Smash the cracked walls, finish the loops, hit the hoops.'),
    ],
  },
  {
    id: 'c3-lesson-crate', chapter: 3, trigger: 'pre-race', background: 'old-smokey-training-shack',
    lines: [
      L('smokey', 'angry', 'Wall lesson. A cracked wall is a door, but only a hard hit will open it.', 'wrench-and-bolt'),
      L('sprocket', 'shocked', 'My marble is tiny and light. How am I supposed to hit anything hard?'),
      L('smokey', 'smug', 'If you cannot be heavy, then be fast. Speed hits just as hard as weight.'),
    ],
  },
  {
    id: 'c3-lesson-loop', chapter: 3, trigger: 'pre-race', background: 'old-smokey-training-shack',
    lines: [
      L('smokey', 'happy', 'Loop lesson. You win or lose a loop before you even reach it.', 'old-racing-helmet'),
      L('sprocket', 'happy', 'So I need to build up my speed on the way into the loop?'),
      L('smokey', 'angry', 'Exactly. Arrive slow and you will just rock back and forth at the bottom.'),
    ],
  },
  {
    id: 'c3-lesson-hoops', chapter: 3, trigger: 'pre-race', background: 'old-smokey-training-shack',
    lines: [
      L('smokey', 'smug', 'Hoop lesson. A fire hoop throws you forward, so steer for the middle of it.'),
      L('sprocket', 'smug', 'And I need to get through three of them in one race.'),
      L('smokey', 'happy', 'Three in one race. Miss the middle and you will come out a little toasted.'),
    ],
  },
  {
    id: 'c3-pre-smart', chapter: 3, trigger: 'pre-race', background: 'grandstand-race-day',
    when: { flag: 'streetSmart' },
    lines: [
      L('smokey', 'smug', 'You hit ten pegs at Monte Pipo, which means you listen. That is rarer than talent.'),
      L('knuckles', 'angry', 'I am Knuckles Blau, old goblin, and your rookie keeps driving into my way!'),
    ],
  },
  {
    id: 'c3-mid-smokey', chapter: 3, trigger: 'mid-race', atSector: 6, background: 'old-smokey-training-shack',
    lines: [L('smokey', 'angry', 'A cracked wall is coming up, kid! Hit it as fast as you can!')],
  },
  {
    id: 'c3-mid-hoops', chapter: 3, trigger: 'mid-race', atSector: 22, background: 'old-smokey-training-shack',
    lines: [L('smokey', 'happy', 'Steer for the middle of the hoop, not the fire around it!')],
  },
  {
    id: 'c3-post-win', chapter: 3, trigger: 'post-win', outcome: 'win', background: 'old-smokey-training-shack',
    lines: [
      L('smokey', 'shocked', 'You won at Silverpeg and passed all three lessons, all in one visit.'),
      L('sprocket', 'smug', 'That is because you are a good teacher.'),
      L('smokey', 'sad', 'I taught one other goblin this way once. They won everything, and then they left.'),
      L('sprocket', 'shocked', 'Where did they go?'),
      L('smokey', 'angry', 'Never mind that. We race at Spa next, and you must not sign anything there.'),
    ],
  },
  {
    id: 'c3-post-podium', chapter: 3, trigger: 'post-podium', outcome: 'podium', background: 'old-smokey-training-shack',
    lines: [
      L('smokey', 'happy', 'A top three finish and a smashed wall. That was skill, kid, not luck.'),
      L('sprocket', 'happy', 'Spa is next, and everyone says it is the fastest track of the season.'),
      L('smokey', 'angry', 'It is fast, and so are the people who work there. Do not sign anything at Spa.'),
    ],
  },
  {
    id: 'c3-post-loss', chapter: 3, trigger: 'post-loss', outcome: 'loss', background: 'old-smokey-training-shack',
    lines: [
      L('sprocket', 'sad', 'I came into the loop too slowly and just rocked back and forth at the bottom.'),
      L('smokey', 'happy', 'At least you know why it happened now, and that is real progress.'),
      L('smokey', 'angry', 'Spa is next. Bring all the speed you have, and do not sign anything there.'),
    ],
  },
  {
    id: 'c3-outro-shack', chapter: 3, trigger: 'outro', background: 'old-smokey-training-shack',
    lines: [
      L('zapp', 'surprised', 'Kid, Duchess Vex wants to meet you in her private office at Spa.'),
      L('smokey', 'angry', 'Of course it is Vex. It is always Vex.'),
      L('sprocket', 'happy', 'What would a rich duchess want with a goblin from a scrapyard?'),
      L('smokey', 'sad', 'She wants to own you, kid. Owning drivers is how she wins races.'),
    ],
  },

  // ── chapter 4: The Deal (Spa-Francoroll) ──────────────────────────────────
  {
    id: 'c4-intro-office', chapter: 4, trigger: 'intro', background: 'vex-gilded-office',
    choice: {
      prompt: 'Vex slides a one-page contract across the desk. Will you sign it?',
      options: [
        { label: 'Sign the contract', set: 'acceptedVexDeal' },
        { label: 'Walk out', set: 'refusedVex' },
      ],
    },
    lines: [
      L('vex', 'smug', 'Sit down, Sprocket. That chair cost more than your whole scrapyard.'),
      L('sprocket', 'shocked', 'It is the softest chair I have ever sat in.'),
      L('vex', 'happy', 'Join my team, and I will give you a new marble and the best mechanics money buys.', 'contract-scroll'),
      L('sprocket', 'happy', 'That sounds amazing. What do I have to give you in return?'),
      L('vex', 'smug', 'Twice a season, I tell you where to finish a race, and you finish exactly there.'),
      L('sprocket', 'shocked', 'You want me to lose races on purpose?'),
      L('vex', 'angry', 'Apex Racing is broke, child. They cannot pay your race fees for much longer.'),
      L('vex', 'smug', 'Somebody always ends up paying for a driver. It might as well be me.'),
    ],
  },
  {
    id: 'c4-pre-grid', chapter: 4, trigger: 'pre-race', background: 'grandstand-race-day',
    lines: [
      L('scorch', 'happy', 'I am Scorch, and welcome to Spa, the fastest track of the whole season!'),
      L('scorch', 'happy', 'It is full of slippery ice slides and boost pads, so somebody always crashes.'),
      L('sprocket', 'smug', 'From what I hear, the one who crashes is usually you.'),
      L('ace', 'angry', 'Rookie, I saw you leave Vex\'s office. Whatever she offered, it was not a gift.'),
      L('hood', 'stern', 'Nothing that woman offers is ever free.'),
      L('sprocket', 'shocked', 'The driver in the hood again. Do you race for Vex?'),
    ],
  },
  {
    id: 'c4-pre-trained', chapter: 4, trigger: 'pre-race', background: 'old-smokey-training-shack',
    when: { flag: 'trainingDone' },
    lines: [
      L('smokey', 'happy', 'You passed the wall, the loop and the hoops at Silverpeg. I am proud of you, kid.'),
      L('smokey', 'angry', 'Spa is long and fast. If anything on your marble feels loose, trust that feeling.'),
    ],
  },
  {
    id: 'c4-mid-sabotage', chapter: 4, trigger: 'mid-race', atSector: 8, background: 'grandstand-race-day',
    lines: [
      L('sprocket', 'shocked', 'My item just broke when I tried to use it! Something on my marble is loose!'),
      L('zapp', 'surprised', 'I cannot fix it from here, kid! Just keep steering and stay on the track!'),
    ],
  },
  {
    id: 'c4-post-win-deal', chapter: 4, trigger: 'post-win', outcome: 'win', background: 'vex-gilded-office',
    when: { flag: 'acceptedVexDeal' },
    lines: [
      L('vex', 'happy', 'A win for my team already. You see? We are a perfect match, you and I.'),
      L('sprocket', 'smug', 'All I see is a contract and a very soft chair.'),
      L('vex', 'smug', 'Remember our deal. Twice this season, you will finish where I tell you.'),
    ],
  },
  {
    id: 'c4-post-win-free', chapter: 4, trigger: 'post-win', outcome: 'win', background: 'grandstand-race-day',
    when: { flag: 'refusedVex' },
    lines: [
      L('ace', 'shocked', 'You said no to Vex and still won at Spa. That was either brave or very stupid.'),
      L('sprocket', 'smug', 'It was probably both. Scrapyard goblins are like that.'),
      L('vex', 'angry', 'Enjoy your trophy, Sprocket. Nobody says no to me twice.'),
    ],
  },
  {
    id: 'c4-post-podium-deal', chapter: 4, trigger: 'post-podium', outcome: 'podium', background: 'vex-gilded-office',
    when: { flag: 'acceptedVexDeal' },
    lines: [
      L('vex', 'smug', 'Second or third place. Both of those positions are very useful to me.'),
      L('sprocket', 'sad', 'Is that what I sold you when I signed? My finishing positions?'),
      L('vex', 'happy', 'You sold me nothing, darling. I bought you a future, and you pay for it in races.'),
    ],
  },
  {
    id: 'c4-post-podium-free', chapter: 4, trigger: 'post-podium', outcome: 'podium', background: 'grandstand-race-day',
    when: { flag: 'refusedVex' },
    lines: [
      L('smokey', 'happy', 'A top three finish at Spa, on a marble nobody paid for. That one is truly yours.'),
      L('sprocket', 'happy', 'And I do not owe anybody a single race for it.'),
      L('vex', 'angry', 'Not yet, child. Not yet.'),
    ],
  },
  {
    id: 'c4-post-loss-deal', chapter: 4, trigger: 'post-loss', outcome: 'loss', background: 'vex-gilded-office',
    when: { flag: 'acceptedVexDeal' },
    sets: ['midpointCrash'],
    lines: [
      L('vex', 'angry', 'You crashed while driving for my team. Do you know how much that costs me?'),
      L('sprocket', 'sad', 'It cost me my marble, mostly.'),
      L('vex', 'smug', 'Then get it fixed quickly. I need you racing at the next track, Suzuka.'),
    ],
  },
  {
    id: 'c4-post-loss-free', chapter: 4, trigger: 'post-loss', outcome: 'loss', background: 'pit-lane-at-night',
    when: { flag: 'refusedVex' },
    sets: ['midpointCrash'],
    lines: [
      L('sprocket', 'sad', 'Something on my marble broke halfway down the track, and then I hit the wall.'),
      L('ace', 'surprised', 'You say no to Vex, and then your marble falls apart. That is very convenient.'),
      L('sprocket', 'shocked', 'Convenient for who? Are you saying somebody did this to me on purpose?'),
    ],
  },
  {
    id: 'c4-outro-pitlane', chapter: 4, trigger: 'outro', background: 'pit-lane-at-night',
    sets: ['smokeyInjured'],
    choice: {
      prompt: 'Zapp is standing over the wreck, holding a wrench. Do you believe him?',
      options: [
        { label: 'Believe Zapp', set: 'trustedZapp' },
        { label: 'Blame Zapp', set: 'blamedZapp' },
      ],
    },
    lines: [
      L('sprocket', 'sad', 'After the last race, my marble crashed and broke into three pieces.', 'cracked-marble'),
      L('smokey', 'angry', 'Look at this bolt. It did not wear out. Somebody cut it with a saw.'),
      L('smokey', 'sad', 'I ran onto the track to pull you out of the wreck, kid. I think my arm is broken.'),
      L('zapp', 'shocked', 'I checked that bolt myself before the race, kid! I swear I checked it!'),
      L('sprocket', 'sad', 'Smokey is lying on the ground hurt, and you are the one holding a wrench.'),
    ],
  },
  {
    id: 'c4-outro-sabotage', chapter: 4, trigger: 'outro', background: 'pit-lane-at-night',
    when: { flag: 'sabotaged' },
    lines: [
      L('smokey', 'angry', 'Your item launcher is burnt from the inside. Somebody tampered with it.'),
      L('sprocket', 'shocked', 'Somebody would really cheat like that, in the middle of a race?'),
      L('smokey', 'sad', 'In this sport, yes, they would. Now you know what racing really looks like.'),
    ],
  },
  {
    id: 'c4-outro-zapp-trust', chapter: 4, trigger: 'outro', background: 'apex-racing-garage',
    when: { flag: 'trustedZapp' },
    lines: [
      L('zapp', 'happy', 'You believe me? Nobody ever believes the mechanic.', 'wrench-and-bolt'),
      L('sprocket', 'smug', 'You talk far too much to keep a secret like that.'),
      L('zapp', 'angry', 'Then it was somebody quiet, somebody who plans ahead. I will find out who.'),
    ],
  },
  {
    id: 'c4-outro-zapp-blame', chapter: 4, trigger: 'outro', background: 'apex-racing-garage',
    when: { flag: 'blamedZapp' },
    lines: [
      L('zapp', 'sad', 'You really think I would wreck a marble from my own garage?', 'wrench-and-bolt'),
      L('sprocket', 'sad', 'You were the one standing there holding the wrench.'),
      L('zapp', 'angry', 'Every goblin in this sport owns a wrench, kid! That proves nothing!'),
    ],
  },
];
