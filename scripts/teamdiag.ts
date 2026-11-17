import fs from 'node:fs';
import { createWorld } from '../src/sim/world';
import { advanceDay } from '../src/sim/league';
const data = JSON.parse(fs.readFileSync('public/data/world1976.json', 'utf8'));
const w = createWorld(data, { userTeam: 'LAL', mode: 'sandbox', gmName: 'T', seed: process.argv[2] || 'seedA' });
while (w.season.phase === 'preseason' || w.season.phase === 'regular') advanceDay(w);
const agg: any = {};
for (const g of w.season.games.filter(g => g.played)) for (const [side, tid, opp] of [['home', g.home, g.away], ['away', g.away, g.home]] as any) {
  const a = agg[tid] ??= { g: 0, pts: 0, fga: 0, fgm: 0, fta: 0, tov: 0, oreb: 0, dreb: 0, opp: 0, oppfga: 0, oppfgm: 0, opptov: 0, act: {} };
  a.g++; for (const l of g.box![side]) { a.pts += l.pts; a.fga += l.fga; a.fgm += l.fgm; a.fta += l.fta; a.tov += l.tov; a.oreb += l.oreb; a.dreb += l.dreb; }
  for (const l of g.box![side === 'home' ? 'away' : 'home']) { a.opp += l.pts; a.oppfga += l.fga; a.oppfgm += l.fgm; a.opptov += l.tov; }
}
for (const [t, a] of Object.entries(agg).sort((x: any, y: any) => (y[1].pts - y[1].opp) - (x[1].pts - x[1].opp)) as any) {
  const T = w.teams[t];
  console.log(t, `${T.w}-${T.l}`, 'ppg', (a.pts / a.g).toFixed(1), 'opp', (a.opp / a.g).toFixed(1), 'fg%', (a.fgm / a.fga).toFixed(3), 'oppfg%', (a.oppfgm / a.oppfga).toFixed(3), 'fga', (a.fga / a.g).toFixed(1), 'fta', (a.fta / a.g).toFixed(1), 'tov', (a.tov / a.g).toFixed(1), 'opptov', (a.opptov / a.g).toFixed(1), 'oreb', (a.oreb / a.g).toFixed(1), 'dreb', (a.dreb / a.g).toFixed(1));
}
