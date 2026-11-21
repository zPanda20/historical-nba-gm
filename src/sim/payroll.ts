// AI franchise cycles and payroll discipline.
// Every AI team re-reads where it is each spring and fall (rebuilding, building, contending, win now) from its projected
// strength, its record and how old its best players are. Its owner's spending line follows that read and its market
// (cap.aiSpendLine). A team far over its line moves an overpaid contract into another team's cap space, paying a pick to
// do it — the salary dump that keeps the real league from sitting at the tax line all at once.
import type { ClockState, Player, World } from './types';
import { playerValue } from './coach';
import { projectedWins } from './world';
import { aiSpendLine, capRoom, capRules, capSeason, marketValue, minSalary, teamPayroll, yos } from './cap';
import { canStretch } from './contracts';
import { releasePlayer } from './gm';
import { addEvent } from './world';
import { rosterCount, rules } from './rules';
import { executeTradeBetween } from './trade';
import { eraRules } from './history';

/** Re-read each AI team's cycle. `record` blends in the season just played (used at season's end). */
export function updateAiClocks(w: World, record = false) {
  const proj = projectedWins(w);
  const G = eraRules(w.season.year).games;
  for (const t of Object.values(w.teams)) {
    if (t.id === w.meta.userTeam) continue;
    let p = (proj[t.id] ?? G / 2) / G;
    if (record && t.w + t.l > 0) p = 0.5 * p + 0.5 * (t.w / (t.w + t.l));
    const core = t.roster.map(id => w.players[id]).filter(Boolean).sort((a, b) => playerValue(b) - playerValue(a)).slice(0, 3);
    const oldCore = core.length >= 2 && core.reduce((s, x) => s + (x.age ?? 27), 0) / core.length >= 30.5;
    const prev = t.clock;
    // hysteresis: a team needs a clear reason to change course
    const up = (c: ClockState) => (prev === c ? 0.02 : 0);
    const c: ClockState = p >= 0.63 - up('Win Now') || (oldCore && p >= 0.58) ? 'Win Now'
      : p >= 0.56 - up('Contending') ? 'Contending'
      : p >= 0.43 - up('Building') && !(oldCore && p < 0.47) ? 'Building'
      : 'Rebuilding';
    t.clock = c;
  }
}

/** Offseason: AI teams well over their owner's line move an overpaid contract into cap space, with a pick attached. */
export function aiSalaryDumps(w: World, deadline = false): string[] {
  const season = capSeason(w), R = capRules(season);
  if (!R.hasCap) return [];
  const out: string[] = [];
  const u = w.meta.userTeam;
  const teams = Object.values(w.teams).filter(t => t.id !== u);
  for (const A of teams) {
    const line = aiSpendLine(w, A);
    // at the deadline a team that isn't chasing a title — or is only just over — ducks under the tax
    const pay0 = teamPayroll(w, A.id);
    const limit = deadline ? (R.tax && (A.clock === 'Rebuilding' || A.clock === 'Building' || pay0 <= R.tax * 1.04) ? R.tax * 0.998 : Infinity)
      : Math.min(line * 1.08, A.clock === 'Win Now' ? (R.apron2 ?? Infinity) * 1.02 : R.apron2 ?? Infinity);
    for (let k = 0; k < 2 && teamPayroll(w, A.id) > limit; k++) {
      const ranked = A.roster.map(id => w.players[id]).filter(p => p && !p.contract?.twoWay && (p.contract?.years ?? 0) > 0).sort((a, b) => playerValue(b) - playerValue(a));
      const over = (p: Player) => (p.contract!.salary - 0.8 * marketValue(season, playerValue(p), p.age ?? 27, p.contract!.years)) / R.cap;
      const gap = teamPayroll(w, A.id) - limit;
      // at the deadline: the cheapest contract that gets them under; in the summer: the worst value for money
      const pool = ranked.slice(3).filter(p => p.contract!.salary >= R.cap * 0.02);
      const pick = deadline ? pool.filter(p => p.contract!.salary >= gap).sort((a, b) => a.contract!.salary - b.contract!.salary)[0] ?? pool.sort((a, b) => b.contract!.salary - a.contract!.salary)[0]
        : pool.filter(p => p.contract!.salary >= R.cap * 0.04).sort((a, b) => over(b) - over(a))[0];
      if (!pick) break;
      const sal = pick.contract!.salary;
      // into cap room, or for a smaller contract into a trade exception a rebuilding club holds
      const absorb = (t: typeof A) => capRoom(w, t.id) >= sal || (sal <= R.cap * 0.09 && teamPayroll(w, t.id) + sal <= aiSpendLine(w, t) * 0.98);
      const B = teams.filter(t => t !== A && (t.clock === 'Rebuilding' || t.clock === 'Building') && rosterCount(w, t.id) < rules(w).max && absorb(t))
        .sort((a, b) => capRoom(w, b.id) - capRoom(w, a.id) || teamPayroll(w, a.id) - teamPayroll(w, b.id))[0];
      if (!B) break;
      const sweet = A.picks.filter(x => x.season > w.season.year && x.round === (over(pick) > 0.08 ? 1 : 2)).sort((a, b) => b.season - a.season)[0];
      const desc = executeTradeBetween(w, A.id, B.id, [pick.id], [], sweet ? [{ season: sweet.season, round: sweet.round, original: sweet.original }] : [], []);
      out.push(desc);
    }
  }
  return out;
}

/** Offseason, after dumps: a team still far over its owner's line trims. 2011–2015: the one-time amnesty of a contract
 *  signed before the 2011 CBA (off the books entirely). From 2011 on, otherwise: waive and stretch an overpaid deal. */
export function aiPayrollTrim(w: World): string[] {
  const season = capSeason(w), R = capRules(season);
  if (!R.hasCap || season < 2011) return [];
  const out: string[] = [];
  for (const t of Object.values(w.teams)) {
    if (t.id === w.meta.userTeam) continue;
    const line = aiSpendLine(w, t);
    const limit = t.clock === 'Win Now' ? Math.max(line, R.apron2 ?? R.tax! * 1.12) : Math.min(line * 1.1, R.apron2 ?? Infinity);
    if (teamPayroll(w, t.id) <= limit) continue;
    const ranked = t.roster.map(id => w.players[id]).filter(p => p && !p.contract?.twoWay && (p.contract?.years ?? 0) > 0).sort((a, b) => playerValue(b) - playerValue(a));
    const over = (p: Player) => p.contract!.salary - marketValue(season, playerValue(p), p.age ?? 27, p.contract!.years);
    const cands = ranked.slice(3).filter(p => p.contract!.salary >= R.cap * 0.05 && over(p) > R.cap * 0.02).sort((a, b) => over(b) - over(a));
    const used = (t as any).amnestyUsed;
    const amn = season <= 2015 && !used ? cands.find(p => !p.contract!.signed || p.contract!.signed < '2011-07-01') : undefined;
    if (amn) {
      (t as any).amnestyUsed = season;
      t.roster = t.roster.filter(x => x !== amn.id);
      amn.team = null; amn.contract = null; amn.rosterStatus = `Amnestied by ${t.abbr}`; delete (amn as any).bird;
      amn.ask = Math.max(minSalary(season, yos(amn)), Math.round(marketValue(season, playerValue(amn), amn.age ?? 27, 1) * 0.8 / 5000) * 5000);
      if (!w.freeAgents.includes(amn.id)) w.freeAgents.push(amn.id);
      addEvent(w, 'release', `${t.abbr} used the amnesty provision on ${amn.name}`, [amn.id]);
      out.push(`The ${t.name} used the amnesty provision on ${amn.name}`);
      continue;
    }
    const st = cands[0];
    if (st && canStretch(season)) { releasePlayer(w, st.id, true); out.push(`The ${t.name} waived and stretched ${st.name}`); }
  }
  return out;
}
