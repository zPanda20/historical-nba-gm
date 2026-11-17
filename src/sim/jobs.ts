// The GM job market (career mode): after a firing, approach teams with openings. Someone will hire you,
// but not necessarily the team you want.
import type { World } from './types';
import { clamp, sigmoid, stream } from './rng';
import { addEvent, addMessage, addNews, projectedWins } from './world';
import { payroll } from './gm';
import { standings } from './league';

export interface JobMarket { from: string; openings: string[]; approached: string[]; offers: string[]; declined: string[]; fallback?: string; }
export const MAX_APPROACHES = 3;

export function openJobMarket(w: World) {
  const from = w.meta.userTeam;
  const rng = stream(w.meta.seed, 'jobs', w.season.year);
  const order = standings(w).map(t => t.id).filter(id => id !== from).reverse(); // worst first
  const bottom = order.slice(0, 7);
  const openings = bottom.sort(() => rng.next() - 0.5).slice(0, 3);
  const rest = order.filter(id => !openings.includes(id));
  openings.push(...rest.sort(() => rng.next() - 0.5).slice(0, 2)); // a couple of surprise openings
  (w as any).jobMarket = { from, openings, approached: [], offers: [], declined: [] } as JobMarket;
}
export const jobMarket = (w: World): JobMarket | null => (w as any).jobMarket ?? null;

/** How attractive the opening is: better teams are pickier. */
export function jobBar(w: World, tid: string) {
  const t = w.teams[tid];
  const pct = t.w + t.l ? t.w / (t.w + t.l) : 0.5;
  return Math.round(28 + pct * 40);
}

export function approachTeam(w: World, tid: string): { ok: boolean; text: string } {
  const jm = jobMarket(w)!;
  if (jm.approached.includes(tid)) return { ok: jm.offers.includes(tid), text: 'You already spoke with them.' };
  if (jm.approached.length >= MAX_APPROACHES) return { ok: false, text: 'You have used all your calls. Wait for the phone to ring.' };
  jm.approached.push(tid);
  const t = w.teams[tid];
  const rng = stream(w.meta.seed, 'jobs', 'approach', tid, w.season.year);
  const p = sigmoid((w.gmRep - jobBar(w, tid)) / 7);
  const ok = rng.chance(clamp(p, 0.08, 0.92));
  if (ok) { jm.offers.push(tid); return { ok, text: `${t.owner}: "We'd like you to run the ${t.name}. The job is yours if you want it."` }; }
  jm.declined.push(tid);
  return { ok, text: `${t.owner}: "We're going in a different direction. Good luck."` };
}

/** If every call came back no, a team you didn't pick calls you. */
export function ensureOffer(w: World): string | null {
  const jm = jobMarket(w)!;
  if (jm.offers.length) return null;
  if (jm.approached.length < MAX_APPROACHES && jm.openings.some(id => !jm.approached.includes(id))) return null;
  const pool = jm.openings.filter(id => !jm.declined.includes(id));
  const any = pool.length ? pool : jm.openings;
  const pick = [...any].sort((a, b) => jobBar(w, a) - jobBar(w, b))[0];
  jm.offers.push(pick); jm.fallback = pick;
  return pick;
}

export function takeJob(w: World, tid: string) {
  const old = w.meta.userTeam;
  const t = w.teams[tid];
  w.meta.userTeam = tid; w.meta.fired = false;
  w.meta.title = `${w.meta.gmName} — ${t.city} ${t.name}`;
  const proj = projectedWins(w)[tid] ?? 41;
  const rng = stream(w.meta.seed, 'owner', tid, w.season.year);
  w.owner = { name: t.owner, patience: Math.round(40 + rng.next() * 35), wantsWins: Math.round(45 + rng.next() * 40), budget: Math.round(payroll(w, tid) * 1.08 / 10000) * 10000,
    satisfaction: 55, expectedWins: proj, objective: proj >= 48 ? 'Win the division and go deep in the playoffs.' : proj >= 40 ? `Make the playoffs (about ${proj} wins).` : 'Show real progress.' };
  w.clock = t.clock ?? 'Building';
  w.coaches[t.coach].trustGM = 52;
  (w as any).coachRequest = undefined;
  (w as any).jobMarket = undefined;
  w.gmRep = clamp(w.gmRep - 4, 0, 100);
  for (const m of w.messages) m.resolved = true;
  addMessage(w, { date: w.season.day, from: t.owner, role: 'Owner', subject: `Welcome to ${t.city}`, body: `You're the new general manager of the ${t.city} ${t.name}. ${w.owner.objective}`, urgent: 1, tag: 'Owner', actions: [{ label: 'Get to work', cmd: 'dismiss' }] });
  addNews(w, `${t.name} hire a new general manager`, `${w.meta.gmName === 'General Manager' ? 'The' : w.meta.gmName + ', the'} former ${w.teams[old].name} GM, takes over in ${t.city}.`, 'transactions');
  addEvent(w, 'gm_hired', `${w.meta.gmName} hired by ${tid} (was ${old})`);
}
