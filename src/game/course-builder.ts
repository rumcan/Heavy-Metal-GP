import type { Builder, SegmentInfo } from './track';
import type { TrackProfile } from './types';
import { planCourse } from './course-plan';

const NAMES = {
  mass: 'Foundry Cut · weight gate / outer road',
  rebound: 'Spring Exchange · upper shelf / lower road',
  burrow: 'Smuggler Run · jump burrow / switchback',
  sprint: 'Beltway · momentum / inside drop',
  peggle: 'Peg Bank · express gap / scoring pocket',
  lift: 'Sky Ferry · lift / catch road',
  crane: 'Crane Yard · ghost cut / outside bend',
};

/** Every chapter receives marbles at the left edge and returns them there.
 * Two overlapping banked roads catch misses; the next chapter catches the exit.
 * Mirroring the entire course preserves that contract, unlike randomly flipping sections.
 */
export function buildCourse(b: Builder, seed: number, profile: TrackProfile, start: number): SegmentInfo[] {
  const segments: SegmentInfo[] = [];
  b.flip = false;
  // Fair opening: all ten grid columns meet the same open collector, before any rewards.
  b.ramp(0, start + 20, 340, start + 160);
  b.ramp(900, start + 20, 560, start + 160);
  segments.push({ name: 'Choose your line', y: start, h: 260 });
  let y = start + 260;
  for (const chapter of planCourse(seed, profile)) {
    b.flip = chapter.mirror;
    const v = chapter.variant;
    const tip = 730 + v * 20;
    const end = 130 + v * 15;
    const firstY = (x: number) => y + 50 + x * 200 / tip;
    const secondY = (x: number) => y + 420 + (900 - x) * 240 / (900 - end);
    const height = chapter.feature === 'peggle' ? 900 : 820;
    const lower = chapter.feature === 'peggle' ? 80 : 0;

    // The return road is a real safety net, never a reset sensor or a distant flat platform.
    b.ramp(900, y + 420 + lower, end, y + 660 + lower);
    b.itemBox(305, secondY(305) + lower - 35);

    if (chapter.feature === 'mass') {
      b.ramp(0, y + 50, 350, y + 155);
      b.trapdoor(430, y + 155, 160, -1, 'weight', 1100, 2200, 0, 1.5, 50);
      b.ramp(510, y + 155, tip, y + 250);
      b.ppeg(250, y + 94, 'green', 10, 'anvil');
      // The opening cuts the long outer turnaround; regular kits can carry momentum over it.
      b.ppeg(440, y + 300, 'orange', 10);
      b.boostOnRamp(510, y + 155, tip, y + 250, 0.55, 80);
    } else if (chapter.feature === 'rebound') {
      b.ramp(0, y + 50, 330, y + 155);
      b.trampoline(440, y + 245, 180, 1.05 + v * 0.12);
      // Upper receiving shelf is above the lip: a rebound, not a decorative spring.
      b.ramp(555, y + 95, 735, y + 130);
      b.tunnel(685, y + 98, 110, y + 745, -0.2, 1, 1000, 5);
      b.ramp(525, y - 45, 790, y + 20);
      b.ppeg(245, y + 92, 'green', 10, 'jump');
      b.ppeg(460, y + 155, 'orange', 10);
      b.ppeg(540, y + 205, 'orange', 10);
    } else if (chapter.feature === 'burrow') {
      b.ramp(0, y + 50, tip, y + 250);
      b.ppeg(290, firstY(290) - 30, 'green', 10, 'jump');
      b.ramp(590, y + 85, 745, y + 115);
      b.ramp(550, y - 50, 790, y + 15); // roof excludes accidental entrance from the chapter above
      b.tunnel(695, y + 78, 110, y + 745, -0.2, 1, 1100, 5);
      b.boostOnRamp(0, y + 50, tip, y + 250, 0.57, 90);
      b.ppeg(490, firstY(490) - 32, 'orange', 10); // marks the jump timing window
    } else if (chapter.feature === 'lift') {
      b.ramp(0, y + 50, 345, y + 150);
      b.platform(425, y + 225, 635, y + 120, 130, 1800, 650, v * 500);
      b.ramp(685, y + 150, 810, y + 180);
      b.tunnel(760, y + 143, 110, y + 745, -0.2, 1, 900, 5);
      b.ramp(630, y - 20, 825, y + 30);
      b.ppeg(245, y + 91, 'green', 10, 'jump');
      b.ppeg(520, y + 250, 'orange', 10);
    } else if (chapter.feature === 'sprint') {
      // An open belt gap offers a deliberate inside drop; momentum carries the upper road.
      b.conveyor(0, y + 50, 345, y + 145, 0.22 + v * 0.04, undefined, 0);
      b.conveyor(485, y + 175, tip, y + 250, 0.28, undefined, 0);
      b.ppeg(235, y + 84, 'green', 10, 'aero');
      b.ppeg(425, y + 300, 'orange', 10);
      b.mud(600, secondY(600) - 13, 440, secondY(440) - 13, 0.12);
      b.ppeg(690, secondY(690) - 35, 'green', 10, 'jump');
    } else if (chapter.feature === 'peggle') {
      b.ramp(0, y + 50, 345, y + 145);
      b.ramp(540, y + 195, tip, y + 250);
      b.boostOnRamp(0, y + 50, 345, y + 145, 0.65, 100);
      // A small, intentional scoring pocket under the racing gap. No field across every lane.
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          b.ppeg(350 + col * 105 + (row % 2) * 28, y + 255 + row * 65,
            (row + col) % 2 ? 'orange' : 'blue', 9);
        }
      }
      b.ppeg(240, y + 86, 'green', 10, 'rocket');
    } else {
      b.ramp(0, y + 50, 350, y + 155);
      // A breakable floor covers the inner drop. Ghost can choose it without opening it for rivals.
      b.barricade(430, y + 160, 160, 25, 2 + v);
      b.ramp(510, y + 165, tip, y + 250);
      b.ppeg(250, y + 94, 'green', 10, 'ghost');
      // The mace only brushes the outer turnaround; the inside drop avoids it completely.
      b.mace(840, y + 270, 120, 0.42, 1600, 450, v * 700, 23);
      b.ppeg(615, firstY(615) - 30, 'green', 10, 'shock');
    }
    // Supply before the next decision; reward on the main road is forfeited by upper shortcuts.
    b.ppeg(520, secondY(520) + lower - 32, 'orange', 10);
    segments.push({ name: NAMES[chapter.feature], y, h: height });
    y += height;
  }
  // One final open race to the line. No random peg, machine or item on the finish approach.
  b.flip = (seed & 1) === 1;
  b.ramp(0, y + 40, 740, y + 240);
  segments.push({ name: 'Home straight', y, h: 440 });
  b.flip = false;
  return segments;
}
