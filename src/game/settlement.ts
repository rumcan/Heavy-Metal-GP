// P2-07 (#113): the race purse. Placement, pegs, KO bounties, talent bonuses, mode scaling, and the Shaman's fee on a DNF.
export const PRIZES = [500, 350, 275, 220, 180, 150, 120, 100, 80, 60] as const;
export const PEG_CREDITS = 5;
export const KO_BOUNTY = 75;
export type PurseMode = 'championship' | 'story' | 'quick' | 'custom' | 'online' | 'online-custom';
export const MODE_SCALE: Record<PurseMode, number> = { championship: 1, story: 1, quick: 1, custom: 0.3, online: 0.6, 'online-custom': 0.18 };
export interface RaceOutcome { finished: boolean; rank: number; pegs: number; kos: number; dnf: boolean }
export interface PurseTalents { prizePct: number; pegBonusPct: number; koBountyPct: number; shamanFeePct: number }
export function shamanFee(mode: PurseMode, credits: number, feePct = 0) {
  const pct = 1 + feePct / 100;
  const due = mode === 'championship' || mode === 'story' ? Math.round(Math.max(250, credits * 0.3) * pct) : mode === 'quick' ? Math.round(Math.max(50, credits * 0.1) * pct) : 0;
  const fee = Math.min(due, Math.max(0, credits));
  const short = due > credits;
  return { due, fee, short, takeCharges: short && (mode === 'championship' || mode === 'story') ? 2 : 0 };
}
export function settle(o: RaceOutcome, mode: PurseMode, credits: number, t: PurseTalents) {
  const k = MODE_SCALE[mode];
  const lines: { kind: 'placement' | 'pegs' | 'kos' | 'shaman'; amount: number }[] = [];
  const rank = Math.max(1, Math.min(10, Math.floor(o.rank)));
  const add = (kind: 'placement' | 'pegs' | 'kos', base: number, pct: number) => { const a = Math.round(base * (1 + pct / 100) * k); if (a > 0) lines.push({ kind, amount: a }); };
  if (o.finished && !o.dnf) add('placement', PRIZES[rank - 1], t.prizePct);
  add('pegs', Math.max(0, o.pegs) * PEG_CREDITS, t.pegBonusPct);
  add('kos', Math.max(0, o.kos) * KO_BOUNTY, t.koBountyPct);
  const earned = lines.reduce((a, l) => a + l.amount, 0);
  let takeCharges = 0;
  if (o.dnf) {
    const f = shamanFee(mode, credits + earned, t.shamanFeePct);
    if (f.fee > 0) lines.push({ kind: 'shaman', amount: -f.fee });
    takeCharges = f.takeCharges;
  }
  return { lines, total: lines.reduce((a, l) => a + l.amount, 0), takeCharges };
}
