// Trades (F13/F22): every front office values players through its OWN eyes (noisy beliefs), its clock,
// its positional needs, roster spots and contracts. No one is omniscient, and nobody accepts just anything.
import type { Player, World } from './types';
import { $y } from './history';
import { clamp, sigmoid, stream } from './rng';
import { playerValue } from './coach';
import { potentialOvr, projectedWins, addEvent, addNews, addMessage } from './world';
import { clockWeights, marketSalary, payroll, fmt$, TRADE_DEADLINE } from './gm';
import { staffSd, unitErr, sdFor } from './needs';

export interface PickRef { season: number; round: number; original: string }
export interface TradeOffer { other: string; give: string[]; get: string[]; givePicks: PickRef[]; getPicks: PickRef[]; }

// ------------------------------------------------------------------ GM personalities and patience
export interface GmProfile { max: number; regen: number; tough: number; style: string }
/** Every GM is different: how much haggling he tolerates, how fast he cools off, how hard he bargains. */
export function gmProfile(w: World, tid: string): GmProfile {
  const r = stream(w.meta.seed, 'gmprofile', tid);
  const max = Math.round(50 + r.next() * 50), regen = Math.round(7 + r.next() * 17), tough = Math.round((0.82 + r.next() * 0.45) * 100) / 100;
  const style = tough > 1.12 ? (max < 70 ? 'Hard-nosed and short-fused' : 'Hard-nosed but patient') : max < 65 ? 'Quick to hang up' : regen > 18 ? 'Easygoing' : 'Even-tempered';
  return { max, regen, tough, style };
}
interface PatienceState { cur: number; day: string; closedUntil?: string; lastSig?: string }
const dayN = (d: string) => Math.floor(new Date(d + 'T12:00:00Z').getTime() / 86400000);
/** Current patience (regenerates by the day). */
export function patience(w: World, tid: string): PatienceState & { max: number } {
  const P = ((w as any).gmPatience ??= {}) as Record<string, PatienceState>;
  const prof = gmProfile(w, tid);
  const st = P[tid] ??= { cur: prof.max, day: w.season.day };
  const days = dayN(w.season.day) - dayN(st.day);
  if (days > 0) { st.cur = Math.min(prof.max, st.cur + days * prof.regen); st.day = w.season.day; }
  if (st.closedUntil && w.season.day >= st.closedUntil) st.closedUntil = undefined;
  return Object.assign(st, { max: prof.max }) as any;
}
export function phoneOpen(w: World, tid: string): { open: boolean; text?: string } {
  const st = patience(w, tid);
  const gm = w.teams[tid].gm.split(' ').slice(-1)[0];
  if (st.closedUntil) {
    const deadlineDay = w.season.phase === 'regular' && w.season.day === TRADE_DEADLINE(w.season.year);
    return { open: false, text: deadlineDay ? `${gm}'s line is closed for the rest of the day.` : `${gm} isn't taking your calls. Try again around ${st.closedUntil}.` };
  }
  return { open: true };
}

const conv = (b: number) => Math.pow(Math.max(0, b - 40), 2.1) / 10;
const group = (p: Player) => (p.pos === 'PG' || p.pos === 'SG' ? 'G' : p.pos === 'SF' ? 'W' : 'B');
const SLOTS: Record<string, number> = { G: 3.5, W: 2, B: 3.5 };

/** A team's belief about a player's current value. Own players: exact. Others: team-specific, persistent error. */
export function believedOvr(w: World, p: Player, viewer: string): number {
  if (p.team === viewer) return playerValue(p);
  if (viewer === w.meta.userTeam) return playerValue(p) + unitErr(w, p.id) * sdFor(w, p);
  const sd = p.sampleMin > 1500 ? 2.8 : p.sampleMin > 400 ? 4 : 6;
  return playerValue(p) + stream(w.meta.seed, 'belief', viewer, p.id).normal(0, sd);
}

/** Value of one player to `forTeam` on the convex value scale, given a believed current overall. */
export function assetValue(w: World, p: Player, forTeam: string, ovr = believedOvr(w, p, forTeam)): number {
  const t = w.teams[forTeam];
  const { now, fut } = clockWeights(t.clock);
  const age = p.age ?? 27;
  const pot = age <= 25 ? Math.max(ovr, potentialOvr(p) + (ovr - playerValue(p))) : ovr - Math.max(0, age - 29) * 1.8;
  let v = conv(now * ovr + fut * pot);
  if (p.contract) {
    const yrs = Math.max(1, Math.min(3, p.contract.years));
    v += (marketSalary(p) - p.contract.salary) / $y(30000) * yrs * 0.5;
  }
  if (p.injury && p.injury.daysLeft > 0) v *= 1 - Math.min(0.5, p.injury.daysLeft / 200);
  return Math.max(0, v);
}

export function pickValue(w: World, pk: PickRef, forTeam: string): number {
  const proj = projectedWins(w)[pk.original] ?? 41;
  const { fut } = clockWeights(w.teams[forTeam].clock);
  const eq = pk.round === 1 ? 53 + (41 - proj) * 0.4 : pk.round === 2 ? 47 : 42;
  const later = pk.season > w.season.year + 1 ? 0.85 : 1;
  return Math.max(0.3, conv(eq) * (0.55 + fut) * later);
}

/** Positional fit: thin groups make an incoming player worth more, crowded groups less. */
function needMult(w: World, teamId: string, rosterAfter: string[], p: Player) {
  const top9 = rosterAfter.map(id => w.players[id]).filter(Boolean).sort((a, b) => playerValue(b) - playerValue(a)).slice(0, 9);
  const g = group(p);
  const count = top9.filter(x => group(x) === g && x.id !== p.id).length;
  return clamp(1 + 0.08 * (SLOTS[g] - count), 0.85, 1.22);
}
/** Consolidation: the second and third pieces of a package matter less than the first. */
function packageSum(vals: number[]) {
  const W = [1, 0.8, 0.62, 0.5, 0.4, 0.35];
  return [...vals].sort((a, b) => b - a).reduce((s, v, i) => s + v * (W[i] ?? 0.3), 0);
}

/** How team `tid` values a deal in which it gives `gives` (+picks) and receives `gets` (+picks). */
export function sideValue(w: World, tid: string, gives: string[], gets: string[], givePicks: PickRef[], getPicks: PickRef[]) {
  const t = w.teams[tid];
  const after = [...t.roster.filter(id => !gives.includes(id)), ...gets];
  const inV = gets.map(id => assetValue(w, w.players[id], tid) * needMult(w, tid, after, w.players[id]));
  const outV = gives.map(id => assetValue(w, w.players[id], tid));
  let getV = packageSum(inV) + getPicks.reduce((s, p) => s + pickValue(w, p, tid), 0);
  const giveV = packageSum(outV) + givePicks.reduce((s, p) => s + pickValue(w, p, tid), 0);
  // a body over the 12-man limit means waiving someone they like
  if (after.length > 12) {
    const worst = after.map(id => w.players[id]).sort((a, b) => playerValue(a) - playerValue(b)).slice(0, after.length - 12);
    getV -= worst.reduce((s, p) => s + assetValue(w, p, tid) * 0.7, 0);
  }
  return { getV, giveV };
}

export function tradeLegal(w: World, offer: TradeOffer): string | null {
  const S = w.season;
  const U = w.teams[w.meta.userTeam], O = w.teams[offer.other];
  if (S.phase === 'regular' && S.day > TRADE_DEADLINE(S.year)) return 'The trade deadline has passed.';
  if (S.phase === 'playoffs') return 'No trades during the playoffs.';
  if (S.phase === 'draft') return 'Trades are frozen during the draft.';
  const uAfter = U.roster.length - offer.give.length + offer.get.length, oAfter = O.roster.length - offer.get.length + offer.give.length;
  if (uAfter > 13 || oAfter > 13) return 'That would leave a roster over the limit (12 + 1 temporary).';
  if (uAfter < 8 || oAfter < 8) return 'That would leave a team with too few players.';
  if (!offer.give.length && !offer.givePicks.length) return 'You need to offer something.';
  if (!offer.get.length && !offer.getPicks.length) return 'Ask for something in return.';
  return null;
}

/** The other GM's true margin (their beliefs, needs, budget, appetite for change). */
export function aiMargin(w: World, offer: TradeOffer) {
  const O = w.teams[offer.other];
  const { getV, giveV } = sideValue(w, O.id, offer.get, offer.give, offer.getPicks, offer.givePicks);
  const dPay = offer.give.reduce((s, id) => s + (w.players[id].contract?.salary ?? 0), 0) - offer.get.reduce((s, id) => s + (w.players[id].contract?.salary ?? 0), 0);
  const payPen = Math.max(0, payroll(w, O.id) + dPay - (O.payrollBudget ?? 1e9)) / $y(40000);
  const friction = (2 + giveV * 0.06) * gmProfile(w, O.id).tough;
  return { margin: getV - giveV - payPen - friction, getV, giveV, payPen };
}

export interface TradeReply { accept: boolean; margin: number; reason: string; legal: string | null; closed?: boolean; counter?: { give?: string; givePick?: PickRef; drop?: string; label: string } }

export function evaluateTrade(w: World, offer: TradeOffer): TradeReply {
  const legal = tradeLegal(w, offer);
  if (legal) return { accept: false, margin: 0, reason: legal, legal };
  const O = w.teams[offer.other];
  const gm = O.gm.split(' ').slice(-1)[0];
  const phone = phoneOpen(w, O.id);
  if (!phone.open) return { accept: false, margin: 0, reason: phone.text!, legal: null, closed: true };
  const st = patience(w, O.id);
  const prof = gmProfile(w, O.id);
  const { margin, giveV, payPen } = aiMargin(w, offer);
  const scale = Math.max(10, giveV);
  const rel = margin / scale;
  const sig = [offer.give, offer.get, offer.givePicks.map(p => p.season + '' + p.round + p.original), offer.getPicks.map(p => p.season + '' + p.round + p.original)].map(x => [...x].sort().join(',')).join('|');
  const rng = stream(w.meta.seed, 'negotiation', w.season.day, offer.other, sig, Math.round(st.cur));
  const accept = margin > 0 && rng.chance(sigmoid(rel * 7 + 0.9 + (st.cur / prof.max - 0.5)));
  if (accept) { st.lastSig = sig; return { accept, margin, reason: `${gm}: "You've got a deal."`, legal: null }; }
  // every call costs patience — insulting or repeated offers cost a lot more
  const cost = 6 + clamp(-rel * 45, 0, 40) + (st.lastSig === sig ? 14 : 0);
  st.cur -= cost; st.lastSig = sig;
  const deadlineDay = w.season.phase === 'regular' && w.season.day === TRADE_DEADLINE(w.season.year);
  if (st.cur <= 0) {
    st.cur = Math.max(st.cur, -20);
    const back = deadlineDay ? addD(w.season.day, 1) : addD(w.season.day, Math.max(2, Math.ceil((prof.max * 0.4 - st.cur) / prof.regen)));
    st.closedUntil = back;
    return { accept: false, margin, legal: null, closed: true, reason: deadlineDay ? `${gm}: "We're done for today." (He won't take your calls again before the deadline passes.)` : `${gm}: "I've heard enough. Call me in a few days." (Line closed until ${back}.)` };
  }
  const mood = st.cur / prof.max;
  const tone = (calm: string, short: string) => mood > 0.45 ? calm : short;
  // close? propose the smallest change that gets it done: add one of yours, or take one of theirs off the table
  if (rel > -0.45) {
    const U = w.teams[w.meta.userTeam];
    const opts: { give?: string; givePick?: PickRef; drop?: string; label: string; m: number }[] = [];
    const ok = (o: TradeOffer) => !tradeLegal(w, o);
    for (const id of U.roster) if (!offer.give.includes(id)) {
      const o = { ...offer, give: [...offer.give, id] }; const m = aiMargin(w, o).margin;
      if (m > 0.08 * scale && ok(o)) opts.push({ give: id, label: `add ${w.players[id].name}`, m });
    }
    for (const pk of U.picks.filter(p => p.season > w.season.year && p.round <= 2)) {
      const ref = { season: pk.season, round: pk.round, original: pk.original };
      if (offer.givePicks.some(x => x.season === ref.season && x.round === ref.round && x.original === ref.original)) continue;
      const o = { ...offer, givePicks: [...offer.givePicks, ref] }; const m = aiMargin(w, o).margin;
      if (m > 0.08 * scale) opts.push({ givePick: ref, label: `add your ${ref.season} ${ref.round === 1 ? '1st' : '2nd'}-round pick${ref.original !== U.id ? ` (from ${ref.original})` : ''}`, m });
    }
    if (offer.get.length > 1 || offer.getPicks.length) for (const id of offer.get) {
      const o = { ...offer, get: offer.get.filter(x => x !== id) }; const m = aiMargin(w, o).margin;
      if (m > 0.08 * scale && ok(o)) opts.push({ drop: id, label: `leave ${w.players[id].name} out of it`, m });
    }
    // prefer the change that leaves them only a little ahead (they still want to win the deal)
    const best = opts.sort((a, b) => a.m - b.m)[0];
    if (best) return { accept: false, margin, legal: null, reason: `${gm}: "${tone('Close. ', 'Look — ')}${best.label[0].toUpperCase() + best.label.slice(1)} and we have a deal."`, counter: { give: best.give, givePick: best.givePick, drop: best.drop, label: best.label } };
    return { accept: false, margin, legal: null, reason: `${gm}: "${tone("We're close, but I don't see the piece that gets it done.", "Close isn't good enough. Bring me something real.")}"` };
  }
  if (payPen > 2) return { accept: false, margin, legal: null, reason: `${gm}: "Our owner won't take on that salary."` };
  return { accept: false, margin, legal: null, reason: rel < -1.2 ? `${gm}: "${tone('Is this a joke? No.', "Don't waste my time.")}"` : `${gm}: "${tone("That doesn't work for us.", "No. And my patience is running thin.")}"` };
}

/** Our staff's read of a deal: point estimate, uncertainty band, and a guess at the other side's appetite. */
export function staffRead(w: World, offer: TradeOffer) {
  const u = w.meta.userTeam;
  const sd = offer.get.length ? offer.get.reduce((a, id) => a + sdFor(w, w.players[id]), 0) / offer.get.length : staffSd(w);
  const calc = (shift: number) => {
    const U = w.teams[u];
    const after = [...U.roster.filter(id => !offer.give.includes(id)), ...offer.get];
    const inV = offer.get.map(id => { const p = w.players[id]; return assetValue(w, p, u, believedOvr(w, p, u) + shift * sdFor(w, p)) * needMult(w, u, after, p); });
    const outV = offer.give.map(id => assetValue(w, w.players[id], u));
    let g = packageSum(inV) + offer.getPicks.reduce((s, p) => s + pickValue(w, p, u), 0) * (1 + shift * sd / 25);
    const o = packageSum(outV) + offer.givePicks.reduce((s, p) => s + pickValue(w, p, u), 0);
    if (after.length > 12) g -= after.map(id => w.players[id]).sort((a, b) => playerValue(a) - playerValue(b)).slice(0, after.length - 12).reduce((s, p) => s + assetValue(w, p, u) * 0.7, 0);
    return { g, o, net: g - o };
  };
  const mid = calc(0), lo = calc(-1), hi = calc(1);
  const scale = Math.max(10, (mid.g + mid.o) / 2);
  const rel = mid.net / scale, relLo = lo.net / scale, relHi = hi.net / scale;
  const verdict = relLo > 0.12 ? 'Clear win for us' : rel > 0.12 ? 'Likely a win for us' : rel > -0.12 ? 'Close to even' : relHi < -0.12 ? 'Clear overpay' : 'Likely an overpay';
  // appetite of the other side, as our staff guesses it
  let odds: string | null = null;
  if (!tradeLegal(w, offer)) {
    const { margin, giveV } = aiMargin(w, offer);
    const noise = stream(w.meta.seed, 'readOdds', offer.other, offer.give.join(','), offer.get.join(','), w.season.day).normal(0, 0.12 * Math.max(10, giveV) * sd / 4);
    const m = (margin + noise) / Math.max(10, giveV);
    odds = m > 0.15 ? 'They should say yes' : m > -0.05 ? 'Toss-up' : m > -0.4 ? 'They will want more' : 'No chance';
  }
  return { net: mid.net, lo: lo.net, hi: hi.net, rel, relLo, relHi, scale, verdict, odds, sd, ourIn: mid.g, ourOut: mid.o };
}

// ------------------------------------------------------------------ execution (any two teams)
export function executeTradeBetween(w: World, aId: string, bId: string, aGives: string[], bGives: string[], aPicks: PickRef[], bPicks: PickRef[]) {
  const A = w.teams[aId], B = w.teams[bId];
  for (const id of aGives) { A.roster = A.roster.filter(x => x !== id); B.roster.push(id); w.players[id].team = B.id; }
  for (const id of bGives) { B.roster = B.roster.filter(x => x !== id); A.roster.push(id); w.players[id].team = A.id; }
  const move = (from: typeof A, to: typeof A, pk: PickRef) => {
    const p = from.picks.find(x => x.season === pk.season && x.round === pk.round && x.original === pk.original);
    if (p) { from.picks = from.picks.filter(x => x !== p); to.picks.push({ ...p, owner: to.id }); }
  };
  aPicks.forEach(pk => move(A, B, pk)); bPicks.forEach(pk => move(B, A, pk));
  const lbl = (ids: string[], pks: PickRef[]) => [...ids.map(id => w.players[id].name), ...pks.map(p => `${p.season} R${p.round} pick${p.original !== (pks === aPicks ? aId : bId) ? ` (${p.original})` : ''}`)].join(', ') || 'nothing';
  const desc = `${A.abbr} trade ${lbl(aGives, aPicks)} to ${B.abbr} for ${lbl(bGives, bPicks)}`;
  w.tradeHistory.unshift({ date: w.season.day, text: desc });
  addEvent(w, 'trade', desc, [...aGives, ...bGives]);
  addNews(w, 'Trade', desc + '.', 'transactions');
  return desc;
}

// ------------------------------------------------------------------ AI → user proposals (they try to win the deal, a little)
export function aiProposeTrade(w: World) {
  const rng = stream(w.meta.seed, 'aiprop', w.season.day);
  const user = w.teams[w.meta.userTeam];
  const others = Object.values(w.teams).filter(t => t.id !== user.id);
  const O = others[Math.floor(rng.next() * others.length)];
  const want = user.roster.map(id => w.players[id]).filter(p => !p.injury)
    .map(p => ({ p, v: assetValue(w, p, O.id) * needMult(w, O.id, [...O.roster, p.id], p) })).sort((a, b) => b.v - a.v).slice(1, 7);
  if (!want.length) return;
  const target = want[Math.floor(rng.next() * want.length)].p;
  const theirs = O.roster.map(id => w.players[id]).filter(p => !p.injury);
  const picks: PickRef[] = O.picks.filter(p => p.season > w.season.year && p.round <= 2).map(p => ({ season: p.season, round: p.round, original: p.original }));
  const combos: { get: string[]; getPicks: PickRef[] }[] = [];
  for (const a of theirs) {
    combos.push({ get: [a.id], getPicks: [] });
    for (const pk of picks.slice(0, 3)) combos.push({ get: [a.id], getPicks: [pk] });
    for (const b of theirs) if (b.id > a.id) combos.push({ get: [a.id, b.id], getPicks: [] });
  }
  let best: { offer: TradeOffer; m: number } | null = null;
  for (const c of combos) {
    // from the AI's chair: they give c, they get target
    const offer: TradeOffer = { other: O.id, give: [target.id], get: c.get, givePicks: [], getPicks: c.getPicks };
    if (tradeLegal(w, offer)) continue;
    const { margin, giveV } = aiMargin(w, offer);
    const lo = 0.04 * Math.max(10, giveV), hi = 0.2 * Math.max(10, giveV);
    if (margin > lo && margin < hi && (!best || margin < best.m)) best = { offer, m: margin };
  }
  if (!best) return;
  const o = best.offer;
  const names = (ids: string[], pks: PickRef[]) => [...ids.map(id => w.players[id].name), ...pks.map(p => `${p.season} R${p.round} pick`)].join(' + ');
  addMessage(w, { date: w.season.day, from: O.gm, role: 'GM', subject: `Trade offer from ${O.city}: ${names(o.get, o.getPicks)} for ${target.name}`,
    body: `${O.gm} (${O.city} ${O.name}, ${O.clock}) wants ${target.name}. The offer is on the table for a few days.`,
    urgent: 2, tag: 'Trade', deadline: addD(w.season.day, 4),
    actions: [{ label: 'Accept trade', cmd: 'acceptAiTrade', arg: { other: O.id, give: o.give, get: o.get, givePicks: o.givePicks, getPicks: o.getPicks } }, { label: 'Open in trade finder', cmd: 'tradeFinder', arg: { other: O.id, give: o.give, get: o.get, givePicks: o.givePicks, getPicks: o.getPicks } }, { label: 'Decline', cmd: 'dismiss' }] });
}

/** Occasional AI-to-AI deals: both sides must believe they win (their beliefs differ, so this happens). */
export function aiAiTrades(w: World) {
  const rng = stream(w.meta.seed, 'aiai', w.season.day);
  const ts = Object.values(w.teams).filter(t => t.id !== w.meta.userTeam);
  const A = ts[Math.floor(rng.next() * ts.length)], B = ts[Math.floor(rng.next() * ts.length)];
  if (A === B) return;
  const pa = A.roster.map(id => w.players[id]).filter(p => !p.injury).sort((a, b) => playerValue(b) - playerValue(a)).slice(2, 10);
  const pb = B.roster.map(id => w.players[id]).filter(p => !p.injury).sort((a, b) => playerValue(b) - playerValue(a)).slice(2, 10);
  for (const x of pa) for (const y of pb) {
    const a = sideValue(w, A.id, [x.id], [y.id], [], []), b = sideValue(w, B.id, [y.id], [x.id], [], []);
    const fa = 2 + a.giveV * 0.06, fb = 2 + b.giveV * 0.06;
    if (a.getV - a.giveV > fa && b.getV - b.giveV > fb) { executeTradeBetween(w, A.id, B.id, [x.id], [y.id], [], []); return; }
  }
}
const addD = (d: string, n: number) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
export { fmt$ };
