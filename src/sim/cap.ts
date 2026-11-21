// League salary rules by era: the 1984 soft cap with Bird rights, the 1995 rookie scale, the 1999 maximum contracts and
// mid-level exception, the luxury tax first assessed in 2002-03, the 2011 taxpayer exceptions and apron, and the 2023
// first and second aprons. Every team, AI or user, signs and trades through these checks.
import type { Player, Team, World } from './types';
import { capFor } from './history';
import { clamp } from './rng';
import { salaryAt, birdLevel, birdLimit, maxFor, extensionCheck, stretchTerms, twoWaySalary, BIRD_LABEL } from './contracts';
import { rules, hasRosterSpot, twoWayEligible } from './rules';

export interface DeadMoney { pid: string; name: string; salary: number; years: number; from?: number }
type TeamFin = Team & { dead?: DeadMoney[]; mleUsed?: number; taxPaid?: Record<string, number> };
const fin = (t: Team) => t as TeamFin;

const TAX_LINE: Record<number, number> = {
  2002: 52.9e6, 2003: 54.63e6, 2004: 54.63e6, 2005: 61.7e6, 2006: 65.42e6, 2007: 67.865e6, 2008: 71.15e6, 2009: 69.92e6, 2010: 70.307e6, 2011: 70.307e6,
  2012: 70.307e6, 2013: 71.748e6, 2014: 76.829e6, 2015: 84.74e6, 2016: 113.287e6, 2017: 119.266e6, 2018: 123.733e6, 2019: 132.627e6, 2020: 132.627e6,
  2021: 136.606e6, 2022: 150.267e6, 2023: 165.294e6, 2024: 170.814e6, 2025: 187.895e6,
};
const APRONS: Record<number, [number, number]> = { 2023: [172.346e6, 182.794e6], 2024: [178.132e6, 188.931e6], 2025: [195.945e6, 207.824e6] };

export interface CapRules {
  season: number; cap: number; hasCap: boolean; tax: number | null; apron1: number | null; apron2: number | null;
  hasMax: boolean; rookieScale: boolean; mle: number | null; tpMle: number | null; roomExc: number | null; smallExc: number | null;
  maxYearsOwn: number; maxYearsOther: number; matchPad: number; label: string;
}

/** The season whose cap a transaction counts against: the summer belongs to the next season. */
export function capSeason(w: World): number {
  const ph = w.season.phase;
  return ph === 'draft' || ph === 'freeagency' ? w.season.year + 1 : w.season.year;
}

export function capRules(season: number): CapRules {
  const cap = capFor(season);
  const hasCap = season >= 1984;
  const tax = season >= 2002 ? (TAX_LINE[season] ?? Math.round(cap * 1.215)) : null;
  const ap = APRONS[season] ?? (season > 2025 ? [cap * 1.18, cap * 1.252] as [number, number] : null);
  const apron1 = season >= 2023 ? ap![0] : season >= 2011 ? tax! + Math.round(cap * 0.07) : null;
  const apron2 = season >= 2023 ? ap![1] : null;
  return {
    season, cap, hasCap, tax, apron1, apron2,
    hasMax: season >= 1998, rookieScale: season >= 1995,
    mle: season >= 1999 ? Math.round(cap * (season >= 2011 ? 0.091 : 0.1) / 1000) * 1000 : null,
    tpMle: season >= 2011 ? Math.round(cap * 0.037 / 1000) * 1000 : null,
    roomExc: season >= 2011 ? Math.round(cap * 0.056 / 1000) * 1000 : null,
    smallExc: season >= 1993 && season < 1999 ? 1e6 : null,
    maxYearsOwn: season >= 2011 ? 5 : season >= 2005 ? 6 : season >= 1999 ? 7 : 7,
    maxYearsOther: season >= 2011 ? 4 : season >= 2005 ? 5 : season >= 1999 ? 6 : 7,
    matchPad: hasCap ? Math.round(cap * (season >= 2023 ? 0.0018 : 0.003) / 1000) * 1000 : 0,
    label: !hasCap ? 'No salary cap (owners set budgets)' : season < 1999 ? 'Soft cap with Bird rights' : season < 2002 ? 'Soft cap, max contracts, mid-level exception'
      : season < 2011 ? 'Soft cap and luxury tax' : season < 2023 ? 'Soft cap, luxury tax and apron' : 'Soft cap, luxury tax and two aprons',
  };
}

/** Seasons of NBA service (each season he logged games). */
export function yos(p: Player): number { return new Set((p.stats ?? []).filter(s => !s.playoffs && s.g > 0).map(s => s.season)).size; }

/** Maximum first-year salary (1998-99 on): 25% of the cap for 0-6 years of service, 30% for 7-9, 35% for 10+, or 105% of his last salary. */
export function maxSalary(season: number, years: number, prevSalary = 0): number | null {
  const R = capRules(season);
  if (!R.hasMax) return null;
  const pct = years >= 10 ? 0.35 : years >= 7 ? 0.3 : 0.25;
  const fixed = season === 1998 ? (years >= 10 ? 14e6 : years >= 7 ? 11e6 : 9e6) : 0;
  return Math.round(Math.max(fixed || R.cap * pct, prevSalary * 1.05) / 1000) * 1000;
}
/** League minimum by service time (scaled to the cap; a rookie gets the least, a ten-year veteran about 2.3% of the cap). */
export function minSalary(season: number, years: number): number {
  const cap = capFor(season);
  return Math.round(cap * (0.0085 + 0.0014 * Math.min(10, years)) / 1000) * 1000;
}
/** First-round rookie scale (1995 on): a fixed slot salary and four seasons. Earlier rookies and second-rounders negotiate. */
export function rookieScale(season: number, pick: number, round: number): { salary: number; years: number } | null {
  if (!capRules(season).rookieScale) return null;
  const cap = capFor(season);
  if (round !== 1) return { salary: minSalary(season, 0), years: 2 };
  return { salary: Math.round(cap * (0.016 + 0.068 * Math.exp(-(pick - 1) / 7)) / 1000) * 1000, years: 4 };
}

/** Salary on a team's books `ahead` seasons from the cap season (0 = this one), dead money included; two-way deals do not count. */
export function teamPayroll(w: World, tid: string, ahead = 0): number {
  const t = w.teams[tid];
  let s = 0;
  for (const id of t.roster) { const c = w.players[id]?.contract; if (c && !c.twoWay && c.years > ahead) s += salaryAt(c, ahead); }
  for (const d of fin(t).dead ?? []) if (d.years > ahead && ((d as any).from ?? 0) <= ahead) s += d.salary;
  return s;
}
/** Our own unsigned free agents (Bird rights still held) carry a cap hold until they sign or are renounced. */
export function holdPlayers(w: World, tid: string): Player[] {
  const out: Player[] = [];
  for (const id of w.freeAgents) { const p = w.players[id]; if (p && (p as any).bird === tid && !p.retired && (p as any).renounced !== tid) out.push(p); }
  for (const id of w.teams[tid].roster) { const p = w.players[id]; if (p && (!p.contract || p.contract.years <= 0)) out.push(p); }
  return out;
}
export const capHold = (w: World, p: Player) => Math.round(((p as any).prevSalary ?? p.contract?.salary ?? minSalary(capSeason(w), yos(p))) * ((p as any).rfa ? 1.25 : 1.3) / 1000) * 1000;
export function capHolds(w: World, tid: string): number {
  if (!capRules(capSeason(w)).hasCap || w.season.phase !== 'freeagency' && w.season.phase !== 'draft') return 0;
  return holdPlayers(w, tid).reduce((s, p) => s + capHold(w, p), 0);
}
export function capRoom(w: World, tid: string): number {
  const R = capRules(capSeason(w));
  return Math.max(0, R.cap - teamPayroll(w, tid) - capHolds(w, tid));
}

/** Luxury tax owed on a payroll: dollar for dollar until 2013, then rising brackets (and higher still for repeat payers). */
export function taxBill(season: number, payroll: number, repeater = false): number {
  const R = capRules(season);
  if (!R.tax || payroll <= R.tax) return 0;
  const over = payroll - R.tax;
  if (season < 2013) return over;
  const step = 5e6 * Math.max(1, R.cap / 99e6);
  let bill = 0, left = over, rate = repeater && season >= 2014 ? 2.5 : 1.5, i = 0;
  while (left > 0) { const chunk = Math.min(step, left); bill += chunk * rate; left -= chunk; i++; rate += i === 1 ? 0.25 : i === 2 ? 0.75 : i === 3 ? 0.75 : 0.5; }
  return Math.round(bill);
}
export function isRepeater(w: World, tid: string, season: number): boolean {
  const paid = fin(w.teams[tid]).taxPaid ?? {};
  return [1, 2, 3, 4].filter(k => (paid[season - k] ?? 0) > 0).length >= 3;
}

export type SignVia = 'room' | 'bird' | 'rookie' | 'mle' | 'tpmle' | 'roomexc' | 'exception' | 'min' | 'budget' | 'extension' | 'twoway';
export interface SignCheck { ok: boolean; via?: SignVia; reason?: string; most?: number; note?: string }
export interface SignOpts { twoWay?: boolean; earmark?: number; skipRoster?: boolean }

/** Can `tid` sign `p` at this salary and length under this season's rules (and, before the cap, the owner's budget)? */
export function signingCheck(w: World, tid: string, p: Player, salary: number, years: number, o: SignOpts = {}): SignCheck {
  const season = capSeason(w);
  const R = capRules(season);
  const t = w.teams[tid];
  const y = yos(p);
  // two-way contracts sit outside the cap and the 15
  if (o.twoWay) {
    if (!twoWayEligible(w, p, y)) return { ok: false, reason: rules(w).twoWay ? 'Two-way contracts are for players with four or fewer seasons of service.' : 'Two-way contracts begin in 2017-18.' };
    if (p.team !== tid && !o.skipRoster && !hasRosterSpot(w, tid, true)) return { ok: false, reason: `All ${rules(w).twoWay} two-way slots are taken.` };
    if (years > 2) return { ok: false, reason: 'Two-way contracts run one or two seasons.' };
    return { ok: true, via: 'twoway', most: twoWaySalary(season) };
  }
  // extending a player already under contract with us
  if (p.team === tid && p.contract && p.contract.years > 0 && !p.contract.twoWay) {
    const e = extensionCheck(w, p, tid, salary, years);
    return e.ok ? { ok: true, via: 'extension' } : { ok: false, reason: e.reason, most: e.most };
  }
  const own = (p as any).bird === tid || p.team === tid;
  const mx = maxFor(p, tid, season);
  const mn = minSalary(season, y);
  if (mx && salary > mx) return { ok: false, reason: `The maximum he can be paid is ${fmtM(mx)}.`, most: mx };
  if (salary < mn) return { ok: false, reason: `The league minimum for a player with ${y} season${y === 1 ? '' : 's'} is ${fmtM(mn)}.`, most: mn };
  const maxYears = own ? R.maxYearsOwn : R.maxYearsOther;
  if (years > maxYears) return { ok: false, reason: `Contracts can run at most ${maxYears} seasons${own ? '' : ' with a new team'}.` };
  if (p.team !== tid && !o.skipRoster && !hasRosterSpot(w, tid)) return { ok: false, reason: `Roster is full (${rules(w).label}).` };
  const isMin = salary <= mn * 1.001 && years <= 2;
  const rights = p.rosterStatus?.startsWith('Draft rights held by') && p.draftedBy === tid;
  const payNow = teamPayroll(w, tid) - (p.team === tid && p.contract && p.contract.years > 0 ? p.contract.salary : 0) + (o.earmark ?? 0);
  if (rights && R.hasCap) return { ok: true, via: 'rookie' };
  if (!R.hasCap) {
    const budget = tid === w.meta.userTeam ? w.owner.budget : t.payrollBudget ?? Infinity;
    if (isMin || own || payNow + salary <= budget * 1.001) return { ok: true, via: own ? 'bird' : 'budget' };
    return { ok: false, reason: `There is no salary cap yet, but the owner caps payroll at ${fmtM(budget)}. This deal would take it to ${fmtM(payNow + salary)}.`, most: Math.max(mn, budget - payNow) };
  }
  // our own free agent's hold is replaced by his salary, so it does not count against the room for him
  const holds = capHolds(w, tid) - (own && (p as any).bird === tid ? capHold(w, p) : 0);
  const room = Math.max(0, R.cap - payNow - holds);
  const level = own ? birdLevel(p, tid, season) : null;
  if (level) {
    const lim = birdLimit(w, p, level, season);
    if (lim == null || salary <= lim) return { ok: true, via: 'bird', note: BIRD_LABEL[level] };
    if (salary <= room) return { ok: true, via: 'room' };
    return { ok: false, reason: `${BIRD_LABEL[level]} (${level === 'early' ? 'two seasons with us' : 'one season with us'}) allow at most ${fmtM(lim)} over the cap.`, most: Math.max(lim, room) };
  }
  if (salary <= room) return { ok: true, via: 'room' };
  if (isMin) return { ok: true, via: 'min' };
  const after = payNow + salary;
  const used = fin(t).mleUsed === season;
  if (R.mle && !used && salary <= R.mle && years <= 4 && (!R.apron1 || after <= R.apron1)) return { ok: true, via: 'mle' };
  if (R.tpMle && !used && salary <= R.tpMle && years <= 3 && (!R.apron2 || after <= R.apron2)) return { ok: true, via: 'tpmle' };
  if (R.roomExc && !used && payNow <= R.cap && salary <= R.roomExc && years <= 2) return { ok: true, via: 'roomexc' };
  if (R.smallExc && !used && salary <= R.smallExc) return { ok: true, via: 'exception' };
  const best = Math.max(room, mn, !used ? Math.max(R.mle && (!R.apron1 || payNow + R.mle <= R.apron1) ? R.mle : 0, R.tpMle && (!R.apron2 || payNow + R.tpMle <= R.apron2) ? R.tpMle : 0, R.smallExc ?? 0) : 0);
  const exc = R.mle ? (used ? ' The mid-level exception is already used this season.' : ` The most an exception allows is ${fmtM(best)}.`) : R.smallExc ? (used ? ' The $1m exception is used.' : '') : '';
  return { ok: false, reason: `Over the cap: ${room > 0 ? `only ${fmtM(room)} of room` : 'no cap room'}. You can offer the minimum (${fmtM(mn)}).${exc}`, most: best };
}
/** Record what a signing used (one mid-level-type exception per team per season). */
export function noteSigning(w: World, tid: string, via: SignVia | undefined) {
  if (via === 'mle' || via === 'tpmle' || via === 'roomexc' || via === 'exception') fin(w.teams[tid]).mleUsed = capSeason(w);
}
/** The most a team could offer this player right now (for AI pricing and the Front Office). */
export function bestOffer(w: World, tid: string, p: Player, years = 2): number {
  const want = Math.max(minSalary(capSeason(w), yos(p)), p.ask ?? 0);
  const c = signingCheck(w, tid, p, want, years);
  return c.ok ? want : Math.max(0, c.most ?? 0);
}

/** Salary matching for trades in the cap era: a team over the cap after the deal may take back 125% (+ a small pad) of what it sends; 110% over the first apron and 100% over the second (2023 on). */
export function tradeSalaryCheck(w: World, tid: string, outSal: number, inSal: number): string | null {
  const R = capRules(capSeason(w));
  if (!R.hasCap || inSal <= outSal) return null;
  const after = teamPayroll(w, tid) + capHolds(w, tid) - outSal + inSal; // summer cap holds count as team salary
  if (after <= R.cap) return null;
  const t = w.teams[tid];
  if (R.apron2 && after > R.apron2) return `${t.name}: over the second apron after this deal, they cannot take back more salary than they send.`;
  const pct = R.apron1 && R.season >= 2023 && after > R.apron1 ? 1.1 : 1.25;
  const limit = outSal * pct + (pct === 1.25 ? R.matchPad : 0);
  if (inSal > limit) return `${t.name}: salaries do not match. Over the cap they can take back at most ${fmtM(limit)} for the ${fmtM(outSal)} they send.`;
  return null;
}

/** Waived contracts stay on the books for the seasons left. */
export function addDeadMoney(w: World, tid: string, p: Player, stretch = false) {
  const c = p.contract;
  if (!c || c.years <= 0 || c.twoWay) return;
  const dead = (fin(w.teams[tid]).dead ??= []);
  if (stretch) { const st = stretchTerms(c); dead.push({ pid: p.id, name: `${p.name} (stretched)`, salary: st.salary, years: st.years }); return; }
  // each remaining season stays on the books at its own salary
  for (let k = 0; k < c.years; k++) dead.push({ pid: p.id, name: p.name, salary: salaryAt(c, k), years: k + 1, from: k } as any);
}
/** Offseason roll: dead money runs down a season. */
export function rollDeadMoney(w: World) {
  for (const t of Object.values(w.teams)) { const f = fin(t); if (f.dead) f.dead = f.dead.map(d => ({ ...d, years: d.years - 1, from: Math.max(0, ((d as any).from ?? 0) - 1) })).filter(d => d.years > 0); }
}
export const deadMoney = (t: Team) => fin(t).dead ?? [];
export const taxHistory = (t: Team) => fin(t).taxPaid ?? {};

/** Assess the luxury tax on every team's end-of-season payroll. Returns the bills. */
export function assessLuxuryTax(w: World, season: number): Record<string, number> {
  const out: Record<string, number> = {};
  const R = capRules(season);
  if (!R.tax) return out;
  for (const t of Object.values(w.teams)) {
    const bill = taxBill(season, teamPayroll(w, t.id), isRepeater(w, t.id, season));
    (fin(t).taxPaid ??= {})[season] = bill;
    if (bill > 0) out[t.id] = bill;
  }
  return out;
}

/** What AI front offices treat as their spending line for a season: under the tax unless they are chasing a title. */
export function aiSpendLine(w: World, t: Team): number {
  const R = capRules(capSeason(w));
  if (!R.hasCap) return t.payrollBudget ?? R.cap * 1.15;
  const chase = t.clock === 'Win Now' || t.clock === 'Contending';
  // contenders live around the tax line (a real star can push them toward the apron); everyone else stays under it
  if (R.tax) return chase ? Math.min(R.apron1 ?? R.tax * 1.06, R.tax * 1.03) : R.tax * 0.95;
  return R.cap * (chase ? 1.3 : 1.12);
}

/** Market value of a player as a share of the cap, held between the minimum and his maximum. */
export function marketValue(season: number, value: number, age: number, years: number): number {
  const cap = capFor(season);
  let frac = 0.012 + 0.40 / (1 + Math.exp(-(value - 74) / 5.5));
  if (age >= 33) frac *= 0.7; else if (age >= 31) frac *= 0.85; else if (age <= 22) frac *= 0.9;
  let s = cap * frac;
  const mx = maxSalary(season, years);
  if (mx) s = Math.min(s, mx);
  s = Math.max(s, minSalary(season, years));
  const step = s >= 5e6 ? 50000 : s >= 1e6 ? 25000 : 5000;
  return Math.round(s / step) * step;
}

export const fmtM = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(2)}m` : `$${Math.round(n / 1000)}k`;
export const clampSal = (n: number) => clamp(n, 0, 1e10);
