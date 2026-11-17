// Shared UI pieces and formatting helpers.
import type { ComponentChildren } from 'preact';
import type { Player, Team, World } from '../sim/types';
import { perGame } from '../sim/league';
import { hashStr } from '../sim/rng';
import { ui, setUI } from './store';

export const logoUrl = (t: Team | string) => `assets/logos/${typeof t === 'string' ? t : t.abbr}.png`;
export const ht = (inches: number) => `${Math.floor(inches / 12)}'${Math.round(inches % 12)}"`;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const dateLong = (d: string) => { const t = new Date(d + 'T12:00:00Z'); return `${DAYS[t.getUTCDay()]}, ${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}, ${t.getUTCFullYear()}`; };
export const dateShort = (d: string) => { const t = new Date(d + 'T12:00:00Z'); return `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}`; };
export const seasonLabel = (y: number) => `${y}–${String(y + 1).slice(2)}`;
export const lastName = (n: string) => n.split(' ').slice(-1)[0];
export const PHASE_LABEL: Record<string, string> = { preseason: 'Preseason', regular: 'Regular season', playoffs: 'Playoffs', draft: 'Draft', freeagency: 'Free agency', offseason: 'Offseason' };
export const f1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
export const pct = (n: number) => n ? n.toFixed(3).replace(/^0/, '') : '.000';

export function Logo({ t, size = 48, class: cls = '' }: { t: Team | string; size?: number; class?: string }) {
  return <img class={`logo ${cls}`} src={logoUrl(t)} style={{ width: size, height: size }} alt="" draggable={false} />;
}

export function Headshot({ p, size = 64, class: cls = '' }: { p: Player; size?: number; class?: string }) {
  if (p.headshot && p.nbaId) return <div class={`hs ${cls}`} style={{ width: size, height: size }}><img src={`assets/headshots/${p.nbaId}.webp`} alt="" draggable={false} /></div>;
  const ini = p.name.split(' ').map(s => s[0]).join('').slice(0, 2);
  return <div class={`hs hs-blank ${cls}`} style={{ width: size, height: size, fontSize: size * 0.34 }}><span>{ini}</span></div>;
}

export function Panel({ title, right, children, class: cls = '', style }: { title?: ComponentChildren; right?: ComponentChildren; children: ComponentChildren; class?: string; style?: any }) {
  return <section class={`panel ${cls}`} style={style}>
    {title && <header class="panel-h"><h3>{title}</h3>{right && <div class="panel-r">{right}</div>}</header>}
    <div class="panel-b">{children}</div>
  </section>;
}

export function Btn({ children, onClick, kind = '', disabled, auto, title, class: cls = '' }: { children: ComponentChildren; onClick?: () => void; kind?: string; disabled?: boolean; auto?: boolean; title?: string; class?: string }) {
  return <button data-nav class={`btn ${kind} ${cls}`} disabled={disabled} data-autofocus={auto ? '' : undefined} title={title} onClick={onClick}>{children}</button>;
}

export function Tabs({ id, tabs, def }: { id: string; tabs: { id: string; label: string }[]; def: string }) {
  const cur = ui.tab[id] ?? def;
  return <div class="tabs">{tabs.map(t => <button data-nav class={`tab ${cur === t.id ? 'on' : ''}`} onClick={() => setUI({ tab: { ...ui.tab, [id]: t.id } })}>{t.label}</button>)}</div>;
}
export const curTab = (id: string, def: string) => ui.tab[id] ?? def;

export function Chip({ children, kind = '' }: { children: ComponentChildren; kind?: string }) { return <span class={`chip ${kind}`}>{children}</span>; }

export function Meter({ v, max = 100, label }: { v: number; max?: number; label?: string }) {
  return <div class="meter" title={label}><i style={{ width: `${Math.max(0, Math.min(100, (v / max) * 100))}%` }} /></div>;
}

/** Rating value as the front office sees it: own players exactly (coach sees them daily), others as a scouting range. */
export function seenOvr(w: World, p: Player): { mid: number; lo: number; hi: number; exact: boolean } {
  if (p.team === w.meta.userTeam) return { mid: p.ovr, lo: p.ovr, hi: p.ovr, exact: true };
  if (p.scout?.now) return { ...p.scout.now, exact: false };
  const n = ((hashStr(w.meta.seed + p.id) % 9) - 4) * 0.8;
  const mid = Math.round(p.ovr + n);
  return { mid, lo: mid - 3, hi: mid + 3, exact: false };
}
export function OvrBadge({ w, p }: { w: World; p: Player }) {
  const s = seenOvr(w, p);
  return s.exact ? <span class="ovr">{s.mid}</span> : <span class="ovr est" title="Scouting estimate">{s.lo}–{s.hi}</span>;
}

export function statLine(p: Player, season: number, po = false) { return perGame(p, season, po); }

/** City, except where two clubs share one (New York). */
export const place = (t: Team) => t.city === 'New York' ? t.name : t.city;
export function teamRec(t: Team) { return `${t.w}–${t.l}`; }
export function teamFull(t: Team) { return `${t.city} ${t.name}`; }

export function injuryChip(p: Player) {
  if (!p.injury || p.injury.daysLeft <= 0) return null;
  return <Chip kind="bad">{p.injury.type} · {p.injury.daysLeft}d</Chip>;
}

export function Empty({ children }: { children: ComponentChildren }) { return <div class="empty">{children}</div>; }
