/**
 * ACT III — DOWN WE GO (ST-06). Chapters 5–6: Suzuka Spiral and the Yas Marble finale, plus the endings.
 *
 * The Hood's face: Apex's missing star, racing for Vex to pay a debt. Vex is rigging the finale down the
 * mine. A reluctant alliance with Ace, a showdown in the dark, and one of three endings decided by the
 * final championship position — P1 champion, P2–3 bittersweet, anything else heartbreak.
 *
 * The Hood is `hood` (face hidden) up to and including the first lines of `c5-intro-mine`, and
 * `hood-revealed` from the moment the hood comes down.
 *
 * Voice: full, plain sentences (see act1.ts). Every line ≤ 90 characters.
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
      { id: 'c5-podium', label: 'Finish in the top three at Suzuka', kind: 'rank', rank: 3, scope: 'chapter' },
      { id: 'c5-hood', label: 'Finish a race ahead of The Hood', kind: 'ahead', rival: 'hood', scope: 'heat', bonus: true },
    ],
  },
  {
    chapter: 6, act: 3, gp: 5, title: 'Down We Go',
    // "Vex's wrecking crew": more chicanes means more swinging wrecking balls on the night track.
    weights: { Chicane: 4.0, 'Crack Wall Shortcut': 1.8 },
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
      { id: 'c6-finish', label: 'Finish all three races', kind: 'finish', target: 1, scope: 'chapter' },
      { id: 'c6-title', label: 'Win a race at Yas Marble', kind: 'rank', rank: 1, scope: 'heat', bonus: true },
      { id: 'c6-vex', label: 'Finish a race ahead of Duchess Vex', kind: 'ahead', rival: 'vex', scope: 'heat', bonus: true, flag: 'vexExposed' },
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
        L('ace', 'happy', 'I came second in the championship, behind a scrapyard goblin. My sponsors will cry.'),
        L('sprocket', 'smug', 'I will make sure to tell them, very loudly, that you helped me.'),
        L('ace', 'smug', 'We race again next season, partner, and I will not be this nice twice.'),
      ],
    });
    variants.push({
      id: id('vex'), chapter: 6, trigger: 'outro', background: 'vex-gilded-office', ending,
      when: { any: [{ flag: 'acceptedVexDeal' }, { flag: 'vexExposed' }] },
      lines: [
        L('vex', 'angry', 'The race officials found my plans for the mine. Somebody talked to them.'),
        L('vex', 'smug', 'Remember, child, my contracts last longer than any championship.'),
      ],
    });
    variants.push({
      id: id('hood'), chapter: 6, trigger: 'outro', background: 'mine-control-room', ending,
      when: { flag: 'hoodRedeemed' },
      lines: [
        L('hood-revealed', 'relieved', 'My debt to Vex is paid, and I raced that last race for myself, not for her.'),
        L('sprocket', 'happy', 'Apex Racing still has your old seat, you know. It has been empty all season.'),
      ],
    });
    variants.push({
      id: id('smokey-hurt'), chapter: 6, trigger: 'outro', background: 'old-smokey-training-shack', ending,
      when: { all: [{ flag: 'smokeyProud' }, { flag: 'smokeyInjured' }] },
      lines: [
        L('smokey', 'sad', 'My arm is still in a sling, so I watched the whole finale lying on a stretcher.'),
        L('smokey', 'happy', 'I lost the very first championship, but I taught the goblin who won this one.', 'framed-photo'),
      ],
    });
    variants.push({
      id: id('smokey'), chapter: 6, trigger: 'outro', background: 'old-smokey-training-shack', ending,
      when: { all: [{ flag: 'smokeyProud' }, { flag: 'smokeyInjured', not: true }] },
      lines: [
        L('smokey', 'smug', 'I spent years hiding in that shed, and now my student is the champion.'),
        L('sprocket', 'happy', 'Then we should put both of our names on the trophy.', 'iron-trophy'),
      ],
    });
  }
  if (ending === 'bittersweet') {
    variants.push({
      id: id('ace'), chapter: 6, trigger: 'outro', background: 'finale-podium', ending,
      when: { flag: 'aceAlly' },
      lines: [
        L('ace', 'smug', 'I won the championship, and you made the top three. Everybody is happy, mostly me.'),
        L('sprocket', 'smug', 'I saw you blocking Vex\'s drivers for me down in the mine.'),
        L('ace', 'surprised', 'You saw nothing, rookie. That was just an accident on the track.'),
      ],
    });
    variants.push({
      id: id('vex'), chapter: 6, trigger: 'outro', background: 'vex-gilded-office', ending,
      when: { any: [{ flag: 'acceptedVexDeal' }, { flag: 'vexExposed' }] },
      lines: [
        L('vex', 'happy', 'Third place overall. I can still use a driver like that, and I have a pen ready.'),
        L('sprocket', 'sad', 'I remember your pen. It felt heavier than my marble.'),
      ],
    });
    variants.push({
      id: id('hood'), chapter: 6, trigger: 'outro', background: 'mine-control-room', ending,
      when: { flag: 'hoodRedeemed' },
      lines: [
        L('hood-revealed', 'ashamed', 'Vex ordered me to take points from you this season, and I did it. I am sorry.'),
        L('hood-revealed', 'determined', 'Next season I race for nobody but myself, and for Apex, if they will have me.'),
      ],
    });
    variants.push({
      id: id('smokey-hurt'), chapter: 6, trigger: 'outro', background: 'old-smokey-training-shack', ending,
      when: { all: [{ flag: 'smokeyProud' }, { flag: 'smokeyInjured' }] },
      lines: [
        L('smokey', 'sad', 'Third place, a broken arm and rain. My first season ended exactly the same way.'),
        L('sprocket', 'happy', 'Then we will hang our two photos next to each other.', 'framed-photo'),
      ],
    });
    variants.push({
      id: id('smokey'), chapter: 6, trigger: 'outro', background: 'old-smokey-training-shack', ending,
      when: { all: [{ flag: 'smokeyProud' }, { flag: 'smokeyInjured', not: true }] },
      lines: [
        L('smokey', 'happy', 'Top three in your very first season. I missed out on that by a hair, back then.'),
        L('sprocket', 'smug', 'Next season, I am going to win the whole thing for both of us.'),
      ],
    });
  }
  if (ending === 'heartbreak') {
    variants.push({
      id: id('ace'), chapter: 6, trigger: 'outro', background: 'pit-lane-at-night', ending,
      when: { flag: 'aceAlly' },
      lines: [
        L('ace', 'sad', 'I blocked Vex\'s drivers as long as I could, but it was not enough. I am sorry.'),
        L('sprocket', 'smug', 'It was not your fault, Ace. She rigged a whole mine against us.'),
      ],
    });
    variants.push({
      id: id('vex'), chapter: 6, trigger: 'outro', background: 'vex-gilded-office', ending,
      when: { any: [{ flag: 'acceptedVexDeal' }, { flag: 'vexExposed' }] },
      lines: [
        L('vex', 'smug', 'You finished with no points, so you are of no use to me. How dull.'),
        L('sprocket', 'shocked', 'You cheated in the final race, and you still sound bored about it.'),
      ],
    });
    variants.push({
      id: id('hood'), chapter: 6, trigger: 'outro', background: 'mine-control-room', ending,
      when: { flag: 'hoodRedeemed' },
      lines: [
        L('hood-revealed', 'relieved', 'The race officials took Vex\'s equipment. You lost the race, but she lost more.'),
        L('sprocket', 'sad', 'It still does not feel the same as winning.'),
      ],
    });
    variants.push({
      id: id('smokey-hurt'), chapter: 6, trigger: 'outro', background: 'old-smokey-training-shack', ending,
      when: { all: [{ flag: 'smokeyProud' }, { flag: 'smokeyInjured' }] },
      lines: [
        L('smokey', 'sad', 'No points and a broken arm. My best season ended looking a lot like this.'),
        L('smokey', 'happy', 'But I still taught somebody worth teaching. Come back to the shed in spring.', 'old-racing-helmet'),
      ],
    });
    variants.push({
      id: id('smokey'), chapter: 6, trigger: 'outro', background: 'old-smokey-training-shack', ending,
      when: { all: [{ flag: 'smokeyProud' }, { flag: 'smokeyInjured', not: true }] },
      lines: [
        L('smokey', 'angry', 'Last place. Good, because now you owe nobody anything.'),
        L('sprocket', 'happy', 'Can I come back to your shed and train again in the spring?'),
        L('smokey', 'smug', 'You can, but come earlier this time. We have a lot of work to do.'),
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
        L('zapp', 'shocked', 'They are calling your name, kid! The scrapyard goblin is the new champion!'),
        L('sprocket', 'happy', 'An iron trophy, a dented marble, and one bolt that finally held on.', 'iron-trophy'),
        L('vex', 'angry', 'A marble made from scrap, standing on top of my podium. This is a disgrace.'),
        L('smokey', 'happy', 'I lost the first championship ever raced. Today I get to watch my student win one.'),
        L('sprocket', 'smug', 'We went all the way down into that mine, and we came back up as winners.'),
        L('zapp', 'surprised', 'And look, kid, two drivers already want to join Apex Racing next season.'),
      ],
    };
  }
  if (ending === 'bittersweet') {
    return {
      id: 'c6-end-bittersweet', chapter: 6, trigger: 'outro', background: 'finale-podium', ending,
      lines: [
        L('zapp', 'happy', 'Third place in the championship! You won a real trophy you can actually lift!', 'iron-trophy'),
        L('sprocket', 'sad', 'I was so close to winning. One better race would have done it.'),
        L('ace', 'smug', 'Top three is top three, rookie. Ask the drivers who finished at the bottom.'),
        L('smokey', 'happy', 'You came out of that mine with a trophy. Most drivers come out with nothing.'),
        L('sprocket', 'smug', 'Next season, I will either win the whole thing or go back to the scrapyard.'),
        L('zapp', 'surprised', 'And guess what, kid? Two new drivers already want to join Apex Racing.'),
      ],
    };
  }
  return {
    id: 'c6-end-heartbreak', chapter: 6, trigger: 'outro', background: 'pit-lane-at-night', ending,
    lines: [
      L('sprocket', 'sad', 'No championship points, and my marble is in pieces inside a bag.', 'cracked-marble'),
      L('zapp', 'sad', 'I can build you a new marble, kid. I built my first one out of a washing machine.'),
      L('smokey', 'angry', 'Vex rigged the final race, and you still drove straight down into that mine.'),
      L('smokey', 'sad', 'That bravery is what I will remember, not where you finished.', 'lantern'),
      L('sprocket', 'happy', 'Then I will come back next season and do it all again.'),
      L('zapp', 'surprised', 'Two drivers have already asked to join Apex Racing next season, kid.'),
    ],
  };
}

export const ACT3_SCENES: readonly Scene[] = [
  // ── chapter 5: The Hood (Suzuka Spiral) ───────────────────────────────────
  {
    id: 'c5-intro-mine-known', chapter: 5, trigger: 'intro', background: 'mine-control-room',
    when: { flag: 'hoodSeen' },
    lines: [
      L('sprocket', 'shocked', 'I found the old mine, like you told me to. I came to ask Smokey\'s secret myself.'),
      L('hood', 'grimace', 'You actually came down here. That was not supposed to happen.'),
    ],
  },
  {
    id: 'c5-intro-mine', chapter: 5, trigger: 'intro', background: 'mine-control-room',
    sting: true, sets: ['hoodRevealed'],
    lines: [
      L('vex', 'smug', 'Welcome to my mine, under the next track. This is where I plan my races.'),
      L('hood', 'stern', 'I did not ask for anybody to come down here and watch.'),
      L('sprocket', 'shocked', 'Wait, I know your face. You are in the old team photo in the Apex garage. You are—'),
      L('hood-revealed', 'ashamed', 'I am the Apex Racing driver who disappeared last season. Yes, it is me.', 'folded-hood'),
      L('sprocket', 'shocked', 'You are The Hood? You have been racing for Vex this whole time?'),
      L('hood-revealed', 'angry', 'I owed Vex a lot of money. Racing for her in secret is how I pay it back.'),
      L('vex', 'happy', 'Two Apex drivers in one room, and one very old contract. How lovely.', 'framed-photo'),
      L('smokey', 'sad', 'I trained that driver too, years ago, in the same shed where I trained you.'),
    ],
  },
  {
    id: 'c5-pre-crash', chapter: 5, trigger: 'pre-race', background: 'apex-racing-garage',
    when: { flag: 'midpointCrash' },
    lines: [
      L('zapp', 'surprised', 'I rebuilt your marble with a new bolt and new parts. This time it will hold.'),
      L('sprocket', 'smug', 'It had better, because somebody cut through the last bolt with a saw.'),
    ],
  },
  {
    id: 'c5-pre-ally', chapter: 5, trigger: 'pre-race', background: 'apex-racing-garage',
    choice: {
      prompt: 'Ace, your old rival, offers to team up against Vex. Do you accept?',
      options: [
        { label: 'Team up with Ace', set: 'aceAlly' },
        { label: 'Race alone', set: 'aceAlly', value: false },
      ],
    },
    lines: [
      L('ace', 'surprised', 'Vex has paid off the race officials. All of them. Try not to look so surprised.'),
      L('sprocket', 'smug', 'You once told me she keeps a file on every driver in the sport.'),
      L('ace', 'angry', 'She has a file on me too. Now she wants to control the whole championship.'),
      L('ace', 'happy', 'Our next track is Suzuka Spiral, which is full of spinning traps and splitters.'),
      L('ace', 'smug', 'If we work together there, we can beat her drivers. Alone, we both lose.'),
    ],
  },
  {
    id: 'c5-pre-grid', chapter: 5, trigger: 'pre-race', background: 'grandstand-race-day',
    lines: [
      L('red', 'angry', 'Suzuka is full of spinners, so somebody is going to get flung off the track.'),
      L('hood-revealed', 'determined', 'I have always raced wherever Vex told me to. Today I race against her instead.'),
      L('sprocket', 'happy', 'Then today, we race against her together.'),
    ],
  },
  {
    id: 'c5-mid-mine', chapter: 5, trigger: 'mid-race', atSector: 14, background: 'mine-control-room',
    lines: [L('vex', 'angry', 'Drivers, stop the Apex marbles before the next section. That is an order.')],
  },
  {
    id: 'c5-mid-ally', chapter: 5, trigger: 'mid-race', atSector: 24, background: 'grandstand-race-day',
    lines: [L('ace', 'surprised', 'Take the left side, rookie! I will block the spinner on the right!')],
  },
  {
    id: 'c5-post-win', chapter: 5, trigger: 'post-win', outcome: 'win', background: 'grandstand-race-day',
    lines: [
      L('ace', 'shocked', 'You won at Suzuka, using the racing line I showed you. Do not tell my sponsors.'),
      L('hood-revealed', 'relieved', 'Vex watched the whole race from her control room in the mine. She saw you win.'),
      L('sprocket', 'smug', 'Good. I hope she looked at the scoreboard for a very long time.'),
    ],
  },
  {
    id: 'c5-post-podium', chapter: 5, trigger: 'post-podium', outcome: 'podium', background: 'grandstand-race-day',
    lines: [
      L('smokey', 'happy', 'A top three finish, even with Vex working against you. That will annoy her.'),
      L('hood-revealed', 'ashamed', 'Vex ordered me to take that place away from you. I could not do it.'),
      L('sprocket', 'smug', 'Refusing her orders is the bravest thing I have seen anyone do today.'),
    ],
  },
  {
    id: 'c5-post-loss', chapter: 5, trigger: 'post-loss', outcome: 'loss', background: 'pit-lane-at-night',
    lines: [
      L('sprocket', 'sad', 'One spinning trap hit me, and I lost three places just like that.'),
      L('ace', 'angry', 'Vex\'s crew changed the race timing. You were never racing a fair clock.'),
      L('hood-revealed', 'determined', 'The final race is down in the mine. Bring everything you have left.'),
    ],
  },
  {
    id: 'c5-outro-plan', chapter: 5, trigger: 'outro', background: 'mine-control-room',
    sets: ['vexPlan'],
    lines: [
      L('hood-revealed', 'angry', 'These are Vex\'s plans. She controls every camera, light and explosive down here.', 'mine-blueprint'),
      L('vex', 'smug', 'The final track is Yas Marble, a night race, and part of it runs through my mine.'),
      L('sprocket', 'shocked', 'You put dynamite on a race track? People could get hurt!'),
      L('vex', 'happy', 'It is building work, darling. Scheduled building work, and perfectly legal.', 'dynamite-bundle'),
      L('hood-revealed', 'determined', 'Her plan is to blow up the race if she is losing. We cannot let that happen.'),
      L('smokey', 'angry', 'Then we make sure every driver gets to the finish line safely. Down we go.'),
    ],
  },

  // ── chapter 6: Down We Go (Yas Marble finale) ─────────────────────────────
  {
    id: 'c6-intro-mine', chapter: 6, trigger: 'intro', background: 'mine-control-room',
    when: { flag: 'vexPlan' },
    lines: [
      L('zapp', 'surprised', 'I found explosives in two places on the track: section ten and section twenty-six.'),
      L('sprocket', 'shocked', 'You went down into the mine by yourself to look?'),
      L('zapp', 'angry', 'I am a mechanic, kid. Following wires is part of my job.'),
      L('smokey', 'sad', 'It is a night race on the longest track of the season, and Vex controls the lights.'),
    ],
  },
  {
    id: 'c6-intro-blind', chapter: 6, trigger: 'intro', background: 'mine-control-room',
    when: { flag: 'vexPlan', not: true },
    lines: [
      L('smokey', 'angry', 'Nobody knows what Vex has hidden on this track, and that is the worst kind of danger.'),
      L('sprocket', 'smug', 'Then I will find out what she has hidden while I am racing past it.'),
    ],
  },
  {
    id: 'c6-intro-zapp', chapter: 6, trigger: 'intro', background: 'apex-racing-garage',
    when: { flag: 'trustedZapp' },
    lines: [
      L('zapp', 'happy', 'You believed me after the crash at Spa, so look what I found for you.', 'wrench-and-bolt'),
      L('zapp', 'angry', 'This receipt shows Vex\'s crew bought the exact bolt that broke on your marble.'),
      L('sprocket', 'smug', 'So it was Vex all along. Now we have proof.'),
    ],
  },
  {
    id: 'c6-pre-podium', chapter: 6, trigger: 'pre-race', background: 'finale-podium',
    lines: [
      L('ace', 'smug', 'This is the final track of the season, rookie. Try not to dent the trophy.'),
      L('vex', 'happy', 'Welcome to Yas Marble, everyone. Everything you can see here belongs to me.'),
      L('sprocket', 'smug', 'Everything except the race. You cannot own who wins.'),
      L('smokey', 'angry', 'Watch out at sections ten and twenty-six, kid. Whatever happens, keep rolling.'),
    ],
  },
  {
    id: 'c6-pre-ally', chapter: 6, trigger: 'pre-race', background: 'apex-racing-garage',
    when: { flag: 'aceAlly' },
    lines: [
      L('ace', 'surprised', 'Here is the plan. I block Vex\'s drivers, and you race for the win.'),
      L('sprocket', 'happy', 'The champion is protecting the scrapyard goblin. I never thought I would see it.'),
      L('ace', 'angry', 'Say that one more time, and I will start blocking you instead.'),
    ],
  },
  {
    id: 'c6-pre-alone', chapter: 6, trigger: 'pre-race', background: 'apex-racing-garage',
    when: { flag: 'aceAlly', not: true },
    lines: [
      L('zapp', 'sad', 'So you are racing alone. Ten marbles, one rookie, and a mine full of dynamite.'),
      L('sprocket', 'smug', 'Doing things alone is how we have always done it in the scrapyard.'),
    ],
  },
  {
    id: 'c6-mid-crew', chapter: 6, trigger: 'mid-race', atSector: 11, background: 'mine-control-room',
    lines: [L('vex', 'angry', 'Crew, the rookie is coming. Get ready to stop that marble!')],
  },
  {
    id: 'c6-mid-blast', chapter: 6, trigger: 'mid-race', atSector: 25, background: 'mine-control-room',
    lines: [L('zapp', 'shocked', 'The explosives are just ahead! Stay on the left and keep rolling!')],
  },
  {
    id: 'c6-post-win', chapter: 6, trigger: 'post-win', outcome: 'win', background: 'finale-podium',
    lines: [
      L('ace', 'shocked', 'You won the final race, through a mine full of traps, on my racing line.'),
      L('vex', 'angry', 'The race officials are asking about my explosives. Who told them?'),
      L('sprocket', 'smug', 'Everyone told them. That is the problem with making so many enemies.'),
    ],
  },
  {
    id: 'c6-post-podium', chapter: 6, trigger: 'post-podium', outcome: 'podium', background: 'finale-podium',
    lines: [
      L('smokey', 'happy', 'A top three finish in the final race. Whatever the scoreboard says, that is real.'),
      L('hood-revealed', 'relieved', 'Vex did not get the result she paid for. That is a win for all of us.'),
      L('sprocket', 'sad', 'She still got most of what she wanted, though.'),
    ],
  },
  {
    id: 'c6-post-loss', chapter: 6, trigger: 'post-loss', outcome: 'loss', background: 'pit-lane-at-night',
    lines: [
      L('sprocket', 'sad', 'The explosion at section twenty-six threw me off the track, and that was it.'),
      L('zapp', 'angry', 'Vex\'s crew was waiting right there on the left side with the explosives.'),
      L('smokey', 'sad', 'But every driver reached the finish line safely, and that was our real plan.'),
    ],
  },
  {
    id: 'c6-outro-hood', chapter: 6, trigger: 'outro', background: 'mine-control-room',
    when: { flag: 'hoodRevealed' }, sets: ['hoodRedeemed'],
    lines: [
      L('hood-revealed', 'determined', 'I tore up my contract with Vex. I have paid her back with every race I lost.'),
      L('vex', 'angry', 'Without my team, you are nothing. Nobody will hire you.'),
      L('hood-revealed', 'relieved', 'I am a driver who can show my face again. That is worth more than your team.'),
      L('sprocket', 'happy', 'Apex Racing still has your old seat. It has been waiting for you all season.'),
    ],
  },

  // ── endings: the final championship position picks one family ─────────────
  endingBase('champion'), ...endingVariants('champion'),
  endingBase('bittersweet'), ...endingVariants('bittersweet'),
  endingBase('heartbreak'), ...endingVariants('heartbreak'),
];
