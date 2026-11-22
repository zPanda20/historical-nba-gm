// New-game creation from the canonical data pack (GDD §2, §21.1). No historical outcomes are scheduled.
import type { ClockState, Coach, GameRec, Player, Team, World } from './types';
import { MODEL_VERSION, stream, clamp } from './rng';
import { playerValue } from './coach';
import { eraRules, setEraYear } from './history';
import { classData, injectClass } from './seasons';
import { shapeCareer, shapeDraftOutlier, hypeOf } from './impact';
import { initPeople } from './people';
import { noteEvent } from './chronicle';

export const SCHEMA = 1;

export function teamStrength(world: World, tid: string): number {
  const ps = world.teams[tid].roster.map(id => world.players[id]).filter(Boolean)
    .filter(p => !(p.injury && p.injury.daysLeft > 20)).map(playerValue).sort((a, b) => b - a);
  const w = [1, 1, 0.95, 0.9, 0.85, 0.6, 0.45, 0.35, 0.2, 0.1];
  let s = 0; ps.slice(0, 10).forEach((v, i) => (s += v * w[i]));
  return s;
}

export function projectedWins(world: World): Record<string, number> {
  const ids = Object.keys(world.teams);
  const st = ids.map(id => teamStrength(world, id));
  const mean = st.reduce((a, b) => a + b, 0) / st.length;
  const sd = Math.sqrt(st.reduce((a, b) => a + (b - mean) ** 2, 0) / st.length) || 1;
  const out: Record<string, number> = {};
  const G = eraRules(world.season?.year ?? 1976).games;
  ids.forEach((id, i) => (out[id] = Math.round(clamp(41 + ((st[i] - mean) / sd) * 9.5, 15, 65) * G / 82)));
  return out;
}

export function buildSchedule(year: number, data: [string, string, string][], teams: Record<string, Team>, renames: Record<string, string>): GameRec[] {
  return data.map((g, i) => ({ id: `${year}-${String(i + 1).padStart(4, '0')}`, date: g[0], home: renames[g[1]] ?? g[1], away: renames[g[2]] ?? g[2] }))
    .filter(g => teams[g.home] && teams[g.away]);
}

export function createWorld(data: any, opts: { userTeam: string; mode: 'career' | 'sandbox'; gmName: string; seed?: string }): World {
  const seed = opts.seed || `NBA-${Date.now().toString(36)}`;
  const players: Record<string, Player> = {};
  setEraYear(1976);
  const useClasses = !!classData();
  for (const p of data.players as Player[]) {
    if (useClasses && p.kind === 'prospect' && p.draftClass) continue; // classes.json supersedes the 1977-80 classes in the base pack
    players[p.id] = { ...p, injury: null, stats: [], awards: [], morale: 60, fatigueSeason: 0 };
    players[p.id].ovr = Math.round(playerValue(players[p.id]));
    shapeCareer(players[p.id], 1976); shapeDraftOutlier(players[p.id]);
    if (players[p.id].team) (players[p.id] as any).birdYears = 3; // established on their 1976 clubs
  }
  const coaches: Record<string, Coach> = {};
  for (const c of data.coaches as Coach[]) coaches[c.id] = { ...c, trustGM: 55 };
  const teams: Record<string, Team> = {};
  for (const t of data.teams) {
    teams[t.id] = { ...t, w: 0, l: 0, homeW: 0, homeL: 0, streak: 0, ptsFor: 0, ptsAgainst: 0, history: [], picks: [], minutesRequests: {} };
    for (const season of [1977, 1978, 1979]) for (let round = 1; round <= (season === 1977 ? 8 : 7); round++)
      teams[t.id].picks.push({ season, round, original: t.id, owner: t.id });
  }
  const world: World = {
    meta: { saveId: `save-${seed}`, title: `${opts.gmName} — ${teams[opts.userTeam].city} ${teams[opts.userTeam].name}`, seed, created: new Date().toISOString(),
      modelVersion: MODEL_VERSION, dataVersion: data.version, schema: SCHEMA, mode: opts.mode, gmName: opts.gmName, userTeam: opts.userTeam, abaSurvivors: [] },
    rules: data.rules, anchors: data.anchors, teams, players, coaches, freeAgents: [...data.freeAgents], draftClasses: useClasses ? {} : data.draftClasses,
    schedules: data.schedules, franchiseEvents: data.franchiseEvents,
    season: { year: 1976, phase: 'preseason', day: '1976-10-18', games: [], playoffs: null, draft: null },
    pastSeasons: [], messages: [], news: [], events: [],
    owner: { name: teams[opts.userTeam].owner, patience: 55, wantsWins: 60, budget: 0, satisfaction: 60, expectedWins: 41, objective: '' },
    clock: 'Contending', gmRep: 50, scoutBudget: 2, log: { seq: 0 }, tradeHistory: [], promises: [],
  };
  (world as any).impactVersion = 1; (world as any).contractsVersion = 1; // created with career shapes and current scouting
  world.season.games = buildSchedule(1976, data.schedules['1976'], teams, {});
  if (useClasses) injectClass(world, 1977);
  // franchise clocks + owner expectations from projected strength
  const proj = projectedWins(world);
  for (const id in teams) teams[id].clock = proj[id] >= 50 ? 'Win Now' : proj[id] >= 43 ? 'Contending' : proj[id] >= 36 ? 'Building' : 'Rebuilding';
  world.clock = teams[opts.userTeam].clock as ClockState;
  const rng = stream(seed, 'owner', 'init');
  world.owner.expectedWins = proj[opts.userTeam];
  world.owner.patience = Math.round(40 + rng.next() * 35);
  world.owner.wantsWins = Math.round(45 + rng.next() * 40);
  const payroll = teams[opts.userTeam].roster.reduce((s, id) => s + (players[id].contract?.salary ?? 0), 0);
  world.owner.budget = Math.round(payroll * 1.08 / 10000) * 10000;
  world.owner.objective = proj[opts.userTeam] >= 48 ? 'Win the division and go deep in the playoffs.' : proj[opts.userTeam] >= 40 ? `Make the playoffs (owner expects about ${proj[opts.userTeam]} wins).` : 'Show progress: compete hard and develop young players.';
  for (const id in teams) teams[id].payrollBudget = Math.round(teams[id].roster.reduce((s, pid) => s + (players[pid].contract?.salary ?? 0), 0) * 1.08);
  // user coach trust starts neutral-plus
  world.coaches[teams[opts.userTeam].coach].trustGM = 58;
  initPeople(world);
  initScouting(world);
  return world;
}

/** Prospect beliefs for the user's front office (F11/F12): biased, noisy, tightened by reports. */
export function initScouting(world: World) {
  const rng = stream(world.meta.seed, 'scouting', 'init', world.season.year);
  const cls = world.draftClasses[String(world.season.year + 1)] ?? [];
  // department bias: this front office overrates athletes, underrates cognition (S1 error classes), randomised per save
  const athBias = rng.normal(1, 1.5), iqBias = rng.normal(-1, 1.5);
  for (const id of cls) {
    const p = world.players[id];
    if (!p) continue;
    p.scout = {};
    const keyVal = (o: number) => o;
    const trueNow = p.ovr, truePot = potentialOvr(p);
    const bias = (p.r.ath - 55) / 15 * athBias + (p.r.iq - 55) / 15 * iqBias;
    // the league's consensus read travels with every department: a prospect everyone misjudged starts misjudged here too
    const hype = hypeOf(p);
    const noise = rng.normal(0, 3), noiseP = rng.normal(0, 4);
    const mid = keyVal(trueNow + bias + noise + hype * 0.5), midP = truePot + bias + noiseP + hype;
    p.scout['now'] = { lo: Math.round(mid - 4), hi: Math.min(99, Math.round(mid + 4)), mid: Math.round(mid), reports: 0 };
    p.scout['pot'] = { lo: Math.round(midP - 6), hi: Math.min(99, Math.round(midP + 6)), mid: Math.min(99, Math.round(midP)), reports: 0 };
  }
}

export function potentialOvr(p: Player): number {
  const c = p.ceil;
  const r: any = { ...p.r };
  for (const k in c) r[k] = Math.max(p.r[k as keyof typeof p.r] as number, c[k].mu);
  return Math.round(playerValue({ ...p, r }));
}

export function addMessage(world: World, m: Omit<World['messages'][number], 'id' | 'read'>) {
  world.log.seq++;
  world.messages.unshift({ ...m, id: `m${world.log.seq}`, read: false });
  if (world.messages.length > 200) world.messages.length = 200;
}
export function addNews(world: World, head: string, body: string, kind = 'league') {
  world.log.seq++;
  world.news.unshift({ id: `n${world.log.seq}`, date: world.season.day, head, body, kind });
  if (world.news.length > 150) world.news.length = 150;
}
export function addEvent(world: World, type: string, text: string, ids?: string[]) {
  world.log.seq++;
  world.events.push({ seq: world.log.seq, date: world.season.day, type, text, ids });
  if (world.events.length > 3000) world.events.splice(0, world.events.length - 3000);
  noteEvent(world, type, text, ids);
}
