import { useState } from 'preact/hooks';
import { signingCheck, capSeason, capRules, capRoom, teamPayroll, minSalary, yos, fmtM } from '../sim/cap';
import { maxFor, maxRaise, birdLevel, twoWaySalary, stretchTerms, canStretch, salaryAt } from '../sim/contracts';
import { faActive, faState, makeOffer, offersFor, ourOffer, withdrawOffer } from '../sim/market';
import { rules as eraRules, twoWayEligible } from '../sim/rules';
import { $y } from '../sim/history';
import { SeasonCard } from './screens/League';
import { TeamPage } from './screens/TeamPage';
import { positionsOf, makeGameplan } from '../sim/coach';
import { useStore, closeModal, commit, toast, openModal, go, setUI, ui } from './store';
import { Headshot, Logo, Btn, Chip, Meter, ht, f1, pct, seasonLabel, OvrBadge, injuryChip, seenOvr, CondBar } from './util';
import { MessageView, peopleEra } from './screens/People';
import { NeedImpact, ReqPanel } from './deal';
import { jobMarket, approachTeam, ensureOffer, takeJob, jobBar, MAX_APPROACHES } from '../sim/jobs';
import { BoxScore } from './screens/Games';
import { CLOCKS } from './Chrome';
import { CoachCard } from './screens/Staff';
import { perGame } from '../sim/league';
import { scoutReport, coachNeed, fireCoach, fmt$, marketSalary, playerAccepts, releasePlayer, requestCoach, setClock, signPlayer } from '../sim/gm';
import { potentialOvr } from '../sim/world';
import { seenRating, sdFor, reportsOn, scoutTrips, useScoutTrip, scoutPlayer } from '../sim/needs';
import { roles } from './screens/Roster';
import { hashStr } from '../sim/rng';
import type { Player, World } from '../sim/types';
import { TRAIT_KEYS, TRAIT_LABEL, TRAIT_SHORT, PROMISE_SHORT, PROMISE_TEXT, makePromise, isMonster, mentalityWord, orgTrustWord, personaBlurb, personaLabel, relationsOf, topMotives, trustWord } from '../sim/people';
import type { PromiseKind } from '../sim/people';
import { canRecruit, recruit, standingOf, strainOf } from '../sim/dynasty';

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
  // extension window: rookie-scale deals in their last season, veterans with two seasons or fewer (see contracts.ts)
  const expiring = mine && !!p.contract && !p.contract.twoWay && (p.contract.scale ? p.contract.years <= 1 : p.contract.years <= 2);
  const ask = (kind: 'more' | 'protect' | 'develop') => { const r = requestCoach(w, p.id, kind); setReply(r.text); commit(); };
  return <Shell wide cls="pmodal" title={<>{team && <Logo t={team} size={28} />} {p.name}</>}>
    <div class="pm">
      <div class="pm-l">
        <Headshot p={p} size={180} class="pm-hs" />
        <div class="pm-ovr">{est.exact ? <><b>{p.ovr}</b><small>Overall (coach's read)</small></> : <><b>{est.lo}–{est.hi}</b><small>Overall (scouting estimate)</small></>}</div>
        <div class="pm-bio">
          <div><span>Position</span><b title="Positions he can credibly play">{positionsOf(p).map(x => x.pos).join(' / ')}</b></div><div><span>Age</span><b>{p.age ?? '—'}</b></div>
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
        {mine ? <div class="pm-ratings">{GROUPS.map(([g, ks]) => <div class="rg"><h4>{g}</h4>{ks.map(([k, l]) => {
          const v = p.r[k];
          return <div class="rr"><span>{l}</span><div class="meter"><i style={{ width: `${(v - 20) / 0.75}%` }} /></div><b>{v}</b></div>; })}</div>)}</div>
          : <div class="pm-ratings">
            {p.scout && !p.team && <div class="rg wide"><h4>Prospect read</h4>
              <div class="rr"><span>Ready now</span><b class="nw">{p.scout.now.lo}–{p.scout.now.hi}</b></div>
              <div class="rr"><span>Ceiling</span><b class="nw">{p.scout.pot.lo}–{p.scout.pot.hi}</b></div></div>}
            {(p as any).preDraft && (!p.team || (p.draftClass ?? 0) >= w.season.year) && <div class="predraft wide"><h5>Pre-draft consensus</h5><p>{(p as any).preDraft}</p></div>}
            {GROUPS.map(([g, ks]) => <div class="rg"><h4>{g}</h4>{ks.map(([k, l]) => {
              const mid = seenRating(w, p, k), half = Math.max(2, sdFor(w, p) * 1.3);
              const lo = Math.round(mid - half), hi = Math.round(mid + half);
              const X = (v: number) => `${Math.max(0, Math.min(100, (v - 20) / 0.75))}%`;
              return <div class="rr est"><span>{l}</span><div class="rband"><i style={{ left: X(lo), width: `calc(${X(hi)} - ${X(lo)})` }} /><b style={{ left: X(mid) }} /></div><em>{word(mid)}</em><small>{lo}–{hi}</small></div>; })}</div>)}
          </div>}
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
        <Personality w={w} p={p} mine={mine} />
        <div class="pm-act">
          {!mine && !p.team && !p.retired && w.freeAgents.includes(p.id) && <div class="pm-fa"><Btn kind="sm" onClick={() => openModal('offer', { pid: p.id })}>{(p as any).bird === u ? 'Re-sign him' : 'Make an offer'}</Btn></div>}
          {!mine && !p.retired && <ScoutBox w={w} p={p} />}
          {mine && <>
            <h4>Ask the coach</h4>
            <div class="pm-role"><span>Coach's role</span><b>{roles(w)[p.id]?.role ?? '—'}{(() => { const sl = makeGameplan(w, w.teams[u], w.coaches[w.teams[u].coach]).slots?.[p.id]; return sl ? ` at ${sl}` : ''; })()}</b>{(roles(w)[p.id]?.min ?? 0) >= 4 && <small>~{Math.round(roles(w)[p.id].min)} min a night</small>}{w.teams[u].minutesRequests?.[p.id] && <small>Your last ask: {w.teams[u].minutesRequests![p.id].kind} · {w.teams[u].minutesRequests![p.id].status}</small>}</div>
            <Btn kind="sm" auto onClick={() => ask('more')}>More minutes</Btn>
            <Btn kind="sm" onClick={() => ask('protect')}>Manage his load</Btn>
            <Btn kind="sm" onClick={() => ask('develop')}>Development focus</Btn>
            {reply && <div class="reply">{reply}</div>}
            <h4>Front office</h4>
            {expiring && <Btn kind="sm" onClick={() => openModal('offer', { pid: p.id })}>Offer extension</Btn>}
            {p.contract?.twoWay && <Btn kind="sm" onClick={() => openModal('offer', { pid: p.id })}>Convert to a standard deal</Btn>}
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

const traitWord = (v: number) => v >= 95 ? 'Extreme' : v >= 85 ? 'Very high' : v >= 68 ? 'High' : v >= 45 ? 'Average' : v >= 30 ? 'Low' : 'Very low';
const PROMISE_KINDS: PromiseKind[] = ['role review', 'contend', 'no trade', 'extension'];
function Personality({ w, p, mine }: { w: World; p: Player; mine: boolean }) {
  // before he has played in the league the staff only has interviews and workouts: a partial read, no archetype
  const known = mine || (p.stats ?? []).some(x => x.g > 0) || !!p.retired;
  const label = known ? personaLabel(p) : null, blurb = known ? personaBlurb(p) : null;
  const keys = known ? TRAIT_KEYS : (['drive', 'discipline', 'poise', 'ego'] as const);
  const fuzz = (k: string) => known ? 0 : (Math.abs(hashStr(p.id + k)) % 15) - 7;
  const r = p.team ? relationsOf(w, p.id) : null;
  const open = (w.promises ?? []).filter(x => x.to === p.id && x.status === 'open');
  const past = (w.promises ?? []).filter(x => x.to === p.id && (x.status === 'kept' || x.status === 'broken')).slice(-2);
  const nm = (id: string) => w.players[id]?.name ?? '';
  return <>
    <h4>Personality</h4>
    <div class="pm-persona">{label && <Chip kind={isMonster(p) ? 'warn' : ''}>{label}</Chip>}<span>{known ? 'Mentality' : 'Scouts’ read on his mentality'}: <b>{mentalityWord(p, fuzz('m'))}</b></span></div>
    {blurb && <div class="muted small pm-blurb">{blurb}</div>}
    <div class="traits pm-traits">{keys.map(k => <div title={TRAIT_LABEL[k]}><span>{TRAIT_SHORT[k]}</span><em>{traitWord((p.traits[k] ?? 50) + fuzz(k))}</em></div>)}</div>
    {!known && <div class="muted small">Interviews and workouts only. The rest shows once he plays.</div>}
    {known && (p as any).motives && <div class="pm-drives"><span>What drives him</span><b>{topMotives(p, 3).join(', ')}</b></div>}
    {p.team && (() => { const s = standingOf(w, p); const st = strainOf(w, p); return s && <div class="pm-drives"><span>Standing</span><b>{s.label}{st.strain >= 45 ? ' · under strain' : ''}</b></div>; })()}
    {r && <div class="pm-rel">
      {mine && r.trustGM != null && <div><span>Toward you</span><b>{trustWord(r.trustGM)}</b></div>}
      {r.trustOrg != null && <div><span>Toward the team</span><b>{r.wantsOut ? 'Wants out' : orgTrustWord(r.trustOrg)}</b></div>}
      {r.close.length > 0 && <div><span>Close with</span><b>{r.close.map(x => x.name).join(', ')}</b></div>}
      {r.friction.length > 0 && <div><span>Friction with</span><b class="bad">{r.friction.map(x => x.name).join(', ')}</b></div>}
      {r.mentor && w.players[r.mentor]?.team === p.team && <div><span>Mentor</span><b>{nm(r.mentor)}</b></div>}
      {r.mentees.length > 0 && <div><span>Mentoring</span><b>{r.mentees.map(nm).join(', ')}</b></div>}
    </div>}
    {mine && <div class="pm-promise">
      <span class="pm-ph">Make a promise</span>
      {open.map(x => <div class="muted small">You promised: “{x.text ?? x.kind}” (due {x.due.slice(5).replace('-', '/')})</div>)}
      {past.map(x => <div class={`small ${x.status === 'broken' ? 'bad' : 'muted'}`}>{x.status === 'kept' ? 'Kept' : 'Broke'}: “{x.text ?? x.kind}”</div>)}
      <div class="pm-pb">{PROMISE_KINDS.filter(k => !open.some(x => x.kind === k) && (k !== 'extension' || (p.contract?.years ?? 0) <= 2)).map(k =>
        <Btn kind="sm ghost" onClick={() => { const t = makePromise(w, p.id, k); commit(); toast(t); }}>{PROMISE_SHORT[k]}</Btn>)}</div>
    </div>}
    {!mine && (() => { const R = canRecruit(w, p); return R && <div class="pm-pb"><Btn kind="sm ghost" onClick={() => { const t = recruit(w, p.id); commit(); toast(t); }}>Ask {R.name} to recruit him</Btn></div>; })()}
    <div class="muted small">{p.traitsNote || 'In this universe: simulated personality, not a claim about the real person.'}</div>
  </>;
}

function ScoutBox({ w, p }: { w: World; p: Player }) {
  const [rep, setRep] = useState<string | null>(null);
  const trips = scoutTrips(w);
  const n = reportsOn(w, p);
  const sd = sdFor(w, p);
  const q = sd <= 2.2 ? 'Sharp' : sd <= 3.4 ? 'Solid' : sd <= 5 ? 'Rough' : 'Shaky';
  return <div class="scoutbox">
    <h4>Our read on him</h4>
    <div class="sb2"><span>Reports filed</span><b>{n}</b></div>
    <div class="sb2"><span>Precision</span><b>{q}</b></div>
    <Btn kind="sm" auto disabled={trips.left <= 0} onClick={() => {
      useScoutTrip(w);
      const txt = p.scout && !p.team ? (scoutReport(w, p.id), 'Prospect report filed. Ranges updated.') : scoutPlayer(w, p);
      setRep(txt); commit();
    }}>Send a scout ({trips.left} of {trips.total} trips left)</Btn>
    {rep && <div class="reply">{rep}</div>}
    <div class="muted small">Each report narrows the ranges. A bigger scouting budget means more trips and sharper eyes.</div>
  </div>;
}

function OfferModal({ w, pid, msgId }: { w: World; pid: string; msgId?: string }) {
  const p = w.players[pid];
  const u = w.meta.userTeam;
  const cs = capSeason(w), R = capRules(cs), RR = eraRules(w);
  const t = w.teams[u];
  const extending = p.team === u && !!p.contract && p.contract.years > 0 && !p.contract.twoWay;
  const ours = (p as any).bird === u || p.team === u;
  const market = faActive(w) && !extending;
  const mxS = maxFor(p, u, extending ? cs + p.contract!.years : cs), mnS = minSalary(cs, yos(p));
  const askV = Math.min(p.ask ?? marketSalary(p, cs), mxS ?? Infinity);
  const prior = market ? ourOffer(w, pid) : undefined;
  const [sal, setSal] = useState(prior?.first ?? Math.round(askV / 5000) * 5000);
  const [yrs, setYrs] = useState(prior?.years ?? Math.min(3, Math.max(1, (p.age ?? 27) >= 31 ? 2 : 3)));
  const maxR = maxRaise(cs, !!birdLevel(p, u, cs));
  const [raise, setRaise] = useState(prior?.raise ?? Math.round(Math.min(maxR * 0.5, 0.05) * 200) / 200);
  const [opt, setOpt] = useState<'none' | 'player' | 'team'>((prior?.opts?.[0]?.kind as any) ?? 'none');
  const canTwoWay = !extending && twoWayEligible(w, p, yos(p));
  const [two, setTwo] = useState(!!prior?.twoWay);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  const yearsMax = extending ? R.maxYearsOwn : ours ? R.maxYearsOwn : R.maxYearsOther;
  const opts = opt !== 'none' && yrs >= 2 && !two ? [{ kind: opt, idx: yrs - 1 }] as any : [];
  const salary = two ? twoWaySalary(cs) : sal;
  const legal = signingCheck(w, u, p, salary, yrs, { twoWay: two });
  const tries = (p as any).offerTries ?? 0;
  const rivals = market ? offersFor(w, pid).filter(o => o.team !== u) : [];
  const decideAt = market ? faState(w).decideAt[pid] : undefined;
  const sched = Array.from({ length: yrs }, (_, k) => Math.round(salary * (1 + (two ? 0 : raise) * k) / 1000) * 1000);
  const go_ = () => {
    if (!legal.ok) { setRes({ ok: false, text: legal.reason ?? 'Not allowed under the rules.' }); return; }
    if (market) {
      const r = makeOffer(w, u, p, { first: salary, years: yrs, raise: two ? 0 : raise, opts, twoWay: two });
      if (!r.ok) { setRes({ ok: false, text: r.reason ?? 'Offer not allowed.' }); return; }
      const d = faState(w).decideAt[pid];
      const n = offersFor(w, pid).length;
      commit();
      setRes({ ok: true, text: `Offer on the table. ${n > 1 ? `He has ${n} offers` : 'Ours is his only offer so far'} and expects to decide around day ${Math.max(d ?? 0, faState(w).day + 1)} of free agency.` });
      return;
    }
    const r = playerAccepts(w, p, u, salary, yrs);
    (p as any).offerTries = tries + 1;
    if (r.ok) {
      const done = signPlayer(w, pid, u, salary, yrs, { raise: two ? 0 : raise, opts, twoWay: two });
      if (!done.ok) { setRes({ ok: false, text: done.reason ?? 'Not allowed.' }); return; }
      const m = msgId ? w.messages.find(x => x.id === msgId) : w.messages.find(x => !x.resolved && x.subject.includes(p.name) && x.role === 'Agent');
      if (m) m.resolved = true;
      (p as any).offerTries = 0;
      commit();
    } else if (tries >= 2) { p.ask = Math.round(askV * 1.04 / 5000) * 5000; commit(); }
    setRes(r);
  };
  const viaText: Record<string, string> = { room: 'Fits under the cap.', bird: `${legal.note ?? 'Bird rights'}: we can go over the cap to keep him.`, rookie: 'Draft pick: rookie contract.', mle: 'Uses our mid-level exception.', tpmle: 'Uses the taxpayer mid-level exception.',
    roomexc: 'Uses the room exception.', exception: 'Uses the $1m exception.', min: 'Minimum contract: always allowed.', budget: "Within the owner's budget (no cap in this era).", extension: 'Extension: added to his current deal.', twoway: `Two-way contract at ${fmtM(twoWaySalary(cs))}: outside the cap and the ${RR.max}, limited to ${RR.twoWayGames} games, no playoffs.` };
  return <Shell title={`${extending ? 'Extension' : ours ? 'Re-sign' : market ? 'Free agency offer' : 'Offer'}: ${p.name}`}>
    <div class="offer">
      <Headshot p={p} size={96} />
      <div>
        <div class="li"><span>Asking</span><b>{fmt$(askV)} / yr</b></div>
        <div class="li"><span>Age · seasons in league</span><b>{p.age} · {yos(p)}</b></div>
        <div class="li"><span>Payroll {cs}–{String(cs + 1).slice(2)}</span><b>{fmt$(teamPayroll(w, u))}{R.hasCap ? ` · cap ${fmtM(R.cap)}` : ` · owner budget ${fmt$(w.owner.budget)}`}</b></div>
        {R.hasCap && <div class="li"><span>Cap room</span><b>{fmtM(capRoom(w, u))}</b></div>}
        <div class="li"><span>{mxS ? 'Max · min' : 'League minimum'}</span><b>{mxS ? `${fmtM(mxS)} · ${fmtM(mnS)}` : fmtM(mnS)}</b></div>
        {market && <div class="li"><span>Market</span><b>{rivals.length ? `${rivals.length} other team${rivals.length > 1 ? 's' : ''} bidding` : 'No other offers yet'}{decideAt != null ? ` · decides ~day ${decideAt}` : ''}</b></div>}
        {(p as any).rfa && <div class="li"><span>Restricted</span><b>{w.teams[(p as any).rfa.team].name} can match{(p as any).rfa.team === u ? ' (that is us)' : ''}</b></div>}
      </div>
    </div>
    {res?.ok ? <><div class="reply ok">{res.text}</div><div class="row-btns"><Btn kind="big" auto onClick={closeModal}>Done</Btn></div></> : <>
      {canTwoWay && <div class="stepper"><span>Contract type</span>
        <button data-nav class={`btn sm ${!two ? '' : 'ghost'}`} onClick={() => setTwo(false)}>Standard</button><button data-nav class={`btn sm ${two ? '' : 'ghost'}`} onClick={() => setTwo(true)}>Two-way</button></div>}
      {!two && <div class="stepper"><span>{extending ? 'First new season' : 'First-year salary'}</span>
        <Btn kind="sm ghost" onClick={() => setSal(Math.max(mnS, sal - Math.max(5000, Math.round(R.cap * 0.005 / 5000) * 5000)))}>−</Btn><b>{fmt$(sal)}</b><Btn kind="sm ghost" onClick={() => setSal(Math.min(mxS ?? Infinity, sal + Math.max(5000, Math.round(R.cap * 0.005 / 5000) * 5000)))}>+</Btn>
        {legal.most != null && !legal.ok && <Btn kind="sm ghost" onClick={() => setSal(legal.most!)}>Most we can offer</Btn>}</div>}
      <div class="stepper"><span>{extending ? 'New seasons' : 'Years'}</span>
        {Array.from({ length: two ? 2 : yearsMax }, (_, i) => i + 1).map(y => <button data-nav class={`btn sm ${yrs === y ? '' : 'ghost'}`} onClick={() => setYrs(y)}>{y}</button>)}</div>
      {!two && yrs > 1 && <div class="stepper"><span>Annual raise</span>
        <Btn kind="sm ghost" onClick={() => setRaise(Math.max(0, Math.round((raise - 0.005) * 1000) / 1000))}>−</Btn><b>{(raise * 100).toFixed(1)}%</b><Btn kind="sm ghost" onClick={() => setRaise(Math.min(maxR, Math.round((raise + 0.005) * 1000) / 1000))}>+</Btn>
        <span class="muted small">max {(maxR * 100).toFixed(1)}%{cs < 1999 ? ' (no CBA limit yet)' : ''}</span></div>}
      {!two && yrs > 1 && !extending && <div class="stepper"><span>Final season</span>
        {(['none', 'player', 'team'] as const).map(k => <button data-nav class={`btn sm ${opt === k ? '' : 'ghost'}`} onClick={() => setOpt(k)}>{k === 'none' ? 'Guaranteed' : k === 'player' ? 'Player option' : 'Team option'}</button>)}</div>}
      <div class="sched">{sched.map((v, k) => <span class={opts.some((o: any) => o.idx === k) ? 'opt' : ''}><i>{seasonLabel(cs + (extending ? p.contract!.years : 0) + k)}</i>{fmtM(v)}</span>)}</div>
      <div class={`cap-line ${legal.ok ? 'ok' : 'bad'}`}>{legal.ok ? viaText[legal.via!] : legal.reason}</div>
      {!ours && !extending && !two && <NeedImpact w={w} after={[...t.roster, p.id]} />}
      {res && <div class="reply">{res.text}</div>}
      <div class="row-btns"><Btn kind="big" auto disabled={!legal.ok} onClick={go_}>{market ? (prior ? 'Update our offer' : 'Make the offer') : extending ? 'Offer the extension' : 'Make the offer'}</Btn>
        {prior && <Btn kind="ghost" onClick={() => { withdrawOffer(w, u, pid); commit(); closeModal(); toast('Offer withdrawn.'); }}>Withdraw offer</Btn>}
        <Btn kind="ghost" onClick={closeModal}>Walk away</Btn></div>
      <div class="muted small">{market ? 'Players weigh every offer: the money over the whole deal, the years, a winner, a role, and loyalty to the team that holds their Bird rights.' : 'Agents weigh money, role, years and whether you can win. Lowballing repeatedly makes them dig in.'}</div>
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
    case 'message': { const msg = w.messages.find(x => x.id === m.arg.id); return msg ? <Shell title="On your desk"><MessageView w={w} m={msg} inModal era={peopleEra(w)} /></Shell> : null; }
    case 'player': return w.players[m.arg.id] ? <PlayerModal w={w} id={m.arg.id} key={m.arg.id} /> : null;
    case 'team': return w.teams[m.arg.id] ? <Shell wide cls="team-modal" title={`${w.teams[m.arg.id].city} ${w.teams[m.arg.id].name}`}><TeamPage w={w} id={m.arg.id} key={m.arg.id} /></Shell> : null;
    case 'season': return <Shell wide cls="season-modal" title="Season record"><SeasonCard w={w} year={m.arg.year} /></Shell>;
    case 'box': { const g = w.season.games.find(x => x.id === m.arg.id); return g?.box ? <Shell wide title="Box score"><BoxScore w={w} g={g} /></Shell> : null; }
    case 'offer': return <OfferModal w={w} pid={m.arg.pid} msgId={m.arg.msgId} />;
    case 'release': { const p = w.players[m.arg.pid]; const c = p.contract; const left = c && !c.twoWay ? c.years : 0;
      const st = left > 0 && canStretch(capSeason(w)) ? stretchTerms(c!) : null;
      const owed = left > 0 ? Array.from({ length: left }, (_, k) => salaryAt(c, k)).reduce((a, b) => a + b, 0) : 0;
      return <Shell title={`Release ${p.name}?`}>
      <p>He'll become a free agent.{left > 0 ? ` His guaranteed money stays on our books as dead money: ${fmt$(owed)} over ${left} season${left > 1 ? 's' : ''}.` : c?.twoWay ? ' Two-way money does not touch the cap.' : ''}</p>
      {st && <p class="muted">Or waive and stretch: {fmt$(st.salary)} a season for {st.years} seasons (smaller hit now, longer on the books).</p>}
      <div class="row-btns"><Btn kind="big" auto onClick={() => { releasePlayer(w, p.id); closeModal(); commit(); toast(`${p.name} released.`); }}>Release him</Btn>
        {st && <Btn onClick={() => { releasePlayer(w, p.id, true); closeModal(); commit(); toast(`${p.name} waived and stretched.`); }}>Waive and stretch</Btn>}
        <Btn kind="ghost" onClick={closeModal}>Keep him</Btn></div></Shell>; }
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
