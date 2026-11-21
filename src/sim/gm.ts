// GM layer: front-office commands, AI GM behaviour, owner, agents, coach requests (GDD §8, §11, §12, §15).
import type { ClockState, Player, Team, World } from './types';
import { doSignTrade } from './signtrade';
import { rules as eraRoster, rosterCount } from './rules';
import { clamp, sigmoid, stream } from './rng';
import { coachRespond, playerValue } from './coach';
import { addEvent, addMessage, addNews, potentialOvr, projectedWins, teamStrength } from './world';
import { executeTradeBetween, aiProposeTrade, aiAiTrades } from './trade';
import type { TradeOffer } from './trade';
import { openJobMarket } from './jobs';
import { $y } from './history';
import { hypeOf } from './impact';
import { ERA } from './history';
import { capRules, capSeason, signingCheck, noteSigning, bestOffer, addDeadMoney, rollDeadMoney, teamPayroll, marketValue, maxSalary, yos, aiSpendLine, minSalary } from './cap';
import type { SignCheck } from './cap';
import { makeContract, extendContract, rollContract, optionNow, birdYears, birdLevel, qualifyingOffer, salaryAt, BIRD_LABEL } from './contracts';
import type { ContractTerms } from './contracts';
import { faState, declineOption, exerciseOption, finishFreeAgency, setMarketAsk } from './market';
import { tradeDeadline } from './rules';
import { checkCoachRequest, makeCoachRequest, openRequest, worstNeed, needDef } from './needs';

/** Trade deadline for the season starting in `year` (era dates; see rules.ts). */
export const TRADE_DEADLINE = (year: number) => tradeDeadline(year);
export const fmt$ = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(2)}m` : `$${Math.round(n / 1000)}k`;
/** Payroll on the books for the cap season, dead money included. */
export const payroll = (w: World, tid: string) => teamPayroll(w, tid);

// ------------------------------------------------------------------ valuation (F13 / F22)
export function clockWeights(c: ClockState | undefined) {
  return c === 'Win Now' ? { now: 0.85, fut: 0.15 } : c === 'Contending' ? { now: 0.65, fut: 0.35 } : c === 'Building' ? { now: 0.45, fut: 0.55 } : { now: 0.3, fut: 0.7 };
}
/** Unsigned late-round picks are only available to the team holding their rights. */
export const rightsOk = (p: Player, tid: string) => !(p.rosterStatus ?? '').startsWith('Draft rights held by') || p.draftedBy === tid;
/** What a player would ask on the open market for `season` (the cap year), within that era's minimum and maximum. */
export function marketSalary(p: Player, season = ERA.year): number {
  return marketValue(season, playerValue(p), p.age ?? 27, yos(p));
}
export { assetValue, pickValue, evaluateTrade, staffRead, aiMargin, tradeLegal, executeTradeBetween } from './trade';
export type { TradeOffer, PickRef, TradeReply } from './trade';

export function executeTrade(w: World, offer: TradeOffer) {
  const u = w.meta.userTeam;
  const s = offer.sat;
  const desc = !s ? executeTradeBetween(w, u, offer.other, offer.give, offer.get, offer.givePicks, offer.getPicks)
    : s.from === u ? doSignTrade(w, s, offer.other, offer.give, offer.get, offer.givePicks, offer.getPicks)
    : doSignTrade(w, s, u, offer.get, offer.give, offer.getPicks, offer.givePicks);
  // trading away a coach's best players without his input dents trust a little
  const coach = w.coaches[w.teams[w.meta.userTeam].coach];
  if (offer.give.some(id => playerValue(w.players[id]) > 66)) coach.trustGM = clamp((coach.trustGM ?? 55) - 3, 0, 100);
  checkCoachRequest(w);
  return desc;
}

// ------------------------------------------------------------------ signing / release / extension
export function playerAccepts(w: World, p: Player, tid: string, salary: number, years: number): { ok: boolean; text: string } {
  const ask = p.ask ?? marketSalary(p);
  const team = w.teams[tid];
  const winPct = team.w + team.l > 0 ? team.w / (team.w + team.l) : (projectedWins(w)[tid] ?? 41) / 82;
  const roleRank = team.roster.map(id => playerValue(w.players[id])).filter(v => v > playerValue(p)).length;
  const role = roleRank < 5 ? 1 : roleRank < 8 ? 0.4 : -0.4;
  const yearsPref = (p.age ?? 27) >= 30 ? (years >= 2 ? 0.4 : -0.3) : years >= 3 ? 0.15 : 0;
  const money = (salary - ask) / Math.max($y(25000), ask * 0.15);
  const loyalty = p.team === tid ? (p.traits.loyalty - 50) / 40 : 0;
  const s = money + role * 0.6 + (winPct - 0.5) * 2 * ((p.traits.drive ?? 50) / 60) + yearsPref + loyalty;
  const rng = stream(w.meta.seed, 'agent', w.season.day, p.id, salary, years);
  const ok = rng.chance(sigmoid(s * 1.6));
  const agent = 'Agent';
  if (ok) return { ok, text: `${agent} for ${p.name}: "We accept. He's looking forward to it."` };
  if (money < -0.6) return { ok, text: `${agent} for ${p.name}: "We're too far apart on money. He's looking for around ${fmt$(ask)}."` };
  if (role < 0) return { ok, text: `${agent} for ${p.name}: "He doesn't see a real role there."` };
  return { ok, text: `${agent} for ${p.name}: "We'll pass for now."` };
}

/** Sign (or extend) a player. Every signing goes through the era's rules; returns the check (nothing happens when it fails). */
export function signPlayer(w: World, pid: string, tid: string, salary: number, years: number, terms: ContractTerms = {}): SignCheck {
  const p = w.players[pid];
  const check = signingCheck(w, tid, p, salary, years, { twoWay: terms.twoWay });
  if (!check.ok) return check;
  noteSigning(w, tid, check.via);
  if (check.via === 'extension' && p.contract) {
    p.contract = extendContract(p.contract, salary, years, terms.raise ?? 0, w.season.day);
    addEvent(w, 'signing', `${tid} extended ${p.name} (${fmt$(salary)} × ${years} more)`, [pid]);
    if (playerValue(p) > 62) addNews(w, `${w.teams[tid].name} extend ${p.name}`, `${years} more season${years > 1 ? 's' : ''}, starting at ${fmt$(salary)}.`, 'transactions');
    return check;
  }
  if (p.team && p.team !== tid) { const old = w.teams[p.team]; old.roster = old.roster.filter(x => x !== pid); }
  if ((p as any).bird !== tid && p.team !== tid) (p as any).birdYears = 0;
  w.freeAgents = w.freeAgents.filter(x => x !== pid);
  p.team = tid; if (!w.teams[tid].roster.includes(pid)) w.teams[tid].roster.push(pid);
  delete (p as any).bird; delete (p as any).rfa; delete (p as any).renounced;
  if ((w as any).fa) delete faState(w).offers[pid];
  const first = check.via === 'twoway' ? check.most! : salary;
  p.contract = makeContract(first, years, { ...terms, signed: w.season.day, provenance: terms.twoWay ? 'Two-way contract (simulated)' : 'Signed in this save (simulated)' });
  p.rosterStatus = terms.twoWay ? 'Two-way contract' : 'Signed';
  addEvent(w, 'signing', `${tid} signed ${p.name} (${fmt$(first)} × ${years})`, [pid]);
  if (tid === w.meta.userTeam) checkCoachRequest(w);
  if (playerValue(p) > 58) addNews(w, `${w.teams[tid].name} sign ${p.name}`, `${years}-year deal, terms ${fmt$(first)}/yr (simulated).`, 'transactions');
  return check;
}

/** Waive a player: his guaranteed money stays on the books (spread over 2n+1 seasons with the stretch provision, 2011 on). */
export function releasePlayer(w: World, pid: string, stretch = false) {
  const p = w.players[pid];
  const t = w.teams[p.team!];
  addDeadMoney(w, t.id, p, stretch);
  if ((p.contract?.years ?? 0) <= 0) delete (p as any).bird; // letting an unsigned free agent go renounces his rights
  t.roster = t.roster.filter(x => x !== pid);
  (p as any).birdYears = 0;
  p.team = null; p.ask = Math.max(minSalary(capSeason(w), yos(p)), Math.round(marketSalary(p, capSeason(w)) * 0.8 / 5000) * 5000); p.contract = null; p.rosterStatus = `Waived by ${t.abbr}`;
  w.freeAgents.push(pid);
  addEvent(w, 'release', `${t.abbr} waived ${p.name}`, [pid]);
}

export function requestCoach(w: World, pid: string, kind: 'more' | 'protect' | 'develop') {
  const team = w.teams[w.meta.userTeam];
  const coach = w.coaches[team.coach];
  const p = w.players[pid];
  const res = coachRespond(w, team, coach, p, kind);
  team.minutesRequests = team.minutesRequests ?? {};
  team.minutesRequests[pid] = { kind, status: res.status };
  // repeated refusals and overruling cost trust; agreement builds it slightly
  coach.trustGM = clamp((coach.trustGM ?? 55) + (res.status === 'accepted' ? 1 : res.status === 'refused' ? -2 : 0), 0, 100);
  addEvent(w, 'coach_request', `Asked ${coach.name} to ${kind === 'more' ? 'play' : kind === 'protect' ? 'protect' : 'develop'} ${p.name}: ${res.status}`, [pid]);
  return res;
}

export function setClock(w: World, c: ClockState) {
  const old = w.clock; w.clock = c; w.teams[w.meta.userTeam].clock = c;
  const proj = projectedWins(w)[w.meta.userTeam];
  const ownerWants: ClockState = w.owner.wantsWins > 70 ? 'Win Now' : w.owner.wantsWins > 55 ? 'Contending' : 'Building';
  const order = ['Rebuilding', 'Building', 'Contending', 'Win Now'];
  const gap = Math.abs(order.indexOf(c) - order.indexOf(ownerWants));
  w.owner.satisfaction = clamp(w.owner.satisfaction - gap * 4 + (gap === 0 ? 2 : 0), 0, 100);
  const text = gap === 0 ? `"That's the direction I want too."` : gap === 1 ? `"I can live with that, but I'll be watching the results."` : `"That isn't what I signed up for. Make sure it works."`;
  addMessage(w, { date: w.season.day, from: w.owner.name, role: 'Owner', subject: `Franchise clock: ${old} → ${c}`, body: `${text} (Projected ${proj} wins.)`, urgent: gap >= 2 ? 2 : 0, tag: 'Owner' });
  addEvent(w, 'clock', `Franchise clock set to ${c}`);
}

export function fireCoach(w: World, newCoachId: string) {
  const team = w.teams[w.meta.userTeam];
  const old = w.coaches[team.coach];
  const nu = w.coaches[newCoachId];
  old.team = null; old.role = 'Available';
  nu.team = team.id; nu.role = 'Head coach'; nu.trustGM = 62;
  team.coach = nu.id;
  const losing = team.w < team.l;
  w.owner.satisfaction = clamp(w.owner.satisfaction + (losing ? 3 : -6), 0, 100);
  addNews(w, `${team.name} replace ${old.name}`, `${nu.name} takes over as head coach.`, 'transactions');
  addEvent(w, 'coach_change', `${old.name} fired; ${nu.name} hired`);
}

// ------------------------------------------------------------------ scouting reports
export function scoutReport(w: World, pid: string) {
  const p = w.players[pid];
  if (!p.scout) return;
  const rng = stream(w.meta.seed, 'scouting', w.season.day, pid);
  for (const k of ['now', 'pot'] as const) {
    const s = p.scout[k];
    // more looks shrink our own error; the consensus misread (hype) only partly washes out, as it did for real scouts
    const consensus = hypeOf(p) * (k === 'now' ? 0.35 : 0.65);
    const truth = (k === 'now' ? p.ovr : potentialOvr(p)) + consensus;
    const biasKept = s.mid - truth > 0 ? Math.min(2, (s.mid - truth) * 0.3) : Math.max(-2, (s.mid - truth) * 0.3);
    const target = truth + biasKept;
    const half = (s.hi - s.lo) / 2;
    s.mid = Math.round(s.mid + (target - s.mid) * 0.45 + rng.normal(0, 0.8));
    const nh = Math.max(k === 'now' ? 2 : 3, half * 0.7);
    s.mid = Math.min(99, s.mid); s.lo = Math.round(s.mid - nh); s.hi = Math.min(99, Math.round(s.mid + nh)); s.reports++;
  }
}

// ------------------------------------------------------------------ daily AI + message generation
const dayNum = (d: string) => Math.floor(new Date(d + 'T12:00:00Z').getTime() / 86400000);

/** League floor: a team below eight players (or six healthy) signs minimum-salary free agents until it can play. */
export function enforceRosterFloor(w: World) {
  const season = capSeason(w);
  for (const t of Object.values(w.teams)) {
    const healthy = () => t.roster.filter(id => !(w.players[id]?.injury && w.players[id].injury!.daysLeft > 0)).length;
    let guard = 0;
    while ((t.roster.length < 8 || (healthy() < 6 && t.roster.length < 13)) && guard++ < 6) {
      const p = w.freeAgents.map(id => w.players[id]).filter(x => x && !x.retired && rightsOk(x, t.id) && !(x.injury && x.injury.daysLeft > 0)).sort((a, b) => playerValue(b) - playerValue(a))[0];
      if (!p) break;
      const res = signPlayer(w, p.id, t.id, minSalary(season, yos(p)), 1);
      if (!res.ok) break;
      if (t.id === w.meta.userTeam) addMessage(w, { date: w.season.day, from: 'League office', role: 'League', subject: `Emergency signing: ${p.name}`, body: `League rules require a playable roster. With too few healthy players, ${p.name} was signed to a one-year minimum contract. You can release him once the roster recovers.`, urgent: 1, tag: 'League' });
    }
  }
}

export function aiDailyMoves(w: World) {
  const rng = stream(w.meta.seed, 'ai', w.season.day);
  if (['preseason', 'regular', 'playoffs'].includes(w.season.phase)) enforceRosterFloor(w);
  for (const t of Object.values(w.teams)) {
    if (t.id === w.meta.userTeam) continue;
    const healthy = t.roster.filter(id => !(w.players[id].injury && w.players[id].injury!.daysLeft > 3)).length;
    const R = eraRoster(w);
    if (rosterCount(w, t.id) < R.min - 1 || (healthy < 9 && rosterCount(w, t.id) < R.max)) {
      // injury cover: the best free agent who will take what the cap allows
      const pool = w.freeAgents.map(id => w.players[id]).filter(p => p && !p.retired && rightsOk(p, t.id)).sort((a, b) => playerValue(b) - playerValue(a));
      for (const best of pool.slice(0, 8)) {
        const want = Math.round((best.ask ?? marketSalary(best, capSeason(w))) * 0.9 / 5000) * 5000;
        const offer = Math.min(want, bestOffer(w, t.id, best, 1));
        if (offer >= want * 0.6 && signPlayer(w, best.id, t.id, Math.max(minSalary(capSeason(w), yos(best)), offer), 1).ok) break;
      }
    }
  }
  // unsigned free agents come down in price as the season goes on
  if (dayNum(w.season.day) % 14 === 0) for (const id of w.freeAgents) { const p = w.players[id]; if (p?.ask) p.ask = Math.max(minSalary(capSeason(w), yos(p)), Math.round(p.ask * 0.88 / 5000) * 5000); }
  // AI trade proposal to the user, roughly every 3 weeks, before the deadline
  if (w.season.phase === 'regular' && w.season.day <= TRADE_DEADLINE(w.season.year)) {
    if (rng.chance(0.07)) aiProposeTrade(w);
    if (rng.chance(0.06)) aiAiTrades(w);
  }
}

/** What the coach currently wants (open request first, else the weakest area). */
export function coachNeed(w: World): { need: string; detail: string; key: string } {
  const r = openRequest(w);
  const d = r ? needDef(r.key) : worstNeed(w);
  return { need: d.need, detail: d.detail, key: d.key };
}

export function generateDailyMessages(w: World) {
  const S = w.season, user = w.meta.userTeam, team = w.teams[user];
  const coach = w.coaches[team.coach];
  const d = dayNum(S.day) - dayNum(S.games[0]?.date ?? S.day);
  const rng = stream(w.meta.seed, 'messages', S.day);
  // expire old offers
  for (const m of w.messages) if (!m.resolved && m.deadline && m.deadline < S.day) { m.resolved = true; }
  // coach acquisition request every ~5 weeks (measurable, with a target)
  checkCoachRequest(w);
  if (d > 0 && d % 35 === 7 && !openRequest(w)) {
    const dl = S.day <= TRADE_DEADLINE(S.year) ? TRADE_DEADLINE(S.year) : addD(S.day, 30);
    makeCoachRequest(w, dl);
  }
  // owner check-in monthly
  if (d > 0 && d % 30 === 15) {
    const pace = team.w / Math.max(1, team.w + team.l) * 82;
    const exp = w.owner.expectedWins;
    w.owner.satisfaction = clamp(w.owner.satisfaction + (pace - exp) * 0.4, 0, 100);
    const tone = pace >= exp + 4 ? 'I like what I\'m seeing.' : pace >= exp - 3 ? 'We\'re roughly where I expected.' : 'This is below what I expected.';
    addMessage(w, { date: S.day, from: w.owner.name, role: 'Owner', subject: `Owner check-in: on pace for ${Math.round(pace)} wins`, body: `${tone} I expected about ${exp} wins. ${w.owner.objective}`, urgent: pace < exp - 6 ? 2 : 1, tag: 'Owner', actions: [{ label: 'Acknowledge', cmd: 'dismiss' }] });
  }
  // trade deadline warning
  if (S.day === addD(TRADE_DEADLINE(S.year), -7)) addMessage(w, { date: S.day, from: 'League office', role: 'League', subject: 'Trade deadline in 7 days', body: `All trades must be completed by ${TRADE_DEADLINE(S.year)} (alpha rule assumption).`, urgent: 2, tag: 'League' });
  // agent: expiring good player wants to talk (once, mid-season)
  if (d === 60) {
    const exp = team.roster.map(id => w.players[id]).filter(p => p.contract && p.contract.years <= 1 && playerValue(p) > 55).sort((a, b) => playerValue(b) - playerValue(a))[0];
    if (exp) {
      exp.ask = marketSalary(exp, w.season.year + 1);
      addMessage(w, { date: S.day, from: `Agent for ${exp.name}`, role: 'Agent', subject: `${exp.name}'s agent wants to talk extension`, body: `${exp.name}'s deal is up after this season. His camp is looking for about ${fmt$(exp.ask)} a year. Salary figures before this save are reconstructed estimates.`,
        urgent: 2, tag: 'Agent', actions: [{ label: 'Offer extension', cmd: 'extend', arg: { pid: exp.id } }, { label: 'Not yet', cmd: 'dismiss' }] });
    }
  }
  // scouting: monthly reports narrow ranges on the user's top board
  if (d > 0 && d % 28 === 10) {
    const cls = w.draftClasses[String(S.year + 1)] ?? [];
    const board = cls.map(id => w.players[id]).filter(p => p?.scout).sort((a, b) => (b.scout!.pot.mid) - (a.scout!.pot.mid)).slice(0, 4 * w.scoutBudget);
    const pickN = w.scoutBudget + 1;
    const chosen = board.slice(0, 12).sort(() => rng.next() - 0.5).slice(0, pickN);
    chosen.forEach(p => scoutReport(w, p.id));
    if (chosen.length) addMessage(w, { date: S.day, from: 'Director of scouting', role: 'Scout', subject: `${chosen.length} new prospect reports`, body: `Reports filed on ${chosen.map(p => p.name).join(', ')}. Ranges narrow as we see more, but our department has its own blind spots.`, urgent: 0, tag: 'Scouting', actions: [{ label: 'Open board', cmd: 'goto', arg: 'draft' }] });
  }
  // morale: unhappy player (role vs expectation) → agent message
  if (d > 20 && d % 14 === 3) {
    for (const p of team.roster.map(id => w.players[id])) {
      const st = (p.stats ?? []).find(s => s.season === S.year && !s.playoffs);
      if (!st || st.g < 8) continue;
      const mpg = st.min / st.g;
      const rank = team.roster.map(id => playerValue(w.players[id])).filter(v => v > playerValue(p)).length;
      const expected = rank < 5 ? 30 : rank < 8 ? 20 : 10;
      p.morale = clamp((p.morale ?? 60) + (mpg - expected) * 0.6 + (team.w - team.l) * 0.1, 0, 100);
      if ((p.morale ?? 60) < 28 && (p.traits.ego ?? 50) > 55 && !w.messages.some(m => m.subject.includes(p.name) && !m.resolved)) {
        addMessage(w, { date: S.day, from: `Agent for ${p.name}`, role: 'Agent', subject: `${p.name} is unhappy with his role`, body: `${p.name} is averaging ${mpg.toFixed(1)} minutes and feels he's earned more. (In this universe: a simulated reaction, not a claim about the real player.)`,
          urgent: 2, tag: 'Agent', actions: [{ label: 'Ask coach about minutes', cmd: 'coachReq', arg: { pid: p.id, kind: 'more' } }, { label: 'Explore a trade', cmd: 'goto', arg: 'trade' }, { label: 'Ask for patience', cmd: 'patience', arg: { pid: p.id } }] });
        break;
      }
    }
  }
}
const addD = (d: string, n: number) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// ------------------------------------------------------------------ owner review & offseason contracts
export function ownerSeasonReview(w: World) {
  const team = w.teams[w.meta.userTeam];
  const exp = w.owner.expectedWins;
  const champion = w.season.champion === team.id;
  const delta = team.w - exp;
  w.owner.satisfaction = clamp(w.owner.satisfaction + delta * 1.2 + (champion ? 25 : 0), 0, 100);
  const s = w.owner.satisfaction;
  let body = `We won ${team.w} games against an expectation of about ${exp}. `;
  body += s >= 70 ? 'I\'m very pleased. Keep building.' : s >= 45 ? 'Acceptable, but I expect progress next season.' : s >= 25 ? 'That was a disappointing year. Consider this a warning.' : 'This isn\'t working.';
  w.gmRep = clamp(w.gmRep + delta * 0.5 + (champion ? 10 : 0), 0, 100);
  if (w.meta.mode === 'career' && s < 18 && w.owner.patience < 60) {
    w.meta.fired = true;
    openJobMarket(w);
    body += ' I\'m making a change at general manager.';
    addMessage(w, { date: w.season.day, from: w.owner.name, role: 'Owner', subject: 'You have been fired', body, urgent: 3, tag: 'Owner', actions: [{ label: 'Find a new job', cmd: 'jobs' }, { label: 'Continue here in sandbox mode', cmd: 'sandbox' }] });
  } else addMessage(w, { date: w.season.day, from: w.owner.name, role: 'Owner', subject: 'End-of-season review', body, urgent: 1, tag: 'Owner' });
}

/** Start of the offseason: a season of service is added, contracts roll a year, options come due, and every expiring
 *  player enters free agency (his team keeps his Bird rights and a cap hold; first-round rookie-scale players can be made
 *  restricted with a qualifying offer). */
export function resolveExpiring(w: World) {
  const user = w.meta.userTeam;
  const season = capSeason(w);
  const R = capRules(season);
  rollDeadMoney(w);
  for (const t of Object.values(w.teams)) {
    for (const id of [...t.roster]) {
      const p = w.players[id];
      if (!p) continue;
      (p as any).birdYears = birdYears(p) + 1;
      const c = p.contract;
      if (!c) continue;
      if (c.fresh) { delete c.fresh; continue; } // signed this summer: starts next season
      (p as any).prevSalary = c.salary;
      rollContract(c);
      if (c.years > 0) { const op = optionNow(c); if (op) optionDue(w, p, op.kind); continue; }
      t.roster = t.roster.filter(x => x !== id);
      p.team = null; p.contract = null;
      (p as any).bird = t.id; delete (p as any).renounced;
      p.ask = marketSalary(p, season);
      const qo = c.scale && season >= 1995 && !c.twoWay && (t.id === user || playerValue(p) >= 56);
      if (qo) { (p as any).rfa = { team: t.id, qo: qualifyingOffer(p, season) }; p.rosterStatus = `Restricted free agent (${t.abbr})`; }
      else p.rosterStatus = `Free agent (was ${t.abbr})`;
      if (!w.freeAgents.includes(id)) w.freeAgents.push(id);
      if (t.id === user) {
        const level = birdLevel(p, user, season);
        addMessage(w, { date: w.season.day, from: `Agent for ${p.name}`, role: 'Agent', subject: `${p.name} is a ${qo ? 'restricted ' : ''}free agent`, urgent: 2, tag: 'Agent',
          body: `His camp wants about ${fmt$(p.ask)} a year.${R.hasCap ? ` We hold ${level ? BIRD_LABEL[level] : 'no Bird rights'}${level === 'full' ? ', so we can go over the cap to keep him' : ''}. His cap hold counts against our room until he signs or we renounce him.` : ''}${qo ? ` We have tendered a ${fmt$((p as any).rfa.qo)} qualifying offer: we can match any offer sheet he signs.` : ''} Other teams can bid from the first day of free agency.`,
          actions: [{ label: 'Make an offer', cmd: 'extend', arg: { pid: id } }, ...(qo ? [{ label: 'Withdraw qualifying offer', cmd: 'withdrawQO', arg: { pid: id } }] : []), { label: 'Renounce him', cmd: 'letGo', arg: { pid: id } }] });
      }
    }
  }
  faState(w);
  addMessage(w, { date: w.season.day, from: 'League office', role: 'League', subject: 'Free agency is open', body: `Thirty days of free agency start now.${season >= 1999 ? ' Deals can be agreed at once but only become official when the moratorium lifts on July 6.' : ''} Make offers from the Front Office; players weigh every offer before choosing. ${R.label} for ${season}–${String(season + 1).slice(2)}; see Finances for your cap sheet.`, urgent: 1, tag: 'League', actions: [{ label: 'Free agents', cmd: 'goto', arg: 'fa' }] });
}
/** An option year comes due: players opt out when the market pays more; AI teams keep useful players; the user decides. */
function optionDue(w: World, p: Player, kind: 'player' | 'team') {
  const c = p.contract!;
  const season = capSeason(w);
  const market = marketSalary(p, season);
  const t = w.teams[p.team!];
  if (kind === 'player') {
    const out = market > c.salary * 1.12 && (p.age ?? 30) < 33;
    if (out) { declineOption(w, p.id); if (t.id === w.meta.userTeam) addMessage(w, { date: w.season.day, from: `Agent for ${p.name}`, role: 'Agent', subject: `${p.name} opts out`, body: `He declined his ${fmt$(c.salary)} player option to test free agency. We keep his Bird rights.`, urgent: 2, tag: 'Agent', actions: [{ label: 'Make an offer', cmd: 'extend', arg: { pid: p.id } }] }); }
    else { exerciseOption(w, p.id); if (t.id === w.meta.userTeam) addMessage(w, { date: w.season.day, from: `Agent for ${p.name}`, role: 'Agent', subject: `${p.name} picks up his option`, body: `He exercised his ${fmt$(c.salary)} player option for ${season}–${String(season + 1).slice(2)}.`, urgent: 0, tag: 'Agent' }); }
    return;
  }
  if (t.id === w.meta.userTeam) {
    c.opts!.find(o => o.idx === 0)!.pending = true;
    addMessage(w, { date: w.season.day, from: 'Front office', role: 'GM', subject: `Team option: ${p.name}`, urgent: 3, tag: 'Decision',
      body: `${p.name}'s ${season}–${String(season + 1).slice(2)} season is a team option at ${fmt$(c.salary)} (his market value is about ${fmt$(market)}). Exercise it to keep him on those terms, or decline and he becomes a free agent${capRules(season).hasCap ? ' (we keep his Bird rights)' : ''}.`,
      actions: [{ label: 'Exercise the option', cmd: 'exerciseOption', arg: { pid: p.id } }, { label: 'Decline it', cmd: 'declineOption', arg: { pid: p.id } }] });
    return;
  }
  if (market >= c.salary * 0.85 || (c.scale && playerValue(p) >= 50)) exerciseOption(w, p.id); else declineOption(w, p.id);
}

/** Run free agency to the end of July for everyone (the user's open decisions take the default answer). */
export function aiFreeAgency(w: World) {
  finishFreeAgency(w);
}

export function teamPayrollSummary(w: World, tid: string) {
  const pay = payroll(w, tid);
  return { pay, budget: w.teams[tid].payrollBudget ?? pay, strength: teamStrength(w, tid) };
}
export { projectedWins };
setMarketAsk((w, p) => marketSalary(p, capSeason(w)));
