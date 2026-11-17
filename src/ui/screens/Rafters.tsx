// Look up (Space): the rafters, as in the approved mockup. Banners hang from the steel; the scoreboard below
// keeps the decisions waiting in view.
import { useStore, setUI } from '../store';
import { seasonLabel } from '../util';
import type { World } from '../../sim/types';

// Real championships before the save starts (titles only). Everything after October 1976 is earned in this save.
const PRE: Record<string, { y: number; where: string; aba?: boolean }[]> = {
  BOS: [1957, 1959, 1960, 1961, 1962, 1963, 1964, 1965, 1966, 1968, 1969, 1974, 1976].map(y => ({ y, where: 'Boston' })),
  LAL: [...[1949, 1950, 1952, 1953, 1954].map(y => ({ y, where: 'Minneapolis' })), { y: 1972, where: 'Los Angeles' }],
  PHI: [{ y: 1955, where: 'Syracuse' }, { y: 1967, where: 'Philadelphia' }],
  GSW: [{ y: 1947, where: 'Philadelphia' }, { y: 1956, where: 'Philadelphia' }, { y: 1975, where: 'Golden State' }],
  NYK: [{ y: 1970, where: 'New York' }, { y: 1973, where: 'New York' }],
  MIL: [{ y: 1971, where: 'Milwaukee' }],
  ATL: [{ y: 1958, where: 'St. Louis' }],
  KCK: [{ y: 1951, where: 'Rochester' }],
  NYN: [{ y: 1974, where: 'New York', aba: true }, { y: 1976, where: 'New York', aba: true }],
  IND: [{ y: 1970, where: 'Indiana', aba: true }, { y: 1972, where: 'Indiana', aba: true }, { y: 1973, where: 'Indiana', aba: true }],
};

export function RaftersBg() {
  const lines: any[] = [];
  for (let x = -200; x < 1800; x += 120) {
    lines.push(<line x1={x} y1="70" x2={x + 120} y2="430" stroke="#2a1d18" stroke-width="5" />, <line x1={x + 120} y1="70" x2={x} y2="430" stroke="#2a1d18" stroke-width="5" />);
  }
  return <svg class="scene" width="1600" height="900" viewBox="0 0 1600 900" aria-hidden="true">
    <defs>
      <linearGradient id="rf-ceil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d0806" /><stop offset=".55" stop-color="#221510" /><stop offset="1" stop-color="#2e1d14" /></linearGradient>
      <linearGradient id="rf-beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd99a" stop-opacity=".22" /><stop offset="1" stop-color="#000" stop-opacity="0" /></linearGradient>
    </defs>
    <rect width="1600" height="900" fill="url(#rf-ceil)" />
    <g opacity=".8">{lines}<rect x="0" y="70" width="1600" height="16" fill="#2a1d18" /><rect x="0" y="426" width="1600" height="14" fill="#2a1d18" /></g>
    {[420, 780, 1140, 1480].map(x => <><polygon points={`${x - 14},84 ${x + 14},84 ${x + 150},900 ${x - 150},900`} fill="url(#rf-beam)" /><circle cx={x} cy="88" r="12" fill="#ffe2a8" /></>)}
  </svg>;
}

function plaques(w: World) {
  const t = w.teams[w.meta.userTeam];
  const pre = PRE[t.id] ?? [];
  const mine = t.history.filter(h => h.result === 'Champion').length;
  const seasons = t.history.length + 1;
  const titles = pre.filter(b => !b.aba).length + mine;
  const places = [...new Set(pre.filter(b => !b.aba).map(b => b.where))].map(c => `${pre.filter(b => !b.aba && b.where === c).length} in ${c}`).join(' · ');
  const aba = pre.filter(b => b.aba).length;
  return [
    { k: 'Your tenure', big: `Season ${seasons}`, small: `${t.w}–${t.l} so far · ${mine} title${mine === 1 ? '' : 's'}` },
    { k: 'Franchise', big: `${titles} NBA title${titles === 1 ? '' : 's'}`, small: [places, aba ? `${aba} ABA` : '', mine ? `${mine} on your watch` : ''].filter(Boolean).join(' · ') || 'No banners yet — be the first' },
    { k: 'Next milestone', big: mine ? 'Another banner' : 'Your first banner', small: `A ${w.season.year + 1} title would hang here` },
  ];
}

export function Rafters() {
  const { world: w } = useStore();
  const t = w!.teams[w!.meta.userTeam];
  const pre = PRE[t.id] ?? [];
  const mine = t.history.filter(h => h.result === 'Champion').map(h => ({ y: h.season + 1, where: t.city, save: true }));
  const banners = [...pre.map(b => ({ ...b, save: false })), ...mine];
  const ghosts = Math.max(1, Math.min(3, 9 - banners.length));
  const mvps = Object.values(w!.players).flatMap(p => (p.awards ?? []).filter(a => a.award === 'MVP' && (p.stats ?? []).some(s => s.season === a.season && s.team === t.id && !s.playoffs)).map(a => ({ y: a.season + 1, name: p.name })));
  const waiting = w!.messages.filter(m => !m.resolved).length;
  return <div class="rafters2">
    <div class="rf-head"><h2>The rafters</h2><span>Before 1976: real {t.name} history · After: won in this save</span></div>
    <div class={`rf-banners ${banners.length > 9 ? 'many' : ''}`}>
      {banners.map(b => <div class={`rf-ban ${b.save ? 'save' : ''}`}><i class="wire" />
        <div class="rf-face"><span class="rf-l">{(b as any).aba ? 'ABA' : 'World'}<br />Champions</span><i class="rf-rule" /><b>{b.y}</b><span class="rf-w">{b.where}</span></div>
        {b.save && <em class="rf-this">This save</em>}</div>)}
      {Array.from({ length: ghosts }, () => <div class="rf-ban ghost"><i class="wire" /><div class="rf-face">Your {mine.length ? 'next' : 'first'} banner</div></div>)}
    </div>
    <div class="rf-jerseys">
      {mvps.slice(0, 4).map(m => <figure class="rf-j mvp"><i class="wire" /><div class="rf-mvp"><b>MVP</b><span>{m.y}</span></div><figcaption>{m.name}</figcaption></figure>)}
      {Array.from({ length: Math.max(0, 4 - mvps.length) }, () => <figure class="rf-j"><i class="wire" />
        <svg width="58" height="66" viewBox="0 0 86 96" aria-hidden="true"><path d="M22 4 Q43 22 64 4 L84 18 L76 40 L70 38 L70 94 L16 94 L16 38 L10 40 L2 18Z" fill="none" stroke="rgba(246,236,212,.4)" stroke-width="2" stroke-dasharray="5 4" /><text x="43" y="70" text-anchor="middle" fill="rgba(246,236,212,.55)" style={{ font: '700 22px Barlow Condensed' }}>?</text></svg></figure>)}
      <span class="rf-jcap">{mvps.length ? 'MVPs of this franchise, this save' : 'No numbers retired yet'}</span>
    </div>
    <div class="rf-plaques">{plaques(w!).map(p => <div class="plaque"><span>{p.k}</span><b>{p.big}</b><em>{p.small}</em></div>)}</div>
    <div class="rf-board">
      <div><span class="sb-l">Scoreboard · below</span><div class="rf-wait">{waiting} decision{waiting === 1 ? '' : 's'} waiting</div></div>
      <button data-nav data-autofocus class="btn prim rf-back" onClick={() => setUI({ rafters: false })}><span class="key dark">SPACE</span>Back to the floor</button>
    </div>
    {t.history.length > 0 && <div class="rf-seasons">{t.history.map(h => <span>{seasonLabel(h.season)} <b>{h.w}–{h.l}</b> {h.result}</span>)}</div>}
  </div>;
}
