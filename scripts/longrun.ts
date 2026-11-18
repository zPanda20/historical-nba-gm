// Headless 1976 -> N run: every season played, drafted, signed and rolled over by the AI (user team on full delegation).
import fs from 'node:fs';
import { createWorld, projectedWins } from '../src/sim/world';
import { advanceDay, standings, perGame, runDraftUntilUser, startNextSeason, projectedWinsCache } from '../src/sim/league';
import { aiFreeAgency, releasePlayer } from '../src/sim/gm';
import { setClassData } from '../src/sim/seasons';
import { playerValue } from '../src/sim/coach';
import { offseasonRoster } from '../src/sim/delegate';

const data = JSON.parse(fs.readFileSync('public/data/world1976.json', 'utf8'));
setClassData(JSON.parse(fs.readFileSync('public/data/classes.json', 'utf8')));
const seed = process.argv[2] || 'long-1';
const until = +(process.argv[3] || 2040);
const t0 = Date.now();
const w = createWorld(data, { userTeam: 'LAL', mode: 'sandbox', gmName: 'Test', seed });
Object.assign(projectedWinsCache, projectedWins(w));
for (const k of ['contracts', 'trades', 'roster', 'coach', 'scouting', 'draft', 'offseason']) ((w as any).delegation ??= {})[k] = true;
const rows: any[] = [];
while (w.season.year <= until) {
  const t1 = Date.now();
  while (w.season.phase === 'preseason' || w.season.phase === 'regular' || w.season.phase === 'playoffs') advanceDay(w);
  const y = w.season.year;
  const games = w.season.games.filter(g => g.played && !g.playoff);
  const T: any = { pts: 0, fga: 0, fgm: 0, tpa: 0, tpm: 0, fta: 0, poss: 0, tov: 0, oreb: 0 };
  for (const p of Object.values(w.players)) for (const l of p.stats ?? []) if (l.season === y && !l.playoffs) { T.pts += l.pts; T.fga += l.fga; T.fgm += l.fgm; T.tpa += l.tpa; T.tpm += l.tpm; T.fta += l.fta; T.tov += l.tov; T.oreb += l.oreb; }
  T.poss = (T.fga - T.oreb + T.tov + 0.44 * T.fta) / 2;
  const tg = games.length * 2;
  const per = Object.values(w.teams).map(t => t.w + t.l);
  const st = standings(w);
  const active = Object.values(w.players).filter(p => p.team);
  const avgOvr = active.reduce((a, p) => a + playerValue(p), 0) / active.length;
  const top = [...active].sort((a, b) => playerValue(b) - playerValue(a)).slice(0, 3).map(p => `${p.name.split(' ').slice(-1)[0]}(${Math.round(playerValue(p))},${p.age})`).join(' ');
  const aw = w.season.awards ?? {};
  const rosterSizes = Object.values(w.teams).map(t => t.roster.length);
  rows.push({ y, teams: Object.keys(w.teams).length, gp: `${Math.min(...per)}-${Math.max(...per)}`, ppg: +(T.pts / tg).toFixed(1), pace: +(T.poss / games.length).toFixed(1), fg: +(T.fgm / T.fga).toFixed(3),
    tpa: +(T.tpa / tg).toFixed(1), tp: T.tpa ? +(T.tpm / T.tpa).toFixed(3) : 0, champ: w.season.champion, best: `${st[0].abbr} ${st[0].w}-${st[0].l}`, worst: `${st[st.length - 1].abbr} ${st[st.length - 1].w}-${st[st.length - 1].l}`,
    mvp: w.players[aw.MVP]?.name, ovr: +avgOvr.toFixed(1), top, players: active.length, ros: `${Math.min(...rosterSizes)}-${Math.max(...rosterSizes)}`, s: ((Date.now() - t1) / 1000).toFixed(1) });
  console.log(JSON.stringify(rows[rows.length - 1]));
  if (w.season.year === until) break;
  runDraftUntilUser(w, true);
  const D = w.season.draft!;
  const top5 = D.order.slice(0, 5).map(o => `${o.team}:${w.players[o.player!]?.name}`).join(', ');
  console.log(`  draft ${D.year} (${D.lottery?.kind}) ${top5}`);
  offseasonRoster(w);
  const u = w.teams[w.meta.userTeam];
  for (const id of [...u.roster]) { const p = w.players[id]; if ((p.contract?.years ?? 0) <= 0) releasePlayer(w, id); }
  aiFreeAgency(w);
  startNextSeason(w);
  if ([1990, 2005, 2020, 2025].includes(w.season.year)) fs.writeFileSync(`/tmp/snap${w.season.year}.json`, JSON.stringify(w));
  const ev = w.news.filter(n => n.kind === 'league' && /now the|join the league|become the|retires$/.test(n.head)).slice(0, 6).map(n => n.head);
  if (ev.length) console.log('  news:', ev.join(' | '));
}
const size = JSON.stringify(w).length;
console.log('total', ((Date.now() - t0) / 1000).toFixed(0), 's; save size', (size / 1e6).toFixed(1), 'MB; players', Object.keys(w.players).length);
console.log('teams', Object.values(w.teams).map(t => `${t.id}=${t.abbr}/${t.conf[0]}/${t.div}`).join(' '));
fs.writeFileSync('/tmp/longrun.json', JSON.stringify(rows));
fs.writeFileSync('/tmp/world_end.json', JSON.stringify(w));
