// League & calendar engine: regular season, injuries, playoffs (1976-77 format), awards, draft, offseason.
import type { GameRec, Player, PlayoffState, SeasonLine, Series, Team, World } from './types';
import { simulateGame, GameResult } from './engine';
import { clamp, stream, sigmoid } from './rng';
import { playerValue } from './coach';
import { addEvent, addMessage, addNews, buildSchedule, initScouting, potentialOvr, projectedWins, teamStrength } from './world';
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
  if (keepLog && (g.home === user || g.away === user)) g.log = res.log;
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
  const res = simulateGame(world, g.id, g.home, g.away, { log: keepLog && (g.home === world.meta.userTeam || g.away === world.meta.userTeam), playoff: !!g.playoff });
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

export function nextUnplayedDate(world: World): string | null {
  const g = world.season.games.find(x => !x.played);
  return g ? g.date : null;
}

/** Advance one calendar day. Returns a short description of what happened. */
export function advanceDay(world: World): string {
  const S = world.season;
  if (S.phase === 'preseason') {
    S.phase = 'regular';
    S.day = world.season.games[0]?.date ?? S.day;
    addNews(world, `${S.year}–${String(S.year + 1).slice(2)} season tips off`, `22 teams, 82 games each. ${S.year === 1976 ? 'The first season since the ABA–NBA merger brings Denver, Indiana, the New York Nets and San Antonio into the league.' : 'A new season begins.'}`, 'league');
    return 'Season started';
  }
  if (S.phase === 'regular') {
    const today = S.games.filter(g => g.date === S.day && !g.played);
    for (const g of today) playGame(world, g);
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
    playoffDay(world);
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

// ------------------------------------------------------------------ standings & playoffs (1976-77 format)
export function standings(world: World, conf?: string) {
  const ts = Object.values(world.teams).filter(t => !conf || t.conf === conf);
  return ts.sort((a, b) => (b.w - b.l) - (a.w - a.l) || b.w - a.w || (b.ptsFor - b.ptsAgainst) - (a.ptsFor - a.ptsAgainst));
}

function seedConference(world: World, conf: string): string[] {
  const all = standings(world, conf);
  const divs = [...new Set(all.map(t => t.div))];
  const winners = divs.map(d => all.find(t => t.div === d)!).sort((a, b) => (b.w - b.l) - (a.w - a.l));
  const rest = all.filter(t => !winners.includes(t)).slice(0, 4);
  return [...winners.map(t => t.id), ...rest.map(t => t.id)];
}

export function startPlayoffs(world: World) {
  const S = world.season;
  S.phase = 'playoffs';
  const series: Series[] = [];
  for (const conf of ['East', 'West']) {
    const s = seedConference(world, conf);
    (S as any)[`seeds${conf}`] = s;
    series.push({ id: `${conf}-R1-a`, round: 1, conf, hi: s[2], lo: s[5], wHi: 0, wLo: 0, bestOf: 3, games: [] });
    series.push({ id: `${conf}-R1-b`, round: 1, conf, hi: s[3], lo: s[4], wHi: 0, wLo: 0, bestOf: 3, games: [] });
  }
  S.playoffs = { round: 1, series };
  const user = world.meta.userTeam;
  const inPO = ['East', 'West'].some(c => ((S as any)[`seeds${c}`] as string[]).includes(user));
  addNews(world, 'Playoff field set', `Division winners earn first-round byes. First round is best-of-three.`, 'league');
  addMessage(world, { date: S.day, from: world.owner.name, role: 'Owner', subject: inPO ? 'We made the playoffs' : 'Season over for us', body: inPO ? 'Good work getting us into the postseason. Now let\'s see what this group is made of.' : 'Disappointing to miss the playoffs. We need to talk about where this is going.', urgent: 1, tag: 'Owner' });
  S.day = addDays(S.day, 2);
}

const HOME_PATTERN: Record<number, number[]> = { 3: [0, 1, 0], 7: [0, 0, 1, 1, 0, 1, 0] };

function playoffDay(world: World) {
  const S = world.season, P = S.playoffs!;
  const active = P.series.filter(s => s.round === P.round && !s.winner);
  for (const s of active) {
    const gi = s.wHi + s.wLo;
    const homeIsHi = HOME_PATTERN[s.bestOf][gi] === 0;
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
      addNews(world, `${W.name} eliminate ${L.name}`, `${W.city} wins the series ${Math.max(s.wHi, s.wLo)}–${Math.min(s.wHi, s.wLo)}.`, 'playoffs');
      addEvent(world, 'series', `${W.abbr} def. ${L.abbr} ${Math.max(s.wHi, s.wLo)}-${Math.min(s.wHi, s.wLo)} (round ${s.round})`);
    }
  }
  if (P.series.filter(s => s.round === P.round).every(s => s.winner)) advanceRound(world);
}

function advanceRound(world: World) {
  const S = world.season, P = S.playoffs!;
  const r = P.round;
  const rec = (id: string) => world.teams[id].w - world.teams[id].l;
  if (r === 1) {
    for (const conf of ['East', 'West']) {
      const seeds = (S as any)[`seeds${conf}`] as string[];
      const winners = P.series.filter(s => s.round === 1 && s.conf === conf).map(s => s.winner!).sort((a, b) => seeds.indexOf(a) - seeds.indexOf(b));
      // top seed plays the lowest remaining seed
      P.series.push({ id: `${conf}-SF-a`, round: 2, conf, hi: seeds[0], lo: winners[1], wHi: 0, wLo: 0, bestOf: 7, games: [] });
      P.series.push({ id: `${conf}-SF-b`, round: 2, conf, hi: seeds[1], lo: winners[0], wHi: 0, wLo: 0, bestOf: 7, games: [] });
    }
  } else if (r === 2) {
    for (const conf of ['East', 'West']) {
      const w = P.series.filter(s => s.round === 2 && s.conf === conf).map(s => s.winner!).sort((a, b) => rec(b) - rec(a));
      P.series.push({ id: `${conf}-F`, round: 3, conf, hi: w[0], lo: w[1], wHi: 0, wLo: 0, bestOf: 7, games: [] });
    }
  } else if (r === 3) {
    const w = P.series.filter(s => s.round === 3).map(s => s.winner!).sort((a, b) => rec(b) - rec(a));
    P.series.push({ id: `Finals`, round: 4, conf: 'NBA', hi: w[0], lo: w[1], wHi: 0, wLo: 0, bestOf: 7, games: [] });
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

// ------------------------------------------------------------------ awards (from simulated evidence only, F28)
export function perGame(p: Player, season: number, playoffs = false) {
  const ls = (p.stats ?? []).filter(s => s.season === season && !!s.playoffs === playoffs);
  const t: any = { g: 0, gs: 0, min: 0, pts: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, tpm: 0, tpa: 0 };
  for (const l of ls) for (const k in t) t[k] += (l as any)[k];
  const g = Math.max(1, t.g);
  return { ...t, ppg: t.pts / g, rpg: (t.oreb + t.dreb) / g, apg: t.ast / g, spg: t.stl / g, bpg: t.blk / g, mpg: t.min / g,
    fgp: t.fga ? t.fgm / t.fga : 0, ftp: t.fta ? t.ftm / t.fta : 0, team: ls.slice(-1)[0]?.team };
}

function computeAwards(world: World) {
  const y = world.season.year;
  const ps = Object.values(world.players).filter(p => (p.stats ?? []).some(s => s.season === y && !s.playoffs));
  const rows = ps.map(p => ({ p, s: perGame(p, y) })).filter(o => o.s.g >= 40);
  const winPct = (tid: string) => { const t = world.teams[tid]; return t ? t.w / Math.max(1, t.w + t.l) : 0.5; };
  const impact = (o: any) => o.s.ppg + 1.1 * o.s.rpg + 1.4 * o.s.apg + 2 * o.s.spg + 2 * o.s.bpg + (o.s.fgp - 0.45) * 40;
  const mvp = [...rows].sort((a, b) => (impact(b) + 18 * winPct(b.s.team)) - (impact(a) + 18 * winPct(a.s.team)));
  const isRookie = (p: Player) => (p as any).draftYear === y || (p.kind === 'prospect' && p.draftClass === y);
  const roy = [...rows].filter(o => isRookie(o.p)).sort((a, b) => impact(b) - impact(a));
  const allNBA = (pos: string[], n: number, excl: Set<string>) => mvp.filter(o => pos.includes(o.p.pos) && !excl.has(o.p.id)).slice(0, n);
  const used = new Set<string>();
  const team = () => { const t = [...allNBA(['PG', 'SG'], 2, used), ...allNBA(['SF', 'PF'], 2, used), ...allNBA(['C'], 1, used)]; t.forEach(o => used.add(o.p.id)); return t.map(o => o.p.id); };
  const first = team(), second = team();
  const defScore = (o: any) => 3 * o.s.spg + 3 * o.s.bpg + 0.5 * o.s.rpg + (o.p.r.perD + o.p.r.intD) / 20;
  const allDef = [...rows].filter(o => o.s.mpg >= 24).sort((a, b) => defScore(b) - defScore(a)).slice(0, 5).map(o => o.p.id);
  const coy = Object.values(world.teams).map(t => ({ t, d: (t.w - (projectedWinsCache[t.id] ?? 41)) })).sort((a, b) => b.d - a.d)[0];
  const aw: Record<string, any> = { MVP: mvp[0]?.p.id, ROY: roy[0]?.p.id, 'All-NBA 1st': first, 'All-NBA 2nd': second, 'All-Defensive': allDef, COY: null };
  const coyName = coy ? world.coaches[world.teams[coy.t.id].coach]?.name : null;
  const label: Record<string, string> = {};
  for (const [k, v] of Object.entries(aw)) {
    for (const id of (Array.isArray(v) ? v : v ? [v] : [])) {
      const p = world.players[id];
      if (p) { p.awards = p.awards ?? []; p.awards.push({ season: y, award: k }); label[k] = label[k] ? label[k] + ', ' + p.name : p.name; }
    }
  }
  aw.COY = coyName; label.COY = coyName ?? '';
  if (aw.MVP) addNews(world, `${world.players[aw.MVP].name} named MVP`, `Voting is simulated from this season's games, not history.`, 'awards');
  if (aw.ROY) addNews(world, `${world.players[aw.ROY].name} is Rookie of the Year`, '', 'awards');
  world.season.awards = aw;
}
export const projectedWinsCache: Record<string, number> = {};

function endSeason(world: World, runnerUp: string) {
  const S = world.season;
  computeAwards(world);
  for (const t of Object.values(world.teams)) {
    const res = S.champion === t.id ? 'Champion' : runnerUp === t.id ? 'Finals' : S.playoffs?.series.some(s => s.hi === t.id || s.lo === t.id) ? 'Playoffs' : 'Missed playoffs';
    t.history.push({ season: S.year, w: t.w, l: t.l, result: res });
  }
  world.pastSeasons.push({ year: S.year, champion: S.champion!, runnerUp, awards: S.awards ?? {}, standings: standings(world).map(t => ({ team: t.id, w: t.w, l: t.l })) });
  ownerSeasonReview(world);
  setupDraft(world);
}

// ------------------------------------------------------------------ draft (1977 rules: coin flip between conference last places)
export function setupDraft(world: World) {
  const S = world.season;
  S.phase = 'draft';
  const year = S.year + 1;
  const rng = stream(world.meta.seed, 'draft', year);
  const ts = Object.values(world.teams);
  const playoffTeams = new Set(S.playoffs?.series.flatMap(s => [s.hi, s.lo]) ?? []);
  const worstE = standings(world, 'East').slice(-1)[0].id, worstW = standings(world, 'West').slice(-1)[0].id;
  const flipWinner = rng.chance(0.5) ? worstE : worstW;
  const flipLoser = flipWinner === worstE ? worstW : worstE;
  const rest = ts.filter(t => t.id !== worstE && t.id !== worstW);
  const nonPO = rest.filter(t => !playoffTeams.has(t.id)).sort((a, b) => (a.w - a.l) - (b.w - b.l));
  const po = rest.filter(t => playoffTeams.has(t.id)).sort((a, b) => (a.w - a.l) - (b.w - b.l));
  const order1 = [flipWinner, flipLoser, ...nonPO.map(t => t.id), ...po.map(t => t.id)];
  addNews(world, `${world.teams[flipWinner].city} win the coin flip`, `${world.teams[flipWinner].name} pick first in the ${year} draft; ${world.teams[flipLoser].name} pick second.`, 'draft');
  const rounds = year === 1977 ? 8 : 7;
  const order: { pick: number; round: number; team: string }[] = [];
  let n = 1;
  for (let r = 1; r <= rounds; r++) for (const tid of order1) {
    const pk = world.teams[tid].picks.find(p => p.season === year && p.round === r && p.original === tid);
    let owner = tid;
    for (const t of Object.values(world.teams)) { const q = t.picks.find(p => p.season === year && p.round === r && p.original === tid); if (q) owner = q.owner; }
    order.push({ pick: n++, round: r, team: owner });
    void pk;
  }
  const pool = (world.draftClasses[String(year)] ?? []).filter(id => world.players[id] && !world.players[id].team);
  S.draft = { year, order, idx: 0, pool, board: [...pool].sort((a, b) => (world.players[b].scout?.pot?.mid ?? 0) - (world.players[a].scout?.pot?.mid ?? 0)) };
  const userPicks = order.filter(o => o.team === world.meta.userTeam && o.round <= 2).map(o => `#${o.pick}`);
  addMessage(world, { date: S.day, from: 'Director of scouting', role: 'Scout', subject: `${year} draft: we pick ${userPicks.join(', ') || 'late'}`, body: `The board is ready. Our reports show ranges, not certainties — some of these players will surprise everyone, both ways. Open Draft & Scouting to set the board and make our picks.`, urgent: 3, tag: 'Scouting', actions: [{ label: 'Open draft', cmd: 'goto', arg: 'draft' }] });
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
    const belief = (stream(world.meta.seed, 'belief', tid, id).normal(0, 5.5));
    const now = p.ovr + belief, pot = potentialOvr(p) + belief * 1.4 + stream(world.meta.seed, 'beliefP', tid, id).normal(0, 6);
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
    const sal = slot.round === 1 ? Math.round((150000 - slot.pick * 3500) / 5000) * 5000 : 45000;
    p.contract = { salary: Math.max(40000, sal), years: slot.round === 1 ? 3 : 2, known: null, provenance: 'RECONSTRUCTED — simulation only (rookie deal)', rookie: true, signed: world.season.day };
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
  for (const id of D.pool) { const p = world.players[id]; if (p && !p.team && !world.freeAgents.includes(id)) { world.freeAgents.push(id); p.rosterStatus = 'Undrafted free agent'; p.ask = 30000; } }
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
    const opp = clamp(0.55 + minutes / 3000, 0.55, 1.25);
    const coach = p.team ? world.coaches[world.teams[p.team].coach] : null;
    const coachFit = coach ? 0.85 + coach.development / 250 : 0.8;
    for (const k of Object.keys(p.r) as (keyof Player['r'])[]) {
      if (k === 'hgt') continue;
      const C = p.ceil[k]?.mu ?? p.r[k];
      const eta = age <= 21 ? 0.34 : age <= 23 ? 0.28 : age <= 25 ? 0.2 : age <= 27 ? 0.1 : 0.04;
      const physical = ['ath', 'stamina', 'blk', 'oreb', 'drive', 'perD'].includes(k);
      const decline = age >= 30 ? (physical ? 1.4 + (age - 30) * 0.55 : 0.4 + (age - 30) * 0.25) : 0;
      const delta = eta * opp * coachFit * Math.max(0, C - p.r[k]) - decline + rng.normal(0, 1.6);
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
    const r0 = -9 + 0.24 * (p.age - 20);
    const s = r0 + (p.injury?.severity === 'serious' ? 0.8 : 0) + (p.team ? -0.6 : 0.7) - (p.ovr - 55) / 12 + (p.traits.drive - 50) / -60;
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
  developPlayers(world);
  retirements(world);
  const year = S.year + 1;
  // franchise events (historical calendar; idempotent)
  const renames: Record<string, string> = {};
  for (const ev of world.franchiseEvents.filter((e: any) => e.season === year && !e.done)) {
    const t = world.teams[ev.team];
    if (!t) continue;
    t.city = ev.city; t.name = ev.name; t.logo = ev.logo; t.abbr = ev.abbr; ev.done = true;
    addNews(world, `The ${ev.city} ${ev.name}`, `Franchise event from the historical calendar: the ${ev.team === 'NYN' ? 'New York Nets move to New Jersey' : 'franchise relocates'}. Same franchise, new home.`, 'league');
    addEvent(world, 'franchise', `${ev.team} became ${ev.city} ${ev.name}`);
  }
  for (const t of Object.values(world.teams)) { t.w = t.l = t.homeW = t.homeL = t.streak = t.ptsFor = t.ptsAgainst = 0; t.minutesRequests = {}; }
  const sched = world.schedules[String(year)];
  world.season = { year, phase: 'preseason', day: `${year}-10-15`, games: sched ? buildSchedule(year, sched, world.teams, { NJN: 'NYN' }) : generateSchedule(world, year), playoffs: null, draft: null };
  const proj = projectedWins(world);
  Object.assign(projectedWinsCache, proj);
  world.owner.expectedWins = proj[world.meta.userTeam];
  world.owner.objective = proj[world.meta.userTeam] >= 48 ? 'Contend for the title.' : proj[world.meta.userTeam] >= 40 ? `Make the playoffs (owner expects about ${proj[world.meta.userTeam]} wins).` : 'Show real progress this season.';
  initScouting(world);
  addMessage(world, { date: world.season.day, from: world.owner.name, role: 'Owner', subject: `Expectations for ${year}–${String(year + 1).slice(2)}`, body: world.owner.objective, urgent: 1, tag: 'Owner' });
}

/** Fallback schedule generator (82 games, division-weighted) when no historical schedule is in the data pack. */
export function generateSchedule(world: World, year: number): GameRec[] {
  const rng = stream(world.meta.seed, 'schedule', year);
  const ids = Object.keys(world.teams);
  const pairs: [string, string][] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = world.teams[ids[i]], b = world.teams[ids[j]];
    const n = a.div === b.div ? 5 : a.conf === b.conf ? 4 : 3;
    for (let k = 0; k < n; k++) pairs.push(k % 2 ? [ids[i], ids[j]] : [ids[j], ids[i]]);
  }
  const games: GameRec[] = [];
  let day = `${year}-10-21`;
  const pool = pairs.sort(() => rng.next() - 0.5);
  while (pool.length) {
    const busy = new Set<string>();
    const todays: [string, string][] = [];
    for (let i = 0; i < pool.length && todays.length < 8; i++) {
      const [h, a] = pool[i];
      if (!busy.has(h) && !busy.has(a)) { busy.add(h); busy.add(a); todays.push(pool[i]); pool.splice(i, 1); i--; }
    }
    todays.forEach(([h, a]) => games.push({ id: `${year}-${String(games.length + 1).padStart(4, '0')}`, date: day, home: h, away: a }));
    day = addDays(day, 1);
  }
  return games;
}

export { teamStrength };
