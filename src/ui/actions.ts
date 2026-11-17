// Game-flow actions the UI can trigger. All simulation goes through the sim modules; the UI never scripts outcomes.
import type { GameRec, Message, World } from '../sim/types';
import { createWorld, addMessage, addEvent } from '../sim/world';
import { advanceDay, addDays, runDraftUntilUser, makePick, startNextSeason, projectedWinsCache, nextUnplayedDate } from '../sim/league';
import { aiFreeAgency, executeTrade, evaluateTrade, requestCoach, releasePlayer, TRADE_DEADLINE } from '../sim/gm';
import { projectedWins } from '../sim/world';
import { commit, getWorld, go, openModal, runBusy, setUI, setWorld, toast, ui } from './store';

let DATA: any = null;
export async function loadData() {
  if (DATA) return DATA;
  const r = await fetch('data/world1976.json');
  DATA = await r.json();
  return DATA;
}
export function startNewGame(data: any, opts: { userTeam: string; mode: 'career' | 'sandbox'; gmName: string; seed?: string }) {
  const w = createWorld(data, opts);
  Object.assign(projectedWinsCache, projectedWins(w));
  addMessage(w, { date: w.season.day, from: w.owner.name, role: 'Owner', subject: 'Welcome aboard', body: `Welcome to the ${w.teams[opts.userTeam].city} ${w.teams[opts.userTeam].name}. ${w.owner.objective} The coach runs the team on the floor; you run everything else.`, urgent: 1, tag: 'Owner', actions: [{ label: 'Understood', cmd: 'dismiss' }] });
  setWorld(w);
  setUI({ mode: 'game', screen: 'home', modal: null, rafters: false, settings: false });
  commit();
}
export function enterLoaded(w: World) {
  tidyMessages(w);
  Object.assign(projectedWinsCache, projectedWins(w));
  setWorld(w);
  setUI({ mode: 'game', screen: 'home', modal: null, rafters: false, settings: false, gamecast: null });
}

const user = () => getWorld().meta.userTeam;
export function nextUserGame(w: World): GameRec | undefined {
  return w.season.games.find(g => !g.played && (g.home === w.meta.userTeam || g.away === w.meta.userTeam));
}
export function lastUserGame(w: World): GameRec | undefined {
  const gs = w.season.games.filter(g => g.played && (g.home === w.meta.userTeam || g.away === w.meta.userTeam));
  return gs[gs.length - 1];
}
/** Keep the desk clean: FYI notes expire, stale decisions close, phase-bound items close with their phase. */
export function tidyMessages(w: World) {
  const day = w.season.day;
  const age = (d: string) => (new Date(day + 'T12:00:00Z').getTime() - new Date(d + 'T12:00:00Z').getTime()) / 86400000;
  for (const m of w.messages) {
    if (m.resolved) continue;
    const fyi = !m.actions?.length || m.actions.every(a => a.cmd === 'dismiss');
    if (fyi && (age(m.date) > (m.read ? 2 : 12))) m.resolved = true;
    if (m.deadline && m.deadline < day) m.resolved = true;
    if (m.tag === 'Scouting' && /draft/i.test(m.subject) && m.urgent >= 3 && w.season.phase !== 'draft') m.resolved = true;
    if (m.tag === 'Scouting' && m.urgent === 0 && age(m.date) > 20) m.resolved = true;
    if (m.subject.includes('Trade offer') && w.season.phase !== 'regular') m.resolved = true;
    if (age(m.date) > 120) m.resolved = true;
    if (m.tag === 'Coach request' && w.season.phase !== 'regular') m.resolved = true;
  }
  const req = (w as any).coachRequest;
  if (req && req.status === 'open' && w.season.phase !== 'regular') req.status = 'expired';
}
const urgentCount = (w: World) => w.messages.filter(m => !m.resolved && m.urgent >= 3).length;

/** Advance with a stop rule. Stops early for critical decisions (urgent 3 messages) and phase changes. */
export function sim(kind: 'day' | 'game' | 'week' | 'month' | 'regular' | 'round' | 'playoffs', after?: () => void) {
  const w = getWorld();
  const S = w.season;
  const startPhase = S.phase, startDay = S.day, u0 = urgentCount(w);
  const startRound = S.playoffs?.round ?? 0;
  const target = kind === 'week' ? addDays(S.day, 7) : kind === 'month' ? addDays(S.day, 30) : null;
  const userGame = kind === 'game' ? nextUserGame(w) : undefined;
  const label = { day: 'Simulating the day', game: 'Simulating to the next game', week: 'Simulating the week', month: 'Simulating the month', regular: 'Simulating the regular season', round: 'Simulating the round', playoffs: 'Simulating the playoffs' }[kind];
  let steps = 0;
  runBusy(label, () => {
    if (S.phase !== 'preseason' && S.phase !== 'regular' && S.phase !== 'playoffs') return false;
    advanceDay(w); steps++;
    if (S.phase !== startPhase && startPhase !== 'preseason') return false;
    if (startPhase === 'preseason' && kind !== 'regular') return false;
    if (kind === 'regular' && S.phase !== 'regular') return false;
    if (urgentCount(w) > u0) return false;
    if (kind === 'day') return false;
    if (kind === 'game') return !!userGame && !userGame.played;
    if (target) return S.day < target;
    if (kind === 'round') return (S.playoffs?.round ?? 0) === startRound && S.phase === 'playoffs';
    return true;
  }, () => {
    tidyMessages(w);
    const lg = lastUserGame(w);
    if (kind === 'game' && lg && userGame && lg.id === userGame.id) toast(resultLine(w, lg));
    else if (steps > 1) toast(`${steps} days simulated · now ${S.day}`);
    void startDay;
    after?.();
  });
}

export function resultLine(w: World, g: GameRec) {
  const u = w.meta.userTeam;
  const us = g.home === u ? g.hs! : g.as!, them = g.home === u ? g.as! : g.hs!;
  const opp = w.teams[g.home === u ? g.away : g.home];
  return `${us > them ? 'W' : 'L'} ${us}–${them} ${g.home === u ? 'vs' : 'at'} ${opp.name}${g.ot ? ` (${g.ot > 1 ? g.ot : ''}OT)` : ''}`;
}

/** Watch: advance to the user's next game day, play the day (same engine as fast sim), then replay the gamecast. */
export function watchNext() {
  const w = getWorld();
  const S = w.season;
  if (S.phase === 'preseason') advanceDay(w);
  const g = S.phase === 'playoffs' ? null : nextUserGame(w);
  if (S.phase === 'playoffs') {
    const before = S.games.length;
    const u0 = urgentCount(w);
    runBusy('Getting to the arena', () => {
      advanceDay(w);
      const mine = S.games.slice(before).find(x => x.home === user() || x.away === user());
      if (mine || S.phase !== 'playoffs' || urgentCount(w) > u0) return false;
      return true;
    }, () => {
      const mine = S.games.slice(before).find(x => x.home === user() || x.away === user());
      if (mine) setUI({ gamecast: mine.id }); else toast('We have no playoff game to watch.');
    });
    return;
  }
  if (!g) { toast('No game left to watch.'); return; }
  const u0 = urgentCount(w);
  runBusy('Getting to the arena', () => {
    advanceDay(w);
    if (g.played) return false;
    if (urgentCount(w) > u0) return false;
    return S.phase === 'regular';
  }, () => {
    tidyMessages(w);
    if (g.played) setUI({ gamecast: g.id });
    else toast('Something needs your attention before tip-off.');
  });
}

// ------------------------------------------------------------------ draft
export function draftToMyPick() {
  const w = getWorld();
  if (!w.season.draft) return;
  const r = runDraftUntilUser(w, false);
  tidyMessages(w);
  commit();
  if (r === 'done') toast('The draft is complete. Free agency is open.');
}
export function draftPlayer(pid: string) {
  const w = getWorld();
  const D = w.season.draft!;
  if (D.order[D.idx]?.team !== w.meta.userTeam) return;
  const pick = D.order[D.idx];
  makePick(w, pid);
  toast(`With pick #${pick.pick}, we select ${w.players[pid].name}.`);
  const r = runDraftUntilUser(w, false);
  tidyMessages(w);
  commit();
  if (r === 'done') toast('The draft is complete. Free agency is open.');
}
export function autoDraftRest() {
  const w = getWorld();
  runDraftUntilUser(w, true);
  tidyMessages(w);
  commit();
  toast('Draft complete — your scouts made the remaining picks off our board.');
}

// ------------------------------------------------------------------ offseason → next season
export function seasonStartProblems(w: World): string[] {
  const t = w.teams[w.meta.userTeam];
  const out: string[] = [];
  const active = t.roster.filter(id => (w.players[id].contract?.years ?? 0) > 0);
  if (active.length > 12) out.push(`Roster has ${active.length} players under contract — cut to 12.`);
  if (active.length < 8) out.push(`Only ${active.length} players under contract — sign at least ${8 - active.length} more.`);
  return out;
}
export function beginNextSeason() {
  const w = getWorld();
  const t = w.teams[w.meta.userTeam];
  // unsigned expiring players walk
  for (const id of [...t.roster]) {
    const p = w.players[id];
    if ((p.contract?.years ?? 0) <= 0) { releasePlayer(w, id); p.rosterStatus = `Free agent (was ${t.abbr})`; }
  }
  for (const m of w.messages) if (!m.resolved) m.resolved = true;
  runBusy('Opening a new season', () => { aiFreeAgency(w); startNextSeason(w); return false; }, () => { go('home'); toast(`Welcome to the ${w.season.year}–${String(w.season.year + 1).slice(2)} season.`); });
}

// ------------------------------------------------------------------ message commands
export function runCommand(m: Message, a: { label: string; cmd: string; arg?: any }) {
  const w = getWorld();
  const resolve = () => { m.resolved = true; m.read = true; };
  switch (a.cmd) {
    case 'dismiss': resolve(); break;
    case 'goto': {
      m.read = true;
      if (a.arg === 'trade') { go('office', 'trade'); }
      else if (a.arg === 'fa') go('office', 'fa');
      else if (a.arg === 'draft') go('draft');
      else if (a.arg === 'office') go('office', 'contracts');
      else go(a.arg);
      commit(); return;
    }
    case 'coachDiscuss': { m.read = true; openModal('coachTalk'); commit(); return; }
    case 'extend': { m.read = true; openModal('offer', { pid: a.arg.pid, msgId: m.id }); commit(); return; }
    case 'letGo': {
      const p = w.players[a.arg.pid];
      if (p.team === w.meta.userTeam) { releasePlayer(w, p.id); p.rosterStatus = `Free agent (was ${w.teams[w.meta.userTeam].abbr})`; }
      resolve(); toast(`${p.name} will test free agency.`); break;
    }
    case 'jobs': { m.read = true; openModal('jobs'); commit(); return; }
    case 'tradeFinder': { m.read = true; setUI({ tradeDraft: { givePicks: [], getPicks: [], ...a.arg } }); go('office', 'trade'); commit(); return; }
    case 'acceptAiTrade': {
      const offer = { givePicks: [], getPicks: [], ...a.arg };
      const stillValid = offer.give.every((id: string) => w.players[id].team === w.meta.userTeam) && offer.get.every((id: string) => w.players[id].team === offer.other);
      if (!stillValid || (w.season.phase === 'regular' && w.season.day > TRADE_DEADLINE(w.season.year))) { toast('That offer is no longer on the table.'); resolve(); break; }
      const ev = evaluateTrade(w, offer);
      if (ev.legal) { toast(ev.reason); resolve(); break; }
      executeTrade(w, offer); resolve(); toast('Trade completed.'); break;
    }
    case 'coachReq': {
      const res = requestCoach(w, a.arg.pid, a.arg.kind);
      resolve(); openModal('notice', { title: 'Coach responds', body: res.text }); commit(); return;
    }
    case 'patience': {
      const p = w.players[a.arg.pid];
      p.morale = Math.min(100, (p.morale ?? 50) + ((p.traits.patience ?? 50) > 50 ? 12 : 4));
      w.promises.push({ id: `pr${w.log.seq}`, to: p.id, kind: 'role review', made: w.season.day, due: addDays(w.season.day, 45), status: 'open' });
      addEvent(w, 'promise', `Asked ${p.name} for patience; role review promised`, [p.id]);
      resolve(); toast(`${p.name}'s camp will give it time — they'll remember the promise.`); break;
    }
    case 'sandbox': { w.meta.mode = 'sandbox'; w.meta.fired = false; resolve(); toast('Continuing in sandbox mode.'); break; }
    default: resolve();
  }
  commit();
}

/** Most urgent unresolved message (Tab target). */
export function mostUrgent(w: World): Message | undefined {
  const act = (m: Message) => (m.actions?.some(a => a.cmd !== 'dismiss') ? 1 : 0);
  return w.messages.filter(m => !m.resolved).sort((a, b) => b.urgent - a.urgent || act(b) - act(a) || (a.read === b.read ? 0 : a.read ? 1 : -1) || b.date.localeCompare(a.date))[0];
}
export function openMostUrgent() {
  const w = getWorld(); if (!w) return;
  const m = mostUrgent(w);
  if (!m) { toast('Nobody needs you right now.'); return; }
  m.read = true;
  openModal('message', { id: m.id });
  commit(false);
}
export { nextUnplayedDate, ui };

/** What ADVANCE does right now, and how the top bar describes it. */
export function nextStop(w: World): { label: string; verb: string; run?: () => void } {
  const S = w.season, u = w.meta.userTeam;
  if (w.meta.fired) return { label: 'Find a new job', verb: 'Phones', run: () => openModal('jobs') };
  const D3 = (d: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(d + 'T12:00:00Z').getUTCDay()];
  if (S.phase === 'preseason' || S.phase === 'regular') {
    const g = nextUserGame(w);
    if (!g) return { label: 'Playoffs', verb: 'Advance', run: () => sim('day') };
    const opp = w.teams[g.home === u ? g.away : g.home];
    return { label: `${D3(g.date)} · ${g.home === u ? 'vs' : 'at'} ${opp.name}`, verb: S.phase === 'preseason' ? 'Tip off' : 'Advance', run: () => sim(S.phase === 'preseason' ? 'day' : 'game') };
  }
  if (S.phase === 'playoffs') {
    const alive = S.playoffs!.series.some(s => (s.hi === u || s.lo === u) && !s.winner) || (S.playoffs!.round === 1 && ['East', 'West'].some(c => ((S as any)[`seeds${c}`] as string[]).slice(0, 2).includes(u)));
    return alive ? { label: 'Playoffs · next day', verb: 'Advance', run: () => sim('day') } : { label: 'Rest of the playoffs', verb: 'Advance', run: () => sim('playoffs') };
  }
  if (S.phase === 'draft') return { label: `${S.year + 1} NBA Draft`, verb: 'Draft room', run: () => go('draft') };
  const probs = seasonStartProblems(w);
  return probs.length ? { label: probs[0], verb: 'Fix roster', run: () => go('office', 'contracts') } : { label: `Open ${S.year + 1}–${String(S.year + 2).slice(2)}`, verb: 'Advance', run: () => beginNextSeason() };
}
