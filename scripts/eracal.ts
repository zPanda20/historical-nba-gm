// Era calibration: replay N regular-season games from a snapshot with CAL overrides; print league per-team rates.
import fs from 'node:fs';
import { simulateGame, CAL } from '../src/sim/engine';
import { setEraYear } from '../src/sim/history';

const file = process.argv[2];
const n = +(process.argv[3] || 300);
const over = JSON.parse(process.argv[4] || '{}');
Object.assign(CAL, over);
const w = JSON.parse(fs.readFileSync(file, 'utf8'));
if (over.year) w.season.year = over.year;
setEraYear(w.season.year);
w.season.phase = 'regular';
const games = w.season.games.slice(0, n);
const T: any = { pts: 0, fga: 0, fgm: 0, tpa: 0, tpm: 0, fta: 0, oreb: 0, tov: 0, poss: 0 };
for (const g of games) {
  const r = simulateGame(w, g.id, g.home, g.away, {});
  for (const side of ['home', 'away'] as const) for (const l of r.box[side]) { T.pts += l.pts; T.fga += l.fga; T.fgm += l.fgm; T.tpa += l.tpa; T.tpm += l.tpm; T.fta += l.fta; T.oreb += l.oreb; T.tov += l.tov; }
  T.poss += r.box.possessions;
}
const tg = games.length * 2;
console.log(JSON.stringify({ year: w.season.year, ppg: +(T.pts / tg).toFixed(1), pace: +(T.poss / games.length).toFixed(1), fg: +(T.fgm / T.fga).toFixed(3), tpa: +(T.tpa / tg).toFixed(1), tp: +(T.tpm / Math.max(1, T.tpa)).toFixed(3), fta: +(T.fta / tg).toFixed(1), tov: +(T.tov / tg).toFixed(1) }));
