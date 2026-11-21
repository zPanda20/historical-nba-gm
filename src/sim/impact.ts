// Career shapes for the league's most consequential players (from "The NBA Impact Atlas", 80 profiles + 16 near misses).
// These are opportunities, not scripts: a ceiling high enough to separate from the league, a development arc that matches
// when the real player peaked and how long he held it, and an injury hazard where the record shows one. Minutes, coaching,
// injuries and luck still decide what actually happens in a save.
import type { Player, World } from './types';
import { clamp, stream } from './rng';
import { playerValue } from './coach';

/** kind: n normal · late late bloomer · long exceptional longevity · frag short apex/fragile · spec defensive/rebounding specialist · re role reinvention */
export type ArcKind = 'n' | 'late' | 'long' | 'frag' | 'spec' | 're';
export interface Arc { a0: number; a1: number; kind: ArcKind; risk: number; tier: number }
type Row = [nbaId: number, peakOvr: number, primeStart: number, primeEnd: number, kind: ArcKind, risk?: number, spec?: Record<string, number>];

const ROWS: Row[] = [
  // Part I — post-merger foundations
  [76003, 96, 1976, 1982, 'long'], [76681, 92, 1976, 1983, 'n'], [77449, 92, 1978, 1983, 'long', 1, { oreb: 99, dreb: 95 }], [78450, 93, 1976, 1978, 'frag', 2.6],
  [76804, 91, 1977, 1982, 'n'], [77498, 89, 1976, 1978, 're'], [78326, 89, 1976, 1979, 'frag', 1.6], [77141, 86, 1978, 1987, 'long', 1, { perD: 95, stl: 86 }],
  [76673, 88, 1981, 1989, 'late'], [77264, 89, 1983, 1985, 'n', 1.5],
  // Part II — Showtime, Boston, Detroit, Chicago
  [77142, 96, 1984, 1990, 'n'], [1449, 96, 1983, 1988, 'n', 1.3], [78318, 91, 1984, 1990, 'n', 1.1], [1450, 88, 1985, 1988, 'n', 1.3], [305, 87, 1981, 1987, 'long'],
  [1460, 88, 1985, 1991, 'n'], [1122, 89, 1985, 1993, 'n'], [17, 90, 1987, 1992, 'n'], [165, 96, 1992, 1995, 'late'], [893, 97, 1987, 1998, 'long'],
  [787, 93, 1987, 1993, 'n'], [304, 90, 1988, 1995, 'long'], [252, 92, 1988, 2001, 'long'], [121, 91, 1989, 1995, 'n'],
  [23, 84, 1989, 1998, 'spec', 1, { dreb: 99, oreb: 98, perD: 93, intD: 90, stamina: 96 }], [937, 91, 1991, 1997, 'n'], [397, 87, 1993, 2002, 'long', 1, { three: 97, ft: 92 }],
  [764, 94, 1991, 1996, 'n'], [247, 86, 1988, 1993, 'n'],
  // Part III — 1990s and early 2000s
  [406, 96, 1999, 2002, 'n', 1.2], [87, 85, 1994, 2001, 'spec', 1, { blk: 99, intD: 96, dreb: 93 }], [56, 90, 1994, 2002, 'long', 1, { perD: 95, stl: 90 }],
  [297, 89, 1998, 2000, 'n', 1.2], [358, 90, 1994, 1997, 'frag', 1.8], [255, 91, 1996, 2000, 're', 1.8], [467, 90, 1999, 2004, 'long'], [185, 90, 1999, 2003, 'n', 1.3],
  [947, 91, 1999, 2006, 'n'], [977, 95, 2003, 2010, 'long'], [708, 94, 2002, 2005, 'long'], [959, 91, 2004, 2010, 'late'], [951, 88, 2000, 2007, 'long', 1, { three: 97 }],
  [1495, 96, 1999, 2005, 'long'], [1717, 93, 2004, 2011, 'late'], [1718, 88, 2001, 2008, 'long'], [1713, 89, 2000, 2007, 're'], [1503, 92, 2001, 2005, 'frag', 1.5],
  [1112, 85, 2001, 2006, 'spec', 1, { intD: 97, blk: 93, dreb: 95, oreb: 88 }],
  // Part IV — globalisation and the perimeter
  [2200, 89, 2005, 2010, 'long'], [2225, 88, 2007, 2013, 'n'], [2397, 91, 2005, 2009, 'frag', 2.2], [1938, 87, 2005, 2011, 'long'], [2544, 97, 2009, 2020, 'long'],
  [2548, 92, 2006, 2011, 'n', 1.3], [2546, 89, 2009, 2014, 'n'], [2547, 87, 2007, 2015, 'n'], [2730, 90, 2008, 2012, 'n', 1.2], [101108, 92, 2007, 2015, 'long', 1.2],
  [201142, 95, 2012, 2019, 'long'], [201565, 91, 2010, 2012, 'frag', 1.8], [201566, 91, 2015, 2018, 'n'], [201939, 96, 2015, 2022, 'long', 1, { three: 99, ft: 95 }], [201935, 93, 2017, 2020, 'n'],
  // Part V — positionless era
  [202695, 93, 2016, 2019, 'late', 1.6], [203076, 93, 2017, 2020, 'n', 1.5], [202681, 89, 2015, 2024, 'n', 1.2], [203081, 90, 2018, 2023, 'n', 1, { three: 96 }], [202710, 89, 2017, 2023, 'late', 1.2],
  [202691, 87, 2014, 2019, 'n', 1.2, { three: 97 }], [203110, 84, 2015, 2019, 'spec', 1, { perD: 91, intD: 90, pass: 88, iq: 96 }], [203507, 95, 2019, 2022, 'late'], [203999, 96, 2021, 2026, 'late'],
  [203954, 94, 2021, 2024, 'n', 1.8], [1629029, 94, 2022, 2026, 'n'], [1628369, 91, 2021, 2025, 'n'], [1628983, 94, 2023, 2026, 'late'], [1641705, 95, 2025, 2031, 'n'],
  [1628973, 90, 2023, 2026, 'late'], [1627759, 88, 2022, 2026, 'n'], [1630162, 91, 2023, 2028, 'n'],
  // near misses and honourable mentions
  [600013, 86, 1976, 1977, 'n'], [600014, 88, 1976, 1982, 'long'], [76979, 86, 1976, 1979, 'n'], [76054, 86, 1976, 1981, 're'], [76504, 88, 1979, 1986, 'n'],
  [904, 88, 1988, 1992, 'n'], [1497, 88, 2003, 2009, 'late'], [431, 88, 1992, 1997, 'n'], [2405, 89, 2004, 2010, 'n', 1.4], [200750, 88, 2007, 2009, 'frag', 1.8],
  [201933, 89, 2011, 2015, 'n', 1.3], [202331, 89, 2016, 2019, 'n'], [203497, 84, 2017, 2024, 'spec', 1, { intD: 97, blk: 95, dreb: 95 }], [1630169, 88, 2022, 2026, 'n'],
  [1630595, 89, 2023, 2028, 'n'], [1642843, 92, 2026, 2032, 'n'],
];
export const IMPACT: Record<number, Row> = Object.fromEntries(ROWS.map(r => [r[0], r]));
export const isImpact = (p: Player) => !!(p.nbaId && IMPACT[p.nbaId]);

/** Ceiling of everyone else: real careers outside the list stay excellent but rarely reach the stars' air. */
export const SOFT_CEILING = 84;

function birthYear(p: Player, season: number) { return p.born ? +p.born.slice(0, 4) : season - (p.age ?? 22); }

/** Raise a player's ceilings until his best possible overall reaches `target`, stretching his strongest skills most. */
function liftCeilings(p: Player, target: number, spec?: Record<string, number>) {
  const keys = Object.keys(p.r).filter(k => k !== 'hgt') as (keyof Player['r'])[];
  for (const k of keys) p.ceil[k] = p.ceil[k] ?? { mu: p.r[k] as number, sd: 4 };
  if (spec) for (const [k, v] of Object.entries(spec)) if (p.ceil[k]) p.ceil[k].mu = Math.max(p.ceil[k].mu, v);
  const base = Object.fromEntries(keys.map(k => [k, Math.max(p.ceil[k].mu, p.r[k] as number)]));
  const order = [...keys].sort((a, b) => base[a] - base[b]);
  const weight = Object.fromEntries(order.map((k, i) => [k, 0.3 + 0.7 * i / (order.length - 1)]));
  const potAt = (d: number) => { const r: any = { ...p.r }; for (const k of keys) r[k] = Math.min(99, base[k] + d * weight[k]); return playerValue({ ...p, r }); };
  let lo = 0, hi = 60;
  if (potAt(0) >= target) return;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (potAt(m) < target) lo = m; else hi = m; }
  for (const k of keys) p.ceil[k] = { mu: Math.round(Math.min(99, base[k] + hi * weight[k])), sd: 3 };
}

/** Bring an ordinary real player's ceiling under the stars' (only the part above SOFT_CEILING is squeezed). */
function softenCeilings(p: Player) {
  const keys = Object.keys(p.ceil) as (keyof Player['r'])[];
  const pot = () => { const r: any = { ...p.r }; for (const k of keys) r[k] = Math.max(p.r[k] as number, p.ceil[k].mu); return playerValue({ ...p, r }); };
  const P = pot();
  if (P <= SOFT_CEILING) return;
  const want = SOFT_CEILING + (P - SOFT_CEILING) * 0.4;
  for (let i = 0; i < 12 && pot() > want + 0.3; i++) for (const k of keys) {
    const c = p.ceil[k]; c.mu = Math.max(p.r[k] as number, Math.round(c.mu - Math.max(1, (c.mu - 50) * 0.04)));
  }
}

/**
 * Shape a real player's career on entry (draft class, undrafted arrival, or the 1976 roster): an arc for the listed players,
 * a softened ceiling for everyone else. Idempotent per player.
 */
export function shapeCareer(p: Player, season: number, pullToPrime = true) {
  if ((p as any).shaped) return;
  (p as any).shaped = 1;
  const row = p.nbaId ? IMPACT[p.nbaId] : undefined;
  if (!row) {
    if (!p.nbaId) return;
    // veterans already in the league in 1976 arrive with ratings, not just ceilings: squeeze the top of those too
    const v = playerValue(p);
    if (v > SOFT_CEILING - 2) {
      const want = SOFT_CEILING - 2 + (v - SOFT_CEILING + 2) * 0.4;
      const keys = Object.keys(p.ceil) as (keyof Player['r'])[];
      for (let i = 0; i < 20 && playerValue(p) > want + 0.3; i++) for (const k of keys) if ((p.r[k] as number) > 50) (p.r as any)[k] = (p.r[k] as number) - 1;
      p.ovr = Math.round(playerValue(p));
    }
    softenCeilings(p);
    return;
  }
  const [, peak, ps, pe, kind, risk = 1, spec] = row;
  const by = birthYear(p, season);
  const arc: Arc = { a0: ps - by, a1: pe - by, kind, risk, tier: peak };
  (p as any).arc = arc;
  liftCeilings(p, peak, spec);
  // a finished star arriving in his prime (the 1976 ABA and NBA veterans) is already close to it
  const age = p.age ?? season - by;
  const inPrime = age >= arc.a0 && age <= arc.a1;
  const pull = !pullToPrime ? 0 : inPrime ? 0.9 : age >= arc.a0 - 2 && age < arc.a0 ? 0.45 : 0;
  if (pull) for (const k of Object.keys(p.ceil) as (keyof Player['r'])[]) (p.r as any)[k] = Math.round((p.r[k] as number) + (p.ceil[k].mu - (p.r[k] as number)) * pull);
  p.ovr = Math.round(playerValue(p));
}

/** Rare generational talents in the simulated future, at roughly the historical rate (about two a class). */
export function seedFictionalStar(p: Player, slot: number, seed: string, year: number) {
  const r = stream(seed, 'future-star', year, p.id);
  const chance = slot < 10 ? 0.08 : slot < 30 ? 0.025 : 0.008;
  (p as any).shaped = 1;
  if (!r.chance(chance)) { softenCeilings(p); return; }
  const tier = r.chance(0.15) ? 95 : r.chance(0.4) ? 92 : 89;
  const kind: ArcKind = r.pick(['n', 'n', 'n', 'late', 'long', 'frag']);
  const a0 = (p.age ?? 20) + r.int(kind === 'late' ? 6 : 3, kind === 'late' ? 9 : 6);
  const arc: Arc = { a0, a1: a0 + (kind === 'long' ? r.int(7, 10) : kind === 'frag' ? r.int(2, 3) : r.int(4, 7)), kind, risk: kind === 'frag' ? 1.8 : 1, tier };
  (p as any).arc = arc;
  liftCeilings(p, tier);
  p.ovr = Math.round(playerValue(p));
}

/** Development modifiers for a player with an arc at a given age. */
export function arcDev(p: Player, age: number): { etaMin: number; declineMul: number; oppMin: number } {
  const a: Arc | undefined = (p as any).arc;
  if (!a) return { etaMin: 0, declineMul: 1, oppMin: 0 };
  if (age < a.a0) return { etaMin: a.kind === 'late' && age < a.a0 - 3 ? 0.14 : 0.24, declineMul: 0.3, oppMin: 0.8 };
  if (age <= a.a1) return { etaMin: 0.3, declineMul: 0.15, oppMin: 0.85 };
  const past = age - a.a1;
  return { etaMin: 0, declineMul: a.kind === 'long' ? 0.5 : a.kind === 're' ? 0.75 : a.kind === 'frag' ? 1.35 : 1 + Math.min(0.2, past * 0.03), oppMin: 0 };
}

export const injuryRisk = (p: Player) => ((p as any).arc as Arc | undefined)?.risk ?? 1;

// ------------------------------------------------------------------ draft-room perception
// What the league believed before the draft. `perception` sets where the consensus board had him; the scouting text is the
// pre-draft read only (strengths and doubts), never the career that followed.
export interface PreDraft { slot: number; note: string }
export const PRE_DRAFT: Record<number, PreDraft> = {
  // overlooked or undervalued
  76385: { slot: 36, note: 'Pass-first guard from West Texas State. Steady, controlled, makes good decisions; not a scorer, and the small program means few teams have seen him against real competition.' },
  76444: { slot: 60, note: 'Long, athletic New Mexico wing. Real defensive tools, but his offense is limited and he does not create for himself. A specialist at best.' },
  1449: { slot: 6, note: 'Exceptional passer, shooter and thinker; modest athlete. The catch: he can return to Indiana State for his senior year, so whoever takes him may wait a season.' },
  304: { slot: 16, note: 'Efficient, precise Gonzaga point guard with sound fundamentals. Ordinary size and athleticism, and a program nobody watches.' },
  247: { slot: 18, note: 'Well-rounded, mature McNeese State guard who can shoot. Small-school visibility; nothing about his tools jumps out.' },
  899: { slot: 25, note: 'Outstanding Georgia Tech shooter and smart playmaker. Scouts openly question whether he is big or quick enough for the NBA.' },
  23: { slot: 27, note: 'Relentless rebounder and rare athlete from Southeastern Oklahoma State. Very raw offensively, late bloomer, uneven at pre-draft camps.' },
  89: { slot: 37, note: 'Creative, confident Cincinnati point guard and shot-maker. Concerns about attitude, decision-making and shot selection.' },
  977: { slot: 13, note: 'Seventeen-year-old high-school guard with advanced footwork and scoring instincts. No college, deep class, a long way from ready.' },
  959: { slot: 15, note: 'Gifted passer, shooter and decision-maker from Santa Clara. Modest physical tools, low-profile competition, doubts on defense.' },
  1717: { slot: 9, note: 'Skilled, mobile German forward who shoots like a guard at seven feet. Needs strength, and teams are wary of European projects.' },
  1740: { slot: 32, note: 'Tall high-school forward with a soft shot and versatility. Physically far from ready; the offensive game is incomplete.' },
  1938: { slot: 57, note: 'Creative, unorthodox Argentine guard and fierce competitor in Italy. Little NBA exposure, unclear if he ever comes over.' },
  2072: { slot: 43, note: 'Ohio State scorer with a strong left-handed shot. Questions about athleticism and how much else he does.' },
  2225: { slot: 28, note: 'Very quick French guard who gets into the paint at will. Jumper is unreliable; a poor workout raised questions about his toughness.' },
  2240: { slot: 31, note: 'Explosive Arizona scorer without a clear position. Reported maturity concerns.' },
  200794: { slot: 47, note: 'Louisiana Tech rebounder with strength, touch and motor. Considered undersized for a power forward.' },
  201188: { slot: 48, note: 'Big, skilled Spanish center with soft hands and a good feel for passing. Conditioning and athleticism concerns; may stay in Europe.' },
  201939: { slot: 7, note: 'Spectacular Davidson shooter with range and smart off-ball movement. Small frame, defensive questions, and doubts he is a true point guard.' },
  202695: { slot: 15, note: 'Long, powerful San Diego State wing; elite rebounder and defender. 25% from three in college and no defined position.' },
  202710: { slot: 30, note: 'Tough, physical Marquette wing who defends. Older prospect with no obvious creation skill; ceiling looks limited.' },
  203110: { slot: 35, note: 'Michigan State leader, passer and rebounder. Too short for power forward, too slow for small forward.' },
  203507: { slot: 15, note: 'Extremely long, fluid Greek teenager who handles the ball at his size. Second-division competition, no strength, no jumper; a huge unknown.' },
  203999: { slot: 41, note: 'Serbian center with outstanding passing, touch and footwork. Limited athlete, questionable conditioning and defensive mobility.' },
  1627783: { slot: 27, note: 'Energetic, mobile New Mexico State forward with defensive tools. Perimeter skills are raw.' },
  1628983: { slot: 11, note: 'Long Kentucky guard with control, change of pace and defensive potential. Slender frame, low shooting volume, not explosive.' },
  1628973: { slot: 33, note: 'Brilliant Villanova point guard: proven winner, efficient shooter, elite decision-maker. Below-average burst, short wingspan, defensive limits.' },
  1630178: { slot: 21, note: 'Lightning-fast Kentucky guard with defensive energy. Three-point shooting and playmaking are question marks.' },
  1630217: { slot: 30, note: 'Experienced TCU shooter, strong and smart. Short wingspan, ordinary burst, limited creation upside.' },
  17: { slot: 14, note: 'Athletic Houston wing who plays above the rim. Raw jump shot; a Phi Slama Jama dunker to many scouts.' },
  397: { slot: 11, note: 'Thin UCLA shooter with deep range. Slight build and a scoring-only profile; some fans boo the pick.' },
  2594: { slot: 51, note: 'Creighton shooter with textbook mechanics. Not athletic, a defensive liability, a specialist at most.' },
  203114: { slot: 39, note: 'Texas A&M wing with a smooth midrange game coming off a knee-hampered junior year. Nothing stands out physically.' },
  1626164: { slot: 13, note: 'Youngest player in his class, a bench shooter at Kentucky. Smooth scorer; athleticism and defense are doubts.' },
  203497: { slot: 27, note: 'French seven-footer with a record wingspan. Very thin and raw on offense; looked overwhelmed at times in France.' },
  // over-projected
  76154: { slot: 1, note: 'Accomplished Indiana championship center with sound fundamentals and a credible post game. The safe answer at center.' },
  76217: { slot: 2, note: 'Enormous Kentucky center with good hands, passing and defensive potential. Missed two seasons with a leg injury; medicals are a question.' },
  78463: { slot: 3, note: 'Exceptional size and athleticism at NC State with real offensive upside. Development and off-court concerns.' },
  77054: { slot: 3, note: 'Prolific Ohio State scorer with a strong college résumé.' },
  442: { slot: 1, note: 'Mobile, skilled Louisville big man; strong defender and passer, former Final Four Most Outstanding Player. Thin frame.' },
  198: { slot: 2, note: 'Highly accomplished Duke forward: shooting, passing, intelligence, versatility. As polished as they come.' },
  1709: { slot: 1, note: 'Seven-foot Pacific center with massive wingspan and big college numbers. Only picked up the game a few years ago.' },
  2031: { slot: 2, note: 'Explosive LSU big: remarkable leaper, shot blocker and finisher.' },
  2198: { slot: 1, note: 'Enormous high-school prospect with coordination, shot blocking and flashes of perimeter skill. Franchise-player tools.' },
  2401: { slot: 5, note: 'Tall, mobile Georgian forward with perimeter skills; the next European stretch four. Very little top-level experience.' },
  2545: { slot: 2, note: 'Seventeen-year-old Serbian seven-footer with rare footwork, mobility and touch. Several executives call him a special talent.' },
  101107: { slot: 2, note: 'Long, athletic North Carolina forward who flashed star potential off the bench for a national champion.' },
  200745: { slot: 1, note: 'Seven-foot Italian forward who shoots from the perimeter and moves fluidly. Drawing Nowitzki comparisons.' },
  200747: { slot: 3, note: 'Dominant Gonzaga scorer and shot-maker with a fierce competitive streak. Physical tools are average.' },
  201141: { slot: 1, note: 'Ohio State center with size, timing, rebounding and franchise-level rim protection. Offense needs work.' },
  201563: { slot: 2, note: 'Extraordinary Kansas State freshman scorer and rebounder with a polished isolation game.' },
  201934: { slot: 2, note: 'Seven-foot-three UConn center with extraordinary shot blocking and defensive presence.' },
  202682: { slot: 2, note: 'Explosive Arizona forward, hugely productive scorer and a star in the tournament.' },
  203080: { slot: 5, note: 'Dominant Kansas rebounder, powerful athlete, high-energy competitor.' },
  203461: { slot: 1, note: 'Athletic UNLV forward with strength, shooting potential and handle for his size. No consensus No. 1 in this class.' },
  203953: { slot: 2, note: 'Exceptionally polished Duke scorer with advanced footwork and shot creation.' },
  1626143: { slot: 3, note: 'Duke national champion and one of the most refined low-post scorers of his generation.' },
  1627733: { slot: 4, note: 'Seven-foot Croatian forward with mobility, potential shooting and passing.' },
  1628365: { slot: 1, note: 'Excellent Washington combo guard: size, creation, passing and a promising jump shot. Best prospect in the class.' },
  1628367: { slot: 4, note: 'Extremely athletic Kansas wing with defensive potential and transition scoring.' },
  1628963: { slot: 2, note: 'Outstanding Duke scorer and rebounder with elite second-jump explosiveness.' },
  1630164: { slot: 2, note: 'Exceptionally athletic seven-footer, huge wingspan, rim-runner with shooting promise. Played only three college games.' },
  1630165: { slot: 7, note: 'Tall left-handed French lead guard with pick-and-roll passing and defensive tools.' },
};
/** True ceilings for over-projected picks stay ordinary: their careers were not unlucky draws of a star. */
const BUST_CAP: Record<number, number> = { 76154: 74, 78463: 64, 77054: 70, 198: 74, 1709: 70, 2031: 72, 2198: 72, 2401: 60, 2545: 66, 101107: 74, 200745: 76,
  200747: 66, 201563: 75, 201934: 62, 202682: 71, 203080: 66, 203461: 62, 1626143: 72, 1627733: 64, 1628367: 68, 1628963: 74, 1630164: 69, 1630165: 66 };
/** Injury-driven disappointments keep their real talent but carry the medical risk. */
const BUST_RISK: Record<number, number> = { 76217: 2.6, 442: 2, 201141: 3, 203953: 2, 1628365: 1.6, 77490: 2 };

export function shapeDraftOutlier(p: Player) {
  if (!p.nbaId) return;
  const cap = BUST_CAP[p.nbaId];
  if (cap) {
    const keys = Object.keys(p.ceil) as (keyof Player['r'])[];
    const pot = () => { const r: any = { ...p.r }; for (const k of keys) r[k] = Math.max(p.r[k] as number, p.ceil[k].mu); return playerValue({ ...p, r }); };
    for (let i = 0; i < 30 && pot() > cap; i++) for (const k of keys) p.ceil[k].mu = Math.max(p.r[k] as number, p.ceil[k].mu - 1);
  }
  const risk = BUST_RISK[p.nbaId];
  if (risk && !(p as any).arc) (p as any).arc = { a0: 99, a1: 99, kind: 'n', risk, tier: 0 };
}

/**
 * Consensus perception offsets for a real class: the board ranks listed players where the league really had them. Applied once
 * the class exists, so the slot value is read off this class's own talent.
 */
export function setClassPerception(w: World, ids: string[], potentialOf: (p: Player) => number) {
  const ps = ids.map(id => w.players[id]).filter(Boolean);
  const pots = ps.map(potentialOf).sort((a, b) => b - a);
  for (const p of ps) {
    const pre = p.nbaId ? PRE_DRAFT[p.nbaId] : undefined;
    if (!pre) continue;
    const slotPot = pots[clamp(pre.slot - 1, 0, pots.length - 1)];
    (p as any).hype = Math.round((slotPot - potentialOf(p)) * 10) / 10;
    (p as any).preDraft = pre.note;
  }
}
export const hypeOf = (p: Player): number => (p as any).hype ?? 0;

/** Bring an older save up to date: career shapes for real players not yet shaped (no sudden jumps for players already in
 *  the league), consensus perception for draft classes still to come, and the tighter scouting ranges. */
export function migrateSave(w: World, potentialOf: (p: Player) => number) {
  if ((w as any).impactVersion === 1) return;
  (w as any).impactVersion = 1;
  for (const p of Object.values(w.players)) {
    if (p.retired || (p as any).shaped || !p.nbaId) continue;
    const inLeague = !!p.team || (p.stats ?? []).length > 0;
    shapeCareer(p, w.season.year, !inLeague);
    shapeDraftOutlier(p);
  }
  for (const [y, ids] of Object.entries(w.draftClasses)) if (+y > w.season.year && ids.some(id => w.players[id] && !w.players[id].team)) setClassPerception(w, ids, potentialOf);
  for (const p of Object.values(w.players)) if (p.scout && !p.team) for (const k of ['now', 'pot'] as const) {
    const s = p.scout[k]; if (!s) continue;
    const half = Math.max(k === 'now' ? 2 : 3, Math.min(k === 'now' ? 4 : 6, (s.hi - s.lo) / 2 * 0.5));
    s.mid = Math.round(s.mid + hypeOf(p) * (k === 'now' ? 0.5 : 1) * (s.reports ? 0.65 : 1));
    s.mid = Math.min(99, s.mid); s.lo = Math.round(s.mid - half); s.hi = Math.min(99, Math.round(s.mid + half));
  }
}
