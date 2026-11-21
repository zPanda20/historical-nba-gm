// A club's own page: who they are this season (logo, wordmark, uniforms, floor), the five their coach starts,
// and the whole roster. Other teams' ratings stay scouting ranges; the coach decides the lineup, not us.
import { openModal } from '../store';
import { Logo, Headshot, OvrBadge, seenOvr, f1, ht, injuryChip, place, seasonLabel } from '../util';
import { standings, perGame } from '../../sim/league';
import { fmt$ } from '../../sim/gm';
import { makeGameplan, playerValue, positionsOf, POSITIONS, PosKey } from '../../sim/coach';
import { courtFor, uniformFor, wordmarkFor } from '../../sim/history';
import type { Player, World } from '../../sim/types';
import { culture } from '../../sim/people';

const POS_NAME: Record<string, string> = { PG: 'Point guard', SG: 'Shooting guard', SF: 'Small forward', PF: 'Power forward', C: 'Center' };
const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

export function TeamPage({ w, id }: { w: World; id: string }) {
  const t = w.teams[id];
  if (!t) return null;
  const y = w.season.year;
  const mine = id === w.meta.userTeam;
  const coach = w.coaches[t.coach];
  const court = courtFor(id, y), word = wordmarkFor(id, y), home = uniformFor(id, y, 'home'), road = uniformFor(id, y, 'road');
  const confRank = standings(w, t.conf).findIndex(x => x.id === id) + 1;
  const divRank = standings(w, t.conf).filter(x => x.div === t.div).findIndex(x => x.id === id) + 1;
  const g = t.w + t.l;

  const roster = t.roster.map(pid => w.players[pid]).filter(Boolean) as Player[];
  const plan = coach ? makeGameplan(w, t, coach) : null;
  const slots = (plan?.slots ?? {}) as Record<string, PosKey>;
  const five = POSITIONS.map(pos => { const pid = Object.keys(slots).find(k => slots[k] === pos); return pid ? { pos, p: w.players[pid] } : null; }).filter(Boolean) as { pos: PosKey; p: Player }[];
  const starters = new Set(five.map(x => x.p.id));
  const mins = plan?.targetMin;
  const bench = roster.filter(p => !starters.has(p.id)).sort((a, b) => (mins?.[b.id] ?? 0) - (mins?.[a.id] ?? 0) || playerValue(b) - playerValue(a));
  const ordered = [...five.map(x => x.p), ...bench];
  const last = t.history.slice(-5).reverse();
  const open = (p: Player) => openModal('player', { id: p.id });

  return <div class="tp" style={{ '--tc1': t.colors?.[0] ?? '#333', '--tc2': t.colors?.[1] ?? '#c9a227' } as any}>
    <header class="tp-head">
      {court && <img class="tp-court" src={court} alt="" draggable={false} />}
      <div class="tp-id">
        <Logo t={t} size={104} />
        <div class="tp-name">
          {word ? <img class="tp-word" src={word} alt={`${t.city} ${t.name}`} draggable={false} /> : <h2>{t.city} <b>{t.name}</b></h2>}
          {word && <span class="tp-city">{t.city} {t.name}</span>}
          <div class="tp-facts">
            <span><b>{t.w}–{t.l}</b>{g ? ` · ${ord(confRank)} in the ${t.conf}, ${ord(divRank)} in the ${t.div}` : ` · ${seasonLabel(y)} has not started`}</span>
            <span>Coach <b>{coach?.name ?? '—'}</b></span>
            {t.arena && <span>Home floor <b>{t.arena}</b></span>}
            <span>Owner <b>{t.owner}</b></span>
            {culture(t) && <span>Locker room <b>{culture(t)!.label}</b>{culture(t)!.leaders[0] && w.players[culture(t)!.leaders[0]] ? ` · set by ${w.players[culture(t)!.leaders[0]].name}` : ''}</span>}
          </div>
        </div>
      </div>
      {(home || road) && <div class="tp-kits">
        {home && <figure><img src={home} alt="" draggable={false} /><figcaption>Home</figcaption></figure>}
        {road && <figure><img src={road} alt="" draggable={false} /><figcaption>Road</figcaption></figure>}
      </div>}
    </header>

    <section class="tp-five">
      <div class="tp-sh"><h4>Starting five</h4><span>{coach ? `As ${coach.name} would start tonight` : 'No coach in place'}{!mine && ' · ratings are your scouts’ estimates'}</span></div>
      <div class="tp-five-row">{five.length ? five.map(({ pos, p }) => {
        const s = perGame(p, y);
        return <button data-nav class="tp-st" onClick={() => open(p)}>
          <span class="tp-pos" title={POS_NAME[pos]}>{pos}</span>
          <Headshot p={p} size={78} />
          <b>{p.name}</b>
          <small>{ht(p.hgt)} · {p.age ?? '—'} yrs</small>
          <span class="tp-st-l">{s.g ? `${f1(s.ppg)} pts · ${f1(s.rpg)} reb · ${f1(s.apg)} ast` : 'No games yet'}</span>
          <OvrBadge w={w} p={p} />
          {injuryChip(p)}
        </button>;
      }) : <p class="muted">Not enough healthy players to name a five.</p>}</div>
    </section>

    <section class="tp-roster">
      <div class="tp-sh"><h4>Full roster</h4><span>{roster.length} players{mine ? '' : ' · OVR shown as a scouting range'}</span></div>
      <table class="tbl compact tp-tbl"><thead><tr><th class="l">Player</th><th class="l">Pos</th><th>Age</th><th>Ht</th><th>OVR</th><th>G</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>Salary</th><th>Yrs</th></tr></thead>
        <tbody>{ordered.map(p => { const s = perGame(p, y); const so = seenOvr(w, p); return <tr class={starters.has(p.id) ? 'st' : ''} onClick={() => open(p)}>
          <td class="l"><button data-nav class="tp-pl" onClick={(e: any) => { e.stopPropagation(); open(p); }}><Headshot p={p} size={28} /><span>{p.name}</span>{starters.has(p.id) && <em>Starter</em>}</button></td>
          <td class="l">{positionsOf(p).map(x => x.pos).join('/')}</td><td>{p.age ?? '—'}</td><td>{ht(p.hgt)}</td>
          <td>{so.exact ? <span class="ovr">{so.mid}</span> : <span class="ovr est">{so.lo}–{so.hi}</span>}</td>
          <td>{s.g || '—'}</td><td>{s.g ? f1(s.mpg) : '—'}</td><td>{s.g ? f1(s.ppg) : '—'}</td><td>{s.g ? f1(s.rpg) : '—'}</td><td>{s.g ? f1(s.apg) : '—'}</td>
          <td>{p.contract ? fmt$(p.contract.salary) : '—'}</td><td>{p.contract?.years ?? '—'}</td>
        </tr>; })}</tbody></table>
    </section>

    {last.length > 0 && <section class="tp-past"><div class="tp-sh"><h4>Recent seasons</h4></div>
      <div class="tp-past-row">{last.map(h => <span><i>{seasonLabel(h.season)}</i><b>{h.w}–{h.l}</b>{h.result}</span>)}</div></section>}
    <p class="tp-foot muted">{place(t)} · {t.conf}ern Conference · {t.div} Division</p>
  </div>;
}
