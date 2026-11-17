// Alpha latent-talent calibration (GDD §5.1: retrospective outcomes may calibrate latent talent, never scheduled results).
// Nudges hidden defensive/decision skills of 1976 roster players so that simulated team strength is closer to the
// real 1976-77 net margins. Results still vary every season; nothing is forced.
import fs from 'node:fs';
import { createWorld } from '../src/sim/world';
import { advanceDay } from '../src/sim/league';
const path = 'public/data/world1976.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
const realNet: Record<string, number> = { LAL: 2.8, PHI: 4.0, DEN: 5.2, HOU: 1.6, POR: 5.5, WSB: 1.0, GSW: 3.2, DET: -1.0, BOS: -2.0, CHI: 0.9, SAS: 0.6, CLE: 1.1, NYK: 0.0, SEA: -1.5, KCK: 0.9, IND: -1.8, NOJ: -2.8, PHX: 0.7, ATL: -4.0, BUF: -4.5, MIL: -3.1, NYN: -6.8 };
const byId: Record<string, any> = Object.fromEntries(data.players.map((p: any) => [p.id, p]));
const adj: Record<string, number> = {};
const iters = Number(process.argv[2] || 4);
for (let it = 0; it < iters; it++) {
  const net: Record<string, number> = {}; const mins: Record<string, Record<string, number>> = {};
  const seeds = ['cal-a', 'cal-b', 'cal-c'];
  for (const seed of seeds) {
    const w = createWorld(JSON.parse(JSON.stringify(data)), { userTeam: 'LAL', mode: 'sandbox', gmName: 'cal', seed: seed + it });
    while (w.season.phase === 'preseason' || w.season.phase === 'regular') advanceDay(w);
    for (const t of Object.values(w.teams)) net[t.id] = (net[t.id] ?? 0) + (t.ptsFor - t.ptsAgainst) / 82 / seeds.length;
    for (const g of w.season.games) for (const [side, tid] of [['home', g.home], ['away', g.away]] as any) for (const l of g.box![side]) { (mins[tid] ??= {})[l.pid] = (mins[tid][l.pid] ?? 0) + l.min; }
  }
  let sse = 0;
  for (const t of data.teams) {
    const r = realNet[t.id] - net[t.id]; sse += r * r;
    const tot = Object.values(mins[t.id] ?? {}).reduce((a: number, b: any) => a + b, 0) as number;
    for (const [pid, m] of Object.entries(mins[t.id] ?? {})) {
      const p = byId[pid]; if (!p) continue;
      const share = (m as number) / tot * 5;   // 1.0 = a full-time player
      const d = Math.max(-4, Math.min(4, r * 0.55 * share));
      adj[pid] = Math.max(-12, Math.min(12, (adj[pid] ?? 0) + d));
      for (const k of ['perD', 'intD', 'iq']) p.r[k] = Math.round(Math.max(20, Math.min(99, p.r[k] + d)));
      for (const k of ['ins', 'mid', 'dreb']) p.r[k] = Math.round(Math.max(20, Math.min(99, p.r[k] + d * 0.5)));
    }
  }
  console.log(`iter ${it} RMSE net ${Math.sqrt(sse / 22).toFixed(2)}`, data.teams.map((t: any) => `${t.id}:${net[t.id].toFixed(1)}/${realNet[t.id]}`).join(' '));
}
for (const p of data.players) if (adj[p.id]) p.calibration = { teamResultAdj: Math.round(adj[p.id] * 10) / 10, note: 'alpha latent-talent calibration to 1976-77 team net margins (retrospective; outcomes not scripted)' };
fs.writeFileSync(path, JSON.stringify(data));
