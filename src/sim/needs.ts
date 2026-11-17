// Coach needs (F14): measurable team weaknesses, coach requests with a target, and projections for roster moves.
import type { Player, World } from './types';
import { clamp, hashStr, stream } from './rng';
import { addEvent, addMessage } from './world';

export interface NeedDef { key: string; label: string; need: string; detail: string; f: (r: Player['r']) => number; n: number }
export const NEEDS: NeedDef[] = [
  { key: 'rim', label: 'Rim protection', need: 'a rim protector', detail: 'We give up too much at the basket.', f: r => r.intD * 0.6 + r.blk * 0.4, n: 2 },
  { key: 'wing', label: 'Perimeter defense', need: 'a defensive stopper', detail: 'Thin on perimeter defense behind the starters.', f: r => r.perD * 0.75 + r.stl * 0.25, n: 4 },
  { key: 'reb', label: 'Rebounding', need: 'a rebounder', detail: 'We are losing the glass.', f: r => r.dreb * 0.6 + r.oreb * 0.4, n: 3 },
  { key: 'pg', label: 'Ballhandling', need: 'a steady ballhandler', detail: 'Too many turnovers when our guards sit.', f: r => r.handle * 0.5 + r.pass * 0.5, n: 2 },
  { key: 'score', label: 'Bench scoring', need: 'more scoring', detail: "The second unit can't score.", f: r => r.mid * 0.5 + r.ins * 0.5, n: 7 },
];
export const needDef = (key: string) => NEEDS.find(n => n.key === key)!;

/** Front-office staff precision: better scouting budget and a sharper coach narrow every estimate. */
export function staffSd(w: World): number {
  const c = w.coaches[w.teams[w.meta.userTeam].coach];
  return clamp(6.4 - 1.15 * w.scoutBudget - (c.tactics - 50) / 22 - (c.adaptability - 50) / 45, 1.6, 7.5);
}
/** Persistent per-player unit error for our staff (so better staff shrinks the same error, not a fresh roll). */
export function unitErr(w: World, pid: string, k = 'ovr'): number {
  return stream(w.meta.seed, 'ourview', pid, k).normal(0, 1);
}
/** How our staff sees a rating: exact for our own players, otherwise biased by staff precision. */
export function seenRating(w: World, p: Player, k: keyof Player['r']): number {
  if (p.team === w.meta.userTeam) return p.r[k];
  return p.r[k] + unitErr(w, p.id, k) * staffSd(w) * 1.3;
}

export function needMetric(w: World, ids: string[], key: string): number {
  const d = needDef(key);
  const vals = ids.map(id => w.players[id]).filter(Boolean).map(p => {
    const r: any = {};
    for (const k of Object.keys(p.r)) r[k] = seenRating(w, p, k as keyof Player['r']);
    return d.f(r);
  }).sort((a, b) => b - a).slice(0, d.n);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}
export function leagueNeedRef(w: World, key: string): number {
  const d = needDef(key);
  const ts = Object.values(w.teams);
  const per = ts.map(t => { const v = t.roster.map(id => w.players[id]).filter(Boolean).map(p => d.f(p.r)).sort((a, b) => b - a).slice(0, d.n); return v.reduce((a, b) => a + b, 0) / Math.max(1, v.length); });
  return per.reduce((a, b) => a + b, 0) / per.length;
}
export function worstNeed(w: World): NeedDef {
  const ids = w.teams[w.meta.userTeam].roster;
  let worst = NEEDS[0], wz = 1e9;
  for (const d of NEEDS) { const g = needMetric(w, ids, d.key) - leagueNeedRef(w, d.key); if (g < wz) { wz = g; worst = d; } }
  return worst;
}

export interface CoachRequest { key: string; base: number; target: number; made: string; deadline: string; status: 'open' | 'met' | 'failed' | 'expired'; msgId?: string }
export function openRequest(w: World): CoachRequest | null {
  const r = (w as any).coachRequest as CoachRequest | undefined;
  return r && r.status === 'open' ? r : null;
}

export function makeCoachRequest(w: World, deadline: string) {
  const team = w.teams[w.meta.userTeam];
  const coach = w.coaches[team.coach];
  const d = worstNeed(w);
  const base = Math.round(needMetric(w, team.roster, d.key));
  const ref = Math.round(leagueNeedRef(w, d.key));
  const target = Math.max(base + 4, ref);
  const req: CoachRequest = { key: d.key, base, target, made: w.season.day, deadline, status: 'open' };
  (w as any).coachRequest = req;
  const last = coach.name.split(' ').slice(-1)[0];
  addMessage(w, { date: w.season.day, from: coach.name, role: 'Coach', subject: `${last} wants ${d.need}`, body: `${d.detail} Our rotation grades ${base} for ${d.label.toLowerCase()}; the league average is about ${ref}. Get us to ${target} or better and he'll feel heard. This is a request, not a demand — but he'll remember whether we listened.`,
    urgent: 2, tag: 'Coach request', deadline, actions: [{ label: 'Open trade finder', cmd: 'goto', arg: 'trade' }, { label: 'Free agents', cmd: 'goto', arg: 'fa' }, { label: 'Not now', cmd: 'dismiss' }] });
  req.msgId = w.messages[0].id;
  addEvent(w, 'coach_request', `${coach.name} asked for ${d.need} (${d.label} ${base} → ${target})`);
}

/** Daily: is the coach's request met, or has the window closed? */
export function checkCoachRequest(w: World) {
  const req = openRequest(w);
  if (!req) return;
  const team = w.teams[w.meta.userTeam];
  const coach = w.coaches[team.coach];
  const d = needDef(req.key);
  const now = needMetric(w, team.roster, req.key);
  const last = coach.name.split(' ').slice(-1)[0];
  if (now >= req.target - 0.25) {
    req.status = 'met';
    coach.trustGM = clamp((coach.trustGM ?? 55) + 6, 0, 100);
    const m = w.messages.find(x => x.id === req.msgId); if (m) m.resolved = true;
    addMessage(w, { date: w.season.day, from: coach.name, role: 'Coach', subject: `${last}: "That's what I asked for"`, body: `${d.label} now grades ${Math.round(now)} (target ${req.target}). He noticed, and he trusts your judgement a little more.`, urgent: 1, tag: 'Coach', actions: [{ label: 'Good', cmd: 'dismiss' }] });
    addEvent(w, 'coach_request', `${coach.name}'s request met (${d.label} ${Math.round(now)})`);
  } else if (w.season.day > req.deadline) {
    req.status = 'failed';
    coach.trustGM = clamp((coach.trustGM ?? 55) - 4, 0, 100);
    addMessage(w, { date: w.season.day, from: coach.name, role: 'Coach', subject: `${last} didn't get ${d.need}`, body: `${d.label} still grades ${Math.round(now)} against the ${req.target} he asked for. He'll make do — and remember.`, urgent: 1, tag: 'Coach' });
    addEvent(w, 'coach_request', `${coach.name}'s request went unmet`);
  }
}
export { hashStr };
