// Finances: the cap sheet. Every salary on the books by season, dead money, holds, the lines that matter this era
// (cap, tax, aprons), what exceptions are left, and a planner for the deals that run out.
import { useStore, openModal, commit } from '../store';
import { Panel, Headshot, Chip, Btn, seasonLabel } from '../util';
import { capFor } from '../../sim/history';
import { capRules, capSeason, teamPayroll, capHolds, capRoom, deadMoney, taxBill, isRepeater, taxHistory, maxSalary, minSalary, yos, fmtM, marketValue, holdPlayers, capHold } from '../../sim/cap';
import { salaryAt, birdLevel, maxRaise, canStretch, BIRD_LABEL } from '../../sim/contracts';
import { rules as eraRules, tradeDeadline } from '../../sim/rules';
import { playerValue } from '../../sim/coach';
import type { Player, World } from '../../sim/types';

const SPAN = 5;
type Plan = Record<string, { salary: number; years: number }>;
const planOf = (w: World): Plan => ((w as any).finPlan ??= {});

export function Finances() {
  const { world: w } = useStore();
  if (!w) return null;
  const u = w.meta.userTeam, t = w.teams[u];
  const cs = capSeason(w);
  const R = capRules(cs);
  const seasons = Array.from({ length: SPAN }, (_, k) => cs + k);
  const rules = seasons.map(capRules);
  const ps = t.roster.map(id => w.players[id]).filter(Boolean).sort((a, b) => (b.contract?.salary ?? 0) - (a.contract?.salary ?? 0));
  const plan = planOf(w);
  const dead = deadMoney(t);
  const deadBy = Object.values(dead.reduce((m: Record<string, { name: string; at: number[] }>, d) => {
    const e = (m[d.pid] ??= { name: d.name, at: Array(SPAN).fill(0) });
    for (let k = d.from ?? 0; k < Math.min(SPAN, d.years); k++) e.at[k] += d.salary;
    return m;
  }, {}));
  const holders = holdPlayers(w, u).filter(p => !p.team);
  const RR = eraRules(w);
  const holds = capHolds(w, u);
  const pay = teamPayroll(w, u);
  const committed = seasons.map((_, k) => teamPayroll(w, u, k));
  const planned = seasons.map((_, k) => ps.reduce((s, p) => { const pl = plan[p.id]; const left = p.contract?.years ?? 0; return pl && k >= left && k < left + pl.years ? s + pl.salary : s; }, 0));
  const total = committed.map((c, k) => c + planned[k] + (k === 0 ? holds : 0));
  const bill = taxBill(cs, pay, isRepeater(w, u, cs));
  const lines = [{ k: 'cap', v: R.hasCap ? R.cap : null, label: 'Cap' }, { k: 'tax', v: R.tax, label: 'Tax' }, { k: 'ap1', v: R.apron1, label: R.season >= 2023 ? '1st apron' : 'Apron' }, { k: 'ap2', v: R.apron2, label: '2nd apron' }, { k: 'bud', v: R.hasCap ? null : w.owner.budget, label: 'Owner budget' }]
    .filter(x => x.v) as { k: string; v: number; label: string }[];
  const top = Math.max(pay + holds, ...lines.map(l => l.v)) * 1.08;
  const pct = (v: number) => `${Math.min(100, v / top * 100)}%`;
  const status = !R.hasCap ? (pay > w.owner.budget ? `${fmtM(pay - w.owner.budget)} over the owner's budget` : `${fmtM(w.owner.budget - pay)} under the owner's budget`)
    : R.apron2 && pay > R.apron2 ? 'Over the second apron' : R.tax && pay > R.tax ? `${fmtM(pay - R.tax)} over the tax line` : pay + holds > R.cap ? `${fmtM(pay + holds - R.cap)} over the cap` : `${fmtM(capRoom(w, u))} of cap room`;
  const togglePlan = (p: Player) => {
    if (plan[p.id]) delete plan[p.id];
    else { const left = p.contract?.years ?? 0; const s = cs + left; plan[p.id] = { salary: Math.min(marketValue(s, playerValue(p) + ((p.age ?? 27) < 26 ? 2 : (p.age ?? 27) > 30 ? -2 : 0), (p.age ?? 27) + left, yos(p) + left), maxSalary(s, yos(p) + left, p.contract?.salary ?? 0) ?? Infinity), years: (p.age ?? 27) + left < 30 ? 4 : 2 }; }
    commit();
  };
  const hist = Object.entries(taxHistory(t)).filter(([, v]) => v > 0).sort((a, b) => +b[0] - +a[0]).slice(0, 5);

  return <div class="fin">
    <div class="screen-h"><h2>Finances</h2><span class="sh-sub">{seasonLabel(cs)} · {R.label}</span></div>
    <Panel class="fin-gauge" title="Where the payroll sits" right={<span class={`fin-status ${(R.tax && pay > R.tax) || (!R.hasCap && pay > w.owner.budget) ? 'bad' : ''}`}>{status}</span>}>
      <div class="fin-bar">
        <i class="fin-fill" style={{ width: pct(pay) }} />
        {holds > 0 && <i class="fin-hold" style={{ left: pct(pay), width: `calc(${pct(pay + holds)} - ${pct(pay)})` }} title="Cap holds for our unsigned free agents" />}
        {lines.map(l => <span class={`fin-mark ${l.k}`} style={{ left: pct(l.v) }}><b>{l.label}</b><em>{fmtM(l.v)}</em></span>)}
      </div>
      <div class="fin-figs">
        <div><label>Payroll</label><b>{fmtM(pay)}</b></div>
        {holds > 0 && <div><label>Cap holds</label><b>{fmtM(holds)}</b></div>}
        {dead.length > 0 && <div><label>Dead money</label><b>{fmtM(dead.reduce((s, d) => s + d.salary, 0))}</b></div>}
        {R.hasCap && <div><label>Cap room</label><b>{fmtM(capRoom(w, u))}</b></div>}
        {R.tax && <div><label>Tax bill if the season ended today</label><b class={bill ? 'bad' : ''}>{bill ? fmtM(bill) : 'None'}</b></div>}
        <div><label>Owner budget</label><b>{fmtM(w.owner.budget)}</b></div>
        <div><label>Roster</label><b>{t.roster.length} players</b></div>
      </div>
    </Panel>

    <Panel class="fin-sheet" title="Cap sheet" right={<span class="muted">Salaries by season · tick a free agent to plan his next deal</span>}>
      <table class="tbl compact fin-tbl">
        <thead><tr><th class="l">Player</th><th>Age</th><th>OVR</th><th class="l">Rights</th>{seasons.map(s => <th>{seasonLabel(s)}</th>)}<th>Plan</th></tr></thead>
        <tbody>
          {ps.map(p => {
            const left = p.contract?.years ?? 0;
            const pl = plan[p.id];
            const bird = R.hasCap && ((p as any).bird === u || left <= 1);
            return <tr>
              <td class="l"><button data-nav class="tp-pl" onClick={() => openModal('player', { id: p.id })}><Headshot p={p} size={26} /><span>{p.name}</span></button></td>
              <td>{p.age}</td><td><span class="ovr">{p.ovr}</span></td>
              <td class="l">{p.contract?.twoWay ? <Chip>Two-way</Chip> : p.contract?.scale ? <Chip>Rookie scale</Chip> : p.contract?.rookie ? <Chip>Rookie</Chip> : null}{bird ? <Chip kind="good">{(() => { const lv = birdLevel(p, u, cs + Math.max(0, left)); return lv === 'full' ? 'Bird' : lv === 'early' ? 'Early Bird' : lv === 'non' ? 'Non-Bird' : 'Bird'; })()}</Chip> : null}{left <= 0 ? <Chip kind="warn">Unsigned</Chip> : null}</td>
              {seasons.map((_, k) => k < left ? (() => { const o = p.contract!.opts?.find(x => x.idx === k); return <td class={`fin-c ${o ? 'opt' : ''} ${p.contract!.twoWay ? 'tw' : ''}`} title={o ? `${o.kind === 'team' ? 'Team' : 'Player'} option` : p.contract!.twoWay ? 'Two-way: not on the cap' : ''}>{fmtM(salaryAt(p.contract, k))}{o ? <sup>{o.kind === 'team' ? 'TO' : 'PO'}</sup> : null}</td>; })()
                : pl && k >= left && k < left + pl.years ? <td class="fin-c plan" title="Planned re-signing (estimate)">{fmtM(pl.salary)}</td>
                : k === left ? <td class="fin-c fa">{k === 0 && left <= 0 ? `Hold ${fmtM(Math.round((p.contract?.salary ?? minSalary(cs, yos(p))) * 1.3))}` : 'Free agent'}</td> : <td class="fin-c none" />)}
              <td>{left <= SPAN - 1 ? <button data-nav class={`fin-plan ${pl ? 'on' : ''}`} title={pl ? 'Remove from plan' : 'Plan to re-sign at an estimated market price'} onClick={() => togglePlan(p)}>{pl ? '✓' : '+'}</button> : null}</td>
            </tr>;
          })}
          {holders.map(p => <tr class="hold"><td class="l"><button data-nav class="tp-pl" onClick={() => openModal('offer', { pid: p.id })}><Headshot p={p} size={26} /><span>{p.name}</span></button></td><td>{p.age}</td><td><span class="ovr">{p.ovr}</span></td>
            <td class="l"><Chip kind="warn">{(p as any).rfa ? 'Restricted FA' : 'Free agent'}</Chip>{(() => { const lv = birdLevel(p, u, cs); return lv ? <Chip kind="good">{BIRD_LABEL[lv].replace(' rights', '')}</Chip> : null; })()}</td>
            {seasons.map((_, k) => k === 0 ? <td class="fin-c fa" title="Cap hold until he signs or is renounced">Hold {fmtM(capHold(w, p))}</td> : <td class="fin-c none" />)}<td /></tr>)}
          {deadBy.map(d => <tr class="dead"><td class="l">{d.name} <span class="muted small">waived</span></td><td /><td /><td class="l"><Chip kind="bad">Dead</Chip></td>
            {d.at.map(v => v ? <td class="fin-c">{fmtM(v)}</td> : <td class="fin-c none" />)}<td /></tr>)}
        </tbody>
        <tfoot>
          <tr><th class="l" colSpan={4}>Committed</th>{committed.map(v => <th>{fmtM(v)}</th>)}<th /></tr>
          {planned.some(v => v) && <tr><th class="l" colSpan={4}>With planned re-signings</th>{total.map(v => <th>{fmtM(v)}</th>)}<th /></tr>}
          <tr class="ref"><th class="l" colSpan={4}>{R.hasCap ? 'Salary cap' : 'Reference level (no cap yet)'}</th>{seasons.map((s, k) => <th>{rules[k].hasCap ? fmtM(capFor(s)) : '—'}{s > 2026 ? '*' : ''}</th>)}<th /></tr>
          {rules.some(r => r.tax) && <tr class="ref"><th class="l" colSpan={4}>Luxury tax line</th>{rules.map(r => <th>{r.tax ? fmtM(r.tax) : '—'}</th>)}<th /></tr>}
          {rules.some(r => r.hasCap) && <tr class="room"><th class="l" colSpan={4}>Room (+) / over the cap (−)</th>{seasons.map((s, k) => { const v = capFor(s) - total[k]; return <th class={!rules[k].hasCap ? '' : v >= 0 ? 'good' : 'bad'}>{rules[k].hasCap ? `${v >= 0 ? '+' : '−'}${fmtM(Math.abs(v))}` : '—'}</th>; })}<th /></tr>}
        </tfoot>
      </table>
      {seasons.some(s => s > 2026) && <p class="muted small">* Caps after 2026–27 are projections (about 5.5% growth a year), not CBA figures.</p>}
    </Panel>

    <div class="fin-side">
      <Panel title="This season's rules">
        <div class="li"><span>System</span><b>{R.label}</b></div>
        <div class="li"><span>League minimum</span><b>{fmtM(minSalary(cs, 0))} rookie · {fmtM(minSalary(cs, 10))} 10-year vet</b></div>
        {R.hasMax ? <div class="li"><span>Maximum salary</span><b>{fmtM(maxSalary(cs, 0)!)} · {fmtM(maxSalary(cs, 7)!)} · {fmtM(maxSalary(cs, 10)!)}</b></div>
          : <div class="li"><span>Maximum salary</span><b>None (max contracts arrive in 1998–99)</b></div>}
        {R.hasCap ? <div class="li"><span>Bird rights</span><b>Re-sign your own players over the cap</b></div> : <div class="li"><span>Salary cap</span><b>None until 1984–85: the owner's budget is the limit</b></div>}
        {R.mle && <div class="li"><span>Mid-level exception</span><b>{fmtM(R.mle)}{(t as any).mleUsed === cs ? ' · used' : ' · available'}</b></div>}
        {R.tpMle && <div class="li"><span>Taxpayer mid-level</span><b>{fmtM(R.tpMle)}</b></div>}
        {R.smallExc && <div class="li"><span>$1m exception</span><b>{(t as any).mleUsed === cs ? 'Used' : 'Available'}</b></div>}
        <div class="li"><span>Rookies</span><b>{R.rookieScale ? 'First-round scale, four seasons' : 'Negotiated by draft slot'}</b></div>
        {R.hasCap && <div class="li"><span>Trades over the cap</span><b>Take back up to {R.season >= 2023 ? '125% (110% over the 1st apron, 100% over the 2nd)' : '125%'} of outgoing salary</b></div>}
        <div class="li"><span>Longest contract</span><b>{R.maxYearsOwn} seasons (own player) · {R.maxYearsOther} (others)</b></div>
        <div class="li"><span>Annual raises</span><b>{cs >= 1999 ? `Up to ${(maxRaise(cs, true) * 100).toFixed(1)}% with Bird rights, ${(maxRaise(cs, false) * 100).toFixed(1)}% otherwise` : 'No CBA limit yet'}</b></div>
        {R.hasCap && <div class="li"><span>Re-signing rights</span><b>{cs >= 1999 ? 'Full Bird after 3 seasons, Early Bird after 2, Non-Bird after 1' : 'Bird rights after 3 seasons with the team'}</b></div>}
        <div class="li"><span>Extensions</span><b>{cs >= 1995 ? 'Rookie scale in its final season; veterans with 2 or fewer left' : 'Veterans with 2 or fewer seasons left'}{cs >= 2011 ? `, up to ${cs >= 2023 ? 40 : 20}% raise` : ''}</b></div>
        {cs >= 2017 && <div class="li"><span>Supermax</span><b>35% for designated veterans (7-9 seasons, MVP / All-NBA / DPOY)</b></div>}
        <div class="li"><span>Roster</span><b>{RR.label}</b></div>
        <div class="li"><span>Trade deadline</span><b>{tradeDeadline(w.season.phase === 'draft' || w.season.phase === 'freeagency' ? cs : w.season.year)}</b></div>
        {canStretch(cs) && <div class="li"><span>Stretch provision</span><b>Waived salary can be spread over 2n+1 seasons</b></div>}
      </Panel>
      {hist.length > 0 && <Panel title="Luxury tax paid">{hist.map(([y, v]) => <div class="li"><span>{seasonLabel(+y)}</span><b class="bad">{fmtM(v)}</b></div>)}</Panel>}
      <Panel title="Plan ahead">
        <p class="muted small">Tick + on a player whose deal ends inside this window to pencil in a re-signing at an estimated market price. The plan only changes this sheet; nothing is signed until you make an offer.</p>
        {Object.keys(plan).length > 0 && <Btn kind="sm ghost" onClick={() => { (w as any).finPlan = {}; commit(); }}>Clear the plan</Btn>}
      </Panel>
    </div>
  </div>;
}
