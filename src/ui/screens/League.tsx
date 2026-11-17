import { useStore, openModal } from '../store';
import { place, Panel, Tabs, curTab, Logo, f1, pct, dateShort, seasonLabel } from '../util';
import { standings, perGame } from '../../sim/league';
import type { Series, World } from '../../sim/types';

function Standings({ w }: { w: World }) {
  const u = w.meta.userTeam;
  return <div class="two">
    {['East', 'West'].map(conf => <Panel title={`${conf}ern Conference`}>
      {[...new Set(Object.values(w.teams).filter(t => t.conf === conf).map(t => t.div))].map(div => {
        const ts = standings(w, conf).filter(t => t.div === div);
        return <table class="tbl compact st"><thead><tr><th class="l">{div}</th><th>W</th><th>L</th><th>PCT</th><th>GB</th><th>Home</th><th>PF</th><th>PA</th><th>Strk</th></tr></thead><tbody>
          {ts.map(t => { const g = t.w + t.l; return <tr class={t.id === u ? 'me' : ''}><td class="tn l"><Logo t={t} size={22} />{place(t)}</td><td>{t.w}</td><td>{t.l}</td><td>{pct(g ? t.w / g : 0)}</td>
            <td>{t === ts[0] ? '—' : ((ts[0].w - t.w + t.l - ts[0].l) / 2).toFixed(1)}</td><td>{t.homeW}–{t.homeL}</td><td>{f1(g ? t.ptsFor / g : 0)}</td><td>{f1(g ? t.ptsAgainst / g : 0)}</td><td>{t.streak ? `${t.streak > 0 ? 'W' : 'L'}${Math.abs(t.streak)}` : '—'}</td></tr>; })}
        </tbody></table>;
      })}
    </Panel>)}
  </div>;
}

function Leaders({ w }: { w: World }) {
  const y = w.season.year;
  const maxG = Math.max(1, ...Object.values(w.teams).map(t => t.w + t.l));
  const rows = Object.values(w.players).filter(p => (p.stats ?? []).some(s => s.season === y && !s.playoffs)).map(p => ({ p, s: perGame(p, y, false) })).filter(o => o.s.g >= Math.max(1, Math.floor(maxG * 0.5)));
  const cats: [string, (s: any) => number, (v: number) => string][] = [['Points', s => s.ppg, f1], ['Rebounds', s => s.rpg, f1], ['Assists', s => s.apg, f1], ['Steals', s => s.spg, f1], ['Blocks', s => s.bpg, f1], ['FG%', s => s.fga >= 200 ? s.fgp : 0, pct]];
  return <div class="leaders">{cats.map(([n, f, fm]) => <Panel title={n}>
    {[...rows].sort((a, b) => f(b.s) - f(a.s)).slice(0, 8).map((o, i) => <button data-nav class={`ld ${o.p.team === w.meta.userTeam ? 'me' : ''}`} onClick={() => openModal('player', { id: o.p.id })}>
      <span class="ld-r">{i + 1}</span><span class="ld-n">{o.p.name}</span><span class="ld-t">{w.teams[o.s.team]?.abbr}</span><b>{fm(f(o.s))}</b></button>)}
  </Panel>)}</div>;
}

function SeriesBox({ w, s }: { w: World; s: Series }) {
  const H = w.teams[s.hi], L = w.teams[s.lo];
  return <div class={`series ${s.hi === w.meta.userTeam || s.lo === w.meta.userTeam ? 'me' : ''}`}>
    <div class={s.winner === s.hi ? 'won' : ''}><Logo t={H} size={22} />{place(H)}<b>{s.wHi}</b></div>
    <div class={s.winner === s.lo ? 'won' : ''}><Logo t={L} size={22} />{place(L)}<b>{s.wLo}</b></div>
  </div>;
}

function Playoffs({ w }: { w: World }) {
  const P = w.season.playoffs;
  if (!P) return <Panel title="Playoff format (1976–77)"><p class="muted">Twelve teams: six per conference. Division winners get first-round byes. The first round is best-of-three; every later round is best-of-seven.</p>
    <div class="two">{['East', 'West'].map(c => <div><h4>{c} — if the season ended today</h4>{standings(w, c).slice(0, 6).map((t, i) => <div class="li"><span>{i + 1}</span><Logo t={t} size={20} /><span>{place(t)}</span><b>{t.w}–{t.l}</b></div>)}</div>)}</div></Panel>;
  const rounds = ['First round', 'Conference semifinals', 'Conference finals', 'NBA Finals'];
  return <div class="bracket">{[1, 2, 3, 4].map(r => <Panel title={rounds[r - 1]}>
    {P.series.filter(s => s.round === r).map(s => <SeriesBox w={w} s={s} />)}
    {!P.series.some(s => s.round === r) && <div class="muted">TBD</div>}
  </Panel>)}
    {w.season.champion && <div class="champ"><Logo t={w.teams[w.season.champion]} size={90} /><div>{seasonLabel(w.season.year)} Champions<b>{w.teams[w.season.champion].city} {w.teams[w.season.champion].name}</b></div></div>}
  </div>;
}

function News({ w }: { w: World }) {
  return <Panel class="fill paperish" title="News wire">{w.news.map(n => <div class="news"><span class="muted">{dateShort(n.date)} · {n.kind}</span><h4>{n.head}</h4>{n.body && <p>{n.body}</p>}</div>)}</Panel>;
}

function Moves({ w }: { w: World }) {
  const ev = w.events.filter(e => ['trade', 'signing', 'release', 'coach_change', 'retire', 'franchise', 'injury', 'series', 'champion'].includes(e.type)).slice(-150).reverse();
  return <Panel class="fill" title="Transactions & events">{ev.map(e => <div class="li"><span class="muted">{dateShort(e.date)}</span><span>{e.text}</span></div>)}</Panel>;
}

function Awards({ w }: { w: World }) {
  const name = (id: string) => w.players[id]?.name ?? id;
  const seasons = [...w.pastSeasons].reverse();
  if (!seasons.length) return <Panel title="Awards & history"><p class="muted">Awards are voted at the end of the season from what happens in this save — not from history.</p></Panel>;
  return <div class="col">{seasons.map(s => <Panel title={`${seasonLabel(s.year)}`}>
    <div class="li"><span>Champion</span><Logo t={w.teams[s.champion]} size={22} /><b>{w.teams[s.champion].city} {w.teams[s.champion].name}</b>{s.runnerUp && <span class="muted">over {w.teams[s.runnerUp].city}</span>}</div>
    {Object.entries(s.awards).map(([k, v]) => <div class="li"><span>{k}</span><b>{Array.isArray(v) ? v.map(name).join(', ') : k === 'COY' ? v : name(v as string)}</b></div>)}
  </Panel>)}</div>;
}

export function League() {
  const { world: w } = useStore();
  const tab = curTab('league', 'standings');
  return <div class="screen">
    <div class="screen-h"><h2>League</h2><Tabs id="league" def="standings" tabs={[{ id: 'standings', label: 'Standings' }, { id: 'leaders', label: 'Leaders' }, { id: 'playoffs', label: 'Playoffs' }, { id: 'news', label: 'News' }, { id: 'moves', label: 'Transactions' }, { id: 'awards', label: 'Awards & history' }]} /></div>
    {tab === 'standings' && <Standings w={w!} />}
    {tab === 'leaders' && <Leaders w={w!} />}
    {tab === 'playoffs' && <Playoffs w={w!} />}
    {tab === 'news' && <News w={w!} />}
    {tab === 'moves' && <Moves w={w!} />}
    {tab === 'awards' && <Awards w={w!} />}
  </div>;
}
