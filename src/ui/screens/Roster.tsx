import { useStore, openModal } from '../store';
import { Headshot, Panel, Tabs, curTab, ht, f1, pct, injuryChip, Chip, Meter } from '../util';
import { perGame } from '../../sim/league';
import { fmt$, payroll } from '../../sim/gm';
import { makeGameplan, playerValue } from '../../sim/coach';
import { potentialOvr } from '../../sim/world';
import type { Player, World } from '../../sim/types';

export function moraleWord(m: number) { return m >= 75 ? 'Happy' : m >= 55 ? 'Content' : m >= 35 ? 'Restless' : 'Unhappy'; }

function roleOf(w: World, p: Player) {
  const t = w.teams[w.meta.userTeam];
  const plan = makeGameplan(w, t, w.coaches[t.coach]);
  if (plan.starters.includes(p.id)) return 'Starter';
  const m = plan.targetMin[p.id] ?? 0;
  return m >= 15 ? 'Rotation' : m >= 5 ? 'Spot minutes' : 'Bench';
}

export function Roster() {
  const { world: w } = useStore();
  const t = w!.teams[w!.meta.userTeam];
  const y = w!.season.year;
  const ps = t.roster.map(id => w!.players[id]).sort((a, b) => playerValue(b) - playerValue(a));
  const tab = curTab('roster', 'roster');
  return <div class="screen">
    <div class="screen-h"><h2>Roster & Development</h2><Tabs id="roster" def="roster" tabs={[{ id: 'roster', label: 'Roster' }, { id: 'stats', label: 'Season stats' }, { id: 'dev', label: 'Development' }]} />
      <div class="screen-meta">{t.roster.length}/12 players · Payroll {fmt$(payroll(w!, t.id))}</div></div>
    {tab === 'roster' && <Panel class="fill">
      <table class="tbl rows"><thead><tr><th></th><th class="l">Player</th><th>Pos</th><th>Age</th><th>Ht</th><th>OVR</th><th class="l">Role (coach)</th><th class="l">Mood</th><th>Salary</th><th>Yrs</th><th class="l">Status</th></tr></thead>
        <tbody>{ps.map(p => <tr data-nav tabIndex={0} onClick={() => openModal('player', { id: p.id })}>
          <td><Headshot p={p} size={38} /></td><td class="l b">{p.name}</td><td>{p.pos}</td><td>{p.age}</td><td>{ht(p.hgt)}</td><td><span class="ovr">{p.ovr}</span></td>
          <td class="l">{roleOf(w!, p)}</td><td class="l">{moraleWord(p.morale ?? 60)}</td>
          <td>{p.contract ? fmt$(p.contract.salary) : '—'}{p.contract && !p.contract.signed && <sup class="rc" title={p.contract.provenance}>R</sup>}</td><td>{p.contract?.years ?? 0}</td>
          <td class="l">{injuryChip(p)}{p.contract && p.contract.years <= 0 && <Chip kind="warn">Unsigned</Chip>}{t.minutesRequests?.[p.id] && <Chip>{t.minutesRequests[p.id].kind} · {t.minutesRequests[p.id].status}</Chip>}</td>
        </tr>)}</tbody></table>
      <div class="foot-note"><sup class="rc">R</sup> Reconstructed salary (simulation only). OVR is the coaching staff's day-to-day read of your own players.</div>
    </Panel>}
    {tab === 'stats' && <Panel class="fill">
      <table class="tbl rows"><thead><tr><th class="l">Player</th><th>G</th><th>GS</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>FG%</th><th>FT%</th><th>TOV</th><th>PF</th></tr></thead>
        <tbody>{ps.map(p => { const s = perGame(p, y); return <tr data-nav tabIndex={0} onClick={() => openModal('player', { id: p.id })}>
          <td class="l b">{p.name}</td><td>{s.g}</td><td>{s.gs}</td><td>{f1(s.mpg)}</td><td class="b">{f1(s.ppg)}</td><td>{f1(s.rpg)}</td><td>{f1(s.apg)}</td><td>{f1(s.spg)}</td><td>{f1(s.bpg)}</td><td>{pct(s.fgp)}</td><td>{pct(s.ftp)}</td><td>{f1(s.tov / Math.max(1, s.g))}</td><td>{f1(s.pf / Math.max(1, s.g))}</td></tr>; })}</tbody></table>
    </Panel>}
    {tab === 'dev' && <div class="dev-grid">
      {ps.map(p => { const pot = potentialOvr(p); const band = 4; const young = (p.age ?? 30) <= 25;
        return <button data-nav class="dev-c" onClick={() => openModal('player', { id: p.id })}>
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
