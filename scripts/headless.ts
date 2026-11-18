import fs from 'node:fs';
import { createWorld } from '../src/sim/world';
import { advanceDay, standings, perGame, runDraftUntilUser, startNextSeason, projectedWinsCache } from '../src/sim/league';
import { aiFreeAgency } from '../src/sim/gm';
import { projectedWins } from '../src/sim/world';

const data = JSON.parse(fs.readFileSync('public/data/world1976.json', 'utf8'));
const seed = process.argv[2] || 'test-seed-1';
const t0 = Date.now();
const w = createWorld(data, { userTeam: 'LAL', mode: 'sandbox', gmName: 'Test', seed });
Object.assign(projectedWinsCache, projectedWins(w));
let n = 0;
while (w.season.phase === 'preseason' || w.season.phase === 'regular') { advanceDay(w); n++; }
const games = w.season.games.filter(g => g.played && !g.playoff && g.box);
const T: any = { pts: 0, fga: 0, fgm: 0, fta: 0, ftm: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, poss: 0, homeW: 0, ot: 0 };
for (const g of games) {
  for (const side of ['home', 'away'] as const) for (const l of g.box![side]) { T.pts += l.pts; T.fga += l.fga; T.fgm += l.fgm; T.fta += l.fta; T.ftm += l.ftm; T.oreb += l.oreb; T.dreb += l.dreb; T.ast += l.ast; T.stl += l.stl; T.blk += l.blk; T.tov += l.tov; T.pf += l.pf; }
  T.poss += g.box!.possessions; if (g.hs! > g.as!) T.homeW++; if (g.ot) T.ot++;
}
const tg = games.length * 2;
console.log(`games ${games.length}  regular-season sim ${(Date.now() - t0) / 1000}s`);
console.log('per team-game:', Object.fromEntries(Object.entries(T).map(([k, v]: any) => [k, k === 'homeW' || k === 'ot' ? v : +(v / (k === 'poss' ? games.length : tg)).toFixed(2)])));
console.log('FG%', (T.fgm / T.fga).toFixed(3), 'FT%', (T.ftm / T.fta).toFixed(3), 'home win%', (T.homeW / games.length).toFixed(3), 'OREB%', (T.oreb / (T.oreb + T.dreb)).toFixed(3));
console.log('anchors', JSON.stringify({ ppg: data.anchors.ppg, fg: data.anchors.fgPct, fga: data.anchors.fga.toFixed(1), fta: data.anchors.fta.toFixed(1), ft: data.anchors.ftPct.toFixed(3), ast: data.anchors.ast.toFixed(1), oreb: data.anchors.oreb.toFixed(1), dreb: data.anchors.dreb.toFixed(1), stl: data.anchors.stl.toFixed(1), blk: data.anchors.blk.toFixed(1), pf: data.anchors.pf.toFixed(1), pace: data.anchors.pace }));
const st = standings(w);
const real = data.anchors.teamRecords;
let se = 0;
console.log(st.map(t => `${t.abbr} ${t.w}-${t.l} (real ${real[t.id][0]})`).join(' | '));
for (const t of st) se += (t.w - real[t.id][0]) ** 2;
const xs = st.map(t => t.w), ys = st.map(t => real[t.id][0]); const mx = xs.reduce((a,b)=>a+b)/xs.length, my = ys.reduce((a,b)=>a+b)/ys.length;
const corr = xs.reduce((a,x,i)=>a+(x-mx)*(ys[i]-my),0)/Math.sqrt(xs.reduce((a,x)=>a+(x-mx)**2,0)*ys.reduce((a,y)=>a+(y-my)**2,0));
console.log('corr with real wins', corr.toFixed(2));
console.log('RMSE vs real wins', Math.sqrt(se / st.length).toFixed(1), ' sd of wins', Math.sqrt(st.reduce((a, t) => a + (t.w - 41) ** 2, 0) / st.length).toFixed(1));
const lead = Object.values(w.players).map(p => ({ p, s: perGame(p, 1976) })).filter(o => o.s.g > 40).sort((a, b) => b.s.ppg - a.s.ppg).slice(0, 12);
console.log(lead.map(o => `${o.p.name} ${o.s.ppg.toFixed(1)}p ${o.s.rpg.toFixed(1)}r ${o.s.apg.toFixed(1)}a ${o.s.mpg.toFixed(1)}m`).join('\n'));
const mins = Object.values(w.players).map(p => perGame(p, 1976)).filter(s => s.g > 0).map(s => s.mpg).sort((a, b) => b - a);
console.log('top mpg', mins.slice(0, 5).map(x => x.toFixed(1)).join(','), ' players>30mpg', mins.filter(x => x > 30).length);
const inj = w.events.filter(e => e.type === 'injury').length;
console.log('injuries', inj);
// playoffs
while (w.season.phase === 'playoffs') advanceDay(w);
console.log('champion', w.season.champion, 'awards', JSON.stringify(Object.fromEntries(Object.entries(w.season.awards || {}).map(([k, v]: any) => [k, Array.isArray(v) ? v.map((id: string) => w.players[id]?.name) : w.players[v]?.name ?? v]))));
if (process.argv[3] === 'full') {
  runDraftUntilUser(w, true);
  aiFreeAgency(w);
  startNextSeason(w);
  console.log('next season', w.season.year, w.season.games.length, 'games; NYN ->', w.teams.NYN.city, w.teams.NYN.name);
  while (w.season.phase !== 'draft') advanceDay(w);
  console.log('1977-78 champion', w.season.champion, standings(w).slice(0, 5).map(t => `${t.abbr} ${t.w}-${t.l}`).join(' '));
}
console.log('total', (Date.now() - t0) / 1000, 's');
