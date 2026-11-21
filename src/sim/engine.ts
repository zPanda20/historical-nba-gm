// Possession-by-possession basketball engine (GDD §7). Discrete-event, zone/action model.
// The SAME function resolves watched and fast-simmed games; `log` only controls text output.
import type { BoxLine, BoxScore, Coach, GameEvent, Player, Team, World } from './types';
import { injuryRisk } from './impact';
import { twoWayCanPlay } from './rules';
import { Rng, clamp, logit, sigmoid, stream, z } from './rng';
import { Gameplan, makeGameplan, playerValue, POSITIONS, PosKey, posScore } from './coach';
import { eraRules, eraStyle } from './history';

/** Alpha calibration constants (provisional; tuned to 1976-77 league anchors). */
export const CAL = {
  baseMake: { rim: 0.56, close: 0.44, smid: 0.405, lmid: 0.37, three: 0.31 } as Record<string, number>,
  bShoot: 0.26, bContest: 0.2, bPass: 0.12, bFat: 0.9, homeLogit: 0.07,
  tov: { post: 0.155, iso: 0.14, motion: 0.165, high: 0.15, pnr: 0.16, spot: 0.12, trans: 0.17, putback: 0.06 } as Record<string, number>,
  stealShare: 0.44,
  shootFoul: { rim: 0.2, close: 0.16, smid: 0.075, lmid: 0.05, three: 0.03 } as Record<string, number>,
  andOne: 0.24,
  reachFoul: 0.11,
  oreb: 0.33,
  secHalf: 14.1, secTrans: 6.0, transRate: 0.2,
  ft: 0.752,
  spread: 0.47, // compresses percentile-based ratings (uniform 30-92) toward a realistic talent spread
  fatOn: 0.036, fatOff: 0.075,
  injuryPerMin: 0.00022,
  threeElig: 0.5, threeK: 1.0, paceExp: 1.12, twoK: 1.0,
};
/** Ball security improves across eras (fewer turnovers per possession). */
function tovEra(year: number) {
  const pts: [number, number][] = [[1976, 0], [1984, -0.04], [1990, -0.11], [2000, -0.14], [2010, -0.17], [2025, -0.19], [2040, -0.2]];
  for (let i = 0; i < pts.length - 1; i++) if (year <= pts[i + 1][0]) { const k = Math.max(0, (year - pts[i][0]) / (pts[i + 1][0] - pts[i][0])); return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k; }
  return -0.2;
}
/** Two-point finishing gets easier as floors open up (spacing, rules against hand-checking, rim-first shot selection). */
function twoEra(year: number) {
  const pts: [number, number][] = [[1976, 0], [1979, 0.05], [1983, 0.12], [1987, 0.13], [1991, 0.12], [1995, 0.06], [1999, 0], [2003, 0.01], [2006, 0.05], [2012, 0.09], [2020, 0.15], [2026, 0.26], [2040, 0.28]];
  for (let i = 0; i < pts.length - 1; i++) if (year <= pts[i + 1][0]) { const k = Math.max(0, (year - pts[i][0]) / (pts[i + 1][0] - pts[i][0])); return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k; }
  return 0.26;
}
/** Era three-point accuracy baseline (league average make on a neutral look). */
function threeBase(year: number, short: boolean) {
  if (short) return 0.33;
  const pts: [number, number][] = [[1979, 0.255], [1984, 0.255], [1988, 0.272], [1993, 0.282], [1997, 0.31], [2005, 0.315], [2015, 0.322], [2020, 0.327], [2040, 0.327]];
  for (let i = 0; i < pts.length - 1; i++) if (year <= pts[i + 1][0]) { const k = Math.max(0, (year - pts[i][0]) / (pts[i + 1][0] - pts[i][0])); return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k; }
  return 0.36;
}

type ShotType = 'rim' | 'close' | 'smid' | 'lmid' | 'three';
const SHOT_MIX: Record<string, [ShotType, number][]> = {
  post: [['rim', 0.38], ['close', 0.4], ['smid', 0.17], ['lmid', 0.05]],
  iso: [['rim', 0.3], ['close', 0.1], ['smid', 0.26], ['lmid', 0.34]],
  motion: [['rim', 0.36], ['close', 0.12], ['smid', 0.26], ['lmid', 0.26]],
  high: [['rim', 0.22], ['close', 0.12], ['smid', 0.42], ['lmid', 0.24]],
  pnr: [['rim', 0.34], ['close', 0.1], ['smid', 0.3], ['lmid', 0.26]],
  spot: [['smid', 0.32], ['lmid', 0.68]],
  trans: [['rim', 0.66], ['close', 0.08], ['smid', 0.14], ['lmid', 0.12]],
  putback: [['rim', 0.75], ['close', 0.25]],
};
const ASSIST_P: Record<string, number> = { post: 0.44, iso: 0.12, motion: 0.84, high: 0.7, pnr: 0.62, spot: 0.9, trans: 0.6, putback: 0.0 };

interface PState { p: Player; slot: number; sec: number; F: number; fouls: number; out: boolean; injured: boolean; line: BoxLine; pos?: PosKey; mis: number; best: number; }
interface Side { team: Team; coach: Coach; plan: Gameplan; ps: PState[]; on: PState[]; teamFouls: number; score: number; qScore: number[]; }

export interface GameResult { hs: number; as: number; ot: number; box: BoxScore; log: GameEvent[]; injuries: { pid: string; days: number; type: string }[]; minutes: Record<string, number>; }

/** League rating centers (rotation players), so z-scores are relative to the era's talent, not a fixed 55. */
const centerCache = new WeakMap<object, { key: string; c: Record<string, number> }>();
function centers(world: World): Record<string, number> {
  const key = `${world.season.year}-${world.season.phase}`;
  const hit = centerCache.get(world);
  if (hit && hit.key === key) return hit.c;
  const ps = Object.values(world.teams).flatMap(t => t.roster.map(id => world.players[id])).filter(Boolean);
  const rot = ps.sort((a, b) => playerValue(b) - playerValue(a)).slice(0, Object.keys(world.teams).length * 9);
  const c: Record<string, number> = {};
  for (const k of Object.keys(rot[0].r)) c[k] = rot.reduce((a, p) => a + (p.r as any)[k], 0) / rot.length;
  centerCache.set(world, { key, c });
  return c;
}

const fmtClock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const last = (p: Player) => p.name.split(' ').slice(-1)[0];

export function simulateGame(world: World, gameId: string, homeId: string, awayId: string, opts: { log?: boolean; playoff?: boolean; neutral?: boolean } = {}): GameResult {
  const ER = eraRules(world.season.year);
  const rules = { ...(world.rules['1976'] ?? {}), ...(world.rules[String(world.season.year)] ?? {}), three: ER.three };
  const ST = eraStyle(world.season.year, world.meta.seed);
  const paceK = Math.pow(106.5 / ST.pace, CAL.paceExp) * (1 - 0.025 * clamp((world.season.year - 1980) / 10, 0, 1));
  const threeShare = rules.three ? ST.tpa / (ST.pace * 0.88) : 0;
  // early-80s shooters rarely let it fly; their ratings carry little three-point signal, so the era nudge is bigger
  const p3 = clamp(threeShare / CAL.threeElig * CAL.threeK * (0.77 + Math.max(0, threeShare - 0.2) * 1.2) * (1 + 0.5 * clamp((1987 - world.season.year) / 8, 0, 1)), 0, 0.97);
  const base3 = threeBase(world.season.year, ER.threeShort);
  const two = twoEra(world.season.year) * CAL.twoK;
  const tovE = tovEra(world.season.year);
  const foulE = 1 - 0.17 * clamp((world.season.year - 2004) / 16, 0, 1);
  const rng = stream(world.meta.seed, 'game', gameId);
  const irng = stream(world.meta.seed, 'injury', gameId);
  const mk = (tid: string): Side => {
    const team = world.teams[tid];
    const coach = world.coaches[team.coach];
    const plan = makeGameplan(world, team, coach);
    let avail = team.roster.map(id => world.players[id]).filter(p => p && !(p.injury && p.injury.daysLeft > 0) && twoWayCanPlay(world, p));
    // a decimated team still has to field five: the least-hurt players suit up
    if (avail.length < 5) avail = team.roster.map(id => world.players[id]).filter(Boolean).sort((a, b) => (a.injury?.daysLeft ?? 0) - (b.injury?.daysLeft ?? 0)).slice(0, Math.max(5, avail.length));
    const ps: PState[] = avail.map((p, i) => ({ p, slot: i, sec: 0, mis: 0, best: Math.max(...POSITIONS.map(q => posScore(p, q))), F: 0.04 + (100 - (p.cond ?? 100)) / 100 * 0.55 + (p.fatigueSeason ?? 0) * 0.08, fouls: 0, out: false, injured: false,
      line: { pid: p.id, name: p.name, min: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pm: 0, gs: false } }));
    const on = plan.starters.map(id => ps.find(x => x.p.id === id)!).filter(Boolean);
    for (const x of ps) if (on.length < 5 && !on.includes(x)) on.push(x);
    on.forEach(x => (x.line.gs = true));
    const sd: Side = { team, coach, plan, ps, on, teamFouls: 0, score: 0, qScore: [] };
    for (const x of on) x.pos = (plan.slots?.[x.p.id] as PosKey) ?? undefined;
    assignSlots(sd, []);
    return sd;
  };
  // every man on the floor holds a spot; playing a spot you are not built for costs you on both ends
  const structureOf = (sd: Side) => clamp(1.25 - (sd.coach.tactics + sd.coach.adaptability) / 170, 0.55, 1.05);
  function assignSlots(sd: Side, kept: PState[]) {
    const taken = new Set(kept.map(x => x.pos));
    const incoming = sd.on.filter(x => !kept.includes(x) && !(x.pos && !taken.has(x.pos) && sd.on.filter(y => y.pos === x.pos).length === 1));
    for (const x of sd.on) if (!incoming.includes(x) && x.pos) taken.add(x.pos);
    for (const x of incoming.sort((a, b) => playerValue(b.p) - playerValue(a.p))) {
      const free = POSITIONS.filter(q => !taken.has(q));
      x.pos = free.sort((a, b) => posScore(x.p, b) - posScore(x.p, a))[0] ?? x.pos ?? (x.p.pos as PosKey);
      taken.add(x.pos);
    }
    const m = structureOf(sd);
    for (const x of sd.on) x.mis = x.pos ? Math.max(0, x.best - posScore(x.p, x.pos) - 2) * 0.5 * m : 0;
  }
  const S: [Side, Side] = [mk(homeId), mk(awayId)];
  const log: GameEvent[] = [];
  const injuries: GameResult['injuries'] = [];
  const actions: Record<string, number> = {};
  let q = 1, clock = rules.qMin * 60, off = 0, poss = 0, ot = 0;
  const qLen = () => (q <= rules.quarters ? rules.qMin : rules.otMin) * 60;
  const emit = (type: string, team: number, text: string, pid?: string) => {
    if (opts.log) log.push({ q, clock, type, team, text, score: [S[0].score, S[1].score], pid });
  };
  const elapsedGame = () => (Math.min(q, 4) - 1) * rules.qMin * 60 + (q <= 4 ? qLen() - clock : 0) + (q > 4 ? 4 * rules.qMin * 60 : 0);

  // jump ball
  const cH = Math.max(...S[0].on.map(x => x.p.r.hgt + x.p.r.ath / 20)), cA = Math.max(...S[1].on.map(x => x.p.r.hgt + x.p.r.ath / 20));
  const tipWinner = rng.chance(sigmoid((cH - cA) * 0.35)) ? 0 : 1;
  off = tipWinner;
  emit('tip', off, `${S[off].team.name} win the opening tip.`);

  const C = centers(world);
  // effective rating re-centred on the league so z(eff) = 0 for an average rotation player
  const eff = (x: PState, k: keyof Player['r']) => 55 + (x.p.r[k] - C[k]) * CAL.spread - 30 * Math.max(0, x.F - 0.3) - x.mis;
  const homeEdge = (team: number) => (opts.neutral ? 0 : team === 0 ? 1 : -1);
  // lineup structure: who can bring the ball up, how many shooters space the floor, how many slow bigs share it
  const lineup = (sd: Side) => {
    let bh = -9, sp = 0, bigs = 0;
    for (const x of sd.on) {
      bh = Math.max(bh, z(eff(x, 'handle')) * 0.6 + z(eff(x, 'pass')) * 0.4);
      const sk = rules.three ? Math.max(eff(x, 'three'), eff(x, 'mid') - 8) : eff(x, 'mid');
      sp += sigmoid((sk - 52) / 5);
      if (x.p.r.hgt >= 81 && x.p.r.handle < 52) bigs++;
    }
    return { bh, sp, bigs };
  };
  // a coach with a real plan (tactics, adaptability) softens the cost of an odd lineup; no plan, full cost
  const structure = (sd: Side) => clamp(1.3 - (sd.coach.tactics + sd.coach.adaptability) / 150, 0.45, 1);

  const addPts = (side: number, n: number) => {
    S[side].score += n;
    for (const x of S[side].on) x.line.pm += n;
    for (const x of S[1 - side].on) x.line.pm -= n;
  };

  const runClock = (sec: number) => {
    const t = Math.min(sec, clock);
    clock -= t;
    for (let s = 0; s < 2; s++) {
      for (const x of S[s].ps) {
        if (S[s].on.includes(x)) {
          x.sec += t;
          x.F = clamp(x.F + (t / 60) * CAL.fatOn * (1.35 - x.p.r.stamina / 100) / S[s].plan.pace, 0, 1);
          // injury hazard (exposure = minutes on floor)
          if (!x.injured && irng.chance(CAL.injuryPerMin * injuryRisk(x.p) * (t / 60) * (1 + Math.max(0, (x.p.age ?? 27) - 30) * 0.06) * (1 + x.F))) {
            x.injured = true;
            const roll = irng.next();
            const sev = roll < 0.62 ? 'minor' : roll < 0.9 ? 'moderate' : 'serious';
            const days = sev === 'minor' ? irng.int(1, 7) : sev === 'moderate' ? irng.int(8, 28) : irng.int(30, 110);
            const types = sev === 'serious' ? ['knee', 'foot', 'back', 'Achilles strain'] : ['ankle sprain', 'bruised thigh', 'hamstring strain', 'sore back', 'finger', 'groin strain'];
            const type = irng.pick(types);
            injuries.push({ pid: x.p.id, days, type });
            emit('injury', s, `${x.p.name} goes down with a ${type} and heads to the locker room.`, x.p.id);
          }
        } else x.F = Math.max(0, x.F - (t / 60) * CAL.fatOff);
      }
    }
  };

  // ------------------------------------------------------------------ substitutions (coach-owned)
  const subs = (force = false) => {
    const el = elapsedGame();
    const late = q >= 4 && clock < 300;
    const margin = S[0].score - S[1].score;
    for (let s = 0; s < 2; s++) {
      const side = S[s];
      const lead = s === 0 ? margin : -margin;
      const garbage = q >= 4 && clock < 360 && Math.abs(lead) >= 20;
      const cand = side.ps.filter(x => !x.out && !x.injured);
      const score = (x: PState) => {
        const tgt = side.plan.targetMin[x.p.id] ?? 0;
        const expected = tgt * 60 * (el / (4 * rules.qMin * 60));
        let sc = side.plan.priority[x.p.id] ?? 0;
        sc += playerValue(x.p) / 12;
        sc -= 13 * Math.max(0, x.F - 0.22);
        if (!late && !garbage) sc -= Math.max(0, x.sec - expected) / 60 * 1.5 - Math.max(0, expected - x.sec) / 60 * 0.35;
        if (late && !garbage) sc -= Math.max(0, x.sec - expected - 240) / 60 * 0.6;
        if (tgt === 0 && !garbage) sc -= 6;
        const trouble = x.fouls >= (q <= 4 ? (q === 4 && clock < 360 ? 6 : q + 1) : 6);
        if (trouble && !late) sc -= 5;
        if (garbage) sc = -(side.plan.priority[x.p.id] ?? 0) + (tgt === 0 ? 2 : 0) - 9 * Math.max(0, x.F - 0.4);
        return sc;
      };
      const scored = cand.map(x => ({ x, sc: score(x) })).sort((a, b) => b.sc - a.sc);
      const isBig = (x: PState) => x.p.pos === 'C' || x.p.pos === 'PF';
      const isG = (x: PState) => x.p.pos === 'PG' || x.p.pos === 'SG';
      const want: PState[] = [];
      for (const { x } of scored) {
        if (want.length >= 5) break;
        const left = 5 - want.length;
        if (left === 1 && !want.some(isBig) && !isBig(x) && cand.some(isBig)) continue;
        if (left === 1 && !want.some(isG) && !isG(x) && cand.some(isG)) continue;
        if (isBig(x) && want.filter(isBig).length >= 3) continue;
        want.push(x);
      }
      for (const { x } of scored) if (want.length < 5 && !want.includes(x)) want.push(x);
      // hysteresis: only change players whose replacement is clearly better (unless forced / unavailable)
      const scoreOf = new Map(scored.map(o => [o.x, o.sc]));
      const next: PState[] = [];
      for (const x of side.on) if (!x.out && !x.injured && (want.includes(x) || (!force && (scoreOf.get(x) ?? -99) > Math.min(...want.filter(w => !side.on.includes(w)).map(w => scoreOf.get(w) ?? 0), 99) - 0.9))) next.push(x);
      for (const w of want) if (next.length < 5 && !next.includes(w)) next.push(w);
      while (next.length > 5) next.pop();
      for (const x of cand) if (next.length < 5 && !next.includes(x)) next.push(x);
      // no one left on the bench: a fouled-out player stays in (the rule), then the walking wounded
      for (const x of [...side.ps].sort((a, b) => Number(a.injured) - Number(b.injured))) if (next.length < 5 && !next.includes(x)) next.push(x);
      const changed = next.filter(x => !side.on.includes(x));
      if (changed.length && opts.log) emit('sub', s, `${side.team.name} sub: ${changed.map(x => last(x.p)).join(', ')} in.`);
      const kept = next.filter(x => side.on.includes(x));
      side.on = next;
      if (changed.length) assignSlots(side, kept);
    }
  };

  // ------------------------------------------------------------------ helpers
  const pickW = (arr: PState[], w: (x: PState) => number) => arr[rng.weighted(arr.map(w))];
  const defenderOf = (actor: PState, d: Side) => {
    const order = ['PG', 'SG', 'SF', 'PF', 'C'];
    const mate = actor.pos ? d.on.find(x => x.pos === actor.pos) : undefined;
    if (mate) return mate;
    const ai = order.indexOf(actor.p.pos);
    return [...d.on].sort((a, b) => Math.abs(order.indexOf(a.p.pos) - ai) - Math.abs(order.indexOf(b.p.pos) - ai) || eff(b, 'perD') - eff(a, 'perD'))[0];
  };

  const freeThrows = (s: number, shooter: PState, n: number, lastLive = true): boolean => {
    let made = 0;
    for (let i = 0; i < n; i++) {
      const p = clamp(sigmoid(logit(CAL.ft) + 0.7 * z(eff(shooter, 'ft'))), 0.35, 0.93);
      shooter.line.fta++;
      if (rng.chance(p)) { shooter.line.ftm++; shooter.line.pts++; addPts(s, 1); made++; }
    }
    emit('ft', s, `${shooter.p.name} makes ${made} of ${n} at the line.`, shooter.p.id);
    // last FT missed -> live rebound (defense mostly)
    return lastLive && made < n && rng.chance(0.85) ? false : true;
  };

  const foulOn = (s: number, defender: PState) => {
    defender.fouls++; defender.line.pf++;
    S[s].teamFouls++;
    if (defender.fouls >= rules.foulOut) {
      defender.out = true;
      emit('foulout', s, `${defender.p.name} fouls out.`, defender.p.id);
    }
  };

  const rebound = (o: number, shotType: ShotType): { side: number; who: PState } => {
    const O = S[o], D = S[1 - o];
    const oz = O.on.reduce((a, x) => a + z(eff(x, 'oreb')) + (x.p.r.hgt - 79) / 10, 0) / 5;
    const dz = D.on.reduce((a, x) => a + z(eff(x, 'dreb')) + (x.p.r.hgt - 79) / 10, 0) / 5;
    const pO = clamp(sigmoid(logit(CAL.oreb) + 0.4 * (oz - dz) + (shotType === 'lmid' ? 0.05 : 0)), 0.12, 0.55);
    const side = rng.chance(pO) ? o : 1 - o;
    const pool = S[side].on;
    const key = side === o ? 'oreb' : 'dreb';
    const who = pickW(pool, x => Math.exp(0.42 * z(eff(x, key as any)) + (x.p.r.hgt - 79) / 14));
    if (side === o) who.line.oreb++; else who.line.dreb++;
    return { side, who };
  };

  // ------------------------------------------------------------------ one possession
  let ctx: 'half' | 'trans' | 'putback' = 'half';
  let putbackBy: PState | null = null;
  const possession = () => {
    const O = S[off], D = S[1 - off];
    poss++;
    const LO = lineup(O), LD = lineup(D), mO = structure(O), mD = structure(D);
    let shotClock = rules.shotClock;
    let action: string;
    if (ctx === 'putback') action = 'putback';
    else if (ctx === 'trans') action = 'trans';
    else {
      const w = O.plan.action;
      const keys = Object.keys(w);
      action = keys[rng.weighted(keys.map(k => w[k]))];
    }
    actions[action] = (actions[action] ?? 0) + 1;
    // time used
    let t = action === 'trans' ? clamp(rng.normal(CAL.secTrans, 2), 2, 11) : action === 'putback' ? clamp(rng.normal(3, 1.2), 1, 6) : clamp(rng.normal(CAL.secHalf * O.plan.pace * paceK, 4.2), 4, shotClock - 1);
    const hurry = clock <= t + 1;
    if (hurry) t = Math.max(0.5, clock - 0.5);
    // actor
    // shot-taking share is driven by the player's real usage tendency (FGA rate), nudged by fit for the action
    const useW = (x: PState) => Math.max(2, 8 + (eff(x, 'usage') - 30) * 0.26);
    const actorW = (x: PState) => {
      const r = x.p.r;
      const u = useW(x);
      switch (action) {
        case 'post': return u * Math.exp((eff(x, 'post') - 55) / 40 + (r.hgt - 80) / 14);
        case 'iso': return u * Math.exp((eff(x, 'drive') + eff(x, 'mid') - 110) / 80);
        case 'high': return u * Math.exp((eff(x, 'mid') + eff(x, 'pass') - 110) / 80 + (r.hgt - 80) / 18);
        case 'pnr': return u * Math.exp((eff(x, 'handle') + eff(x, 'drive') - 110) / 70);
        case 'spot': return u * Math.exp(((threeShare > 0.15 ? eff(x, 'three') * Math.min(1, threeShare * 2) + eff(x, 'mid') * (1 - Math.min(1, threeShare * 2)) : eff(x, 'mid')) - 55) / 45);
        case 'trans': return u * Math.exp((eff(x, 'ath') + eff(x, 'drive') - 110) / 80);
        case 'putback': return 1;
        default: return u * Math.exp((eff(x, 'ins') + eff(x, 'iq') - 110) / 90);
      }
    };
    let actor = action === 'putback' && putbackBy ? putbackBy : pickW(O.on, actorW);
    const def = defenderOf(actor, D);
    const press = D.plan.pressure;

    // turnover (competing branch, F4)
    const ballZ = (z(eff(actor, 'handle')) * 0.6 + z(eff(actor, 'iq')) * 0.25 + z(eff(actor, 'pass')) * 0.15);
    const pTO = clamp(sigmoid(logit(CAL.tov[action] ?? 0.14) + tovE - 0.22 * ballZ + 0.15 * z(eff(def, 'stl')) + (press - 0.55) * 0.6 + 0.25 * Math.max(0, actor.F - 0.4) + 0.55 * mO * Math.max(0, 0.25 - LO.bh)), 0.02, 0.42);
    if (!hurry && rng.chance(pTO)) {
      runClock(Math.max(1, t * 0.6));
      actor.line.tov++;
      const stealP = clamp(CAL.stealShare + 0.08 * z(eff(def, 'stl')) + (press - 0.55) * 0.3, 0.15, 0.7);
      if (rng.chance(stealP)) {
        const stealer = rng.chance(0.65) ? def : pickW(D.on, x => Math.exp(0.45 * z(eff(x, 'stl'))));
        stealer.line.stl++;
        emit('steal', 1 - off, `${stealer.p.name} picks off ${last(actor.p)} and the ${D.team.name} are running.`, stealer.p.id);
        ctx = rng.chance(0.62) ? 'trans' : 'half';
      } else {
        emit('tov', off, `Turnover by ${actor.p.name}${rng.chance(0.4) ? ' — travelling' : rng.chance(0.5) ? ' — bad pass out of bounds' : ' — offensive foul'}.`, actor.p.id);
        ctx = 'half';
      }
      off = 1 - off;
      return;
    }

    // reach/hold foul before shot (non-shooting)
    if (!hurry && action !== 'putback' && rng.chance(CAL.reachFoul * (0.8 + press * 0.5))) {
      runClock(t * 0.45);
      foulOn(1 - off, def);
      if (D.teamFouls > rules.teamFoulBonus) {
        emit('foul', 1 - off, `${def.p.name} reaches in — ${O.team.name} in the bonus.`, def.p.id);
        const ok = freeThrows(off, actor, 2);
        if (!ok) { const rb = rebound(off, 'rim'); ctx = 'half'; if (rb.side !== off) { off = 1 - off; } }
        else { off = 1 - off; ctx = 'half'; }
        subs();
        return;
      }
      emit('foul', 1 - off, `Foul on ${def.p.name}; ${O.team.name} inbound.`, def.p.id);
      subs();
      ctx = 'half';
      return; // same offense keeps the ball (new possession counter is acceptable at alpha)
    }

    runClock(t);

    // double team on elite post
    let shooter = actor, assister: PState | null = null, shotType: ShotType;
    let contest = z(eff(def, ['post', 'trans', 'putback'].includes(action) ? 'intD' : 'perD'));
    if (action === 'post' && z(eff(actor, 'post')) > 1.0 && rng.chance(D.plan.doubleTeam)) {
      // kick-out to an open teammate
      emit('double', 1 - off, `${D.team.name} double ${last(actor.p)} in the post.`, actor.p.id);
      assister = actor;
      shooter = pickW(O.on.filter(x => x !== actor), x => useW(x) * Math.exp((eff(x, 'mid') - 55) / 45));
      shotType = rng.chance(0.4) ? 'smid' : 'lmid';
      contest = -0.9;
    } else {
      const mix = SHOT_MIX[action];
      shotType = mix[rng.weighted(mix.map(m => m[1]))][0];
      if (hurry) { shotType = 'lmid'; contest += 0.8; }
      if (rng.chance(ASSIST_P[action] ?? 0.3)) {
        if (action === 'motion' || action === 'spot' || action === 'trans' || action === 'post' || action === 'iso') {
          // actor was the finisher; find a passer
          const others = O.on.filter(x => x !== actor);
          assister = pickW(others, x => Math.exp((eff(x, 'pass') - 55) / 13));
        } else {
          assister = actor;
          shooter = pickW(O.on.filter(x => x !== actor), x => useW(x) * Math.exp((eff(x, shotType === 'rim' ? 'ins' : 'mid') - 55) / 50));
          const d2 = defenderOf(shooter, D);
          contest = z(eff(d2, shotType === 'rim' ? 'intD' : 'perD')) - 0.35;
        }
      }
    }
    // the era's three-point line: jumpers drift behind the arc, more so for real shooters
    if (rules.three && (shotType === 'lmid' || shotType === 'smid') && action !== 'putback' && rng.chance(clamp(p3 * (shotType === 'lmid' ? 1.25 : 0.7) * Math.exp((eff(shooter, 'three') - 55) / 16), 0, 0.98))) {
      shotType = 'three';
      contest -= 0.08;
    }
    // mismatches: slow bigs chasing shooters on the perimeter, guards posted up by size
    const sDef = defenderOf(shooter, D);
    if (shotType === 'three' || shotType === 'lmid' || shotType === 'smid') contest -= mD * 0.5 * Math.max(0, (z(eff(shooter, 'ath')) - z(eff(sDef, 'ath'))) * 0.35 + (sDef.p.r.hgt >= 81 && shooter.p.r.hgt <= 79 ? 0.25 : 0));
    if (action === 'post' || shotType === 'close') contest -= 0.07 * clamp(shooter.p.r.hgt - sDef.p.r.hgt, -4, 6);
    // help defense at the rim
    if (shotType === 'rim' || shotType === 'close') {
      contest += 0.13 * Math.max(0, 2.4 - LO.sp) * mO; // no spacing: the paint is crowded
      const rimProt = Math.max(...D.on.map(x => z(eff(x, 'intD')) * 0.6 + z(eff(x, 'blk')) * 0.4));
      contest = contest * 0.6 + rimProt * 0.4;
    }
    if (action === 'trans') contest -= 0.7;
    if (action === 'putback') contest += 0.2;

    const skill = shotType === 'rim' ? (eff(shooter, 'ins') * 0.75 + eff(shooter, 'ath') * 0.25)
      : shotType === 'close' ? (eff(shooter, 'post') * 0.6 + eff(shooter, 'ins') * 0.4)
      : shotType === 'smid' ? (eff(shooter, 'mid') * 0.6 + eff(shooter, 'ins') * 0.4)
      : shotType === 'three' ? eff(shooter, 'three') : eff(shooter, 'mid');
    const passBoost = assister ? CAL.bPass * (z(eff(assister, 'pass')) * 0.6 + 0.6) : 0;
    let pMake = sigmoid(logit(shotType === 'three' ? base3 : CAL.baseMake[shotType]) + CAL.bShoot * z(skill) - CAL.bContest * contest + passBoost
      - CAL.bFat * Math.max(0, shooter.F - 0.35) + CAL.homeLogit * homeEdge(off) + (shotType === 'three' ? 0 : shotType === 'lmid' ? two * 0.4 : two));
    pMake = clamp(pMake, 0.08, 0.9);

    const isThree = shotType === 'three';
    const shooterDef = defenderOf(shooter, D);
    // block
    let blocked = false;
    if ((shotType === 'rim' || shotType === 'close') && rng.chance(clamp(0.062 * Math.exp(0.3 * Math.max(...D.on.map(x => z(eff(x, 'blk'))))), 0.02, 0.14))) blocked = true;
    // shooting foul
    const pSF = clamp((CAL.shootFoul[shotType] ?? 0.04) * foulE * Math.exp(0.35 * z(eff(shooter, 'foulDraw')) - 0.25 * z(eff(shooterDef, 'foulAvoid'))), 0.005, 0.35);
    const fouled = !blocked && rng.chance(pSF);
    const made = !blocked && rng.chance(fouled ? pMake * 0.62 : pMake);
    shooter.line.fga += fouled && !made ? 0 : 1;
    if (isThree && !(fouled && !made)) shooter.line.tpa++;
    const pts = isThree ? 3 : 2;
    const verb: Record<ShotType, string> = { rim: rng.chance(0.25) && shooter.p.r.ath > 70 ? 'dunk' : 'layup', close: action === 'post' ? 'hook shot' : 'short jumper in the lane', smid: 'pull-up jumper', lmid: 'long jumper', three: 'three' };
    const setup = action === 'post' ? `${last(actor.p)} posts up` : action === 'motion' ? `${O.team.name} work it around` : action === 'high' ? `${last(actor.p)} catches at the elbow` : action === 'pnr' ? `${last(actor.p)} comes off a screen` : action === 'iso' ? `${last(actor.p)} isolates` : action === 'trans' ? `${O.team.name} push in transition` : action === 'putback' ? 'Second chance' : `${O.team.name} swing it`;
    if (blocked) {
      const blocker = pickW(D.on, x => Math.exp(0.6 * z(eff(x, 'blk')) + (x.p.r.hgt - 80) / 10));
      blocker.line.blk++;
      emit('block', 1 - off, `${setup}; ${last(shooter.p)} goes up — blocked by ${blocker.p.name}!`, blocker.p.id);
    }
    if (made) {
      shooter.line.fgm++; shooter.line.pts += pts; if (isThree) shooter.line.tpm++;
      addPts(off, pts);
      if (assister && assister !== shooter) assister.line.ast++;
      emit('make', off, `${setup}${assister && assister !== shooter ? `, finds ${last(shooter.p)}` : ''} — ${verb[shotType]} is good${fouled ? ', and the foul!' : '.'}`, shooter.p.id);
      if (fouled) { foulOn(1 - off, shooterDef); freeThrows(off, shooter, 1, false); }
      off = 1 - off; ctx = 'half';
      subs();
      return;
    }
    if (fouled) {
      foulOn(1 - off, shooterDef);
      emit('foul', 1 - off, `${setup}; ${last(shooter.p)} is fouled on the ${verb[shotType]} by ${last(shooterDef.p)}.`, shooter.p.id);
      const ok = freeThrows(off, shooter, isThree ? 3 : 2);
      if (ok) { off = 1 - off; ctx = 'half'; subs(); return; }
      const rb = rebound(off, 'rim');
      if (rb.side === off) { ctx = 'putback'; putbackBy = rb.who; emit('oreb', off, `${rb.who.p.name} grabs the offensive rebound.`, rb.who.p.id); }
      else { off = 1 - off; ctx = rng.chance(CAL.transRate * 0.7) ? 'trans' : 'half'; }
      return;
    }
    if (!blocked) emit('miss', off, `${setup}${assister && assister !== shooter ? `, to ${last(shooter.p)}` : ''} — ${verb[shotType]} misses.`, shooter.p.id);
    const rb = rebound(off, shotType);
    if (rb.side === off) {
      emit('oreb', off, `Offensive rebound, ${rb.who.p.name}.`, rb.who.p.id);
      ctx = rng.chance(0.42) ? 'putback' : 'half'; putbackBy = rb.who;
    } else {
      off = 1 - off;
      // slow, big lineups get beaten down the floor
      ctx = rng.chance(CAL.transRate * (1.3 - S[off].plan.pace * 0.3) * Math.exp(z(S[off].on.reduce((a, x) => a + eff(x, 'ath'), 0) / 5) * 0.2) * (1 + 0.14 * Math.max(0, LO.bigs - 2) * mO)) ? 'trans' : 'half';
    }
  };

  // ------------------------------------------------------------------ game loop
  let guard = 0;
  while (true) {
    if (guard++ > 2000) break;
    if (clock <= 0) {
      S[0].qScore.push(S[0].score - S[0].qScore.reduce((a, b) => a + b, 0));
      S[1].qScore.push(S[1].score - S[1].qScore.reduce((a, b) => a + b, 0));
      emit('period', -1, `End of ${q <= 4 ? `Q${q}` : `OT${q - 4}`}: ${S[0].team.name} ${S[0].score}, ${S[1].team.name} ${S[1].score}.`);
      if (q >= 4 && S[0].score !== S[1].score) break;
      q++; if (q > 4) ot++;
      clock = qLen();
      S[0].teamFouls = 0; S[1].teamFouls = 0;
      off = q === 4 ? tipWinner : q > 4 ? (rng.chance(0.5) ? 0 : 1) : (q % 2 === 0 ? 1 - tipWinner : tipWinner);
      ctx = 'half';
      subs(true);
      continue;
    }
    possession();
  }
  emit('final', -1, `Final: ${S[0].team.city} ${S[0].score}, ${S[1].team.city} ${S[1].score}${ot ? ` (${ot > 1 ? ot : ''}OT)` : ''}.`);

  const minutes: Record<string, number> = {};
  for (let s = 0; s < 2; s++) for (const x of S[s].ps) { x.line.min = Math.round(x.sec / 6) / 10; minutes[x.p.id] = x.sec / 60; }
  const box: BoxScore = {
    home: S[0].ps.filter(x => x.sec > 0 || x.line.gs || x.line.pts || x.line.fga || x.line.pf).map(x => x.line),
    away: S[1].ps.filter(x => x.sec > 0 || x.line.gs || x.line.pts || x.line.fga || x.line.pf).map(x => x.line),
    quarters: [S[0].qScore, S[1].qScore], possessions: 0, actions,
  };
  // invariant: score reconciles with box
  const sum = (b: BoxLine[]) => b.reduce((a, l) => a + l.pts, 0);
  const possOf = (b: BoxLine[]) => b.reduce((a, l) => a + l.fga - l.oreb + l.tov + 0.44 * l.fta, 0);
  box.possessions = Math.round((possOf(box.home) + possOf(box.away)) / 2 * 10) / 10;
  if (sum(box.home) !== S[0].score || sum(box.away) !== S[1].score) throw new Error(`score mismatch in ${gameId}`);
  return { hs: S[0].score, as: S[1].score, ot, box, log, injuries, minutes };
}
