// People, relationships and culture (GDD §12, F16–F18).
// Every player carries a stable personality (12 traits), a set of motivations that shift over a career, and sparse,
// one-directional relationships with teammates, his coach, his organisation and the GM. Teams carry a culture that the
// most influential people in the building shape week by week: stars and long-tenured players pull hardest, and the
// greatest competitors in history pull hardest of all.
// Culture reaches the court only through bounded, explainable channels: practice habits (development and aging),
// composure under pressure, defensive communication and how players choose teams. It never adds shooting percentage
// by itself. Personalities of real people are simulated for this universe, not claims about them.
import type { Player, Team, World } from './types';
import { clamp, sigmoid, stream } from './rng';
import { playerValue } from './coach';
import { addEvent, addMessage, addNews } from './world';
import { isImpact } from './impact';
import { chron } from './chronicle';

// ------------------------------------------------------------------ vocabulary
export const TRAIT_KEYS = ['drive', 'ambition', 'ego', 'team', 'loyalty', 'assert', 'poise', 'adapt', 'patience', 'risk', 'discipline', 'social'] as const;
export const TRAIT_LABEL: Record<string, string> = {
  drive: 'Competitive drive', ambition: 'Ambition', ego: 'Need for credit', team: 'Team-first', loyalty: 'Loyalty', assert: 'Assertiveness',
  poise: 'Composure', adapt: 'Adaptability', patience: 'Patience', risk: 'Risk appetite', discipline: 'Work ethic', social: 'Sociability',
};
export const TRAIT_SHORT: Record<string, string> = {
  drive: 'Drive', ambition: 'Ambition', ego: 'Ego', team: 'Team-first', loyalty: 'Loyalty', assert: 'Assertive', poise: 'Composure', adapt: 'Adaptable', patience: 'Patience', risk: 'Risk-taking', discipline: 'Work ethic', social: 'Sociable',
};
export const MOTIVE_KEYS = ['money', 'rings', 'greatness', 'legacy', 'status', 'role', 'growth', 'belonging', 'stability', 'independence', 'fame', 'longevity'] as const;
export const MOTIVE_LABEL: Record<string, string> = {
  money: 'Financial security', rings: 'Championships', greatness: 'Individual greatness', legacy: 'Legacy', status: 'Standing in the locker room',
  role: 'A real role', growth: 'Getting better', belonging: 'Belonging', stability: 'Stability', independence: 'Control of his career', fame: 'Recognition', longevity: 'A long career',
};

type T = Partial<Record<string, number>>;
interface Arch { label: string; blurb: string; t: T; m: T }
/** Archetypes for the people who changed franchises. Each persona below starts from one and adjusts it. */
export const ARCH: Record<string, Arch> = {
  killer: { label: 'Relentless competitor', blurb: 'Demands winning from everyone around him, every day, and takes the big moments himself.',
    t: { drive: 99, discipline: 96, poise: 95, assert: 95, ego: 80, ambition: 96, team: 58, social: 46, patience: 28, loyalty: 55, adapt: 78, risk: 78 }, m: { rings: 3.2, greatness: 3, legacy: 2.6, status: 1.3, money: 0.7, belonging: 0.5 } },
  silent: { label: 'Quiet standard-setter', blurb: 'Leads by example. The work speaks, and the room follows it.',
    t: { drive: 97, discipline: 97, poise: 98, assert: 60, ego: 32, ambition: 78, team: 93, social: 44, patience: 82, loyalty: 90, adapt: 82, risk: 40 }, m: { rings: 3, legacy: 1.6, stability: 1.6, belonging: 1.4, status: 0.4, fame: 0.2, money: 0.7 } },
  heart: { label: 'Heart and soul', blurb: 'Sets the tone with energy and edge, and holds teammates to account out loud.',
    t: { drive: 98, discipline: 91, poise: 62, assert: 99, ego: 62, ambition: 76, team: 93, social: 78, patience: 42, loyalty: 82, adapt: 70, risk: 70 }, m: { rings: 3, belonging: 2, status: 1.4, legacy: 1.2, money: 0.9 } },
  general: { label: 'Floor general', blurb: 'Makes everyone around him better and keeps the room together.',
    t: { drive: 93, discipline: 91, poise: 93, assert: 86, ego: 42, ambition: 82, team: 97, social: 91, patience: 70, loyalty: 76, adapt: 86, risk: 55 }, m: { rings: 2.8, legacy: 1.6, belonging: 1.8, greatness: 1.2, money: 0.8 } },
  grinder: { label: 'Obsessive worker', blurb: 'First in, last out. His habits rub off on the young players.',
    t: { drive: 96, discipline: 99, poise: 82, assert: 62, ego: 48, ambition: 82, team: 82, social: 52, patience: 76, loyalty: 74, adapt: 80, risk: 44 }, m: { rings: 2.6, growth: 1.8, greatness: 1.6, longevity: 1.6, money: 0.9 } },
  showman: { label: 'Big personality', blurb: 'Fills the room. The culture bends around him, for better or worse.',
    t: { drive: 88, discipline: 72, poise: 88, assert: 93, ego: 88, ambition: 94, team: 66, social: 96, patience: 45, loyalty: 55, adapt: 72, risk: 74 }, m: { fame: 2.2, rings: 2.2, status: 2, greatness: 1.8, money: 1.3 } },
  pro: { label: 'Consummate pro', blurb: 'Does the dirty work, knows his role and steadies the room.',
    t: { drive: 88, discipline: 93, poise: 92, assert: 70, ego: 28, ambition: 55, team: 97, social: 74, patience: 84, loyalty: 82, adapt: 90, risk: 45 }, m: { rings: 2.6, belonging: 2, role: 1.2, stability: 1.4, money: 1, fame: 0.2 } },
};

/** [nbaId, archetype, trait adjustments, motivation multipliers]. Public reputations for competitiveness, work and
 *  leadership, simulated here; nothing in a save is scripted from them. */
type Persona = [number, string, T?, T?];
const PERSONAS: Persona[] = [
  // the 1976 league
  [76003, 'silent', { drive: 93, assert: 72, ego: 62, social: 34, team: 80 }], [76681, 'general', { drive: 94, ego: 48 }], [78450, 'general', { team: 99, drive: 95, poise: 80 }],
  [76462, 'heart'], [600013, 'killer', { social: 26, ego: 86, team: 52, poise: 92 }], [77449, 'grinder', { drive: 98, assert: 70, social: 40 }], [78151, 'pro', { assert: 86 }],
  [76970, 'grinder', { team: 92, poise: 95 }], [78392, 'heart', { poise: 80, social: 66 }], [77141, 'silent', { assert: 78, poise: 96 }],
  [76804, 'silent', { drive: 86, discipline: 85, poise: 97, team: 70, assert: 48 }], [77193, 'pro'], [76750, 'silent', { drive: 88, poise: 97 }],
  // Boston, the Lakers, Detroit, Chicago
  [1449, 'killer', { social: 58, team: 72 }], [77142, 'general', { drive: 98, ambition: 93, poise: 96, social: 97 }], [1450, 'grinder', { social: 70, assert: 58 }], [305, 'silent', { drive: 90 }],
  [78318, 'killer', { social: 84, team: 68 }], [76017, 'heart', { discipline: 85 }], [1460, 'silent', { drive: 90, poise: 99 }], [100263, 'heart', { social: 45, ego: 68, poise: 70 }],
  [76444, 'pro', { assert: 80, drive: 94 }], [76385, 'pro'], [77905, 'pro'],
  [893, 'killer', { drive: 99, discipline: 98, poise: 98, assert: 99, ego: 85, ambition: 99 }, { rings: 1.2, greatness: 1.2 }],
  [165, 'silent', { drive: 98, assert: 80, poise: 95 }], [787, 'showman', { drive: 94, poise: 85, social: 95 }], [304, 'grinder', { team: 98, ego: 18, poise: 95, assert: 70, social: 45 }],
  [252, 'grinder', { drive: 96, ego: 62 }, { longevity: 1.4 }], [247, 'silent', { drive: 93, assert: 55 }], [121, 'grinder', { drive: 96, assert: 78, social: 38 }],
  [23, 'grinder', { drive: 97, discipline: 93, social: 30, ego: 62, poise: 58, team: 80 }], [937, 'general', { drive: 92, assert: 76, ego: 55 }],
  [397, 'killer', { poise: 98, discipline: 95, team: 70 }], [764, 'silent', { drive: 88, discipline: 94 }], [56, 'heart', { assert: 99, ego: 72, poise: 72 }], [53, 'pro', { poise: 96 }],
  // the 1990s
  [406, 'showman'], [297, 'heart', { drive: 99 }], [467, 'general', { drive: 94 }], [708, 'heart', { drive: 99, discipline: 98, assert: 99, poise: 64 }],
  [977, 'killer', { drive: 99, discipline: 99, poise: 97, assert: 97, social: 34, team: 52, ego: 86 }, { rings: 1.2, greatness: 1.3 }],
  [947, 'killer', { discipline: 66, social: 76, team: 56, poise: 90 }], [959, 'general', { discipline: 97, drive: 95 }], [951, 'grinder', { discipline: 99, poise: 97 }],
  [1112, 'heart', { drive: 99, discipline: 97, ego: 40, social: 58 }], [1495, 'silent', { drive: 98, poise: 99, discipline: 98 }],
  [1717, 'grinder', { loyalty: 99, poise: 92, ego: 40, social: 76 }, { stability: 1.8 }], [1718, 'killer', { drive: 94, discipline: 88, social: 70 }],
  [1938, 'heart', { risk: 92, team: 97, poise: 90, ego: 38 }], [965, 'pro', { poise: 98, assert: 82 }], [109, 'pro', { poise: 99, drive: 84, discipline: 80 }],
  [422, 'general', { drive: 90, ambition: 60 }], [1477, 'pro', { assert: 78 }], [1497, 'general', { poise: 97 }],
  // the 2000s
  [2544, 'general', { drive: 97, ambition: 99, discipline: 98, assert: 94, ego: 70, loyalty: 50 }, { legacy: 1.6, independence: 2.4 }],
  [2548, 'killer', { social: 82, team: 70 }], [101108, 'general', { assert: 98, drive: 98, ego: 60, poise: 90 }], [2617, 'heart', { ambition: 50, ego: 25, loyalty: 99 }, { stability: 2 }],
  [2203, 'pro'], [200768, 'heart', { discipline: 88 }], [200782, 'heart', { ego: 35 }], [2738, 'pro'], [2754, 'heart', { ego: 40 }], [201143, 'pro', { drive: 86 }],
  [201142, 'grinder', { social: 45, poise: 92 }, { greatness: 1.6, independence: 2 }],
  [201566, 'heart', { drive: 99, discipline: 97, ego: 74, poise: 68, team: 72 }], [201565, 'silent', { drive: 96, social: 40 }], [201939, 'general', { ego: 38, social: 95, poise: 97, discipline: 97 }],
  // the 2010s and 2020s
  [202695, 'silent', { social: 18, loyalty: 55, drive: 97 }, { independence: 2.2, stability: 0.6 }], [202710, 'heart', { discipline: 99, ego: 70, assert: 97, poise: 88, social: 60 }],
  [202691, 'silent', { drive: 88, assert: 40, social: 60 }], [203110, 'heart', { assert: 99, poise: 48, ego: 70, team: 95 }],
  [203507, 'grinder', { drive: 99, loyalty: 93, team: 90, ego: 40, poise: 85 }, { stability: 1.5 }], [203999, 'general', { drive: 90, ego: 14, social: 68, assert: 62, poise: 96, ambition: 60 }, { fame: 0.3 }],
  [203935, 'heart'], [1629029, 'killer', { discipline: 76, ego: 74, poise: 97, social: 80, team: 70 }], [1628973, 'general', { drive: 96, discipline: 97 }],
  [1627936, 'pro'], [1627832, 'pro', { drive: 93, assert: 82 }], [203081, 'killer', { loyalty: 92, poise: 98, social: 80, team: 80 }, { stability: 1.6 }],
  [1628983, 'silent', { drive: 95, discipline: 97, poise: 98 }], [1630162, 'killer', { discipline: 85, social: 88 }], [1641705, 'grinder', { drive: 96, discipline: 98, social: 60 }],
  [1628369, 'grinder', { drive: 93 }],
];
const PERSONA: Record<number, Persona> = Object.fromEntries(PERSONAS.map(p => [p[0], p]));

const t$ = (p: Player, k: string) => p.traits[k] ?? 50;
/** Drive, work and composure together: the thing scouts call "mentality". */
export const mentality = (p: Player) => 0.45 * t$(p, 'drive') + 0.3 * t$(p, 'discipline') + 0.25 * t$(p, 'poise');
export const isMonster = (p: Player) => mentality(p) >= 94;
export function mentalityWord(p: Player, shift = 0) {
  const m = mentality(p) + shift;
  return m >= 95 ? 'Legendary' : m >= 89 ? 'Elite' : m >= 76 ? 'Strong' : m >= 60 ? 'Steady' : m >= 47 ? 'Ordinary' : 'Inconsistent';
}
export function personaLabel(p: Player): string | null {
  const a = (p as any).persona as string | undefined;
  if (a && ARCH[a]) return ARCH[a].label;
  const m = mentality(p);
  if (m >= 90) return 'Relentless competitor';
  if (t$(p, 'team') >= 85 && t$(p, 'social') >= 80) return 'Glue guy';
  if (t$(p, 'discipline') >= 88) return 'Hard worker';
  if (t$(p, 'ego') >= 85 && t$(p, 'assert') >= 80) return 'Alpha personality';
  if (t$(p, 'poise') <= 25) return 'Volatile';
  return null;
}
export function personaBlurb(p: Player): string | null {
  const a = (p as any).persona as string | undefined;
  return a && ARCH[a] ? ARCH[a].blurb : null;
}

// ------------------------------------------------------------------ building a person
const g = (r: ReturnType<typeof stream>, mu: number, sd: number) => Math.round(clamp(r.normal(mu, sd), 5, 95));

/** Fill the full trait set, apply a historical persona if there is one, and set motivations. Idempotent. */
export function initPerson(p: Player, seed: string) {
  if ((p as any).motives && p.traits.poise != null) return;
  const r = stream(seed, 'person', p.id);
  const t = p.traits = { ...p.traits };
  for (const k of ['drive', 'ambition', 'ego', 'loyalty', 'discipline', 'adapt', 'patience', 'social']) if (t[k] == null) t[k] = g(r, 50, 14);
  if (t.team == null) t.team = Math.round(clamp(62 - (t.ego - 50) * 0.45 + (t.social - 50) * 0.25 + r.normal(0, 10), 5, 95));
  if (t.assert == null) t.assert = Math.round(clamp(48 + (t.ego - 50) * 0.3 + (t.drive - 50) * 0.3 + r.normal(0, 11), 5, 95));
  if (t.poise == null) t.poise = Math.round(clamp(50 + (t.discipline - 50) * 0.2 + r.normal(0, 13), 5, 95));
  if (t.risk == null) t.risk = g(r, 50, 14);
  let motiveMul: T = {};
  const per = p.nbaId ? PERSONA[p.nbaId] : undefined;
  if (per) {
    const a = ARCH[per[1]];
    for (const k of TRAIT_KEYS) { const v = per[2]?.[k] ?? a.t[k]; if (v != null) t[k] = Math.round(clamp(v + r.normal(0, 1.2), 5, 99)); }
    (p as any).persona = per[1];
    motiveMul = { ...a.m }; for (const [k, v] of Object.entries(per[3] ?? {})) motiveMul[k] = (motiveMul[k] ?? 1) * (v as number);
  } else if (p.nbaId) {
    // real people without a documented reputation: random, but kept away from extremes that would read as a claim
    for (const k of ['drive', 'discipline', 'poise']) t[k] = Math.round(clamp(t[k], 38, 88));
    if (isImpact(p)) {
    // the league's other great players were driven people too, short of the very top
    t.drive = Math.max(t.drive, g(r, 82, 6)); t.discipline = Math.max(t.discipline, g(r, 74, 8)); t.poise = Math.max(t.poise, g(r, 70, 10));
    }
  } else if (!p.nbaId && p.id.startsWith('f')) {
    // fictional future players: a rare few arrive wired like the all-time greats, more often among the stars
    const star = ((p as any).arc?.tier ?? 0) >= 89;
    if (r.chance(star ? 0.35 : 0.004)) {
      const key = r.pick(['killer', 'silent', 'heart', 'general', 'grinder', 'killer', 'grinder']);
      const a = ARCH[key];
      for (const k of TRAIT_KEYS) if (a.t[k] != null) t[k] = Math.round(clamp(a.t[k]! + r.normal(0, 3), 5, 99));
      (p as any).persona = key; motiveMul = { ...a.m };
    }
  }
  (p as any).motiveMul = Object.keys(motiveMul).length ? motiveMul : undefined;
  (p as any).motives = normalize(baseMotives(p, motiveMul));
}

function baseMotives(p: Player, mul: T = (p as any).motiveMul ?? {}): Record<string, number> {
  const t = p.traits, a = p.age ?? 24;
  const m: Record<string, number> = {
    money: 1.1 + (a < 25 ? 0.3 : 0), rings: 0.5 + (t.drive - 40) / 45 + (a >= 30 ? 0.5 : 0), greatness: 0.3 + (t.ambition - 40) / 50,
    legacy: 0.2 + (t.ambition + t.drive - 100) / 120 + (a >= 29 ? 0.4 : 0), status: 0.2 + (t.ego - 40) / 55, role: 0.9,
    growth: a <= 23 ? 1.2 : a <= 27 ? 0.7 : 0.3, belonging: 0.3 + (t.team + t.social - 80) / 110, stability: 0.3 + (t.loyalty + t.patience - 80) / 110,
    independence: 0.3 + (100 - t.team + t.risk - 80) / 130, fame: 0.2 + (t.ego - 40) / 70, longevity: a >= 31 ? 0.5 + (a - 31) * 0.2 : 0.2,
  };
  for (const k of MOTIVE_KEYS) m[k] = Math.max(0.05, m[k] * (mul[k] ?? 1));
  return m;
}
function normalize(m: Record<string, number>) {
  const s = Object.values(m).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v / s * 1000) / 1000]));
}
export const motive = (p: Player, k: string) => ((p as any).motives?.[k] ?? 1 / 12) as number;
export function topMotives(p: Player, n = 3): string[] {
  return Object.entries(((p as any).motives ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => MOTIVE_LABEL[k]);
}

// ------------------------------------------------------------------ relationship graph (directed, sparse)
// edge = [affinity, respect, trust, conflict, last season touched]; ids are player ids, coach ids, org:TID and gm
type Edge = number[];
const K = (a: string, b: string) => `${a}>${b}`;
const graph = (w: World): Record<string, Edge> => ((w as any).rel ??= {});
export function rel(w: World, a: string, b: string): Edge | undefined { return graph(w)[K(a, b)]; }
function edge(w: World, a: string, b: string, init?: () => Edge): Edge {
  const G = graph(w), k = K(a, b);
  return G[k] ??= init ? init() : [50, 50, 50, 0, w.season.year];
}
const ORG = (tid: string) => `org:${tid}`;
export const trustIn = (w: World, pid: string, who: string) => rel(w, pid, who)?.[2] ?? 50;
const nudge = (e: Edge, i: number, d: number) => { e[i] = Math.round(clamp(e[i] + d, 0, 100) * 10) / 10; };
const toward = (e: Edge, i: number, target: number, k: number) => { e[i] = Math.round(clamp(e[i] + (target - e[i]) * k, 0, 100) * 10) / 10; };

/** Salient memories: kept few, and only for things a person would remember. */
function remember(w: World, a: string, b: string, text: string) {
  const L: { a: string; b: string; s: number; t: string }[] = ((w as any).relNotes ??= []);
  L.unshift({ a, b, s: w.season.year, t: text });
  if (L.length > 300) L.length = 300;
}
export function memoriesOf(w: World, pid: string, n = 4) {
  return (((w as any).relNotes ?? []) as { a: string; b: string; s: number; t: string }[]).filter(x => x.a === pid || x.b === pid).slice(0, n);
}

function repute(p: Player, v = playerValue(p)) {
  let honors = 0;
  for (const a of p.awards ?? []) if (a.award === 'MVP' || a.award === 'Finals MVP' || a.award === 'DPOY' || a.award.startsWith('All-NBA')) honors++;
  return clamp(35 + (v - 50) * 1.1 + Math.min(8, honors) * 3, 10, 98);
}

// ------------------------------------------------------------------ helpers
const rosterOf = (w: World, t: Team) => t.roster.map(id => w.players[id]).filter(p => p && !p.retired && !p.contract?.twoWay);
const byValue = (ps: Player[]) => [...ps].sort((a, b) => playerValue(b) - playerValue(a));
function mpgNow(w: World, p: Player) {
  const s = (p.stats ?? []).find(x => x.season === w.season.year && !x.playoffs);
  return s && s.g ? s.min / s.g : null;
}
const expectedMin = (rank: number) => (rank < 5 ? 30 : rank < 8 ? 20 : 10);
const winPct = (t: Team) => (t.w + t.l ? t.w / (t.w + t.l) : 0.5);
const tenureYears = (w: World, p: Player) => ((p as any).tenure?.team === p.team ? w.season.year - (p as any).tenure.since : 0);
const isUser = (w: World, tid: string | null) => tid === w.meta.userTeam;
const first = (n: string) => n.split(' ').slice(-1)[0];

// ------------------------------------------------------------------ culture
export interface Culture { std: number; uni: number; edge: number; poise: number; roots: number; leaders: string[]; label: string; drivers: { pid: string; tag: string }[]; since: number }
const PERF_W = [1, 0.82, 0.68, 0.56, 0.46, 0.38, 0.32, 0.27, 0.23, 0.2, 0.18, 0.16, 0.15, 0.15, 0.15];

function influenceList(w: World, t: Team) {
  return byValue(rosterOf(w, t)).map((p, i) => {
    const inst = Math.min(1, tenureYears(w, p) / 5) * 0.55 + (p.draftedBy === t.id ? 0.12 : 0);
    const lead = 0.55 + t$(p, 'assert') / 220 + t$(p, 'social') / 500;
    const m = mentality(p);
    const mon = m >= 94 ? 2.6 : m >= 88 ? 1.5 : 1;
    const young = (p.age ?? 25) <= 21 ? 0.65 : 1;
    return { p, inf: (PERF_W[i] ?? 0.15) * lead * mon * young + inst * 0.8 * lead };
  });
}
const pStd = (p: Player) => 0.55 * t$(p, 'drive') + 0.45 * t$(p, 'discipline');
const pUni = (p: Player) => 0.45 * t$(p, 'team') + 0.3 * t$(p, 'social') + 0.25 * (100 - t$(p, 'ego'));
const pEdge = (p: Player) => 0.6 * t$(p, 'assert') + 0.4 * t$(p, 'drive');

/** Where this team's culture is heading, given who holds influence right now. */
export function cultureTarget(w: World, t: Team) {
  const L = influenceList(w, t);
  const coach = w.coaches[t.coach];
  let s = 1.1, std = 1.1 * (coach ? (coach.development + coach.tactics) / 2 : 55), uni = 1.1 * (coach?.communication ?? 55), edge = 1.1 * 52, poise = 1.1 * (coach?.adaptability ?? 55);
  for (const { p, inf } of L) { s += inf; std += inf * pStd(p); uni += inf * pUni(p); edge += inf * pEdge(p); poise += inf * t$(p, 'poise'); }
  std /= s; uni /= s; edge /= s; poise /= s;
  const top = [...L].sort((a, b) => b.inf - a.inf);
  // two alphas who both need the credit split a room; open feuds among the core do too
  const core = top.slice(0, 4).map(x => x.p);
  for (let i = 0; i < core.length; i++) for (let j = i + 1; j < core.length; j++) {
    const a = core[i], b = core[j];
    if (t$(a, 'ego') >= 72 && t$(a, 'assert') >= 72 && t$(b, 'ego') >= 72 && t$(b, 'assert') >= 72) uni -= 5;
    const c = Math.max(rel(w, a.id, b.id)?.[3] ?? 0, rel(w, b.id, a.id)?.[3] ?? 0);
    if (c > 40) uni -= (c - 40) / 6;
  }
  // a monster at the top demands the standard: it rises, and the room has to keep up or crack
  const lead = top[0]?.p;
  if (lead && isMonster(lead)) {
    std += 6;
    for (const { p } of top.slice(1, 8)) if (t$(p, 'discipline') < 45) { uni -= 2.5; std += 1.5; }
  }
  if (t.w + t.l >= 10) uni += (winPct(t) - 0.5) * 16;
  const missed = t.history.slice(-3);
  if (missed.length === 3 && missed.every(h => h.result === 'Missed playoffs') && !(lead && isMonster(lead))) std -= 4;
  return { std: clamp(std, 5, 99), uni: clamp(uni, 5, 99), edge: clamp(edge, 5, 99), poise: clamp(poise, 5, 99), top };
}

function labelFor(c: { std: number; uni: number; edge: number }) {
  if (c.std >= 76 && c.uni >= 58) return 'Championship standard';
  if (c.std >= 70 && c.uni < 48) return 'Driven but divided';
  if (c.uni < 42) return 'Fractured';
  if (c.edge >= 70 && c.std >= 62) return 'Hard-nosed';
  if (c.uni >= 63 && c.std >= 55) return 'Close-knit';
  if (c.std < 52) return 'Comfortable';
  if (c.std >= 66) return 'Professional';
  return 'Searching for an identity';
}

/** Move culture toward its target. k is the share of the gap closed; deep roots slow change, above all decline. */
function stepCulture(w: World, t: Team, k: number) {
  const tg = cultureTarget(w, t);
  const c: Culture = (t as any).culture ??= { std: tg.std, uni: tg.uni, edge: tg.edge, poise: tg.poise, roots: 0, leaders: [], label: '', drivers: [], since: w.season.year };
  const rk = k / (1 + c.roots * 0.15);
  for (const key of ['std', 'uni', 'edge', 'poise'] as const) {
    const down = tg[key] < c[key];
    c[key] = Math.round((c[key] + (tg[key] - c[key]) * rk * (down && c.roots > 0 ? 0.75 : 1)) * 10) / 10;
  }
  c.leaders = [...tg.top].sort((a, b) => b.inf * (t$(b.p, 'assert') + t$(b.p, 'drive')) - a.inf * (t$(a.p, 'assert') + t$(a.p, 'drive'))).slice(0, 2).map(x => x.p.id);
  c.drivers = tg.top.slice(0, 4).map(({ p }) => {
    const d = { std: pStd(p) - c.std, uni: pUni(p) - c.uni, edge: pEdge(p) - c.edge };
    const tag = d.uni < -18 ? 'divides the room' : pStd(p) < 45 ? 'more relaxed than the room' : d.std >= d.uni && d.std >= d.edge && d.std > 4 ? 'raises the standard'
      : d.uni >= d.edge && d.uni > 4 ? 'pulls the room together' : d.edge > 4 ? 'brings an edge' : 'steadies things';
    return { pid: p.id, tag };
  });
  const old = c.label;
  c.label = labelFor(c);
  if (old && old !== c.label && (['Championship standard', 'Fractured', 'Driven but divided'].includes(c.label) || old === 'Championship standard')) chron(w, 'culture', `${t.abbr} locker room: ${old} -> ${c.label}${c.leaders[0] && w.players[c.leaders[0]] ? `; tone set by ${w.players[c.leaders[0]].name}` : ''}`, c.leaders.slice(0, 1));
  if (old && old !== c.label) { c.since = w.season.year; if (isUser(w, t.id)) addMessage(w, { date: w.season.day, from: w.coaches[t.coach]?.name ?? 'Coach', role: 'Coach', subject: `The locker room: ${old} → ${c.label}`, body: cultureSentence(w, t), urgent: 1, tag: 'Locker room', actions: [{ label: 'Open the locker room', cmd: 'goto', arg: 'roster:locker' }] }); }
  return c;
}
export const culture = (t: Team): Culture | undefined => (t as any).culture;

/** One line on why the room feels the way it does. */
export function cultureSentence(w: World, t: Team): string {
  const c = culture(t); if (!c) return '';
  const lead = c.leaders.map(id => w.players[id]).filter(Boolean);
  const d = c.drivers.map(x => ({ p: w.players[x.pid], tag: x.tag })).filter(x => x.p);
  const parts: string[] = [];
  if (lead[0]) parts.push(`${lead[0].name} sets the tone${isMonster(lead[0]) ? ', and he will not accept less than everything' : ''}.`);
  const split = d.find(x => x.tag === 'divides the room' || x.tag === 'more relaxed than the room');
  if (split) parts.push(`${split.p.name} ${split.tag}.`);
  const up = d.find(x => x.p !== lead[0] && (x.tag === 'raises the standard' || x.tag === 'pulls the room together'));
  if (up) parts.push(`${up.p.name} ${up.tag}.`);
  if (c.roots >= 3) parts.push('The habits have deep roots here; they outlast any one player.');
  return parts.join(' ') || 'No one has taken hold of this room yet.';
}

// ------------------------------------------------------------------ bounded effects used elsewhere
/** Development multiplier from practice habits: the room's standard, his own work ethic and a mentor. */
export function cultureDevMul(w: World, p: Player): number {
  const t = p.team ? w.teams[p.team] : null;
  const c = t ? culture(t) : undefined;
  const age = p.age ?? 25;
  let m = 1;
  if (c) m *= 1 + (c.std - 55) / 350 * (age <= 25 ? 1 : 0.5);
  m *= 0.95 + t$(p, 'discipline') / 1000;
  const mentor = (p as any).mentor as string | undefined;
  if (mentor && w.players[mentor]?.team === p.team && p.team) m *= 1.07;
  return clamp(m, 0.82, 1.24);
}
/** How fast skills fade with age: work and obsession slow it. */
export function declineMul(p: Player): number {
  if (isMonster(p)) return 0.85;
  const d = t$(p, 'discipline');
  return d >= 90 ? 0.9 : d >= 75 ? 0.96 : d < 35 ? 1.06 : 1;
}
/** Conditioning: a small effect on injury hazard. */
export const injuryMul = (p: Player) => clamp(1.08 - t$(p, 'discipline') / 625, 0.9, 1.1);
/** Composure under pressure, -1.2 .. 1.1. */
export const composure = (p: Player) => clamp((t$(p, 'poise') - 60) / 35, -1.2, 1.1);
/** Who wants the ball when it matters. */
export const closerPull = (p: Player) => Math.exp(((t$(p, 'drive') + t$(p, 'assert')) / 2 - 70) / 40);
/** Defensive talk and trust on the floor, -0.7 .. 0.7. */
export function cohesion(t: Team): number {
  const c = culture(t); if (!c) return 0;
  return clamp((c.uni - 58) / 30, -1, 1) * 0.7;
}

/** How a free agent feels about a team beyond money and minutes: its culture, his friends there, his trust in it. */
export function cultureAppeal(w: World, p: Player, tid: string): number {
  const t = w.teams[tid]; if (!t) return 0;
  const c = culture(t);
  let u = 0;
  if (c) {
    // a tie-breaker, not a magnet: worth a few percent of salary at most
    const k = 0.015 + 0.02 * clamp((motive(p, 'rings') * 12 - 1) / 2, 0, 1);
    u += clamp((c.std - 60) / 30, -1, 1) * k;
    u += clamp((c.uni - 55) / 20, -1, 1) * 0.012 * clamp(motive(p, 'belonging') * 12, 0, 2);
  }
  let friends = 0, feud = false;
  for (const id of t.roster) {
    if (id === p.id) continue;
    const e = rel(w, p.id, id); if (!e) continue;
    if (e[0] >= 68) friends++;
    if (e[3] >= 60) feud = true;
  }
  u += Math.min(0.04, friends * 0.015 * (0.6 + motive(p, 'belonging') * 6));
  if (feud) u -= 0.06;
  const o = rel(w, p.id, ORG(tid));
  if (o) u += clamp((o[2] - 50) / 500, -0.08, 0.06);
  // two players who both need to be the man rarely choose to share a room
  if (t$(p, 'ego') >= 75 && motive(p, 'status') > 0.09) {
    const rival = t.roster.map(id => w.players[id]).find(x => x && x.id !== p.id && playerValue(x) >= playerValue(p) - 2 && t$(x, 'ego') >= 75);
    if (rival) u -= 0.07;
  }
  if ((p as any).wantsOut === tid) u -= 0.22;
  return u;
}

// ------------------------------------------------------------------ weekly social update
export function peopleWeek(w: World) {
  const S = w.season;
  for (const t of Object.values(w.teams)) {
    const V = new Map(rosterOf(w, t).map(p => [p, playerValue(p)] as [Player, number]));
    const ps = [...V.keys()].sort((a, b) => V.get(b)! - V.get(a)!);
    const rank = new Map(ps.map((p, i) => [p.id, i]));
    const REP = new Map(ps.map(p => [p.id, repute(p, V.get(p)!)]));
    const coach = w.coaches[t.coach];
    for (const p of ps) arrive(w, t, p);
    const core = ps.slice(0, 10);
    const c = culture(t);
    // teammates
    for (const a of core) for (const b of core) {
      if (a === b) continue;
      const e = edge(w, a.id, b.id, () => [Math.round(48 + (t$(a, 'social') - 50) * 0.15 + (t$(b, 'social') - 50) * 0.1), Math.round(REP.get(b.id)!), 50, 0, S.year]);
      e[4] = S.year;
      const respT = REP.get(b.id)! + (t$(b, 'drive') - 60) * 0.25 + (t$(b, 'discipline') - 60) * 0.15 - (t$(a, 'ego') - 50) * 0.12;
      toward(e, 1, respT, 0.08);
      const ra = rank.get(a.id)!, rb = rank.get(b.id)!;
      const alphas = ra < 3 && rb < 3 && t$(a, 'ego') >= 70 && t$(a, 'assert') >= 70 && t$(b, 'ego') >= 70;
      const together = Math.min(6, tenureYears(w, a), tenureYears(w, b));
      const affT = 50 + (t$(a, 'social') + t$(b, 'social') - 100) * 0.2 + (t$(a, 'team') - 50) * 0.15 + ((c?.uni ?? 55) - 50) * 0.25 - (alphas ? 15 : 0) - e[3] * 0.3
        + (Math.abs((a.age ?? 25) - (b.age ?? 25)) <= 3 ? 4 : 0) + together * 1.5;
      toward(e, 0, affT, 0.05);
      // conflict: rivalry for the ball and the credit, or a standard-setter who will not accept the other's habits
      let dc = -2 + (t.streak >= 3 ? -1 : 0);
      if (alphas) dc += 3 + (t.streak <= -4 ? 2 : 0);
      if (isMonster(a) && t$(b, 'discipline') < 45 && rb < 8) dc += 2.5 * (t$(a, 'assert') / 90);
      const mb = mpgNow(w, b), ma = mpgNow(w, a);
      if (ma != null && mb != null && ra < rb && ma < mb - 6 && t$(a, 'ego') >= 65) dc += 1.5; // he plays more than me and he is worse
      nudge(e, 3, dc);
    }
    // player -> coach, player -> organisation, morale
    for (const p of ps) {
      const r = rank.get(p.id)!, mpg = mpgNow(w, p);
      if (coach) {
        const e = edge(w, p.id, coach.id, () => [50, 55, Math.round(50 + (coach.communication - 55) * 0.3), 0, S.year]);
        e[4] = S.year;
        const tgt = 50 + (mpg != null ? (mpg - expectedMin(r)) * 1.2 : 0) + (coach.communication - 55) * 0.4 + (winPct(t) - 0.5) * 20;
        toward(e, 2, tgt, 0.06);
      }
      const o = edge(w, p.id, ORG(t.id), () => [55, 50, 55, 0, S.year]);
      o[4] = S.year;
      const ringsW = motive(p, 'rings') * 6;
      toward(o, 2, 52 + (winPct(t) - 0.5) * 40 * ringsW + (t.w + t.l < 10 ? 0 : 0), 0.025);
      const cu = c ? (c.uni - 55) * 0.04 : 0;
      const trustC = coach ? (trustIn(w, p.id, coach.id) - 50) * 0.03 : 0;
      p.morale = clamp((p.morale ?? 60) + cu + trustC + (t.streak >= 4 ? 0.6 : t.streak <= -4 ? -0.6 : 0) - ((p as any).wantsOut ? 0.8 : 0), 0, 100);
    }
    // feuds anywhere in the league, noted once a season
    const fn = ((t as any).feudNoted ??= {}) as Record<string, number>;
    for (let i = 0; i < Math.min(6, core.length); i++) for (let j = i + 1; j < Math.min(6, core.length); j++) {
      const a = core[i], b = core[j], k = [a.id, b.id].sort().join('|');
      if (fn[k] === S.year || Math.max(rel(w, a.id, b.id)?.[3] ?? 0, rel(w, b.id, a.id)?.[3] ?? 0) < 65) continue;
      fn[k] = S.year; chron(w, 'feud', `Feud inside ${t.abbr}: ${a.name} and ${b.name}`, [a.id, b.id]);
    }
    stepCulture(w, t, 0.07);
    mentorships(w, t, ps);
    if (isUser(w, t.id)) lockerRoomEvents(w, t, ps);
    if (S.phase === 'regular' && dayN(S.day) % 28 < 7) tradeRequests(w, t, ps);
  }
  checkPromises(w);
}
const dayN = (d: string) => Math.floor(Date.parse(d + 'T12:00:00Z') / 86400000);

/** A player who has just joined a team: tenure starts, and the people already there form a first impression. */
function arrive(w: World, t: Team, p: Player) {
  const tn = (p as any).tenure as { team: string; since: number } | undefined;
  if (tn?.team === t.id) return;
  (p as any).tenure = { team: t.id, since: w.season.year };
  delete (p as any).mentor;
  const o = edge(w, p.id, ORG(t.id), () => [55, 50, 55, 0, w.season.year]);
  if (o[2] < 45) o[2] = 45;
  if (isUser(w, t.id)) edge(w, p.id, 'gm', () => [50, Math.round(45 + (w.gmRep - 50) * 0.4), Math.round(52 + (w.gmRep - 50) * 0.2), 0, w.season.year]);
  if (isUser(w, t.id) && (isMonster(p) || (mentality(p) >= 89 && playerValue(p) >= 68)) && w.season.year > 1976) {
    const coach = w.coaches[t.coach];
    addMessage(w, { date: w.season.day, from: coach?.name ?? 'Coach', role: 'Coach', subject: `${p.name} has changed the temperature in practice`,
      body: `${loud(p) ? `${first(p.name)} has been here a week and the gym already feels different: he goes at people in drills and expects the same back.` : `${first(p.name)} is first in the gym and last out, and he barely says a word about it. The younger players have started showing up early to keep pace.`} The players who match him will get better. The ones who don't will feel it. (In this universe: a simulated personality.)`,
      urgent: 1, tag: 'Locker room', actions: [{ label: 'Open the locker room', cmd: 'goto', arg: 'roster:locker' }] });
  }
}

const loud = (p: Player) => t$(p, 'assert') >= 85 || (p as any).persona === 'killer' || (p as any).persona === 'heart';

function mentorships(w: World, t: Team, ps: Player[]) {
  const r = stream(w.meta.seed, 'mentor', w.season.day, t.id);
  const vets = ps.filter(p => (p.age ?? 25) >= 27 && t$(p, 'discipline') >= 85 && t$(p, 'drive') >= 85 && t$(p, 'social') >= 35);
  if (!vets.length) return;
  for (const y of ps) {
    if ((y.age ?? 25) > 23 || (y as any).mentor) continue;
    const best = vets.filter(v => ps.filter(q => (q as any).mentor === v.id).length < 2).map(v => ({ v, resp: rel(w, y.id, v.id)?.[1] ?? 50 })).filter(x => x.resp >= 62).sort((a, b) => b.resp - a.resp)[0];
    if (!best || !r.chance(0.08)) continue;
    (y as any).mentor = best.v.id;
    nudge(edge(w, y.id, best.v.id), 0, 10); nudge(edge(w, best.v.id, y.id), 0, 8);
    remember(w, y.id, best.v.id, `${best.v.name} took ${y.name} under his wing`);
    if (playerValue(best.v) >= 76 || mentality(best.v) >= 92) chron(w, 'mentor', `${best.v.name} (${t.abbr}) took ${y.name} (age ${y.age}) under his wing`, [best.v.id, y.id]);
    if (isUser(w, t.id)) addMessage(w, { date: w.season.day, from: w.coaches[t.coach]?.name ?? 'Coach', role: 'Coach', subject: `${best.v.name} has taken ${y.name} under his wing`,
      body: `They're in the gym early together most days now. ${first(best.v.name)}'s habits are the kind that rub off; expect ${first(y.name)}'s work ethic to move toward his.`, urgent: 0, tag: 'Locker room' });
  }
}

function lockerRoomEvents(w: World, t: Team, ps: Player[]) {
  const S = w.season, mem = ((t as any).lr ??= {}) as Record<string, string>;
  const since = (k: string, days: number) => !mem[k] || dayN(S.day) - dayN(mem[k]) >= days;
  const coach = w.coaches[t.coach];
  const c = culture(t);
  // a losing streak: someone has to say something
  if (S.phase === 'regular' && t.streak <= -5 && since('meeting', 30) && c) {
    const lead = c.leaders.map(id => w.players[id]).find(p => p && t$(p, 'assert') >= 72);
    if (lead) {
      mem.meeting = S.day;
      const respect = ps.filter(p => p !== lead).reduce((s, p) => s + (rel(w, p.id, lead.id)?.[1] ?? 50), 0) / Math.max(1, ps.length - 1);
      const good = respect >= 58 && !(t$(lead, 'ego') >= 80 && c.uni < 50);
      for (const p of ps) p.morale = clamp((p.morale ?? 60) + (good ? 5 : -2), 0, 100);
      if (good) c.uni = Math.min(99, c.uni + 2.5);
      else { const low = ps.filter(p => p !== lead && t$(p, 'discipline') < 55).slice(0, 2); for (const p of low) { nudge(edge(w, lead.id, p.id), 3, 12); nudge(edge(w, p.id, lead.id), 3, 10); } }
      chron(w, 'meeting', `${lead.name} called a players-only meeting after ${-t.streak} straight losses (${t.abbr}): ${good ? 'it worked' : 'it turned heated'} [USER]`, [lead.id]);
      addMessage(w, { date: S.day, from: coach?.name ?? 'Coach', role: 'Coach', subject: `${lead.name} called a players-only meeting`,
        body: good ? `After ${-t.streak} straight losses ${first(lead.name)} closed the doors and said what needed saying. The room listened. Practice was sharper the next day.`
          : `After ${-t.streak} straight losses ${first(lead.name)} closed the doors. It got loud, and not everyone took it well. Some of this will linger.`, urgent: 1, tag: 'Locker room' });
    }
  }
  // friction in the core
  const core = ps.slice(0, 7);
  for (let i = 0; i < core.length; i++) for (let j = i + 1; j < core.length; j++) {
    const a = core[i], b = core[j];
    const ca = rel(w, a.id, b.id)?.[3] ?? 0, cb = rel(w, b.id, a.id)?.[3] ?? 0;
    const k = `feud:${[a.id, b.id].sort().join('|')}`;
    if (Math.max(ca, cb) < 62 || !since(k, 50)) continue;
    if (w.messages.some(m => !m.resolved && m.tag === 'Locker room' && m.actions?.some(x => x.cmd === 'mediate'))) return;
    mem[k] = S.day;
    const hot = ca >= cb ? a : b, other = hot === a ? b : a;
    const why = isMonster(hot) && t$(other, 'discipline') < 50 ? `${first(hot.name)} thinks ${first(other.name)} doesn't work hard enough and has started saying it in front of the group.`
      : t$(hot, 'ego') >= 70 && t$(other, 'ego') >= 70 ? `It's about the ball and the credit. Both want to be the one the team runs through.`
      : `${first(hot.name)} feels ${first(other.name)} is getting a role he hasn't earned.`;
    addMessage(w, { date: S.day, from: coach?.name ?? 'Coach', role: 'Coach', subject: `Friction between ${a.name} and ${b.name}`, body: `${why} It boiled over at practice. Nothing that has reached the press yet.`,
      urgent: 2, tag: 'Locker room', actions: [{ label: 'Meet with both of them', cmd: 'mediate', arg: { a: hot.id, b: other.id, how: 'gm' } }, { label: 'Let the coach handle it', cmd: 'mediate', arg: { a: hot.id, b: other.id, how: 'coach' } }, { label: 'Stay out of it', cmd: 'mediate', arg: { a: hot.id, b: other.id, how: 'none' } }] });
    return;
  }
}

/** The GM chooses how a locker-room conflict is handled (GDD §13.3 crisis workflow, first version). */
export function mediate(w: World, aId: string, bId: string, how: 'gm' | 'coach' | 'none'): string {
  const a = w.players[aId], b = w.players[bId];
  if (!a || !b || a.team !== b.team) return 'That has resolved itself: they are no longer teammates.';
  const t = w.teams[a.team!], coach = w.coaches[t.coach];
  const r = stream(w.meta.seed, 'mediate', w.season.day, aId, bId);
  const note = (res: string) => { chron(w, 'mediation', `[USER] feud ${a.name} vs ${b.name}: GM chose ${how === 'gm' ? 'to meet both' : how === 'coach' ? 'to let the coach handle it' : 'to stay out'}; ${res}`, [aId, bId]); };
  const ea = edge(w, a.id, b.id), eb = edge(w, b.id, a.id);
  if (how === 'gm') {
    const ok = r.chance(sigmoid((trustIn(w, a.id, 'gm') + trustIn(w, b.id, 'gm') - 100) / 30 + (w.gmRep - 50) / 40 + (t$(a, 'poise') + t$(b, 'poise') - 120) / 60 + 0.3));
    if (ok) { nudge(ea, 3, -30); nudge(eb, 3, -30); nudge(ea, 0, 5); nudge(eb, 0, 5); nudge(edge(w, a.id, 'gm'), 2, 4); nudge(edge(w, b.id, 'gm'), 2, 4); remember(w, a.id, b.id, `Cleared the air with ${b.name} in a meeting with the GM`); note('it worked'); return `You sat them down together. It was uncomfortable, then it was useful. They shook on it, and both said they appreciated you stepping in.`; }
    nudge(ea, 3, -8); nudge(eb, 3, -8); nudge(edge(w, a.id, 'gm'), 2, -5); remember(w, a.id, 'gm', 'Felt the front office took sides in his dispute');
    note(`it failed; ${a.name} felt the GM took sides`);
    return `The meeting didn't land. ${first(a.name)} left feeling the front office took ${first(b.name)}'s side. It has cooled a little, but he'll remember it.`;
  }
  if (how === 'coach') {
    if (!coach) return 'There is no coach to hand it to.';
    const ok = r.chance(sigmoid((coach.communication - 55) / 12 + (trustIn(w, a.id, coach.id) + trustIn(w, b.id, coach.id) - 100) / 40));
    if (ok) { nudge(ea, 3, -25); nudge(eb, 3, -25); nudge(edge(w, a.id, coach.id), 2, 3); nudge(edge(w, b.id, coach.id), 2, 3); note('the coach fixed it'); return `${coach.name} handled it his way: film, a hard practice and a word with each of them. It worked. They're back to playing for each other.`; }
    nudge(ea, 3, 5); nudge(edge(w, a.id, coach.id), 2, -5); note('the coach failed');
    return `${coach.name} tried, but ${first(a.name)} didn't buy it. The coach has lost a little of him, and the friction is still there.`;
  }
  if (t$(a, 'assert') >= 85 && t$(b, 'assert') >= 80 && r.chance(0.4)) { nudge(ea, 3, 10); nudge(eb, 3, 8); const c = culture(t); if (c) c.uni = Math.max(5, c.uni - 3); note('it got worse; teammates picked sides'); return `Left alone, it got worse. Teammates are starting to pick sides.`; }
  nudge(ea, 3, -10); nudge(eb, 3, -10); note('it cooled off');
  return `You let them sort it out. Professionals mostly do; it has cooled off for now.`;
}

/** A star who wants to win, on a team that isn't, eventually asks out (GDD §12.5). */
function tradeRequests(w: World, t: Team, ps: Player[]) {
  const S = w.season;
  if (t.w + t.l < 30 || winPct(t) >= 0.42) return;
  const r = stream(w.meta.seed, 'treq', S.day, t.id);
  for (const p of ps.slice(0, 2)) {
    const age = p.age ?? 27;
    if (age < 24 || age > 33 || playerValue(p) < 72 || (p as any).wantsOut) continue;
    if (t$(p, 'drive') < 80 && motive(p, 'rings') < 0.14) continue;
    if (tenureYears(w, p) < 1) continue;
    if ((w.promises ?? []).some(x => x.to === p.id && x.status === 'open' && x.kind === 'contend')) continue;
    const lastMissed = t.history.slice(-1)[0]?.result === 'Missed playoffs';
    const trustO = trustIn(w, p.id, ORG(t.id));
    if (!lastMissed || trustO >= 48) continue;
    const loyal = (t$(p, 'loyalty') - 50) / 25;
    if (!r.chance(clamp(0.32 + (48 - trustO) / 40 + (motive(p, 'rings') - 0.12) * 3 - loyal * 0.25, 0.05, 0.75))) continue;
    (p as any).wantsOut = t.id;
    remember(w, p.id, ORG(t.id), `Asked to be traded from ${t.city}`);
    addEvent(w, 'trade_request', `${p.name} asked ${t.abbr} for a trade`, [p.id]);
    if (isUser(w, t.id)) {
      addMessage(w, { date: S.day, from: `Agent for ${p.name}`, role: 'Agent', subject: `${p.name} wants to be traded`,
        body: `${first(p.name)} has lost faith that this team can win while he's in his prime. He's asking for a trade. He hasn't gone public, and he'll keep playing hard, but he wants to know where you stand. (In this universe: a simulated decision, not a claim about the real player.)`,
        urgent: 2, tag: 'Agent', actions: [{ label: 'Promise to build a contender', cmd: 'promise', arg: { pid: p.id, kind: 'contend', req: true } }, { label: 'Explore a trade', cmd: 'tradeFinder', arg: { give: [p.id], get: [] } }, { label: 'Tell him no', cmd: 'refuseRequest', arg: { pid: p.id } }] });
    } else if (playerValue(p) >= 78) addNews(w, `${p.name} wants out of ${t.city}`, `Sources say ${p.name} has asked the ${t.name} to trade him.`, 'transactions');
    return;
  }
}
export function refuseRequest(w: World, pid: string): string {
  const p = w.players[pid];
  nudge(edge(w, pid, 'gm'), 2, -10); p.morale = clamp((p.morale ?? 60) - 8, 0, 100);
  remember(w, pid, 'gm', 'Was told no when he asked for a trade');
  return `You told ${first(p.name)} he isn't going anywhere. He'll play. He won't forget it, and it will weigh on him when his contract comes up.`;
}

// ------------------------------------------------------------------ promises (auditable)
export type PromiseKind = 'role review' | 'contend' | 'no trade' | 'extension';
export const PROMISE_SHORT: Record<PromiseKind, string> = { 'role review': 'Bigger role', contend: 'Contend this season', 'no trade': 'No trade this season', extension: 'Extension talks' };
export const PROMISE_TEXT: Record<PromiseKind, string> = {
  'role review': 'Your role will grow', contend: 'We will build a contender this season', 'no trade': 'You will not be traded this season', extension: 'We will talk extension before the season ends',
};
interface Promise_ { id: string; to: string; kind: string; made: string; due: string; status: string; season?: number; base?: number; text?: string; evidence?: string }

export function makePromise(w: World, pid: string, kind: PromiseKind): string {
  const p = w.players[pid], S = w.season;
  const L = w.promises as Promise_[];
  if (L.some(x => x.to === pid && x.kind === kind && x.status === 'open')) return `You've already promised ${first(p.name)} that.`;
  const season = S.phase === 'regular' || S.phase === 'preseason' ? S.year : S.year + 1;
  const due = kind === 'role review' ? addDays(S.day, 45) : kind === 'extension' ? addDays(S.day, 60) : `${season + 1}-06-30`;
  L.push({ id: `pr${++w.log.seq}`, to: pid, kind, made: S.day, due, status: 'open', season, base: mpgNow(w, p) ?? 0, text: PROMISE_TEXT[kind] });
  const trust = trustIn(w, pid, 'gm');
  const lift = trust >= 45 ? 6 : 1;
  p.morale = clamp((p.morale ?? 60) + lift, 0, 100);
  nudge(edge(w, pid, 'gm'), 2, trust >= 45 ? 3 : 0);
  if (kind === 'contend' && (p as any).wantsOut) delete (p as any).wantsOut;
  addEvent(w, 'promise', `Promised ${p.name}: ${PROMISE_TEXT[kind].toLowerCase()}`, [pid]);
  return trust >= 45 ? `${first(p.name)} takes you at your word. He'll hold you to it.` : `${first(p.name)} heard you. After the last time, he isn't sure he believes you.`;
}

function settle(w: World, pr: Promise_, kept: boolean, evidence: string) {
  const p = w.players[pr.to];
  pr.status = kept ? 'kept' : 'broken'; pr.evidence = evidence;
  addEvent(w, 'promise', `${kept ? 'Kept' : 'Broke'} promise to ${p?.name ?? 'a player'}: ${pr.text ?? pr.kind}`, [pr.to]);
  if (!p) return;
  const g = edge(w, p.id, 'gm');
  nudge(g, 2, kept ? 12 : -25);
  if (p.team) nudge(edge(w, p.id, ORG(p.team)), 2, kept ? 6 : -12);
  p.morale = clamp((p.morale ?? 60) + (kept ? 8 : -15), 0, 100);
  remember(w, p.id, 'gm', kept ? `The GM kept his word: ${(pr.text ?? pr.kind).toLowerCase()}` : `The GM broke his word: ${(pr.text ?? pr.kind).toLowerCase()}`);
  // word travels among friends
  if (p.team) for (const id of w.teams[p.team].roster) { if (id === p.id) continue; if ((rel(w, id, p.id)?.[0] ?? 0) >= 66) nudge(edge(w, id, 'gm'), 2, kept ? 2 : -6); }
  if (p.team === w.meta.userTeam) addMessage(w, { date: w.season.day, from: kept ? p.name : `Agent for ${p.name}`, role: kept ? 'Player' : 'Agent', subject: kept ? `${p.name}: "You kept your word"` : `${p.name} feels let down`,
    body: kept ? `${evidence} He noticed, and so did the room.` : `${evidence} You promised: "${pr.text ?? pr.kind}." He'll remember it, and so will the players close to him.`, urgent: kept ? 0 : 2, tag: 'Locker room' });
}

function checkPromises(w: World) {
  const S = w.season;
  for (const pr of (w.promises ?? []) as Promise_[]) {
    if (pr.status !== 'open') continue;
    const p = w.players[pr.to];
    if (!p || p.retired) { pr.status = 'void'; continue; }
    if (pr.kind === 'role review' && S.day >= pr.due) {
      const m = mpgNow(w, p) ?? 0;
      settle(w, pr, m >= (pr.base ?? 0) + 3 || m >= 28, m >= (pr.base ?? 0) + 3 ? `His minutes went from ${(pr.base ?? 0).toFixed(1)} to ${m.toFixed(1)} a night.` : `His minutes haven't moved (${m.toFixed(1)} a night).`);
    } else if (pr.kind === 'extension' && S.day >= pr.due) {
      const ext = !!p.contract?.signed && p.contract.signed >= pr.made;
      settle(w, pr, ext, ext ? 'You came to the table with a new deal.' : 'No extension offer came.');
    }
  }
}
/** At season's end: promises about a whole season. */
function settleSeasonPromises(w: World) {
  for (const pr of (w.promises ?? []) as Promise_[]) {
    if (pr.status !== 'open' || (pr.kind !== 'contend' && pr.kind !== 'no trade') || pr.season !== w.season.year) continue;
    const p = w.players[pr.to];
    if (!p) { pr.status = 'void'; continue; }
    if (pr.kind === 'no trade') { settle(w, pr, true, 'He stayed all season, as you said he would.'); continue; }
    const t = w.teams[p.team ?? ''];
    const h = t?.history.find(x => x.season === w.season.year);
    const ok = !!h && h.result !== 'Missed playoffs' && h.w >= h.l;
    settle(w, pr, ok, ok ? `The team won ${h!.w} games${h!.result === 'Champion' ? ' and the title' : ' and made the playoffs'}.` : `The team won ${h?.w ?? 0} games and ${h?.result === 'Missed playoffs' ? 'missed the playoffs' : 'finished under .500'}.`);
  }
}
const addDays = (d: string, n: number) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

/** A player has been traded away from `from`. */
export function onTraded(w: World, pid: string, from: string) {
  const p = w.players[pid]; if (!p) return;
  for (const pr of (w.promises ?? []) as Promise_[]) if (pr.to === pid && pr.status === 'open') {
    if (pr.kind === 'no trade') settle(w, pr, false, 'He was traded.'); else pr.status = 'void';
  }
  const T = w.teams[from];
  if (T) {
    for (const id of T.roster) {
      if ((rel(w, id, pid)?.[0] ?? 0) < 68) continue;
      nudge(edge(w, id, ORG(from)), 2, -6);
      if (isUser(w, from)) { nudge(edge(w, id, 'gm'), 2, -4); remember(w, id, 'gm', `Lost his friend ${p.name} in a trade`); }
    }
    const c = culture(T);
    if (c?.leaders.includes(pid)) c.uni = Math.max(5, c.uni - 3);
  }
  const wanted = (p as any).wantsOut === from;
  delete (p as any).wantsOut;
  if (p.team) { const o = edge(w, pid, ORG(p.team)); o[2] = wanted ? 62 : 47; }
  (p as any).tenure = p.team ? { team: p.team, since: w.season.year } : undefined;
  delete (p as any).mentor;
}

// ------------------------------------------------------------------ season boundaries
/** Regular season starts: rosters changed over the summer, so culture moves a long way at once. */
export function peopleSeasonStart(w: World) {
  for (const t of Object.values(w.teams)) {
    for (const p of rosterOf(w, t)) arrive(w, t, p);
    stepCulture(w, t, 0.35);
  }
}

/** Offseason: motivations evolve (F17), young players absorb the culture, roots deepen or wither, the graph is pruned. */
export function peopleOffseason(w: World) {
  const S = w.season;
  settleSeasonPromises(w);
  for (const p of Object.values(w.players)) {
    if (p.retired || !(p as any).motives) continue;
    const old = (p as any).motives as Record<string, number>;
    const base = normalize(baseMotives(p));
    const m: Record<string, number> = {};
    for (const k of MOTIVE_KEYS) m[k] = 0.6 * (old[k] ?? 0) + 0.4 * (base[k] ?? 0);
    if (p.team && S.champion === p.team) m.rings *= t$(p, 'drive') >= 95 ? 1 : 0.78;       // the greatest are never full
    if (p.contract && p.contract.years >= 3 && p.contract.signed?.startsWith(String(S.year))) m.money *= 0.75;
    if (p.injury?.severity === 'serious') m.longevity *= 1.3;
    const mp = mpgNow(w, p);
    if (mp != null && mp < 15 && playerValue(p) >= 60) m.role *= 1.3;
    (p as any).motives = normalize(m);
    // the room rubs off on the young
    if (p.team && (p.age ?? 30) <= 25 && !(p as any).persona) {
      const c = culture(w.teams[p.team]);
      if (c) { p.traits.drive = Math.round(clamp(p.traits.drive + (c.std - p.traits.drive) * 0.04, 5, 97)); p.traits.discipline = Math.round(clamp(p.traits.discipline + (c.std - p.traits.discipline) * 0.05, 5, 97)); p.traits.team = Math.round(clamp(p.traits.team + (c.uni - p.traits.team) * 0.03, 5, 97)); }
      const mt = w.players[(p as any).mentor];
      if (mt && mt.team === p.team) { p.traits.discipline = Math.round(clamp(p.traits.discipline + (mt.traits.discipline - p.traits.discipline) * 0.08, 5, 97)); p.traits.drive = Math.round(clamp(p.traits.drive + (mt.traits.drive - p.traits.drive) * 0.05, 5, 97)); }
    }
    if ((p as any).wantsOut && p.team !== (p as any).wantsOut) delete (p as any).wantsOut;
  }
  for (const t of Object.values(w.teams)) {
    const c = culture(t); if (!c) continue;
    if (c.std >= 72 && c.uni >= 55) c.roots = Math.min(6, c.roots + 1); else c.roots = Math.max(0, c.roots - 1);
    if (S.champion === t.id) { c.roots = Math.min(6, c.roots + 1); for (const id of t.roster) for (const id2 of t.roster) if (id !== id2) { const e = rel(w, id, id2); if (e) nudge(e, 0, 6); } }
  }
  // prune: forget faded ties, keep friendships and feuds
  const G = graph(w);
  for (const [k, e] of Object.entries(G)) {
    const [a, b] = k.split('>');
    const pa = w.players[a], pb = w.players[b];
    if (!pa || pa.retired && S.year - e[4] > 2) { delete G[k]; continue; }
    if (pb && pa.team !== pb.team && e[0] < 66 && e[3] < 45) { delete G[k]; continue; }
    if (b.startsWith('org:')) { if (pa.team !== b.slice(4) && S.year - e[4] > 4) delete G[k]; continue; }
    if (!pb && b !== 'gm' && w.coaches[b]?.team !== pa.team) { delete G[k]; continue; }
    if (S.year - e[4] > 8) delete G[k];
  }
  const L = w.promises as Promise_[];
  if (L.length > 120) w.promises = L.filter(x => x.status === 'open' || dayN(S.day) - dayN(x.made) < 900) as any;
}

/** New world or old save: everyone gets a full person, every team a culture. */
export function initPeople(w: World) {
  for (const p of Object.values(w.players)) initPerson(p, w.meta.seed);
  for (const t of Object.values(w.teams)) {
    for (const p of rosterOf(w, t)) if (!(p as any).tenure) (p as any).tenure = { team: t.id, since: inferSince(w, p, t.id) };
    if (!culture(t)) stepCulture(w, t, 1);
  }
  (w as any).peopleVersion = 1;
}
function inferSince(w: World, p: Player, tid: string) {
  const ab = w.teams[tid].abbr;
  let since = w.season.year;
  const lines = (p.stats ?? []).filter(s => !s.playoffs).sort((a, b) => b.season - a.season);
  for (const s of lines) { if (s.team === ab || s.team === tid) since = s.season; else break; }
  return since;
}
export function migratePeople(w: World) { if ((w as any).peopleVersion !== 1) initPeople(w); }

// ------------------------------------------------------------------ what the GM can see
const band = (v: number) => (v >= 85 ? 'Elite' : v >= 72 ? 'Strong' : v >= 58 ? 'Solid' : v >= 45 ? 'Mixed' : 'Weak');
export const cultureBand = band;
export function trustWord(v: number) { return v >= 72 ? 'Trusts you' : v >= 58 ? 'Gives you the benefit of the doubt' : v >= 43 ? 'Still making up his mind' : v >= 30 ? 'Wary' : 'Does not trust you'; }
export function orgTrustWord(v: number) { return v >= 70 ? 'Believes in the direction' : v >= 52 ? 'Patient' : v >= 40 ? 'Losing faith' : 'Wants out'; }

export function relationsOf(w: World, pid: string) {
  const p = w.players[pid];
  const G = graph(w);
  const close: { id: string; name: string; v: number }[] = [], friction: { id: string; name: string; v: number }[] = [];
  for (const [k, e] of Object.entries(G)) {
    if (!k.startsWith(pid + '>')) continue;
    const b = k.slice(pid.length + 1), q = w.players[b];
    if (!q || q.retired) continue;
    if (e[0] >= 68) close.push({ id: b, name: q.name, v: e[0] });
    if (e[3] >= 45) friction.push({ id: b, name: q.name, v: e[3] });
  }
  const mentees = p?.team ? w.teams[p.team].roster.filter(id => (w.players[id] as any)?.mentor === pid) : [];
  const t = p?.team ? w.teams[p.team] : null;
  return {
    close: close.sort((a, b) => b.v - a.v).slice(0, 4), friction: friction.sort((a, b) => b.v - a.v).slice(0, 3),
    mentor: (p as any)?.mentor as string | undefined, mentees,
    trustGM: rel(w, pid, 'gm')?.[2], trustOrg: t ? rel(w, pid, ORG(t.id))?.[2] : undefined, trustCoach: t ? rel(w, pid, t.coach)?.[2] : undefined,
    wantsOut: !!(p as any)?.wantsOut,
  };
}
