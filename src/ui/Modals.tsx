import { useState } from 'preact/hooks';
import { useStore, closeModal, commit, toast, openModal, go, setUI, ui } from './store';
import { Headshot, Logo, Btn, Chip, Meter, ht, f1, pct, seasonLabel, OvrBadge, injuryChip, seenOvr, CondBar } from './util';
import { MessageView } from './screens/People';
import { NeedImpact, ReqPanel } from './deal';
import { jobMarket, approachTeam, ensureOffer, takeJob, jobBar, MAX_APPROACHES } from '../sim/jobs';
import { BoxScore } from './screens/Games';
import { CLOCKS } from './Chrome';
import { CoachCard } from './screens/Staff';
import { perGame } from '../sim/league';
import { coachNeed, fireCoach, fmt$, marketSalary, playerAccepts, releasePlayer, requestCoach, setClock, signPlayer } from '../sim/gm';
import { potentialOvr } from '../sim/world';
import { hashStr } from '../sim/rng';
import type { Player, World } from '../sim/types';

function Shell({ title, children, wide, cls = '' }: { title?: any; children: any; wide?: boolean; cls?: string }) {
  return <div class="modal-bg" data-scope onClick={(e: any) => { if (e.target.classList.contains('modal-bg')) closeModal(); }}>
    <div class={`modal ${wide ? 'wide' : ''} ${cls}`}>
      {title && <div class="modal-h"><h3>{title}</h3><button data-nav class="x" onClick={closeModal}>✕</button></div>}
      <div class="modal-b">{children}</div>
    </div>
  </div>;
}

const GROUPS: [string, [keyof Player['r'], string][]][] = [
  ['Scoring', [['ins', 'Inside'], ['post', 'Post moves'], ['mid', 'Mid-range'], ['ft', 'Free throws'], ['drive', 'Driving']]],
  ['Playmaking', [['pass', 'Passing'], ['handle', 'Ball handling'], ['iq', 'Basketball IQ'], ['usage', 'Shot creation']]],
  ['Defense & boards', [['perD', 'Perimeter D'], ['intD', 'Interior D'], ['stl', 'Steals'], ['blk', 'Shot blocking'], ['oreb', 'Off. rebounding'], ['dreb', 'Def. rebounding']]],
  ['Physical', [['ath', 'Athleticism'], ['stamina', 'Stamina'], ['foulDraw', 'Draws fouls'], ['foulAvoid', 'Avoids fouls']]],
];
const word = (v: number) => v >= 80 ? 'Elite' : v >= 68 ? 'Very good' : v >= 56 ? 'Good' : v >= 44 ? 'Average' : v >= 34 ? 'Below avg' : 'Weak';

function PlayerModal({ w, id }: { w: World; id: string }) {
  const p = w.players[id];
  const u = w.meta.userTeam;
  const mine = p.team === u;
  const [reply, setReply] = useState<string | null>(null);
  const team = p.team ? w.teams[p.team] : null;
  const seasons = [...new Set((p.stats ?? []).map(s => s.season))].sort();
  const est = seenOvr(w, p);
  const expiring = mine && (p.contract?.years ?? 0) <= (w.season.phase === 'freeagency' ? 0 : 1);
  const ask = (kind: 'more' | 'protect' | 'develop') => { const r = requestCoach(w, p.id, kind); setReply(r.text); commit(); };
  return <Shell wide cls="pmodal" title={<>{team && <Logo t={team} size={28} />} {p.name}</>}>
    <div class="pm">
      <div class="pm-l">
        <Headshot p={p} size={180} class="pm-hs" />
        <div class="pm-ovr">{est.exact ? <><b>{p.ovr}</b><small>Overall (coach's read)</small></> : <><b>{est.lo}–{est.hi}</b><small>Overall (scouting estimate)</small></>}</div>
        <div class="pm-bio">
          <div><span>Position</span><b>{p.pos}</b></div><div><span>Age</span><b>{p.age ?? '—'}</b></div>
          <div><span>Height</span><b>{ht(p.hgt)}</b></div><div><span>Weight</span><b>{p.wgt ? `${p.wgt} lb` : '—'}</b></div>
          <div class="w"><span>College</span><b>{p.college ?? '—'}</b></div>
          <div class="w"><span>Team</span><b>{team ? `${team.city} ${team.name}` : p.retired ? 'Retired' : p.rosterStatus}</b></div>
          {p.draftPick && <div class="w"><span>Drafted</span><b>#{p.draftPick} by {p.draftedBy}</b></div>}
        </div>
        {injuryChip(p)}
        {mine && <div class="pm-mood"><span>Mood</span><Meter v={p.morale ?? 60} /></div>}
        <div class="pm-mood"><span>Condition</span><CondBar p={p} /></div>
        <div class="pm-mood"><span>Stamina</span><b>{mine ? p.r.stamina : word(p.r.stamina)}</b></div>
      </div>
      <div class="pm-m">
        {mine || !p.scout ? <div class="pm-ratings">{GROUPS.map(([g, ks]) => <div class="rg"><h4>{g}</h4>{ks.map(([k, l]) => {
          const v = mine ? p.r[k] : Math.round(p.r[k] + ((hashStr(w.meta.seed + p.id + k) % 11) - 5));
          return <div class="rr"><span>{l}</span>{mine ? <><div class="meter"><i style={{ width: `${(v - 20) / 0.75}%` }} /></div><b>{v}</b></> : <em>{word(v)}</em>}</div>; })}</div>)}</div>
          : <div class="pm-ratings"><div class="rg"><h4>Scouting report</h4>
            <div class="rr"><span>Ready now</span><b>{p.scout.now.lo}–{p.scout.now.hi}</b></div>
            <div class="rr"><span>Ceiling</span><b>{p.scout.pot.lo}–{p.scout.pot.hi}</b></div>
            <div class="rr"><span>Reports filed</span><b>{p.scout.now.reports}</b></div>
            <p class="muted small">Our department's belief, built from {p.scout.now.reports} report{p.scout.now.reports === 1 ? '' : 's'}. No one knows how a prospect turns out.</p></div></div>}
        {mine && (p.age ?? 30) <= 25 && <div class="muted small">Staff ceiling estimate: {Math.max(p.ovr, potentialOvr(p) - 4)}–{potentialOvr(p) + 4}</div>}
        <table class="tbl compact"><thead><tr><th class="l">Season</th><th class="l">Tm</th><th>G</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>FG%</th><th>FT%</th></tr></thead>
          <tbody>{seasons.flatMap(y => [false, true].map(po => { const s = perGame(p, y, po); if (!s.g) return null;
            return <tr><td class="l">{seasonLabel(y)}{po ? ' PO' : ''}</td><td class="l">{s.team}</td><td>{s.g}</td><td>{f1(s.mpg)}</td><td class="b">{f1(s.ppg)}</td><td>{f1(s.rpg)}</td><td>{f1(s.apg)}</td><td>{f1(s.spg)}</td><td>{f1(s.bpg)}</td><td>{pct(s.fgp)}</td><td>{pct(s.ftp)}</td></tr>; }))}
            {!seasons.length && <tr><td class="l muted" colSpan={11}>No games in this save yet.</td></tr>}</tbody></table>
        {(p.awards ?? []).length > 0 && <div class="pm-aw">{p.awards!.map(a => <Chip kind="good">{seasonLabel(a.season)} {a.award}</Chip>)}</div>}
      </div>
      <div class="pm-r">
        <h4>Contract</h4>
        {p.contract ? <><div class="pm-c"><b>{fmt$(p.contract.salary)}</b> / yr · {p.contract.years} yr{p.contract.years === 1 ? '' : 's'} left</div><div class="muted small">{p.contract.provenance}</div></>
          : <div class="pm-c">No contract{!p.retired && <> · asking about {fmt$(p.ask ?? marketSalary(p))}</>}</div>}
        <h4>Personality</h4>
        <div class="traits">{Object.entries(p.traits).map(([k, v]) => <div><span>{k}</span><em>{word(v)}</em></div>)}</div>
        <div class="muted small">{p.traitsNote}</div>
        <div class="pm-act">
          {mine && <>
            <h4>Ask the coach</h4>
            <Btn kind="sm" auto onClick={() => ask('more')}>More minutes</Btn>
            <Btn kind="sm" onClick={() => ask('protect')}>Manage his load</Btn>
            <Btn kind="sm" onClick={() => ask('develop')}>Development focus</Btn>
            {reply && <div class="reply">{reply}</div>}
            <h4>Front office</h4>
            {expiring && <Btn kind="sm" onClick={() => openModal('offer', { pid: p.id })}>{w.season.phase === 'freeagency' ? 'Re-sign' : 'Offer extension'}</Btn>}
            <Btn kind="sm ghost" onClick={() => { setUI({ tradeDraft: { other: ui.tradeDraft?.other ?? Object.keys(w.teams).find(x => x !== u)!, give: [p.id], get: [], givePicks: [], getPicks: [] } }); go('office', 'trade'); }}>Shop him in a trade</Btn>
            <Btn kind="sm ghost" onClick={() => openModal('release', { pid: p.id })}>Release</Btn>
          </>}
          {!mine && p.team && <Btn kind="sm" auto onClick={() => { setUI({ tradeDraft: { other: p.team!, give: [], get: [p.id], givePicks: [], getPicks: [] } }); go('office', 'trade'); }}>Ask {w.teams[p.team].city} about him</Btn>}
          {!p.team && !p.retired && w.freeAgents.includes(p.id) && <Btn kind="sm" auto onClick={() => openModal('offer', { pid: p.id })}>Make an offer</Btn>}
        </div>
      </div>
    </div>
  </Shell>;
}

function OfferModal({ w, pid, msgId }: { w: World; pid: string; msgId?: string }) {
  const p = w.players[pid];
  const u = w.meta.userTeam;
  const askV = p.ask ?? marketSalary(p);
  const [sal, setSal] = useState(Math.round(askV / 5000) * 5000);
  const [yrs, setYrs] = useState(Math.min(3, Math.max(1, (p.age ?? 27) >= 31 ? 2 : 3)));
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  const t = w.teams[u];
  const own = p.team === u;
  const inSeason = w.season.phase === 'regular' || w.season.phase === 'playoffs' || w.season.phase === 'preseason';
  const full = !own && t.roster.length >= (inSeason ? 12 : 15);
  const tries = (p as any).offerTries ?? 0;
  const go_ = () => {
    const r = playerAccepts(w, p, u, sal, yrs);
    (p as any).offerTries = tries + 1;
    if (r.ok) {
      if (own) p.contract = { salary: sal, years: yrs + (w.season.phase === 'freeagency' ? 0 : p.contract?.years ?? 0), known: null, provenance: 'Signed in this save (simulated)', signed: w.season.day };
      else signPlayer(w, pid, u, sal, yrs);
      const m = msgId ? w.messages.find(x => x.id === msgId) : w.messages.find(x => !x.resolved && x.subject.includes(p.name) && x.role === 'Agent');
      if (m) m.resolved = true;
      (p as any).offerTries = 0;
      commit();
    } else if (tries >= 2) { p.ask = Math.round(askV * 1.04 / 5000) * 5000; commit(); }
    setRes(r);
  };
  return <Shell title={`${own ? 'Contract talks' : 'Offer'}: ${p.name}`}>
    <div class="offer">
      <Headshot p={p} size={96} />
      <div>
        <div class="li"><span>Asking</span><b>{fmt$(askV)} / yr</b></div>
        <div class="li"><span>Age · position</span><b>{p.age} · {p.pos}</b></div>
        <div class="li"><span>Payroll now</span><b>{fmt$(w.teams[u].roster.reduce((s, id) => s + (w.players[id].contract?.salary ?? 0), 0))} of {fmt$(w.owner.budget)}</b></div>
      </div>
    </div>
    {res?.ok ? <><div class="reply ok">{res.text}</div><div class="row-btns"><Btn kind="big" auto onClick={closeModal}>Done</Btn></div></> : <>
      <div class="stepper"><span>Salary per year</span>
        <Btn kind="sm ghost" onClick={() => setSal(Math.max(30000, sal - 10000))}>−</Btn><b>{fmt$(sal)}</b><Btn kind="sm ghost" onClick={() => setSal(sal + 10000)}>+</Btn></div>
      <div class="stepper"><span>Years</span>
        {[1, 2, 3, 4, 5].map(y => <button data-nav class={`btn sm ${yrs === y ? '' : 'ghost'}`} onClick={() => setYrs(y)}>{y}</button>)}</div>
      {!own && <NeedImpact w={w} after={[...t.roster, p.id]} />}
      {full && <div class="reply bad">Roster is full ({t.roster.length}). Release someone first.</div>}
      {res && <div class="reply">{res.text}</div>}
      <div class="row-btns"><Btn kind="big" auto disabled={full} onClick={go_}>Make the offer</Btn><Btn kind="ghost" onClick={closeModal}>Walk away</Btn></div>
      <div class="muted small">Agents weigh money, role, years and whether you can win. Lowballing repeatedly makes them dig in.</div>
    </>}
  </Shell>;
}

export function ClockPicker() {
  const { world: w } = useStore();
  const desc: Record<string, string> = {
    'Rebuilding': 'Future first. Young players and picks matter most; the owner must accept losing.',
    'Building': 'Developing a core. Balanced value, leaning to youth.',
    'Contending': 'Competing for the playoffs now while protecting the future.',
    'Win Now': 'Everything for this season. Veterans and immediate help.',
  };
  return <div class="clockp">
    {CLOCKS.map(c => <button data-nav class={`cp ${w!.clock === c ? 'on' : ''}`} data-autofocus={w!.clock === c ? '' : undefined} onClick={() => { if (w!.clock !== c) { setClock(w!, c); commit(); toast(`Franchise clock: ${c}`); } }}>
      <b>{c}</b><small>{desc[c]}</small></button>)}
    <div class="muted small">The clock tells your staff, the coach and other GMs how to value players and picks. The owner has his own view of where the team should be.</div>
  </div>;
}

function CoachTalk({ w }: { w: World }) {
  const t = w.teams[w.meta.userTeam];
  const c = w.coaches[t.coach];
  const n = coachNeed(w);
  const last = c.name.split(' ').slice(-1)[0];
  return <Shell title={`Coach ${last}'s office`}>
    <CoachCard c={c} compact />
    <div class="quote">"{n.detail} If you can find me {n.need}, we're a better team."</div>
    <ReqPanel w={w} />
    <div class="li"><span>His trust in you</span><Meter v={c.trustGM ?? 55} /></div>
    <div class="row-btns"><Btn kind="big" auto onClick={() => go('office', 'trade')}>Look for {n.need}</Btn><Btn kind="ghost" onClick={closeModal}>Thanks, coach</Btn></div>
    <div class="muted small">You can ask about any player's role from his player card. The coach decides the rotation.</div>
  </Shell>;
}

function OwnerTalk({ w }: { w: World }) {
  const [r, setR] = useState<string | null>(null);
  const asked = (w as any).budgetAsked === w.season.year;
  const askBudget = () => {
    (w as any).budgetAsked = w.season.year;
    if (w.owner.satisfaction >= 60) { w.owner.budget = Math.round(w.owner.budget * 1.06 / 10000) * 10000; setR(`"You've earned some room. Budget is now ${fmt$(w.owner.budget)}."`); }
    else { w.owner.satisfaction = Math.max(0, w.owner.satisfaction - 2); setR(`"Not until I see results."`); }
    commit();
  };
  return <Shell title={`${w.owner.name}'s box`}>
    <div class="li"><span>Satisfaction</span><Meter v={w.owner.satisfaction} /></div>
    <div class="quote">"{w.owner.objective}"</div>
    <div class="li"><span>Budget</span><b>{fmt$(w.owner.budget)}</b></div>
    {r && <div class="reply">{r}</div>}
    <div class="row-btns"><Btn kind="big" auto disabled={asked} onClick={askBudget}>{asked ? 'Already asked this season' : 'Ask for more payroll'}</Btn><Btn kind="ghost" onClick={closeModal}>Leave</Btn></div>
  </Shell>;
}

export function Modals() {
  const { world: w, ui: u } = useStore();
  const m = u.modal!;
  if (!w) return null;
  switch (m.kind) {
    case 'message': { const msg = w.messages.find(x => x.id === m.arg.id); return msg ? <Shell title="On your desk"><MessageView w={w} m={msg} inModal /></Shell> : null; }
    case 'player': return w.players[m.arg.id] ? <PlayerModal w={w} id={m.arg.id} key={m.arg.id} /> : null;
    case 'box': { const g = w.season.games.find(x => x.id === m.arg.id); return g?.box ? <Shell wide title="Box score"><BoxScore w={w} g={g} /></Shell> : null; }
    case 'offer': return <OfferModal w={w} pid={m.arg.pid} msgId={m.arg.msgId} />;
    case 'release': { const p = w.players[m.arg.pid]; return <Shell title={`Release ${p.name}?`}>
      <p>He'll become a free agent. {p.contract && p.contract.years > 0 ? `In this alpha, his remaining salary (${fmt$(p.contract.salary)} × ${p.contract.years}) comes off the books.` : ''}</p>
      <div class="row-btns"><Btn kind="big" auto onClick={() => { releasePlayer(w, p.id); closeModal(); commit(); toast(`${p.name} released.`); }}>Release him</Btn><Btn kind="ghost" onClick={closeModal}>Keep him</Btn></div></Shell>; }
    case 'clock': return <Shell title="Franchise clock"><ClockPicker /></Shell>;
    case 'coachTalk': return <CoachTalk w={w} />;
    case 'ownerTalk': return <OwnerTalk w={w} />;
    case 'fireCoach': { const nu = w.coaches[m.arg.id]; const old = w.coaches[w.teams[w.meta.userTeam].coach];
      return <Shell title="Make a coaching change?"><p>Fire <b>{old.name}</b> and hire <b>{nu.name}</b>? The players, the owner and the press will all have an opinion.</p>
        <div class="row-btns"><Btn kind="big" onClick={() => { fireCoach(w, nu.id); closeModal(); commit(); toast(`${nu.name} is your new head coach.`); }}>Make the change</Btn><Btn kind="ghost" auto onClick={closeModal}>Not yet</Btn></div></Shell>; }
    case 'jobs': return <JobsModal w={w} />;
    case 'notice': return <Shell title={m.arg.title}><p>{m.arg.body}</p><div class="row-btns"><Btn kind="big" auto onClick={closeModal}>OK</Btn></div></Shell>;
  }
  return null;
}
export { OvrBadge };

function JobsModal({ w }: { w: World }) {
  const jm = jobMarket(w);
  const [log, setLog] = useState<string[]>([]);
  if (!jm) return <Shell title="Job market"><p>No openings right now.</p></Shell>;
  const call = (tid: string) => { const r = approachTeam(w, tid); const fb = ensureOffer(w); setLog([...log, r.text, ...(fb ? [`The phone rings: ${w.teams[fb].owner} of the ${w.teams[fb].city} ${w.teams[fb].name} wants to talk. The job is yours if you want it.`] : [])]); commit(); };
  const left = MAX_APPROACHES - jm.approached.length;
  return <Shell wide title="Work the phones">
    <p class="muted">Five teams are looking for a general manager. You can make {MAX_APPROACHES} calls. Better teams are pickier; your reputation is {Math.round(w.gmRep)}/100. If nobody you call bites, someone else will call you.</p>
    <div class="jobs">{jm.openings.map(id => { const t = w.teams[id]; const st = jm.offers.includes(id) ? 'offer' : jm.declined.includes(id) ? 'no' : jm.approached.includes(id) ? 'called' : '';
      return <div class={`job ${st}`}>
        <Logo t={t} size={64} /><div class="job-i"><b>{t.city} {t.name}</b><small>{t.w}–{t.l} · owner {t.owner} · {t.clock}</small>
          <small>{jobBar(w, id) > w.gmRep + 8 ? 'A reach for your résumé' : jobBar(w, id) > w.gmRep - 4 ? 'Could go either way' : 'They should be interested'}</small></div>
        {st === 'offer' ? <Btn kind="big" auto onClick={() => { takeJob(w, id); setUI({ modal: null, screen: 'home' }); commit(); toast(`You're the new GM of the ${t.city} ${t.name}.`); }}>Take the job</Btn>
          : st === 'no' ? <Chip kind="bad">Not interested</Chip>
            : <Btn disabled={left <= 0} onClick={() => call(id)}>Call {t.owner.split(' ').slice(-1)[0]}</Btn>}
      </div>; })}</div>
    {log.length > 0 && <div class="job-log">{log.map(l => <div class="reply">{l}</div>)}</div>}
  </Shell>;
}
