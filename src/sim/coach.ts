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
  // starters: best 5 with at least 1 big, 1 guard, at most 3 bigs
  const starters: Player[] = [];
  const isBig = (p: Player) => p.pos === 'C' || p.pos === 'PF';
  const isGuard = (p: Player) => p.pos === 'PG' || p.pos === 'SG';
  for (const p of sorted) {
    if (starters.length >= 5) break;
    const bigs = starters.filter(isBig).length, guards = starters.filter(isGuard).length;
    const left = 5 - starters.length;
    if (!isBig(p) && bigs === 0 && left === 1) continue;
    if (!isGuard(p) && guards === 0 && left === 1) continue;
    if (isBig(p) && bigs >= 3) continue;
    if (!isGuard(p) && !isBig(p) && guards === 0 && bigs === 0 && left <= 2) continue;
    starters.push(p);
  }
  for (const p of sorted) if (starters.length < 5 && !starters.includes(p)) starters.push(p);
  const depth = clamp(Math.round(9 + (coach.depth - 50) / 22), 8, 11); // 8..11 man rotation
  const targetMin: Record<string, number> = {};
  const priority: Record<string, number> = {};
  const benchOrder = sorted.filter(p => !starters.includes(p));
  const benchMins = [24, 21, 17, 13, 9, 6, 3, 0];
  starters.forEach((p, i) => { targetMin[p.id] = clamp(30 + (val[p.id] - val[starters[4].id]) * 0.35 + (p.r.stamina - 60) / 12, 24, 35); priority[p.id] = 10 - i * 0.2; });
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
