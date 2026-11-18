// Shell chrome, following the approved 1976 Courtside mockup: broadcast top bar with the franchise clock gauge and
// ADVANCE, the numbered section rail, and the Tab "most urgent" slot with the era device (phone slip).
import { useStore, go, SECTIONS, openModal, setUI, Screen } from './store';
import { Logo, MONTHS, DAYS, PHASE_LABEL, seasonLabel } from './util';
import { standings } from '../sim/league';
import { mostUrgent, nextStop } from './actions';
import { openRequest } from '../sim/needs';
import type { ClockState, World } from '../sim/types';

export function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => { /* not allowed here */ });
}
export const CLOCKS: ClockState[] = ['Rebuilding', 'Building', 'Contending', 'Win Now'];

export const ARENAS: Record<string, string> = {
  ATL: 'The Omni', BOS: 'Boston Garden', BUF: 'Buffalo Memorial Auditorium', CHI: 'Chicago Stadium', CLE: 'Richfield Coliseum', DEN: 'McNichols Arena',
  DET: 'Cobo Arena', GSW: 'Oakland Coliseum Arena', HOU: 'The Summit', IND: 'Market Square Arena', KCK: 'Kemper Arena', LAL: 'The Forum',
  MIL: 'MECCA Arena', NOJ: 'Louisiana Superdome', NYK: 'Madison Square Garden', NYN: 'Nassau Coliseum', NJN: 'Rutgers Athletic Center', PHI: 'The Spectrum',
  PHX: 'Veterans Memorial Coliseum', POR: 'Memorial Coliseum', SAS: 'HemisFair Arena', SEA: 'Seattle Center Coliseum', WSB: 'Capital Centre',
};

export function divisionPlace(w: World) {
  const t = w.teams[w.meta.userTeam];
  const div = standings(w).filter(x => x.div === t.div);
  const rank = div.findIndex(x => x.id === t.id) + 1;
  return { rank, ord: ['', '1st', '2nd', '3rd', '4th', '5th', '6th'][rank] ?? `${rank}th`, div };
}

function ClockGauge({ c }: { c: ClockState }) {
  const idx = CLOCKS.indexOf(c);
  const cx = 34, cy = 34, r = 26;
  const arc = (a0: number, a1: number) => {
    const p = (a: number) => [cx + r * Math.cos(a * Math.PI / 180), cy - r * Math.sin(a * Math.PI / 180)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  };
  const ang = 180 - 45 * idx - 22.5;
  const nx = cx + (r - 8) * Math.cos(ang * Math.PI / 180), ny = cy - (r - 8) * Math.sin(ang * Math.PI / 180);
  return <svg width="68" height="40" viewBox="0 0 68 40" aria-hidden="true">
    {[0, 1, 2, 3].map(i => <path d={arc(180 - 45 * i - 3, 180 - 45 * (i + 1) + 3)} fill="none" class={`cg s${i} ${i === idx ? 'on' : ''}`} stroke-width={i === idx ? 9 : 6} />)}
    <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="var(--ink)" stroke-width="2.5" stroke-linecap="round" /><circle cx={cx} cy={cy} r="4" fill="var(--ink)" />
  </svg>;
}

export function TopBar() {
  const { world: w } = useStore();
  const t = w!.teams[w!.meta.userTeam];
  const S = w!.season;
  const { ord } = divisionPlace(w!);
  const d = new Date(S.day + 'T12:00:00Z');
  const ns = nextStop(w!);
  return <header class="topbar">
    <Logo t={t} size={58} class="tb-logo" />
    <div class="tb-name">
      <div class="tb-full">{t.city} {t.name}</div>
      <div class="tb-sub">{seasonLabel(S.year)} · {PHASE_LABEL[S.phase]} · {t.arena ?? ARENAS[t.abbr] ?? ARENAS[t.id] ?? ''}{w!.meta.mode === 'sandbox' ? ' · Sandbox' : ''}</div>
    </div>
    <div class="tb-chips">
      <div class="tb-chip"><b>{t.w}–{t.l}</b><span>Record</span></div>
      <div class="tb-chip"><b>{t.w + t.l ? ord : '—'}</b><span>{t.div}</span></div>
      <div class="tb-chip"><b>{MONTHS[d.getUTCMonth()]} {d.getUTCDate()}</b><span>{DAYS[d.getUTCDay()].slice(0, 3)} · {d.getUTCFullYear()}</span></div>
    </div>
    <button data-nav class="tb-clock" onClick={() => openModal('clock')} title="Franchise clock">
      <ClockGauge c={w!.clock} />
      <div><b>{w!.clock}</b><span>Franchise clock</span></div>
    </button>
    <div class="tb-next">
      <div><span>Next stop</span><b>{ns.label}</b></div>
      <button data-nav class="advance" disabled={!ns.run} onClick={() => ns.run?.()}>{ns.verb}<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2l6 6-6 6M8 2l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" /></svg></button>
    </div>
    <button data-nav class="tb-fs" title="Full screen (F)" onClick={toggleFullscreen}>{document.fullscreenElement ? '⤡' : '⤢'}</button>
  </header>;
}

function badges(w: World): Partial<Record<Screen, number | string>> {
  const open = w.messages.filter(m => !m.resolved);
  const by = (f: (m: typeof open[number]) => boolean) => open.filter(f).length || undefined;
  return {
    staff: (openRequest(w) ? 1 : 0) + (by(m => m.role === 'Medical' && !m.read) ?? 0) || undefined,
    office: by(m => m.tag === 'Trade' || m.tag === 'Agent'),
    draft: w.season.phase === 'draft' ? 'LIVE' : by(m => m.tag === 'Scouting' && !m.read),
    people: by(m => !m.read),
  };
}

export function NavRail() {
  const { ui, world: w } = useStore();
  const b = badges(w!);
  return <nav class="rail">
    {SECTIONS.map(s => <button data-nav class={`rail-i ${ui.screen === s.id && !ui.rafters ? 'on' : ''}`} onClick={() => go(s.id)}>
      <span class="rail-k">{s.key}</span><span class="rail-l">{s.label}</span>
      {b[s.id] && <span class={`rail-badge ${typeof b[s.id] === 'string' ? 'live' : ''}`}>{b[s.id]}</span>}
    </button>)}
  </nav>;
}

/** Tab: the fastest route to the most urgent person. In 1976 that's a stack of pink phone slips. */
export function UrgentSlot() {
  const { world: w } = useStore();
  const m = mostUrgent(w!);
  const rest = w!.messages.filter(x => !x.resolved && x !== m);
  const open = () => { if (m) { m.read = true; openModal('message', { id: m.id }); } else go('people'); };
  const t = new Date((m?.date ?? w!.season.day) + 'T12:00:00Z');
  return <section class="urgent">
    <div class="urg-h"><span class="key">TAB</span><span>Most urgent</span>{rest.length > 0 && <em>+{rest.length} waiting</em>}</div>
    <button data-nav class={`slips ${m && m.urgent >= 2 ? 'hot' : ''}`} onClick={open}>
      <i class="slip-under a" /><i class="slip-under b" />
      <div class="slip">
        <div class="slip-h">While You Were Out</div>
        {m ? <>
          <div class="slip-row"><span>From: {m.from.length > 22 ? m.from.slice(0, 21) + '…' : m.from}</span><span>{MONTHS[t.getUTCMonth()]} {t.getUTCDate()}</span></div>
          <div class="slip-checks"><i class={m.urgent >= 2 ? 'ck' : ''}>Urgent</i><i class={m.actions?.some(a => a.cmd !== 'dismiss') ? 'ck' : ''}>Please call</i></div>
          <div class="slip-msg">{m.subject}</div>
        </> : <div class="slip-msg quiet">No calls. Enjoy the quiet.</div>}
      </div>
    </button>
    <button data-nav class="btn big urg-call" onClick={open}>{m ? `Call ${shortName(m.from)} back` : 'Open the desk'}</button>
    {rest.length > 0 && <div class="urg-also">Also waiting: {[...new Set(rest.slice(0, 3).map(x => shortName(x.from)))].join(' · ')}</div>}
  </section>;
}
export function shortName(n: string) {
  if (/^Agent for /.test(n)) return `${n.replace('Agent for ', '').split(' ').slice(-1)[0]}'s agent`;
  if (/ownership group|League office|Director|physician/i.test(n)) return n.replace(/^Team /, '').replace(/^Director of /, '');
  const parts = n.split(' ');
  return parts.length > 1 ? `${parts.slice(-1)[0] === 'Jr.' ? parts.slice(-2).join(' ') : parts.slice(-1)[0]}` : n;
}
export function setRafters(on: boolean) { setUI({ rafters: on }); }
