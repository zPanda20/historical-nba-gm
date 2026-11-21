// League & calendar engine: regular season, injuries, playoffs (1976-77 format), awards, draft, offseason.
import type { GameRec, Player, SeasonLine, Series, Team, World } from './types';
import { simulateGame, GameResult } from './engine';
import { clamp, stream, sigmoid } from './rng';
import { playerValue } from './coach';
import { addEvent, addMessage, addNews, buildSchedule, initScouting, potentialOvr, projectedWins, teamStrength } from './world';
import { eraRules, salaryScale, setEraYear, $y } from './history';
import { arcDev, hypeOf } from './impact';
import { cultureDevMul, declineMul, mentality, peopleOffseason, peopleSeasonStart, peopleWeek } from './people';
import { dynastyOffseason, dynastyWeek, settleSuperteams } from './dynasty';
import { makeContract } from './contracts';
import { assessLuxuryTax, capRules, rookieScale, teamPayroll, fmtM, minSalary, yos } from './cap';
const minSalaryFor = (season: number, p: Player) => minSalary(season, yos(p));
import { applyAlignment, applyIdentityEvents, coachingCarousel, compactRetired, generateSchedule, injectClass, injectUndrafted, rollPicks, runExpansion } from './seasons';
import { aiDailyMoves, generateDailyMessages, ownerSeasonReview, resolveExpiring } from './gm';

export const addDays = (d: string, n: number) => {
  const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10);
};

function seasonLine(p: Player, season: number, team: string, playoffs: boolean): SeasonLine {
  p.stats = p.stats ?? [];
  let l = p.stats.find(s => s.season === season && s.team === team && !!s.playoffs === playoffs);
  if (!l) { l = { season, team, g: 0, gs: 0, min: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, playoffs }; p.stats.push(l); }
  return l;
}

export function applyResult(world: World, g: GameRec, res: GameResult, keepLog: boolean) {
  g.hs = res.hs; g.as = res.as; g.ot = res.ot; g.played = true;
  const user = world.meta.userTeam;
  g.box = res.box;
  if (keepLog && (g.home === user || g.away === user || g.playoff)) g.log = res.log;
  const isPO = !!g.playoff;
  for (const [side, tid] of [['home', g.home], ['away', g.away]] as const) {
    for (const l of res.box[side]) {
      const p = world.players[l.pid]; if (!p) continue;
      const s = seasonLine(p, world.season.year, tid, isPO);
      if (l.min > 0) s.g++;
      if (l.gs) s.gs++;
      s.min += l.min; s.pts += l.pts; s.fgm += l.fgm; s.fga += l.fga; s.tpm += l.tpm; s.tpa += l.tpa; s.ftm += l.ftm; s.fta += l.fta;
      s.oreb += l.oreb; s.dreb += l.dreb; s.ast += l.ast; s.stl += l.stl; s.blk += l.blk; s.tov += l.tov; s.pf += l.pf;
      // season-long fatigue (load) proxy
      p.fatigueSeason = clamp((p.fatigueSeason ?? 0) * 0.92 + (l.min / 48) * 0.08, 0, 1);
      // game-to-game condition: heavy minutes on low stamina leave legs heavy for the next night
      p.cond = clamp((p.cond ?? 100) - l.min * 0.62 * (1.45 - p.r.stamina / 100) * (1 + Math.max(0, (p.age ?? 27) - 30) * 0.03), 20, 100);
    }
  }
  for (const inj of res.injuries) {
    const p = world.players[inj.pid];
    p.injury = { type: inj.type, daysLeft: inj.days, severity: inj.days > 29 ? 'serious' : inj.days > 7 ? 'moderate' : 'minor', since: g.date };
    addEvent(world, 'injury', `${p.name} (${p.team}) — ${inj.type}, est. ${inj.days} days`, [p.id]);
    if (p.team === user) addMessage(world, { date: world.season.day, from: 'Team physician', role: 'Medical', subject: `${p.name}: ${inj.type}`,
      body: `${p.name} left the game with a ${inj.type}. Our estimate is ${inj.days} day${inj.days > 1 ? 's' : ''} out (${p.injury.severity}). Estimates carry uncertainty; we'll update as he progresses.`,
      urgent: inj.days > 20 ? 2 : 1, tag: 'Medical' });
    if (inj.days > 25) addNews(world, `${p.name} sidelined`, `${world.teams[p.team!]?.city ?? ''} will be without ${p.name} (${inj.type}) for an estimated ${Math.round(inj.days / 7)} weeks.`, 'injury');
  }
  if (!isPO) {
    const H = world.teams[g.home], A = world.teams[g.away];
    const hw = res.hs > res.as;
    if (hw) { H.w++; A.l++; H.homeW++; H.streak = H.streak > 0 ? H.streak + 1 : 1; A.streak = A.streak < 0 ? A.streak - 1 : -1; }
    else { A.w++; H.l++; H.homeL++; A.streak = A.streak > 0 ? A.streak + 1 : 1; H.streak = H.streak < 0 ? H.streak - 1 : -1; }
    H.ptsFor += res.hs; H.ptsAgainst += res.as; A.ptsFor += res.as; A.ptsAgainst += res.hs;
  }
}

export function playGame(world: World, g: GameRec, keepLog = true): GameResult {
  const res = simulateGame(world, g.id, g.home, g.away, { log: keepLog && (g.home === world.meta.userTeam || g.away === world.meta.userTeam || !!g.playoff), playoff: !!g.playoff });
  applyResult(world, g, res, keepLog);
  return res;
}

function healDay(world: World) {
  for (const p of Object.values(world.players)) {
    if (p.cond != null && p.cond < 100) p.cond = Math.min(100, p.cond + 13 + p.r.stamina / 14 - Math.max(0, (p.age ?? 27) - 30) * 0.5);
    if (p.injury && p.injury.daysLeft > 0) {
      p.injury.daysLeft--;
      if (p.injury.daysLeft <= 0) {
        if (p.team === world.meta.userTeam) addMessage(world, { date: world.season.day, from: 'Team physician', role: 'Medical', subject: `${p.name} cleared`, body: `${p.name} has been cleared to play. The coach will decide how quickly to work him back into the rotation.`, urgent: 0, tag: 'Medical' });
        p.injury = null;
      }
    }
  }
}

/** Long saves: keep full box scores for our games and recent nights; older play-by-play goes. */
function pruneGames(world: World) {
  const u = world.meta.userTeam;
  const cut = addDays(world.season.day, -14), cutLog = addDays(world.season.day, -45);
  for (const g of world.season.games) {
    if (!g.played || g.date >= cut) continue;
    if (g.home !== u && g.away !== u && !g.playoff) { if (g.box) delete g.box; if (g.log) delete g.log; }
    else if (g.log && g.date < cutLog && !g.playoff) delete g.log;
  }
}
/** Playoff nights: keep box scores, but the play-by-play only for our games and the Finals once a few days pass. */
function prunePlayoffLogs(world: World) {
  const u = world.meta.userTeam, cut = addDays(world.season.day, -3);
  for (const g of world.season.games) if (g.playoff && g.log && g.date < cut && g.home !== u && g.away !== u && g.playoff.round < 4) delete g.log;
}

export function nextUnplayedDate(world: World): string | null {
  const g = world.season.games.find(x => !x.played);
  return g ? g.date : null;
}

/** Advance one calendar day. Returns a short description of what happened. */
const isMonday = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay() === 1;

export function advanceDay(world: World): string {
  const S = world.season;
  if (S.phase === 'preseason') {
    S.phase = 'regular';
    S.day = world.season.games[0]?.date ?? S.day;
    setEraYear(S.year);
    peopleSeasonStart(world);
    addNews(world, `${S.year}–${String(S.year + 1).slice(2)} season tips off`, `${Object.keys(world.teams).length} teams, ${eraRules(S.year).games} games each. ${S.year === 1976 ? 'The first season since the ABA–NBA merger brings Denver, Indiana, the New York Nets and San Antonio into the league.' : 'A new season begins.'}`, 'league');
    return 'Season started';
  }
  if (S.phase === 'regular') {
    if (S.day < (world.season.games[0]?.date ?? S.day)) { S.day = addDays(S.day, 1); healDay(world); return 'Off day'; }
    if (isMonday(S.day)) { peopleWeek(world); dynastyWeek(world); }
    const today = S.games.filter(g => g.date === S.day && !g.played);
    for (const g of today) playGame(world, g);
    pruneGames(world);
    healDay(world);
    aiDailyMoves(world);
    generateDailyMessages(world);
    const next = nextUnplayedDate(world);
    if (!next) { startPlayoffs(world); return 'Regular season complete'; }
    // step to next day (one at a time so injuries heal on off days)
    S.day = addDays(S.day, 1);
    if (S.day > next) S.day = next;
    return `${today.length} games played`;
  }
  if (S.phase === 'playoffs') {
    if (isMonday(S.day)) { peopleWeek(world); dynastyWeek(world); }
    playoffDay(world);
    prunePlayoffLogs(world);
    healDay(world);
    S.day = addDays(S.day, 1);
    return 'Playoff day';
  }
  return 'Offseason';
}

/** Advance until a stop condition: a date, the next user game, or an urgent decision. */
export function advanceUntil(world: World, stop: 'day' | 'game' | 'week' | 'month' | 'phase', maxDays = 400): string {
  const S = world.season;
  const startPhase = S.phase;
  const user = world.meta.userTeam;
  const startDay = S.day;
  let msg = '';
  for (let i = 0; i < maxDays; i++) {
    const urgentBefore = world.messages.filter(m => !m.resolved && m.urgent >= 3).length;
    msg = advanceDay(world);
    if (S.phase !== startPhase) break;
    if (stop === 'day') break;
    if (stop === 'game') {
      const lastPlayed = S.games.filter(g => g.played && (g.home === user || g.away === user)).slice(-1)[0];
      if (lastPlayed && lastPlayed.date >= startDay && S.phase === 'regular') { if (lastPlayed.date === addDays(S.day, -1) || lastPlayed.date === S.day) break; }
      if (S.phase === 'playoffs') break;
    }
    if (stop === 'week' && S.day >= addDays(startDay, 7)) break;
    if (stop === 'month' && S.day >= addDays(startDay, 30)) break;
    if (world.messages.filter(m => !m.resolved && m.urgent >= 3).length > urgentBefore) break; // critical decision blocks auto-advance
  }
  return msg;
}

// ------------------------------------------------------------------ standings & playoffs (format follows the era)
export function standings(world: World, conf?: string) {
  const ts = Object.values(world.teams).filter(t => !conf || t.conf === conf);
  return ts.sort((a, b) => (b.w - b.l) - (a.w - a.l) || b.w - a.w || (b.ptsFor - b.ptsAgainst) - (a.ptsFor - a.ptsAgainst));
}

/** Seeds for one conference under the season's rules (division winners first where the rules guarantee it). */
export function seedConference(world: World, conf: string, n?: number): string[] {
  const R = eraRules(world.season.year);
  const all = standings(world, conf);
  const divs = [...new Set(all.map(t => t.div))];
  const winners = divs.map(d => all.find(t => t.div === d)!).filter(Boolean);
  let order: Team[];
  if (R.divWinnerSeeds && R.divWinnerSeeds <= divs.length) {
    const w = [...winners].sort((a, b) => (b.w - b.l) - (a.w - a.l));
    order = [...w, ...all.filter(t => !w.includes(t))];
  } else if (R.divWinnerSeeds) {
    order = [...all];
    for (const wt of winners) { const i = order.indexOf(wt); if (i >= R.divWinnerSeeds) { order.splice(i, 1); order.splice(R.divWinnerSeeds - 1, 0, wt); } }
  } else order = all;
  const k = n ?? (R.playIn ? 10 : R.playoffTeams / 2);
  return order.slice(0, k).map(t => t.id);
}

const mkSeries = (id: string, round: number, conf: string, hi: string, lo: string, bestOf: number, slot: number): Series =>
  ({ id, round, conf, hi, lo, wHi: 0, wLo: 0, bestOf, games: [], slot } as Series);

/** Luxury tax on the payroll at the end of the regular season (first assessed 2002-03). The owner pays it, and notices. */
function chargeLuxuryTax(world: World) {
  const y = world.season.year;
  const R = capRules(y);
  if (!R.tax) return;
  const bills = assessLuxuryTax(world, y);
  const u = world.meta.userTeam;
  const payers = Object.keys(bills).length;
  if (payers) addNews(world, `${payers} team${payers > 1 ? 's' : ''} pay the luxury tax`, Object.entries(bills).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, b]) => `${world.teams[t].name} ${fmtM(b)}`).join(' · '), 'league');
  if (bills[u]) {
    const bill = bills[u];
    world.owner.satisfaction = clamp(world.owner.satisfaction - Math.min(25, bill / R.cap * 60), 0, 100);
    addMessage(world, { date: world.season.day, from: world.owner.name, role: 'Owner', subject: `Luxury tax bill: ${fmtM(bill)}`, body: `Our payroll finished at ${fmtM(teamPayroll(world, u))}, ${fmtM(teamPayroll(world, u) - R.tax)} over the ${fmtM(R.tax)} tax line. That bill comes out of my pocket. It had better be buying a title.`, urgent: 2, tag: 'Owner' });
  }
}

export function startPlayoffs(world: World) {
  const S = world.season;
  const R = eraRules(S.year);
  S.phase = 'playoffs';
  chargeLuxuryTax(world);
  const series: Series[] = [];
  const seeds: Record<string, string[]> = {};
  for (const conf of ['East', 'West']) {
    const s = seedConference(world, conf);
    seeds[conf] = s;
    (S as any)[`seeds${conf}`] = s;
    if (R.playIn && s.length >= 10) {
      series.push(mkSeries(`${conf}-PI-a`, 0, conf, s[6], s[7], 1, 0));
      series.push(mkSeries(`${conf}-PI-b`, 0, conf, s[8], s[9], 1, 1));
    } else if (R.byes) {
      series.push(mkSeries(`${conf}-R1-a`, 1, conf, s[3], s[4], R.r1BestOf, 0));
      series.push(mkSeries(`${conf}-R1-b`, 1, conf, s[2], s[5], R.r1BestOf, 1));
    } else pushRound1(series, conf, s, R.r1BestOf);
  }
  S.playoffs = { round: series.some(x => x.round === 0) ? 0 : 1, series, seeds, format: { teams: R.playoffTeams, byes: R.byes, playIn: R.playIn, bestOf: [1, R.r1BestOf, 7, 7, 7] } };
  const user = world.meta.userTeam;
  const inPO = Object.values(seeds).some(s => s.slice(0, R.playIn ? 6 : 99).includes(user));
  const inPI = R.playIn && Object.values(seeds).some(s => s.slice(6, 10).includes(user));
  addNews(world, 'Playoff field set', R.playIn ? 'Seeds 7–10 in each conference meet in the play-in tournament. Every series after that is best-of-seven.'
    : R.byes ? `Division winners earn first-round byes. First round is best-of-${R.r1BestOf}.` : `${R.playoffTeams} teams. First round is best-of-${R.r1BestOf}.`, 'league');
  addMessage(world, { date: S.day, from: world.owner.name, role: 'Owner', subject: inPO ? 'We made the playoffs' : inPI ? 'We are in the play-in' : 'Season over for us',
    body: inPO ? 'Good work getting us into the postseason. Now let\'s see what this group is made of.' : inPI ? 'One or two games to earn a playoff spot. No excuses.' : 'Disappointing to miss the playoffs. We need to talk about where this is going.', urgent: 1, tag: 'Owner' });
  S.day = addDays(S.day, 2);
}

function pushRound1(series: Series[], conf: string, s: string[], bestOf: number) {
  // fixed bracket: 1v8, 4v5 | 3v6, 2v7
  series.push(mkSeries(`${conf}-R1-a`, 1, conf, s[0], s[7], bestOf, 0));
  series.push(mkSeries(`${conf}-R1-b`, 1, conf, s[3], s[4], bestOf, 1));
  series.push(mkSeries(`${conf}-R1-c`, 1, conf, s[2], s[5], bestOf, 2));
  series.push(mkSeries(`${conf}-R1-d`, 1, conf, s[1], s[6], bestOf, 3));
}

const HOME_PATTERN: Record<string, number[]> = { 1: [0], 3: [0, 1, 0], 5: [0, 0, 1, 1, 0], 7: [0, 0, 1, 1, 0, 1, 0], f232: [0, 0, 1, 1, 1, 0, 0] };

function playoffDay(world: World) {
  const S = world.season, P = S.playoffs!;
  const active = P.series.filter(s => s.round === P.round && !s.winner);
  const R = eraRules(S.year);
  for (const s of active) {
    const gi = s.wHi + s.wLo;
    const pat = s.round === 4 && R.finals232 && s.bestOf === 7 ? HOME_PATTERN.f232 : HOME_PATTERN[s.bestOf] ?? HOME_PATTERN[7];
    const homeIsHi = pat[gi] === 0;
    const g: GameRec = { id: `${S.year}-PO-${s.id}-${gi + 1}`, date: S.day, home: homeIsHi ? s.hi : s.lo, away: homeIsHi ? s.lo : s.hi, playoff: { round: s.round, series: s.id, game: gi + 1 } };
    playGame(world, g);
    S.games.push(g);
    s.games.push(g.id);
    const hiWon = (g.home === s.hi) === (g.hs! > g.as!);
    if (hiWon) s.wHi++; else s.wLo++;
    const need = Math.ceil(s.bestOf / 2);
    if (s.wHi === need || s.wLo === need) {
      s.winner = s.wHi === need ? s.hi : s.lo;
      const loser = s.winner === s.hi ? s.lo : s.hi;
      const W = world.teams[s.winner], L = world.teams[loser];
      if (s.bestOf === 1) addNews(world, `${W.name} win the play-in game`, `${W.city} ${g.hs! > g.as! ? g.hs : g.as}–${g.hs! > g.as! ? g.as : g.hs} over ${L.city}.`, 'playoffs');
      else addNews(world, `${W.name} eliminate ${L.name}`, `${W.city} wins the series ${Math.max(s.wHi, s.wLo)}–${Math.min(s.wHi, s.wLo)}.`, 'playoffs');
      addEvent(world, 'series', `${W.abbr} def. ${L.abbr} ${Math.max(s.wHi, s.wLo)}-${Math.min(s.wHi, s.wLo)} (round ${s.round})`);
    }
  }
  if (P.series.filter(s => s.round === P.round).every(s => s.winner)) advanceRound(world);
}

function advanceRound(world: World) {
  const S = world.season, P = S.playoffs!;
  const R = eraRules(S.year);
  const r = P.round;
  const rec = (id: string) => world.teams[id].w - world.teams[id].l;
  const ser = (round: number, conf: string) => P.series.filter(s => s.round === round && s.conf === conf).sort((a, b) => ((a as any).slot ?? 0) - ((b as any).slot ?? 0));
  if (r === 0) {
    let created = false;
    for (const conf of ['East', 'West']) {
      const [a, b] = ser(0, conf);
      if (a && b && !P.series.some(s => s.id === `${conf}-PI-c`)) {
        const loserA = a.winner === a.hi ? a.lo : a.hi;
        P.series.push(mkSeries(`${conf}-PI-c`, 0, conf, loserA, b.winner!, 1, 2));
        created = true;
      }
    }
    if (created) { S.day = addDays(S.day, 1); return; }
    for (const conf of ['East', 'West']) {
      const [a, , c] = ser(0, conf);
      const s = [...P.seeds![conf].slice(0, 6), a.winner!, c.winner!];
      P.seeds![conf] = s; (S as any)[`seeds${conf}`] = s;
      pushRound1(P.series, conf, s, 7);
    }
    addNews(world, 'Play-in complete', 'The 16-team playoff bracket is set.', 'playoffs');
  } else if (r === 1) {
    for (const conf of ['East', 'West']) {
      const seeds = P.seeds?.[conf] ?? (S as any)[`seeds${conf}`] as string[];
      const r1 = ser(1, conf);
      if (r1.length === 2) { // 12-team format: byes for the top two; top seed plays the lowest remaining seed
        const winners = r1.map(s => s.winner!).sort((a, b) => seeds.indexOf(a) - seeds.indexOf(b));
        P.series.push(mkSeries(`${conf}-R2-a`, 2, conf, seeds[0], winners[1], 7, 0));
        P.series.push(mkSeries(`${conf}-R2-b`, 2, conf, seeds[1], winners[0], 7, 1));
      } else {
        for (let k = 0; k < 2; k++) {
          const [x, y] = [r1[2 * k].winner!, r1[2 * k + 1].winner!];
          const [hi, lo] = seeds.indexOf(x) < seeds.indexOf(y) ? [x, y] : [y, x];
          P.series.push(mkSeries(`${conf}-R2-${'ab'[k]}`, 2, conf, hi, lo, 7, k));
        }
      }
    }
  } else if (r === 2) {
    for (const conf of ['East', 'West']) {
      const w = ser(2, conf).map(s => s.winner!);
      const seeds = P.seeds?.[conf] ?? [];
      const [hi, lo] = R.divWinnerSeeds && seeds.length ? (seeds.indexOf(w[0]) < seeds.indexOf(w[1]) ? [w[0], w[1]] : [w[1], w[0]]) : (rec(w[0]) >= rec(w[1]) ? [w[0], w[1]] : [w[1], w[0]]);
      P.series.push(mkSeries(`${conf}-CF`, 3, conf, hi, lo, 7, 0));
    }
  } else if (r === 3) {
    const w = P.series.filter(s => s.round === 3).map(s => s.winner!).sort((a, b) => rec(b) - rec(a));
    P.series.push(mkSeries(`Finals`, 4, 'NBA', w[0], w[1], 7, 0));
    addNews(world, 'The NBA Finals are set', `${world.teams[w[0]].city} vs ${world.teams[w[1]].city}.`, 'playoffs');
  } else {
    const fin = P.series.find(s => s.round === 4)!;
    S.champion = fin.winner;
    const runner = fin.winner === fin.hi ? fin.lo : fin.hi;
    addNews(world, `${world.teams[fin.winner!].city} ${world.teams[fin.winner!].name} are NBA champions`, `They beat ${world.teams[runner].city} ${Math.max(fin.wHi, fin.wLo)}–${Math.min(fin.wHi, fin.wLo)} in the Finals.`, 'playoffs');
    addEvent(world, 'champion', `${fin.winner} won the ${S.year}-${S.year + 1} title`);
    endSeason(world, runner);
    return;
  }
  P.round++;
  S.day = addDays(S.day, 2);
}

/** All teams that reached the playoff proper (not just the play-in). */
export function playoffTeams(world: World): Set<string> {
  const P = world.season.playoffs;
  return new Set(P?.series.filter(s => s.round >= 1).flatMap(s => [s.hi, s.lo]) ?? []);
}

// ------------------------------------------------------------------ awards (from simulated evidence only, F28)
export function perGame(p: Player, season: number, playoffs = false) {
  const ls = (p.stats ?? []).filter(s => s.season === season && !!s.playoffs === playoffs);
  const t: any = { g: 0, gs: 0, min: 0, pts: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, tpm: 0, tpa: 0 };
  for (const l of ls) for (const k in t) t[k] += (l as any)[k];
  const g = Math.max(1, t.g);
  return { ...t, ppg: t.pts / g, rpg: (t.oreb + t.dreb) / g, apg: t.ast / g, spg: t.stl / g, bpg: t.blk / g, mpg: t.min / g,
    fgp: t.fga ? t.fgm / t.fga : 0, ftp: t.fta ? t.ftm / t.fta : 0, team: ls.slice(-1)[0]?.team };
}

/** Scoring title: best points per game among qualified players (about 85% of the schedule, or the era's points floor). */
export function scoringTitle(world: World, y: number): { id: string; ppg: number } | null {
  const G = eraRules(y).games;
  let best: { id: string; ppg: number } | null = null;
  for (const p of Object.values(world.players)) {
    const s = perGame(p, y);
    if (!s.g || !(s.g >= Math.round(G * 0.85) || s.pts >= Math.round(1400 * G / 82))) continue;
    if (!best || s.ppg > best.ppg) best = { id: p.id, ppg: s.ppg };
  }
  return best;
}

function computeAwards(world: World) {
  const y = world.season.year;
  const G = eraRules(y).games;
  const ps = Object.values(world.players).filter(p => (p.stats ?? []).some(s => s.season === y && !s.playoffs));
  const rows = ps.map(p => ({ p, s: perGame(p, y) })).filter(o => o.s.g >= Math.round(G * 0.5));
  const winPct = (tid: string) => { const t = world.teams[tid]; return t ? t.w / Math.max(1, t.w + t.l) : 0.5; };
  const impact = (o: any) => o.s.ppg + 1.1 * o.s.rpg + 1.4 * o.s.apg + 2 * o.s.spg + 2 * o.s.bpg + (o.s.fgp - 0.45) * 40 + (o.s.tpm / Math.max(1, o.s.g)) * 0.8;
  const mvp = [...rows].sort((a, b) => (impact(b) + 18 * winPct(b.s.team)) - (impact(a) + 18 * winPct(a.s.team)));
  const isRookie = (p: Player) => p.draftClass === y || (p as any).draftYear === y;
  const roy = [...rows].filter(o => isRookie(o.p)).sort((a, b) => impact(b) - impact(a));
  const guard = (p: Player) => ['PG', 'SG'].includes(p.pos), fwd = (p: Player) => ['SF', 'PF'].includes(p.pos), ctr = (p: Player) => p.pos === 'C';
  const used = new Set<string>();
  const team = () => {
    const pickN = (f: (p: Player) => boolean, n: number) => mvp.filter(o => f(o.p) && !used.has(o.p.id)).slice(0, n);
    const t = [...pickN(guard, 2), ...pickN(fwd, 2), ...pickN(ctr, 1)];
    t.forEach(o => used.add(o.p.id)); return t.map(o => o.p.id);
  };
  const first = team(), second = team(), third = y >= 1988 ? team() : [];
  const defScore = (o: any) => 3 * o.s.spg + 3 * o.s.bpg + 0.5 * o.s.rpg + (o.p.r.perD + o.p.r.intD) / 20 + 6 * winPct(o.s.team);
  const defRank = [...rows].filter(o => o.s.mpg >= 24).sort((a, b) => defScore(b) - defScore(a));
  const allDef = defRank.slice(0, 5).map(o => o.p.id);
  const dpoy = y >= 1982 ? defRank[0]?.p.id : null;
  const sixth = y >= 1982 ? [...rows].filter(o => o.s.gs < o.s.g * 0.35 && o.s.mpg >= 15).sort((a, b) => impact(b) - impact(a))[0]?.p.id : null;
  const prev = (p: Player) => perGame(p, y - 1);
  const mip = y >= 1985 ? [...rows].filter(o => !isRookie(o.p) && prev(o.p).g >= 20).map(o => ({ o, d: impact(o) - impact({ s: prev(o.p) }) })).sort((a, b) => b.d - a.d)[0]?.o.p.id : null;
  // Finals MVP: best two-way line on the champion during the Finals
  const champ = world.season.champion;
  const fin = world.season.playoffs?.series.find(s => s.round === 4);
  let fmvp: string | null = null;
  if (champ && fin) {
    const tally: Record<string, number> = {};
    for (const gid of fin.games) { const g = world.season.games.find(x => x.id === gid); if (!g?.box) continue; const side = g.home === champ ? g.box.home : g.box.away;
      for (const l of side) tally[l.pid] = (tally[l.pid] ?? 0) + l.pts + 1.1 * (l.oreb + l.dreb) + 1.4 * l.ast + 2 * (l.stl + l.blk) - l.tov; }
    fmvp = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }
  const coy = Object.values(world.teams).map(t => ({ t, d: (t.w - (projectedWinsCache[t.id] ?? G / 2)) })).sort((a, b) => b.d - a.d)[0];
  const st = scoringTitle(world, y);
  const aw: Record<string, any> = { MVP: mvp[0]?.p.id, 'Finals MVP': fmvp, 'Scoring title': st?.id ?? null, ROY: roy[0]?.p.id, DPOY: dpoy, '6MOY': sixth, MIP: mip, 'All-NBA 1st': first, 'All-NBA 2nd': second, 'All-NBA 3rd': third, 'All-Defensive': allDef, COY: null };
  for (const k of Object.keys(aw)) if (aw[k] == null || (Array.isArray(aw[k]) && !aw[k].length)) delete aw[k];
  const coyName = coy ? world.coaches[world.teams[coy.t.id].coach]?.name : null;
  for (const [k, v] of Object.entries(aw)) {
    for (const id of (Array.isArray(v) ? v : v ? [v] : [])) {
      const p = world.players[id];
      if (p) { p.awards = p.awards ?? []; p.awards.push({ season: y, award: k }); }
    }
  }
  aw.COY = coyName; if (coy) aw.COYteam = coy.t.id;
  if (st) aw.scoringPPG = Math.round(st.ppg * 10) / 10;
  if (aw.MVP) addNews(world, `${world.players[aw.MVP].name} named MVP`, `Voting is simulated from this season's games, not history.`, 'awards');
  if (aw.ROY) addNews(world, `${world.players[aw.ROY].name} is Rookie of the Year`, '', 'awards');
  world.season.awards = aw;
}
export const projectedWinsCache: Record<string, number> = {};

function endSeason(world: World, runnerUp: string) {
  const S = world.season;
  computeAwards(world);
  const po = playoffTeams(world);
  for (const t of Object.values(world.teams)) {
    const res = S.champion === t.id ? 'Champion' : runnerUp === t.id ? 'Finals' : po.has(t.id) ? 'Playoffs' : 'Missed playoffs';
    t.history.push({ season: S.year, w: t.w, l: t.l, result: res, ...(t.abbr ? { abbr: t.abbr, name: `${t.city} ${t.name}` } : {}) } as any);
  }
  const fin = S.playoffs?.series.find(x => x.round === 4);
  world.pastSeasons.push({ year: S.year, champion: S.champion!, runnerUp, finals: fin ? `${Math.max(fin.wHi, fin.wLo)}–${Math.min(fin.wHi, fin.wLo)}` : undefined, awards: S.awards ?? {}, standings: standings(world).map(t => ({ team: t.id, w: t.w, l: t.l })),
    names: Object.fromEntries(Object.values(world.teams).map(t => [t.id, { abbr: t.abbr, city: t.city, name: t.name, logo: t.logoKey ?? t.abbr }])) } as any);
  ownerSeasonReview(world);
  setupDraft(world);
}

// ------------------------------------------------------------------ draft: order, lottery (by era), expansion slots
const W1994_11 = [250, 199, 156, 119, 88, 63, 43, 28, 17, 11, 6];
const W2004 = [250, 199, 156, 119, 88, 63, 43, 28, 17, 11, 8, 7, 6, 5];
const W2019 = [140, 140, 140, 125, 105, 90, 75, 60, 45, 30, 20, 15, 10, 5];

export function setupDraft(world: World) {
  const S = world.season;
  S.phase = 'draft';
  const year = S.year + 1;
  const R = eraRules(S.year);
  const rng = stream(world.meta.seed, 'draft', year);
  // expansion teams that start next season are formed now so they can draft
  const newTeams = runExpansion(world, year);
  injectClass(world, year);
  const ts = Object.values(world.teams).filter(t => !newTeams.includes(t.id));
  const po = playoffTeams(world);
  const byRec = (a: Team, b: Team) => (a.w - a.l) - (b.w - b.l) || (rng.next() - 0.5);
  const nonPO = ts.filter(t => !po.has(t.id)).sort(byRec);
  const inPO = ts.filter(t => po.has(t.id)).sort(byRec);
  let lotteryPool = nonPO.map(t => t.id);
  let order1: string[];
  let text = '';
  const results: { team: string; pick: number; pre: number; odds?: number }[] = [];
  const draw = (pool: string[], weights: number[], k: number) => {
    const left = pool.map((id, i) => ({ id, w: weights[i] ?? weights[weights.length - 1] ?? 1, pre: i + 1 }));
    const tot = left.reduce((a, x) => a + x.w, 0);
    const out: string[] = [];
    for (let i = 0; i < k && left.length; i++) {
      const j = rng.weighted(left.map(x => x.w));
      results.push({ team: left[j].id, pick: i + 1, pre: left[j].pre, odds: Math.round(left[j].w / tot * 1000) / 10 });
      out.push(left[j].id); left.splice(j, 1);
    }
    const rest = left.map(x => x.id);
    rest.forEach((id, i) => results.push({ team: id, pick: out.length + i + 1, pre: pool.indexOf(id) + 1 }));
    return [...out, ...rest];
  };
  switch (R.lottery) {
    case 'coinflip': {
      const worstE = standings(world, 'East').filter(t => !newTeams.includes(t.id)).slice(-1)[0].id, worstW = standings(world, 'West').filter(t => !newTeams.includes(t.id)).slice(-1)[0].id;
      const flipWinner = rng.chance(0.5) ? worstE : worstW;
      const flipLoser = flipWinner === worstE ? worstW : worstE;
      order1 = [flipWinner, flipLoser, ...lotteryPool.filter(id => id !== worstE && id !== worstW)];
      text = `Coin flip between the worst teams in each conference: ${world.teams[flipWinner].city} win it and pick first.`;
      results.push({ team: flipWinner, pick: 1, pre: 1, odds: 50 }, { team: flipLoser, pick: 2, pre: 2, odds: 50 });
      break;
    }
    case 'equal-all': order1 = draw(lotteryPool, lotteryPool.map(() => 1), lotteryPool.length); text = `Draft lottery: all ${lotteryPool.length} non-playoff teams have equal odds; the envelopes set the whole lottery order.`; break;
    case 'equal-top3': order1 = draw(lotteryPool, lotteryPool.map(() => 1), 3); text = `Draft lottery: equal odds for the top three picks among ${lotteryPool.length} non-playoff teams.`; break;
    case 'weighted-1990': order1 = draw(lotteryPool, lotteryPool.map((_, i) => lotteryPool.length - i), 3); text = 'Weighted lottery: the worst record has the most combinations; three picks drawn.'; break;
    case 'weighted-1994': order1 = draw(lotteryPool, lotteryPool.length <= 11 ? W1994_11 : W2004, 3); text = 'Weighted lottery (250 of 1,000 combinations for the worst record); three picks drawn.'; break;
    case 'flat-2019': order1 = draw(lotteryPool, W2019, 4); text = 'Flattened lottery: the three worst records share 14% odds at No. 1; four picks drawn.'; break;
    default: {
      // 2027 reform: 16 teams (14 non-playoff + both play-in 8-seed losers), balls by placement; the three worst get fewer
      const piLosers = (S.playoffs?.series ?? []).filter(s => s.id.endsWith('PI-c') && s.winner).map(s => s.winner === s.hi ? s.lo : s.hi);
      lotteryPool = [...nonPO.map(t => t.id).filter(id => !piLosers.includes(id)), ...piLosers];
      const balls = lotteryPool.map((_, i) => i < 3 ? 2 : i < 10 ? 3 : i < 13 ? 2 : 1);
      order1 = draw(lotteryPool, balls, 4);
      text = '3–2–1 lottery (approved for 2027–29): 16 teams, three, two or one balls by placement; the three worst records get two. Four picks drawn.';
    }
  }
  if (R.lottery === 'coinflip') results.push(...order1.slice(2).map((id, i) => ({ team: id, pick: i + 3, pre: i + 3 })));
  const rest = [...nonPO.map(t => t.id), ...inPO.map(t => t.id)].filter(id => !order1.includes(id));
  order1 = [...order1, ...rest];
  // expansion teams pick right after the lottery's drawn picks
  if (newTeams.length) order1.splice(Math.min(order1.length, R.lottery === 'coinflip' ? 2 : 4), 0, ...newTeams);
  addNews(world, `${year} draft order set`, text, 'draft');
  const rounds = R.draftRounds;
  const order: { pick: number; round: number; team: string; original?: string; jump?: number }[] = [];
  let n = 1;
  for (let r = 1; r <= rounds; r++) {
    const ro = r === 1 ? order1 : [...newTeams, ...order1.filter(id => !newTeams.includes(id))];
    // later rounds go in reverse record order with no lottery
    const base = r === 1 ? ro : [...newTeams, ...[...nonPO, ...inPO].map(t => t.id)];
    for (const tid of base) {
      let owner = tid;
      for (const t of Object.values(world.teams)) { const q = t.picks.find(p => p.season === year && p.round === r && p.original === tid); if (q) owner = q.owner; }
      const pre = r === 1 ? results.find(x => x.team === tid)?.pre : undefined;
      order.push({ pick: n++, round: r, team: owner, original: tid, ...(r === 1 && pre ? { jump: pre - (order.length + 1) } : {}) });
    }
    void ro;
  }
  const pool = (world.draftClasses[String(year)] ?? []).filter(id => world.players[id] && !world.players[id].team && !world.players[id].retired);
  S.draft = { year, order, idx: 0, pool, board: [...pool].sort((a, b) => (world.players[b].scout?.pot?.mid ?? 0) - (world.players[a].scout?.pot?.mid ?? 0)),
    lottery: { kind: R.lottery, text, results: results.slice(0, 16) } };
  const userPicks = order.filter(o => o.team === world.meta.userTeam && o.round <= 2).map(o => `#${o.pick}`);
  addMessage(world, { date: S.day, from: 'Director of scouting', role: 'Scout', subject: `${year} draft: we pick ${userPicks.join(', ') || 'late'}`, body: `${text} The board is ready. Our reports show ranges, not certainties — some of these players will surprise everyone, both ways. Open Draft & Scouting to set the board and make our picks.`, urgent: 3, tag: 'Scouting', actions: [{ label: 'Open draft', cmd: 'goto', arg: 'draft' }] });
}

/** AI/user draft selection. Team boards use each team's own noisy beliefs (no hindsight). */
export function aiPickFor(world: World, tid: string): string | null {
  const D = world.season.draft!;
  const rng = stream(world.meta.seed, 'draft', D.year, tid, D.idx);
  const team = world.teams[tid];
  const clock = team.clock ?? 'Contending';
  const wNow = clock === 'Win Now' ? 0.7 : clock === 'Contending' ? 0.5 : clock === 'Building' ? 0.35 : 0.25;
  let best: string | null = null, bv = -1e9;
  for (const id of D.pool) {
    const p = world.players[id];
    // team-specific belief: truth + team bias + noise (F11), never the real career
    const belief = (stream(world.meta.seed, 'belief', tid, id).normal(0, 3));
    const hype = hypeOf(p);
    const now = p.ovr + belief + hype * 0.5, pot = potentialOvr(p) + belief * 1.3 + stream(world.meta.seed, 'beliefP', tid, id).normal(0, 3.5) + hype * 0.85;
    const v = wNow * now + (1 - wNow) * pot + rng.normal(0, 1.5);
    if (v > bv) { bv = v; best = id; }
  }
  return best;
}

export function makePick(world: World, pid: string) {
  const D = world.season.draft!;
  const slot = D.order[D.idx];
  const p = world.players[pid];
  slot.player = pid;
  p.draftedBy = slot.team; p.draftPick = slot.pick;
  D.pool = D.pool.filter(x => x !== pid); D.board = D.board.filter(x => x !== pid);
  const team = world.teams[slot.team];
  // first two rounds sign; later picks are rights only (can sign in free agency)
  if (slot.round <= 2) {
    team.roster.push(pid); p.team = slot.team;
    // 1995 on: the rookie scale (four seasons for first-rounders); before that, slot-based negotiated deals
    const scale = rookieScale(world.season.year + 1, slot.pick, slot.round);
    const sal = scale ? scale.salary : slot.round === 1 ? $y(Math.max(40000, 150000 - slot.pick * 3500)) : $y(45000);
    const yrs = scale ? scale.years : slot.round === 1 ? 3 : 2;
    // first-round scale deals: two guaranteed seasons, then team options on the third and fourth
    p.contract = makeContract(sal, yrs, { rookie: true, scale: !!scale && slot.round === 1, fresh: true, signed: world.season.day,
      opts: scale && slot.round === 1 ? [{ kind: 'team', idx: 2 }, { kind: 'team', idx: 3 }] : [],
      provenance: scale ? 'Rookie scale (simulated)' : 'RECONSTRUCTED — simulation only (rookie deal)' });
  } else {
    p.rosterStatus = `Draft rights held by ${slot.team}`;
    if (!world.freeAgents.includes(pid)) world.freeAgents.push(pid);
  }
  addEvent(world, 'draft', `#${slot.pick} ${slot.team}: ${p.name}`, [pid]);
  D.idx++;
}

/** Run AI picks until it's the user's turn (or the draft ends). */
export function runDraftUntilUser(world: World, untilEnd = false) {
  const D = world.season.draft!;
  while (D.idx < D.order.length && D.pool.length) {
    const slot = D.order[D.idx];
    if (slot.team === world.meta.userTeam && !untilEnd) return 'user';
    const pid = slot.team === world.meta.userTeam ? D.board[0] : aiPickFor(world, slot.team);
    if (!pid) break;
    makePick(world, pid);
  }
  return finishDraft(world);
}

export function finishDraft(world: World) {
  const D = world.season.draft!;
  const top = D.order.filter(o => o.player).slice(0, 3).map(o => `${world.players[o.player!].name} (${o.team})`).join(', ');
  addNews(world, `${D.year} draft complete`, `Top picks: ${top}.`, 'draft');
  for (const id of D.pool) { const p = world.players[id]; if (p && !p.team && !world.freeAgents.includes(id)) { world.freeAgents.push(id); p.rosterStatus = 'Undrafted free agent'; p.ask = $y(30000); } }
  injectUndrafted(world, D.year);
  D.done = true;
  world.season.phase = 'freeagency';
  resolveExpiring(world);
  return 'done';
}

// ------------------------------------------------------------------ offseason → next season
export function developPlayers(world: World) {
  for (const p of Object.values(world.players)) {
    if (p.retired) continue;
    const rng = stream(world.meta.seed, 'development', world.season.year, p.id);
    const age = (p.age ?? 25);
    const minutes = (p.stats ?? []).filter(s => s.season === world.season.year).reduce((a, s) => a + s.min, 0);
    const arc = arcDev(p, age);
    const opp = Math.max(arc.oppMin, clamp(0.55 + minutes / 3000, 0.55, 1.25));
    const coach = p.team ? world.coaches[world.teams[p.team].coach] : null;
    const coachFit = (coach ? 0.85 + coach.development / 250 : 0.8) * cultureDevMul(world, p);
    const decK = declineMul(p);
    for (const k of Object.keys(p.r) as (keyof Player['r'])[]) {
      if (k === 'hgt') continue;
      const C = p.ceil[k]?.mu ?? p.r[k];
      const eta = Math.max(arc.etaMin, age <= 21 ? 0.34 : age <= 23 ? 0.28 : age <= 25 ? 0.2 : age <= 27 ? 0.1 : 0.04);
      const physical = ['ath', 'stamina', 'blk', 'oreb', 'drive', 'perD'].includes(k);
      const decline = decK * arc.declineMul * (age >= 30 ? (physical ? 1.5 + (age - 30) * 0.75 : 0.55 + (age - 30) * 0.45) : age >= 28 && physical ? 0.5 : 0);
      // grow toward the ceiling; drift above it is pulled back, so noise cannot walk a player past his talent
      const gap = C - p.r[k];
      const delta = (gap > 0 ? eta * opp * coachFit * gap : 0.35 * gap) - decline + rng.normal(0, 1.6);
      p.r[k] = Math.round(clamp(p.r[k] + delta, 15, 99));
    }
    p.ovr = Math.round(playerValue(p));
    p.age = age + 1;
    p.fatigueSeason = 0; p.cond = 100;
  }
}

export function retirements(world: World) {
  for (const p of Object.values(world.players)) {
    if (p.retired || !p.age) continue;
    const rng = stream(world.meta.seed, 'retire', world.season.year, p.id);
    const r0 = -2.94 + 0.52 * (p.age - 30);
    const s = r0 + (p.injury?.severity === 'serious' ? 0.8 : 0) + (p.team ? -0.4 : 0.9) - (playerValue(p) - 55) / 18 + (p.traits.drive - 50) / -60 - Math.max(0, mentality(p) - 80) / 40;
    // prospects who never made a roster drift out of the league; nothing of them needs keeping
    if (!p.team && !p.contract && p.draftClass && p.draftClass <= world.season.year - 1 && !(p.stats ?? []).length) {
      const yrs = world.season.year - p.draftClass;
      if (yrs >= 3 || rng.chance(0.45 + yrs * 0.2) && playerValue(p) < 52) { world.freeAgents = world.freeAgents.filter(x => x !== p.id); delete world.players[p.id]; continue; }
    }
    if (p.age >= 30 && rng.chance(sigmoid(s))) {
      p.retired = true;
      if (p.team) { const t = world.teams[p.team]; t.roster = t.roster.filter(x => x !== p.id); }
      p.team = null; p.contract = null;
      world.freeAgents = world.freeAgents.filter(x => x !== p.id);
      if (p.ovr >= 62) addNews(world, `${p.name} retires`, `${p.name} calls it a career at ${p.age}.`, 'league');
      addEvent(world, 'retire', `${p.name} retired at ${p.age}`, [p.id]);
    }
  }
}

export function startNextSeason(world: World) {
  const S = world.season;
  peopleOffseason(world);
  settleSuperteams(world);
  dynastyOffseason(world);
  developPlayers(world);
  retirements(world);
  coachingCarousel(world);
  const year = S.year + 1;
  const prevScale = salaryScale(S.year);
  setEraYear(year);
  applyIdentityEvents(world, year);
  // legacy saves stored franchise events in the data pack; mark them handled so they never double-apply
  for (const ev of world.franchiseEvents) if (ev.season <= year && ev.team && !ev.done) ev.done = true;
  applyAlignment(world, year);
  for (const t of Object.values(world.teams)) { t.w = t.l = t.homeW = t.homeL = t.streak = t.ptsFor = t.ptsAgainst = 0; t.minutesRequests = {}; }
  // budgets follow league salary growth
  const k = salaryScale(year) / prevScale;
  for (const t of Object.values(world.teams)) t.payrollBudget = Math.round((t.payrollBudget ?? 0) * k / 5000) * 5000 || Math.round(payrollOf(world, t.id) * 1.08);
  world.owner.budget = Math.round(world.owner.budget * k / 10000) * 10000;
  { // in the cap era the owner's line sits between the cap and the tax (or a cap multiple before the tax existed)
    const R = capRules(year);
    if (R.hasCap) { const hi = R.tax ? R.tax * 1.04 : R.cap * 1.3; world.owner.budget = Math.round(clamp(world.owner.budget, R.cap * 0.98, hi) / 10000) * 10000;
      for (const t of Object.values(world.teams)) t.payrollBudget = Math.round(clamp(t.payrollBudget ?? R.cap, R.cap * 0.95, hi) / 5000) * 5000; }
  }
  const R = eraRules(year);
  const sched = world.schedules[String(year)];
  const historical = sched && Object.keys(world.teams).length === 22 ? buildSchedule(year, sched, world.teams, { NJN: 'NYN' }) : null;
  world.season = { year, phase: 'preseason', day: addDays(R.start, -6), games: historical && historical.length > 800 ? historical : generateSchedule(world, year), playoffs: null, draft: null };
  rollPicks(world);
  delete (world as any).fa;
  for (const id of world.freeAgents) { const p = world.players[id]; if (p) { delete (p as any).rfa; delete (p as any).bird; delete (p as any).renounced; } }
  // whoever is still unsigned when camp opens lowers his price; by midseason most take what is offered
  for (const id of world.freeAgents) { const p = world.players[id]; if (p && p.ask) p.ask = Math.max(minSalaryFor(year, p), Math.round(p.ask * 0.55 / 5000) * 5000); }
  injectClass(world, year + 1);
  compactRetired(world);
  const proj = projectedWins(world);
  Object.assign(projectedWinsCache, proj);
  world.owner.expectedWins = proj[world.meta.userTeam];
  world.owner.objective = proj[world.meta.userTeam] >= R.games * 0.585 ? 'Contend for the title.' : proj[world.meta.userTeam] >= R.games * 0.49 ? `Make the playoffs (owner expects about ${proj[world.meta.userTeam]} wins).` : 'Show real progress this season.';
  initScouting(world);
  if (R.games !== 82) addNews(world, `${R.games}-game season`, year === 1998 ? 'A lockout wipes out the first three months; teams play 50 games starting in February.' : year === 2011 ? 'The lockout ends; the season opens on Christmas Day with 66 games.' : 'An unusual season: a shortened schedule.', 'league');
  addMessage(world, { date: world.season.day, from: world.owner.name, role: 'Owner', subject: `Expectations for ${year}–${String(year + 1).slice(2)}`, body: world.owner.objective, urgent: 1, tag: 'Owner' });
}
const payrollOf = (w: World, tid: string) => w.teams[tid].roster.reduce((s, id) => s + (w.players[id]?.contract?.salary ?? 0), 0);

export { teamStrength };
