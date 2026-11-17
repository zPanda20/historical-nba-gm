import { useStore, setUI, ui, commit, openModal } from '../store';
import { Panel, Btn, Tabs, curTab, dateShort, Chip, PlayerTile } from '../util';
import { fmt$ } from '../../sim/gm';
import { runCommand } from '../actions';
import { TradeCard, ReqPanel } from '../deal';
import type { Message, Player, World } from '../../sim/types';

/** Players a message is about: from its actions, or named in its subject (our roster first). */
export function aboutPlayers(w: World, m: Message): Player[] {
  const ids = new Set<string>();
  for (const a of m.actions ?? []) if (a.arg?.pid) ids.add(a.arg.pid);
  if (!ids.size && m.tag !== 'Trade') {
    const pool = [...w.teams[w.meta.userTeam].roster, ...w.freeAgents];
    for (const id of pool) { const p = w.players[id]; if (p && m.subject.includes(p.name)) { ids.add(id); break; } }
  }
  return [...ids].map(id => w.players[id]).filter(Boolean);
}

export type Era = '70s' | '90s' | '00s' | '20s';
export function peopleEra(w: World): Era {
  const o = ui.peopleEra; if (o && o !== 'auto') return o as Era;
  const y = w.season.year;
  return y < 1984 ? '70s' : y < 1997 ? '90s' : y < 2015 ? '00s' : '20s';
}
const ERA_COPY: Record<Era, { list: string; done: string; people: string; meta: string }> = {
  '70s': { list: 'Message book', done: 'Filed', people: 'Rolodex', meta: 'Calls, memos and visitors. The top slip on your desk is always the most urgent.' },
  '90s': { list: 'Fax & voicemail', done: 'Filed', people: 'Speed dial', meta: 'Faxes in the tray, voicemails on the machine.' },
  '00s': { list: 'Inbox', done: 'Archive', people: 'Contacts', meta: 'Mail from around the league. Unread messages are in bold.' },
  '20s': { list: 'Messages', done: 'Archived', people: 'Pinned', meta: 'Threads with your owner, coach, agents and GMs.' },
};
const initials = (n: string) => n.replace(/^(Agent for|Team|Director of)\s+/, '').split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();

function Actions({ m, inModal, era }: { m: Message; inModal?: boolean; era?: Era }) {
  if (m.resolved) return <div class="muted">Handled.</div>;
  return <div class={`row-btns ${era === '20s' ? 'replies' : ''}`}>
    {(m.actions?.length ? m.actions : [{ label: 'Got it', cmd: 'dismiss' }]).map((a, i) => <Btn kind={i === 0 ? 'big' : 'ghost'} auto={i === 0} onClick={() => { if (inModal && a.cmd !== 'goto') setUI({ modal: null }); runCommand(m, a); }}>{a.label}</Btn>)}
  </div>;
}
function Extras({ w, m }: { w: World; m: Message }) {
  return <>
    {aboutPlayers(w, m).length > 0 && <div class="msg-about"><span>About</span>{aboutPlayers(w, m).map(p => <PlayerTile p={p} size={40} sub={<>{p.pos} · {p.age} yrs{p.contract ? ` · ${fmt$(p.contract.salary)} × ${p.contract.years}` : ''}</>} />)}</div>}
    {m.tag === 'Trade' && m.actions?.[0]?.arg?.other && <TradeCard w={w} read={!m.resolved} offer={{ givePicks: [], getPicks: [], ...m.actions[0].arg }} />}
    {m.tag === 'Coach request' && !m.resolved && <ReqPanel w={w} />}
  </>;
}

export function MessageView({ w, m, inModal, era = '70s' }: { w: World; m: Message; inModal?: boolean; era?: Era }) {
  const t = w.teams[w.meta.userTeam];
  if (era === '00s') return <div class="msg mail">
    <div class="mail-head"><h3>{m.subject}</h3>
      <div><span>From:</span> {m.from} &lt;{m.from.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@{m.role === 'League' ? 'nba.com' : 'mail.com'}&gt;</div>
      <div><span>To:</span> GM, {t.city} {t.name}</div><div><span>Date:</span> {dateShort(m.date)}{m.deadline ? ` · reply by ${dateShort(m.deadline)}` : ''} · {m.tag ?? m.role}</div></div>
    <div class="mail-body"><p>{m.body}</p><Extras w={w} m={m} /></div>
    <Actions m={m} inModal={inModal} />
  </div>;
  if (era === '20s') return <div class="msg chat">
    <div class="chat-head"><i class="av">{initials(m.from)}</i><div><b>{m.from}</b><small>{m.role}{m.deadline ? ` · needs an answer by ${dateShort(m.deadline)}` : ''}</small></div></div>
    <div class="chat-day">{dateShort(m.date)}</div>
    <div class="bubble in"><b>{m.subject}</b><span>{m.body}</span></div>
    <div class="chat-extras"><Extras w={w} m={m} /></div>
    <Actions m={m} inModal={inModal} era="20s" />
  </div>;
  if (era === '90s') return <div class="msg fax">
    <div class="fax-sheet">
      <div class="fax-line">{dateShort(m.date).toUpperCase()} {w.season.year}  FROM: {m.from.toUpperCase()}  P.01</div>
      <div class="fax-title">FACSIMILE · {(m.tag ?? m.role).toUpperCase()}</div>
      <div class="fax-to">TO: GENERAL MANAGER, {t.city.toUpperCase()} {t.name.toUpperCase()}<br />RE: {m.subject.toUpperCase()}</div>
      <p>{m.body}</p>
    </div>
    <Extras w={w} m={m} />
    <Actions m={m} inModal={inModal} />
  </div>;
  return <div class={`msg ${inModal ? 'in-modal' : ''}`}>
    <div class="msg-h"><Chip kind={m.urgent >= 3 ? 'bad' : m.urgent >= 2 ? 'warn' : ''}>{m.tag ?? m.role}</Chip><span class="muted">{dateShort(m.date)}{m.deadline ? ` · Respond by ${dateShort(m.deadline)}` : ''}</span></div>
    <div class="msg-from">{m.from} <small>{m.role}</small></div>
    <h3 class="msg-s">{m.subject}</h3>
    <Extras w={w} m={m} />
    <p class="msg-b">{m.body}</p>
    <Actions m={m} inModal={inModal} />
  </div>;
}

function Row({ m, on, era, pick }: { m: Message; on: boolean; era: Era; pick: () => void }) {
  const cls = `ib ${on ? 'on' : ''} ${m.read ? '' : 'unread'} u${m.urgent}`;
  if (era === '20s') return <button data-nav class={cls} onClick={pick}><i class="av">{initials(m.from)}</i><span class="ib-f">{m.from}</span><span class="ib-d">{dateShort(m.date)}</span><span class="ib-s">{m.subject}</span>{!m.read && <i class="dot" />}</button>;
  if (era === '00s') return <button data-nav class={cls} onClick={pick}><span class="ib-ic">{m.read ? '✉' : '✉'}</span><span class="ib-f">{m.from}</span><span class="ib-s">{m.subject}</span><span class="ib-d">{dateShort(m.date)}</span></button>;
  if (era === '90s') return <button data-nav class={cls} onClick={pick}><span class="ib-d">{dateShort(m.date).toUpperCase()}</span><span class="ib-f">{m.from.toUpperCase()}</span><span class="ib-s">{m.subject}</span></button>;
  return <button data-nav class={cls} onClick={pick}><span class="ib-d">{dateShort(m.date)}</span><span class="ib-f">{m.from}</span><span class="ib-s">{m.subject}</span></button>;
}

export function People() {
  const { world: w } = useStore();
  const tab = curTab('people', 'inbox');
  const era = peopleEra(w!);
  const C = ERA_COPY[era];
  const msgs = w!.messages.filter(m => tab === 'inbox' ? !m.resolved : m.resolved);
  const sel = w!.messages.find(m => m.id === ui.tab.peopleSel) ?? msgs[0];
  const t = w!.teams[w!.meta.userTeam];
  const c = w!.coaches[t.coach];
  const contacts: [string, string, () => void][] = [[w!.owner.name, 'Owner', () => openModal('ownerTalk')], [c.name, 'Head coach', () => openModal('coachTalk')], ['Director of scouting', 'Scouting', () => setUI({ screen: 'draft' })], ['Team physician', 'Medical', () => setUI({ screen: 'staff' })]];
  return <div class={`screen people-${era}`}>
    <div class="screen-h"><h2>People</h2><Tabs id="people" def="inbox" tabs={[{ id: 'inbox', label: `${C.list} (${w!.messages.filter(m => !m.resolved).length})` }, { id: 'done', label: C.done }]} /><div class="screen-meta">{C.meta}</div></div>
    <div class="people">
      <Panel class="inbox" title={tab === 'inbox' ? C.list : C.done}>
        {msgs.length ? msgs.map(m => <Row m={m} era={era} on={sel?.id === m.id} pick={() => { m.read = true; setUI({ tab: { ...ui.tab, peopleSel: m.id } }); commit(false); }} />) : <div class="muted">Nothing here.</div>}
      </Panel>
      <Panel class="fill reader">{sel ? <MessageView w={w!} m={sel} era={era} /> : <div class="muted">Pick a message.</div>}</Panel>
      <Panel title={C.people} class="contacts">
        {contacts.map(([n, r, go]) => <button data-nav class="ct" onClick={go}>{(era === '20s' || era === '00s') && <i class={`av ${era === '00s' ? 'on' : ''}`}>{initials(n)}</i>}<span><b>{n}</b><small>{r}</small></span></button>)}
      </Panel>
    </div>
  </div>;
}
