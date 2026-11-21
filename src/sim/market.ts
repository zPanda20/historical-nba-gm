// Free agency as a market: thirty July days, a moratorium before deals become official (from 1999), offers from every
// interested team, players choosing between them (money, years, a winner, a role, loyalty), qualifying offers and offer
// sheets for restricted free agents, and the late-summer scramble for minimum deals and two-way spots.
import { cultureAppeal, motive } from './people';
import { awaitingPlan, dynastyAppeal, planTargets } from './dynasty';
import type { ContractOption, Player, Team, World } from './types';
import { aiSignAndTrades } from './signtrade';
import { clamp, stream } from './rng';
import { playerValue } from './coach';
import { addEvent, addMessage, addNews, projectedWins } from './world';
import { bestOffer, marketValue, capRules, capSeason, signingCheck, noteSigning, teamPayroll, minSalary, yos, aiSpendLine, fmtM, capRoom, maxSalary } from './cap';
import type { SignVia } from './cap';
import { makeContract, maxRaise, maxFor, qualifyingOffer, twoWaySalary, birdLevel, salaryAt } from './contracts';
import { rules, rosterCount, twoWayCount, twoWayEligible } from './rules';

export interface FAOffer { team: string; first: number; years: number; raise: number; opts?: ContractOption[]; day: number; twoWay?: boolean }
export interface FAState {
  year: number; day: number; len: number; offers: Record<string, FAOffer[]>; decideAt: Record<string, number>;
  sheets: Record<string, { team: string; offer: FAOffer; due: number }>; done?: boolean;
}
export const FA_DAYS = 30;
/** Deals agreed in the first days of July become official when the moratorium lifts (July 6 from 1999; a short window before). */
export const moratoriumEnd = (season: number) => (season >= 1999 ? 6 : 2);

export function faState(w: World): FAState {
  const a = w as any;
  if (!a.fa || a.fa.year !== w.season.year) a.fa = { year: w.season.year, day: 0, len: FA_DAYS, offers: {}, decideAt: {}, sheets: {} };
  return a.fa;
}
export const faActive = (w: World) => w.season.phase === 'freeagency' && !faState(w).done;
const faDate = (w: World, day: number) => `${w.season.year + 1}-07-${String(Math.min(31, day + 1)).padStart(2, '0')}`;
const pool = (w: World) => w.freeAgents.map(id => w.players[id]).filter(p => p && !p.retired);
export const offersFor = (w: World, pid: string) => faState(w).offers[pid] ?? [];
export const ourOffer = (w: World, pid: string, tid = w.meta.userTeam) => offersFor(w, pid).find(o => o.team === tid);

/** Salary a team has promised in outstanding offers that need cap room (re-signings use Bird rights instead). */
function earmarked(w: World, tid: string, except?: string): number {
  const F = faState(w);
  let s = 0;
  for (const [pid, os] of Object.entries(F.offers)) if (pid !== except) for (const o of os) if (o.team === tid && !o.twoWay && (w.players[pid] as any)?.bird !== tid) s += o.first;
  return s;
}

/** Put an offer on the table (or replace ours). Checked against the cap with every other outstanding offer counted. */
export function makeOffer(w: World, tid: string, p: Player, o: Omit<FAOffer, 'team' | 'day'>): { ok: boolean; reason?: string; via?: SignVia } {
  const F = faState(w);
  const first = o.twoWay ? twoWaySalary(capSeason(w)) : o.first;
  const chk = signingCheck(w, tid, p, first, o.years, { twoWay: o.twoWay, earmark: earmarked(w, tid, p.id) });
  if (!chk.ok) return { ok: false, reason: chk.reason };
  const raise = clamp(o.raise, -0.05, maxRaise(capSeason(w), chk.via === 'bird'));
  F.offers[p.id] = [...offersFor(w, p.id).filter(x => x.team !== tid), { ...o, first, raise, team: tid, day: F.day }];
  if (F.decideAt[p.id] == null) F.decideAt[p.id] = decisionDay(w, p);
  return { ok: true, via: chk.via };
}
export function withdrawOffer(w: World, tid: string, pid: string) {
  const F = faState(w);
  F.offers[pid] = offersFor(w, pid).filter(o => o.team !== tid);
}
/** Stars take their time and let the bids come in; role players decide quickly. */
function decisionDay(w: World, p: Player): number {
  const F = faState(w), r = stream(w.meta.seed, 'fa-wait', F.year, p.id);
  const v = playerValue(p);
  const wait = v >= 82 ? r.int(3, 7) : v >= 70 ? r.int(2, 4) : v >= 60 ? r.int(1, 3) : r.int(0, 2);
  return Math.max(F.day + wait, moratoriumEnd(capSeason(w)) - (v >= 60 ? 0 : 3));
}

/** How much a player likes an offer: money first (what the whole deal is worth against his asking price), then years,
 *  a team that can win, a real role, and the pull of the team that holds his Bird rights. */
export function offerUtility(w: World, p: Player, o: FAOffer): number {
  const season = capSeason(w);
  const ask = Math.max(minSalary(season, yos(p)), p.ask ?? 0);
  const age = p.age ?? 27;
  const pv = Array.from({ length: o.years }, (_, k) => o.first * (1 + o.raise * k) * Math.pow(0.93, k)).reduce((a, b) => a + b, 0);
  const wantYears = age >= 32 ? 2 : age >= 29 ? 3 : 4;
  const fair = Array.from({ length: Math.min(o.years, wantYears) }, (_, k) => ask * Math.pow(0.93, k)).reduce((a, b) => a + b, 0);
  let u = (pv / Math.max(1, fair)) - 1;                                     // 0 = exactly what he wants
  u += -0.06 * Math.abs(o.years - wantYears) + (age >= 30 && o.years >= wantYears ? 0.05 : 0);
  if (o.opts?.some(x => x.kind === 'player')) u += 0.06;
  if (o.opts?.some(x => x.kind === 'team')) u -= 0.07;
  const t = w.teams[o.team];
  const proj = (projectedWins(w)[o.team] ?? 41) / 82;
  u += (proj - 0.5) * 0.5 * Math.min(1.25, (p.traits.drive ?? 50) / 55) * (age >= 30 ? 1.5 : 1);  // older players chase rings
  const better = t.roster.map(id => w.players[id]).filter(x => x && playerValue(x) > playerValue(p)).length;
  u += better < 4 ? 0.06 : better < 8 ? 0 : -0.08;
  if ((p as any).bird === o.team) u += 0.05 + ((p.traits.loyalty ?? 50) - 50) / 400;
  if (o.twoWay) u -= 0.05;
  u += (proj - 0.5) * 0.5 * Math.min(1, Math.max(0, motive(p, 'rings') - 1 / 12) * 6) * 0.15; // a man who lives for titles weighs the roster more
  u += cultureAppeal(w, p, o.team) + dynastyAppeal(w, p, o.team);
  return u + stream(w.meta.seed, 'fa-taste', faState(w).year, p.id, o.team).normal(0, 0.03);
}

/** Make a deal official. */
function finalize(w: World, p: Player, o: FAOffer): boolean {
  const chk = signingCheck(w, o.team, p, o.twoWay ? twoWaySalary(capSeason(w)) : o.first, o.years, { twoWay: o.twoWay });
  if (!chk.ok) return false;
  noteSigning(w, o.team, chk.via);
  const t = w.teams[o.team];
  const was = (p as any).bird;
  if (was !== o.team) (p as any).birdYears = 0;
  w.freeAgents = w.freeAgents.filter(x => x !== p.id);
  p.team = o.team; if (!t.roster.includes(p.id)) t.roster.push(p.id);
  p.contract = makeContract(o.twoWay ? twoWaySalary(capSeason(w)) : o.first, o.years, { raise: o.twoWay ? 0 : o.raise, opts: o.opts, twoWay: o.twoWay, signed: w.season.day, provenance: o.twoWay ? 'Two-way contract (simulated)' : 'Signed in this save (simulated)' });
  p.rosterStatus = o.twoWay ? 'Two-way contract' : 'Signed';
  delete (p as any).bird; delete (p as any).rfa; delete (p as any).renounced;
  const F = faState(w);
  delete F.offers[p.id]; delete F.decideAt[p.id]; delete F.sheets[p.id];
  addEvent(w, 'signing', `${o.team} signed ${p.name} (${fmtM(o.first)} × ${o.years}${was === o.team ? ', re-signed' : ''})`, [p.id]);
  for (const m of w.messages) if (!m.resolved && m.role === 'Agent' && m.subject.startsWith(p.name)) m.resolved = true;
  const big = playerValue(p) > 66;
  if (big || o.team === w.meta.userTeam) addNews(w, was === o.team ? `${p.name} re-signs with ${t.name}` : `${p.name} signs with ${t.name}`, `${o.years} year${o.years > 1 ? 's' : ''}, ${fmtM(o.first)} in the first season${o.opts?.length ? `, ${o.opts.map(x => `${x.kind} option`).join(', ')}` : ''}.`, 'transactions');
  return true;
}

/** A player chooses: an offer sheet for a restricted free agent goes to his old team to match. */
function decide(w: World, p: Player, log: string[]) {
  const F = faState(w);
  const os = offersFor(w, p.id);
  if (!os.length) return;
  if (F.day < F.len - 6 && awaitingPlan(w, p, os)) { F.decideAt[p.id] = F.day + 2; return; }
  const ranked = os.map(o => ({ o, u: offerUtility(w, p, o) })).sort((a, b) => b.u - a.u);
  const elapsed = F.day - moratoriumEnd(capSeason(w));
  const bar = -0.12 - Math.max(0, elapsed) * 0.012;                          // he gets less picky as July wears on
  const best = ranked[0];
  if (best.u < bar && F.day < F.len - 1) { F.decideAt[p.id] = F.day + 2; return; }
  const rfa = (p as any).rfa as { team: string; qo: number } | undefined;
  if (rfa && best.o.team !== rfa.team) { offerSheet(w, p, best.o, log); return; }
  for (const { o } of ranked) {
    if (finalize(w, p, o)) {
      if (o.team === w.meta.userTeam) log.push(`${p.name} accepted our offer.`);
      else if (os.some(x => x.team === w.meta.userTeam)) log.push(`${p.name} chose ${w.teams[o.team].name} over us.`);
      return;
    }
    if (o.team === w.meta.userTeam) log.push(`Our offer to ${p.name} no longer fits under the cap and was withdrawn.`);
    withdrawOffer(w, o.team, p.id);
  }
}

// ------------------------------------------------------------------ restricted free agency
function offerSheet(w: World, p: Player, o: FAOffer, log: string[]) {
  const F = faState(w);
  const rfa = (p as any).rfa as { team: string; qo: number };
  F.sheets[p.id] = { team: rfa.team, offer: o, due: F.day + 2 };
  delete F.decideAt[p.id];
  if (rfa.team === w.meta.userTeam) {
    addMessage(w, { date: w.season.day, from: 'League office', role: 'League', subject: `Offer sheet: ${p.name} signs with ${w.teams[o.team].name}`, urgent: 3, tag: 'Decision', deadline: faDate(w, F.day + 2),
      body: `${p.name} is a restricted free agent. ${w.teams[o.team].city} offered ${fmtM(o.first)} for ${o.years} year${o.years > 1 ? 's' : ''} (${Math.round(o.raise * 100)}% raises). We have two days to match and keep him on exactly those terms, using his Bird rights.`,
      actions: [{ label: 'Match the offer', cmd: 'matchSheet', arg: { pid: p.id } }, { label: 'Let him go', cmd: 'declineSheet', arg: { pid: p.id } }] });
    log.push(`${w.teams[o.team].name} signed ${p.name} to an offer sheet. Match it or let him go.`);
  } else {
    // AI: match a player worth keeping who fits its spending line
    const t = w.teams[rfa.team];
    const keep = playerValue(p) >= 60 && teamPayroll(w, t.id) + o.first <= aiSpendLine(w, t) * 1.08;
    resolveSheet(w, p.id, keep, log);
  }
}
export function resolveSheet(w: World, pid: string, match: boolean, log: string[] = []) {
  const F = faState(w);
  const sh = F.sheets[pid]; const p = w.players[pid];
  if (!sh || !p) return;
  if (match) {
    const ok = finalize(w, p, { ...sh.offer, team: sh.team });
    if (ok) { addNews(w, `${w.teams[sh.team].name} match the offer for ${p.name}`, `${w.teams[sh.offer.team].city}'s offer sheet is matched.`, 'transactions'); if (sh.team === w.meta.userTeam) log.push(`We matched ${p.name}'s offer sheet.`); return; }
  }
  delete (p as any).rfa;
  if (!finalize(w, p, sh.offer)) { delete F.sheets[pid]; F.decideAt[pid] = F.day + 1; }
}

// ------------------------------------------------------------------ AI clubs in the market
function wantsMore(w: World, t: Team): number {
  const R = rules(w);
  const target = R.max >= 15 ? 14 : 12;
  const pending = Object.values(faState(w).offers).reduce((s, os) => s + os.filter(o => o.team === t.id && !o.twoWay).length, 0);
  return target - rosterCount(w, t.id) - pending;
}
function aiOffers(w: World, log: string[]) {
  const F = faState(w);
  const season = capSeason(w);
  const R = capRules(season);
  const rng = stream(w.meta.seed, 'fa-ai', F.year, F.day);
  const teams = Object.values(w.teams).filter(t => t.id !== w.meta.userTeam).sort(() => rng.next() - 0.5);
  const fas = pool(w).sort((a, b) => playerValue(b) - playerValue(a));
  for (const t of teams) {
    let budget = wantsMore(w, t);
    // day one: keep the players they want with Bird rights
    if (F.day <= 1) for (const p of fas.filter(x => (x as any).bird === t.id && !ourOffer(w, x.id, t.id))) {
      const v = playerValue(p);
      const ask = Math.min(p.ask ?? 0, maxFor(p, t.id, season) ?? Infinity);
      const fits = teamPayroll(w, t.id) + earmarked(w, t.id) + ask <= aiSpendLine(w, t) * (v >= 78 ? 1.12 : 1);
      const level = birdLevel(p, t.id, season);
      if (v >= 54 && (p.age ?? 30) < 34 && fits && level) {
        const yrs = v >= 74 && (p.age ?? 30) < 30 ? 4 + rng.int(0, 1) : rng.int(1, 3);
        makeOffer(w, t.id, p, { first: Math.max(minSalary(season, yos(p)), ask), years: Math.min(yrs, R.maxYearsOwn), raise: maxRaise(season, true) * 0.75 });
      } else (p as any).renounced = t.id; // renounced: frees the cap hold
    }
    // a team-up aimed at this team: they will clear what it takes to make real offers (players take less to be together)
    for (const id of planTargets(w, t.id)) {
      const p = w.players[id];
      if (!p || !w.freeAgents.includes(id) || ourOffer(w, id, t.id) || F.sheets[id]) continue;
      const ask = p.ask ?? 0, chk = signingCheck(w, t.id, p, ask, 4, { earmark: earmarked(w, t.id, id) });
      const first = chk.ok ? ask : Math.max(chk.most ?? 0, 0);
      if (first >= ask * 0.5 && first > minSalary(season, yos(p))) makeOffer(w, t.id, p, { first, years: Math.min(4, R.maxYearsOther ?? 4), raise: maxRaise(season, false) * 0.6 });
    }
    if (budget <= 0) continue;
    const line = aiSpendLine(w, t);
    let made = 0;
    for (const p of fas.slice(0, 60)) {
      if (made >= (F.day < 4 ? 2 : 1) || budget <= 0) break;
      if (ourOffer(w, p.id, t.id) || F.sheets[p.id] || (p.rosterStatus ?? '').startsWith('Draft rights held by') && p.draftedBy !== t.id) continue;
      const v = playerValue(p);
      const rivals = offersFor(w, p.id).length;
      const ask = p.ask ?? 0;
      // bid up a contested player a little, never past the cap rules
      const want = Math.round(ask * (1 + Math.min(0.12, rivals * 0.04)) / 5000) * 5000;
      const room = capRoom(w, t.id) - earmarked(w, t.id);
      const mn = minSalary(season, yos(p));
      const years = v >= 72 && (p.age ?? 30) < 30 ? rng.int(3, 4) : v >= 62 ? rng.int(1, 3) : 1;
      let first = want;
      const legal = signingCheck(w, t.id, p, first, years, { earmark: earmarked(w, t.id, p.id) });
      if (!legal.ok) first = Math.min(want, legal.most ?? 0);
      if (first < ask * 0.85 && first > mn) continue;
      if (first <= mn) { if (F.day < 12 && v < 58) continue; first = mn; }
      if (first > mn && teamPayroll(w, t.id) + earmarked(w, t.id) + first > line && first > room) continue;
      if (makeOffer(w, t.id, p, { first, years: first <= mn ? 1 : years, raise: maxRaise(season, false) * 0.6 }).ok) { made++; budget--; }
    }
  }
}

/** One day of free agency. Returns what happened that the user should hear about. */
export function faAdvanceDay(w: World): string[] {
  const F = faState(w);
  const log: string[] = [];
  if (F.done) return log;
  F.day++;
  w.season.day = faDate(w, F.day);
  aiOffers(w, log);
  aiSignAndTrades(w, log);
  // offer sheets the user ignored lapse unmatched
  for (const [pid, sh] of Object.entries(F.sheets)) if (sh.due < F.day && sh.team === w.meta.userTeam) { resolveSheet(w, pid, false, log); log.push(`${w.players[pid]?.name}'s offer sheet went unmatched.`); }
  const ready = F.day >= moratoriumEnd(capSeason(w));
  for (const p of pool(w)) {
    if (!offersFor(w, p.id).length || F.sheets[p.id]) continue;
    if (ready && (F.decideAt[p.id] ?? 99) <= F.day) decide(w, p, log);
  }
  // unsigned players ease their asks as July goes on
  if (F.day >= 8) for (const p of pool(w)) if (p.ask) p.ask = Math.max(minSalary(capSeason(w), yos(p)), Math.round(p.ask * 0.985 / 5000) * 5000);
  if (F.day >= F.len) closeFreeAgency(w, log);
  return log;
}

/** Decisions the user still owes before free agency can move on (team options, offer sheets). */
export function pendingDecisions(w: World) { return w.messages.filter(m => !m.resolved && m.tag === 'Decision'); }

/** End of July: restricted free agents without a deal sign their qualifying offer, clubs fill rosters and two-way slots. */
export function closeFreeAgency(w: World, log: string[] = []) {
  const F = faState(w);
  if (F.done) return;
  const season = capSeason(w);
  for (const m of pendingDecisions(w)) autoDecide(w, m);
  for (const pid of Object.keys(F.sheets)) resolveSheet(w, pid, false, log);
  for (const p of pool(w)) {
    const rfa = (p as any).rfa as { team: string; qo: number } | undefined;
    if (rfa) { if (finalize(w, p, { team: rfa.team, first: rfa.qo, years: 1, raise: 0, day: F.day })) log.push(rfa.team === w.meta.userTeam ? `${p.name} signed his qualifying offer.` : ''); }
  }
  F.offers = {}; F.decideAt = {};
  const rng = stream(w.meta.seed, 'fa-close', F.year);
  // last call: a good player still unsigned takes the best real offer a team can make, at a discount, rather than a minimum
  const askOf = (p: Player) => p.ask ?? marketValue(season, playerValue(p), p.age ?? 27, 2);
  const holdout = (p: Player) => playerValue(p) >= 66 || askOf(p) > minSalary(season, yos(p)) * 2.2;
  for (const p of pool(w).filter(x => holdout(x) && !(x.rosterStatus ?? '').startsWith('Draft rights held by')).sort((a, b) => playerValue(b) - playerValue(a))) {
    const ask = askOf(p), years = (p.age ?? 27) >= 31 ? 1 : 2;
    let best: FAOffer | null = null, bu = -9, bestCut: Player | null = null;
    for (const pass of [0, 1]) for (const t of Object.values(w.teams)) {
      if (best && pass === 1) break;
      if (t.id === w.meta.userTeam) continue;
      // a full roster waives its fifteenth man for a player this much better
      let cut: Player | null = null;
      if (rosterCount(w, t.id) >= rules(w).max) {
        cut = t.roster.map(id => w.players[id]).filter(x => x && !x.contract?.twoWay && (x.contract?.salary ?? 0) <= minSalary(season, yos(x)) * 2 && playerValue(x) < playerValue(p) - 12).sort((a, b) => playerValue(a) - playerValue(b))[0] ?? null;
        if (!cut) continue;
      }
      // a good player nobody has room for takes what a team can still do (an exception, a short deal) rather than sit out
      const R = capRules(season);
      const ceiling = Math.max(aiSpendLine(w, t), R.tax ? R.tax * 1.02 : R.cap * 1.25) - teamPayroll(w, t.id);
      const most = pass === 0 ? Math.min(bestOffer(w, t.id, p, years), ceiling) : bestOffer(w, t.id, p, years); // second pass: contenders pay the tax for a player this good
      if (most < minSalary(season, yos(p)) * 1.5 || (pass === 0 && most < ask * 0.3) || (pass === 1 && playerValue(p) < 70)) continue;
      const o: FAOffer = { team: t.id, first: Math.round(Math.min(most, ask * 0.85) / 5000) * 5000, years, raise: 0, day: F.day };
      const u = offerUtility(w, p, o);
      if (u > bu) { bu = u; best = o; bestCut = cut; }
    }
    if (best) { if (bestCut) releaseToPool(w, bestCut); if (!finalize(w, p, best) && bestCut) { /* cut stays cut: a camp body */ } }
    else p.ask = Math.max(minSalary(season, yos(p)), Math.round(ask * 0.8 / 5000) * 5000);
  }
  for (const t of Object.values(w.teams)) {
    if (t.id === w.meta.userTeam) continue;
    // fill to the minimum roster with minimum deals, then two-way slots with young players
    const fill = () => pool(w).filter(p => (!(p.rosterStatus ?? '').startsWith('Draft rights held by') || p.draftedBy === t.id) && !holdout(p)).sort((a, b) => playerValue(b) - playerValue(a));
    let g = 0;
    while (rosterCount(w, t.id) < Math.max(rules(w).min, rules(w).max >= 15 ? 13 : 12) && g++ < 8) {
      const p = fill()[0]; if (!p) break;
      if (!finalize(w, p, { team: t.id, first: minSalary(season, yos(p)), years: 1, raise: 0, day: F.day })) { w.freeAgents = w.freeAgents.filter(x => x !== p.id); w.freeAgents.push(p.id); break; }
    }
    g = 0;
    while (twoWayCount(w, t.id) < rules(w).twoWay && g++ < 4) {
      const p = fill().find(x => twoWayEligible(w, x, yos(x)) && playerValue(x) < 66); if (!p) break;
      if (!finalize(w, p, { team: t.id, first: twoWaySalary(season), years: rng.int(1, 2), raise: 0, day: F.day, twoWay: true })) break;
    }
    // over the limit: the weakest standard contract goes
    while (rosterCount(w, t.id) > rules(w).max) {
      const worst = t.roster.map(id => w.players[id]).filter(p => p && !p.contract?.twoWay).sort((a, b) => playerValue(a) - playerValue(b))[0];
      if (!worst) break;
      releaseToPool(w, worst);
    }
  }
  F.done = true;
  addMessage(w, { date: w.season.day, from: 'League office', role: 'League', subject: 'Free agency winds down', body: 'The July market is over. Anyone still unsigned can be signed through the preseason and season, usually for less.', urgent: 0, tag: 'League' });
}
function releaseToPool(w: World, p: Player) {
  const t = w.teams[p.team!];
  t.roster = t.roster.filter(x => x !== p.id);
  // a training-camp cut on a minimum deal costs nothing that matters here
  p.team = null; p.contract = null; p.rosterStatus = `Waived by ${t.abbr}`; p.ask = minSalary(capSeason(w), yos(p));
  if (!w.freeAgents.includes(p.id)) w.freeAgents.push(p.id);
}

/** Headless / delegated: run the rest of July with the user's open decisions taken by default. */
export function finishFreeAgency(w: World) {
  const F = faState(w);
  let guard = 0;
  while (!F.done && guard++ < 40) {
    for (const m of pendingDecisions(w)) autoDecide(w, m);
    faAdvanceDay(w);
  }
}
/** Default answers: exercise a team option on a useful player, match an offer sheet we can afford. */
export function autoDecide(w: World, m: any) {
  const a = m.actions?.find((x: any) => x.cmd === 'exerciseOption' || x.cmd === 'matchSheet');
  const p = a ? w.players[a.arg.pid] : null;
  m.resolved = true; m.read = true;
  if (!p) return;
  if (a.cmd === 'exerciseOption') { if (playerValue(p) >= 55) exerciseOption(w, p.id); else declineOption(w, p.id); }
  else resolveSheet(w, p.id, playerValue(p) >= 62, []);
}

// ------------------------------------------------------------------ options
export function exerciseOption(w: World, pid: string) {
  const c = w.players[pid]?.contract;
  if (!c?.opts) return;
  c.opts = c.opts.filter(o => o.idx !== 0);
  if (!c.opts.length) delete c.opts;
}
/** Declining (team) or opting out (player): the deal ends now and he enters free agency, Bird rights intact. */
export function declineOption(w: World, pid: string) {
  const p = w.players[pid];
  if (!p?.team || !p.contract) return;
  const t = w.teams[p.team];
  (p as any).prevSalary = p.contract.salary; (p as any).bird = t.id;
  t.roster = t.roster.filter(x => x !== pid);
  p.team = null; p.contract = null; p.rosterStatus = `Free agent (was ${t.abbr})`;
  p.ask = marketAsk(w, p);
  if (!w.freeAgents.includes(pid)) w.freeAgents.push(pid);
}
let marketAsk = (w: World, p: Player) => p.ask ?? 0;
export function setMarketAsk(f: (w: World, p: Player) => number) { marketAsk = f; }
export { maxSalary, salaryAt, qualifyingOffer };
