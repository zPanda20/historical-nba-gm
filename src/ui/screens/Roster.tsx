import { useStore, openModal } from '../store';
import { Panel, Tabs, curTab, ht, f1, pct, injuryChip, Chip, Meter, PlayerTile, SortTable, CondBar, Headshot } from '../util';
import { perGame } from '../../sim/league';
import { fmt$, payroll } from '../../sim/gm';
import { makeGameplan, playerValue } from '../../sim/coach';
import { potentialOvr } from '../../sim/world';
import type { Player, World } from '../../sim/types';

export function moraleWord(m: number) { return m >= 75 ? 'Happy' : m >= 55 ? 'Content' : m >= 35 ? 'Restless' : 'Unhappy'; }

const ROLE_ORDER: Record<string, number> = { Starter: 0, Rotation: 1, 'Spot minutes': 2, Bench: 3, Injured: 4 };
function roles(w: World) {
  const t = w.teams[w.meta.userTeam];
  const plan = makeGameplan(w, t, w.coaches[t.coach]);
  const out: Record<string, { role: string; min: number }> = {};
  for (const id of t.roster) {
    const p = w.players[id];
    const m = plan.targetMin[id] ?? 0;
    out[id] = { role: p.injury && p.injury.daysLeft > 0 ? 'Injured' : plan.starters.includes(id) ? 'Starter' : m >= 15 ? 'Rotation' : m >= 4 ? 'Spot minutes' : 'Bench', min: m };
  }
  return out;
}

export function Roster() {
  const { world: w } = useStore();
  const t = w!.teams[w!.meta.userTeam];
  const y = w!.season.year;
  const ps = t.roster.map(id => w!.players[id]).sort((a, b) => playerValue(b) - playerValue(a));
  const tab = curTab('roster', 'roster');
  const R = roles(w!);
  const open = (p: Player) => openModal('player', { id: p.id });
  return <div class="screen">
    <div class="screen-h"><h2>Roster & development</h2><Tabs id="roster" def="roster" tabs={[{ id: 'roster', label: 'Roster' }, { id: 'stats', label: 'Season stats' }, { id: 'dev', label: 'Development' }]} />
      <div class="screen-meta">{t.roster.length} of 12 spots · payroll {fmt$(payroll(w!, t.id))}</div></div>
    {tab === 'roster' && <Panel class="fill">
      <SortTable id="roster" rows={ps} onRow={open} def="ovr:d" cols={[
        { key: 'name', label: 'Player', cls: 'l', get: p => p.name, desc: false, render: p => <PlayerTile p={p} size={38} sub={<>{p.pos} · {ht(p.hgt)}</>} /> },
        { key: 'age', label: 'Age', get: p => p.age ?? 0, desc: false, render: p => p.age },
        { key: 'ovr', label: 'OVR', get: p => p.ovr, render: p => <span class="ovr">{p.ovr}</span> },
        { key: 'role', label: 'Coach’s role', cls: 'l', get: p => ROLE_ORDER[R[p.id].role] * 100 - R[p.id].min, desc: false, render: p => <span class={`role r-${R[p.id].role.split(' ')[0].toLowerCase()}`}>{R[p.id].role}{R[p.id].min >= 4 ? <small> ~{Math.round(R[p.id].min)} min</small> : null}</span> },
        { key: 'cond', label: 'Condition', cls: 'l', get: p => p.cond ?? 100, render: p => <CondBar p={p} />, title: 'Fresh legs; back-to-backs and heavy minutes drain it' },
        { key: 'stam', label: 'Stamina', get: p => p.r.stamina, render: p => p.r.stamina },
        { key: 'mood', label: 'Mood', cls: 'l', get: p => p.morale ?? 60, render: p => moraleWord(p.morale ?? 60) },
        { key: 'sal', label: 'Salary', get: p => p.contract?.salary ?? 0, render: p => <>{p.contract ? fmt$(p.contract.salary) : '—'}{p.contract && !p.contract.signed && <sup class="rc" title={p.contract.provenance}>R</sup>}</> },
        { key: 'yrs', label: 'Years', get: p => p.contract?.years ?? 0, render: p => p.contract?.years ?? 0 },
        { key: 'st', label: 'Status', cls: 'l', render: p => <>{injuryChip(p)}{p.contract && p.contract.years <= 0 && <Chip kind="warn">Unsigned</Chip>}{t.minutesRequests?.[p.id] && <Chip>{t.minutesRequests[p.id].kind} · {t.minutesRequests[p.id].status}</Chip>}</> },
      ]} />
      <div class="foot-note"><sup class="rc">R</sup> Reconstructed salary (simulation only). OVR is the coaching staff's day-to-day read of your own players. Click a column to sort.</div>
    </Panel>}
    {tab === 'stats' && <Panel class="fill">
      <SortTable id="rstats" rows={ps.map(p => ({ p, s: perGame(p, y) }))} onRow={o => open(o.p)} def="pts:d" cols={[
        { key: 'name', label: 'Player', cls: 'l', get: o => o.p.name, desc: false, render: o => <PlayerTile p={o.p} size={34} /> },
        { key: 'g', label: 'G', get: o => o.s.g, render: o => o.s.g },
        { key: 'gs', label: 'GS', get: o => o.s.gs, render: o => o.s.gs },
        { key: 'min', label: 'MIN', get: o => o.s.mpg, render: o => f1(o.s.mpg) },
        { key: 'pts', label: 'PTS', get: o => o.s.ppg, render: o => <b>{f1(o.s.ppg)}</b> },
        { key: 'reb', label: 'REB', get: o => o.s.rpg, render: o => f1(o.s.rpg) },
        { key: 'ast', label: 'AST', get: o => o.s.apg, render: o => f1(o.s.apg) },
        { key: 'stl', label: 'STL', get: o => o.s.spg, render: o => f1(o.s.spg) },
        { key: 'blk', label: 'BLK', get: o => o.s.bpg, render: o => f1(o.s.bpg) },
        { key: 'fg', label: 'FG%', get: o => o.s.fgp, render: o => pct(o.s.fgp) },
        { key: 'ft', label: 'FT%', get: o => o.s.ftp, render: o => pct(o.s.ftp) },
        { key: 'tov', label: 'TOV', get: o => o.s.tov / Math.max(1, o.s.g), render: o => f1(o.s.tov / Math.max(1, o.s.g)) },
        { key: 'pf', label: 'PF', get: o => o.s.pf / Math.max(1, o.s.g), render: o => f1(o.s.pf / Math.max(1, o.s.g)) },
      ]} />
    </Panel>}
    {tab === 'dev' && <div class="dev-grid">
      {ps.map(p => { const pot = potentialOvr(p); const band = 4; const young = (p.age ?? 30) <= 25;
        return <button data-nav class="dev-c" onClick={() => open(p)}>
          <Headshot p={p} size={64} />
          <div class="dev-i"><b>{p.name}</b><small>{p.pos} · {p.age} yrs</small>
            <div class="dev-bar"><div class="dev-now" style={{ width: `${(p.ovr - 30) / 0.62}%` }} /><div class="dev-pot" style={{ left: `${(Math.max(p.ovr, pot - band) - 30) / 0.62}%`, width: `${(band * 2) / 0.62}%` }} /></div>
            <div class="dev-t"><span>Now {p.ovr}</span><span>{young ? `Ceiling est. ${Math.max(p.ovr, pot - band)}–${pot + band}` : (p.age ?? 0) >= 30 ? 'Veteran: maintaining' : 'Near his prime'}</span></div>
            {t.minutesRequests?.[p.id]?.kind === 'develop' && <Chip kind="good">Development focus ({t.minutesRequests[p.id].status})</Chip>}
          </div>
        </button>; })}
      <div class="foot-note wide">Growth depends on age, minutes, the coach's development skill and luck. Ceilings are the staff's estimate, not a promise. <Meter v={w!.coaches[t.coach].development} /> Coach development rating</div>
    </div>}
  </div>;
}
