import { useStore, go, openModal, setUI } from '../store';
import { Logo, Headshot, Panel, Btn, dateShort, teamRec, lastName, f1, seasonLabel, injuryChip } from '../util';
import { sim, watchNext, nextUserGame, lastUserGame, beginNextSeason, seasonStartProblems } from '../actions';
import { makeGameplan } from '../../sim/coach';
import { standings, perGame } from '../../sim/league';
import { TRADE_DEADLINE } from '../../sim/gm';
import type { World } from '../../sim/types';

function Bulbs({ text, cls = '' }: { text: string; cls?: string }) {
  return <span class={`bulbs ${cls}`}>{text}</span>;
}

function Scoreboard({ w }: { w: World }) {
  const g = lastUserGame(w);
  if (!g) return <div class="board"><div class="board-h">Last game</div><div class="board-empty"><Bulbs text="-- --" /></div><div class="board-f">No games yet</div></div>;
  const H = w.teams[g.home], A = w.teams[g.away];
  return <button data-nav class="board" onClick={() => openModal('box', { id: g.id })}>
    <div class="board-h">{g.playoff ? 'Playoffs · ' : ''}Final{g.ot ? ` · ${g.ot > 1 ? g.ot : ''}OT` : ''} · {dateShort(g.date)}</div>
    <div class="board-row"><Logo t={A} size={40} /><span class="board-n">{A.abbr}</span><Bulbs text={String(g.as).padStart(3, ' ')} cls={g.as! > g.hs! ? 'win' : ''} /></div>
    <div class="board-row"><Logo t={H} size={40} /><span class="board-n">{H.abbr}</span><Bulbs text={String(g.hs).padStart(3, ' ')} cls={g.hs! > g.as! ? 'win' : ''} /></div>
    <div class="board-f">Box score ›</div>
  </button>;
}

function SimControls({ w }: { w: World }) {
  const S = w.season;
  const u = w.meta.userTeam;
  if (S.phase === 'preseason') return <div class="sim">
    <Btn kind="big" auto onClick={() => sim('day')}>Tip off the {seasonLabel(S.year)} season</Btn>
    <Btn onClick={() => watchNext()}>Watch opening night</Btn>
  </div>;
  if (S.phase === 'regular') return <div class="sim">
    <Btn kind="big" auto onClick={() => watchNext()}>Watch the game</Btn>
    <Btn onClick={() => sim('game')}>Sim to result</Btn>
    <Btn onClick={() => sim('week')}>Sim a week</Btn>
    <Btn onClick={() => sim('month')}>Sim a month</Btn>
    <Btn kind="ghost" onClick={() => { if (confirm('Simulate the rest of the regular season? It will still stop for critical decisions.')) sim('regular'); }}>Rest of season</Btn>
  </div>;
  if (S.phase === 'playoffs') {
    const alive = S.playoffs!.series.some(s => (s.hi === u || s.lo === u) && !s.winner) || (S.playoffs!.round === 1 && ['East', 'West'].some(c => ((S as any)[`seeds${c}`] as string[]).slice(0, 2).includes(u)));
    return <div class="sim">
      {alive && <Btn kind="big" auto onClick={() => watchNext()}>Watch our next game</Btn>}
      <Btn kind={alive ? '' : 'big'} auto={!alive} onClick={() => sim('day')}>Sim a day</Btn>
      <Btn onClick={() => sim('round')}>Sim the round</Btn>
      <Btn kind="ghost" onClick={() => sim('playoffs')}>Sim the playoffs</Btn>
      <Btn kind="ghost" onClick={() => go('league', 'playoffs')}>Bracket</Btn>
    </div>;
  }
  if (S.phase === 'draft') return <div class="sim"><Btn kind="big" auto onClick={() => go('draft')}>Go to the draft room</Btn></div>;
  const probs = seasonStartProblems(w);
  return <div class="sim">
    <Btn kind="big" auto onClick={() => go('office', 'contracts')}>Re-sign & sign players</Btn>
    <Btn onClick={() => go('office', 'fa')}>Free agents</Btn>
    <Btn disabled={probs.length > 0} title={probs.join(' ')} onClick={() => beginNextSeason()}>Start {seasonLabel(S.year + 1)}</Btn>
    {probs.length > 0 && <div class="sim-warn">{probs[0]}</div>}
  </div>;
}

function NextGame({ w }: { w: World }) {
  const S = w.season, u = w.meta.userTeam;
  const t = w.teams[u];
  if (S.phase === 'regular' || S.phase === 'preseason') {
    const g = nextUserGame(w);
    if (!g) return <div class="ng-card"><div class="ng-k">Regular season complete</div></div>;
    const home = g.home === u, opp = w.teams[home ? g.away : g.home];
    const dl = TRADE_DEADLINE(S.year);
    return <div class="ng-card">
      <div class="ng-k">Next game · {dateShort(g.date)}{g.date === S.day ? ' · Tonight' : ''}</div>
      <div class="ng-vs">
        <div class="ng-side"><Logo t={t} size={74} /><b>{t.name}</b><small>{teamRec(t)}</small></div>
        <div class="ng-at">{home ? 'VS' : 'AT'}</div>
        <div class="ng-side"><Logo t={opp} size={74} /><b>{opp.name}</b><small>{teamRec(opp)}</small></div>
      </div>
      <div class="ng-sub">{home ? `Home` : `Away at ${opp.city}`}{S.day <= dl ? ` · Trade deadline ${dateShort(dl)}` : ' · Past the trade deadline'}</div>
    </div>;
  }
  if (S.phase === 'playoffs') {
    const sr = S.playoffs!.series.filter(s => s.hi === u || s.lo === u).slice(-1)[0];
    if (!sr) return <div class="ng-card"><div class="ng-k">Playoffs</div><div class="ng-big">{(['East', 'West'].some(c => ((S as any)[`seeds${c}`] as string[]).includes(u))) ? 'First-round bye — resting up' : 'We missed the playoffs'}</div></div>;
    const opp = w.teams[sr.hi === u ? sr.lo : sr.hi];
    const us = sr.hi === u ? sr.wHi : sr.wLo, them = sr.hi === u ? sr.wLo : sr.wHi;
    const rn = ['', 'First round', 'Conference semifinals', 'Conference finals', 'NBA Finals'][sr.round];
    return <div class="ng-card">
      <div class="ng-k">{rn} · best of {sr.bestOf}</div>
      <div class="ng-vs">
        <div class="ng-side"><Logo t={t} size={74} /><b>{t.name}</b></div>
        <div class="ng-at series"><span>{us}</span>–<span>{them}</span></div>
        <div class="ng-side"><Logo t={opp} size={74} /><b>{opp.name}</b></div>
      </div>
      <div class="ng-sub">{sr.winner ? (sr.winner === u ? 'Series won' : 'Eliminated') : us > them ? 'We lead the series' : us < them ? 'We trail the series' : 'Series tied'}</div>
    </div>;
  }
  const last = t.history.slice(-1)[0];
  return <div class="ng-card">
    <div class="ng-k">{S.phase === 'draft' ? `${S.year + 1} NBA Draft` : 'Offseason'}</div>
    <div class="ng-big">{last ? `${last.w}–${last.l} · ${last.result}` : ''}</div>
    <div class="ng-sub">{S.champion ? `${w.teams[S.champion].city} ${w.teams[S.champion].name} are the champions.` : ''}</div>
  </div>;
}

function OnTheFloor({ w }: { w: World }) {
  const t = w.teams[w.meta.userTeam];
  const plan = makeGameplan(w, t, w.coaches[t.coach]);
  const five = plan.starters.map(id => w.players[id]).filter(Boolean);
  const out = t.roster.map(id => w.players[id]).filter(p => p.injury && p.injury.daysLeft > 0);
  const y = w.season.year;
  return <Panel title="On the floor today" right={<span class="muted">Coach {lastName(w.coaches[t.coach].name)}'s starting five</span>} class="floor">
    <div class="five">{five.map(p => {
      const s = perGame(p, y);
      return <button data-nav class="five-c" onClick={() => openModal('player', { id: p.id })}>
        <Headshot p={p} size={84} />
        <div class="five-pos">{p.pos}</div>
        <div class="five-n">{p.name}</div>
        <div class="five-s">{s.g ? `${f1(s.ppg)} pts · ${f1(s.rpg)} reb · ${f1(s.apg)} ast` : `${p.age} yrs · ${p.ovr} OVR`}</div>
      </button>;
    })}</div>
    {out.length > 0 && <div class="floor-out">Out: {out.map(p => <span>{p.name} {injuryChip(p)}</span>)}</div>}
  </Panel>;
}

function Headlines({ w }: { w: World }) {
  const news = w.news.slice(0, 5);
  return <div class="paper">
    <div class="paper-mast">The Daily Box Score</div>
    <div class="paper-date">{w.season.day} · Sports</div>
    {news.length ? news.map((n, i) => <div class={`paper-item ${i === 0 ? 'lead' : ''}`}><h4>{n.head}</h4>{n.body && <p>{n.body}</p>}</div>) : <p class="paper-item">The presses are warming up.</p>}
    <button data-nav class="paper-more" onClick={() => go('league', 'news')}>More news ›</button>
  </div>;
}

function Division({ w }: { w: World }) {
  const t = w.teams[w.meta.userTeam];
  const div = standings(w).filter(x => x.div === t.div);
  return <Panel title={`${t.div} Division`} right={<button data-nav class="link" onClick={() => go('league', 'standings')}>Standings ›</button>}>
    <table class="tbl compact"><thead><tr><th></th><th>W</th><th>L</th><th>GB</th><th>Strk</th></tr></thead><tbody>
      {div.map(x => <tr class={x.id === t.id ? 'me' : ''}><td class="tn"><Logo t={x} size={22} />{x.name}</td><td>{x.w}</td><td>{x.l}</td>
        <td>{x === div[0] ? '—' : ((div[0].w - x.w + x.l - div[0].l) / 2).toFixed(1)}</td><td>{x.streak ? `${x.streak > 0 ? 'W' : 'L'}${Math.abs(x.streak)}` : '—'}</td></tr>)}
    </tbody></table>
  </Panel>;
}

function Bosses({ w }: { w: World }) {
  const t = w.teams[w.meta.userTeam];
  const c = w.coaches[t.coach];
  const sat = w.owner.satisfaction, trust = c.trustGM ?? 55;
  const word = (v: number) => v >= 70 ? 'Very happy' : v >= 50 ? 'Content' : v >= 32 ? 'Uneasy' : 'Angry';
  return <Panel title="The people you answer to">
    <div class="boss"><div><label>Owner · {w.owner.name}</label><b>{word(sat)}</b></div><div class="meter"><i style={{ width: `${sat}%` }} /></div></div>
    <div class="boss-obj">{w.owner.objective}</div>
    <div class="boss"><div><label>Coach {lastName(c.name)}'s trust in you</label><b>{word(trust)}</b></div><div class="meter"><i style={{ width: `${trust}%` }} /></div></div>
    <button data-nav class="link" onClick={() => setUI({ rafters: true })}>Look up to the rafters ›</button>
  </Panel>;
}

export function Home() {
  const { world: w } = useStore();
  return <div class="home">
    <section class="court">
      <div class="court-floor"><div class="court-paint" /><div class="court-circle"><img src={`assets/logos/${w!.teams[w!.meta.userTeam].abbr}.png`} alt="" /></div><div class="court-paint r" /></div>
      <NextGame w={w!} />
      <Scoreboard w={w!} />
      <SimControls w={w!} />
    </section>
    <OnTheFloor w={w!} />
    <div class="home-row">
      <Headlines w={w!} />
      <Division w={w!} />
      <Bosses w={w!} />
    </div>
  </div>;
}
