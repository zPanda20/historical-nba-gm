// Delegation: hand parts of the job to your staff. With everything delegated the franchise runs itself.
import type { Player, World } from './types';
import { maxRaise } from './contracts';
import { rules as eraRoster, rosterCount } from './rules';
import { bestOffer, capSeason, maxSalary, minSalary, yos } from './cap';
import { $y } from './history';
import { playerValue } from './coach';
import { addMessage } from './world';
import { executeTrade, fmt$, marketSalary, payroll, playerAccepts, releasePlayer, rightsOk, scoutReport, signPlayer } from './gm';
import { staffRead } from './trade';
import { needMetric, openRequest, scoutTrips, useScoutTrip } from './needs';

export type DelegKey = 'inbox' | 'contracts' | 'freeAgency' | 'trades' | 'coachRequests' | 'scouting' | 'draft' | 'offseason';
export const DELEG: { key: DelegKey; label: string; who: string; desc: string }[] = [
  { key: 'inbox', label: 'Routine mail', who: 'Your secretary', desc: 'Files notes that need no answer: injury updates, check-ins, scouting summaries.' },
  { key: 'contracts', label: 'Extensions & re-signings', who: 'Assistant GM', desc: 'Re-signs players worth keeping at fair terms, lets the rest walk.' },
  { key: 'trades', label: 'Incoming trade offers', who: 'Assistant GM', desc: 'Accepts offers our staff reads as a clear win; turns down the rest.' },
  { key: 'freeAgency', label: 'Roster spots', who: 'Assistant GM', desc: 'Keeps the roster full with the best free agents the budget allows.' },
  { key: 'coachRequests', label: "Coach's requests", who: 'Assistant GM', desc: "Looks for free agents that answer what the coach asked for." },
  { key: 'scouting', label: 'Scouting trips', who: 'Director of scouting', desc: 'Uses every scouting trip on the prospects we know least about.' },
  { key: 'draft', label: 'Draft picks', who: 'Director of scouting', desc: 'Makes our picks straight off our board.' },
  { key: 'offseason', label: 'Offseason & new season', who: 'Assistant GM', desc: 'Fills the roster to the era\'s limit, trims extras and opens the next season.' },
];

export function delegation(w: World): Record<DelegKey, boolean> {
  return ((w as any).delegation ??= Object.fromEntries(DELEG.map(d => [d.key, false]))) as Record<DelegKey, boolean>;
}
export const delegated = (w: World, k: DelegKey) => !!delegation(w)[k];
export const allDelegated = (w: World) => DELEG.every(d => delegated(w, d.key));
export function delegLog(w: World): { date: string; text: string }[] { return ((w as any).delegLog ??= []); }
function log(w: World, who: string, text: string, tell = false) {
  delegLog(w).unshift({ date: w.season.day, text: `${who}: ${text}` });
  if (delegLog(w).length > 120) delegLog(w).length = 120;
  if (tell) addMessage(w, { date: w.season.day, from: who, role: 'GM', subject: text, body: `${text} (Delegated — you can take this back in Staff › Delegation.)`, urgent: 0, tag: 'Staff', actions: [{ label: 'Noted', cmd: 'dismiss' }] });
}

const budgetRoom = (w: World) => w.owner.budget * 1.04 - payroll(w, w.meta.userTeam);
const inSeason = (w: World) => ['preseason', 'regular', 'playoffs'].includes(w.season.phase);

function tryResign(w: World, p: Player): boolean {
  const v = playerValue(p), age = p.age ?? 28;
  const ask = Math.min(p.ask ?? marketSalary(p, capSeason(w)), maxSalary(capSeason(w), yos(p), (p as any).prevSalary ?? p.contract?.salary ?? 0) ?? Infinity);
  const worth = (v >= 50 && age <= 31) || v >= 60;
  if (!worth || ask - (p.contract?.salary ?? 0) > budgetRoom(w) + $y(40000)) return false;
  const yrs = age <= 27 ? 3 : age <= 30 ? 2 : 1;
  for (const sal of [ask, Math.round(ask * 1.08 / 5000) * 5000]) {
    if (playerAccepts(w, p, w.meta.userTeam, sal, yrs).ok && signPlayer(w, p.id, w.meta.userTeam, sal, yrs, { raise: maxRaise(capSeason(w), true) * 0.7 }).ok) return true;
  }
  return false;
}

function bestFreeAgent(w: World, room: number, filter: (p: Player) => boolean = () => true) {
  const u = w.meta.userTeam;
  // only players we can actually fit under this era's rules, at (nearly) what they ask
  const fits = (p: Player) => { const ask = p.ask ?? marketSalary(p, capSeason(w)); const most = bestOffer(w, u, p, 2); return most >= ask * 0.9 || most <= minSalary(capSeason(w), yos(p)) && ask <= minSalary(capSeason(w), yos(p)) * 2.2; };
  return w.freeAgents.map(id => w.players[id]).filter(p => p && !p.retired && rightsOk(p, u) && (p.ask ?? marketSalary(p)) <= Math.max(room, $y(40000)) && fits(p) && filter(p))
    .sort((a, b) => (b.draftedBy === u ? 3 : 0) + playerValue(b) - ((a.draftedBy === u ? 3 : 0) + playerValue(a)))[0];
}

/** Run every delegated duty once. Safe to call every day and at phase changes. */
export function runDelegates(w: World) {
  const u = w.meta.userTeam;
  const t = w.teams[u];
  if (w.meta.fired) return;
  const D = delegation(w);
  // contracts: agents asking about extensions / expiring deals
  if (D.contracts) for (const m of w.messages.filter(m => !m.resolved && m.actions?.some(a => a.cmd === 'extend'))) {
    const pid = m.actions!.find(a => a.cmd === 'extend')!.arg.pid;
    const p = w.players[pid];
    m.resolved = true; m.read = true;
    if (!p || (p.team !== u && (p as any).bird !== u)) continue;
    if (tryResign(w, p)) log(w, 'Assistant GM', `re-signed ${p.name} (${fmt$(p.contract!.salary)} × ${p.contract!.years})`, true);
    else if (w.season.phase === 'freeagency') { if (p.team === u) releasePlayer(w, p.id); else { (p as any).renounced = u; delete (p as any).bird; delete (p as any).rfa; } log(w, 'Assistant GM', `let ${p.name} walk`, true); }
    else log(w, 'Assistant GM', `passed on extending ${p.name} for now`);
  }
  // trades offered to us
  if (D.trades) for (const m of w.messages.filter(m => !m.resolved && m.actions?.some(a => a.cmd === 'acceptAiTrade'))) {
    const a = m.actions!.find(x => x.cmd === 'acceptAiTrade')!;
    const offer = { givePicks: [], getPicks: [], ...a.arg };
    m.resolved = true; m.read = true;
    const valid = offer.give.every((id: string) => w.players[id]?.team === u) && offer.get.every((id: string) => w.players[id]?.team === offer.other);
    if (!valid) continue;
    const r = staffRead(w, offer);
    if (r.rel > 0.1 && r.relLo > -0.1) { executeTrade(w, offer); log(w, 'Assistant GM', `accepted ${w.teams[offer.other].name}'s offer (${r.verdict.toLowerCase()})`, true); }
    else log(w, 'Assistant GM', `turned down ${w.teams[offer.other].name}'s offer (${r.verdict.toLowerCase()})`);
  }
  // keep the roster full in season
  if (D.freeAgency && inSeason(w)) {
    const healthy = t.roster.filter(id => !(w.players[id].injury && w.players[id].injury!.daysLeft > 5)).length;
    if (rosterCount(w, u) < eraRoster(w).max && (rosterCount(w, u) < eraRoster(w).max - 1 || healthy < 10)) {
      const p = bestFreeAgent(w, budgetRoom(w));
      if (p) { const sal = Math.min(p.ask ?? marketSalary(p, capSeason(w)), bestOffer(w, u, p, 2)) || minSalary(capSeason(w), yos(p)); if (playerAccepts(w, p, u, sal, 1).ok) { if (signPlayer(w, p.id, u, sal, 1).ok) log(w, 'Assistant GM', `signed ${p.name} to fill a roster spot (${fmt$(sal)})`, true); } }
    }
  }
  // coach's request, via free agency (once a week)
  const req = openRequest(w);
  const wk = Math.floor(new Date(w.season.day + 'T12:00:00Z').getTime() / (7 * 86400000));
  if (D.coachRequests && req && inSeason(w) && (w as any).lastReqTry !== wk) {
    (w as any).lastReqTry = wk;
    const now = needMetric(w, t.roster, req.key);
    const worst = t.roster.map(id => w.players[id]).filter(p => !p.injury).sort((a, b) => playerValue(a) - playerValue(b))[0];
    const room = budgetRoom(w) + (rosterCount(w, u) >= eraRoster(w).max && worst ? (worst.contract?.salary ?? 0) * 0.5 : 0);
    const cands = w.freeAgents.map(id => w.players[id]).filter(p => p && !p.retired && rightsOk(p, u) && (p.ask ?? marketSalary(p)) <= Math.max($y(40000), room));
    let best: Player | null = null, bestM = now + 0.75;
    for (const p of cands) { const after = rosterCount(w, u) >= eraRoster(w).max && worst ? [...t.roster.filter(id => id !== worst.id), p.id] : [...t.roster, p.id]; const m = needMetric(w, after, req.key); if (m > bestM) { bestM = m; best = p; } }
    if (best) {
      const sal = Math.min(best.ask ?? marketSalary(best, capSeason(w)), bestOffer(w, u, best, 2)) || minSalary(capSeason(w), yos(best));
      if (playerAccepts(w, best, u, sal, 1).ok) {
        if (rosterCount(w, u) >= eraRoster(w).max && worst) releasePlayer(w, worst.id);
        if (signPlayer(w, best.id, u, sal, 1).ok) log(w, 'Assistant GM', `signed ${best.name} for the coach's request${rosterCount(w, u) >= eraRoster(w).max && worst ? ` (released ${worst.name})` : ''}`, true);
      }
    }
  }
  // scouting trips
  if (D.scouting) {
    const cls = (w.draftClasses[String(w.season.year + 1)] ?? []).map(id => w.players[id]).filter(p => p && !p.team && p.scout)
      .sort((a, b) => b.scout!.pot.mid - a.scout!.pot.mid).slice(0, 30).sort((a, b) => a.scout!.now.reports - b.scout!.now.reports);
    let i = 0;
    while (scoutTrips(w).left > 0 && i < cls.length) { useScoutTrip(w); scoutReport(w, cls[i++].id); }
  }
  // routine mail last, so it catches what the others produced
  if (D.inbox) for (const m of w.messages) if (!m.resolved && (!m.actions?.length || m.actions.every(a => a.cmd === 'dismiss'))) { m.resolved = true; m.read = true; }
}

/** Offseason roster work: sign up to the era's roster limit within budget (draft rights first), trim the extras. */
export function offseasonRoster(w: World) {
  const u = w.meta.userTeam, t = w.teams[u];
  let guard = 0;
  const skip = new Set<string>();
  const target = eraRoster(w).max >= 15 ? 14 : 12;
  while (rosterCount(w, u) < target && guard++ < 25) {
    const p = bestFreeAgent(w, budgetRoom(w), x => !skip.has(x.id));
    if (!p) break;
    const sal = Math.min(p.ask ?? marketSalary(p, capSeason(w)), bestOffer(w, u, p, 2)) || minSalary(capSeason(w), yos(p));
    if (playerAccepts(w, p, u, sal, p.age && p.age < 26 ? 2 : 1).ok) { if (signPlayer(w, p.id, u, sal, p.age && p.age < 26 ? 2 : 1).ok) log(w, 'Assistant GM', `signed ${p.name} (${fmt$(sal)})`); else skip.add(p.id); }
    else skip.add(p.id);
  }
  // late summer: fringe veterans take a minimum deal to stay in the league
  const mn = (p: Player) => minSalary(capSeason(w), yos(p));
  const late = w.freeAgents.map(id => w.players[id]).filter(p => p && !p.retired && rightsOk(p, u) && (p.ask ?? marketSalary(p)) <= mn(p) * 2.5).sort((a, b) => playerValue(b) - playerValue(a));
  for (const p of late) {
    if (rosterCount(w, u) >= target) break;
    if (signPlayer(w, p.id, u, mn(p), 1).ok) log(w, 'Assistant GM', `signed ${p.name} to a minimum deal`);
  }
  const signed = () => t.roster.filter(id => (w.players[id].contract?.years ?? 0) > 0 && !w.players[id].contract?.twoWay);
  while (signed().length > eraRoster(w).max) {
    const worst = signed().map(id => w.players[id]).sort((a, b) => playerValue(a) - playerValue(b))[0];
    releasePlayer(w, worst.id); log(w, 'Assistant GM', `released ${worst.name} to get to the roster limit`);
  }
}
