// Sign-and-trade: a team re-signs its own free agent with his Bird rights and trades him on at once, so he can join a club
// that has no cap room and the old club gets something back. Rules by era, as this game applies them:
//  - from the 1999 agreement on, and only in the offseason (free agency);
//  - 2005-2010: the new contract runs three to five seasons;
//  - 2011 on: three or four seasons, raises held to the non-Bird limit, and the receiving team is hard-capped at the apron
//    (the first apron from 2023): it cannot be above it once the deal is done;
//  - the player has to want the destination; salary matching applies to both teams as in any trade.
import type { Player, World } from './types';
import { clamp, stream } from './rng';
import { playerValue } from './coach';
import { addEvent, addMessage, addNews } from './world';
import { capRules, capSeason, signingCheck, teamPayroll, tradeSalaryCheck, fmtM, maxSalary, minSalary, yos, capHolds } from './cap';
import { makeContract, maxRaise, maxFor, birdLevel, birdLimit } from './contracts';
import { executeTradeBetween, sideValue, assetValue, salaryMatch } from './trade';
import type { TradeOffer, PickRef } from './trade';
import { faState, offerUtility, offersFor } from './market';
import { rules, rosterCount, rosterLimit } from './rules';

export interface SignTrade { pid: string; from: string; salary: number; years: number; raise: number; virtual?: boolean }

export const satAllowed = (season: number) => season >= 1999;
export function satYears(season: number): [number, number] {
  if (season >= 2011) return [3, 4];
  if (season >= 2005) return [3, 5];
  return [1, capRules(season).maxYearsOwn];
}
export const satMaxRaise = (season: number) => (season >= 2011 ? maxRaise(season, false) : maxRaise(season, true));
/** The receiving team's ceiling after a sign-and-trade (null = none). */
export function satHardCap(season: number): number | null {
  const R = capRules(season);
  return season >= 2011 ? R.apron1 : null;
}
export const satRulesText = (season: number) => !satAllowed(season) ? 'Sign-and-trades arrive with the 1999 agreement.'
  : season >= 2011 ? `3 or 4 seasons, raises up to ${(satMaxRaise(season) * 100).toFixed(1)}%, and the receiving team must stay under the ${season >= 2023 ? 'first apron' : 'apron'} (${fmtM(satHardCap(season)!)}).`
  : season >= 2005 ? '3 to 5 seasons; salary matching applies.' : 'Any length his Bird rights allow; salary matching applies.';

/** Free agents a team could sign-and-trade right now (its own unsigned players with rights still held). */
export function satCandidates(w: World, tid: string): Player[] {
  if (w.season.phase !== 'freeagency' || !satAllowed(capSeason(w))) return [];
  return w.freeAgents.map(id => w.players[id]).filter(p => p && !p.retired && (p as any).bird === tid && (p as any).renounced !== tid && !faState(w).sheets[p.id]);
}
export function defaultTerms(w: World, p: Player, from: string): SignTrade {
  const season = capSeason(w);
  const [lo, hi] = satYears(season);
  const ask = Math.max(minSalary(season, yos(p)), Math.min(p.ask ?? 0, maxFor(p, from, season) ?? Infinity));
  return { pid: p.id, from, salary: Math.round(ask / 5000) * 5000, years: clamp((p.age ?? 27) >= 31 ? lo : 4, lo, hi), raise: Math.round(satMaxRaise(season) * 0.6 * 1000) / 1000 };
}

/** Run `fn` with the sign-and-trade player temporarily signed by his old team and placed in the deal. */
export function withSat<T>(w: World, offer: TradeOffer, fn: (o: TradeOffer) => T): T {
  const s = offer.sat!;
  const p = w.players[s.pid], F = w.teams[s.from];
  const saved = { team: p.team, contract: p.contract, roster: [...F.roster], fa: [...w.freeAgents] };
  p.team = s.from; if (!F.roster.includes(p.id)) F.roster.push(p.id);
  p.contract = makeContract(s.salary, s.years, { raise: s.raise });
  w.freeAgents = w.freeAgents.filter(x => x !== p.id);
  const u = w.meta.userTeam;
  try {
    return fn({ ...offer, give: s.from === u ? [...offer.give, p.id] : offer.give, get: s.from !== u ? [...offer.get, p.id] : offer.get, sat: { ...s, virtual: true } });
  } finally { p.team = saved.team; p.contract = saved.contract; F.roster = saved.roster; w.freeAgents = saved.fa; }
}

/** Would the player go along with it? He has to like the destination about as much as his best option. */
export function satConsent(w: World, p: Player, to: string, s: SignTrade): { ok: boolean; text: string } {
  const u = offerUtility(w, p, { team: to, first: s.salary, years: s.years, raise: s.raise, day: faState(w).day });
  const others = offersFor(w, p.id).filter(o => o.team !== to).map(o => offerUtility(w, p, o));
  const best = others.length ? Math.max(...others) : -1;
  if (u < -0.12) return { ok: false, text: `${p.name} doesn't want that deal: the money and years fall short of what he's after.` };
  if (u < best - 0.06) return { ok: false, text: `${p.name} prefers another offer he already has.` };
  return { ok: true, text: u > best + 0.05 ? `${p.name} wants this move.` : `${p.name} would accept the destination.` };
}

/** Sign-and-trade specific rules (era, terms, the sender's rights, the receiver's hard cap, the player's consent). */
export function signTradeCheck(w: World, offer: TradeOffer): string | null {
  const s = offer.sat!;
  const season = capSeason(w);
  const p = w.players[s.pid];
  const u = w.meta.userTeam;
  const to = s.from === u ? offer.other : u;
  if (!satAllowed(season)) return 'Sign-and-trades arrive with the 1999 agreement.';
  if (w.season.phase !== 'freeagency') return 'Sign-and-trades happen in the offseason, during free agency.';
  if (!p || p.team || (p as any).bird !== s.from || (p as any).renounced === s.from) return `${w.teams[s.from].abbr} no longer hold his rights.`;
  const [lo, hi] = satYears(season);
  if (s.years < lo || s.years > hi) return `A sign-and-trade contract must run ${lo === hi ? lo : `${lo} to ${hi}`} seasons in this era.`;
  if (s.raise > satMaxRaise(season) + 1e-9) return `Raises in a sign-and-trade are capped at ${(satMaxRaise(season) * 100).toFixed(1)}%.`;
  const chk = signingCheck(w, s.from, p, s.salary, s.years, { skipRoster: true });
  if (!chk.ok) return `${w.teams[s.from].abbr} can't sign him on those terms: ${chk.reason}`;
  const cap = satHardCap(season);
  if (cap) {
    const inSal = s.salary + (to === u ? offer.get : offer.give).reduce((a, id) => a + (w.players[id]?.contract?.salary ?? 0), 0);
    const outSal = (to === u ? offer.give : offer.get).reduce((a, id) => a + (w.players[id]?.contract?.salary ?? 0), 0);
    const after = teamPayroll(w, to) - outSal + inSal;
    if (after > cap) return `${w.teams[to].name} would be ${fmtM(after - cap)} over the ${season >= 2023 ? 'first apron' : 'apron'} after a sign-and-trade, which is not allowed.`;
  }
  const c = satConsent(w, p, to, s);
  if (!c.ok) return c.text;
  return null;
}

/** How much the old team still values a free agent it is about to lose: not much if he has better offers elsewhere. */
export function satDiscount(w: World, pid: string, from: string): number {
  const p = w.players[pid];
  const others = offersFor(w, pid).filter(o => o.team !== from);
  return others.length ? 0.3 : playerValue(p) >= 70 ? 0.6 : 0.45;
}

/** Make it happen: he signs with the old team (Bird rights) and is traded on in the same transaction. */
export function doSignTrade(w: World, s: SignTrade, to: string, fromGives: string[], toGives: string[], fromPicks: PickRef[], toPicks: PickRef[]): string {
  const p = w.players[s.pid], F = w.teams[s.from];
  w.freeAgents = w.freeAgents.filter(x => x !== p.id);
  p.team = s.from; if (!F.roster.includes(p.id)) F.roster.push(p.id);
  p.contract = makeContract(s.salary, s.years, { raise: s.raise, signed: w.season.day, provenance: 'Sign-and-trade (simulated)' });
  delete (p as any).bird; delete (p as any).rfa; delete (p as any).renounced;
  const Fa = faState(w); delete Fa.offers[p.id]; delete Fa.decideAt[p.id];
  for (const m of w.messages) if (!m.resolved && m.role === 'Agent' && m.subject.startsWith(p.name)) m.resolved = true;
  const desc = executeTradeBetween(w, s.from, to, [p.id, ...fromGives], toGives, fromPicks, toPicks);
  addEvent(w, 'signing', `Sign-and-trade: ${s.from} re-signed ${p.name} (${fmtM(s.salary)} × ${s.years}) and sent him to ${to}`, [p.id]);
  addNews(w, `Sign-and-trade: ${p.name} to ${w.teams[to].name}`, `${F.name} re-sign ${p.name} (${fmtM(s.salary)} × ${s.years}) and send him to ${w.teams[to].city}. ${desc}.`, 'transactions');
  return desc;
}

/** Players the receiving team would send back to make salaries match: the least valuable that do the job. */
function matchingPieces(w: World, to: string, from: string, inSal: number): string[] | null {
  const R = capRules(capSeason(w));
  const pay = teamPayroll(w, to) + capHolds(w, to);
  if (pay + inSal <= R.cap) return null; // a team with the room would just sign him
  // keep the core (top four); send the most salary per unit of value first, up to four players
  const roster = w.teams[to].roster.map(id => w.players[id]).filter(p => p?.contract && !p.contract.twoWay).sort((a, b) => playerValue(b) - playerValue(a));
  const cands = roster.slice(4).sort((a, b) => b.contract!.salary / Math.max(1, playerValue(b) - 40) - a.contract!.salary / Math.max(1, playerValue(a) - 40));
  const pick: string[] = []; let out = 0;
  for (const c of cands) {
    if (!tradeSalaryCheck(w, to, out, inSal) || pick.length >= 4) break;
    pick.push(c.id); out += c.contract!.salary;
  }
  return tradeSalaryCheck(w, to, out, inSal) ? null : pick;
}

/** AI clubs over the cap chase a free agent who wants them through a sign-and-trade (a few a summer at most). */
export function aiSignAndTrades(w: World, log: string[]) {
  const F = faState(w);
  const season = capSeason(w);
  if (!satAllowed(season) || F.day < 2) return;
  const rng = stream(w.meta.seed, 'sat', F.year, F.day);
  const u = w.meta.userTeam;
  ((F as any).satProposals ??= {});
  const doneThisSummer: string[] = ((F as any).satTeams ??= []);
  if (doneThisSummer.length >= 6) return; // a handful a summer at most
  let tries = 0;
  const pool = w.freeAgents.map(id => w.players[id]).filter(p => p && !p.retired && playerValue(p) >= 68 && (p as any).bird && (p as any).renounced !== (p as any).bird && !F.sheets[p.id] && !(F as any).satProposals[p.id])
    .sort((a, b) => playerValue(b) - playerValue(a));
  for (const p of pool) {
    if (tries >= 2 || !rng.chance(0.4)) continue;
    const from = (p as any).bird as string;
    if (doneThisSummer.includes(from)) continue;
    const terms = defaultTerms(w, p, from);
    const lim = birdLevel(p, from, season) ? birdLimit(w, p, birdLevel(p, from, season)!, season) : null;
    if (lim != null) terms.salary = Math.min(terms.salary, lim);
    const dests = Object.values(w.teams).filter(t => t.id !== from && t.id !== u && !doneThisSummer.includes(t.id) && (t.clock === 'Win Now' || t.clock === 'Contending') && rosterCount(w, t.id) < rosterLimit(w)
      && !signingCheck(w, t.id, p, terms.salary, Math.min(terms.years, capRules(season).maxYearsOther)).ok);
    for (const t of dests.sort(() => rng.next() - 0.5).slice(0, 3)) {
      tries++;
      const back = matchingPieces(w, t.id, from, terms.salary);
      if (!back || !back.length) continue;
      const pick: PickRef[] = (t.picks ?? []).filter(x => x.round === 2 && x.season > w.season.year).slice(0, 1).map(x => ({ season: x.season, round: x.round, original: x.original }));
      // user-perspective offer when the user holds his rights; otherwise check the two AI clubs directly
      if (from === u) {
        const offer: TradeOffer = { other: t.id, give: [], get: back, givePicks: [], getPicks: pick, sat: terms };
        if (signTradeCheck(w, offer) || withSat(w, offer, o => salaryMatch(w, u, t.id, o.give, o.get))) continue;
        (F as any).satProposals[p.id] = offer;
        addMessage(w, { date: w.season.day, from: t.gm, role: 'GM', subject: `Sign-and-trade offer for ${p.name}`, urgent: 3, tag: 'Decision', deadline: `${w.season.year + 1}-07-${String(Math.min(31, F.day + 3)).padStart(2, '0')}`,
          body: `${p.name} wants to play in ${t.city}, but they have no cap room. ${t.gm.split(' ').slice(-1)[0]} proposes a sign-and-trade: we re-sign him at ${fmtM(terms.salary)} for ${terms.years} seasons and send him there for ${[...back.map(id => w.players[id].name), ...pick.map(x => `their ${x.season} 2nd-round pick`)].join(', ') || 'nothing'}. If we say no, he may simply sign elsewhere and we get nothing.`,
          actions: [{ label: 'Accept the sign-and-trade', cmd: 'satAccept', arg: { pid: p.id } }, { label: 'Turn it down', cmd: 'satDecline', arg: { pid: p.id } }] });
        log.push(`${t.name} proposed a sign-and-trade for ${p.name}.`);
        break;
      }
      // AI ↔ AI: same rules, checked with the user out of the picture
      const fake: TradeOffer = { other: t.id, give: [], get: back, givePicks: [], getPicks: pick, sat: terms };
      const legal = aiSatLegal(w, from, t.id, terms, back);
      if (legal) continue;
      const cons = satConsent(w, p, t.id, terms);
      if (!cons.ok) continue;
      const { getV } = sideValue(w, from, [], back, [], pick);
      if (getV <= assetValue(w, p, from) * satDiscount(w, p.id, from) * 0.5) continue;
      doSignTrade(w, terms, t.id, [], back, [], pick);
      doneThisSummer.push(from, t.id);
      void fake;
      break;
    }
  }
}
function aiSatLegal(w: World, from: string, to: string, s: SignTrade, back: string[]): string | null {
  const season = capSeason(w);
  const p = w.players[s.pid];
  const chk = signingCheck(w, from, p, s.salary, s.years, { skipRoster: true });
  if (!chk.ok) return chk.reason ?? 'no';
  const outSal = back.reduce((a, id) => a + (w.players[id]?.contract?.salary ?? 0), 0);
  const cap = satHardCap(season);
  if (cap && teamPayroll(w, to) - outSal + s.salary > cap) return 'hard cap';
  return tradeSalaryCheck(w, to, outSal, s.salary) ?? tradeSalaryCheck(w, from, s.salary, outSal);
}

/** The user answers an AI sign-and-trade proposal. */
export function answerSatProposal(w: World, pid: string, accept: boolean): string {
  const F = faState(w);
  const offer = (F as any).satProposals?.[pid] as TradeOffer | undefined;
  if (!offer) return 'That proposal is gone.';
  delete (F as any).satProposals[pid];
  if (!accept) return `We turned down the sign-and-trade for ${w.players[pid].name}.`;
  const bad = signTradeCheck(w, offer) ?? withSat(w, offer, o => salaryMatch(w, w.meta.userTeam, offer.other, o.give, o.get));
  if (bad) return `It can't be done any more: ${bad}`;
  doSignTrade(w, offer.sat!, offer.other, offer.give, offer.get, offer.givePicks, offer.getPicks);
  return `Done: ${w.players[pid].name} signed and traded to ${w.teams[offer.other].name}.`;
}
export { maxSalary, rules };
