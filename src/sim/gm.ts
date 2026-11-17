// GM layer: front-office commands, AI GM behaviour, owner, agents, coach requests (GDD §8, §11, §12, §15).
import type { ClockState, Player, Team, World } from './types';
import { clamp, sigmoid, stream } from './rng';
import { coachRespond, playerValue } from './coach';
import { addEvent, addMessage, addNews, potentialOvr, projectedWins, teamStrength } from './world';

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
  return Math.round(clamp(s, 30000, 700000) / 5000) * 5000;
}
export function tradeValue(w: World, p: Player, forTeam: string): number {
  const t = w.teams[forTeam];
  const { now, fut } = clockWeights(t.clock);
  const v = playerValue(p);
  const age = p.age ?? 27;
  const pot = age <= 25 ? Math.max(v, potentialOvr(p)) : v - Math.max(0, age - 29) * 1.8;
  const base = now * v + fut * pot;
  const surplus = p.contract ? (marketSalary(p) - p.contract.salary) / 40000 : 0;
  const inj = p.injury && p.injury.daysLeft > 30 ? -3 : 0;
  // convex: stars are worth far more than several role players
  return Math.max(0, Math.pow(Math.max(0, base - 40), 1.75) / 6 + surplus + inj);
}
export function pickValue(w: World, season: number, round: number, original: string, forTeam: string): number {
  const proj = projectedWins(w)[original] ?? 41;
  const { fut } = clockWeights(w.teams[forTeam].clock);
  const base = round === 1 ? 14 + (41 - proj) * 0.55 : round === 2 ? 4 : 0.6;
  return Math.max(0.3, base * (0.6 + fut) * (season > w.season.year + 1 ? 0.85 : 1));
}

export interface TradeOffer { other: string; give: string[]; get: string[]; givePicks: { season: number; round: number; original: string }[]; getPicks: { season: number; round: number; original: string }[]; }

export function evaluateTrade(w: World, offer: TradeOffer): { accept: boolean; margin: number; reason: string; legal: string | null } {
  const user = w.meta.userTeam;
  const U = w.teams[user], O = w.teams[offer.other];
  // legality
  if (w.season.phase === 'regular' && w.season.day > TRADE_DEADLINE(w.season.year)) return { accept: false, margin: 0, reason: 'The trade deadline has passed.', legal: 'deadline' };
  if (w.season.phase === 'playoffs') return { accept: false, margin: 0, reason: 'No trades during the playoffs.', legal: 'playoffs' };
  const uAfter = U.roster.length - offer.give.length + offer.get.length, oAfter = O.roster.length - offer.get.length + offer.give.length;
  if (uAfter > 13 || oAfter > 13) return { accept: false, margin: 0, reason: 'That would leave a roster over the limit (12 + 1 temporary).', legal: 'roster' };
  if (uAfter < 8 || oAfter < 8) return { accept: false, margin: 0, reason: 'That would leave a team with too few players.', legal: 'roster' };
  if (!offer.give.length && !offer.givePicks.length) return { accept: false, margin: 0, reason: 'You need to offer something.', legal: 'empty' };
  const theyGet = offer.give.reduce((s, id) => s + tradeValue(w, w.players[id], O.id), 0) + offer.givePicks.reduce((s, p) => s + pickValue(w, p.season, p.round, p.original, O.id), 0);
  const theyGive = offer.get.reduce((s, id) => s + tradeValue(w, w.players[id], O.id), 0) + offer.getPicks.reduce((s, p) => s + pickValue(w, p.season, p.round, p.original, O.id), 0);
  // payroll friction for the AI side (owner budget)
  const dPay = offer.give.reduce((s, id) => s + (w.players[id].contract?.salary ?? 0), 0) - offer.get.reduce((s, id) => s + (w.players[id].contract?.salary ?? 0), 0);
  const payPen = Math.max(0, payroll(w, O.id) + dPay - (O.payrollBudget ?? 1e9)) / 60000;
  const friction = 1.5 + offer.give.length * 0.4; // AI GMs need a reason to change their roster
  const margin = theyGet - theyGive - payPen - friction;
  const rng = stream(w.meta.seed, 'negotiation', w.season.day, offer.other, offer.give.join(','), offer.get.join(','));
  const accept = margin > 0 && rng.chance(sigmoid(margin * 0.6 + 0.8));
  const gm = O.gm.split(' ').slice(-1)[0];
  let reason: string;
  if (accept) reason = `${gm}: "You've got a deal."`;
  else if (margin > -3) reason = `${gm}: "Close, but not quite. Add a little more and we can talk."`;
  else if (payPen > 2) reason = `${gm}: "Our owner won't take on that salary."`;
  else reason = `${gm}: "That doesn't work for us."`;
  return { accept, margin, reason, legal: null };
}

export function executeTrade(w: World, offer: TradeOffer) {
  const user = w.meta.userTeam;
  const U = w.teams[user], O = w.teams[offer.other];
  for (const id of offer.give) { U.roster = U.roster.filter(x => x !== id); O.roster.push(id); w.players[id].team = O.id; }
  for (const id of offer.get) { O.roster = O.roster.filter(x => x !== id); U.roster.push(id); w.players[id].team = user; }
  const movePick = (from: Team, to: Team, pk: { season: number; round: number; original: string }) => {
    const p = from.picks.find(x => x.season === pk.season && x.round === pk.round && x.original === pk.original);
    if (p) { from.picks = from.picks.filter(x => x !== p); to.picks.push({ ...p, owner: to.id }); }
  };
  offer.givePicks.forEach(pk => movePick(U, O, pk));
  offer.getPicks.forEach(pk => movePick(O, U, pk));
  const desc = `${U.abbr} trade ${[...offer.give.map(id => w.players[id].name), ...offer.givePicks.map(p => `${p.season} R${p.round} (${p.original})`)].join(', ') || 'nothing'} to ${O.abbr} for ${[...offer.get.map(id => w.players[id].name), ...offer.getPicks.map(p => `${p.season} R${p.round} (${p.original})`)].join(', ') || 'nothing'}`;
  w.tradeHistory.unshift({ date: w.season.day, text: desc });
  addEvent(w, 'trade', desc, [...offer.give, ...offer.get]);
  addNews(w, 'Trade', desc + '.', 'transactions');
  // incumbent reaction / coach trust: trading away a coach's starter without his input dents trust a little
  const coach = w.coaches[U.coach];
  if (offer.give.some(id => playerValue(w.players[id]) > 66)) coach.trustGM = clamp((coach.trustGM ?? 55) - 3, 0, 100);
}

// ------------------------------------------------------------------ signing / release / extension
export function playerAccepts(w: World, p: Player, tid: string, salary: number, years: number): { ok: boolean; text: string } {
  const ask = p.ask ?? marketSalary(p);
  const team = w.teams[tid];
  const winPct = team.w + team.l > 0 ? team.w / (team.w + team.l) : (projectedWins(w)[tid] ?? 41) / 82;
  const roleRank = team.roster.map(id => playerValue(w.players[id])).filter(v => v > playerValue(p)).length;
  const role = roleRank < 5 ? 1 : roleRank < 8 ? 0.4 : -0.4;
  const yearsPref = (p.age ?? 27) >= 30 ? (years >= 2 ? 0.4 : -0.3) : years >= 3 ? 0.15 : 0;
  const money = (salary - ask) / Math.max(25000, ask * 0.15);
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
      if (best) signPlayer(w, best.id, t.id, Math.max(30000, Math.round((best.ask ?? marketSalary(best)) * 0.9 / 5000) * 5000), 1);
    }
  }
  // AI trade proposal to the user, roughly every 3 weeks, before the deadline
  if (w.season.phase === 'regular' && w.season.day <= TRADE_DEADLINE(w.season.year) && rng.chance(0.05)) aiProposeTrade(w, rng);
}

function aiProposeTrade(w: World, rng: ReturnType<typeof stream>) {
  const user = w.teams[w.meta.userTeam];
  const others = Object.values(w.teams).filter(t => t.id !== user.id);
  const O = others[Math.floor(rng.next() * others.length)];
  // they want one of the user's players that fits their clock; they offer value they rate slightly lower
  const targets = user.roster.map(id => w.players[id]).filter(p => !p.injury).sort((a, b) => tradeValue(w, b, O.id) - tradeValue(w, a, O.id)).slice(1, 6);
  if (!targets.length) return;
  const want = targets[Math.floor(rng.next() * targets.length)];
  const wv = tradeValue(w, want, O.id);
  const theirs = O.roster.map(id => w.players[id]).filter(p => !p.injury).sort((a, b) => tradeValue(w, b, O.id) - tradeValue(w, a, O.id));
  let offerP = theirs.find(p => { const v = tradeValue(w, p, O.id); return v < wv * 0.95 && v > wv * 0.55; });
  if (!offerP) return;
  const ask = `${O.gm} (${O.city}) is offering ${offerP.name} for ${want.name}.`;
  addMessage(w, { date: w.season.day, from: O.gm, role: 'GM', subject: `Trade offer: ${offerP.name} for ${want.name}`, body: ask + ` Your scouts' view: ${offerP.name} (${offerP.pos}, ${offerP.age}) — ${fmt$(offerP.contract?.salary ?? 0)} × ${offerP.contract?.years ?? 1}. Offer expires in a few days.`,
    urgent: 2, tag: 'Trade', deadline: new Date(dayNum(w.season.day) * 86400000 + 4 * 86400000).toISOString().slice(0, 10),
    actions: [{ label: 'Accept trade', cmd: 'acceptAiTrade', arg: { other: O.id, give: [want.id], get: [offerP.id] } }, { label: 'Open in trade finder', cmd: 'goto', arg: 'trade' }, { label: 'Decline', cmd: 'dismiss' }] });
}

export function coachNeed(w: World): { need: string; detail: string } {
  const team = w.teams[w.meta.userTeam];
  const ps = team.roster.map(id => w.players[id]);
  const all = Object.values(w.teams).flatMap(t => t.roster.map(id => w.players[id]));
  const avg = (arr: Player[], f: (p: Player) => number) => arr.reduce((s, p) => s + f(p), 0) / Math.max(1, arr.length);
  const top = (arr: Player[], f: (p: Player) => number, n: number) => [...arr].sort((a, b) => f(b) - f(a)).slice(0, n);
  const dims: { key: string; need: string; detail: string; f: (p: Player) => number; n: number }[] = [
    { key: 'rim', need: 'a rim protector', detail: 'We give up too much at the basket.', f: p => p.r.intD * 0.6 + p.r.blk * 0.4, n: 2 },
    { key: 'wing', need: 'a defensive forward', detail: 'Thin on wing defense behind the starters.', f: p => p.r.perD, n: 4 },
    { key: 'reb', need: 'a rebounder', detail: 'We are losing the glass.', f: p => p.r.dreb * 0.6 + p.r.oreb * 0.4, n: 3 },
    { key: 'pg', need: 'a steady ballhandler', detail: 'Too many turnovers when our guards sit.', f: p => p.r.handle * 0.5 + p.r.pass * 0.5, n: 2 },
    { key: 'score', need: 'more scoring off the bench', detail: 'The second unit can\'t score.', f: p => p.r.mid * 0.5 + p.r.ins * 0.5, n: 7 },
  ];
  let worst = dims[0], wz = 1e9;
  for (const d of dims) {
    const mine = avg(top(ps, d.f, d.n), d.f), league = avg(top(all.filter(Boolean), d.f, d.n * 22), d.f);
    const zz = mine - league;
    if (zz < wz) { wz = zz; worst = d; }
  }
  return { need: worst.need, detail: worst.detail };
}

export function generateDailyMessages(w: World) {
  const S = w.season, user = w.meta.userTeam, team = w.teams[user];
  const coach = w.coaches[team.coach];
  const d = dayNum(S.day) - dayNum(S.games[0]?.date ?? S.day);
  const rng = stream(w.meta.seed, 'messages', S.day);
  // expire old offers
  for (const m of w.messages) if (!m.resolved && m.deadline && m.deadline < S.day) { m.resolved = true; }
  // coach acquisition request every ~5 weeks (data-driven need)
  if (d > 0 && d % 35 === 7) {
    const n = coachNeed(w);
    addMessage(w, { date: S.day, from: coach.name, role: 'Coach', subject: `${coach.name.split(' ').slice(-1)[0]} wants ${n.need}`, body: `${n.detail} He'd like ${n.need} before the trade deadline. This is a request, not a demand — but he'll remember whether we listened.`,
      urgent: 2, tag: 'Coach request', deadline: TRADE_DEADLINE(S.year), actions: [{ label: 'Open trade finder', cmd: 'goto', arg: 'trade' }, { label: 'Discuss', cmd: 'coachDiscuss' }, { label: 'Not now', cmd: 'dismiss' }] });
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
    body += ' I\'m making a change at general manager.';
    addMessage(w, { date: w.season.day, from: w.owner.name, role: 'Owner', subject: 'You have been fired', body, urgent: 3, tag: 'Owner', actions: [{ label: 'Continue in sandbox mode', cmd: 'sandbox' }] });
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
    if (p && (t.roster.length < 11 || playerValue(p) > 50)) signPlayer(w, p.id, t.id, Math.max(30000, p.ask ?? marketSalary(p)), rng.int(1, 3));
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
