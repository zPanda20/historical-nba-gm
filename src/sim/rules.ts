// Roster and calendar rules by era: roster size, the injured list (1990-2005), the 15-man roster (2005), two-way
// contracts (2017, a third slot in 2023) and the trade deadline for each season.
import type { Player, World } from './types';

export interface RosterRules {
  max: number; min: number; il: number; offseasonMax: number; twoWay: number; twoWayGames: number; label: string;
}
export function rosterRules(season: number): RosterRules {
  if (season >= 2023) return { max: 15, min: 13, il: 0, offseasonMax: 21, twoWay: 3, twoWayGames: 50, label: '15-man roster (13 active) and three two-way contracts' };
  if (season >= 2017) return { max: 15, min: 13, il: 0, offseasonMax: 20, twoWay: 2, twoWayGames: 45, label: '15-man roster (13 active) and two two-way contracts' };
  if (season >= 2005) return { max: 15, min: 13, il: 0, offseasonMax: 18, twoWay: 0, twoWayGames: 0, label: '15-man roster (13 active)' };
  if (season >= 1990) return { max: 12, min: 11, il: 3, offseasonMax: 15, twoWay: 0, twoWayGames: 0, label: '12 active players plus up to three on the injured list' };
  return { max: 12, min: 11, il: 0, offseasonMax: 15, twoWay: 0, twoWayGames: 0, label: '12-man roster' };
}
export const isTwoWay = (p: Player | undefined) => !!p?.contract?.twoWay;
export const inSeasonPhase = (w: World) => ['preseason', 'regular', 'playoffs'].includes(w.season.phase);
/** The season whose roster rules apply right now (the summer belongs to the next season). */
export const rosterSeason = (w: World) => (w.season.phase === 'draft' || w.season.phase === 'freeagency' ? w.season.year + 1 : w.season.year);
export function rules(w: World) { return rosterRules(rosterSeason(w)); }

/** Players who count against the roster limit: standard contracts, less those parked on the injured list (1990-2005). */
export function rosterCount(w: World, tid: string): number {
  const R = rules(w);
  const std = w.teams[tid].roster.map(id => w.players[id]).filter(p => p && !isTwoWay(p));
  const hurt = std.filter(p => p.injury && p.injury.daysLeft > 0).length;
  return std.length - Math.min(R.il, hurt);
}
export const twoWayCount = (w: World, tid: string) => w.teams[tid].roster.filter(id => isTwoWay(w.players[id])).length;
/** The most standard contracts a team may carry right now (the offseason allows extra bodies until opening night). */
export const rosterLimit = (w: World) => (inSeasonPhase(w) ? rules(w).max : rules(w).offseasonMax);
export function hasRosterSpot(w: World, tid: string, twoWay = false): boolean {
  if (twoWay) return twoWayCount(w, tid) < rules(w).twoWay;
  return rosterCount(w, tid) < rosterLimit(w);
}
/** Two-way eligibility: four or fewer seasons of NBA service, and two-way contracts exist this season. */
export function twoWayEligible(w: World, p: Player, yos: number) { return rules(w).twoWay > 0 && yos <= 3; }

/** Two-way players are capped at a number of NBA games a season and are ineligible for the playoffs. */
export function twoWayCanPlay(w: World, p: Player): boolean {
  if (!isTwoWay(p)) return true;
  if (w.season.phase === 'playoffs') return false;
  const g = (p.stats ?? []).filter(s => s.season === w.season.year && !s.playoffs).reduce((a, s) => a + s.g, 0);
  return g < (rosterRules(w.season.year).twoWayGames || 45);
}

// ------------------------------------------------------------------ trade deadline
const KNOWN_DEADLINE: Record<number, string> = {
  1998: '1999-03-11', 2011: '2012-03-15', 2017: '2018-02-08', 2018: '2019-02-07', 2019: '2020-02-06', 2020: '2021-03-25',
  2021: '2022-02-10', 2022: '2023-02-09', 2023: '2024-02-08', 2024: '2025-02-06', 2025: '2026-02-05',
};
function thursdayOnOrAfter(y: number, m: number, d: number): string {
  const t = new Date(Date.UTC(y, m - 1, d));
  while (t.getUTCDay() !== 4) t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}
/** Trade deadline for a season (starting year): the league's dates where they are known, otherwise the era's pattern
 *  (mid/late February before 2017, the first full week of February after). */
export function tradeDeadline(season: number): string {
  if (KNOWN_DEADLINE[season]) return KNOWN_DEADLINE[season];
  const y = season + 1;
  if (season >= 2017) return thursdayOnOrAfter(y, 2, 4);
  if (season >= 2000) return thursdayOnOrAfter(y, 2, 15);
  return thursdayOnOrAfter(y, 2, 12);
}
