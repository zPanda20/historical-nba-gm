import { useStore, setUI, ui, commit, openModal } from '../store';
import { Panel, Btn, Tabs, curTab, dateShort, Chip } from '../util';
import { runCommand } from '../actions';
import { TradeCard, ReqPanel } from '../deal';
import type { Message, World } from '../../sim/types';

export function MessageView({ w, m, inModal }: { w: World; m: Message; inModal?: boolean }) {
  return <div class={`msg ${inModal ? 'in-modal' : ''}`}>
    <div class="msg-h"><Chip kind={m.urgent >= 3 ? 'bad' : m.urgent >= 2 ? 'warn' : ''}>{m.tag ?? m.role}</Chip><span class="muted">{dateShort(m.date)}{m.deadline ? ` · Respond by ${dateShort(m.deadline)}` : ''}</span></div>
    <div class="msg-from">{m.from} <small>{m.role}</small></div>
    <h3 class="msg-s">{m.subject}</h3>
    <p class="msg-b">{m.body}</p>
    {m.tag === 'Trade' && m.actions?.[0]?.arg?.other && <TradeCard w={w} read={!m.resolved} offer={{ givePicks: [], getPicks: [], ...m.actions[0].arg }} />}
    {m.tag === 'Coach request' && !m.resolved && <ReqPanel w={w} />}
    {!m.resolved && <div class="row-btns">
      {(m.actions?.length ? m.actions : [{ label: 'Got it', cmd: 'dismiss' }]).map((a, i) => <Btn kind={i === 0 ? 'big' : 'ghost'} auto={i === 0} onClick={() => { if (inModal && a.cmd !== 'goto') setUI({ modal: null }); runCommand(m, a); }}>{a.label}</Btn>)}
    </div>}
    {m.resolved && <div class="muted">Handled.</div>}
  </div>;
}

export function People() {
  const { world: w } = useStore();
  const tab = curTab('people', 'inbox');
  const msgs = w!.messages.filter(m => tab === 'inbox' ? !m.resolved : m.resolved);
  const sel = w!.messages.find(m => m.id === ui.tab.peopleSel) ?? msgs[0];
  const t = w!.teams[w!.meta.userTeam];
  const c = w!.coaches[t.coach];
  return <div class="screen">
    <div class="screen-h"><h2>People</h2><Tabs id="people" def="inbox" tabs={[{ id: 'inbox', label: `Needs you (${w!.messages.filter(m => !m.resolved).length})` }, { id: 'done', label: 'Handled' }]} /><div class="screen-meta">Calls, notes and visitors. The slip on your desk always shows the most urgent one.</div></div>
    <div class="people">
      <Panel class="inbox" title={tab === 'inbox' ? 'On your desk' : 'Handled'}>
        {msgs.length ? msgs.map(m => <button data-nav class={`ib ${sel?.id === m.id ? 'on' : ''} ${m.read ? '' : 'unread'} u${m.urgent}`} onClick={() => { m.read = true; setUI({ tab: { ...ui.tab, peopleSel: m.id } }); commit(false); }}>
          <span class="ib-d">{dateShort(m.date)}</span><span class="ib-f">{m.from}</span><span class="ib-s">{m.subject}</span></button>) : <div class="muted">Nothing here.</div>}
      </Panel>
      <Panel class="fill">{sel ? <MessageView w={w!} m={sel} /> : <div class="muted">Pick a message.</div>}</Panel>
      <Panel title="Your people" class="contacts">
        <button data-nav class="ct" onClick={() => openModal('ownerTalk')}><b>{w!.owner.name}</b><small>Owner</small></button>
        <button data-nav class="ct" onClick={() => openModal('coachTalk')}><b>{c.name}</b><small>Head coach</small></button>
        <button data-nav class="ct" onClick={() => setUI({ screen: 'draft' })}><b>Director of scouting</b><small>Scouting</small></button>
        <button data-nav class="ct" onClick={() => setUI({ screen: 'staff' })}><b>Team physician</b><small>Medical</small></button>
      </Panel>
    </div>
  </div>;
}
