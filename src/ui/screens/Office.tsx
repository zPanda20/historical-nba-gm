import { useState } from 'preact/hooks';
import { bestOffer, capRules, capSeason, capRoom, fmtM } from '../../sim/cap';
import { go } from '../store';
import { useStore, openModal, commit, toast, ui, setUI } from '../store';
import { place, Panel, Btn, Tabs, curTab, Logo, OvrBadge, Chip, Meter, dateShort, injuryChip, PlayerTile, SortTable, seenOvr } from '../util';
import { rightsOk, evaluateTrade, executeTrade, fmt$, payroll, marketSalary, tradeLegal } from '../../sim/gm';
import type { TradeReply } from '../../sim/gm';
import { gmProfile, patience, phoneOpen, tradablePicks, pickKey } from '../../sim/trade';
import { openRequest, needDef, seenRating } from '../../sim/needs';
import { TradeCard, ReqPanel } from '../deal';
import { playerValue } from '../../sim/coach';
import type { World, Player } from '../../sim/types';
import { ClockPicker } from '../Modals';

type PK = { season: number; round: number; original: string };
const pkKey = (p: PK) => pickKey(p as any);

function TradeFinder({ w }: { w: World }) {
  const u = w.meta.userTeam;
  const others = Object.values(w.teams).filter(t => t.id !== u).sort((a, b) => place(a).localeCompare(place(b)));
  const d = ui.tradeDraft ?? { other: others[0].id, give: [], get: [], givePicks: [], getPicks: [] };
  const [reply, setReply] = useState<TradeReply | null>(null);
  const set = (patch: any) => { setReply(null); setUI({ tradeDraft: { ...d, ...patch } }); };
  const O = w.teams[d.other], U = w.teams[u];
  const S = w.season;
  const closed = tradeLegal(w, { ...d, give: ['x'], get: ['y'] } as any);
  const closedHard = closed && /deadline|playoffs/.test(closed) ? closed : null;
  const toggle = (k: 'give' | 'get', id: string) => set({ [k]: d[k].includes(id) ? d[k].filter((x: string) => x !== id) : [...d[k], id] });
  const toggleP = (k: 'givePicks' | 'getPicks', p: PK) => set({ [k]: d[k].some((x: PK) => pkKey(x) === pkKey(p)) ? d[k].filter((x: PK) => pkKey(x) !== pkKey(p)) : [...d[k], { season: p.season, round: p.round, original: p.original, ...((p as any).no ? { no: (p as any).no } : {}) }] });
  const picks = (tid: string) => tradablePicks(w, tid) as any[];
  const propose = () => setReply(evaluateTrade(w, d));
  const done = (offer: any) => {
    executeTrade(w, offer);
    setReply(null); setUI({ tradeDraft: { other: d.other, give: [], get: [], givePicks: [], getPicks: [] } });
    commit(); toast('Trade completed.');
  };
  const takeCounter = () => {
    const c = reply!.counter!;
    const offer = { ...d, give: c.give ? [...d.give, c.give] : d.give, givePicks: c.givePick ? [...d.givePicks, c.givePick] : d.givePicks, get: c.drop ? d.get.filter((x: string) => x !== c.drop) : d.get };
    done(offer);
  };
  const PRow = ({ p, side }: { p: Player; side: 'give' | 'get' }) => <div class={`tr-p ${d[side].includes(p.id) ? 'on' : ''}`}>
    <button data-nav class="tr-pick" title={d[side].includes(p.id) ? 'Take out of the deal' : 'Put in the deal'} onClick={() => toggle(side, p.id)}>{d[side].includes(p.id) ? '✓' : '+'}</button>
    <PlayerTile p={p} size={34} sub={<>{p.pos} · {p.age} · {p.contract ? `${fmt$(p.contract.salary)} × ${p.contract.years}` : '—'}</>} right={<><OvrBadge w={w} p={p} />{injuryChip(p)}</>} />
  </div>;
  const empty = !d.give.length && !d.get.length && !d.givePicks.length && !d.getPicks.length;
  return <div class="trade">
    <div class="tr-teams">{others.map(t => <button data-nav class={`tr-t ${t.id === d.other ? 'on' : ''}`} onClick={() => set({ other: t.id, get: [], getPicks: [] })}><Logo t={t} size={28} /><span>{place(t)}</span><small>{t.w}–{t.l}</small></button>)}</div>
    <Panel title={<><Logo t={U} size={26} /> Our roster</>} class="tr-col">
      {U.roster.map(id => w.players[id]).sort((a, b) => playerValue(b) - playerValue(a)).map(p => <PRow p={p} side="give" />)}
      <div class="tr-picks">{picks(u).map(p => <button data-nav class={`pk ${d.givePicks.some((x: PK) => pkKey(x) === pkKey(p)) ? 'on' : ''}`} onClick={() => toggleP('givePicks', p)}>{p.no ? <><b>No. {p.no}</b> tonight</> : <>{p.season} {p.round === 1 ? '1st' : '2nd'}</>}{p.original !== u ? ` (${p.original})` : ''}</button>)}</div>
    </Panel>
    <Panel title={<><Logo t={O} size={26} /> {O.city} {O.name}</>} class="tr-col">
      <GmCard w={w} tid={O.id} />
      {O.roster.map(id => w.players[id]).sort((a, b) => playerValue(b) - playerValue(a)).map(p => <PRow p={p} side="get" />)}
      <div class="tr-picks">{picks(O.id).map(p => <button data-nav class={`pk ${d.getPicks.some((x: PK) => pkKey(x) === pkKey(p)) ? 'on' : ''}`} onClick={() => toggleP('getPicks', p)}>{p.no ? <><b>No. {p.no}</b> tonight</> : <>{p.season} {p.round === 1 ? '1st' : '2nd'}</>}{p.original !== O.id ? ` (${p.original})` : ''}</button>)}</div>
    </Panel>
    <div class="tr-deal">
      {empty ? <div class="tr-empty"><b>Build a deal</b><p>Press + next to players and picks on either side. Your staff will tell you what they think of it before you call {O.gm}.</p></div>
        : <TradeCard w={w} offer={d} />}
      {reply && <div class={`tr-reply ${reply.accept ? 'ok' : ''}`}>{reply.reason}</div>}
      <div class="row-btns">
        {closedHard ? <Chip kind="bad">{closedHard}</Chip>
          : reply?.accept ? <Btn kind="big" auto onClick={() => done(d)}>Shake on it</Btn>
            : reply?.counter ? <><Btn kind="big" auto onClick={takeCounter}>Agree: {reply.counter.label}</Btn><Btn kind="ghost" onClick={() => setReply(null)}>Keep working</Btn></>
              : <Btn kind="big" disabled={empty || !phoneOpen(w, O.id).open} onClick={propose}>Call {O.gm.split(' ').slice(-1)[0]}</Btn>}
        {!empty && <Btn kind="ghost" onClick={() => set({ give: [], get: [], givePicks: [], getPicks: [] })}>Clear</Btn>}
      </div>
    </div>
  </div>;
}

function GmCard({ w, tid }: { w: World; tid: string }) {
  const t = w.teams[tid];
  const prof = gmProfile(w, tid);
  const st = patience(w, tid);
  const ph = phoneOpen(w, tid);
  const v = Math.max(0, st.cur) / prof.max * 100;
  return <div class={`gm-card ${ph.open ? '' : 'closed'}`}>
    <div class="gm-top"><b>GM {t.gm}</b><span>{t.clock}</span></div>
    <div class="gm-style">{prof.style}</div>
    <div class="gm-pat"><span>Patience</span><div class={`meter pat ${v < 30 ? 'low' : ''}`}><i style={{ width: `${v}%` }} /></div></div>
    {!ph.open && <div class="gm-closed">{ph.text}</div>}
  </div>;
}

function FreeAgents({ w }: { w: World }) {
  const u = w.meta.userTeam;
  const pool = w.freeAgents.map(id => w.players[id]).filter(p => p && !p.retired && rightsOk(p, u))
    .sort((a, b) => (b.draftedBy === u ? 1 : 0) - (a.draftedBy === u ? 1 : 0) || playerValue(b) - playerValue(a)).slice(0, 80);
  const t = w.teams[u];
  const req = openRequest(w);
  const reqDef = req ? needDef(req.key) : null;
  return <div class="fa-wrap">
    {req && <Panel title="What the coach asked for" class="fa-req"><ReqPanel w={w} /><div class="muted small">Open a player to see how signing him would move this.</div></Panel>}
    <Panel class="fill" title={`Free agents (${pool.length})`} right={<span class="muted">Roster {t.roster.length}/12 · payroll {fmt$(payroll(w, u))} · {capRules(capSeason(w)).hasCap ? `cap room ${fmtM(capRoom(w, u))}` : `owner budget ${fmt$(w.owner.budget)}`}</span>}>
      <SortTable id="fa" rows={pool} onRow={p => openModal('offer', { pid: p.id })} cols={[
        { key: 'name', label: 'Player', cls: 'l', get: p => p.name, desc: false, render: p => <PlayerTile p={p} size={34} /> },
        { key: 'pos', label: 'Pos', get: p => p.pos, desc: false, render: p => p.pos },
        { key: 'age', label: 'Age', get: p => p.age ?? 0, desc: false, render: p => p.age },
        { key: 'est', label: 'Est.', get: p => seenOvr(w, p).mid, render: p => <OvrBadge w={w} p={p} /> },
        ...(reqDef ? [{ key: 'need', label: reqDef.label, get: (p: Player) => Math.round(reqDef.f(Object.fromEntries(Object.keys(p.r).map(k => [k, seenRating(w, p, k as any)])) as any)), render: (p: Player) => Math.round(reqDef.f(Object.fromEntries(Object.keys(p.r).map(k => [k, seenRating(w, p, k as any)])) as any)), title: 'Our staff\'s estimate of what the coach asked for' }] : []),
        { key: 'ask', label: 'Asking', get: p => p.ask ?? marketSalary(p, capSeason(w)), render: p => fmt$(p.ask ?? marketSalary(p, capSeason(w))) },
        { key: 'most', label: 'We can offer', title: 'The most the cap rules (or the owner) let us pay him', get: p => bestOffer(w, u, p, 2), render: p => { const m = bestOffer(w, u, p, 2), a = p.ask ?? marketSalary(p, capSeason(w)); return <span class={m >= a ? 'good' : m >= a * 0.85 ? '' : 'bad'}>{fmt$(m)}</span>; } },
        { key: 'st', label: 'Status', cls: 'l', render: p => p.draftedBy === u && (p.rosterStatus ?? '').startsWith('Draft rights') ? <Chip kind="good">Our draft rights</Chip> : (p as any).bird === u ? <><Chip kind="good">Our Bird rights</Chip> <span class="muted small">{p.rosterStatus}</span></> : <span class="muted small">{p.rosterStatus}</span> },
        { key: 'act', label: '', render: p => <Btn kind="sm" onClick={() => openModal('offer', { pid: p.id })}>Offer</Btn> },
      ]} />
    </Panel>
  </div>;
}

function Contracts({ w }: { w: World }) {
  const u = w.meta.userTeam, t = w.teams[u];
  const ps = t.roster.map(id => w.players[id]);
  const pay = payroll(w, u);
  const off = w.season.phase === 'freeagency';
  const exp = (p: Player) => (p.contract?.years ?? 0) <= (off ? 0 : 1);
  return <div class="two wide-l">
    <Panel class="fill" title="Contracts" right={<span class="muted">Payroll {fmt$(pay)} · {capRules(capSeason(w)).hasCap ? `cap ${fmtM(capRules(capSeason(w)).cap)}` : `owner budget ${fmt$(w.owner.budget)}`} · <button data-nav class="linkish" onClick={() => go('finances')}>Full cap sheet</button></span>}>
      <div class="pay-meter"><Meter v={pay} max={Math.max(pay, w.owner.budget) * 1.1} /><span class={pay > w.owner.budget ? 'bad' : ''}>{pay > w.owner.budget ? `${fmt$(pay - w.owner.budget)} over budget` : `${fmt$(w.owner.budget - pay)} under budget`}</span></div>
      <SortTable id="contracts" rows={ps} def="sal:d" rowCls={p => exp(p) ? 'hl' : ''} onRow={p => openModal('player', { id: p.id })} cols={[
        { key: 'name', label: 'Player', cls: 'l', get: p => p.name, desc: false, render: p => <PlayerTile p={p} size={34} /> },
        { key: 'age', label: 'Age', get: p => p.age ?? 0, render: p => p.age },
        { key: 'ovr', label: 'OVR', get: p => p.ovr, render: p => <span class="ovr">{p.ovr}</span> },
        { key: 'sal', label: 'Salary', get: p => p.contract?.salary ?? 0, render: p => p.contract ? fmt$(p.contract.salary) : '—' },
        { key: 'yrs', label: 'Years left', get: p => p.contract?.years ?? 0, desc: false, render: p => <>{p.contract?.years ?? 0}{exp(p) && <Chip kind="warn">{off ? 'Unsigned' : 'Expiring'}</Chip>}</> },
        { key: 'src', label: 'Source', cls: 'l small muted', render: p => p.contract?.provenance },
        { key: 'act', label: '', cls: 'nowrap', render: p => <>{exp(p) && <Btn kind="sm" onClick={() => openModal('offer', { pid: p.id })}>{off ? 'Re-sign' : 'Extend'}</Btn>} <Btn kind="sm ghost" onClick={() => openModal('release', { pid: p.id })}>Release</Btn></> },
      ]} />
    </Panel>
    <Panel title="How money works here">
      <p class="muted">Salaries for 1976 are <b>reconstructed estimates</b> for simulation, marked R. Anything signed in this save is simulated.</p>
      <p class="muted">{capRules(capSeason(w)).hasCap ? <>This season runs under a <b>{capRules(capSeason(w)).label.toLowerCase()}</b>. Free agents from other teams need cap room or an exception; your own players can be kept over the cap with Bird rights. The Finances screen (9) shows every season on the books.</> : <>There is no salary cap until 1984–85: the owner's budget is the hard limit on new money (minimum deals excepted).</>}</p>
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
