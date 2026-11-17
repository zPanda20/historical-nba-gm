// Courtside (Home), built on the approved 1976 mockup: arena stands and floor, the center-hung bulb scoreboard,
// the "last night" broadcast chyron, the newspaper crawl, the starting five on the floor, and the decisions at the scorer's table.
import { useStore, go, openModal, setUI, commit } from '../store';
import { Headshot, Btn, MONTHS, DAYS, seasonLabel, condWord, Logo } from '../util';
import { Bracket } from '../Bracket';
import { openRequest, needDef, needMetric } from '../../sim/needs';
import { sim, watchNext, nextUserGame, lastUserGame, runCommand } from '../actions';
import { makeGameplan } from '../../sim/coach';
import { standings } from '../../sim/league';
import { divisionPlace, shortName } from '../Chrome';
import type { Message, World } from '../../sim/types';

const D3 = (d: string) => DAYS[new Date(d + 'T12:00:00Z').getUTCDay()].slice(0, 3);
const MD = (d: string) => { const t = new Date(d + 'T12:00:00Z'); return `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}`; };

/** Stands, lamps, fascia and the hardwood in perspective, with the team's paint at center court. */
export function CourtsideBg({ w }: { w: World }) {
  const t = w.teams[w.meta.userTeam];
  const planks = Array.from({ length: 41 }, (_, i) => <line x1={800 + (i - 20) * 22} y1="474" x2={800 + (i - 20) * 95} y2="900" stroke="#000" stroke-opacity=".12" stroke-width="1.5" />);
  return <svg class="scene" width="1600" height="900" viewBox="0 0 1600 900" aria-hidden="true">
    <defs>
      <linearGradient id="cs-st" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#120a08" /><stop offset="1" stop-color="#2a1712" /></linearGradient>
      <linearGradient id="cs-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a5428" /><stop offset=".5" stop-color="#c98a4b" /><stop offset="1" stop-color="#8a5428" /></linearGradient>
      <pattern id="cs-crowd" width="14" height="16" patternUnits="userSpaceOnUse"><circle cx="7" cy="6" r="4.5" fill="#d4c19c" /><rect x="2" y="10" width="10" height="6" rx="2" fill="#d4c19c" /></pattern>
      <radialGradient id="cs-lamp"><stop offset="0" stop-color="#ffd99a" stop-opacity=".55" /><stop offset="1" stop-color="#000" stop-opacity="0" /></radialGradient>
    </defs>
    <rect width="1600" height="900" fill="url(#cs-st)" />
    {Array.from({ length: 9 }, (_, r) => <rect x="0" y={120 + r * 36} width="1600" height="16" fill="url(#cs-crowd)" opacity={(0.1 + r * 0.025).toFixed(2)} />)}
    {[260, 620, 980, 1340].map(x => <ellipse cx={x} cy="40" rx="140" ry="60" fill="url(#cs-lamp)" />)}
    <rect x="0" y="452" width="1600" height="22" fill="#3a2414" /><rect x="0" y="452" width="1600" height="3" fill="var(--ta)" opacity=".8" />
    <polygon points="380,474 1500,474 1800,900 -200,900" fill="url(#cs-wood)" />
    {planks}
    <polygon points="430,490 1450,490 1700,900 -100,900" fill="none" stroke="#f6ecd4" stroke-opacity=".75" stroke-width="3" />
    <line x1="940" y1="490" x2="940" y2="900" stroke="#f6ecd4" stroke-opacity=".7" stroke-width="3" />
    <ellipse cx="940" cy="640" rx="200" ry="52" fill="var(--tp)" fill-opacity=".6" stroke="#f6ecd4" stroke-opacity=".75" stroke-width="3" />
    <image href={`assets/logos/${t.abbr}.png`} x="870" y="600" width="140" height="80" preserveAspectRatio="xMidYMid meet" opacity=".55" />
  </svg>;
}

function BoardRows({ w }: { w: World }) {
  const { div } = divisionPlace(w);
  const u = w.meta.userTeam;
  let rows = div.slice(0, 5);
  if (!rows.some(t => t.id === u)) rows = [...div.slice(0, 4), w.teams[u]];
  return <>{rows.map(t => <div class={`br ${t.id === u ? 'me' : ''}`}><span>{t.abbr}</span><span>{t.w}-{t.l}</span></div>)}</>;
}

function Scoreboard({ w }: { w: World }) {
  const S = w.season, u = w.meta.userTeam, t = w.teams[u];
  const { ord } = divisionPlace(w);
  let l1 = '', big = '', small = '', midLab = 'Record', mid = `${t.w}-${t.l}`, midSub = `${t.w + t.l ? ord : '—'} · ${t.div}`;
  if (S.phase === 'preseason' || S.phase === 'regular') {
    const g = nextUserGame(w);
    if (g) {
      const home = g.home === u, opp = w.teams[home ? g.away : g.home];
      l1 = `Next game · ${D3(g.date)} · ${MD(g.date)}${g.date === S.day ? ' · tonight' : ''}`;
      big = opp.city === 'New York' ? `NY ${opp.name}` : opp.city;
      small = home ? `Home · ${opp.name} ${opp.w}-${opp.l}` : `Away · ${opp.name} ${opp.w}-${opp.l}`;
    } else { l1 = 'Regular season'; big = 'Final week'; small = 'Playoffs next'; }
  } else if (S.phase === 'playoffs') {
    const sr = S.playoffs!.series.filter(s => s.hi === u || s.lo === u).slice(-1)[0];
    const rn = ['', 'First round', 'Conf. semifinal', 'Conf. final', 'NBA Finals'];
    if (sr) {
      const opp = w.teams[sr.hi === u ? sr.lo : sr.hi];
      const us = sr.hi === u ? sr.wHi : sr.wLo, them = sr.hi === u ? sr.wLo : sr.wHi;
      l1 = `Playoffs · ${rn[sr.round]}`; big = opp.city === 'New York' ? `NY ${opp.name}` : opp.city;
      small = sr.winner ? (sr.winner === u ? 'Series won' : 'Eliminated') : `Best of ${sr.bestOf}`;
      midLab = 'Series'; mid = `${us}-${them}`; midSub = sr.winner ? (sr.winner === u ? 'We advance' : 'Season over') : us > them ? 'We lead' : us < them ? 'We trail' : 'Tied';
    } else {
      const bye = ['East', 'West'].some(c => (((S as any)[`seeds${c}`] as string[]) ?? []).includes(u));
      l1 = 'Playoffs'; big = bye ? 'First-round bye' : 'Season over'; small = bye ? 'Resting up' : 'We missed the playoffs';
    }
  } else {
    const last = t.history.slice(-1)[0];
    l1 = S.phase === 'draft' ? `${S.year + 1} NBA Draft` : 'Offseason · free agency';
    big = S.champion ? `${w.teams[S.champion].name}` : 'Offseason';
    small = S.champion ? 'Won the title' : '';
    midLab = 'Last season'; mid = last ? `${last.w}-${last.l}` : `${t.w}-${t.l}`; midSub = last?.result ?? '';
  }
  return <div class="sboard">
    <div class="sb-face">
      <div class="sb-a"><div class="sb-l">{l1}</div><div class="sb-big">{big}</div><div class="sb-l sb-low">{small}</div></div>
      <i class="sb-sep" />
      <div class="sb-b"><div class="sb-l">{midLab}</div><div class="sb-rec">{mid}</div><div class="sb-l">{midSub}</div></div>
      <i class="sb-sep" />
      <div class="sb-c"><div class="sb-l">{t.div}</div><BoardRows w={w} /></div>
    </div>
  </div>;
}

function Chyron({ w }: { w: World }) {
  const g = lastUserGame(w);
  if (!g) return null;
  const u = w.meta.userTeam;
  const me = w.teams[u], opp = w.teams[g.home === u ? g.away : g.home];
  const us = g.home === u ? g.hs! : g.as!, them = g.home === u ? g.as! : g.hs!;
  const days = (new Date(w.season.day + 'T12:00:00Z').getTime() - new Date(g.date + 'T12:00:00Z').getTime()) / 86400000;
  return <button data-nav class="chyron" onClick={() => g.log ? setUI({ gamecast: g.id }) : openModal('box', { id: g.id })}>
    <span class="cy-lab">{days <= 1 ? 'Last night' : `Last game · ${MD(g.date)}`}</span>
    <span class="cy-band"><span>{me.name} <b>{us}</b></span><span>{opp.name} <b>{them}</b></span><em>Final{g.ot ? ` · OT` : ''}</em></span>
  </button>;
}

function Ticker({ w }: { w: World }) {
  const items = w.news.slice(0, 7).map(n => (n.head === 'Trade' ? n.body.replace(/\.$/, '') : n.head).toUpperCase());
  const text = items.length ? items.join('  ★  ') : 'THE SEASON IS ABOUT TO TIP OFF';
  return <div class="ticker">
    <div class="tk-src">The Evening Courier</div>
    <div class="tk-body"><span style={{ animationDuration: `${Math.max(30, text.length / 6)}s` }}>{text}  ★  {text}</span></div>
  </div>;
}

function Floor({ w }: { w: World }) {
  const t = w.teams[w.meta.userTeam];
  const coach = w.coaches[t.coach];
  const plan = makeGameplan(w, t, coach);
  const five = plan.starters.map(id => w.players[id]).filter(Boolean);
  const out = t.roster.map(id => w.players[id]).filter(p => p.injury && p.injury.daysLeft > 0);
  return <section class="floor5">
    <div class="f5-h"><h3>On the floor today</h3><span>Starting five, as set by Coach {coach.name.split(' ').slice(-1)[0]}{out.length ? ` · Out: ${out.map(p => p.name.split(' ').slice(-1)[0]).join(', ')}` : ''}</span></div>
    <div class="f5-row">{five.map(p => {
      const c = Math.round(p.cond ?? 100);
      const sore = p.injury && p.injury.daysLeft > 0;
      return <button data-nav class="f5" onClick={() => openModal('player', { id: p.id })}>
        <Headshot p={p} size={62} />
        <div class="f5-t">
          <b>{p.name}</b>
          <span class="f5-pos">{p.pos} · {p.age}</span>
          <span class={`f5-h ${sore ? 'bad' : ''}`}>● {sore ? p.injury!.type : 'Healthy'}</span>
          <span class={`f5-c c${c >= 88 ? 4 : c >= 72 ? 3 : c >= 55 ? 2 : 1}`}>{condWord(c)} · {Math.round(plan.targetMin[p.id] ?? 0)} min</span>
        </div>
      </button>;
    })}</div>
  </section>;
}

const TAGCOL: Record<string, string> = { 'Coach request': 'coach', Coach: 'coach', Owner: 'owner', Scouting: 'scout', Agent: 'agent', Medical: 'med', Trade: 'trade', League: 'league' };

function Decision({ w, m, first }: { w: World; m: Message; first: boolean }) {
  const acts = (m.actions?.length ? m.actions : [{ label: 'Got it', cmd: 'dismiss' }]).slice(0, 2);
  const req = m.tag === 'Coach request' ? openRequest(w) : null;
  return <article class="dcard">
    <i class="dc-stripe" />
    <div class="dc-in">
      <div class="dc-top"><span class={`dc-tag ${TAGCOL[m.tag ?? m.role] ?? ''}`}>{m.tag ?? m.role}</span><span class="dc-due">{m.deadline ? `By ${MD(m.deadline)}` : MD(m.date)}</span></div>
      <button data-nav class="dc-title" onClick={() => { m.read = true; openModal('message', { id: m.id }); }}>{m.subject}</button>
      {req ? <div class="dc-meter"><div class="dcm-track"><i class="t" style={{ left: '80%' }} /><i class="n" style={{ left: `${Math.max(2, Math.min(98, 80 - (req.target - needMetric(w, w.teams[w.meta.userTeam].roster, req.key)) * 6))}%` }} /></div>
        <span>{needDef(req.key).label} {Math.round(needMetric(w, w.teams[w.meta.userTeam].roster, req.key))} → target {req.target}</span></div>
        : <div class="dc-body">{m.body}</div>}
      <div class="dc-btns">{acts.map((a, i) => <Btn kind={i === 0 ? 'prim' : 'ghost'} auto={first && i === 0} onClick={() => runCommand(m, a)}>{a.label}</Btn>)}</div>
    </div>
  </article>;
}

function Decisions({ w }: { w: World }) {
  const open = w.messages.filter(m => !m.resolved).sort((a, b) => b.urgent - a.urgent || ((b.actions?.some(x => x.cmd !== 'dismiss') ? 1 : 0) - (a.actions?.some(x => x.cmd !== 'dismiss') ? 1 : 0)) || b.date.localeCompare(a.date));
  const seen = new Set<string>();
  const pick = open.filter(m => { const k = m.tag ?? m.role; if (seen.has(k) && open.length > 4) return false; seen.add(k); return true; }).slice(0, 4);
  return <section class="decisions">
    {pick.map((m, i) => <Decision w={w} m={m} first={i === 0} />)}
    {standing(w).slice(0, 4 - pick.length).map(c => <article class="dcard standing"><i class="dc-stripe" /><div class="dc-in">
      <div class="dc-top"><span class={`dc-tag ${c.cls}`}>{c.tag}</span><span class="dc-due">{c.due}</span></div>
      <div class="dc-title static">{c.title}</div>
      <div class="dc-body">{c.body}</div>
      <div class="dc-btns"><Btn kind="ghost" onClick={c.go}>{c.btn}</Btn></div></div></article>)}
  </section>;
}

/** Standing items that fill the scorer's table when the desk is quiet. */
function standing(w: World) {
  const S = w.season, t = w.teams[w.meta.userTeam];
  const c = w.coaches[t.coach];
  const cls = (w.draftClasses[String(S.year + 1)] ?? []).map(id => w.players[id]).filter(p => p?.scout);
  const reports = cls.reduce((a, p) => a + (p.scout!.now.reports ?? 0), 0);
  const dl = `${S.year + 1}-02-15`;
  const out = [
    { tag: 'Owner', cls: 'owner', due: `${w.owner.expectedWins} wins`, title: `What ${shortName(w.owner.name)} expects`, body: w.owner.objective, btn: 'Visit the owner', go: () => openModal('ownerTalk') },
    { tag: 'Coach', cls: 'coach', due: `Trust ${Math.round(c.trustGM ?? 55)}`, title: `Coach ${c.name.split(' ').slice(-1)[0]}'s office`, body: openRequest(w) ? `He wants ${needDef(openRequest(w)!.key).need}.` : 'No open requests. Ask him about any player\'s role from the player card.', btn: 'Talk to the coach', go: () => openModal('coachTalk') },
    { tag: 'Scouting', cls: 'scout', due: 'Ongoing', title: `${S.year + 1} class: ${reports} report${reports === 1 ? '' : 's'}`, body: `${cls.length} prospects on our board. Ranges narrow with every report.`, btn: 'Open board', go: () => go('draft') },
  ];
  if (S.phase === 'regular' && S.day <= dl) out.push({ tag: 'League', cls: 'league', due: `Feb 15`, title: 'Trade deadline', body: 'Every GM has his own patience. Lowball him and the line goes dead for days.', btn: 'Trade finder', go: () => go('office', 'trade') });
  return out;
}

function GameControls({ w }: { w: World }) {
  const S = w.season, u = w.meta.userTeam;
  const alive = S.phase === 'playoffs' && (S.playoffs!.series.some(s => (s.hi === u || s.lo === u) && !s.winner) || (S.playoffs!.round === 1 && ['East', 'West'].some(c => ((S as any)[`seeds${c}`] as string[]).slice(0, 2).includes(u))));
  return <section class="gctl">
    <div class="gc-h">{S.phase === 'playoffs' ? 'Postseason' : S.phase === 'draft' || S.phase === 'freeagency' ? 'Offseason' : 'Tonight'}</div>
    {(S.phase === 'regular' || S.phase === 'preseason') && <>
      <Btn kind="prim" onClick={() => watchNext()}>{S.phase === 'preseason' ? 'Watch opening night' : 'Watch the game'}</Btn>
      <Btn onClick={() => sim('week')}>Sim a week</Btn>
      <Btn onClick={() => sim('month')}>Sim a month</Btn>
      <Btn kind="ghost" onClick={() => { if (confirm('Simulate the rest of the regular season? It still stops for critical decisions.')) sim('regular'); }}>Rest of season</Btn>
    </>}
    {S.phase === 'playoffs' && <>
      {alive && <Btn kind="prim" onClick={() => watchNext()}>Watch our next game</Btn>}
      <Btn onClick={() => sim('round')}>Sim the round</Btn>
      <Btn kind="ghost" onClick={() => sim('playoffs')}>Sim the playoffs</Btn>
    </>}
    {S.phase === 'draft' && <Btn kind="prim" onClick={() => go('draft')}>Go to the draft room</Btn>}
    {S.phase === 'freeagency' && <>
      <Btn kind="prim" onClick={() => go('office', 'contracts')}>Re-sign players</Btn>
      <Btn onClick={() => go('office', 'fa')}>Free agents</Btn>
    </>}
  </section>;
}

function Bosses({ w }: { w: World }) {
  const c = w.coaches[w.teams[w.meta.userTeam].coach];
  const word = (v: number) => v >= 70 ? 'Very happy' : v >= 50 ? 'Content' : v >= 32 ? 'Uneasy' : 'Angry';
  return <section class="bosses">
    <button data-nav class="boss2" onClick={() => openModal('ownerTalk')}><span>Owner · {shortName(w.owner.name)}</span><b>{word(w.owner.satisfaction)}</b><i class="meter"><i style={{ width: `${w.owner.satisfaction}%` }} /></i></button>
    <button data-nav class="boss2" onClick={() => openModal('coachTalk')}><span>Coach {c.name.split(' ').slice(-1)[0]}'s trust</span><b>{word(c.trustGM ?? 55)}</b><i class="meter"><i style={{ width: `${c.trustGM ?? 55}%` }} /></i></button>
  </section>;
}

export function Home() {
  const { world: w } = useStore();
  const S = w!.season;
  if (w!.meta.fired) return <Fired />;
  const t = w!.teams[w!.meta.userTeam];
  const showBracket = S.phase === 'playoffs' || S.phase === 'draft' || (S.phase === 'regular' && t.w + t.l >= 74);
  return <div class={`courtside ${showBracket ? 'po' : ''}`}>
    <GameControls w={w!} />
    <Scoreboard w={w!} />
    <button data-nav class="look-up" onClick={() => setUI({ rafters: true })}><span class="key">SPACE</span>Look up · Rafters</button>
    <Bosses w={w!} />
    <Chyron w={w!} />
    <Ticker w={w!} />
    {showBracket ? <section class="po-panel"><div class="f5-h"><h3>{S.phase === 'regular' ? 'Playoff picture' : `${seasonLabel(S.year)} playoffs`}</h3><span>{S.phase === 'regular' ? 'If the season ended today' : 'Division winners skip the best-of-three first round'}</span></div><Bracket w={w!} compact /></section>
      : <><Floor w={w!} /><div class="scorers" /><Decisions w={w!} /></>}
  </div>;
}

function Fired() {
  const { world: w } = useStore();
  const old = w!.teams[w!.meta.userTeam];
  return <div class="fired">
    <div class="fired-paper">
      <div class="paper-mast">The Evening Courier</div>
      <h1>{old.name} fire {w!.meta.gmName === 'General Manager' ? 'their general manager' : `general manager ${w!.meta.gmName}`}</h1>
      <p>{w!.owner.name} made the change after a {old.w}–{old.l} record fell short of what he expected. "We need a new direction," he said.</p>
    </div>
    <div class="fired-act">
      <Logo t={old} size={90} />
      <p>Teams with openings will take your call. Not every one will want you, but someone will.</p>
      <div class="row-btns"><Btn kind="big" auto onClick={() => openModal('jobs')}>Work the phones</Btn><Btn kind="ghost" onClick={() => { w!.meta.mode = 'sandbox'; w!.meta.fired = false; (w as any).jobMarket = undefined; commit(); }}>Stay on in sandbox mode</Btn></div>
    </div>
  </div>;
}
