import fs from 'node:fs';
import { createWorld, teamStrength, projectedWins } from '../src/sim/world';
import { playerValue } from '../src/sim/coach';
const data = JSON.parse(fs.readFileSync('public/data/world1976.json', 'utf8'));
const w = createWorld(data, { userTeam: 'LAL', mode: 'sandbox', gmName: 'T', seed: 's' });
const pw = projectedWins(w);
for (const t of Object.values(w.teams).sort((a,b)=>teamStrength(w,b.id)-teamStrength(w,a.id))) {
  const ps = t.roster.map(id => w.players[id]).sort((a, b) => playerValue(b) - playerValue(a));
  console.log(t.abbr, teamStrength(w, t.id).toFixed(0), 'proj', pw[t.id], 'real', data.anchors.teamRecords[t.id][0], '|', ps.slice(0, 7).map(p => `${p.name.split(' ').slice(-1)[0]} ${playerValue(p).toFixed(0)}(${p.sampleMin})`).join(' '));
}
