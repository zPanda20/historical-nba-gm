import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useStore, openModal, setUI, ui } from '../store';
import { place, Panel, Tabs, curTab, Logo, dateShort, Btn, lastName } from '../util';
import type { BoxLine, GameRec, World } from '../../sim/types';

export function BoxScore({ w, g }: { w: World; g: GameRec }) {
  const H = w.teams[g.home], A = w.teams[g.away];
  const q = g.box!.quarters;
  const Side = ({ lines, t }: { lines: BoxLine[]; t: any }) => {
    const tot = lines.reduce((a: any, l: any) => { for (const k of ['min', 'pts', 'fgm', 'fga', 'ftm', 'fta', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'tov', 'pf']) a[k] = (a[k] ?? 0) + l[k]; return a; }, {});
    return <table class="tbl compact box"><thead><tr><th class="l"><Logo t={t} size={20} /> {t.name}</th><th>MIN</th><th>FG</th><th>FT</th><th>OR</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TO</th><th>PF</th><th>PTS</th></tr></thead>
      <tbody>{lines.filter(l => l.min > 0 || l.gs).sort((a, b) => (b.gs ? 1 : 0) - (a.gs ? 1 : 0) || b.min - a.min).map(l => <tr class={l.gs ? 'st' : ''} onClick={() => openModal('player', { id: l.pid })}>
        <td class="l"><button data-nav class="ptile mini" onClick={(e: any) => { e.stopPropagation(); openModal('player', { id: l.pid }); }}><b>{l.name}</b>{l.gs ? <small>starter</small> : null}</button></td><td>{Math.round(l.min)}</td><td>{l.fgm}-{l.fga}</td><td>{l.ftm}-{l.fta}</td><td>{l.oreb}</td><td>{l.oreb + l.dreb}</td><td>{l.ast}</td><td>{l.stl}</td><td>{l.blk}</td><td>{l.tov}</td><td>{l.pf}</td><td class="b">{l.pts}</td></tr>)}
        <tr class="tot"><td class="l">Team</td><td>{Math.round(tot.min)}</td><td>{tot.fgm}-{tot.fga}</td><td>{tot.ftm}-{tot.fta}</td><td>{tot.oreb}</td><td>{tot.oreb + tot.dreb}</td><td>{tot.ast}</td><td>{tot.stl}</td><td>{tot.blk}</td><td>{tot.tov}</td><td>{tot.pf}</td><td class="b">{tot.pts}</td></tr>
      </tbody></table>;
  };
  return <div class="boxscore">
    <table class="tbl compact qline"><thead><tr><th class="l"></th>{q[0].map((_, i) => <th>{i < 4 ? `Q${i + 1}` : `OT${i - 3 > 1 ? i - 3 : ''}`}</th>)}<th>F</th></tr></thead>
      <tbody><tr><td class="l">{A.city}</td>{q[1].map(x => <td>{x}</td>)}<td class="b">{g.as}</td></tr><tr><td class="l">{H.city}</td>{q[0].map(x => <td>{x}</td>)}<td class="b">{g.hs}</td></tr></tbody></table>
    <Side lines={g.box!.away} t={A} />
    <Side lines={g.box!.home} t={H} />
  </div>;
}

function OurSchedule({ w }: { w: World }) {
  const u = w.meta.userTeam;
  const gs = w.season.games.filter(g => g.home === u || g.away === u);
  let wn = 0, ls = 0;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector('.next')?.scrollIntoView({ block: 'center' }); }, []);
  return <Panel class="fill" title={`Our ${w.season.year}–${String(w.season.year + 1).slice(2)} schedule`}>
    <div class="sched" ref={ref}>{gs.map(g => {
      const home = g.home === u, opp = w.teams[home ? g.away : g.home];
      let res = '';
      if (g.played) { const us = home ? g.hs! : g.as!, th = home ? g.as! : g.hs!; if (!g.playoff) { if (us > th) wn++; else ls++; } res = `${us > th ? 'W' : 'L'} ${us}–${th}${g.ot ? ' OT' : ''}`; }
      const isNext = !g.played && !gs.slice(0, gs.indexOf(g)).some(x => !x.played);
      return <button data-nav class={`sc ${g.played ? (res[0] === 'W' ? 'w' : 'l') : ''} ${isNext ? 'next' : ''}`} disabled={!g.played && !isNext} onClick={() => g.played ? (g.log ? setUI({ gamecast: g.id }) : openModal('box', { id: g.id })) : openModal('notice', { title: 'Next game', body: `${home ? 'vs' : 'at'} ${opp.city} ${opp.name} on ${dateShort(g.date)}. Use Home to watch or sim to it.` })}>
        <span class="sc-d">{dateShort(g.date)}{g.playoff ? ' · PO' : ''}</span><span class="sc-h">{home ? 'vs' : '@'}</span><Logo t={opp} size={22} /><span class="sc-o">{place(opp)}</span>
        <span class="sc-r">{res || (isNext ? 'Next' : '')}</span><span class="sc-rec">{g.played && !g.playoff ? `${wn}–${ls}` : ''}</span>{g.log && <span class="sc-cast" title="Gamecast available">▶</span>}
      </button>;
    })}</div>
  </Panel>;
}

function Around({ w }: { w: World }) {
  const played = w.season.games.filter(g => g.played);
  const lastDay = played.length ? played[played.length - 1].date : null;
  const days = [...new Set(played.map(g => g.date))].slice(-4).reverse();
  if (!lastDay) return <Panel title="Around the league"><div class="muted">No games played yet.</div></Panel>;
  return <div class="col">{days.map(d => <Panel title={dateShort(d)}><div class="scores">{played.filter(g => g.date === d).map(g => <button data-nav class="score" onClick={() => openModal('box', { id: g.id })}>
    <div class={g.as! > g.hs! ? 'b' : ''}><Logo t={w.teams[g.away]} size={20} />{w.teams[g.away].abbr}<span>{g.as}</span></div>
    <div class={g.hs! > g.as! ? 'b' : ''}><Logo t={w.teams[g.home]} size={20} />{w.teams[g.home].abbr}<span>{g.hs}</span></div>
  </button>)}</div></Panel>)}</div>;
}

export function Games() {
  const { world: w } = useStore();
  const tab = curTab('games', 'ours');
  return <div class="screen">
    <div class="screen-h"><h2>Games</h2><Tabs id="games" def="ours" tabs={[{ id: 'ours', label: 'Our schedule' }, { id: 'around', label: 'Around the league' }]} /><div class="screen-meta">You watch from the GM's box — the coach makes every call on the floor.</div></div>
    {tab === 'ours' ? <OurSchedule w={w!} /> : <Around w={w!} />}
  </div>;
}

// ------------------------------------------------------------------ gamecast (replay of the engine's possession log)
const absT = (q: number, clock: number) => q <= 4 ? (q - 1) * 720 + (720 - clock) : 2880 + (q - 5) * 300 + (300 - clock);
const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function Gamecast({ id }: { id: string }) {
  const { world: w } = useStore();
  const g = w!.season.games.find(x => x.id === id) ?? null;
  const log = g?.log ?? [];
  const times = useMemo(() => log.map(e => absT(e.q, e.clock)), [id]);
  const end = times.length ? times[times.length - 1] : 0;
  const [t, setT] = useState(0);
  const [showBox, setShowBox] = useState(false);
  const speed = ui.castSpeed;
  useEffect(() => {
    if (t >= end) return;
    const iv = setInterval(() => setT(x => Math.min(end, x + speed * 0.1)), 100);
    return () => clearInterval(iv);
  }, [speed, t >= end, id]);
  if (!g) return null;
  const H = w!.teams[g.home], A = w!.teams[g.away];
  let n = 0; while (n < log.length && times[n] <= t) n++;
  const shown = log.slice(0, n);
  const last = shown[shown.length - 1];
  const score = last ? last.score : [0, 0];
  const q = last ? last.q : 1;
  const clock = last ? (t >= end ? 0 : Math.max(0, (q <= 4 ? 720 : 300) - (t - (q <= 4 ? (q - 1) * 720 : 2880 + (q - 5) * 300)))) : 720;
  const done = t >= end;
  const pts: Record<string, number> = {};
  for (const e of shown) {
    if (!e.pid) continue;
    if (e.type === 'make') pts[e.pid] = (pts[e.pid] ?? 0) + (/three/i.test(e.text) ? 3 : 2);
    if (e.type === 'ft') { const m = /makes (\d) of/.exec(e.text); if (m) pts[e.pid] = (pts[e.pid] ?? 0) + +m[1]; }
  }
  const top = (side: 'home' | 'away') => g.box![side].map(l => ({ l, p: pts[l.pid] ?? 0 })).sort((a, b) => b.p - a.p).slice(0, 4);
  const qLabel = q <= 4 ? `${q}` : `OT${q - 4 > 1 ? q - 4 : ''}`;
  return <div class="cast" data-scope>
    <div class="cast-arena" />
    <div class="cast-board">
      <div class="cb-team"><Logo t={A} size={86} /><div class="cb-name">{A.city}</div></div>
      <div class="cb-score bulbs big">{String(score[1]).padStart(3, ' ')}</div>
      <div class="cb-mid"><div class="cb-q">Period <span class="bulbs">{qLabel}</span></div><div class="bulbs clock">{fmtClock(clock)}</div>{g.playoff && <div class="cb-po">Playoffs · Game {g.playoff.game}</div>}</div>
      <div class="cb-score bulbs big">{String(score[0]).padStart(3, ' ')}</div>
      <div class="cb-team"><Logo t={H} size={86} /><div class="cb-name">{H.city}</div></div>
    </div>
    {!showBox ? <div class="cast-body">
      <div class="cast-pbp">{[...shown].reverse().slice(0, 16).map((e, i) => <div class={`pbp ${e.type} ${i === 0 ? 'new' : ''}`}>
        <span class="pbp-t">{e.q <= 4 ? `Q${e.q}` : 'OT'} {fmtClock(e.clock)}</span>{e.team >= 0 && <Logo t={e.team === 0 ? H : A} size={18} />}<span class="pbp-x">{e.text}</span><span class="pbp-s">{e.score[1]}–{e.score[0]}</span></div>)}</div>
      <div class="cast-lead">
        {(['away', 'home'] as const).map(side => <div class="cl"><div class="cl-h"><Logo t={side === 'home' ? H : A} size={22} />{(side === 'home' ? H : A).name}</div>
          {top(side).map(o => <div class="cl-r"><span>{lastName(o.l.name)}</span><b>{o.p}</b></div>)}</div>)}
        <div class="cast-note">Same engine as a fast sim. The coach is making the calls; you're watching from the GM's box.</div>
      </div>
    </div> : <div class="cast-box"><BoxScore w={w!} g={g} /></div>}
    <div class="cast-ctl">
      {!done && <>{[[6, 'Slow'], [24, 'Normal'], [96, 'Fast']].map(([s, l]) => <button data-nav class={`btn ${speed === s ? 'on' : 'ghost'}`} onClick={() => setUI({ castSpeed: s as number })}>{l}</button>)}
        <Btn kind="ghost" onClick={() => setT(end)}>Skip to final</Btn></>}
      {done && <><Btn kind={showBox ? 'ghost' : 'big'} auto={!showBox} onClick={() => setShowBox(!showBox)}>{showBox ? 'Back to gamecast' : 'Box score'}</Btn></>}
      <Btn kind={done && showBox ? 'big' : 'ghost'} auto={done && showBox} onClick={() => setUI({ gamecast: null })}>{done ? 'Leave the arena' : 'Leave early'}</Btn>
    </div>
  </div>;
}
