import { useStore, openModal, commit, toast } from '../store';
import { Panel, Btn, Logo, ht, Chip, PlayerTile, Tabs, curTab } from '../util';
import { DraftRecap } from '../Showcase';
import { runCommand } from '../actions';
import { draftToMyPick, draftPlayer, autoDraftRest } from '../actions';
import { scoutReport } from '../../sim/gm';
import { scoutTrips, useScoutTrip } from '../../sim/needs';
import type { Player, World } from '../../sim/types';

const weekKey = (d: string) => { const t = new Date(d + 'T12:00:00Z'); return Math.floor(t.getTime() / (7 * 86400000)); };
function credits(w: World) {
  const k = weekKey(w.season.day);
  const c = (w as any).scoutCredits;
  if (!c || c.week !== k) (w as any).scoutCredits = { week: k, used: 0 };
  return w.scoutBudget - (w as any).scoutCredits.used;
}

function Range({ s, max = 92 }: { s?: { lo: number; hi: number; mid: number }; max?: number }) {
  if (!s) return <span class="muted">—</span>;
  const L = (v: number) => `${Math.max(0, Math.min(100, ((v - 25) / (max - 25)) * 100))}%`;
  return <span class="rng"><span class="rng-bar"><i style={{ left: L(s.lo), width: `calc(${L(s.hi)} - ${L(s.lo)})` }} /><b style={{ left: L(s.mid) }} /></span><span class="rng-t">{s.lo}–{s.hi}</span></span>;
}

function ProspectRow({ w, p, action }: { w: World; p: Player; action?: any }) {
  return <tr onClick={() => openModal('player', { id: p.id })}>
    <td class="l" colSpan={2}><PlayerTile p={p} size={34} sub={<>{p.college ?? '—'}</>} /></td>
    <td>{p.pos}</td><td>{p.age}</td><td>{ht(p.hgt)}</td>
    <td><Range s={p.scout?.now} /></td><td><Range s={p.scout?.pot} /></td><td>{p.scout?.now?.reports ?? 0}</td>
    <td class="nowrap" onClick={(e: any) => e.stopPropagation()}>{action}</td>
  </tr>;
}

export function Draft() {
  const { world: w } = useStore();
  const S = w!.season, u = w!.meta.userTeam;
  if (S.phase !== 'draft' || !S.draft) {
    const year = S.year + 1;
    const cls = (w!.draftClasses[String(year)] ?? []).map(id => w!.players[id]).filter(p => p && !p.team && p.scout).sort((a, b) => b.scout!.pot.mid - a.scout!.pot.mid);
    const left = scoutTrips(w!).left;
    const picks = w!.teams[u].picks.filter(p => p.season === year).sort((a, b) => a.round - b.round);
    const showRecap = !!S.draft?.done && curTab('draftscr', 'recap') === 'recap';
    return <div class="screen">
      <div class="screen-h"><h2>Draft & Scouting</h2>{S.draft?.done && <Tabs id="draftscr" def="recap" tabs={[{ id: 'recap', label: `${S.draft.year} recap` }, { id: 'board', label: `${year} board` }]} />}<div class="screen-meta">{year} class · Our picks: {picks.map(p => `R${p.round}${p.original !== u ? ` (${p.original})` : ''}`).join(', ') || 'none'} · Scout trips left this week: {left}</div></div>
      {showRecap ? <Panel class="fill recap-panel"><DraftRecap w={w!} /></Panel> : <Panel class="fill" title={`${year} draft board · ${cls.length} prospects`} right={<span class="muted">Ranges are our department's beliefs — not the truth. More reports narrow them.</span>}>
        <table class="tbl rows"><thead><tr><th class="l" colSpan={2}>Prospect</th><th>Pos</th><th>Age</th><th>Ht</th><th>Now</th><th>Ceiling</th><th>Rpts</th><th></th></tr></thead>
          <tbody>{cls.slice(0, 120).map(p => <ProspectRow w={w!} p={p} action={<Btn kind="sm ghost" disabled={left <= 0} onClick={() => { useScoutTrip(w!); scoutReport(w!, p.id); commit(); toast(`Report filed on ${p.name}.`); }}>Send a scout</Btn>} />)}</tbody></table>
      </Panel>}
    </div>;
  }
  const D = S.draft;
  const slot = D.order[D.idx];
  const onClock = slot?.team === u;
  const board = D.board.map(id => w!.players[id]).filter(Boolean);
  const done = D.order.filter(o => o.player);
  const mine = D.order.filter(o => o.team === u);
  return <div class="screen">
    <div class="screen-h"><h2>{D.year} NBA Draft</h2>
      <div class="screen-meta">{slot ? <>Pick #{slot.pick} · Round {slot.round} · On the clock: <b>{w!.teams[slot.team].city}</b></> : 'Draft complete'}</div></div>
    <div class="draft">
      <Panel title="Draft order" class="d-order">
        {D.order.slice(Math.max(0, D.idx - 6), D.idx + 18).map(o => <div class={`d-o ${o === slot ? 'now' : ''} ${o.team === u ? 'mine' : ''}`}>
          <span class="d-n">{o.pick}</span><Logo t={w!.teams[o.team]} size={22} /><span>{w!.teams[o.team].abbr}{o.original && o.original !== o.team && w!.teams[o.original] ? <small class="via"> via {w!.teams[o.original].abbr}</small> : null}</span><span class="d-p">{o.player ? w!.players[o.player].name : o === slot ? 'On the clock' : ''}</span></div>)}
      </Panel>
      <Panel class="fill" title={onClock ? "You're on the clock" : 'Our board'} right={<div class="row-btns">
        {!onClock && <Btn kind="big" auto onClick={draftToMyPick}>Sim to our pick</Btn>}
        <Btn kind="ghost" onClick={() => runCommand({ id: 'draft-trade', read: true } as any, { label: '', cmd: 'tradeFinder', arg: { other: Object.keys(w!.teams).find(id => id !== u && D.order.slice(D.idx).some(o => o.team === id)) ?? Object.keys(w!.teams).find(id => id !== u), give: [], get: [], givePicks: [], getPicks: [] } })}>Trade picks</Btn>
        <Btn kind="ghost" onClick={() => { if (confirm('Let the scouts make the rest of our picks from our board?')) autoDraftRest(); }}>Auto-draft the rest</Btn></div>}>
        <table class="tbl rows"><thead><tr><th class="l" colSpan={2}>Prospect</th><th>Pos</th><th>Age</th><th>Ht</th><th>Now</th><th>Ceiling</th><th>Rpts</th><th></th></tr></thead>
          <tbody>{board.slice(0, 60).map((p, i) => <ProspectRow w={w!} p={p} action={onClock ? <Btn kind={i === 0 ? 'sm' : 'sm ghost'} auto={i === 0} onClick={() => draftPlayer(p.id)}>Draft</Btn> : null} />)}</tbody></table>
      </Panel>
      <Panel title="Our picks" class="d-mine">
        {mine.map(o => <div class="li"><span>#{o.pick} (R{o.round})</span><b>{o.player ? w!.players[o.player].name : '—'}</b>{o.player && o.round > 2 && <Chip>Rights only</Chip>}</div>)}
        <div class="muted small">Rounds 1–2 sign rookie deals. Later picks are rights only — sign them in free agency if you want them.</div>
        <div class="muted small">Picks made: {done.length}/{D.order.length}</div>
      </Panel>
    </div>
  </div>;
}
