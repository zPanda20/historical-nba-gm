// Contract structure by era: yearly salaries with the CBA's raise limits, player and team options, rookie-scale team
// options, Bird rights by tenure (full, early, non-Bird), extension windows and raises, the designated-veteran supermax
// (2017) and Rose rule (2011), and the stretch provision for waived contracts (2011).
import type { Contract, ContractOption, Player, World } from './types';
import { capFor } from './history';
import { capRules, capSeason, maxSalary, minSalary, yos, fmtM } from './cap';

export const salaryAt = (c: Contract | null | undefined, k = 0): number => (!c ? 0 : c.sched?.[k] ?? c.salary);
export const contractTotal = (c: Contract | null | undefined): number => (!c ? 0 : Array.from({ length: Math.max(0, c.years) }, (_, k) => salaryAt(c, k)).reduce((a, b) => a + b, 0));

/** Largest annual raise, as a share of the first-year salary. No limit existed before 1999 (we cap at 30% for sanity). */
export function maxRaise(season: number, bird: boolean): number {
  if (season >= 2017) return bird ? 0.08 : 0.05;
  if (season >= 2011) return bird ? 0.075 : 0.045;
  if (season >= 2005) return bird ? 0.105 : 0.08;
  if (season >= 1999) return bird ? 0.125 : 0.10;
  return 0.3;
}

export interface ContractTerms { raise?: number; opts?: ContractOption[]; rookie?: boolean; scale?: boolean; twoWay?: boolean; provenance?: string; signed?: string; fresh?: boolean }
export function makeContract(first: number, years: number, t: ContractTerms = {}): Contract {
  const sched = Array.from({ length: years }, (_, k) => Math.round(first * (1 + (t.raise ?? 0) * k) / 1000) * 1000);
  const c: Contract = { salary: sched[0], years, sched, known: null, provenance: t.provenance ?? 'Signed in this save (simulated)', signed: t.signed };
  const opts = (t.opts ?? []).filter(o => o.idx > 0 && o.idx < years);
  if (opts.length) c.opts = opts;
  if (t.rookie) c.rookie = true;
  if (t.scale) c.scale = true;
  if (t.twoWay) c.twoWay = true;
  if (t.fresh) c.fresh = true;
  return c;
}
/** One season passes: the first year drops off, options move a year closer. */
export function rollContract(c: Contract) {
  c.years--;
  if (c.sched) c.sched.shift();
  c.salary = c.sched?.[0] ?? c.salary;
  if (c.opts) { c.opts = c.opts.map(o => ({ ...o, idx: o.idx - 1 })).filter(o => o.idx >= 0); if (!c.opts.length) delete c.opts; }
}
/** Add seasons to a running contract (an extension): new years start at `first` and rise from there. */
export function extendContract(c: Contract, first: number, newYears: number, raise: number, signed: string): Contract {
  const cur = Array.from({ length: Math.max(0, c.years) }, (_, k) => salaryAt(c, k));
  const add = Array.from({ length: newYears }, (_, k) => Math.round(first * (1 + raise * k) / 1000) * 1000);
  const sched = [...cur, ...add];
  return { ...c, sched, salary: sched[0], years: sched.length, signed, provenance: 'Extended in this save (simulated)', rookie: c.years > 0 ? c.rookie : false };
}
export const optionNow = (c: Contract | null | undefined) => c?.opts?.find(o => o.idx === 0);

// ------------------------------------------------------------------ Bird rights
export const birdYears = (p: Player): number => (p as any).birdYears ?? 0;
export type BirdLevel = 'full' | 'early' | 'non';
/** Re-signing rights a team holds on its own player: full Bird after three seasons, Early Bird after two and
 *  Non-Bird after one (both from 1999). Before 1999 only full Bird rights let a team go over the cap. */
export function birdLevel(p: Player, tid: string, season: number): BirdLevel | null {
  if ((p as any).bird !== tid && p.team !== tid) return null;
  if (!capRules(season).hasCap) return 'full';
  const y = birdYears(p);
  if (y >= 3) return 'full';
  if (season >= 1999) return y >= 2 ? 'early' : 'non';
  return null;
}
export const BIRD_LABEL: Record<BirdLevel, string> = { full: 'Bird rights', early: 'Early Bird rights', non: 'Non-Bird rights' };

export function leagueAverageSalary(w: World): number {
  const s = Object.values(w.players).filter(p => p.team && p.contract && !p.contract.twoWay).map(p => p.contract!.salary);
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : capFor(capSeason(w)) * 0.06;
}
/** Highest first-year salary a Bird level allows over the cap (null = up to the maximum). */
export function birdLimit(w: World, p: Player, level: BirdLevel, season: number): number | null {
  const prev = (p as any).prevSalary ?? p.contract?.salary ?? 0;
  if (level === 'full') return null;
  if (level === 'early') return Math.round(Math.max(prev * 1.75, leagueAverageSalary(w) * 1.05) / 1000) * 1000;
  return Math.round(Math.max(prev * 1.2, minSalary(season, yos(p)) * 1.2) / 1000) * 1000;
}

// ------------------------------------------------------------------ supermax / Rose rule
const won = (p: Player, award: string | RegExp, seasons: number[]) => (p.awards ?? []).some(a => seasons.includes(a.season) && (typeof award === 'string' ? a.award === award : award.test(a.award)));
/** Designated veteran (2017): seven or eight seasons in, re-signing or extending with his team, and MVP in one of the last
 *  three seasons, or All-NBA / Defensive Player of the Year last season or in two of the last three. Max rises to 35%. */
export function supermaxEligible(p: Player, tid: string, season: number): boolean {
  if (season < 2017 || birdLevel(p, tid, season) !== 'full') return false;
  const y = yos(p);
  if (y < 7 || y > 9) return false;
  const last = season - 1, three = [season - 1, season - 2, season - 3];
  if (won(p, 'MVP', three)) return true;
  if (won(p, /^All-NBA|^DPOY$/, [last])) return true;
  return three.filter(s => won(p, /^All-NBA|^DPOY$/, [s])).length >= 2;
}
/** Rose rule (2011): a rookie-scale extension can reach 30% of the cap with an MVP or All-NBA honours. */
export function roseEligible(p: Player, season: number): boolean {
  if (season < 2011 || !p.contract?.scale) return false;
  const seasons = [season - 1, season - 2, season - 3, season - 4];
  return won(p, 'MVP', seasons) || seasons.filter(s => won(p, /^All-NBA/, [s])).length >= 2 || won(p, /^All-NBA/, [season - 1]);
}
/** The maximum for this player with this team, including the supermax and Rose rule where they apply. */
export function maxFor(p: Player, tid: string, season: number): number | null {
  const base = maxSalary(season, yos(p), (p.team === tid || (p as any).bird === tid) ? (p as any).prevSalary ?? p.contract?.salary ?? 0 : 0);
  if (base == null) return null;
  if (supermaxEligible(p, tid, season)) return Math.max(base, Math.round(capFor(season) * 0.35 / 1000) * 1000);
  if (roseEligible(p, season) && p.team === tid) return Math.max(base, Math.round(capFor(season) * 0.3 / 1000) * 1000);
  return base;
}

// ------------------------------------------------------------------ extensions
/** May this player be extended now, and on what terms? Rookie-scale deals in the summer before their last season; veterans
 *  with two seasons or fewer left. From 2011 a veteran's first extended year can rise at most 20% over his salary (40% from 2023). */
export function extensionCheck(w: World, p: Player, tid: string, first: number, newYears: number): { ok: boolean; reason?: string; most?: number } {
  const c = p.contract;
  const season = capSeason(w);
  const R = capRules(season);
  if (!c || p.team !== tid) return { ok: false, reason: 'Only players under contract with us can be extended.' };
  if (c.twoWay) return { ok: true };
  const left = c.years;
  if (c.scale && season >= 1995 && left > 1) return { ok: false, reason: `Rookie-scale deals can only be extended in the summer before their final season (${left} seasons left).` };
  if (!c.scale && left > 2) return { ok: false, reason: `Veterans can be extended once two seasons or fewer remain (${left} left).` };
  if (newYears + left > R.maxYearsOwn + 1) return { ok: false, reason: `Extended deals can run at most ${R.maxYearsOwn} new seasons beyond this one.` };
  const mx = maxFor(p, tid, season + left);
  if (mx && first > mx) return { ok: false, reason: `The most an extension can pay him is ${fmtM(mx)}.`, most: mx };
  if (!c.scale && season >= 2011) {
    const pct = season >= 2023 ? 1.4 : 1.2;
    const lim = Math.round(salaryAt(c, left - 1) * pct / 1000) * 1000;
    if (first > Math.max(lim, minSalary(season, yos(p)))) return { ok: false, reason: `An extension can start at most ${Math.round((pct - 1) * 100)}% above his current salary (${fmtM(lim)}).`, most: lim };
  }
  return { ok: true };
}

// ------------------------------------------------------------------ stretch provision
/** Waive-and-stretch (2011 on): what is left is spread over twice the remaining seasons plus one. */
export function stretchTerms(c: Contract): { salary: number; years: number } {
  const total = contractTotal(c);
  const years = 2 * c.years + 1;
  return { salary: Math.round(total / years / 1000) * 1000, years };
}
export const canStretch = (season: number) => season >= 2011;

/** Two-way salary: about half the rookie minimum (50% of the minimum from 2023). Not counted against the cap. */
export const twoWaySalary = (season: number) => Math.round(minSalary(season, 0) * 0.5 / 1000) * 1000;

/** Qualifying offer that makes a first-round rookie-scale player a restricted free agent (simplified to 125% of his last salary). */
export const qualifyingOffer = (p: Player, season: number) => Math.max(minSalary(season, yos(p)), Math.round(((p as any).prevSalary ?? p.contract?.salary ?? 0) * 1.25 / 1000) * 1000);

/** Older saves: infer seasons with the current team (for Bird rights) from the stat lines, and give contracts a schedule. */
export function migrateContracts(w: World) {
  if ((w as any).contractsVersion === 1) return;
  (w as any).contractsVersion = 1;
  for (const p of Object.values(w.players)) {
    if (p.retired) continue;
    const team = p.team ?? (p as any).bird;
    if (team && (p as any).birdYears == null) {
      const seasons = [...new Set((p.stats ?? []).filter(s => !s.playoffs).map(s => s.season))].sort((a, b) => b - a);
      let n = 0;
      for (const y of seasons) { const lines = (p.stats ?? []).filter(s => s.season === y && !s.playoffs); if (lines.length && lines[lines.length - 1].team === team) n++; else break; }
      (p as any).birdYears = n;
    }
    const c = p.contract;
    if (c && !c.sched && c.years > 0) c.sched = Array(c.years).fill(c.salary);
  }
}
