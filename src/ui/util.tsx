// Shared UI pieces and formatting helpers.
import type { ComponentChildren } from 'preact';
import type { Player, Team, World } from '../sim/types';
import { perGame } from '../sim/league';
import { hashStr } from '../sim/rng';
import { believedOvr } from '../sim/trade';
import { sdFor } from '../sim/needs';
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
  return <div class="tabs">{tabs.map(t => <button data-nav class={`tab ${cur === t.id ? 'on' : ''}`} onClick={() => setUI({ tab: { ...ui.tab, [id]: t.id } })}><span>{t.label}</span></button>)}</div>;
}
export const curTab = (id: string, def: string) => ui.tab[id] ?? def;

export function Chip({ children, kind = '' }: { children: ComponentChildren; kind?: string }) { return <span class={`chip ${kind}`}>{children}</span>; }

export function Meter({ v, max = 100, label }: { v: number; max?: number; label?: string }) {
  return <div class="meter" title={label}><i style={{ width: `${Math.max(0, Math.min(100, (v / max) * 100))}%` }} /></div>;
}

/** Rating value as the front office sees it: own players exactly (coach sees them daily), others as a scouting range. */
export function seenOvr(w: World, p: Player): { mid: number; lo: number; hi: number; exact: boolean } {
  if (p.team === w.meta.userTeam) return { mid: p.ovr, lo: p.ovr, hi: p.ovr, exact: true };
  if (p.scout?.now && !p.team) return { ...p.scout.now, exact: false };
  const mid = Math.round(believedOvr(w, p, w.meta.userTeam));
  const half = Math.max(2, Math.round(sdFor(w, p) * 1.3));
  return { mid, lo: mid - half, hi: mid + half, exact: false };
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

// ------------------------------------------------------------------ player tile (whole tile opens the player page)
export function PlayerTile({ p, size = 40, sub, onClick, class: cls = '', right }: { p: Player; size?: number; sub?: ComponentChildren; onClick?: () => void; class?: string; right?: ComponentChildren }) {
  return <button data-nav class={`ptile ${cls}`} onClick={(e: any) => { e.stopPropagation(); onClick ? onClick() : openPlayer(p.id); }}>
    <Headshot p={p} size={size} />
    <span class="ptile-t"><b>{p.name}</b>{sub !== undefined ? <small>{sub}</small> : <small>{p.pos} · {p.age ?? '—'} yrs</small>}</span>
    {right}
  </button>;
}
export function openPlayer(id: string) { ui.modal = { kind: 'player', arg: { id } }; setUI({}); }

/** Condition: how fresh a player's legs are today (back-to-backs and heavy minutes drain it). */
export function condWord(c: number) { return c >= 88 ? 'Fresh' : c >= 72 ? 'OK' : c >= 55 ? 'Tired' : 'Exhausted'; }
export function CondBar({ p }: { p: Player }) {
  const c = Math.round(p.cond ?? 100);
  return <span class={`cond c${c >= 88 ? 4 : c >= 72 ? 3 : c >= 55 ? 2 : 1}`} title={`Condition ${c}`}><i style={{ width: `${c}%` }} /><em>{condWord(c)}</em></span>;
}

// ------------------------------------------------------------------ sortable table
export interface Col<T> { key: string; label: string; get?: (r: T) => number | string; render: (r: T) => ComponentChildren; cls?: string; title?: string; desc?: boolean }
export function SortTable<T>({ id, rows, cols, onRow, rowCls, def }: { id: string; rows: T[]; cols: Col<T>[]; onRow?: (r: T) => void; rowCls?: (r: T) => string; def?: string }) {
  const state = ui.tab[`sort:${id}`] ?? def ?? '';
  const [sk, sd] = state.split(':');
  const col = cols.find(c => c.key === sk && c.get);
  const sorted = col ? [...rows].sort((a, b) => { const x = col.get!(a), y = col.get!(b); const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)); return sd === 'd' ? -r : r; }) : rows;
  const click = (c: Col<T>) => { if (!c.get) return; const dir = sk === c.key ? (sd === 'd' ? 'a' : 'd') : (c.desc === false ? 'a' : 'd'); setUI({ tab: { ...ui.tab, [`sort:${id}`]: `${c.key}:${dir}` } }); };
  return <table class="tbl rows sortable"><thead><tr>{cols.map(c => <th class={`${c.cls ?? ''} ${c.get ? 'can' : ''} ${sk === c.key ? 'on' : ''}`} title={c.title}>
    {c.get ? <button data-nav class="th-b" onClick={() => click(c)}>{c.label}{sk === c.key && <span class="arrow">{sd === 'd' ? '▼' : '▲'}</span>}</button> : c.label}</th>)}</tr></thead>
    <tbody>{sorted.map(r => <tr class={rowCls?.(r) ?? ''} onClick={() => onRow?.(r)}>{cols.map(c => <td class={c.cls ?? ''}>{c.render(r)}</td>)}</tr>)}</tbody></table>;
}
