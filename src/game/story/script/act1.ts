/**
 * ACT I — THE ROOKIE (ST-04). Chapters 1–2: Marblehurst and Monte Pipo.
 *
 * The underdog walks in. Ace Spadegrin is the arrogant champion, Duchess Vex starts counting what Sprocket
 * is worth, Old Smokey agrees to teach, and The Hood says almost nothing from inside a folded shadow.
 *
 * Voice: short and punchy, the tone of the taunts in `characters.ts`. Every line ≤ 90 characters.
 * This file owns Act I scenes, dialogue and objectives — nothing else.
 */
import type { ChapterDef, Line, Scene } from '../types';
import type { StoryProp } from '../assets';
import type { CastId } from '../cast';

const L = (who: CastId, mood: string, text: string, prop?: StoryProp): Line => (prop ? { who, mood, text, prop } : { who, mood, text });

export const ACT1_CHAPTERS: readonly ChapterDef[] = [
  {
    chapter: 1, act: 1, gp: 0, title: 'The Scrapyard Kid',
    objectives: [
      { id: 'c1-finish', label: 'Finish the Grand Prix', kind: 'finish', target: 1, scope: 'chapter' },
      { id: 'c1-ace', label: 'Finish ahead of Ace', kind: 'ahead', rival: 'ace', scope: 'heat', bonus: true, flag: 'beatAceEarly' },
    ],
  },
  {
    chapter: 2, act: 1, gp: 1, title: 'Street Smarts',
    objectives: [
      { id: 'c2-pegs', label: 'Hit 10 orange pegs in a heat', kind: 'counter', counter: 'orangePegs', target: 10, scope: 'heat', flag: 'streetSmart' },
      { id: 'c2-hood', label: 'Finish ahead of The Hood', kind: 'ahead', rival: 'hood', scope: 'heat', bonus: true },
    ],
  },
];

export const ACT1_SCENES: readonly Scene[] = [
  // ── chapter 1: The Scrapyard Kid (Marblehurst) ────────────────────────────
  {
    id: 'c1-intro-yard', chapter: 1, trigger: 'intro', background: 'scrapyard-at-dusk',
    lines: [
      L('sprocket', 'happy', 'One marble, nine dents, and a name nobody remembers.'),
      L('sprocket', 'smug', 'Heavy Metal GP. Six races. I have watched every one from this fence.'),
      L('zapp', 'surprised', 'Kid! You are inside the fence. That is new.'),
      L('sprocket', 'happy', "Apex Racing's star driver vanished. The whole paddock is talking."),
      L('zapp', 'angry', 'Gone. No note, no marble. Apex needs a driver by Friday.'),
      L('sprocket', 'smug', 'Then Apex needs me.'),
      L('zapp', 'shocked', 'You? Your ball is a bearing with a bolt through it.'),
      L('sprocket', 'happy', "It rolls. That's the job."),
    ],
  },
  {
    id: 'c1-intro-tryout', chapter: 1, trigger: 'intro', background: 'apex-racing-garage',
    lines: [
      L('zapp', 'angry', 'Three laps of the yard. Hit the crates. Keep it off its side.'),
      L('sprocket', 'happy', "That's it?"),
      L('zapp', 'smug', "That's a lap record nobody has beaten in nine years."),
      L('zapp', 'shocked', '...and you beat it by four tenths.'),
      L('sprocket', 'smug', 'Sign me up.', 'wrench-and-bolt'),
      L('zapp', 'happy', 'Apex Racing, second seat. Do not make me regret this.'),
    ],
  },
  {
    id: 'c1-pre-grid', chapter: 1, trigger: 'pre-race', background: 'grandstand-race-day',
    lines: [
      L('ace', 'smug', 'Who let the scrapyard in? Did the fence fall over?'),
      L('sprocket', 'happy', 'Sprocket. Apex Racing. Second seat.'),
      L('ace', 'angry', 'Second seat. That is the seat The Hood left warm.'),
      L('vex', 'smug', 'Do be careful, Ace. Rust is catching.'),
      L('ace', 'surprised', 'Duchess. You know this... thing?'),
      L('vex', 'happy', 'I know a cheap marble when I see one. I also know what it is worth.'),
      L('sprocket', 'smug', 'Worth a start. That is more than you gave me.'),
      L('ace', 'angry', 'Marblehurst, runt. Try to finish in the same county.'),
    ],
  },
  {
    id: 'c1-mid-ace', chapter: 1, trigger: 'mid-race', atSector: 5, background: 'grandstand-race-day',
    lines: [L('ace', 'angry', 'You are in my line, scrapyard!')],
  },
  {
    id: 'c1-mid-grubba', chapter: 1, trigger: 'mid-race', atSector: 17, background: 'grandstand-race-day',
    lines: [L('grubba', 'happy', 'Grubba sits on runts. It is tradition.')],
  },
  {
    id: 'c1-post-win', chapter: 1, trigger: 'post-win', outcome: 'win', background: 'grandstand-race-day',
    lines: [
      L('ace', 'shocked', 'That is a bearing with a bolt in it. It won!'),
      L('vex', 'surprised', 'Well. The scrapyard has teeth.'),
      L('sprocket', 'smug', 'First start, first win. Where do I collect?'),
      L('zapp', 'happy', 'You collect a tow home. Apex cannot afford a trophy.'),
      L('ace', 'angry', 'Enjoy it. Monte Pipo eats rookies.'),
    ],
  },
  {
    id: 'c1-post-podium', chapter: 1, trigger: 'post-podium', outcome: 'podium', background: 'grandstand-race-day',
    lines: [
      L('sprocket', 'happy', 'Podium. On a marble made out of a scrapyard.'),
      L('ace', 'smug', 'Third is the scrapyard position. Natural habitat.'),
      L('vex', 'happy', 'Third is where investors start paying attention.'),
      L('zapp', 'happy', 'Points on the board, kid. That is a real season.'),
    ],
  },
  {
    id: 'c1-post-loss', chapter: 1, trigger: 'post-loss', outcome: 'loss', background: 'grandstand-race-day',
    lines: [
      L('sprocket', 'sad', 'That was a lot of wall. And a lot of gravel.'),
      L('ace', 'smug', 'Told you. County lines.'),
      L('red', 'surprised', 'First race is always a rummage, rookie.'),
      L('zapp', 'sad', 'Marble is bent. Still rolls. Mostly.'),
    ],
  },
  {
    id: 'c1-outro-yard', chapter: 1, trigger: 'outro', background: 'scrapyard-at-dusk',
    lines: [
      L('sprocket', 'happy', 'Back to the yard. Same fence, different view.'),
      L('zapp', 'happy', 'Monte Pipo next. Street circuit. Bring brakes you do not have.'),
      L('sprocket', 'smug', 'I have a bolt. The bolt is the brake.'),
    ],
  },

  // ── chapter 2: Street Smarts (Monte Pipo) ─────────────────────────────────
  {
    id: 'c2-intro-shack', chapter: 2, trigger: 'intro', background: 'old-smokey-training-shack',
    sets: ['metSmokey'],
    lines: [
      L('sprocket', 'shocked', 'Who is the old goblin living in our garage?'),
      L('smokey', 'angry', 'The one who raced the first GP. And lost it.'),
      L('sprocket', 'happy', "Old Smokey? There's a trophy in the yard with your name scratched off."),
      L('smokey', 'sad', "Helmet's all I kept. Nine years in a shack and it still fits.", 'old-racing-helmet'),
      L('sprocket', 'happy', 'Teach me something. Please.'),
      L('smokey', 'smug', "Lesson one: orange pegs are free speed. Lesson two: don't ask twice."),
      L('smokey', 'happy', 'Monte Pipo is tight. Ten pegs in a heat and I will teach you lesson three.'),
    ],
  },
  {
    id: 'c2-pre-street', chapter: 2, trigger: 'pre-race', background: 'grandstand-race-day',
    lines: [
      L('red', 'angry', 'Street circuit. Walls everywhere. Lovely for a bent marble.'),
      L('sprocket', 'smug', 'Bent and fast.'),
      L('grubba', 'happy', 'Grubba will find you in the chicane. Grubba always does.'),
      L('vex', 'smug', 'Sprocket. My office has a file on you. It is very thin.'),
      L('sprocket', 'happy', 'That is because I am new.'),
      L('vex', 'happy', 'That is because nobody has bought you yet.'),
    ],
  },
  {
    id: 'c2-pre-ace-wary', chapter: 2, trigger: 'pre-race', background: 'grandstand-race-day',
    when: { flag: 'beatAceEarly' },
    lines: [
      L('ace', 'angry', 'Marblehurst was a fluke. A bolt came loose. My bolt.'),
      L('sprocket', 'smug', 'Whatever you say, champion.'),
      L('ace', 'smug', 'Say it again in the last sector. I dare you.'),
    ],
  },
  {
    id: 'c2-mid-hood', chapter: 2, trigger: 'mid-race', atSector: 9, background: 'grandstand-race-day',
    lines: [L('hood', 'stern', '...you will not finish.')],
  },
  {
    id: 'c2-mid-smokey', chapter: 2, trigger: 'mid-race', atSector: 20, background: 'old-smokey-training-shack',
    lines: [L('smokey', 'angry', 'Pegs, kid! The orange ones pay the rent!')],
  },
  {
    id: 'c2-post-win', chapter: 2, trigger: 'post-win', outcome: 'win', background: 'old-smokey-training-shack',
    lines: [
      L('smokey', 'smug', 'Twelve pegs. Sloppy. Beautiful.'),
      L('sprocket', 'smug', 'You counted?'),
      L('smokey', 'happy', "I've counted every lap since the first GP. Lesson three is tomorrow."),
      L('ace', 'angry', 'Who is teaching the scrapyard?!'),
    ],
  },
  {
    id: 'c2-post-podium', chapter: 2, trigger: 'post-podium', outcome: 'podium', background: 'old-smokey-training-shack',
    lines: [
      L('smokey', 'happy', 'Podium and eight pegs. Close enough to teach from.'),
      L('sprocket', 'happy', 'Close enough counts?'),
      L('smokey', 'smug', 'In this shack, close enough is a trophy.'),
    ],
  },
  {
    id: 'c2-post-loss', chapter: 2, trigger: 'post-loss', outcome: 'loss', background: 'old-smokey-training-shack',
    lines: [
      L('sprocket', 'sad', 'The wall won. Again.'),
      L('smokey', 'angry', 'Good. Now you know which wall. That costs most people a season.'),
      L('smokey', 'sad', 'I hit that one in the first GP. Still hear it.'),
    ],
  },
  {
    id: 'c2-outro-hood', chapter: 2, trigger: 'outro', background: 'pit-lane-at-night',
    sets: ['hoodSeen'],
    lines: [
      L('hood', 'stern', '...you roll like someone I knew.'),
      L('sprocket', 'shocked', 'That is twice. Who are you?'),
      L('hood', 'smirk', '...ask in the dark. Down where the lights end.'),
      L('sprocket', 'sad', 'Smokey says the mine is off limits.'),
      L('hood', 'grimace', '...Smokey says a lot of things now.'),
    ],
  },
];
