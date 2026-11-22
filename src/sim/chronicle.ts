// The league's permanent memory for storytelling. The event log, news and messages are capped and roll over; this keeps
// the notable causes and results of a whole save, compactly, so it can be exported for an AI writer (export.ts).
// Entries: [season, 'MM-DD', kind, text, playerIds?]. Nothing here is prose for players to read in the game.
import type { Player, World, GameRec } from './types';
import { playerValue } from './coach';

export type ChronEntry = [number, string, string, string, string[]?];
const LOG = (w: World): ChronEntry[] => ((w as any).chronicle ??= []);
const isUserP = (w: World, p?: Player) => !!p && p.team === w.meta.userTeam;
const honors = (p: Player) => (p.awards ?? []).filter(a => a.award === 'MVP' || a.award === 'Finals MVP' || a.award.startsWith('All-NBA') || a.award === 'DPOY').length;
const star = (p?: Player) => !!p && (playerValue(p) >= 78 || honors(p) >= 2);
const notable = (p?: Player) => !!p && (playerValue(p) >= 70 || honors(p) >= 1);

export function chron(w: World, kind: string, text: string, ids?: string[]) {
  const L = LOG(w);
  const e: ChronEntry = [w.season.year, w.season.day.slice(5), kind, text];
  if (ids?.length) e.push(ids);
  L.push(e);
  if (L.length > 20000) L.splice(0, L.length - 20000);
}
export const chronicle = (w: World) => LOG(w);

/** Called for every world event: keep what a historian would. */
export function noteEvent(w: World, type: string, text: string, ids?: string[]) {
  const ps = (ids ?? []).map(id => w.players[id]).filter(Boolean) as Player[];
  const anyStar = ps.some(star), anyNotable = ps.some(notable), mine = ps.some(p => isUserP(w, p));
  let keep = false;
  switch (type) {
    case 'trade': keep = anyNotable || mine || /pick/.test(text) && ps.length === 0 && /\b1\b|R1/.test(text); break;
    case 'signing': keep = anyStar || (mine && anyNotable); break;
    case 'release': keep = /amnesty|stretch/i.test(text) ? anyNotable : mine && anyNotable; break;
    case 'retire': keep = ps.some(p => playerValue(p) >= 68 || honors(p) >= 1 || new Set((p.stats ?? []).map(s => s.season)).size >= 13); break;
    case 'injury': { const d = +(text.match(/est\. (\d+) days/)?.[1] ?? 0); keep = (anyStar && d >= 20) || (anyNotable && d >= 60) || (w.season.phase === 'playoffs' && anyNotable && d >= 7); break; }
    case 'draft': { const n = +(text.match(/^#(\d+)/)?.[1] ?? 99); keep = n <= 3 || mine && n <= 30; break; }
    case 'series': case 'champion': case 'coach_request': keep = false; break; // the season record covers series; requests are noise
    case 'clock': case 'promise': case 'gm_hired': case 'coach_change': case 'franchise': case 'expansion':
    case 'trade_request': case 'superteam': case 'superteam_talk': case 'recruit': case 'dynasty_incident': keep = true; break;
    default: keep = anyStar;
  }
  if (keep) chron(w, type, text + (mine && type !== 'promise' && type !== 'clock' ? ' [USER]' : ''), ids);
}

/** Single-game feats and Game 7s, from a finished game. */
export function noteGame(w: World, g: GameRec) {
  if (!g.box) return;
  const po = g.playoff;
  const abbr = (id: string) => w.teams[id]?.abbr ?? id;
  for (const [side, tid] of [['home', g.home], ['away', g.away]] as const) {
    for (const l of g.box[side]) {
      const reb = l.oreb + l.dreb;
      const triple = [l.pts, reb, l.ast, l.stl, l.blk].filter(x => x >= 10).length >= 3;
      const big = po ? l.pts >= 45 || (po.round >= 3 && triple && l.pts >= 25) : l.pts >= 57 || (l.pts >= 40 && reb >= 20) || [l.pts, reb, l.ast, l.stl, l.blk].filter(x => x >= 10).length >= 4;
      if (!big) continue;
      const opp = tid === g.home ? g.away : g.home;
      chron(w, 'feat', `${l.name} (${abbr(tid)}) ${l.pts} pts ${reb} reb ${l.ast} ast${l.blk >= 5 ? ` ${l.blk} blk` : ''}${l.stl >= 5 ? ` ${l.stl} stl` : ''} vs ${abbr(opp)}${po ? ` (playoffs R${po.round} G${po.game})` : ''}; ${abbr(g.home)} ${g.hs}-${g.as} ${abbr(g.away)}${g.ot ? ` ${g.ot}OT` : ''}`, [l.pid]);
    }
  }
  if (po && po.game === 7) {
    const all = [...g.box.home.map(l => ({ l, t: g.home })), ...g.box.away.map(l => ({ l, t: g.away }))].sort((a, b) => b.l.pts - a.l.pts)[0];
    const win = g.hs! > g.as! ? g.home : g.away, lose = win === g.home ? g.away : g.home;
    chron(w, 'game7', `Game 7, round ${po.round}: ${abbr(win)} beat ${abbr(lose)} ${Math.max(g.hs!, g.as!)}-${Math.min(g.hs!, g.as!)}${g.ot ? ` in ${g.ot}OT` : ''} at ${abbr(g.home)}; top scorer ${all?.l.name} ${all?.l.pts}`, all ? [all.l.pid] : undefined);
  }
}

/** Season's end: the full bracket with game scores, stat leaders, the GM's record, career peaks. */
export function recordSeason(w: World) {
  const S = w.season, past = w.pastSeasons[w.pastSeasons.length - 1];
  if (!past || past.year !== S.year) return;
  const abbr = (id: string) => w.teams[id]?.abbr ?? id;
  const P = S.playoffs;
  const seedOf = (id: string) => { for (const c of ['East', 'West']) { const s: string[] = (S as any)[`seeds${c}`] ?? P?.seeds?.[c] ?? []; const i = s.indexOf(id); if (i >= 0) return i + 1; } return 0; };
  const series = (P?.series ?? []).filter(s => s.winner && s.round >= 1).map(s => {
    const games = s.games.map(id => S.games.find(g => g.id === id)).filter(g => g?.played).map(g => { const win = g!.hs! > g!.as! ? g!.home : g!.away; return `${abbr(win)} ${Math.max(g!.hs!, g!.as!)}-${Math.min(g!.hs!, g!.as!)}${g!.ot ? ' OT' : ''}`; });
    return { r: s.round, c: s.conf, hi: abbr(s.hi), lo: abbr(s.lo), sh: seedOf(s.hi), sl: seedOf(s.lo), wh: s.wHi, wl: s.wLo, win: abbr(s.winner!), games };
  });
  // leaders (qualified: 70% of games)
  const G = Math.max(...Object.values(w.teams).map(t => t.w + t.l), 1);
  const lines = Object.values(w.players).map(p => ({ p, s: (p.stats ?? []).filter(x => x.season === S.year && !x.playoffs) })).filter(x => x.s.length)
    .map(({ p, s }) => { const t = s.reduce((a, x) => ({ g: a.g + x.g, pts: a.pts + x.pts, reb: a.reb + x.oreb + x.dreb, ast: a.ast + x.ast, blk: a.blk + x.blk, stl: a.stl + x.stl }), { g: 0, pts: 0, reb: 0, ast: 0, blk: 0, stl: 0 }); return { p, team: s[s.length - 1].team, ...t }; })
    .filter(x => x.g >= G * 0.7);
  const lead = (k: 'pts' | 'reb' | 'ast' | 'blk' | 'stl') => { const x = [...lines].sort((a, b) => b[k] / b.g - a[k] / a.g)[0]; return x ? `${x.p.name} (${x.team}) ${(x[k] / x.g).toFixed(1)}` : ''; };
  const poLines = Object.values(w.players).map(p => ({ p, s: (p.stats ?? []).find(x => x.season === S.year && x.playoffs) })).filter(x => x.s && x.s.g >= 4).sort((a, b) => b.s!.pts - a.s!.pts);
  const u = w.meta.userTeam, ut = w.teams[u];
  const userRes = ut.history.find(h => h.season === S.year)?.result;
  (past as any).chron = { series, leaders: { ppg: lead('pts'), rpg: lead('reb'), apg: lead('ast'), bpg: lead('blk'), spg: lead('stl') },
    poTop: poLines.slice(0, 3).map(x => `${x.p.name} (${x.s!.team}) ${x.s!.pts} pts in ${x.s!.g} g`),
    user: { team: u, abbr: ut.abbr, w: ut.w, l: ut.l, result: userRes, fired: !!w.meta.fired, gm: w.meta.gmName } };
  for (const p of Object.values(w.players)) if (!p.retired && p.team) markPeak(p);
}
export function markPeak(p: Player) {
  const v = Math.round(playerValue(p));
  if (v > ((p as any).peak ?? 0)) { (p as any).peak = v; (p as any).peakAge = p.age; }
}
