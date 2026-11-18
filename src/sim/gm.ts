// GM layer: front-office commands, AI GM behaviour, owner, agents, coach requests (GDD §8, §11, §12, §15).
import type { ClockState, Player, Team, World } from './types';
import { clamp, sigmoid, stream } from './rng';
import { coachRespond, playerValue } from './coach';
import { addEvent, addMessage, addNews, potentialOvr, projectedWins, teamStrength } from './world';
import { executeTradeBetween, aiProposeTrade, aiAiTrades } from './trade';
import type { TradeOffer } from './trade';
import { openJobMarket } from './jobs';
import { $y } from './history';
import { checkCoachRequest, makeCoachRequest, openRequest, worstNeed, needDef } from './needs';

export const TRADE_DEADLINE = (year: number) => `${year + 1}-02-15`; // alpha assumption, not a verified 1977 rule
export const fmt$ = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(2)}m` : `$${Math.round(n / 1000)}k`;
export const payroll = (w: World, tid: string) => w.teams[tid].roster.reduce((s, id) => s + (w.players[id]?.contract?.salary ?? 0), 0);

// ------------------------------------------------------------------ valuation (F13 / F22)
export function clockWeights(c: ClockState | undefined) {
  return c === 'Win Now' ? { now: 0.85, fut: 0.15 } : c === 'Contending' ? { now: 0.65, fut: 0.35 } : c === 'Building' ? { now: 0.45, fut: 0.55 } : { now: 0.3, fut: 0.7 };
}
/** Unsigned late-round picks are only available to the team holding their rights. */
export const rightsOk = (p: Player, tid: string) => !(p.rosterStatus ?? '').startsWith('Draft rights held by') || p.draftedBy === tid;
export function marketSalary(p: Player): number {
  const v = playerValue(p), a = p.age ?? 27;
  let s = Math.exp(10.9 + 0.085 * (v - 48));
  if (a >= 32) s *= 0.8; if (a <= 22) s *= 0.9;
  return $y(clamp(s, 30000, 700000));
}
export { assetValue, pickValue, evaluateTrade, staffRead, aiMargin, tradeLegal, executeTradeBetween } from './trade';
export type { TradeOffer, PickRef, TradeReply } from './trade';

export function executeTrade(w: World, offer: TradeOffer) {
  const desc = executeTradeBetween(w, w.meta.userTeam, offer.other, offer.give, offer.get, offer.givePicks, offer.getPicks);
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

export function signPlayer(w: World, pid: string, tid: string, salary: number, years: number) {
  const p = w.players[pid];
  if (p.team) { const old = w.teams[p.team]; old.roster = old.roster.filter(x => x !== pid); }
  w.freeAgents = w.freeAgents.filter(x => x !== pid);
  p.team = tid; w.teams[tid].roster.push(pid);
  p.contract = { salary, years, known: null, provenance: 'Signed in this save (simulated)', signed: w.season.day };
  p.rosterStatus = 'Signed';
  addEvent(w, 'signing', `${tid} signed ${p.name} (${fmt$(salary)} × ${years})`, [pid]);
  if (tid === w.meta.userTeam) checkCoachRequest(w);
  if (playerValue(p) > 58) addNews(w, `${w.teams[tid].name} sign ${p.name}`, `${years}-year deal, terms ${fmt$(salary)}/yr (simulated).`, 'transactions');
}

export function releasePlayer(w: World, pid: string) {
  const p = w.players[pid];
  const t = w.teams[p.team!];
  t.roster = t.roster.filter(x => x !== pid);
  p.team = null; p.ask = Math.round(marketSalary(p) * 0.8 / 5000) * 5000; p.contract = null; p.rosterStatus = `Waived by ${t.abbr}`;
  w.freeAgents.push(pid);
  addEvent(w, 'release', `${t.abbr} waived ${p.name}`, [pid]);
}

// ------------------------------------------------------------------ coach requests (user → coach, never direct control)
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
    const truth = k === 'now' ? p.ovr : potentialOvr(p);
    const biasKept = s.mid - truth > 0 ? Math.min(3, (s.mid - truth) * 0.4) : Math.max(-3, (s.mid - truth) * 0.4);
    const target = truth + biasKept;
    const half = (s.hi - s.lo) / 2;
    s.mid = Math.round(s.mid + (target - s.mid) * 0.4 + rng.normal(0, 1.5));
    const nh = Math.max(k === 'now' ? 3 : 5, half * 0.75);
    s.lo = Math.round(s.mid - nh); s.hi = Math.round(s.mid + nh); s.reports++;
  }
}

// ------------------------------------------------------------------ daily AI + message generation
const dayNum = (d: string) => Math.floor(new Date(d + 'T12:00:00Z').getTime() / 86400000);

export function aiDailyMoves(w: World) {
  const rng = stream(w.meta.seed, 'ai', w.season.day);
  for (const t of Object.values(w.teams)) {
    if (t.id === w.meta.userTeam) continue;
    const healthy = t.roster.filter(id => !(w.players[id].injury && w.players[id].injury!.daysLeft > 3)).length;
    if (t.roster.length < 10 || (healthy < 9 && t.roster.length < 12)) {
      const best = w.freeAgents.map(id => w.players[id]).filter(p => p && !p.retired && rightsOk(p, t.id)).sort((a, b) => playerValue(b) - playerValue(a))[0];
      if (best) signPlayer(w, best.id, t.id, Math.max($y(30000), Math.round((best.ask ?? marketSalary(best)) * 0.9 / 5000) * 5000), 1);
    }
  }
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
      exp.ask = marketSalary(exp);
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

export function resolveExpiring(w: World) {
  const user = w.meta.userTeam;
  const rng = stream(w.meta.seed, 'offseason', w.season.year);
  for (const t of Object.values(w.teams)) {
    for (const id of [...t.roster]) {
      const p = w.players[id];
      if (!p.contract) continue;
      p.contract.years--;
      if (p.contract.years > 0) continue;
      p.ask = marketSalary(p);
      if (t.id === user) {
        addMessage(w, { date: w.season.day, from: `Agent for ${p.name}`, role: 'Agent', subject: `${p.name} is a free agent unless re-signed`, body: `His camp wants about ${fmt$(p.ask)} a year. If we don't re-sign him before the season, he'll test the market.`,
          urgent: 2, tag: 'Agent', actions: [{ label: 'Offer contract', cmd: 'extend', arg: { pid: id } }, { label: 'Let him go', cmd: 'letGo', arg: { pid: id } }] });
        continue;
      }
      const keep = playerValue(p) > 52 && (p.age ?? 30) < 33 && rng.chance(0.7);
      if (keep) p.contract = { salary: p.ask, years: rng.int(1, 3), known: null, provenance: 'Re-signed in this save (simulated)', signed: w.season.day };
      else { t.roster = t.roster.filter(x => x !== id); p.team = null; p.contract = null; w.freeAgents.push(id); p.rosterStatus = `Free agent (was ${t.abbr})`; }
    }
  }
  addMessage(w, { date: w.season.day, from: 'League office', role: 'League', subject: 'Free agency is open', body: 'Re-sign your players, sign free agents and draft picks, then start the new season from the Front Office.', urgent: 1, tag: 'League', actions: [{ label: 'Open Front Office', cmd: 'goto', arg: 'office' }] });
}

export function aiFreeAgency(w: World) {
  const rng = stream(w.meta.seed, 'fa', w.season.year);
  const order = Object.values(w.teams).filter(t => t.id !== w.meta.userTeam).sort(() => rng.next() - 0.5);
  for (let pass = 0; pass < 4; pass++) for (const t of order) {
    if (t.roster.length >= 12) continue;
    const pool = w.freeAgents.map(id => w.players[id]).filter(p => p && !p.retired && rightsOk(p, t.id)).sort((a, b) => playerValue(b) - playerValue(a));
    const p = pool[Math.floor(rng.next() * Math.min(3, pool.length))];
    if (p && (t.roster.length < 11 || playerValue(p) > 50)) signPlayer(w, p.id, t.id, Math.max($y(30000), p.ask ?? marketSalary(p)), rng.int(1, 3));
  }
  // trim to 12
  for (const t of order) while (t.roster.length > 12) {
    const worst = t.roster.map(id => w.players[id]).sort((a, b) => playerValue(a) - playerValue(b))[0];
    releasePlayer(w, worst.id);
  }
}

export function teamPayrollSummary(w: World, tid: string) {
  const pay = payroll(w, tid);
  return { pay, budget: w.teams[tid].payrollBudget ?? pay, strength: teamStrength(w, tid) };
}
export { projectedWins };
