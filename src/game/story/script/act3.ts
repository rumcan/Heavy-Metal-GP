/**
 * ACT III — DOWN WE GO (ST-06). Chapters 5–6: Suzuka Spiral and the Yas Marble finale, plus the endings.
 *
 * The Hood's face: Apex's missing star, racing for Vex to pay a debt. Vex is rigging the finale down the
 * mine. A reluctant alliance with Ace, a showdown in the dark, and one of three endings decided by the
 * final championship position — P1 champion, P2–3 bittersweet, anything else heartbreak.
 *
 * The Hood is `hood` (face hidden) up to and including the first lines of `c5-intro-mine`, and
 * `hood-revealed` from the moment the hood comes down. Every line ≤ 90 characters.
 */
import type { ChapterDef, Line, Scene } from '../types';
import type { StoryProp } from '../assets';
import type { CastId } from '../cast';

const L = (who: CastId, mood: string, text: string, prop?: StoryProp): Line => (prop ? { who, mood, text, prop } : { who, mood, text });

export const ACT3_CHAPTERS: readonly ChapterDef[] = [
  {
    chapter: 5, act: 3, gp: 4, title: 'The Hood',
    weights: { Spinners: 2.6, Chicane: 1.6 },
    ai: [
      { who: 'hood', target: 'player' },
      { who: 'vex', target: 'player' },
      { who: 'ace', target: 'vex', when: { flag: 'aceAlly' } },
    ],
    events: [{ id: 'c5-tremor', kind: 'shake', atSector: 16, message: 'THE MINE IS SHAKING' }],
    objectives: [
      { id: 'c5-podium', label: 'Podium at Suzuka', kind: 'rank', rank: 3, scope: 'chapter' },
      { id: 'c5-hood', label: 'Finish ahead of The Hood', kind: 'ahead', rival: 'hood', scope: 'heat', bonus: true },
    ],
  },
  {
    chapter: 6, act: 3, gp: 5, title: 'Down We Go',
    // "Vex's wrecking crew": more chicanes means more swinging wrecking balls on the night track.
    weights: { Chicane: 3.2, 'Crack Wall Shortcut': 1.8 },
    completeFlag: 'smokeyProud',
    ai: [
      { who: 'vex', target: 'player' },
      { who: 'hood', target: 'player' },
      { who: 'ace', target: 'vex', when: { flag: 'aceAlly' } },
      { who: 'zapp', target: 'vex', when: { flag: 'trustedZapp' } },
    ],
    events: [
      { id: 'c6-slick', kind: 'slick', atSector: 10, message: "VEX'S CREW DUMPED OIL" },
      { id: 'c6-blast', kind: 'shake', atSector: 26, message: 'DYNAMITE! HOLD YOUR LINE' },
    ],
    objectives: [
      { id: 'c6-finish', label: 'See the chequered flag', kind: 'finish', target: 1, scope: 'chapter' },
      { id: 'c6-title', label: 'Win the finale', kind: 'rank', rank: 1, scope: 'heat', bonus: true },
      { id: 'c6-vex', label: 'Beat Duchess Vex', kind: 'ahead', rival: 'vex', scope: 'heat', bonus: true, flag: 'vexExposed' },
    ],
  },
];

/** Epilogue variants shared by all three endings, in play order. */
function endingVariants(ending: 'champion' | 'bittersweet' | 'heartbreak'): Scene[] {
  const id = (slug: string) => `c6-end-${ending}-${slug}`;
  const variants: Scene[] = [];
  if (ending === 'champion') {
    variants.push({
      id: id('ace'), chapter: 6, trigger: 'outro', background: 'finale-podium', ending,
      when: { flag: 'aceAlly' },
      lines: [
        L('ace', 'happy', 'Second place. To a scrapyard goblin. Say that to my sponsors.'),
        L('sprocket', 'smug', 'I will. Loudly.'),
        L('ace', 'smug', 'Same grid next year, ally. I will not be polite twice.'),
      ],
    });
    variants.push({
      id: id('vex'), chapter: 6, trigger: 'outro', background: 'vex-gilded-office', ending,
      when: { any: [{ flag: 'acceptedVexDeal' }, { flag: 'vexExposed' }] },
      lines: [
        L('vex', 'angry', 'The stewards have my blueprint. Somebody talked.'),
        L('vex', 'smug', 'Contracts outlive championships, child. Mine are still in force.'),
      ],
    });
    variants.push({
      id: id('hood'), chapter: 6, trigger: 'outro', background: 'mine-control-room', ending,
      when: { flag: 'hoodRedeemed' },
      lines: [
        L('hood-revealed', 'relieved', 'Debt paid. Face back. I raced the last lap for me.'),
        L('sprocket', 'happy', 'Apex has a first seat open. It has for a season.'),
      ],
    });
    variants.push({
      id: id('smokey-hurt'), chapter: 6, trigger: 'outro', background: 'old-smokey-training-shack', ending,
      when: { all: [{ flag: 'smokeyProud' }, { flag: 'smokeyInjured' }] },
      lines: [
        L('smokey', 'sad', 'Arm in a splint. Watched the whole thing from a stretcher.'),
        L('smokey', 'happy', 'First GP I lost. Last one I taught. That is a good trade.', 'framed-photo'),
      ],
    });
    variants.push({
      id: id('smokey'), chapter: 6, trigger: 'outro', background: 'old-smokey-training-shack', ending,
      when: { all: [{ flag: 'smokeyProud' }, { flag: 'smokeyInjured', not: true }] },
      lines: [
        L('smokey', 'smug', 'Nine years in a shack and the kid wins it. Scratch my name back on.'),
        L('sprocket', 'happy', 'Both names. One trophy.', 'iron-trophy'),
      ],
    });
  }
  if (ending === 'bittersweet') {
    variants.push({
      id: id('ace'), chapter: 6, trigger: 'outro', background: 'finale-podium', ending,
      when: { flag: 'aceAlly' },
      lines: [
        L('ace', 'smug', 'I won. You are on the podium. Everybody is happy. Mostly me.'),
        L('sprocket', 'smug', 'You blocked Vex for three sectors. I saw it.'),
        L('ace', 'surprised', 'You saw nothing. That was a racing incident.'),
      ],
    });
    variants.push({
      id: id('vex'), chapter: 6, trigger: 'outro', background: 'vex-gilded-office', ending,
      when: { any: [{ flag: 'acceptedVexDeal' }, { flag: 'vexExposed' }] },
      lines: [
        L('vex', 'happy', 'Third is a number I can work with. My office has a pen.'),
        L('sprocket', 'sad', 'The pen is heavier than my marble. I remember.'),
      ],
    });
    variants.push({
      id: id('hood'), chapter: 6, trigger: 'outro', background: 'mine-control-room', ending,
      when: { flag: 'hoodRedeemed' },
      lines: [
        L('hood-revealed', 'ashamed', 'I took the podium spot you earned. In the dark, at her order.'),
        L('hood-revealed', 'determined', 'Next season I race for nobody. Second seat is open.'),
      ],
    });
    variants.push({
      id: id('smokey-hurt'), chapter: 6, trigger: 'outro', background: 'old-smokey-training-shack', ending,
      when: { all: [{ flag: 'smokeyProud' }, { flag: 'smokeyInjured' }] },
      lines: [
        L('smokey', 'sad', 'Third. Splint. Rain. It is the same photo as my first GP.'),
        L('sprocket', 'happy', 'Then we hang them side by side.', 'framed-photo'),
      ],
    });
    variants.push({
      id: id('smokey'), chapter: 6, trigger: 'outro', background: 'old-smokey-training-shack', ending,
      when: { all: [{ flag: 'smokeyProud' }, { flag: 'smokeyInjured', not: true }] },
      lines: [
        L('smokey', 'happy', 'Podium at the finale. I lost mine by four tenths. You did not.'),
        L('sprocket', 'smug', 'Four tenths. I heard that number before.'),
      ],
    });
  }
  if (ending === 'heartbreak') {
    variants.push({
      id: id('ace'), chapter: 6, trigger: 'outro', background: 'pit-lane-at-night', ending,
      when: { flag: 'aceAlly' },
      lines: [
        L('ace', 'sad', 'I blocked her crew. It was not enough. Do not make it my fault.'),
        L('sprocket', 'smug', 'It was not your fault. It was a mine.'),
      ],
    });
    variants.push({
      id: id('vex'), chapter: 6, trigger: 'outro', background: 'vex-gilded-office', ending,
      when: { any: [{ flag: 'acceptedVexDeal' }, { flag: 'vexExposed' }] },
      lines: [
        L('vex', 'smug', 'No points, no leverage, no story. My file on you stays thin.'),
        L('sprocket', 'shocked', 'You rigged the finale and you still sound bored.'),
      ],
    });
    variants.push({
      id: id('hood'), chapter: 6, trigger: 'outro', background: 'mine-control-room', ending,
      when: { flag: 'hoodRedeemed' },
      lines: [
        L('hood-revealed', 'relieved', 'Her rig is in the stewards van. You lost the race, not the sport.'),
        L('sprocket', 'sad', 'That is not the same as winning.'),
      ],
    });
    variants.push({
      id: id('smokey-hurt'), chapter: 6, trigger: 'outro', background: 'old-smokey-training-shack', ending,
      when: { all: [{ flag: 'smokeyProud' }, { flag: 'smokeyInjured' }] },
      lines: [
        L('smokey', 'sad', 'No points. Broken arm. My best season looked like this too.'),
        L('smokey', 'happy', 'And I still taught somebody. Come back in the spring.', 'old-racing-helmet'),
      ],
    });
    variants.push({
      id: id('smokey'), chapter: 6, trigger: 'outro', background: 'old-smokey-training-shack', ending,
      when: { all: [{ flag: 'smokeyProud' }, { flag: 'smokeyInjured', not: true }] },
      lines: [
        L('smokey', 'angry', 'Last place. Good. Now nothing is owed to anybody.'),
        L('sprocket', 'happy', 'Same shack in the spring?'),
        L('smokey', 'smug', 'Same shack. Earlier.'),
      ],
    });
  }
  return variants;
}

function endingBase(ending: 'champion' | 'bittersweet' | 'heartbreak'): Scene {
  if (ending === 'champion') {
    return {
      id: 'c6-end-champion', chapter: 6, trigger: 'outro', background: 'finale-podium', ending,
      sting: true,
      lines: [
        L('zapp', 'shocked', 'They are saying your name on the tower! The scrapyard kid!'),
        L('sprocket', 'happy', 'Iron trophy. Nine dents. One bolt that held.', 'iron-trophy'),
        L('vex', 'angry', 'A bearing with a bolt in it. On my podium. In my sport.'),
        L('smokey', 'happy', 'First GP I lost. Last one I watched from the top step.'),
        L('sprocket', 'smug', 'Down we went. Came back up.'),
        L('zapp', 'surprised', 'And there is mail. Two entries for next year. From the mine.'),
      ],
    };
  }
  if (ending === 'bittersweet') {
    return {
      id: 'c6-end-bittersweet', chapter: 6, trigger: 'outro', background: 'finale-podium', ending,
      lines: [
        L('zapp', 'happy', 'Third! Points! A trophy you can actually lift!', 'iron-trophy'),
        L('sprocket', 'sad', 'One place. One sector. One bolt.'),
        L('ace', 'smug', 'Podium is podium, runt. Ask the ones in the gravel.'),
        L('smokey', 'happy', 'You came up out of that mine with something. Most do not.'),
        L('sprocket', 'smug', 'Next year it is the top step or the yard.'),
        L('zapp', 'surprised', 'Mail for you. Two new entries. Both from the mine.'),
      ],
    };
  }
  return {
    id: 'c6-end-heartbreak', chapter: 6, trigger: 'outro', background: 'pit-lane-at-night', ending,
    lines: [
      L('sprocket', 'sad', 'No points. The marble is in a bag.', 'cracked-marble'),
      L('zapp', 'sad', 'I can build another. I built the first one from a washing drum.'),
      L('smokey', 'angry', 'They rigged the last sector and you still went down there.'),
      L('smokey', 'sad', 'That is the part I will remember. Not the classification.', 'lantern'),
      L('sprocket', 'happy', 'Then I will do it again. Down we go.'),
      L('zapp', 'surprised', 'Two entries for next season. Addressed to the yard.'),
    ],
  };
}

export const ACT3_SCENES: readonly Scene[] = [
  // ── chapter 5: The Hood (Suzuka Spiral) ───────────────────────────────────
  {
    id: 'c5-intro-mine-known', chapter: 5, trigger: 'intro', background: 'mine-control-room',
    when: { flag: 'hoodSeen' },
    lines: [
      L('sprocket', 'shocked', 'The lights end here. You said to ask in the dark.'),
      L('hood', 'grimace', '...you came. That was not in the plan.'),
    ],
  },
  {
    id: 'c5-intro-mine', chapter: 5, trigger: 'intro', background: 'mine-control-room',
    sting: true, sets: ['hoodRevealed'],
    lines: [
      L('vex', 'smug', 'My best driver, and a mechanic who asks no questions. Down we go.'),
      L('hood', 'stern', '...I did not choose the audience.'),
      L('sprocket', 'shocked', 'That voice. That is the paddock voice. That is—'),
      L('hood-revealed', 'ashamed', 'Apex Racing. First seat. Last season.', 'folded-hood'),
      L('sprocket', 'shocked', 'The Hood is the driver who vanished. Vex has your debt.'),
      L('hood-revealed', 'angry', 'Vex has the debt. The mine has the interest.'),
      L('vex', 'happy', 'Two of you, one photograph, and a very old contract.', 'framed-photo'),
      L('smokey', 'sad', 'I taught that one too. Nine years ago. Same shack.'),
    ],
  },
  {
    id: 'c5-pre-crash', chapter: 5, trigger: 'pre-race', background: 'apex-racing-garage',
    when: { flag: 'midpointCrash' },
    lines: [
      L('zapp', 'surprised', 'New bolt, new tube, new everything. It will hold.'),
      L('sprocket', 'smug', 'It had better. Somebody sawed the last one.'),
    ],
  },
  {
    id: 'c5-pre-ally', chapter: 5, trigger: 'pre-race', background: 'apex-racing-garage',
    choice: {
      prompt: 'Ace Spadegrin is in the paddock, holding two coffees and no sponsor.',
      options: [
        { label: 'Trust Ace', set: 'aceAlly' },
        { label: 'Race alone', set: 'aceAlly', value: false },
      ],
    },
    lines: [
      L('ace', 'surprised', 'She bought the referees. Both of them. Do not look surprised.'),
      L('sprocket', 'smug', 'You told me she had a file on everybody.'),
      L('ace', 'angry', 'She has mine too. Suzuka is spinners and she owns the schedule.'),
      L('ace', 'smug', 'Two marbles, one line. Or one marble and a lot of gravel.'),
    ],
  },
  {
    id: 'c5-pre-grid', chapter: 5, trigger: 'pre-race', background: 'grandstand-race-day',
    lines: [
      L('red', 'angry', 'Suzuka. Spinners. Somebody is going to be a shuttlecock.'),
      L('hood-revealed', 'determined', '...I race where she points. Tonight I point at her.'),
      L('sprocket', 'happy', 'Then tonight we both do.'),
    ],
  },
  {
    id: 'c5-mid-mine', chapter: 5, trigger: 'mid-race', atSector: 14, background: 'mine-control-room',
    lines: [L('vex', 'angry', 'Sector sixteen is mine. Both of you. That is an instruction.')],
  },
  {
    id: 'c5-mid-ally', chapter: 5, trigger: 'mid-race', atSector: 24, background: 'grandstand-race-day',
    lines: [L('ace', 'surprised', 'Left line! Take the left line, I have the spinner!')],
  },
  {
    id: 'c5-post-win', chapter: 5, trigger: 'post-win', outcome: 'win', background: 'grandstand-race-day',
    lines: [
      L('ace', 'shocked', 'A win at Suzuka. With my line. Do not tell my sponsors.'),
      L('hood-revealed', 'relieved', 'She watched the whole race from the control room. She saw you.'),
      L('sprocket', 'smug', 'Good. Let her look at the number one.'),
    ],
  },
  {
    id: 'c5-post-podium', chapter: 5, trigger: 'post-podium', outcome: 'podium', background: 'grandstand-race-day',
    lines: [
      L('smokey', 'happy', 'Podium under her schedule. That is a thumb in the eye.'),
      L('hood-revealed', 'ashamed', 'I was told to take it from you. I did not manage it.'),
      L('sprocket', 'smug', 'Second best rebellion I have seen tonight.'),
    ],
  },
  {
    id: 'c5-post-loss', chapter: 5, trigger: 'post-loss', outcome: 'loss', background: 'pit-lane-at-night',
    lines: [
      L('sprocket', 'sad', 'A spinner and three positions. Just like that.'),
      L('ace', 'angry', 'Her crew moved the schedule. You were racing a different clock.'),
      L('hood-revealed', 'determined', 'The finale is down the mine. Bring everything you have left.'),
    ],
  },
  {
    id: 'c5-outro-plan', chapter: 5, trigger: 'outro', background: 'mine-control-room',
    sets: ['vexPlan'],
    lines: [
      L('hood-revealed', 'angry', 'This is her rig. Every camera, every light, every blast charge.', 'mine-blueprint'),
      L('vex', 'smug', 'The finale runs under the island. Yas Marble, and the mine beneath it.'),
      L('sprocket', 'shocked', 'Dynamite. At a race.'),
      L('vex', 'happy', 'Structural work. Scheduled. Very legal.', 'dynamite-bundle'),
      L('hood-revealed', 'determined', 'She wins either way. Unless the race finishes on its feet.'),
      L('smokey', 'angry', 'Then we finish it on its feet. Down we go.'),
    ],
  },

  // ── chapter 6: Down We Go (Yas Marble finale) ─────────────────────────────
  {
    id: 'c6-intro-mine', chapter: 6, trigger: 'intro', background: 'mine-control-room',
    when: { flag: 'vexPlan' },
    lines: [
      L('zapp', 'surprised', 'Charges at sector ten and twenty-six. I counted the wires.'),
      L('sprocket', 'shocked', 'You went down there?'),
      L('zapp', 'angry', 'I am a mechanic. Wires are a dialect.'),
      L('smokey', 'sad', 'Night race, longest track, and the lights are hers.'),
    ],
  },
  {
    id: 'c6-intro-blind', chapter: 6, trigger: 'intro', background: 'mine-control-room',
    when: { flag: 'vexPlan', not: true },
    lines: [
      L('smokey', 'angry', 'Nobody knows what she has rigged. That is the worst kind of track.'),
      L('sprocket', 'smug', 'Then we find out at speed.'),
    ],
  },
  {
    id: 'c6-intro-zapp', chapter: 6, trigger: 'intro', background: 'apex-racing-garage',
    when: { flag: 'trustedZapp' },
    lines: [
      L('zapp', 'happy', 'You believed me at Spa. So here is the receipt.', 'wrench-and-bolt'),
      L('zapp', 'angry', 'Her crew bought the same bolt. Twice. In cash.'),
      L('sprocket', 'smug', 'A smoking gun, and it has a wrench on it.'),
    ],
  },
  {
    id: 'c6-pre-podium', chapter: 6, trigger: 'pre-race', background: 'finale-podium',
    lines: [
      L('ace', 'smug', 'Night finale. Longest track of the year. Try not to dent the trophy.'),
      L('vex', 'happy', 'Welcome to Yas Marble. Everything you can see is mine.'),
      L('sprocket', 'smug', 'Everything except the race.'),
      L('smokey', 'angry', 'Sector ten and twenty-six. Whatever happens there, keep rolling.'),
    ],
  },
  {
    id: 'c6-pre-ally', chapter: 6, trigger: 'pre-race', background: 'apex-racing-garage',
    when: { flag: 'aceAlly' },
    lines: [
      L('ace', 'surprised', 'Plan: I take her crew, you take the flag.'),
      L('sprocket', 'happy', 'The champion is blocking for the scrapyard.'),
      L('ace', 'angry', 'Say that again and I block for her.'),
    ],
  },
  {
    id: 'c6-pre-alone', chapter: 6, trigger: 'pre-race', background: 'apex-racing-garage',
    when: { flag: 'aceAlly', not: true },
    lines: [
      L('zapp', 'sad', 'Alone then. Ten marbles, one bolt, and a mine.'),
      L('sprocket', 'smug', 'That is how the yard does it.'),
    ],
  },
  {
    id: 'c6-mid-crew', chapter: 6, trigger: 'mid-race', atSector: 11, background: 'mine-control-room',
    lines: [L('vex', 'angry', 'Wrecking crew, sector eleven. That is a schedule, not a threat.')],
  },
  {
    id: 'c6-mid-blast', chapter: 6, trigger: 'mid-race', atSector: 25, background: 'mine-control-room',
    lines: [L('zapp', 'shocked', 'Charges! Twenty-six! Hold the left line and keep rolling!')],
  },
  {
    id: 'c6-post-win', chapter: 6, trigger: 'post-win', outcome: 'win', background: 'finale-podium',
    lines: [
      L('ace', 'shocked', 'You won the finale. In a mine. On my line.'),
      L('vex', 'angry', 'The stewards are asking about the charges. Who talked?'),
      L('sprocket', 'smug', 'Everybody. That is the trick with a paddock.'),
    ],
  },
  {
    id: 'c6-post-podium', chapter: 6, trigger: 'post-podium', outcome: 'podium', background: 'finale-podium',
    lines: [
      L('smokey', 'happy', 'On the podium at the finale. Whatever the table says, that is real.'),
      L('hood-revealed', 'relieved', 'She did not get the number she paid for.'),
      L('sprocket', 'sad', 'She got most of it.'),
    ],
  },
  {
    id: 'c6-post-loss', chapter: 6, trigger: 'post-loss', outcome: 'loss', background: 'pit-lane-at-night',
    lines: [
      L('sprocket', 'sad', 'Sector twenty-six. Then nothing but gravel.'),
      L('zapp', 'angry', 'Her crew was in the left line with a charge and a clipboard.'),
      L('smokey', 'sad', 'The race still finished. On its feet. That was the plan.'),
    ],
  },
  {
    id: 'c6-outro-hood', chapter: 6, trigger: 'outro', background: 'mine-control-room',
    when: { flag: 'hoodRevealed' }, sets: ['hoodRedeemed'],
    lines: [
      L('hood-revealed', 'determined', 'Contract in the shredder. Debt paid in points I did not keep.'),
      L('vex', 'angry', 'You are nothing without my garage.'),
      L('hood-revealed', 'relieved', 'I am a driver with a face. That is more than I had.'),
      L('sprocket', 'happy', 'Apex has a first seat. It has been warm for a season.'),
    ],
  },

  // ── endings: the final championship position picks one family ─────────────
  endingBase('champion'), ...endingVariants('champion'),
  endingBase('bittersweet'), ...endingVariants('bittersweet'),
  endingBase('heartbreak'), ...endingVariants('heartbreak'),
];
