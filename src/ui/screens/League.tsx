import { useStore, openModal } from '../store';
import { Bracket } from '../Bracket';
import { PlayerTile, place, Panel, Tabs, curTab, Logo, Headshot, f1, pct, dateShort, seasonLabel } from '../util';
import { standings, perGame, scoringTitle } from '../../sim/league';
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
    {[...rows].sort((a, b) => f(b.s) - f(a.s)).slice(0, 8).map((o, i) => <div class={`ld ${o.p.team === w.meta.userTeam ? 'me' : ''}`}>
      <span class="ld-r">{i + 1}</span><PlayerTile p={o.p} size={30} sub={w.teams[o.s.team] ? place(w.teams[o.s.team]) : ''} right={<b class="ld-v">{fm(f(o.s))}</b>} /></div>)}
  </Panel>)}</div>;
}

function Playoffs({ w }: { w: World }) {
  return <Panel class="fill"><Bracket w={w} /></Panel>;
}

function News({ w }: { w: World }) {
  return <Panel class="fill paperish" title="News wire">{w.news.map(n => <div class="news"><span class="muted">{dateShort(n.date)} · {n.kind}</span><h4>{n.head}</h4>{n.body && <p>{n.body}</p>}</div>)}</Panel>;
}

function Moves({ w }: { w: World }) {
  const ev = w.events.filter(e => ['trade', 'signing', 'release', 'coach_change', 'retire', 'franchise', 'injury', 'series', 'champion'].includes(e.type)).slice(-150).reverse();
  return <Panel class="fill" title="Transactions & events">{ev.map(e => <div class="li"><span class="muted">{dateShort(e.date)}</span><span>{e.text}</span></div>)}</Panel>;
}

/** The team as it was called in a past season (relocations and logo changes keep history honest). */
export function teamThen(w: World, s: any, id: string): any {
  const t = w.teams[id];
  const n = s?.names?.[id];
  return n ? { ...t, abbr: n.abbr, city: n.city, name: n.name.replace(`${n.city} `, ''), logoKey: n.logo } : t;
}
const AWARD_ROWS: [string, string][] = [['MVP', 'Most Valuable Player'], ['Finals MVP', 'Finals MVP'], ['Scoring title', 'Scoring title'], ['ROY', 'Rookie of the Year'],
  ['DPOY', 'Defensive Player of the Year'], ['6MOY', 'Sixth Man of the Year'], ['MIP', 'Most Improved Player'], ['COY', 'Coach of the Year']];

function Awards({ w }: { w: World }) {
  const seasons = [...w.pastSeasons].reverse();
  if (!seasons.length) return <Panel title="Awards & history"><p class="muted">Each finished season gets a tile here: the champion and the MVP. Awards are voted from what happens in this save, not from history.</p></Panel>;
  const u = w.meta.userTeam;
  const titles = seasons.filter(s => s.champion === u).length;
  return <div class="hist">
    <div class="hist-h"><span>{seasons.length} {seasons.length === 1 ? 'season' : 'seasons'} in this universe</span>{titles > 0 && <b>{titles} {titles === 1 ? 'title' : 'titles'} for us</b>}<em>Choose a season for every award</em></div>
    <div class="hist-grid">{seasons.map(s => {
      const t = teamThen(w, s, s.champion);
      const mvp = s.awards?.MVP ? w.players[s.awards.MVP] : null;
      return <button data-nav class={`hist-tile ${s.champion === u ? 'me' : ''}`} style={{ '--c1': t.colors?.[0] ?? '#333', '--c2': t.colors?.[1] ?? '#c9a227' } as any} onClick={() => openModal('season', { year: s.year })}>
        <span class="ht-year">{seasonLabel(s.year)}</span>
        <Logo t={t} size={72} />
        <b class="ht-team">{t.city} {t.name}</b>
        <span class="ht-mvp">MVP {mvp ? mvp.name : '—'}</span>
      </button>;
    })}</div>
  </div>;
}

/** Everything about one finished season: the Finals, every award, the scoring title. */
export function SeasonCard({ w, year }: { w: World; year: number }) {
  const s = w.pastSeasons.find(x => x.year === year);
  if (!s) return null;
  const aw = s.awards ?? {};
  const champ = teamThen(w, s, s.champion);
  const runner = s.runnerUp ? teamThen(w, s, s.runnerUp) : null;
  const st = aw['Scoring title'] ? { id: aw['Scoring title'], ppg: aw.scoringPPG } : scoringTitle(w, year);
  const best = s.standings?.[0] ? teamThen(w, s, s.standings[0].team) : null;
  const teamOf = (pid: string) => { const p = w.players[pid]; const ln = (p?.stats ?? []).filter(l => l.season === year && !l.playoffs).slice(-1)[0]; return ln ? teamThen(w, s, ln.team) : null; };
  const line = (pid: string, k: string) => { const p = w.players[pid]; if (!p) return ''; const g = perGame(p, year); if (!g.g) return '';
    if (k === 'Scoring title') return `${(st?.ppg ?? g.ppg).toFixed(1)} points per game`;
    if (k === 'DPOY') return `${g.spg.toFixed(1)} stl · ${g.bpg.toFixed(1)} blk · ${g.rpg.toFixed(1)} reb`;
    return `${g.ppg.toFixed(1)} pts · ${g.rpg.toFixed(1)} reb · ${g.apg.toFixed(1)} ast`; };
  const row = (k: string, label: string) => {
    const v = k === 'Scoring title' ? st?.id : aw[k];
    if (!v) return null;
    if (k === 'COY') { const ct = aw.COYteam ? teamThen(w, s, aw.COYteam) : null;
      return <div class="sc-aw"><small>{label}</small><div class="sc-who"><span class="hs hs-blank" style={{ width: 44, height: 44 }}><span>{String(v).split(' ').map((x: string) => x[0]).join('')}</span></span><div><b>{v}</b><em>{ct ? `${ct.city} ${ct.name}` : ''}</em></div></div></div>; }
    const p = w.players[v]; if (!p) return null; const t = teamOf(v);
    return <button data-nav class="sc-aw" onClick={() => openModal('player', { id: p.id })}><small>{label}</small>
      <div class="sc-who"><Headshot p={p} size={44} /><div><b>{p.name}</b><em>{t ? <><Logo t={t} size={16} /> {t.abbr} · </> : ''}{line(v, k)}</em></div></div></button>;
  };
  const team = (k: string) => (aw[k] as string[] | undefined)?.length ? <div class="sc-team"><small>{k}</small><div>{(aw[k] as string[]).map(id => w.players[id] && <button data-nav onClick={() => openModal('player', { id })}>{w.players[id].name}</button>)}</div></div> : null;
  return <div class="season-card" style={{ '--c1': champ.colors?.[0] ?? '#333', '--c2': champ.colors?.[1] ?? '#c9a227' } as any}>
    <div class="sc-head">
      <Logo t={champ} size={110} />
      <div><span>{seasonLabel(year)} NBA Champions</span><h2>{champ.city} {champ.name}</h2>
        {runner && <p>Beat the {runner.city} {runner.name}{(s as any).finals ? ` ${(s as any).finals}` : ''} in the Finals</p>}
        {best && <p class="muted">Best record: {best.city} {best.name} ({s.standings[0].w}–{s.standings[0].l})</p>}</div>
    </div>
    <div class="sc-grid">{AWARD_ROWS.map(([k, l]) => row(k, l))}</div>
    <div class="sc-teams">{team('All-NBA 1st')}{team('All-NBA 2nd')}{team('All-NBA 3rd')}{team('All-Defensive')}</div>
  </div>;
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
