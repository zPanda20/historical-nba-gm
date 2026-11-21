// Dynasty Pressure, conflict and player empowerment (GDD §13, F19–F20).
// Status has two sources: performance (who is the best player, who gets the ball and the awards) and standing inside
// the building (tenure, homegrown, titles won here, leadership, friends in the room). When a newly arrived star leads
// on the first and an incumbent leads on the second, strain builds under title expectations. Winning makes people
// tolerate it; it does not erase it. Strain can boil into incidents the GM handles through the crisis workflow, and it
// weighs on options, trade requests and free agency. Nothing here is scheduled: no feud, exit or title is forced.
// From 2008, star players can also plan to team up; from 2013 that becomes more common, never universal.
import type { Player, Team, World } from './types';
import { clamp, sigmoid, stream } from './rng';
import { playerValue } from './coach';
import { addEvent, addMessage, addNews } from './world';
import { culture, motive, rel, trustIn } from './people';
import { capRoom } from './cap';
import { aiMoveUnhappyStars } from './trade';
import { tradeDeadline } from './rules';

const t$ = (p: Player, k: string) => p.traits[k] ?? 50;
const first = (n: string) => n.split(' ').slice(-1)[0];
const K = (a: string, b: string) => `${a}>${b}`;
const G = (w: World): Record<string, number[]> => ((w as any).rel ??= {});
function edge(w: World, a: string, b: string) { return G(w)[K(a, b)] ??= [50, 50, 50, 0, w.season.year]; }
const bump = (e: number[], i: number, d: number) => { e[i] = Math.round(clamp(e[i] + d, 0, 100) * 10) / 10; };
const tenure = (w: World, p: Player) => ((p as any).tenure?.team === p.team ? w.season.year - (p as any).tenure.since : 0);
const isUser = (w: World, tid: string | null | undefined) => tid === w.meta.userTeam;
const winPct = (t: Team) => (t.w + t.l ? t.w / (t.w + t.l) : 0.5);
const dayN = (d: string) => Math.floor(Date.parse(d + 'T12:00:00Z') / 86400000);

// ------------------------------------------------------------------ standing (GDD §13.1)
export interface Standing { perf: number; inst: number; label: string; years: number }
const HONOR = (a: string) => a === 'MVP' || a === 'Finals MVP' || a.startsWith('All-NBA');
export function standingOf(w: World, p: Player, ranked?: Player[]): Standing | null {
  const t = p.team ? w.teams[p.team] : null; if (!t) return null;
  ranked ??= t.roster.map(id => w.players[id]).filter(Boolean).sort((a, b) => playerValue(b) - playerValue(a));
  const r = ranked.indexOf(p);
  let perf = [1, 0.8, 0.62, 0.5, 0.4][r] ?? 0.25;
  for (const a of p.awards ?? []) if (a.season >= w.season.year - 2 && HONOR(a.award)) perf += a.award === 'MVP' ? 0.2 : 0.06;
  perf = Math.min(1.3, perf);
  const years = tenure(w, p), since = w.season.year - years;
  const titles = t.history.filter(h => h.result === 'Champion' && h.season >= since).length;
  let friends = 0;
  for (const id of t.roster) if (id !== p.id && (rel(w, id, p.id)?.[0] ?? 0) >= 66) friends++;
  const inst = Math.min(1, years / 6) * 0.5 + (p.draftedBy === t.id ? 0.2 : 0) + Math.min(0.3, titles * 0.12) + (culture(t)?.leaders.includes(p.id) ? 0.15 : 0) + Math.min(0.15, friends * 0.03);
  const label = perf >= 0.9 && inst >= 0.6 ? 'Franchise cornerstone' : perf >= 0.8 && years <= 2 ? 'Newcomer star' : perf >= 0.8 ? 'Best player'
    : inst >= 0.6 ? (p.draftedBy === t.id ? 'Homegrown leader' : 'Established leader') : perf >= 0.5 ? 'Core player' : 'Role player';
  return { perf, inst, label, years };
}

// ------------------------------------------------------------------ team state
interface Pair { n: string; i: string; strain: number; griev: number; inds: string[]; last?: string; since: number; kind?: 'arrival' | 'more' }
interface Dyn { pairs: Record<string, Pair>; log: { d: string; t: string }[]; exp: number }
export const dynOf = (t: Team): Dyn => ((t as any).dyn ??= { pairs: {}, log: [], exp: 0 });
export const INDICATOR: Record<string, string> = {
  leadership: 'Two claims to leadership', more: 'After winning, everyone wants more', recognition: 'The newcomer is getting the credit', usage: 'Competing for the ball', loyalty: 'The incumbent has allies in the room',
  contract: 'Contract uncertainty', alternatives: 'Other contenders are waiting', comparisons: 'Public comparisons', injuries: 'Injuries and blame', expectations: 'Title-or-bust expectations', trust: 'Doubts about management',
};
export function pressureWord(v: number) { return v >= 80 ? 'Breaking point' : v >= 65 ? 'High' : v >= 45 ? 'Building' : v >= 20 ? 'Simmering' : 'Calm'; }
export function teamPressure(t: Team) { return Math.max(0, ...Object.values(dynOf(t).pairs).map(p => p.strain)); }
/** Highest strain involving this player on his team. */
export function strainOf(w: World, p: Player): { strain: number; griev: number } {
  const t = p.team ? w.teams[p.team] : null; if (!t) return { strain: 0, griev: 0 };
  let s = 0, g = 0;
  for (const x of Object.values(dynOf(t).pairs)) if (x.n === p.id || x.i === p.id) { s = Math.max(s, x.strain); g = Math.max(g, x.griev); }
  return { strain: s, griev: g };
}

/** How much a title is expected of this team right now. */
function expectation(w: World, t: Team) {
  const h = t.history.slice(-2);
  if (h.some(x => x.result === 'Champion')) return 1;
  if (t.w + t.l >= 15 && winPct(t) >= 0.62) return 0.8;
  if (h.slice(-1)[0]?.result === 'Finals') return 0.8;
  if (h.slice(-1)[0] && h.slice(-1)[0].result !== 'Missed playoffs') return 0.45;
  return 0.2;
}

// ------------------------------------------------------------------ weekly (F19 strain, F20 incidents)
export function dynastyWeek(w: World) {
  const S = w.season;
  const leagueTop = new Set(Object.values(w.players).filter(p => p.team && !p.retired).sort((a, b) => playerValue(b) - playerValue(a)).slice(0, 15).map(p => p.id));
  for (const t of Object.values(w.teams)) {
    const D = dynOf(t);
    const ranked = t.roster.map(id => w.players[id]).filter(p => p && !p.contract?.twoWay).sort((a, b) => playerValue(b) - playerValue(a));
    const st = new Map(ranked.map(p => [p.id, standingOf(w, p, ranked)!]));
    const exp = D.exp = expectation(w, t);
    // pairs: a newly arrived star at the top, an incumbent with standing
    const newcomers = ranked.slice(0, 3).filter(p => playerValue(p) >= 78 && st.get(p.id)!.years <= 2 && p.draftedBy !== t.id);
    const incumbents = ranked.slice(0, 6).filter(p => playerValue(p) >= 70 && st.get(p.id)!.years >= 3 && st.get(p.id)!.inst >= 0.45);
    const live = new Set<string>();
    const r = stream(w.meta.seed, 'dynasty', S.day, t.id);
    const coach = w.coaches[t.coach], c = culture(t);
    // after a title, two stars who grew up together each want more: the ball, the credit, the money (Riley's "disease of more")
    const won = t.history.slice(-2).filter(h => h.result === 'Champion').length;
    const more: [Player, Player][] = [];
    if (won) { const top = ranked.slice(0, 3).filter(p => playerValue(p) >= 78 && st.get(p.id)!.years >= 2); for (let a = 0; a < top.length; a++) for (let b = a + 1; b < top.length; b++) more.push([top[a], top[b]]); }
    const cands: [Player, Player, 'arrival' | 'more'][] = [];
    for (const N of newcomers) for (const I of incumbents) if (N !== I && st.get(N.id)!.perf > st.get(I.id)!.perf) cands.push([N, I, 'arrival']);
    for (const [A, B] of more) cands.push([A, B, 'more']);
    for (const [N, I, kind] of cands) {
      const k = `${N.id}|${I.id}`; if (live.has(k)) continue; live.add(k);
      const P: Pair = D.pairs[k] ??= { n: N.id, i: I.id, strain: 0, griev: 0, inds: [], since: S.year, kind };
      P.kind = kind;
      const inds = [kind === 'more' ? 'more' : 'leadership'];
      let boost = 0;
      const lastAw = (p: Player) => (p.awards ?? []).some(a => a.season === S.year - 1 && (a.award === 'MVP' || a.award === 'Finals MVP' || a.award === 'All-NBA 1st'));
      if (lastAw(N) && !lastAw(I)) { inds.push('recognition'); boost += 0.3; }
      if (N.r.usage >= 60 && I.r.usage >= 55) { inds.push('usage'); boost += 0.2; }
      let allies = 0; for (const id of t.roster) if (id !== I.id && (rel(w, id, I.id)?.[0] ?? 0) >= 66) allies++;
      if (allies >= 2) { inds.push('loyalty'); boost += 0.15; }
      if ((N.contract?.years ?? 0) <= 1 || N.contract?.opts?.some(o => o.kind === 'player' && o.idx <= 1)) { inds.push('contract'); boost += 0.25; if (S.year >= 2008) { inds.push('alternatives'); boost += 0.1; } }
      if (leagueTop.has(N.id) && leagueTop.has(I.id)) { inds.push('comparisons'); boost += 0.15; }
      if ([N, I].some(p => (p.injury?.daysLeft ?? 0) > 7)) { inds.push('injuries'); boost += 0.2; }
      if (exp >= 0.8) inds.push('expectations');
      if ((trustIn(w, N.id, `org:${t.id}`) + trustIn(w, I.id, `org:${t.id}`)) / 2 < 50) { inds.push('trust'); boost += 0.15; }
      P.inds = inds;
      const amp = clamp(0.4 + (Math.max(t$(N, 'assert'), t$(I, 'assert')) - 50) / 100 + (Math.max(t$(N, 'ego'), t$(I, 'ego')) - 50) / 120 + (motive(N, 'status') + motive(I, 'status')) * 3, 0.3, 1.6);
      const tol = winPct(t) >= 0.7 ? 0.6 : winPct(t) >= 0.6 ? 0.8 : 1.1;
      // a homegrown core starts from shared history: its strain needs real ego and real credit gaps to grow
      const grow = 4 * amp * exp * (1 + boost) * tol * (kind === 'more' ? 0.55 + 0.25 * won + (amp > 1 ? 0.2 : 0) : 1);
      const ease = 1.2 + (coach?.communication ?? 55) / 80 + ((c?.uni ?? 55) - 55) / 30;
      P.strain = Math.round(clamp(P.strain + grow - ease + r.normal(0, 0.8), 0, 100) * 10) / 10;
      if (P.strain > 50) P.griev = Math.min(100, P.griev + (P.strain - 50) / 40); else P.griev = Math.max(0, P.griev - 0.15);
      // the room feels it, even when nothing is said out loud
      if (P.strain > 40) { bump(edge(w, N.id, I.id), 3, 0.8); bump(edge(w, I.id, N.id), 3, 1); }
      incident(w, t, P, N, I, r);
      if (isUser(w, t.id)) report(w, t, P, N, I);
      wantOut(w, t, P, N, r);
    }
    for (const k of Object.keys(D.pairs)) if (!live.has(k)) { const P = D.pairs[k]; P.strain = Math.max(0, P.strain - 6); if (P.strain <= 0 && P.griev < 5) delete D.pairs[k]; }
  }
  superteamTalk(w);
  if (S.phase === 'regular' && S.day <= tradeDeadline(S.year)) for (const d of aiMoveUnhappyStars(w)) addNews(w, 'Star traded', `${d}. He had asked out.`, 'transactions');
}

function closeLossThisWeek(w: World, t: Team) {
  const d0 = dayN(w.season.day) - 7;
  return w.season.games.some(g => g.played && dayN(g.date) >= d0 && (g.home === t.id || g.away === t.id) && g.hs != null && g.as != null
    && Math.abs(g.hs - g.as) <= 5 && ((g.home === t.id) !== (g.hs > g.as)));
}

function incident(w: World, t: Team, P: Pair, N: Player, I: Player, r: ReturnType<typeof stream>) {
  if (P.strain < 45 || (P.last && dayN(w.season.day) - dayN(P.last) < 35)) return;
  // one open crisis on the GM's desk at a time
  if (isUser(w, t.id) && w.messages.some(m => !m.resolved && m.actions?.some(a => a.cmd === 'crisis'))) return;
  const close = closeLossThisWeek(w, t);
  const h = clamp(0.04 + Math.max(0, P.strain - 60) / 150 + (close ? 0.08 : 0) + (Math.max(t$(N, 'assert'), t$(I, 'assert')) - 85) / 300 - (Math.min(t$(N, 'poise'), t$(I, 'poise')) - 60) / 400, 0, 0.4);
  if (!r.chance(h)) return;
  P.last = w.season.day;
  const hot = t$(I, 'assert') >= t$(N, 'assert') ? I : N, other = hot === I ? N : I;
  bump(edge(w, hot.id, other.id), 3, 15); bump(edge(w, other.id, hot.id), 3, 10); bump(edge(w, N.id, I.id), 0, -6); bump(edge(w, I.id, N.id), 0, -6);
  P.strain = Math.min(100, P.strain + 5);
  const what = close ? `after a disputed possession late in a close loss` : `at practice`;
  const pub = r.chance(clamp(0.3 + (P.inds.includes('comparisons') ? 0.2 : 0) + (t$(hot, 'assert') >= 95 ? 0.15 : 0), 0, 0.8));
  const D = dynOf(t);
  D.log.unshift({ d: w.season.day, t: `${hot.name} and ${other.name} clashed ${what}${pub ? ' (it became public)' : ''}` }); D.log.length = Math.min(D.log.length, 8);
  addEvent(w, 'dynasty_incident', `${hot.name} and ${other.name} clashed ${what}`, [hot.id, other.id]);
  if (pub) addNews(w, `Tension in ${t.city}`, `${hot.name} and ${other.name} had a heated exchange ${what}, according to people around the team. Both have since downplayed it.`, 'league');
  if (isUser(w, t.id)) {
    const coach = w.coaches[t.coach];
    addMessage(w, { date: w.season.day, from: coach?.name ?? 'Coach', role: 'Coach', subject: `${hot.name} and ${other.name} clashed`,
      body: `It happened ${what}. ${first(hot.name)} said something in front of the group and ${first(other.name)} didn't let it go. From what I can tell it isn't really about that play: ${P.kind === 'more' ? `since the title, both of them want it to be their team: more shots, more credit, the bigger contract.` : `${first(N.name)} is the best player on the floor, and ${first(I.name)} has been the heart of this team for years.`} ${pub ? 'It has reached the press. Publicly, both say it is nothing.' : 'It has stayed inside the building, for now.'} How do you want to handle it?`,
      urgent: 2, tag: 'Locker room', actions: [
        { label: 'Meet with both privately', cmd: 'crisis', arg: { n: N.id, i: I.id, how: 'meet' } },
        { label: 'Let the coach handle it', cmd: 'crisis', arg: { n: N.id, i: I.id, how: 'coach' } },
        { label: `Discipline ${first(hot.name)}`, cmd: 'crisis', arg: { n: N.id, i: I.id, how: 'discipline', who: hot.id } },
        { label: `Reassure ${first(N.name)}`, cmd: 'crisis', arg: { n: N.id, i: I.id, how: 'reassure', who: N.id } },
        { label: `Back ${first(I.name)}`, cmd: 'crisis', arg: { n: N.id, i: I.id, how: 'reassure', who: I.id } },
        { label: 'Ask the coach to rebalance roles', cmd: 'crisis', arg: { n: N.id, i: I.id, how: 'roles' } },
        { label: `Quietly explore trading ${first(I.name)}`, cmd: 'crisis', arg: { n: N.id, i: I.id, how: 'shop', who: I.id } },
      ] });
  } else {
    // AI teams: the coach and front office deal with it their own way
    const ok = r.chance(sigmoid(((w.coaches[t.coach]?.communication ?? 55) - 55) / 12));
    if (ok) P.strain = Math.max(0, P.strain - 18);
  }
}

/** Before anything blows up, a good coach tells you what he sees (incomplete, from his angle). */
function report(w: World, t: Team, P: Pair, N: Player, I: Player) {
  const mem = ((t as any).lr ??= {}) as Record<string, string>;
  const k = `dyn:${P.n}|${P.i}`;
  if (P.strain < 40 || (mem[k] && dayN(w.season.day) - dayN(mem[k]) < 120) || (mem.dynrep && dayN(w.season.day) - dayN(mem.dynrep) < 7)) return;
  mem[k] = mem.dynrep = w.season.day;
  const why = P.inds.filter(x => x !== 'leadership' && x !== 'expectations').slice(0, 2).map(x => INDICATOR[x].toLowerCase());
  addMessage(w, { date: w.season.day, from: w.coaches[t.coach]?.name ?? 'Coach', role: 'Coach', subject: `Something is building between ${first(N.name)} and ${first(I.name)}`,
    body: `Nothing has happened, and they're winning together. But ${P.kind === 'more' ? `winning changed things: ${first(N.name)} and ${first(I.name)} each think they're the reason, and each wants the team to reflect it.` : `${first(I.name)} built this team, and ${first(N.name)} is the one everyone talks about now.`} ${why.length ? `I'm seeing ${why.join(' and ')}. ` : ''}I'd rather you hear it from me now than from the papers later.`,
    urgent: 1, tag: 'Locker room', actions: [{ label: 'Open the locker room', cmd: 'goto', arg: 'roster:locker' }] });
}

/** Strain can make even a winner's star want out (only with real grievance, never on a timer). In a homegrown clash the
 *  one losing the status contest is likelier to ask; in an arrival clash it is the newcomer who feels it isn't his team. */
function wantOut(w: World, t: Team, P: Pair, N: Player, r: ReturnType<typeof stream>) {
  if (P.strain < 82 || P.griev < 25) return;
  const I = w.players[P.i];
  const who = P.kind === 'more' && I && t$(I, 'ego') + motive(I, 'status') * 300 >= t$(N, 'ego') - 10 ? I : N;
  if (!who || (who as any).wantsOut || trustIn(w, who.id, `org:${t.id}`) >= 66 || !r.chance(0.06)) return;
  (who as any).wantsOut = t.id;
  addEvent(w, 'trade_request', `${who.name} asked ${t.abbr} for a trade despite winning`, [who.id]);
  if (isUser(w, t.id)) addMessage(w, { date: w.season.day, from: `Agent for ${who.name}`, role: 'Agent', subject: `${who.name} wants out, winning or not`,
    body: `${first(who.name)} doesn't feel this is his team, and he doesn't believe that will change. He's asking to be moved. He'll keep competing. (In this universe: a simulated decision.)`,
    urgent: 2, tag: 'Agent', actions: [{ label: 'Explore a trade', cmd: 'tradeFinder', arg: { give: [who.id], get: [] } }, { label: 'Tell him no', cmd: 'refuseRequest', arg: { pid: who.id } }] });
  else addNews(w, `${who.name} wants out of ${t.city}`, `Despite the winning, ${who.name} has asked the ${t.name} to trade him, according to league sources.`, 'transactions');
}

/** The GM's choice in a dynasty crisis (GDD §13.3). No option is free; public words and private feelings can differ. */
export function crisis(w: World, nId: string, iId: string, how: string, who?: string): string {
  const N = w.players[nId], I = w.players[iId];
  if (!N || !I || N.team !== I.team || !N.team) return 'That has resolved itself: they are no longer teammates.';
  const t = w.teams[N.team], P = dynOf(t).pairs[`${nId}|${iId}`];
  const coach = w.coaches[t.coach];
  const r = stream(w.meta.seed, 'crisis', w.season.day, nId, iId, how);
  const gm = (p: Player) => edge(w, p.id, 'gm');
  const cool = (d: number) => { if (P) P.strain = clamp(P.strain + d, 0, 100); };
  const conf = (d: number) => { bump(edge(w, N.id, I.id), 3, d); bump(edge(w, I.id, N.id), 3, d); };
  const log = (s: string) => { const D = dynOf(t); D.log.unshift({ d: w.season.day, t: s }); D.log.length = Math.min(D.log.length, 8); };
  switch (how) {
    case 'meet': {
      const ok = r.chance(sigmoid((trustIn(w, N.id, 'gm') + trustIn(w, I.id, 'gm') - 100) / 30 + (w.gmRep - 50) / 40 + (t$(N, 'poise') + t$(I, 'poise') - 130) / 60 + 0.2));
      if (ok) { cool(-25); conf(-20); if (P) P.griev = Math.max(0, P.griev - 5); bump(gm(N), 2, 3); bump(gm(I), 2, 3); log('GM meeting cleared the air'); return `You got them in a room without the coaches. ${first(I.name)} said he needed to know this was still his team too; ${first(N.name)} said he came here to win, not to take anything from anyone. It won't fix everything, but they understand each other better.`; }
      cool(5); conf(-5); bump(gm(t$(N, 'ego') >= t$(I, 'ego') ? N : I), 2, -5); log('GM meeting did not land');
      return `The meeting went in circles. Both were polite. Neither moved. One of them left thinking you'd already picked a side.`;
    }
    case 'coach': {
      if (!coach) return 'There is no coach to hand it to.';
      const ok = r.chance(sigmoid((coach.communication - 55) / 12 + (coach.adaptability - 55) / 25));
      if (ok) { cool(-20); conf(-15); log(`${coach.name} handled it`); return `${coach.name} handled it his way: a film session, a hard practice, and a quiet word with each of them. The next week they were laughing on the bench.`; }
      cool(4); bump(edge(w, I.id, coach.id), 2, -5); log(`${coach.name} could not settle it`);
      return `${coach.name} tried. ${first(I.name)} feels the coach has fallen for the new star. The friction is still there, and now the coach is part of it.`;
    }
    case 'discipline': {
      const p = w.players[who ?? ''] ?? I;
      bump(gm(p), 2, -12); conf(-8); cool(-10);
      if (P) P.griev = Math.min(100, P.griev + (p === I ? 6 : 3));
      const c = culture(t); if (c) c.std = Math.min(99, c.std + 1);
      log(`${p.name} disciplined`);
      return `You fined ${first(p.name)} and made it clear that nobody is bigger than the team. The room respects the line you drew. ${first(p.name)} accepted it in public. In private he's angry, and he'll remember who drew it.`;
    }
    case 'reassure': {
      const p = w.players[who ?? ''] ?? N, o = p === N ? I : N;
      bump(gm(p), 2, 7); bump(gm(o), 2, -5);
      if (P) { P.griev = Math.min(100, P.griev + (o === I ? 6 : 2)); cool(o === I ? 2 : -6); }
      log(`GM reassured ${p.name}`);
      return `You told ${first(p.name)} he's the center of what you're building. He appreciated it. ${first(o.name)} heard about it within a day, and it changed how he looks at you.`;
    }
    case 'roles': {
      if (!coach) return 'There is no coach to ask.';
      const ok = r.chance(sigmoid((coach.adaptability - 55) / 15 - (coach.stubborn - 50) / 25 + ((coach.trustGM ?? 55) - 55) / 40));
      if (ok) { cool(-15); conf(-6); log('Roles rebalanced'); return `${coach.name} agreed to shift a few more actions toward ${first(I.name)} early in games and to close with ${first(N.name)}. Both can live with it, for now.`; }
      cool(2); log('Coach kept the roles as they are');
      return `${coach.name} heard you out and said no: the roles are where they are because that's how the team wins. It's his call. The problem is still yours.`;
    }
    case 'shop': {
      const p = w.players[who ?? ''] ?? I;
      if (r.chance(0.3)) { bump(gm(p), 2, -15); cool(10); addNews(w, `${t.city} gauging the market for ${p.name}`, `The ${t.name} have quietly asked around about ${p.name}, according to league sources.`, 'transactions'); log(`Trade talk about ${p.name} leaked`); return `It leaked. ${first(p.name)} found out from a reporter that you'd been asking around. Whatever you decide now, he knows.`; }
      log(`Quietly asked about trading ${p.name}`);
      return `You made a few discreet calls about ${first(p.name)}. Nothing has leaked. The trade screen is open if you want to go further.`;
    }
  }
  return '';
}

// ------------------------------------------------------------------ bonds across the league (feeds superteams)
const CLUB = /Basket|Madrid|Barcelona|\bFC\b|\bBC\b|\bKK\b|Mega|Virtus|W[uü]rzburg|Filathlitikos|Paris|CSKA|Partizan|Olympiacos|Panathinaikos|Maccabi|Baskonia|Unicaja|Joventut|Zalgiris|Cibona|Bayern|ASVEL|Fenerbahce|Efes|NBL|Breakers|Ratiopharm|Ulm|Lyon|Mets|Limoges|Pau-|Benetton|Treviso|Kinder|Bologna|Milano|Roma|Pesaro|Siena|Buducnost|Crvena|Union Olimpija|Estudiantes|Tau |Malaga|Valencia|Murcia|Andorra|Sevilla|Gran Canaria|Obradoiro|Zaragoza|Strasbourg|Nanterre|Cholet|Le Mans|Monaco|Hapoel|Galatasaray|Besiktas|Anadolu|Khimki|Lokomotiv|Unics|Zenit|Dynamo|Avtodor|Cedevita|Igokea|Mornar|FMP|Spartak/;
const usPath = (p: Player) => !!p.college && !CLUB.test(p.college);
const OLYMPICS = new Set([1992, 1996, 2000, 2004, 2008, 2012, 2016, 2021, 2024, 2028, 2032, 2036, 2040]);

/** Season's end: the league's best share All-Star weekends and All-NBA teams; Olympic summers forge real friendships. */
export function seasonBonds(w: World) {
  const y = w.season.year;
  const top = Object.values(w.players).filter(p => p.team && !p.retired).sort((a, b) => playerValue(b) - playerValue(a));
  const link = (a: Player, b: Player, d: number, note?: string) => {
    const e1 = edge(w, a.id, b.id), e2 = edge(w, b.id, a.id);
    const soc = (t$(a, 'social') + t$(b, 'social')) / 200;
    bump(e1, 0, d * (0.6 + soc)); bump(e2, 0, d * (0.6 + soc)); bump(e1, 1, d * 0.5); bump(e2, 1, d * 0.5); e1[4] = e2[4] = y;
    if (note) { const L: any[] = ((w as any).relNotes ??= []); L.unshift({ a: a.id, b: b.id, s: y, t: note }); if (L.length > 300) L.length = 300; }
  };
  const stars = top.slice(0, 24);
  for (let i = 0; i < stars.length; i++) for (let j = i + 1; j < stars.length; j++) link(stars[i], stars[j], 2);
  const games = y + 1;
  if (OLYMPICS.has(games)) {
    const team = top.filter(p => usPath(p) && (p.age ?? 30) <= 34).slice(0, 12);
    for (let i = 0; i < team.length; i++) for (let j = i + 1; j < team.length; j++) link(team[i], team[j], 9, i < 3 && j < 4 ? `${team[i].name} and ${team[j].name} were teammates on the ${games} Olympic team` : undefined);
    if (team.length) addNews(w, `${games} Olympic team named`, `Led by ${team.slice(0, 3).map(p => p.name).join(', ')}. Summers like this build friendships that outlast them.`, 'league');
  }
}

// ------------------------------------------------------------------ player-led superteams (GDD §13.4, §11.5)
interface Plan { id: string; summer: number; lead: string; members: string[]; dest?: string; status: 'talk' | 'formed' | 'failed'; userPitch?: boolean }
const plans = (w: World): Plan[] => ((w as any).superteams ??= []);
export const plansFor = (w: World, pid: string) => plans(w).filter(x => x.status === 'talk' && x.members.includes(pid));
function eraChance(y: number) { return y < 2008 ? 0 : y < 2013 ? 0.12 : 0.25; }
const expiring = (p: Player) => !!p.contract && (p.contract.years <= 1 || !!p.contract.opts?.some(o => o.kind === 'player' && o.idx === 1));

/** Around the All-Star break, stars heading for free agency may start talking about playing together. */
function superteamTalk(w: World) {
  const S = w.season, y = S.year;
  if (S.phase !== 'regular' || S.day < `${y + 1}-02-08` || eraChance(y) === 0) return;
  const done = ((w as any).stTalk ??= {}) as Record<string, boolean>;
  if (done[y]) return; done[y] = true;
  const r = stream(w.meta.seed, 'superteam', y);
  const pool = Object.values(w.players).filter(p => p.team && !p.retired && playerValue(p) >= 76).sort((a, b) => playerValue(b) - playerValue(a));
  const taken = new Set<string>();
  let n = 0;
  for (const S1 of pool) {
    if (n >= 2 || taken.has(S1.id) || playerValue(S1) < 80 || (S1.age ?? 30) < 23 || (S1.age ?? 30) > 32 || !expiring(S1)) continue;
    const f = (motive(S1, 'independence') + motive(S1, 'rings')) * 6 * (0.6 + t$(S1, 'social') / 125) * (winPct(w.teams[S1.team!]) < 0.6 ? 1.3 : 0.7);
    if (!r.chance(clamp(eraChance(y) * f, 0, 0.6))) continue;
    const friends = pool.filter(x => x !== S1 && !taken.has(x.id) && x.team !== S1.team && (rel(w, S1.id, x.id)?.[0] ?? 0) >= 62 && (rel(w, x.id, S1.id)?.[0] ?? 0) >= 58 && (expiring(x) || y >= 2013))
      .sort((a, b) => (rel(w, S1.id, b.id)?.[0] ?? 0) - (rel(w, S1.id, a.id)?.[0] ?? 0)).slice(0, 2);
    if (!friends.length) continue;
    const members = [S1, ...friends];
    members.forEach(p => taken.add(p.id));
    // a friend under contract becomes the destination: "come join me"
    const anchor = friends.find(x => !expiring(x));
    plans(w).push({ id: `st${y}-${S1.id}`, summer: y, lead: S1.id, members: members.map(p => p.id), status: 'talk' });
    n++;
    addEvent(w, 'superteam_talk', `${members.map(p => p.name).join(', ')} discussed teaming up`, members.map(p => p.id));
    if (r.chance(0.55)) addNews(w, `Talk of a team-up`, `${members.map(p => p.name).join(' and ')} have talked about playing together, according to people close to them. None has commented publicly.`, 'league');
    const u = w.meta.userTeam;
    if (members.some(p => p.team === u)) addMessage(w, { date: S.day, from: 'Front office', role: 'GM', subject: `${members.filter(p => p.team === u).map(p => p.name).join(' and ')} in team-up talks`,
      body: `Word is that ${members.map(p => p.name).join(', ')} want to play together${anchor ? ` in ${w.teams[anchor.team!].city}` : ''}. ${members.some(p => p.team === u && expiring(p)) ? 'Our player can walk this summer. Players are allowed to talk to each other; we are not allowed to talk to players under contract elsewhere.' : ''}`, urgent: 1, tag: 'League' });
  }
}

/** Which team a plan is aimed at, decided when free agency opens: a friend's team, or whoever has room for them. */
function resolveDest(w: World, P: Plan) {
  if (P.dest || P.status !== 'talk') return P.dest;
  const members = P.members.map(id => w.players[id]).filter(Boolean);
  let best = '', bv = -Infinity;
  for (const t of Object.values(w.teams)) {
    // who has to fit under the cap: free agents without Bird rights here (players under contract here are already in)
    const incoming = members.filter(p => p.team !== t.id && (p as any).bird !== t.id && (!p.contract || p.contract.years <= 0));
    const traded = members.filter(p => p.team && p.team !== t.id && p.contract && p.contract.years > 0);
    if (traded.length) continue; // a player under contract elsewhere can't get there in free agency
    const need = incoming.reduce((s, p) => s + (p.ask ?? 0), 0) * 0.75;
    const room = capRoom(w, t.id);
    if (incoming.length && room < need * 0.8) continue;
    const v = (room - need) / Math.max(1, need) * 0.5 + (culture(t)?.std ?? 55) / 50 + (members.length - incoming.length) * 0.8;
    if (v > bv) { bv = v; best = t.id; }
  }
  // nobody has the room: aim at one member's own team (he re-signs with Bird rights) and bring the others by sign-and-trade
  if (!best && w.season.year >= 1999) {
    const home = members.filter(p => (p as any).bird || p.team).sort((a, b) => playerValue(b) - playerValue(a))[0];
    const tid = home ? ((p => (p as any).bird ?? p.team)(home) as string) : '';
    if (tid && w.teams[tid] && !members.some(p => p.team && p.team !== tid && p.contract && p.contract.years > 0)) { best = tid; (P as any).sat = true; }
  }
  if (!best) {
    P.status = 'failed';
    if (members.length) addNews(w, 'Team-up talk fizzles', `No team had the room to bring ${members.map(p => p.name).join(' and ')} together. Each will make his own decision.`, 'transactions');
    return undefined;
  }
  P.dest = best;
  if (best === w.meta.userTeam) addMessage(w, { date: w.season.day, from: 'Front office', role: 'GM', subject: `${members.map(p => first(p.name)).join(' and ')} have their eyes on us`,
    body: `Their camp has let it be known: ${members.map(p => p.name).join(', ')} want to play together, and our cap space is the reason they're looking at us. They'll take a little less to make it work, but each offer still has to make sense for him.`, urgent: 2, tag: 'League' });
  return best;
}

/** Free-agency utility from dynasty dynamics: strain with his current team, and a plan to team up. */
export function dynastyAppeal(w: World, p: Player, tid: string): number {
  let u = 0;
  if ((p as any).bird === tid || p.team === tid) {
    const t = w.teams[tid];
    let s = 0, g = 0;
    if (t) for (const x of Object.values(dynOf(t).pairs)) if (x.n === p.id || x.i === p.id) { s = Math.max(s, x.strain); g = Math.max(g, x.griev); }
    u -= (s / 100 * 0.12 + g / 100 * 0.15) * (0.5 + motive(p, 'status') * 6) / 1.25;
  }
  for (const P of plansFor(w, p.id)) {
    const dest = resolveDest(w, P);
    if (!dest) continue;
    if (tid === dest) u += 0.35 + 0.05 * P.members.filter(id => id !== p.id && w.players[id]?.team === dest).length;
    else u -= (p as any).bird === tid ? 0.14 : 0.05; // walking away from the bigger Bird-rights offer is the point of a team-up
  }
  return u;
}

/** Players a team-up has pointed at this team: its front office will make room for them in its offers. */
export function planTargets(w: World, tid: string): string[] {
  const out: string[] = [];
  for (const P of plans(w)) if (P.status === 'talk' && resolveDest(w, P) === tid) out.push(...P.members);
  return out;
}

/** Team-up members who can only reach the destination by sign-and-trade from the team holding their Bird rights. */
export function teamUpSatTargets(w: World): { pid: string; from: string; dest: string }[] {
  const out: { pid: string; from: string; dest: string }[] = [];
  for (const P of plans(w)) {
    if (P.status !== 'talk') continue;
    const dest = resolveDest(w, P); if (!dest || P.status !== 'talk') continue;
    for (const id of P.members) { const p = w.players[id]; const from = (p as any)?.bird as string | undefined; if (p && from && from !== dest && w.freeAgents.includes(id)) out.push({ pid: id, from, dest }); }
  }
  return out;
}

/** A player in a team-up waits for the destination's offer before deciding (until late July). */
export function awaitingPlan(w: World, p: Player, offers: { team: string }[]): boolean {
  return plansFor(w, p.id).some(P => { const d = resolveDest(w, P); return !!d && P.status === 'talk' && (p as any).bird !== d && !offers.some(o => o.team === d); });
}

/** Summer's end: did the team-up happen? */
export function settleSuperteams(w: World) {
  for (const P of plans(w)) {
    if (P.status !== 'talk' || P.summer > w.season.year) continue;
    const members = P.members.map(id => w.players[id]).filter(Boolean);
    const there = members.filter(p => P.dest && p.team === P.dest);
    if (there.length >= 2) {
      P.status = 'formed';
      const t = w.teams[P.dest!];
      for (const a of there) for (const b of there) if (a !== b) bump(edge(w, a.id, b.id), 0, 8);
      addNews(w, `${there.map(p => first(p.name)).join(' and ')} team up in ${t.city}`, `${there.map(p => p.name).join(' and ')} chose to play together with the ${t.name}. Expectations start at a title.`, 'transactions');
      addEvent(w, 'superteam', `${there.map(p => p.name).join(', ')} joined forces in ${t.city}`, there.map(p => p.id));
    } else P.status = 'failed';
  }
  const L = plans(w); if (L.length > 60) L.splice(0, L.length - 60);
}

/** The user asks one of his players to recruit a friend who is about to be a free agent (2008 on). Player-to-player
 *  recruiting is allowed; a front office steering it while the target is under contract risks a tampering penalty. */
export function canRecruit(w: World, target: Player): Player | null {
  if (w.season.year < 2008 || !target.team || target.team === w.meta.userTeam || !expiring(target) || plansFor(w, target.id).some(x => x.userPitch)) return null;
  const mine = w.teams[w.meta.userTeam].roster.map(id => w.players[id]).filter(Boolean);
  return mine.filter(p => (rel(w, p.id, target.id)?.[0] ?? 0) >= 62).sort((a, b) => (rel(w, b.id, target.id)?.[0] ?? 0) - (rel(w, a.id, target.id)?.[0] ?? 0))[0] ?? null;
}
export function recruit(w: World, targetId: string): string {
  const T = w.players[targetId], R = canRecruit(w, T);
  if (!R) return 'Nobody on your roster is close enough to him to make that call.';
  const r = stream(w.meta.seed, 'recruit', w.season.day, targetId);
  if (trustIn(w, R.id, 'gm') < 45 && r.chance(0.6)) return `${first(R.name)} isn't comfortable doing the front office's recruiting. Not for you, not yet.`;
  const u = w.meta.userTeam;
  plans(w).push({ id: `stu${w.season.year}-${targetId}`, summer: w.season.year, lead: R.id, members: [R.id, targetId], dest: u, status: 'talk', userPitch: true });
  let note = '';
  const inSeason = w.season.phase === 'regular' || w.season.phase === 'playoffs';
  if (inSeason && r.chance(w.season.year >= 2019 ? 0.12 : 0.06)) {
    const t = w.teams[u];
    const pk = t.picks.filter(x => x.round === 2).sort((a, b) => a.season - b.season)[0];
    if (pk) t.picks = t.picks.filter(x => x !== pk);
    w.owner.satisfaction = clamp(w.owner.satisfaction - 5, 0, 100);
    addMessage(w, { date: w.season.day, from: 'League office', role: 'League', subject: 'Tampering penalty', body: `The league found that the ${t.name} directed contact with ${T.name} while he was under contract. The team is fined${pk ? ` and forfeits its ${pk.season} second-round pick` : ''}.`, urgent: 2, tag: 'League' });
    note = ' The league has also noticed, and fined the team.';
  }
  addEvent(w, 'recruit', `${R.name} recruiting ${T.name}`, [R.id, T.id]);
  return `${first(R.name)} will call ${first(T.name)} and tell him what it's like here. When free agency opens, ${first(T.name)} will give us a real look.${note}`;
}

// ------------------------------------------------------------------ on the floor (GDD §13.5): cooperation, bounded
/** -1..1: how well two teammates read each other — familiarity can carry what affinity doesn't. */
export function cooperation(w: World, a: Player, b: Player): number {
  const e = rel(w, a.id, b.id);
  if (!e) return 0;
  const tog = Math.min(4, Math.min(tenure(w, a), tenure(w, b)));
  return clamp((e[0] - 55) / 45 - e[3] / 70 + tog / 10, -1, 1);
}

/** 0..1: open conflict among a lineup (two starters at war cost a little in execution, never in shooting). */
export function feudLevel(w: World, five: Player[]): number {
  let n = 0;
  for (let i = 0; i < five.length; i++) for (let j = i + 1; j < five.length; j++) if (Math.max(rel(w, five[i].id, five[j].id)?.[3] ?? 0, rel(w, five[j].id, five[i].id)?.[3] ?? 0) >= 70) n++;
  return Math.min(1, n * 0.5);
}

/** Season boundary: grievances fade slowly, pairs whose players parted are closed. */
export function dynastyOffseason(w: World) {
  seasonBonds(w);
  for (const d of aiMoveUnhappyStars(w)) addNews(w, 'Star traded', `${d}. He had asked out.`, 'transactions');
  for (const t of Object.values(w.teams)) {
    const D = dynOf(t);
    for (const [k, P] of Object.entries(D.pairs)) {
      P.strain *= 0.6; P.griev *= 0.85;
      const N = w.players[P.n], I = w.players[P.i];
      if (!N || !I || N.team !== t.id || I.team !== t.id) delete D.pairs[k];
    }
  }
}
