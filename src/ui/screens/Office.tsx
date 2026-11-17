import { useState } from 'preact/hooks';
import { useStore, openModal, commit, toast, ui, setUI } from '../store';
import { place, Panel, Btn, Tabs, curTab, Logo, Headshot, OvrBadge, Chip, Meter, dateShort, injuryChip } from '../util';
import { rightsOk, evaluateTrade, executeTrade, fmt$, payroll, marketSalary, TRADE_DEADLINE, tradeValue } from '../../sim/gm';
import { playerValue } from '../../sim/coach';
import type { World, Player } from '../../sim/types';
import { ClockPicker } from '../Modals';

type PK = { season: number; round: number; original: string };
const pkKey = (p: PK) => `${p.season}-${p.round}-${p.original}`;

function TradeFinder({ w }: { w: World }) {
  const u = w.meta.userTeam;
  const others = Object.values(w.teams).filter(t => t.id !== u).sort((a, b) => a.city.localeCompare(b.city));
  const d = ui.tradeDraft ?? { other: others[0].id, give: [], get: [], givePicks: [], getPicks: [] };
  const [reply, setReply] = useState<{ text: string; ok: boolean } | null>(null);
  const set = (patch: any) => { setReply(null); setUI({ tradeDraft: { ...d, ...patch } }); };
  const O = w.teams[d.other], U = w.teams[u];
  const S = w.season;
  const closed = S.phase === 'playoffs' || (S.phase === 'regular' && S.day > TRADE_DEADLINE(S.year)) || S.phase === 'draft';
  const toggle = (k: 'give' | 'get', id: string) => set({ [k]: d[k].includes(id) ? d[k].filter((x: string) => x !== id) : [...d[k], id] });
  const toggleP = (k: 'givePicks' | 'getPicks', p: PK) => set({ [k]: d[k].some((x: PK) => pkKey(x) === pkKey(p)) ? d[k].filter((x: PK) => pkKey(x) !== pkKey(p)) : [...d[k], { season: p.season, round: p.round, original: p.original }] });
  const picks = (tid: string) => w.teams[tid].picks.filter(p => p.season > S.year && p.round <= 2 && !(S.phase === 'draft' && p.season === S.year + 1)).sort((a, b) => a.season - b.season || a.round - b.round);
  const myView = d.get.reduce((s: number, id: string) => s + tradeValue(w, w.players[id], u), 0) - d.give.reduce((s: number, id: string) => s + tradeValue(w, w.players[id], u), 0);
  const propose = () => {
    const ev = evaluateTrade(w, d);
    setReply({ text: ev.reason, ok: ev.accept });
  };
  const confirm = () => {
    executeTrade(w, d);
    setReply(null); setUI({ tradeDraft: { other: d.other, give: [], get: [], givePicks: [], getPicks: [] } });
    commit(); toast('Trade completed.');
  };
  const PRow = ({ p, side }: { p: Player; side: 'give' | 'get' }) => <button data-nav class={`tr-p ${d[side].includes(p.id) ? 'on' : ''}`} onClick={() => toggle(side, p.id)}>
    <Headshot p={p} size={34} /><div class="tr-n"><b>{p.name}</b><small>{p.pos} · {p.age} · {p.contract ? `${fmt$(p.contract.salary)} × ${p.contract.years}` : '—'}</small></div><OvrBadge w={w} p={p} />{injuryChip(p)}
  </button>;
  return <div class="trade">
    <div class="tr-teams">{others.map(t => <button data-nav class={`tr-t ${t.id === d.other ? 'on' : ''}`} onClick={() => set({ other: t.id, get: [], getPicks: [] })}><Logo t={t} size={28} /><span>{place(t)}</span><small>{t.w}–{t.l}</small></button>)}</div>
    <Panel title={<><Logo t={U} size={26} /> You send</>} class="tr-col">
      {U.roster.map(id => w.players[id]).sort((a, b) => playerValue(b) - playerValue(a)).map(p => <PRow p={p} side="give" />)}
      <div class="tr-picks">{picks(u).map(p => <button data-nav class={`pk ${d.givePicks.some((x: PK) => pkKey(x) === pkKey(p)) ? 'on' : ''}`} onClick={() => toggleP('givePicks', p)}>{p.season} R{p.round}{p.original !== u ? ` (${p.original})` : ''}</button>)}</div>
    </Panel>
    <Panel title={<><Logo t={O} size={26} /> You receive</>} right={<span class="muted">GM {O.gm} · {O.clock}</span>} class="tr-col">
      {O.roster.map(id => w.players[id]).sort((a, b) => playerValue(b) - playerValue(a)).map(p => <PRow p={p} side="get" />)}
      <div class="tr-picks">{picks(O.id).map(p => <button data-nav class={`pk ${d.getPicks.some((x: PK) => pkKey(x) === pkKey(p)) ? 'on' : ''}`} onClick={() => toggleP('getPicks', p)}>{p.season} R{p.round}{p.original !== O.id ? ` (${p.original})` : ''}</button>)}</div>
    </Panel>
    <div class="tr-bar">
      <div class="tr-sum">
        <span>Send: <b>{[...d.give.map((id: string) => w.players[id].name), ...d.givePicks.map((p: PK) => `${p.season} R${p.round}`)].join(', ') || '—'}</b></span>
        <span>Receive: <b>{[...d.get.map((id: string) => w.players[id].name), ...d.getPicks.map((p: PK) => `${p.season} R${p.round}`)].join(', ') || '—'}</b></span>
        <span class="muted">Our staff's read: {myView > 3 ? 'we come out ahead' : myView < -3 ? 'we give up more talent' : 'roughly even'} · Payroll after: {fmt$(payroll(w, u) - d.give.reduce((s: number, id: string) => s + (w.players[id].contract?.salary ?? 0), 0) + d.get.reduce((s: number, id: string) => s + (w.players[id].contract?.salary ?? 0), 0))}</span>
      </div>
      {reply && <div class={`tr-reply ${reply.ok ? 'ok' : ''}`}>{reply.text}</div>}
      {closed ? <Chip kind="bad">Trading is closed ({S.phase === 'regular' ? 'past the deadline' : S.phase})</Chip>
        : reply?.ok ? <Btn kind="big" auto onClick={confirm}>Shake on it</Btn>
          : <Btn kind="big" disabled={!d.give.length && !d.givePicks.length} onClick={propose}>Make the call</Btn>}
    </div>
  </div>;
}

function FreeAgents({ w }: { w: World }) {
  const u = w.meta.userTeam;
  const pool = w.freeAgents.map(id => w.players[id]).filter(p => p && !p.retired && rightsOk(p, u))
    .sort((a, b) => (b.draftedBy === u ? 1 : 0) - (a.draftedBy === u ? 1 : 0) || playerValue(b) - playerValue(a)).slice(0, 80);
  const t = w.teams[u];
  return <Panel class="fill" title={`Free agents (${pool.length})`} right={<span class="muted">Roster {t.roster.length}/12 · Payroll {fmt$(payroll(w, u))} of {fmt$(w.owner.budget)} budget</span>}>
    <table class="tbl rows"><thead><tr><th></th><th class="l">Player</th><th>Pos</th><th>Age</th><th>Est.</th><th>Asking</th><th class="l">Status</th><th></th></tr></thead>
      <tbody>{pool.map(p => <tr>
        <td><Headshot p={p} size={34} /></td><td class="l b"><button data-nav class="link" onClick={() => openModal('player', { id: p.id })}>{p.name}</button></td><td>{p.pos}</td><td>{p.age}</td><td><OvrBadge w={w} p={p} /></td>
        <td>{fmt$(p.ask ?? marketSalary(p))}</td><td class="l">{p.draftedBy === u ? <Chip kind="good">Our draft rights</Chip> : <span class="muted">{p.rosterStatus}</span>}</td>
        <td><Btn kind="sm" onClick={() => openModal('offer', { pid: p.id })}>Offer</Btn></td></tr>)}</tbody></table>
  </Panel>;
}

function Contracts({ w }: { w: World }) {
  const u = w.meta.userTeam, t = w.teams[u];
  const ps = t.roster.map(id => w.players[id]).sort((a, b) => (b.contract?.salary ?? 0) - (a.contract?.salary ?? 0));
  const pay = payroll(w, u);
  const off = w.season.phase === 'freeagency';
  return <div class="two">
    <Panel class="fill" title="Contracts" right={<span class="muted">Payroll {fmt$(pay)} · Owner budget {fmt$(w.owner.budget)}</span>}>
      <div class="pay-meter"><Meter v={pay} max={Math.max(pay, w.owner.budget) * 1.1} /><span class={pay > w.owner.budget ? 'bad' : ''}>{pay > w.owner.budget ? `${fmt$(pay - w.owner.budget)} over budget` : `${fmt$(w.owner.budget - pay)} under budget`}</span></div>
      <table class="tbl rows"><thead><tr><th class="l">Player</th><th>Age</th><th>OVR</th><th>Salary</th><th>Years left</th><th class="l">Source</th><th></th></tr></thead>
        <tbody>{ps.map(p => { const exp = (p.contract?.years ?? 0) <= (off ? 0 : 1);
          return <tr class={exp ? 'hl' : ''}>
            <td class="l b"><button data-nav class="link" onClick={() => openModal('player', { id: p.id })}>{p.name}</button></td><td>{p.age}</td><td><span class="ovr">{p.ovr}</span></td>
            <td>{p.contract ? fmt$(p.contract.salary) : '—'}</td><td>{p.contract?.years ?? 0}{exp && <Chip kind="warn">{off ? 'Unsigned' : 'Expiring'}</Chip>}</td>
            <td class="l small muted">{p.contract?.provenance}</td>
            <td class="nowrap">{exp && <Btn kind="sm" onClick={() => openModal('offer', { pid: p.id })}>{off ? 'Re-sign' : 'Extend'}</Btn>} <Btn kind="sm ghost" onClick={() => openModal('release', { pid: p.id })}>Release</Btn></td></tr>; })}</tbody></table>
    </Panel>
    <Panel title="How money works here">
      <p class="muted">Salaries for 1976 are <b>reconstructed estimates</b> for simulation, labelled R. Anything signed in this save is simulated. There is no salary cap in 1976–77 — your limit is the owner's budget and his patience.</p>
      <p class="muted">Contracts tick down at the end of each season. In the offseason, unsigned players leave when the new season starts.</p>
    </Panel>
  </div>;
}

function Owner({ w }: { w: World }) {
  const t = w.teams[w.meta.userTeam];
  return <div class="two">
    <Panel title="Franchise clock"><ClockPicker /></Panel>
    <Panel title={`Owner · ${w.owner.name}`}>
      <div class="boss"><div><label>Satisfaction</label><b>{Math.round(w.owner.satisfaction)}</b></div><Meter v={w.owner.satisfaction} /></div>
      <div class="boss-obj">{w.owner.objective}</div>
      <div class="li"><span>Expected wins</span><b>{w.owner.expectedWins}</b></div>
      <div class="li"><span>Payroll budget</span><b>{fmt$(w.owner.budget)}</b></div>
      <div class="li"><span>Mode</span><b>{w.meta.mode === 'career' ? 'Career — you can be fired' : 'Sandbox'}</b></div>
      <div class="li"><span>Your reputation around the league</span><Meter v={w.gmRep} /></div>
      {t.history.length > 0 && <div class="muted">Past seasons: {t.history.map(h => `${h.season}: ${h.w}–${h.l} (${h.result})`).join(' · ')}</div>}
    </Panel>
  </div>;
}

function History({ w }: { w: World }) {
  const u = w.meta.userTeam;
  const ev = w.events.filter(e => ['trade', 'signing', 'release', 'coach_change', 'clock', 'coach_request', 'promise', 'draft'].includes(e.type) && (e.text.includes(u) || e.type === 'trade' || e.type === 'clock' || e.type === 'coach_request' || e.type === 'promise' || e.type === 'coach_change')).slice(-80).reverse();
  return <Panel class="fill" title="Front office log">
    {ev.length ? ev.map(e => <div class="li"><span class="muted">{dateShort(e.date)}</span><span>{e.text}</span></div>) : <div class="muted">Nothing on the record yet.</div>}
  </Panel>;
}

export function Office() {
  const { world: w } = useStore();
  const tab = curTab('office', 'trade');
  return <div class="screen">
    <div class="screen-h"><h2>Front Office</h2><Tabs id="office" def="trade" tabs={[{ id: 'trade', label: 'Trades' }, { id: 'fa', label: 'Free agents' }, { id: 'contracts', label: 'Contracts' }, { id: 'owner', label: 'Owner & clock' }, { id: 'log', label: 'Log' }]} /></div>
    {tab === 'trade' && <TradeFinder w={w!} />}
    {tab === 'fa' && <FreeAgents w={w!} />}
    {tab === 'contracts' && <Contracts w={w!} />}
    {tab === 'owner' && <Owner w={w!} />}
    {tab === 'log' && <History w={w!} />}
  </div>;
}
