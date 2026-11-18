// Coaching engine (GDD §8): the coach — never the GM — sets lineups, rotations and the action policy.
import type { Coach, Player, Team, World } from './types';
import { clamp, sigmoid, z } from './rng';

export interface Gameplan {
  starters: string[];          // 5 player ids
  priority: Record<string, number>;  // rotation priority (higher = more likely on floor)
  targetMin: Record<string, number>; // intended minutes
  action: Record<string, number>;    // relative weights for offensive action families
  pace: number;                // multiplier on possession length (lower = faster)
  pressure: number;            // defensive pressure 0..1
  doubleTeam: number;          // propensity to double elite post players 0..1
  coachId: string;
  slots?: Record<string, string>; // starter -> position he is playing
}

export const ACTIONS = ['post', 'iso', 'motion', 'high', 'pnr', 'spot'] as const;
export type Action = typeof ACTIONS[number] | 'trans' | 'putback';

/** Era priors for action families (reference, not commands). 1976-77: post/motion heavy, little PnR. */
export function eraActionPrior(season: number): Record<string, number> {
  if (season < 1980) return { post: 0.25, iso: 0.15, motion: 0.27, high: 0.13, pnr: 0.05, spot: 0.15 };
  if (season < 1990) return { post: 0.24, iso: 0.17, motion: 0.24, high: 0.12, pnr: 0.08, spot: 0.15 };
  return { post: 0.18, iso: 0.18, motion: 0.20, high: 0.10, pnr: 0.16, spot: 0.18 };
}

/** Player value as the coach sees it for a role (uses true ratings: coaches observe their own players daily). */
export function playerValue(p: Player): number {
  const r = p.r;
  const big = ['PF', 'C'].includes(p.pos) ? 1 : 0;
  const off = 0.24 * r.ins + 0.17 * r.mid + 0.14 * r.pass + 0.10 * r.drive + 0.07 * r.handle + 0.08 * r.iq + 0.05 * r.ft;
  const def = big ? 0.07 * r.intD + 0.05 * r.dreb + 0.04 * r.blk + 0.03 * r.oreb : 0.07 * r.perD + 0.05 * r.stl + 0.03 * r.dreb;
  return off + def + 0.04 * r.ath + 0.03 * r.usage;
}

export function available(p: Player) { return !p.injury || p.injury.daysLeft <= 0; }

// ------------------------------------------------------------------ positions
export const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
export type PosKey = typeof POSITIONS[number];
const IDEAL_H: Record<PosKey, number> = { PG: 75, SG: 77, SF: 79, PF: 81, C: 83 };
/** How well a player can play a spot, on the rating scale (skills for the job, minus the wrong body for it). */
export function posScore(p: Player, pos: PosKey): number {
  const r = p.r;
  const shoot = Math.max(r.mid, r.three);
  const skill = pos === 'PG' ? 0.34 * r.handle + 0.34 * r.pass + 0.12 * r.perD + 0.12 * r.iq + 0.08 * shoot
    : pos === 'SG' ? 0.3 * shoot + 0.18 * r.handle + 0.18 * r.perD + 0.16 * r.drive + 0.1 * r.ath + 0.08 * r.pass
    : pos === 'SF' ? 0.2 * shoot + 0.2 * r.perD + 0.18 * r.drive + 0.16 * r.ath + 0.14 * r.dreb + 0.12 * r.handle
    : pos === 'PF' ? 0.24 * r.dreb + 0.2 * r.intD + 0.18 * r.post + 0.14 * r.oreb + 0.14 * r.ins + 0.1 * r.ath
    : 0.24 * r.intD + 0.2 * r.blk + 0.24 * r.dreb + 0.14 * r.post + 0.1 * r.ins + 0.08 * r.oreb;
  const dh = r.hgt - IDEAL_H[pos];
  // too small hurts more at the big spots, too slow/tall hurts more on the perimeter
  const hPen = dh < 0 ? Math.max(0, -dh - 1.5) * (pos === 'C' || pos === 'PF' ? 5 : 3.2) : Math.max(0, dh - 2) * (pos === 'PG' || pos === 'SG' ? 4.2 : 2.6);
  return skill - hPen + (p.pos === pos ? 3 : 0);
}
/** Positions a player can credibly play, best first, with a 0-100 grade. */
export function positionsOf(p: Player): { pos: PosKey; grade: number; natural: boolean }[] {
  const sc = POSITIONS.map(pos => ({ pos, s: posScore(p, pos) }));
  const best = Math.max(...sc.map(x => x.s));
  return sc.filter(x => x.s >= best - 7 || x.pos === p.pos).sort((a, b) => b.s - a.s)
    .map(x => ({ pos: x.pos, grade: Math.round(clamp(100 - (best - x.s) * 6, 0, 100)), natural: x.pos === p.pos }));
}
export function bestPos(p: Player): PosKey { return POSITIONS.reduce((a, b) => (posScore(p, b) > posScore(p, a) ? b : a), POSITIONS[0]); }

/** Coach's starting five by position: maximises player value plus positional fit (how much fit counts depends on the coach). */
export function chooseStarters(roster: Player[], val: Record<string, number>, coach: Coach, force: Partial<Record<PosKey, string>> = {}): { pid: string; pos: PosKey }[] {
  force = Object.fromEntries(Object.entries(force).filter(([, id]) => roster.some(p => p.id === id))) as Partial<Record<PosKey, string>>;
  const pool = [...roster].sort((a, b) => val[b.id] - val[a.id]).slice(0, 9);
  for (const id of Object.values(force)) { const f = roster.find(p => p.id === id); if (f && !pool.includes(f)) pool.push(f); }
  const k = 0.18 + (coach.tactics + coach.adaptability - 100) / 400; // weight on fit
  const best = new Map(pool.map(p => [p.id, Math.max(...POSITIONS.map(q => posScore(p, q)))]));
  const gain = (p: Player, i: number) => {
    const pos = POSITIONS[i];
    if (force[pos] && force[pos] !== p.id) return -1e6;
    if (Object.entries(force).some(([q, id]) => id === p.id && q !== pos)) return -1e6;
    return val[p.id] - k * (best.get(p.id)! - posScore(p, pos)) * 1.4;
  };
  // DP over players x filled-position mask
  const n = pool.length;
  const NEG = -1e9;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(32).fill(NEG));
  const ch: number[][] = Array.from({ length: n + 1 }, () => new Array(32).fill(-1));
  dp[0][0] = 0;
  for (let i = 0; i < n; i++) for (let m = 0; m < 32; m++) {
    if (dp[i][m] === NEG) continue;
    if (dp[i][m] > dp[i + 1][m]) { dp[i + 1][m] = dp[i][m]; ch[i + 1][m] = -1; }
    for (let q = 0; q < 5; q++) if (!(m & (1 << q))) {
      const v = dp[i][m] + gain(pool[i], q);
      const nm = m | (1 << q);
      if (v > dp[i + 1][nm]) { dp[i + 1][nm] = v; ch[i + 1][nm] = q; }
    }
  }
  const out: { pid: string; pos: PosKey }[] = [];
  let m = 31;
  if (dp[n][31] === NEG) return pool.slice(0, 5).map((p, i) => ({ pid: p.id, pos: POSITIONS[i] }));
  for (let i = n; i > 0; i--) { const q = ch[i][m]; if (q >= 0) { out.push({ pid: pool[i - 1].id, pos: POSITIONS[q] }); m &= ~(1 << q); } }
  return out.sort((a, b) => POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos));
}

/** The depth chart the coach is working from: starter first at each spot, then who slides in. */
export function depthChart(world: World, team: Team): Record<PosKey, string[]> {
  const coach = world.coaches[team.coach];
  const roster = team.roster.map(id => world.players[id]).filter(p => p && available(p));
  const val: Record<string, number> = {};
  for (const p of roster) val[p.id] = playerValue(p);
  const st = chooseStarters(roster, val, coach, (team as any).depthForce ?? {});
  const out = {} as Record<PosKey, string[]>;
  for (const pos of POSITIONS) {
    const s = st.find(x => x.pos === pos)?.pid;
    const rest = roster.filter(p => p.id !== s && positionsOf(p).some(x => x.pos === pos)).sort((a, b) => (val[b.id] + posScore(b, pos) * 0.3) - (val[a.id] + posScore(a, pos) * 0.3)).map(p => p.id);
    out[pos] = [...(s ? [s] : []), ...rest].slice(0, 4);
  }
  return out;
}

/** Build a rotation respecting positions. */
export function makeGameplan(world: World, team: Team, coach: Coach): Gameplan {
  const roster = team.roster.map(id => world.players[id]).filter(p => p && available(p));
  const val: Record<string, number> = {};
  for (const p of roster) {
    let v = playerValue(p);
    // honour accepted GM minutes requests within reason (coach still decides)
    const req = team.minutesRequests?.[p.id];
    if (req && req.status === 'accepted') v += req.kind === 'more' ? 3.5 : req.kind === 'protect' ? -4 : 0;
    if (req && req.status === 'compromise') v += req.kind === 'more' ? 1.6 : req.kind === 'protect' ? -2 : 0;
    // young-player development emphasis by coaches who like development
    if ((p.age ?? 27) <= 23) v += (coach.devFocus - 50) / 40;
    val[p.id] = v;
  }
  const sorted = [...roster].sort((a, b) => val[b.id] - val[a.id]);
  const isBig = (p: Player) => p.pos === 'C' || p.pos === 'PF';
  const isGuard = (p: Player) => p.pos === 'PG' || p.pos === 'SG';
  const slots = roster.length >= 5 ? chooseStarters(roster, val, coach, (team as any).depthForce ?? {}) : sorted.map((p, i) => ({ pid: p.id, pos: POSITIONS[i % 5] }));
  const starters: Player[] = slots.map(x => world.players[x.pid]);
  for (const p of sorted) if (starters.length < 5 && !starters.includes(p)) starters.push(p);
  const depth = clamp(Math.round(9 + (coach.depth - 50) / 22), 8, 11); // 8..11 man rotation
  const targetMin: Record<string, number> = {};
  const priority: Record<string, number> = {};
  const benchOrder = sorted.filter(p => !starters.includes(p));
  const benchMins = [24, 21, 17, 13, 9, 6, 3, 0];
  starters.forEach((p, i) => { targetMin[p.id] = clamp(30 + (val[p.id] - Math.min(...starters.map(q => val[q.id]))) * 0.35 + (p.r.stamina - 60) / 12, 24, 35); priority[p.id] = 10 - i * 0.2; });
  benchOrder.forEach((p, i) => { targetMin[p.id] = i < depth - 5 ? benchMins[i] : 0; priority[p.id] = 6 - i; });
  // tired legs: the coach trims planned minutes for players short on condition (back-to-backs, heavy loads)
  for (const p of roster) if (targetMin[p.id]) targetMin[p.id] *= clamp(0.62 + 0.38 * ((p.cond ?? 100) / 100) + (p.r.stamina - 60) / 400, 0.55, 1.08);
  // normalise to 240 minutes
  const total = Object.values(targetMin).reduce((a, b) => a + b, 0);
  for (const k in targetMin) targetMin[k] = targetMin[k] * 240 / total;

  // action policy: era prior × coach philosophy × roster fit (F1 simplified)
  const prior = eraActionPrior(world.season.year);
  const top = starters;
  const best = (f: (p: Player) => number) => Math.max(...top.map(f));
  const avg = (f: (p: Player) => number) => top.reduce((s, p) => s + f(p), 0) / top.length;
  const fit: Record<string, number> = {
    post: z(best(p => p.r.post * 0.8 + p.r.hgt * 0.25)) ,
    iso: z(best(p => (p.r.drive + p.r.mid) / 2)),
    motion: z(avg(p => (p.r.pass + p.r.iq) / 2)) * 1.4,
    high: z(best(p => isBig(p) ? (p.r.mid + p.r.pass) / 2 : 40)),
    pnr: z(best(p => isGuard(p) ? (p.r.handle + p.r.pass) / 2 : 40)) * 0.6,
    spot: z(avg(p => p.r.mid)) * 1.2,
  };
  const pref: Record<string, number> = { post: coach.post, iso: coach.iso, motion: coach.motion, high: (coach.post + coach.motion) / 2, pnr: coach.pnr, spot: (100 - coach.post) * 0.6 + 20 };
  const action: Record<string, number> = {};
  for (const a of ['post', 'iso', 'motion', 'high', 'pnr', 'spot']) {
    action[a] = prior[a] * Math.exp(0.45 * fit[a] + (pref[a] - 50) / 45);
  }
  return {
    starters: starters.map(p => p.id), priority, targetMin, action,
    pace: 1 - (coach.pace - 55) / 220,
    pressure: clamp(coach.pressure / 100, 0.2, 0.95),
    doubleTeam: clamp((coach.pressure - 30) / 100, 0.05, 0.6),
    coachId: coach.id,
    slots: Object.fromEntries(slots.map(x => [x.pid, x.pos])),
  };
}

/** F14: coach response to a GM request. Returns agree / compromise / refuse with rationale. */
export function coachRespond(world: World, team: Team, coach: Coach, p: Player, kind: 'more' | 'protect' | 'develop'): { status: 'accepted' | 'compromise' | 'refused'; text: string } {
  const val = playerValue(p);
  const roster = team.roster.map(id => world.players[id]).filter(Boolean);
  const vals = roster.map(playerValue).sort((a, b) => b - a);
  const rank = vals.indexOf(val);
  const trust = (coach.trustGM ?? 55);
  const clockAlign = world.clock === 'Rebuilding' || world.clock === 'Building' ? (kind === 'more' || kind === 'develop' ? 0.6 : 0) : (kind === 'more' && rank > 7 ? -0.8 : 0.2);
  const merit = kind === 'more' ? (rank <= 6 ? 0.8 : rank <= 9 ? 0 : -1) + ((p.age ?? 27) <= 23 ? 0.4 : 0) : kind === 'protect' ? ((p.age ?? 27) >= 31 || (p.injury?.daysLeft ?? 0) > 0 ? 0.8 : 0) : 0.5;
  const autonomy = (coach.ego - 50) / 30 + (coach.stubborn - 50) / 40;
  const s = -0.2 + (trust - 50) / 25 + merit + clockAlign - autonomy * 0.6;
  const pAgree = sigmoid(s), pRefuse = sigmoid(-s - 0.6);
  const name = p.name.split(' ').slice(-1)[0];
  const coachLast = coach.name.split(' ').slice(-1)[0];
  if (pAgree > 0.6) return { status: 'accepted', text: kind === 'more' ? `${coachLast}: "Fair. I'll get ${name} real minutes and see what he does with them."` : kind === 'protect' ? `${coachLast}: "Agreed. We'll manage ${name}'s load on back-to-backs."` : `${coachLast}: "We'll put extra practice time into ${name}."` };
  if (pRefuse > 0.55) return { status: 'refused', text: kind === 'more' ? `${coachLast}: "With respect, ${name} hasn't earned it in practice. The rotation stays."` : `${coachLast}: "I need ${name} out there. That's my call to make."` };
  return { status: 'compromise', text: kind === 'more' ? `${coachLast}: "I'll give ${name} a look in some second units. No promises beyond that."` : `${coachLast}: "We'll trim a few minutes when the schedule allows."` };
}

/** Lineup read in plain words: what the coach's starting five does well and where it will bleed. */
export function lineupRead(world: World, team: Team, five: { pid: string; pos: PosKey }[]) {
  const ps = five.map(x => world.players[x.pid]).filter(Boolean);
  const coach = world.coaches[team.coach];
  const three = world.season.year >= 1979;
  const bh = Math.max(...ps.map(p => p.r.handle * 0.6 + p.r.pass * 0.4));
  const shooters = ps.filter(p => (three ? Math.max(p.r.three, p.r.mid - 8) : p.r.mid) >= 55).length;
  const bigs = ps.filter(p => p.r.hgt >= 81 && p.r.handle < 52).length;
  const rim = Math.max(...ps.map(p => p.r.intD * 0.6 + p.r.blk * 0.4));
  const misfit = five.filter(x => { const p = world.players[x.pid]; return p && (Math.max(...POSITIONS.map(q => posScore(p, q))) - posScore(p, x.pos)) > 7; });
  const structure = clamp(1.25 - (coach.tactics + coach.adaptability) / 170, 0.55, 1.05);
  const notes: { kind: 'good' | 'warn' | 'bad'; text: string }[] = [];
  if (bh < 52) notes.push({ kind: 'bad', text: 'No real ball-handler: expect turnovers and stalled possessions.' });
  else if (bh >= 66) notes.push({ kind: 'good', text: 'A true lead guard runs the offense.' });
  if (shooters <= 1) notes.push({ kind: 'bad', text: `${shooters ? 'Only one shooter' : 'No shooters'}: defenses will pack the paint.` });
  else if (shooters >= 4) notes.push({ kind: 'good', text: 'Floor spacing: drives and post-ups get room.' });
  if (bigs >= 3) notes.push({ kind: 'bad', text: `${bigs} slow bigs together: quicker teams will run past them and shoot over them.` });
  if (bigs === 0 && rim < 55) notes.push({ kind: 'warn', text: 'Small lineup with no rim protection: expect to lose the glass.' });
  for (const x of misfit) notes.push({ kind: 'warn', text: `${world.players[x.pid].name.split(' ').slice(-1)[0]} is playing out of position at ${x.pos}.` });
  if (!notes.some(n => n.kind !== 'good')) notes.push({ kind: 'good', text: 'Balanced five: every spot is covered.' });
  return { notes, structure, structureText: structure <= 0.62 ? `${coach.name.split(' ').slice(-1)[0]} has a clear plan; odd lineups cost him less.` : structure >= 0.9 ? `${coach.name.split(' ').slice(-1)[0]} has little structure to fall back on; mismatches will hurt.` : 'An average coaching plan: mismatches cost what they cost.' };
}

/** GM suggests a starter at a position; the coach decides (never a direct order). */
export function respondDepth(world: World, team: Team, pos: PosKey, pid: string | null): { status: 'accepted' | 'refused'; text: string } {
  const coach = world.coaches[team.coach];
  const coachLast = coach.name.split(' ').slice(-1)[0];
  const force = { ...((team as any).depthForce ?? {}) } as Partial<Record<PosKey, string>>;
  if (!pid) { delete force[pos]; (team as any).depthForce = force; return { status: 'accepted', text: `${coachLast}: "Understood. I'll pick the ${pos} myself."` }; }
  const roster = team.roster.map(id => world.players[id]).filter(p => p && available(p));
  const val: Record<string, number> = {}; for (const p of roster) val[p.id] = playerValue(p);
  const k = 0.18 + (coach.tactics + coach.adaptability - 100) / 400;
  const score = (st: { pid: string; pos: PosKey }[]) => st.reduce((a, x) => { const p = world.players[x.pid]; return a + val[x.pid] - k * (Math.max(...POSITIONS.map(q => posScore(p, q))) - posScore(p, x.pos)) * 1.4; }, 0);
  for (const [q, id] of Object.entries(force)) if (id === pid) delete force[q as PosKey];
  const free = chooseStarters(roster, val, coach, force);
  const forced = chooseStarters(roster, val, coach, { ...force, [pos]: pid });
  const cost = score(free) - score(forced);
  const trust = coach.trustGM ?? 55;
  const s = 0.8 - cost * 0.35 + (trust - 50) / 18 - (coach.ego - 50) / 28 - (coach.stubborn - 50) / 35;
  const p = world.players[pid];
  const name = p.name.split(' ').slice(-1)[0];
  if (cost <= 0.01) { force[pos] = pid; (team as any).depthForce = force; return { status: 'accepted', text: `${coachLast}: "Already where my head was. ${name} starts at ${pos}."` }; }
  if (sigmoid(s) > 0.5) {
    force[pos] = pid; (team as any).depthForce = force;
    coach.trustGM = clamp(trust - Math.min(3, cost * 0.4), 0, 100);
    return { status: 'accepted', text: cost > 4 ? `${coachLast}: "I'll do it, but I think it costs us. ${name} starts at ${pos}; we'll see what the film says."` : `${coachLast}: "Fair enough. ${name} gets the start at ${pos}."` };
  }
  return { status: 'refused', text: posScore(p, pos) < Math.max(...POSITIONS.map(q => posScore(p, q))) - 7 ? `${coachLast}: "${name} isn't a ${pos}. Putting him there breaks what we do on both ends."` : `${coachLast}: "I hear you, but the other guy gives us more there. My call."` };
}
