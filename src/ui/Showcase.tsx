// Big moments: the championship, the awards night, the draft, and what changed around the league over the summer.
// In autopilot they play for a few seconds and the season keeps going; otherwise they wait for you.
import { useEffect, useState } from 'preact/hooks';
import type { Player, World } from '../sim/types';
import { perGame } from '../sim/league';
import { getWorld, ui, useStore, setUI, hooks } from './store';
import { Headshot, Logo, seasonLabel, place } from './util';

export interface Show { kind: 'champion' | 'awards' | 'draft' | 'offseason'; year: number; auto?: boolean }
const DUR: Record<Show['kind'], number> = { champion: 7000, awards: 7500, draft: 6500, offseason: 6500 };

/** Queue whatever has happened since the last look. Markers live on the save so nothing replays after a reload. */
export function checkShowcases(w: World | null) {
  if (!w || ui.mode !== 'game') return;
  const sh = ((w as any).shown ??= { champ: w.season.champion ? w.season.year : 0, draft: w.season.draft?.done ? w.season.draft.year : 0, season: w.season.year });
  const auto = !!ui.busy?.startsWith('Autopilot');
  const q: Show[] = ((ui as any).shows ??= []);
  const S = w.season;
  if (S.champion && sh.champ !== S.year) { sh.champ = S.year; q.push({ kind: 'champion', year: S.year, auto }, { kind: 'awards', year: S.year, auto }); }
  if (S.draft?.done && sh.draft !== S.draft.year) { sh.draft = S.draft.year; q.push({ kind: 'draft', year: S.draft.year, auto }); }
  if (sh.season !== S.year && (S.phase === 'preseason' || S.phase === 'regular')) {
    sh.season = S.year;
    if (offseasonItems(w).length) q.push({ kind: 'offseason', year: S.year, auto });
  }
}
export function markShownNow(w: World) {
  (w as any).shown = { champ: w.season.champion ? w.season.year : 0, draft: w.season.draft?.done ? w.season.draft.year : 0, season: w.season.year };
}
export const showing = () => ((ui as any).shows ?? [])[0] as Show | undefined;
export function nextShow() { const q: Show[] = (ui as any).shows ?? []; q.shift(); setUI({}); }

function offseasonItems(w: World) {
  return (w.franchiseEvents ?? []).filter((e: any) => e.season === w.season.year && e.done && e.note && e.team)
    .map((e: any) => ({ team: e.team, note: e.note, type: e.type }))
    .concat(Object.values(w.teams).filter(t => t.founded === w.season.year).map(t => ({ team: t.id, note: `Expansion: the ${t.city} ${t.name} begin play.`, type: 'expansion' })));
}

export function ShowcaseLayer() {
  const { world: w, ui: u } = useStore();
  const s = showing();
  const [t0, setT0] = useState(0);
  useEffect(() => {
    if (!s) return;
    setT0(Date.now());
    if (!s.auto && !u.busy) return;
    const h = setTimeout(nextShow, DUR[s.kind]);
    return () => clearTimeout(h);
  }, [s]);
  useEffect(() => {
    if (!s) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ' || (e.key === 'Escape' && !u.busy)) { e.preventDefault(); e.stopPropagation(); nextShow(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [s]);
  if (!s || !w) return null;
  void t0;
  return <div class={`show show-${s.kind} ${s.auto ? 'auto' : ''}`} onClick={nextShow}>
    {s.kind === 'champion' && <Champion w={w} year={s.year} />}
    {s.kind === 'awards' && <Awards w={w} year={s.year} />}
    {s.kind === 'draft' && (s.auto ? <DraftTop5 w={w} /> : <div class="show-card wide" onClick={(e: any) => e.stopPropagation()}><DraftRecap w={w} /><div class="show-foot"><button data-nav class="btn big" data-autofocus onClick={nextShow}>Continue to free agency</button></div></div>)}
    {s.kind === 'offseason' && <Offseason w={w} />}
    {s.auto && <div class="show-timer" style={{ animationDuration: `${DUR[s.kind]}ms` }} />}
    {!s.auto && s.kind !== 'draft' && <div class="show-hint">Press Enter to continue</div>}
  </div>;
}

// ------------------------------------------------------------------ championship
function Champion({ w, year }: { w: World; year: number }) {
  const S = w.season;
  const champ = S.champion ?? w.pastSeasons.find(p => p.year === year)?.champion;
  if (!champ) return null;
  const t = w.teams[champ];
  const fin = S.playoffs?.series.find(x => x.round === 4);
  const runner = fin ? (fin.winner === fin.hi ? fin.lo : fin.hi) : null;
  const R = runner ? w.teams[runner] : null;
  const mine = champ === w.meta.userTeam;
  const fmvp = S.awards?.['Finals MVP'] ? w.players[S.awards['Finals MVP']] : null;
  const titles = w.pastSeasons.filter(p => p.champion === champ).length;
  const conf = Array.from({ length: mine ? 90 : 46 }, (_, i) => i);
  const col = (i: number) => t.colors[i % Math.max(1, t.colors.length)] ?? '#f2b632';
  return <div class={`champ ${mine ? 'mine' : ''}`} style={{ '--c1': t.colors[0], '--c2': t.colors[1] ?? '#f2b632' } as any}>
    <div class="champ-rays" />
    <div class="champ-confetti">{conf.map(i => <i style={{ left: `${(i * 37) % 100}%`, background: col(i), animationDelay: `${(i % 13) * 0.13 + 0.6}s`, animationDuration: `${2.6 + (i % 7) * 0.35}s`, transform: `rotate(${i * 29}deg)` }} />)}</div>
    <div class="champ-stage">
      <img class="champ-trophy" src="assets/trophy.png" alt="Larry O'Brien Trophy" draggable={false} />
      <div class="champ-copy">
        <div class="champ-year">{seasonLabel(year)} NBA Champions</div>
        <div class="champ-team"><Logo t={t} size={mine ? 120 : 96} /><div><b>{t.city}</b><strong>{t.name}</strong></div></div>
        {fin && R && <div class="champ-res">Beat the {R.city} {R.name} {Math.max(fin.wHi, fin.wLo)}–{Math.min(fin.wHi, fin.wLo)} in the Finals</div>}
        {fmvp && <div class="champ-mvp"><Headshot p={fmvp} size={48} /><div><small>Finals MVP</small><b>{fmvp.name}</b></div></div>}
        <div class="champ-n">{titles === 1 ? 'The franchise’s first title in this universe' : `Title No. ${titles} in this universe`}</div>
        {mine && <div class="champ-quote">“{w.owner.name}: This is what we built it for. Enjoy the parade — then get back to work.”</div>}
      </div>
    </div>
  </div>;
}

// ------------------------------------------------------------------ awards
const AW_ORDER: [string, string][] = [['MVP', 'Most Valuable Player'], ['Finals MVP', 'Finals MVP'], ['ROY', 'Rookie of the Year'], ['DPOY', 'Defensive Player'], ['6MOY', 'Sixth Man'], ['MIP', 'Most Improved']];
function line(p: Player, y: number) { const s = perGame(p, y); return s.g ? `${s.ppg.toFixed(1)} pts · ${s.rpg.toFixed(1)} reb · ${s.apg.toFixed(1)} ast` : ''; }
function Awards({ w, year }: { w: World; year: number }) {
  const aw = w.season.year === year ? w.season.awards ?? {} : w.pastSeasons.find(p => p.year === year)?.awards ?? {};
  const team = (id: string) => w.players[id]?.team ? w.teams[w.players[id].team!] : null;
  const first: string[] = aw['All-NBA 1st'] ?? [];
  return <div class="show-card awards" onClick={(e: any) => e.stopPropagation()}>
    <div class="aw-h"><span>{seasonLabel(year)}</span><h2>Awards night</h2><small>Chosen from this universe's games, not history</small></div>
    <div class="aw-grid">{AW_ORDER.filter(([k]) => aw[k]).map(([k, label], i) => { const p = w.players[aw[k]]; if (!p) return null; const t = team(p.id);
      return <div class={`aw-c ${i === 0 ? 'mvp' : ''} ${p.team === w.meta.userTeam ? 'me' : ''}`} style={{ animationDelay: `${0.15 + i * 0.12}s` }}>
        <small>{label}</small><Headshot p={p} size={i === 0 ? 92 : 64} /><b>{p.name}</b><span>{t ? <><Logo t={t} size={18} /> {t.abbr}</> : ''}</span><em>{k === 'Finals MVP' ? '' : line(p, year)}</em></div>; })}
      {aw.COY && <div class="aw-c" style={{ animationDelay: `${0.15 + AW_ORDER.length * 0.12}s` }}><small>Coach of the Year</small><div class="hs hs-blank" style={{ width: 64, height: 64, fontSize: 22 }}><span>{String(aw.COY).split(' ').map((x: string) => x[0]).join('')}</span></div><b>{aw.COY}</b><span>{aw.COYteam ? <><Logo t={w.teams[aw.COYteam]} size={18} /> {w.teams[aw.COYteam].abbr}</> : ''}</span><em /></div>}
    </div>
    {first.length > 0 && <div class="aw-team"><span>All-NBA First Team</span>{first.map(id => w.players[id] && <b class={w.players[id].team === w.meta.userTeam ? 'me' : ''}>{w.players[id].name}</b>)}</div>}
  </div>;
}

// ------------------------------------------------------------------ draft
function DraftTop5({ w }: { w: World }) {
  const D = w.season.draft!;
  return <div class="show-card draft5" onClick={(e: any) => e.stopPropagation()}>
    <div class="aw-h"><span>{D.year} NBA Draft</span><h2>The top five</h2><small>{D.lottery?.text ?? ''}</small></div>
    <div class="d5">{D.order.slice(0, 5).map((o, i) => { const p = o.player ? w.players[o.player] : null; const t = w.teams[o.team];
      return <div class={`d5-c ${o.team === w.meta.userTeam ? 'me' : ''}`} style={{ animationDelay: `${0.2 + i * 0.35}s` }}>
        <div class="d5-n">{o.pick}</div><Logo t={t} size={58} /><b>{p?.name ?? '—'}</b><small>{p ? `${p.pos} · ${p.college ?? '—'}` : ''}</small>
        {o.jump ? <em>{o.jump > 0 ? `Jumped ${o.jump}` : `Fell ${-o.jump}`} in the lottery</em> : <em />}</div>; })}</div>
  </div>;
}

export function DraftRecap({ w }: { w: World }) {
  const D = w.season.draft;
  if (!D) return null;
  const u = w.meta.userTeam;
  const r1 = D.order.filter(o => o.round === 1 && o.player);
  const ours = D.order.filter(o => o.team === u && o.player);
  const lot = (D.lottery?.results ?? []).filter(r => r.pre !== r.pick).slice(0, 4);
  return <div class="recap">
    <div class="recap-h"><div><span>{D.year} NBA Draft</span><h2>Draft recap</h2></div><p>{D.lottery?.text}</p></div>
    <div class="recap-b">
      <div class="recap-r1"><h4>First round</h4>
        <div class="recap-list">{r1.map(o => { const p = w.players[o.player!]; const t = w.teams[o.team];
          return <button data-nav class={`rc-row ${o.team === u ? 'me' : ''}`} onClick={() => setUI({ modal: { kind: 'player', arg: { id: p.id } } })}>
            <span class="rc-n">{o.pick}</span><Logo t={t} size={24} /><span class="rc-t">{t.abbr}</span><b>{p.name}</b><small>{p.pos} · {p.college ?? '—'}</small>{o.jump ? <em class={o.jump > 0 ? 'up' : 'down'}>{o.jump > 0 ? '▲' : '▼'}{Math.abs(o.jump)}</em> : <em />}</button>; })}</div>
      </div>
      <div class="recap-side">
        <h4>Our class</h4>
        {ours.length ? ours.map(o => { const p = w.players[o.player!];
          return <button data-nav class="rc-mine" onClick={() => setUI({ modal: { kind: 'player', arg: { id: p.id } } })}><Headshot p={p} size={52} />
            <div><small>Round {o.round} · Pick {o.pick}</small><b>{p.name}</b><span>{p.pos} · {p.age} yrs · {p.college ?? '—'}</span>
              {p.scout?.now && <span class="rc-sc">Our read: ready {p.scout.now.lo}–{p.scout.now.hi} · ceiling {p.scout.pot.lo}–{p.scout.pot.hi}</span>}
              <span class="rc-st">{o.round <= 2 ? 'Signed to a rookie deal' : 'Rights held — sign him in free agency'}</span></div></button>; })
          : <div class="muted">We had no picks in this draft.</div>}
        {lot.length > 0 && <><h4>Lottery movers</h4>{lot.map(r => <div class="rc-lot"><Logo t={w.teams[r.team]} size={20} /> {w.teams[r.team].abbr}: from {r.pre} to {r.pick}{r.odds ? <small> ({r.odds}% odds at that pick)</small> : null}</div>)}</>}
      </div>
    </div>
  </div>;
}

// ------------------------------------------------------------------ offseason changes
function Offseason({ w }: { w: World }) {
  const items = offseasonItems(w);
  return <div class="show-card offs" onClick={(e: any) => e.stopPropagation()}>
    <div class="aw-h"><span>{seasonLabel(w.season.year)}</span><h2>Around the league</h2><small>Changes since last season</small></div>
    <div class="offs-l">{items.slice(0, 8).map((it, i) => { const t = w.teams[it.team];
      return <div class="offs-c" style={{ animationDelay: `${0.2 + i * 0.25}s` }}><Logo t={t} size={64} /><div><b>{t.city} {t.name}</b><span>{it.note}</span></div></div>; })}</div>
  </div>;
}

export { getWorld };

hooks.afterStep = checkShowcases;
