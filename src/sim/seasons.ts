// Long-run league structure: identities, expansion, realignment, schedules, draft-class supply, coaching carousel.
import type { Coach, GameRec, Player, Team, World } from './types';
import { clamp, stream } from './rng';
import { playerValue } from './coach';
import { addEvent, addMessage, addNews, potentialOvr } from './world';
import { shapeCareer, shapeDraftOutlier, seedFictionalStar, setClassPerception } from './impact';
import { initPerson } from './people';
import { IDENTITY_EVENTS, LOGO_FILES, alignmentFor, eraRules, expansionsFor, futureOf, logoFor, $y } from './history';

const addDays = (d: string, n: number) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// ------------------------------------------------------------------ identities
export function applyIdentityEvents(world: World, season: number) {
  try { applyIdentityEventsInner(world, season); } finally { for (const t of Object.values(world.teams)) t.logoKey = logoFor(t.id, season); }
}
function applyIdentityEventsInner(world: World, season: number) {
  const done = new Set((world.franchiseEvents ?? []).filter((e: any) => e.done).map((e: any) => `${e.season}-${e.team}-${e.type}-${e.abbr ?? e.logo ?? ''}`));
  for (const ev of IDENTITY_EVENTS.filter(e => e.season === season)) {
    const t = world.teams[ev.team];
    if (!t) continue;
    const key = `${ev.season}-${ev.team}-${ev.type}-${ev.abbr ?? ev.logo ?? ''}`;
    if (done.has(key)) continue;
    const before = `${t.city} ${t.name}`;
    if (ev.city) t.city = ev.city;
    if (ev.name) t.name = ev.name;
    if (ev.abbr) t.abbr = ev.abbr;
    if (ev.logo) t.logoKey = ev.logo;
    if (ev.colors) t.colors = ev.colors;
    if (ev.arena) t.arena = ev.arena;
    world.franchiseEvents.push({ season: ev.season, team: ev.team, type: ev.type, abbr: ev.abbr, logo: ev.logo, done: true, note: ev.note });
    if (ev.type === 'relocation' || ev.type === 'rename') {
      addNews(world, ev.type === 'relocation' ? `The ${before} are now the ${t.city} ${t.name}` : `${before} become the ${t.name}`, `${ev.note} Same franchise, same history — new home, new name.`, 'league');
      addEvent(world, 'franchise', `${before} → ${t.city} ${t.name}`);
      if (t.id === world.meta.userTeam) addMessage(world, { date: world.season.day, from: world.owner.name, role: 'Owner', subject: ev.type === 'relocation' ? `We're moving to ${t.city}` : `We are the ${t.name} now`, body: `${ev.note} Our history comes with us. New city, new fans, same job: win.`, urgent: 1, tag: 'Owner' });
    } else if (ev.logo) {
      addNews(world, `New look for the ${t.name}`, ev.note, 'league');
    }
  }
}
export function teamLogoKey(t: Team) { return t.logoKey ?? t.abbr; }
/** Older saves: bring every team's logo up to date with the calendar (new logo files arrive between versions). */
export function syncLogos(world: World) {
  for (const t of Object.values(world.teams)) t.logoKey = logoFor(t.id, world.season.year);
}
export function hasLogoFile(key: string) { return LOGO_FILES.has(key); }

// ------------------------------------------------------------------ coaches
const FIRST = ['Mike', 'Tom', 'Rick', 'Dave', 'Jim', 'Bob', 'Paul', 'Steve', 'Dan', 'Mark', 'Chris', 'Greg', 'Ron', 'Terry', 'Larry', 'Kevin', 'Brian', 'Scott', 'Tony', 'Eric',
  'Jason', 'Marcus', 'Darnell', 'Andre', 'Luis', 'Sean', 'Ryan', 'Nate', 'Jamal', 'Victor', 'Omar', 'Pete', 'Rafael', 'Dion', 'Cliff', 'Wes', 'Glenn', 'Ty', 'Malik', 'Joel'];
const LAST = ['Hollins', 'Mercer', 'Dawson', 'Kearns', 'Whitaker', 'Pruitt', 'Lambert', 'Sterling', 'Okafor', 'Brennan', 'Castillo', 'Fenwick', 'Haskell', 'Ingram', 'Jessup',
  'Kowalski', 'Lindqvist', 'Marlowe', 'Nakamura', 'Ortega', 'Pendleton', 'Quarles', 'Ramsey', 'Sutter', 'Tolliver', 'Underwood', 'Vance', 'Wakefield', 'Yates', 'Ziegler',
  'Abernathy', 'Bolden', 'Crowder', 'Dunleavy', 'Ellison', 'Foley', 'Garrity', 'Hargrove', 'Iverson', 'Jefferies', 'Keller', 'Lowery', 'McAdoo', 'Norwood', 'Oakes', 'Pacheco'];
export function fictionalName(r: ReturnType<typeof stream>) { return `${r.pick(FIRST)} ${r.pick(LAST)}`; }

export function generateCoach(world: World, key: string, team: string | null): Coach {
  const r = stream(world.meta.seed, 'coachgen', key);
  const v = (m = 55, s = 11) => Math.round(clamp(r.normal(m, s), 25, 92));
  const era = world.season.year;
  let name = fictionalName(r);
  while (Object.values(world.coaches).some(c => c.name === name)) name = fictionalName(r);
  const id = `cg_${key}`.replace(/[^a-z0-9_]/gi, '_');
  const c: Coach = {
    id, name, team, role: team ? 'Head coach' : 'Available',
    pace: v(era >= 2015 ? 62 : era >= 1995 ? 46 : 58), post: v(era >= 2010 ? 38 : 56), motion: v(), iso: v(era >= 1995 && era < 2012 ? 58 : 48), pnr: v(era >= 2005 ? 66 : era >= 1985 ? 42 : 24),
    pressure: v(), depth: v(), devFocus: v(), experiment: v(50, 14), tactics: v(57, 9), development: v(56, 10), communication: v(56, 10), adaptability: v(55, 10),
    stubborn: v(50, 12), ego: v(50, 12), note: 'In this universe: a simulated coach.', evidence: 'simulated', trustGM: 55,
  };
  (c as any).since = era; (c as any).age = r.int(38, 58);
  world.coaches[id] = c;
  return c;
}

/** Offseason: coaches retire, AI teams fire coaches after bad seasons, the pool of available coaches refreshes. */
export function coachingCarousel(world: World) {
  const y = world.season.year; // season that just ended
  const rng = stream(world.meta.seed, 'carousel', y);
  for (const c of Object.values(world.coaches)) { (c as any).age = ((c as any).age ?? 46 + (rng.int(0, 14))) + 1; }
  const avail = () => Object.values(world.coaches).filter(c => !c.team && c.role !== 'Retired');
  for (const t of Object.values(world.teams)) {
    const c = world.coaches[t.coach];
    if (!c) continue;
    const age = (c as any).age ?? 50;
    const h = t.history.slice(-2);
    const pct = h.length ? h.reduce((a, s) => a + s.w, 0) / Math.max(1, h.reduce((a, s) => a + s.w + s.l, 0)) : 0.5;
    const retire = age >= 64 && rng.chance(0.12 + (age - 64) * 0.06);
    const fire = t.id !== world.meta.userTeam && h.length >= 1 && ((pct < 0.36 && rng.chance(0.55)) || (pct < 0.43 && rng.chance(0.22)) || (h[h.length - 1]?.result === 'Missed playoffs' && rng.chance(0.07)));
    if (!retire && !fire) continue;
    c.team = null; c.role = retire ? 'Retired' : 'Available';
    let next = avail().sort((a, b) => (b.tactics + b.development) - (a.tactics + a.development))[rng.int(0, 2)];
    if (!next) next = generateCoach(world, `${y}-${t.id}`, null);
    next.team = t.id; next.role = 'Head coach'; next.trustGM = 55;
    t.coach = next.id;
    addNews(world, retire ? `${c.name} retires` : `${t.name} fire ${c.name}`, `${t.city} hand the job to ${next.name}.`, 'league');
    if (t.id === world.meta.userTeam) addMessage(world, { date: world.season.day, from: 'Front office', role: 'GM', subject: `${c.name} is retiring`, body: `${c.name} has decided to step away after the season. We've brought in ${next.name} for now. You can make a different hire from the Staff page.`, urgent: 2, tag: 'Coach', actions: [{ label: 'Open Staff', cmd: 'goto', arg: 'staff' }] });
  }
  // ownership changes hands now and then; a new owner brings new patience and new expectations
  const OWN_F = ['Robert', 'Mark', 'Steve', 'Dan', 'Joe', 'Wes', 'Tilman', 'Marc', 'Jeanie', 'Gail', 'Herb', 'Paul', 'Michael', 'Josh', 'Vivek', 'Tom', 'Gayle', 'Mat', 'Clay', 'Ryan'];
  const OWN_L = ['Halvorsen', 'Brightman', 'Castellano', 'Whitcombe', 'Aldridge', 'Montague', 'Petrakis', 'Sorensen', 'Okonkwo', 'Delacroix', 'Fairweather', 'Ishikawa', 'Lockhart', 'Navarro'];
  for (const t of Object.values(world.teams)) {
    if (!rng.chance(t.id === world.meta.userTeam ? 0.025 : 0.035)) continue;
    const prev = t.owner;
    t.owner = `${rng.pick(OWN_F)} ${rng.pick(OWN_L)}`;
    addNews(world, `${t.city} ${t.name} sold`, `${t.owner} buys the franchise from ${prev}.`, 'league');
    if (t.id === world.meta.userTeam) {
      world.owner.name = t.owner; world.owner.patience = rng.int(35, 80); world.owner.wantsWins = rng.int(40, 90); world.owner.satisfaction = 55;
      addMessage(world, { date: world.season.day, from: t.owner, role: 'Owner', subject: 'New ownership', body: `I've completed the purchase of the ${t.name}. You keep your job — for now. I'll judge you on what happens from here, not on what happened before me.`, urgent: 2, tag: 'Owner' });
    }
  }
  // keep a handful of candidates on the market
  let n = 0;
  while (avail().length < 6 && n++ < 10) generateCoach(world, `pool-${y}-${n}`, null);
}

// ------------------------------------------------------------------ draft-class supply
let CLASS_DATA: any = null;
export function setClassData(d: any) { CLASS_DATA = d; }
export function classData() { return CLASS_DATA; }

function decode(world: World, c: any, year: number, kind: 'prospect' | 'undrafted'): Player {
  const keys: string[] = CLASS_DATA.keys, tk: string[] = CLASS_DATA.traits;
  const r: any = { hgt: c.h }; keys.forEach((k, i) => (r[k] = c.r[i]));
  const ceil: any = {}; keys.forEach((k, i) => (ceil[k] = { mu: c.ce[i], sd: c.a < 24 ? 6 : 4 }));
  const traits: any = {}; tk.forEach((k, i) => (traits[k] = c.t[i]));
  const p: Player = {
    id: c.id, nbaId: c.nb ?? null, name: c.n, pos: c.pos, age: c.a, born: c.b, hgt: c.h, wgt: c.w, college: c.c, team: null,
    rosterStatus: kind === 'undrafted' ? c.st : 'Draft-eligible prospect', source: `classes.json ${year}`, evidence: 'unverified',
    r, ceil, ovr: 0, traits, traitsNote: 'In this universe: simulated personality, not a claim about the real person.', draft: c.d ?? null,
    kind: 'prospect', sampleMin: c.m ?? 0, headshot: false, contract: null, draftClass: year, injury: null, stats: [], awards: [], morale: 60, fatigueSeason: 0,
  };
  p.ovr = Math.round(playerValue(p));
  shapeCareer(p, year);
  shapeDraftOutlier(p);
  initPerson(p, world.meta.seed);
  return p;
}

const POS_H: Record<string, [number, number]> = { PG: [74.5, 2], SG: [77, 1.6], SF: [79.3, 1.4], PF: [81.3, 1.4], C: [83.3, 1.6] };
const COLLEGES = ['Kentucky', 'Duke', 'Kansas', 'North Carolina', 'UCLA', 'Gonzaga', 'Villanova', 'Arizona', 'Michigan State', 'Baylor', 'Houston', 'Alabama', 'Auburn', 'Texas',
  'Tennessee', 'Purdue', 'UConn', 'Arkansas', 'Indiana', 'USC', 'Florida', 'Iowa State', 'Creighton', 'Marquette', 'Dayton', null, null, null, 'G League', 'Overtime Elite'];
const INTL = ['Real Madrid', 'Barcelona', 'Partizan', 'Fenerbahce', 'ASVEL', 'Bayern Munich', 'Olympiacos', 'NBL Australia', 'Mega Basket', 'Zalgiris'];
const PFIRST = ['Jalen', 'Cameron', 'Tyrese', 'Amari', 'Dylan', 'Jordan', 'Isaiah', 'Elijah', 'Malachi', 'Caleb', 'Josiah', 'Kai', 'Mateo', 'Luka', 'Nikola', 'Ousmane', 'Theo',
  'Bennett', 'Darius', 'Xavier', 'Micah', 'Zion', 'Emeka', 'Andrés', 'Kaden', 'Bryce', 'Trey', 'Devin', 'Quentin', 'Ronan', 'Silas', 'Tobias', 'Yuki', 'Moussa', 'Aleksander',
  'Jaylen', 'Keon', 'Rashad', 'Marcus', 'Ethan', 'Noah', 'Liam', 'Gabriel', 'Ibrahim', 'Rio', 'Santiago', 'Axel', 'Cyrus', 'Dante', 'Everett', 'Hugo', 'Jace', 'Lorenzo'];
const PLAST = ['Holloway', 'Achterberg', 'Banks', 'Coleman', 'Diallo', 'Eriksen', 'Fofana', 'Grant', 'Hartley', 'Ibekwe', 'Jovanovic', 'Kessler', 'Lindgren', 'Mbeki', 'Novak',
  'Okoro', 'Petrovic', 'Quinn', 'Rivers', 'Sall', 'Tanaka', 'Umeh', 'Varga', 'Whitfield', 'Xu', 'Young', 'Zubac', 'Alvarado', 'Brooks', 'Cisse', 'Dunmore', 'Ellery', 'Fairbanks',
  'Garnier', 'Hamidou', 'Ivey', 'Jarrett', 'Kowal', 'Lacroix', 'Marsh', 'Ndiaye', 'Osei', 'Park', 'Rojas', 'Stroud', 'Thibodeaux', 'Usman', 'Vukovic', 'Wembley', 'Yarbrough'];

function generateProspect(world: World, year: number, i: number, undrafted: boolean): Player {
  const r = stream(world.meta.seed, 'prospect', year, i, undrafted ? 'u' : 'd');
  const fut = futureOf(world.meta.seed);
  let tpl: any = null;
  const recent = CLASS_DATA ? Object.entries(CLASS_DATA.classes).filter(([y]) => +y >= 2010).flatMap(([, v]) => v as any[]) : [];
  const recentU = CLASS_DATA ? Object.entries(CLASS_DATA.undrafted).filter(([y]) => +y >= 2010 && +y <= 2025).flatMap(([, v]) => v as any[]) : [];
  if (undrafted ? recentU.length : recent.length) {
    const pool = undrafted ? recentU : recent;
    // the order of a class mirrors talent; sample a template near the same slot so the class keeps a real shape
    const slot = undrafted ? r.int(0, pool.length - 1) : Math.min(pool.length - 1, Math.floor(i / 60 * pool.length + r.normal(0, pool.length / 30)));
    tpl = pool[Math.max(0, slot)];
    if (!undrafted) { const byPot = [...recent].sort((a, b) => b.ce.reduce((x: number, y: number) => x + y, 0) - a.ce.reduce((x: number, y: number) => x + y, 0)); tpl = byPot[clamp(Math.round(i / 60 * byPot.length + r.normal(0, 25)), 0, byPot.length - 1)]; }
  }
  const pos = tpl?.pos ?? r.pick(['PG', 'SG', 'SF', 'PF', 'C']);
  const [hm, hs] = POS_H[pos];
  const giant = fut.scenario === 'Return of the Giant' && (pos === 'C' || pos === 'PF') ? 0.8 : 0;
  const hgt = Math.round(clamp(r.normal(hm + giant * 0.6, hs), 70, 89));
  const keys: string[] = CLASS_DATA?.keys ?? ['ins', 'post', 'mid', 'ft', 'three', 'pass', 'handle', 'drive', 'oreb', 'dreb', 'blk', 'stl', 'perD', 'intD', 'foulDraw', 'foulAvoid', 'usage', 'stamina', 'ath', 'iq'];
  const tilt = (k: string) => fut.scenario === 'Hyper-Spacing' ? (k === 'three' ? 4 : 0) : fut.scenario === 'Defensive Renaissance' ? (k === 'perD' || k === 'stl' ? 3 : 0)
    : fut.scenario === 'Return of the Giant' ? ((k === 'post' || k === 'intD') && (pos === 'C' || pos === 'PF') ? 3 : 0) : (k === 'pass' || k === 'handle' ? 1.5 : 0);
  const cur: any = { hgt }, ceil: any = {};
  keys.forEach((k, idx) => {
    const base = tpl ? tpl.r[idx] : r.normal(45, 9);
    const c0 = tpl ? tpl.ce[idx] : base + Math.abs(r.normal(6, 5));
    const v = clamp(Math.round(base + r.normal(0, 4) + tilt(k) * 0.5), 20, 95);
    cur[k] = v; ceil[k] = { mu: clamp(Math.round(Math.max(v, c0 + r.normal(0, 4) + tilt(k))), 20, 99), sd: 6 };
  });
  let name = `${r.pick(PFIRST)} ${r.pick(PLAST)}`;
  for (let k = 0; world.players[`f${year}_${i}${undrafted ? 'u' : ''}`] && k < 3; k++) name += ' Jr.';
  const intl = r.chance(0.22);
  const age = clamp(Math.round(r.normal(undrafted ? 21.5 : 19.6, 1.2)), 18, 24);
  const p: Player = {
    id: `f${year}_${i}${undrafted ? 'u' : ''}`, nbaId: null, name, pos, age, born: `${year - age - 1}-${String(r.int(1, 12)).padStart(2, '0')}-${String(r.int(1, 28)).padStart(2, '0')}`,
    hgt, wgt: Math.round(hgt * 2.85 + r.normal(0, 12)), college: intl ? r.pick(INTL) : r.pick(COLLEGES), team: null,
    rosterStatus: undrafted ? 'Undrafted free agent' : 'Draft-eligible prospect', source: 'generated (post-2026 class, simulated)', evidence: 'simulated',
    r: cur, ceil, ovr: 0, traits: Object.fromEntries(['drive', 'ambition', 'ego', 'loyalty', 'discipline', 'adapt', 'patience', 'social'].map(k => [k, Math.round(clamp(r.normal(50, 14), 5, 95))])),
    traitsNote: 'Fictional player generated for the simulated future.', draft: undrafted ? null : { year, college: null, realPick: null, realTeam: null },
    kind: 'prospect', sampleMin: 0, headshot: false, contract: null, draftClass: year, injury: null, stats: [], awards: [], morale: 60, fatigueSeason: 0,
  };
  p.ovr = Math.round(playerValue(p));
  seedFictionalStar(p, undrafted ? 60 + i : i, world.meta.seed, year);
  initPerson(p, world.meta.seed);
  return p;
}

/** Add the draft class for `year` (real through 2026, generated after). Idempotent. */
export function injectClass(world: World, year: number) {
  const key = String(year);
  if (world.draftClasses[key]?.length) return;
  const ids: string[] = [];
  const rows: any[] = CLASS_DATA?.classes?.[key] ?? [];
  if (rows.length) {
    for (const c of rows) { if (world.players[c.id]) continue; const p = decode(world, c, year, 'prospect'); world.players[p.id] = p; ids.push(p.id); }
    setClassPerception(world, ids, potentialOvr);
  } else if (year > 2026 || !CLASS_DATA) {
    const n = eraRules(year - 1).draftRounds * Math.max(30, Object.keys(world.teams).length) + 4;
    for (let i = 0; i < n; i++) { const p = generateProspect(world, year, i, false); world.players[p.id] = p; ids.push(p.id); }
  }
  world.draftClasses[key] = ids;
}

/** Players who reached the league without being drafted that year (undrafted, overseas, late arrivals). */
export function injectUndrafted(world: World, season: number) {
  const tag = `undrafted-${season}`;
  if ((world.franchiseEvents ?? []).some((e: any) => e.type === tag)) return;
  world.franchiseEvents.push({ season, type: tag, done: true });
  const rows: any[] = CLASS_DATA?.undrafted?.[String(season)] ?? [];
  let n = 0;
  if (season <= 2026 && CLASS_DATA) {
    for (const c of rows) {
      if (world.players[c.id]) continue;
      const p = decode(world, c, season, 'undrafted');
      p.ask = $y(30000); world.players[p.id] = p; world.freeAgents.push(p.id); n++;
    }
  } else {
    const k = season > 2026 ? 24 : 10;
    for (let i = 0; i < k; i++) { const p = generateProspect(world, season, i, true); p.ask = $y(30000); world.players[p.id] = p; world.freeAgents.push(p.id); n++; }
  }
  return n;
}

// ------------------------------------------------------------------ expansion
/** Called when the draft is set up for the season that the new teams join. Builds team, coach, picks and runs the expansion draft. */
export function runExpansion(world: World, joinSeason: number): string[] {
  const defs = expansionsFor(world.meta.seed, joinSeason).filter(e => !world.teams[e.id]);
  if (!defs.length) return [];
  const rng = stream(world.meta.seed, 'expansion', joinSeason);
  const existing = Object.values(world.teams);
  const made: string[] = [];
  for (const e of defs) {
    const coach = generateCoach(world, `exp-${e.id}`, e.id);
    const t: Team = {
      id: e.id, nbaTeamId: 0, city: e.city, name: e.name, abbr: e.abbr, conf: e.conf, div: e.div, colors: e.colors, logo: '', logoKey: e.logo, arena: e.arena,
      coach: coach.id, gm: fictionalName(rng), owner: e.owner, roster: [], evidence: e.future ? 'simulated (future expansion)' : 'reported (identity)',
      w: 0, l: 0, homeW: 0, homeL: 0, streak: 0, ptsFor: 0, ptsAgainst: 0, history: [], picks: [], minutesRequests: {}, clock: 'Rebuilding', founded: joinSeason,
    };
    for (let s = joinSeason + 1; s <= joinSeason + 3; s++) for (let r = 1; r <= Math.min(2, eraRules(s - 1).draftRounds); r++) t.picks.push({ season: s, round: r, original: e.id, owner: e.id });
    world.teams[e.id] = t;
    made.push(e.id);
    addNews(world, `${e.city} ${e.name} join the league`, `${e.note} They will build their first roster through an expansion draft.`, 'league');
    addEvent(world, 'expansion', `${e.city} ${e.name} added (${joinSeason}–${String(joinSeason + 1).slice(2)})`);
  }
  // expansion draft: every existing team protects eight; each existing team loses at most one player
  const protectedBy: Record<string, Set<string>> = {};
  for (const t of existing) protectedBy[t.id] = new Set(t.roster.map(id => world.players[id]).filter(Boolean).sort((a, b) => playerValue(b) - playerValue(a)).slice(0, 8).map(p => p.id));
  const lost = new Set<string>();
  const value = (p: Player) => playerValue(p) + Math.max(0, 27 - (p.age ?? 27)) * 0.9 - Math.max(0, (p.age ?? 27) - 31) * 1.2 - (p.contract?.salary ?? 0) / $y(120000) * 0.6;
  const losses: string[] = [];
  for (let round = 0; round < 14; round++) for (const id of made) {
    const T = world.teams[id];
    if (T.roster.length >= 12) continue;
    const pool = existing.filter(t => !lost.has(t.id)).flatMap(t => t.roster.filter(pid => !protectedBy[t.id].has(pid)).map(pid => world.players[pid])).filter(Boolean);
    const pick = pool.sort((a, b) => value(b) - value(a))[rng.int(0, Math.min(2, pool.length - 1))];
    if (!pick) break;
    const from = world.teams[pick.team!];
    from.roster = from.roster.filter(x => x !== pick.id);
    lost.add(from.id);
    pick.team = id; T.roster.push(pick.id); pick.rosterStatus = `Expansion draft (from ${from.abbr})`;
    addEvent(world, 'expansion', `${T.abbr} took ${pick.name} from ${from.abbr} in the expansion draft`, [pick.id]);
    if (from.id === world.meta.userTeam) losses.push(`${pick.name} (to ${T.city})`);
  }
  if (losses.length) addMessage(world, { date: world.season.day, from: 'League office', role: 'League', subject: 'Expansion draft results', body: `We protected our top eight players. The expansion draft took ${losses.join(', ')}. Every team lost at most one player.`, urgent: 1, tag: 'League' });
  return made;
}

/** Apply this season's conference and division alignment. */
export function applyAlignment(world: World, season: number) {
  const al = alignmentFor(world.meta.seed, season, Object.keys(world.teams));
  for (const [id, a] of Object.entries(al)) { const t = world.teams[id]; if (t.conf !== a.conf || t.div !== a.div) { t.conf = a.conf; t.div = a.div; } }
}

// ------------------------------------------------------------------ schedule
/** Exact N-team schedule: every team plays `G` games, weighted toward division and conference rivals. */
export function generateSchedule(world: World, year: number): GameRec[] {
  const R = eraRules(year);
  const G = R.games;
  const rng = stream(world.meta.seed, 'schedule', year);
  const ids = Object.keys(world.teams);
  const N = ids.length;
  const idx = (a: number, b: number) => a < b ? a * N + b : b * N + a;
  const cnt = new Array(N * N).fill(0);
  const deg = new Array(N).fill(0);
  const base = Math.min(2, Math.floor(G / (N - 1)));
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { cnt[idx(i, j)] = base; deg[i] += base; deg[j] += base; }
  const tier = (i: number, j: number) => { const a = world.teams[ids[i]], b = world.teams[ids[j]]; return a.div === b.div ? 2 : a.conf === b.conf ? 1 : 0; };
  const cap = (i: number, j: number) => [2, 4, 4][tier(i, j)];
  // fill toward G: prefer division, then conference, never more than cap (relaxed if needed)
  for (let pass = 0; pass < 3; pass++) {
    let progress = true;
    while (progress) {
      progress = false;
      const order = ids.map((_, i) => i).sort((a, b) => (G - deg[b]) - (G - deg[a]) || rng.next() - 0.5);
      for (const i of order) {
        if (deg[i] >= G) continue;
        let best = -1, bs = -1e9;
        for (let j = 0; j < N; j++) {
          if (j === i || deg[j] >= G) continue;
          const c = cnt[idx(i, j)];
          const lim = cap(i, j) + pass;
          if (c >= lim) continue;
          const s = tier(i, j) * 3 - c * 2 + (G - deg[j]) * 0.05 + rng.next() * 0.5;
          if (s > bs) { bs = s; best = j; }
        }
        if (best >= 0) { cnt[idx(i, best)]++; deg[i]++; deg[best]++; progress = true; }
      }
    }
  }
  // repair: a team still short pairs with an edge between two other teams (keeps their totals)
  for (let guard = 0; guard < 400; guard++) {
    const i = deg.findIndex(d => d < G);
    if (i < 0) break;
    const j = deg.findIndex((d, k) => k !== i && d < G);
    if (j >= 0 && deg[i] < G - 0) { // two short teams: just add a game between them
      cnt[idx(i, j)]++; deg[i]++; deg[j]++; continue;
    }
    if (G - deg[i] < 2) break;
    let done = false;
    for (let a = 0; a < N && !done; a++) for (let b = a + 1; b < N && !done; b++) {
      if (a === i || b === i || cnt[idx(a, b)] <= 1) continue;
      cnt[idx(a, b)]--; cnt[idx(i, a)]++; cnt[idx(i, b)]++; deg[i] += 2; done = true;
    }
    if (!done) break;
  }
  // home/away split
  const home = new Array(N).fill(0);
  const pairs: [number, number][] = [];
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    const c = cnt[idx(i, j)];
    for (let k = 0; k < Math.floor(c / 2); k++) { pairs.push([i, j]); pairs.push([j, i]); home[i]++; home[j]++; }
    if (c % 2) { const h = home[i] <= home[j] ? i : j; pairs.push(h === i ? [i, j] : [j, i]); home[h]++; }
  }
  // dates: spread over the season window; avoid three nights in a row
  for (let k = pairs.length - 1; k > 0; k--) { const m = Math.floor(rng.next() * (k + 1)); [pairs[k], pairs[m]] = [pairs[m], pairs[k]]; }
  const daysTotal = Math.round(G * 2.02);
  const left = new Array(N).fill(0); for (const [h, a] of pairs) { left[h]++; left[a]++; }
  const lastDay: number[] = new Array(N).fill(-9), streak: number[] = new Array(N).fill(0);
  const games: GameRec[] = [];
  let d = 0, date = R.start;
  const pool = pairs.slice();
  while (pool.length && d < daysTotal * 2) {
    const remainingDays = Math.max(1, daysTotal - d);
    const target = Math.max(1, Math.round(pool.length / remainingDays * (0.75 + rng.next() * 0.5)));
    const busy = new Set<number>();
    const scored = pool.map((g, k) => ({ g, k, s: left[g[0]] + left[g[1]] + (lastDay[g[0]] === d - 1 ? -12 : 0) + (lastDay[g[1]] === d - 1 ? -12 : 0) + rng.next() * 4 }))
      .filter(o => !(lastDay[o.g[0]] === d - 1 && streak[o.g[0]] >= 2) && !(lastDay[o.g[1]] === d - 1 && streak[o.g[1]] >= 2))
      .sort((a, b) => b.s - a.s);
    const take: number[] = [];
    for (const o of scored) {
      if (take.length >= Math.min(target, Math.floor(N / 2))) break;
      const [h, a] = o.g;
      if (busy.has(h) || busy.has(a)) continue;
      busy.add(h); busy.add(a); take.push(o.k);
    }
    take.sort((a, b) => b - a).forEach(k => {
      const [h, a] = pool[k];
      games.push({ id: `${year}-${String(games.length + 1).padStart(4, '0')}`, date, home: ids[h], away: ids[a] });
      for (const t of [h, a]) { streak[t] = lastDay[t] === d - 1 ? streak[t] + 1 : 1; lastDay[t] = d; left[t]--; }
      pool.splice(k, 1);
    });
    d++; date = addDays(date, 1);
  }
  games.sort((a, b) => a.date.localeCompare(b.date));
  games.forEach((g, i) => (g.id = `${year}-${String(i + 1).padStart(4, '0')}`));
  return games;
}

/** Each season adds the pick rights three drafts out; old picks are pruned. */
export function rollPicks(world: World) {
  const y = world.season.year;
  for (const t of Object.values(world.teams)) {
    t.picks = t.picks.filter(p => p.season > y);
    for (let s = y + 1; s <= y + 3; s++) {
      const rounds = Math.min(2, eraRules(s - 1).draftRounds);
      for (let r = 1; r <= rounds; r++) {
        const exists = Object.values(world.teams).some(o => o.picks.some(p => p.season === s && p.round === r && p.original === t.id));
        if (!exists) t.picks.push({ season: s, round: r, original: t.id, owner: t.id });
      }
    }
  }
}

/** Retired players keep their record but shed the heavy scouting state so long saves stay small. */
export function compactRetired(world: World) {
  for (const p of Object.values(world.players)) if (p.retired) { delete p.scout; delete (p as any).promise; p.injury = null; p.ceil = {}; p.traitsNote = ''; delete (p as any).calibration; }
  // unsigned leftovers from old classes (never signed, now too old) leave the pool quietly
  world.freeAgents = world.freeAgents.filter(id => { const p = world.players[id]; return p && !p.retired; });
}
