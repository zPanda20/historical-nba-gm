import { useStore, go, SECTIONS, openModal, setUI } from './store';
import { Logo, dateLong, PHASE_LABEL, seasonLabel } from './util';
import { standings } from '../sim/league';
import { mostUrgent } from './actions';
import type { ClockState } from '../sim/types';

export function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => { /* not allowed here */ });
}
export const CLOCKS: ClockState[] = ['Rebuilding', 'Building', 'Contending', 'Win Now'];

export function TopBar() {
  const { world: w } = useStore();
  const t = w!.teams[w!.meta.userTeam];
  const div = standings(w!).filter(x => x.div === t.div);
  const rank = div.findIndex(x => x.id === t.id) + 1;
  const gb = div.length ? ((div[0].w - t.w) + (t.l - div[0].l)) / 2 : 0;
  const ord = ['', '1st', '2nd', '3rd', '4th', '5th', '6th'][rank] ?? `${rank}th`;
  const S = w!.season;
  return <header class="topbar">
    <div class="tb-team">
      <Logo t={t} size={64} class="tb-logo" />
      <div>
        <div class="tb-city">{t.city}</div>
        <div class="tb-name">{t.name}</div>
      </div>
      <div class="tb-rec">
        <div class="tb-wl">{t.w}<span>–</span>{t.l}</div>
        <div class="tb-st">{t.w + t.l ? `${ord} ${t.div}${gb > 0 ? ` · ${gb} GB` : ''}` : `${t.div} Division`}</div>
      </div>
    </div>
    <div class="tb-date">
      <div class="tb-day">{dateLong(S.day)}</div>
      <div class="tb-phase">{seasonLabel(S.year)} · {PHASE_LABEL[S.phase]}{w!.meta.mode === 'sandbox' ? ' · Sandbox' : ''}</div>
    </div>
    <button data-nav class="tb-fs" title="Full screen (F)" onClick={toggleFullscreen}>{document.fullscreenElement ? '⤡' : '⤢'}</button>
    <button data-nav class="tb-clock" onClick={() => openModal('clock')} title="Franchise clock">
      <div class="tb-clock-l">Franchise clock</div>
      <div class="tb-clock-s">{CLOCKS.map(c => <span class={c === w!.clock ? 'on' : ''}>{c}</span>)}</div>
    </button>
  </header>;
}

export function NavRail() {
  const { ui, world: w } = useStore();
  const unread = w!.messages.filter(m => !m.resolved && !m.read).length;
  const draftLive = w!.season.phase === 'draft';
  return <nav class="rail">
    {SECTIONS.map(s => <button data-nav class={`rail-i ${ui.screen === s.id ? 'on' : ''}`} onClick={() => go(s.id)}>
      <span class="rail-k">{s.key}</span><span class="rail-l">{s.label}</span>
      {s.id === 'people' && unread > 0 && <span class="rail-badge">{unread}</span>}
      {s.id === 'draft' && draftLive && <span class="rail-badge live">LIVE</span>}
    </button>)}
    <button data-nav class="rail-rafters" onClick={() => setUI({ rafters: true })}>Look up to the rafters</button>
  </nav>;
}

/** 1976 GM device: the pink "While You Were Out" phone slip. Always the fastest route to the most urgent person. */
export function DeviceSlot() {
  const { world: w } = useStore();
  const m = mostUrgent(w!);
  const more = w!.messages.filter(x => !x.resolved).length - (m ? 1 : 0);
  return <button data-nav class={`slip ${m && m.urgent >= 2 ? 'hot' : ''} ${m ? '' : 'quiet'}`} onClick={() => m ? (m.read = true, openModal('message', { id: m.id })) : go('people')}>
    <div class="slip-h">While You Were Out</div>
    {m ? <>
      <div class="slip-row"><span>For</span><b>GM</b><span>Date</span><b>{m.date.slice(5).replace('-', '/')}</b></div>
      <div class="slip-from">{m.from}</div>
      <div class="slip-checks">
        <i class={m.urgent >= 2 ? 'ck' : ''}>Urgent</i><i class={m.actions?.length ? 'ck' : ''}>Please call</i><i class={m.urgent < 2 ? 'ck' : ''}>FYI</i>
      </div>
      <div class="slip-msg">{m.subject}</div>
      {more > 0 && <div class="slip-more">+{more} more on the desk</div>}
    </> : <div class="slip-msg quiet">No calls. Enjoy the quiet.</div>}
  </button>;
}
