// The locker room: what the culture is, who is shaping it, the bonds and fault lines, and what you have promised.
import { openModal } from '../store';
import { Panel, Chip, Headshot } from '../util';
import { playerValue } from '../../sim/coach';
import { culture, cultureBand, cultureSentence, isMonster, memoriesOf, mentalityWord, personaLabel, relationsOf, trustIn, trustWord } from '../../sim/people';
import type { Player, World } from '../../sim/types';
import { INDICATOR, dynOf, pressureWord, standingOf, teamPressure } from '../../sim/dynasty';

const GAUGES: [key: 'std' | 'uni' | 'edge' | 'poise', label: string, help: string][] = [
  ['std', 'Standard', 'How hard the group works and how much it demands of itself'],
  ['uni', 'Togetherness', 'Whether players pull for each other or for themselves'],
  ['edge', 'Edge', 'How hard it competes, and how willing it is to say the hard thing'],
  ['poise', 'Composure', 'How it holds up late in close games and in the playoffs'],
];
const TAG_KIND: Record<string, string> = { 'raises the standard': 'good', 'pulls the room together': 'good', 'brings an edge': 'warn', 'steadies things': '', 'divides the room': 'bad', 'more relaxed than the room': 'bad' };
const STATUS_KIND: Record<string, string> = { open: 'warn', kept: 'good', broken: 'bad', void: '' };

export function LockerRoom({ w }: { w: World }) {
  const t = w.teams[w.meta.userTeam];
  const c = culture(t);
  const ps = t.roster.map(id => w.players[id]).filter(Boolean).sort((a, b) => playerValue(b) - playerValue(a)) as Player[];
  const open = (p: Player) => openModal('player', { id: p.id });
  if (!c) return <Panel class="fill"><p class="muted">The locker room takes shape once the season starts.</p></Panel>;
  const ids = new Set(t.roster);
  // bonds and fault lines inside this roster, each pair once
  const seen = new Set<string>(), bonds: [Player, Player][] = [], cracks: [Player, Player][] = [];
  for (const p of ps) {
    const r = relationsOf(w, p.id);
    for (const x of r.close) { const k = [p.id, x.id].sort().join('|'); if (ids.has(x.id) && !seen.has('b' + k)) { seen.add('b' + k); bonds.push([p, w.players[x.id]]); } }
    for (const x of r.friction) { const k = [p.id, x.id].sort().join('|'); if (ids.has(x.id) && !seen.has('f' + k)) { seen.add('f' + k); cracks.push([p, w.players[x.id]]); } }
  }
  const mentors = ps.filter(p => (p as any).mentor && w.players[(p as any).mentor]?.team === t.id).map(p => [w.players[(p as any).mentor], p] as [Player, Player]);
  const promises = (w.promises ?? []).filter(x => ids.has(x.to) || x.status !== 'void' && w.players[x.to]?.team === t.id).slice(-8).reverse();
  const mem = ps.flatMap(p => memoriesOf(w, p.id, 2)).filter((m, i, a) => a.findIndex(x => x.t === m.t) === i).slice(0, 5);

  return <div class="lr">
    <Panel class="lr-culture" title="The culture">
      <div class="lr-label">{c.label}</div>
      <p class="lr-quote">{cultureSentence(w, t)}</p>
      <div class="lr-gauges">{GAUGES.map(([k, l, help]) => <div class="lr-g" title={help}>
        <span>{l}</span><div class="lr-bar"><i style={{ width: `${c[k]}%` }} /></div><em>{cultureBand(c[k])}</em></div>)}</div>
      <h4 class="lr-h">Who is shaping it</h4>
      <div class="lr-drivers">{c.drivers.map(d => { const p = w.players[d.pid]; if (!p) return null;
        return <button data-nav class="lr-d" onClick={() => open(p)}><Headshot p={p} size={44} /><span><b>{p.name}</b><small>{personaLabel(p) ?? `Mentality: ${mentalityWord(p)}`}</small></span><Chip kind={TAG_KIND[d.tag] ?? ''}>{d.tag}</Chip></button>; })}</div>
      <div class="foot-note">Culture moves with the people who hold influence: stars and long-tenured players most of all. It shapes practice habits, composure late in games, defensive communication and how free agents see you. It never adds shooting by itself. {c.roots >= 2 ? 'These habits have taken root and will outlast a departure or two.' : ''}</div>
    </Panel>

    <Panel class="lr-people" title="The people" right={<span class="muted small">Simulated personalities</span>}>
      <div class="lr-list">{ps.map(p => { const lead = c.leaders.includes(p.id); const tg = trustIn(w, p.id, 'gm');
        return <button data-nav class="lr-p" onClick={() => open(p)}>
          <Headshot p={p} size={38} />
          <span class="lr-pn"><b>{p.name}{lead && <Chip kind="warn">Leader</Chip>}{(p as any).wantsOut && <Chip kind="bad">Wants out</Chip>}</b>{personaLabel(p) && <small>{personaLabel(p)}</small>}</span>
          <span class={`lr-m ${isMonster(p) ? 'mon' : ''}`}>{mentalityWord(p)}</span>
          <span class="lr-t">{trustWord(tg)}</span>
        </button>; })}</div>
      <div class="lr-cols"><span>Mentality</span><span>Toward you</span></div>
    </Panel>

    <div class="lr-side">
      <DynastyPanel w={w} />
      <Panel title="Bonds and fault lines">
        {!bonds.length && !cracks.length && !mentors.length && <p class="muted small">Nothing strong either way yet. Bonds form over time together.</p>}
        {mentors.map(([a, b]) => <div class="lr-pair"><b>{a.name}</b><span>is mentoring</span><b>{b.name}</b></div>)}
        {bonds.slice(0, 4).map(([a, b]) => <div class="lr-pair good"><b>{a.name}</b><span>close with</span><b>{b.name}</b></div>)}
        {cracks.slice(0, 4).map(([a, b]) => <div class="lr-pair bad"><b>{a.name}</b><span>friction with</span><b>{b.name}</b></div>)}
      </Panel>
      <Panel title="Your promises">
        {!promises.length && <p class="muted small">You haven't promised anyone anything. Promises lift a player now and cost you his trust if you break them. Make one from a player's card.</p>}
        {promises.map(x => { const p = w.players[x.to]; return <div class="lr-pr"><span><b>{p?.name ?? 'Former player'}</b><small>{x.text ?? x.kind}</small></span><Chip kind={STATUS_KIND[x.status] ?? ''}>{x.status === 'open' ? `due ${x.due.slice(5).replace('-', '/')}` : x.status}</Chip></div>; })}
      </Panel>
      {mem.length > 0 && <Panel title="What they remember">
        {mem.map(m => <div class="lr-mem">{m.s}–{String(m.s + 1).slice(2)} · {m.t}</div>)}
      </Panel>}
    </div>
  </div>;
}

const EXP = (e: number) => e >= 1 ? 'Defending a title: anything less is failure.' : e >= 0.8 ? 'Title expectations.' : e >= 0.45 ? 'Playoff expectations.' : 'Low expectations.';
function DynastyPanel({ w }: { w: World }) {
  const t = w.teams[w.meta.userTeam];
  const D = dynOf(t);
  const pairs = Object.values(D.pairs).filter(p => w.players[p.n] && w.players[p.i]).sort((a, b) => b.strain - a.strain).slice(0, 2);
  if (!pairs.length && D.exp < 0.8 && !D.log.length) return null;
  const pr = teamPressure(t);
  const open = (id: string) => openModal('player', { id });
  return <Panel class="lr-dyn" title="Dynasty pressure" right={<span class={`lr-pw ${pr >= 65 ? 'hot' : pr >= 45 ? 'warm' : ''}`}>{pressureWord(pr)}</span>}>
    <p class="muted small">{EXP(D.exp)}</p>
    {!pairs.length && <p class="muted small">No clash at the top right now. It usually starts when a new star arrives and starts taking over a team someone else built.</p>}
    {pairs.map(P => { const N = w.players[P.n], I = w.players[P.i]; const sN = standingOf(w, N), sI = standingOf(w, I);
      return <div class="lr-dp">
        <div class="lr-dpn"><button data-nav onClick={() => open(N.id)}><b>{N.name}</b><small>{sN?.label}</small></button><span>and</span><button data-nav onClick={() => open(I.id)}><b>{I.name}</b><small>{sI?.label}</small></button></div>
        <div class="lr-g"><span>Strain</span><div class="lr-bar"><i style={{ width: `${P.strain}%` }} /></div><em>{pressureWord(P.strain)}</em></div>
        <div class="lr-inds">{P.inds.filter(x => x !== 'leadership').slice(0, 4).map(x => <Chip>{INDICATOR[x]}</Chip>)}</div>
        {P.griev >= 15 && <div class="small bad">Old grievances are building. Winning keeps them quiet; it doesn't make them go away.</div>}
      </div>; })}
    {D.log.slice(0, 3).map(l => <div class="lr-mem">{l.d.slice(5).replace('-', '/')} · {l.t}</div>)}
  </Panel>;
}
