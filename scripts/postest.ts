// Positions matter: same talent, three different structures. Net margin and turnovers over many games.
import fs from 'node:fs';
import { createWorld } from '../src/sim/world';
import { simulateGame } from '../src/sim/engine';
import { playerValue } from '../src/sim/coach';

const data = JSON.parse(fs.readFileSync('public/data/world1976.json', 'utf8'));
const w = createWorld(data, { userTeam: 'POR', mode: 'sandbox', gmName: 'T', seed: 'pos-1' });
w.season.phase = 'regular';
const T = w.teams.POR;
const base = [...T.roster];
// steal the two best centres in the league (not Portland's) and give them to Portland in place of its guards
const cs = Object.values(w.players).filter(p => p.team && p.team !== 'POR' && p.pos === 'C').sort((a, b) => playerValue(b) - playerValue(a)).slice(0, 2);
const guards = base.map(id => w.players[id]).filter(p => p.pos === 'PG' || p.pos === 'SG').sort((a, b) => playerValue(b) - playerValue(a));
function run(label: string, tactics?: number) {
  const opp = Object.keys(w.teams).filter(x => x !== 'POR');
  let m = 0, tov = 0, n = 0;
  if (tactics !== undefined) { w.coaches[T.coach].tactics = tactics; w.coaches[T.coach].adaptability = tactics; }
  for (let i = 0; i < 300; i++) {
    const o = opp[i % opp.length];
    const home = i % 2 === 0;
    const r = simulateGame(w, `pt-${label}-${i}`, home ? 'POR' : o, home ? o : 'POR', {});
    const us = home ? r.hs : r.as, them = home ? r.as : r.hs;
    m += us - them; n++;
    tov += (home ? r.box.home : r.box.away).reduce((a, l) => a + l.tov, 0);
  }
  console.log(label.padEnd(44), 'margin', (m / n).toFixed(1).padStart(6), ' tov', (tov / n).toFixed(1));
}
run('Real Portland (balanced)');
const coach = w.coaches[T.coach];
const keepT = coach.tactics, keepA = coach.adaptability;
// three bigs: two all-star centres replace the two best guards
T.roster = base.filter(id => id !== guards[0].id && id !== guards[1].id).concat(cs.map(p => p.id));
for (const p of cs) p.team = 'POR';
console.log('added', cs.map(p => `${p.name} (${Math.round(playerValue(p))})`).join(', '), 'for', guards.slice(0, 2).map(p => `${p.name} (${Math.round(playerValue(p))})`).join(', '));
run('More talent, three centres, coach decides');
(T as any).depthForce = { PG: guards[2]?.id, SF: cs[0].id, PF: cs[1].id };
run('Three centres forced into the five', keepT);
run('Same, coach with no plan (tactics 25)', 25);
run('Same, coach with a real plan (tactics 85)', 85);
coach.tactics = keepT; coach.adaptability = keepA;
