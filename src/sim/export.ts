// League chronicle export: one Markdown file an AI writer can turn into a dramatic history of THIS league.
// It holds causes and results only (no prose), in compact, consistently labelled sections, with pre-detected storylines,
// player and team dossiers and records. Built from the permanent chronicle (chronicle.ts), past seasons, stats and the
// people/dynasty state.
import type { Player, World } from './types';
import { chronicle } from './chronicle';
import type { ChronEntry } from './chronicle';
import { perGame } from './league';
import { playerValue } from './coach';
import { culture, mentality, mentalityWord, personaLabel, topMotives, rel } from './people';

const SL = (y: number) => `${y}–${String((y + 1) % 100).padStart(2, '0')}`;
const f1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const ord = (mmdd: string) => { const [m, d] = mmdd.split('-').map(Number); return (m >= 10 ? m : m + 12) * 100 + d; };
const AWARD_ORDER = ['MVP', 'Finals MVP', 'ROY', 'DPOY', '6MOY', 'MIP', 'Scoring title', 'All-NBA 1st', 'All-NBA 2nd', 'All-NBA 3rd', 'All-Defensive'];

export function buildChronicle(w: World): string {
  const out: string[] = [];
  const P = w.players, past = w.pastSeasons;
  const name = (id: string) => P[id]?.name ?? '(unknown)';
  const abbrIn = (y: number, tid: string) => past.find(s => s.year === y)?.names?.[tid]?.abbr ?? w.teams[tid]?.abbr ?? tid;
  const C = chronicle(w);
  const first = past[0]?.year ?? w.season.year, last = past[past.length - 1]?.year ?? w.season.year - 1;
  const logFrom = C.length ? C[0][0] : null;

  // ---------------------------------------------------------------- derived career data
  const champAbbr: Record<number, string> = Object.fromEntries(past.map(s => [s.year, abbrIn(s.year, s.champion)]));
  const titlesOf = (p: Player) => past.filter(s => (p.stats ?? []).some(l => l.season === s.year && l.playoffs && l.team === champAbbr[s.year])).map(s => s.year);
  const aw = (p: Player, k: string) => (p.awards ?? []).filter(a => a.award === k).map(a => a.season);
  const reg = (p: Player) => (p.stats ?? []).filter(l => !l.playoffs);
  const tot = (p: Player) => reg(p).reduce((a, l) => ({ g: a.g + l.g, pts: a.pts + l.pts, reb: a.reb + l.oreb + l.dreb, ast: a.ast + l.ast }), { g: 0, pts: 0, reb: 0, ast: 0 });
  const peak = (p: Player) => Math.max((p as any).peak ?? 0, Math.round(playerValue(p)));
  const score = (p: Player) => aw(p, 'MVP').length * 12 + aw(p, 'Finals MVP').length * 7 + aw(p, 'All-NBA 1st').length * 4 + aw(p, 'All-NBA 2nd').length * 3 + aw(p, 'All-NBA 3rd').length * 2
    + aw(p, 'DPOY').length * 3 + titlesOf(p).length * 3 + tot(p).pts / 1500 + Math.max(0, peak(p) - 80);
  const played = Object.values(P).filter(p => reg(p).length);
  const scored = played.map(p => ({ p, s: score(p) })).sort((a, b) => b.s - a.s);
  const userAbbrs = new Set(past.map(s => (s as any).chron?.user?.abbr).filter(Boolean));
  const dossier = new Set(scored.slice(0, 72).map(x => x.p.id));
  for (const x of scored) { if (dossier.size >= 80) break; if (reg(x.p).filter(l => userAbbrs.has(l.team)).length >= 3 && tot(x.p).pts >= 4000) dossier.add(x.p.id); }
  const isStar = (id: string) => dossier.has(id);
  const tag = (id: string) => (isStar(id) ? `${name(id)}★` : name(id));

  // ---------------------------------------------------------------- header
  const u = w.teams[w.meta.userTeam];
  out.push(`# LEAGUE CHRONICLE — ${w.meta.title}`);
  out.push(`format: hnba-chronicle/1 · exported ${new Date().toISOString().slice(0, 10)} · seasons ${SL(first)} to ${SL(last)} (${past.length} complete) · current: ${SL(w.season.year)} ${w.season.phase} · teams now: ${Object.keys(w.teams).length}`);
  out.push('');
  out.push('## 0. READ ME FIRST (for the AI writer)');
  out.push('- This is a simulated alternate history of the NBA starting with the 1976–77 post-merger season. The people are real names, but every result, trade, feud and title below happened in THIS simulation, not in real life. Do not import real-world outcomes, careers or quotes.');
  out.push('- Personalities, motivations and relationships are simulated "in this universe" and are not claims about the real people.');
  out.push('- Your job: write a dramatic history using these causes and results. Invent texture (crowds, scenes, imagined quotes clearly framed), never results.');
  out.push('- Conventions: teams by abbreviation (Section 5 maps them to full names by era); OVR is a 40–99 rating (70 good starter, 78 All-Star, 85 MVP-level, 92+ all-time great); ★ = a player with a dossier in Section 4; [USER] = the human-controlled GM\'s team or decision; seed numbers in parentheses; dates are MM-DD within a season (Oct → Sep).');
  out.push(`- The human GM: ${w.meta.gmName}, currently with ${u.city} ${u.name} (${u.abbr}), mode ${w.meta.mode}. Section 7 tells his story.`);
  out.push(`- Detailed event log ${logFrom ? `begins in ${SL(logFrom)}; earlier seasons have results, awards and stats only` : 'is empty (older save); seasons have results, awards and stats only'}.`);
  out.push('- Sections: 1 League at a glance · 2 Storylines (auto-detected) · 3 Seasons · 4 Player dossiers · 5 Franchises · 6 Rivalries, feuds and bonds · 7 The GM · 8 Records.');
  out.push('');

  // ---------------------------------------------------------------- 1. glance
  out.push('## 1. LEAGUE AT A GLANCE');
  out.push('Champions by season (champion def. runner-up, Finals result, Finals MVP):');
  for (const s of past) out.push(`- ${SL(s.year)}: ${champAbbr[s.year]} def. ${s.runnerUp ? abbrIn(s.year, s.runnerUp) : '?'} ${s.finals ?? ''}${s.awards?.['Finals MVP'] ? ` · FMVP ${tag(s.awards['Finals MVP'])}` : ''}${s.awards?.MVP ? ` · MVP ${tag(s.awards.MVP)}` : ''}`);
  out.push('');

  // export-time filter (older saves logged more) and condensing of repeats
  const pk = (id?: string) => (id && P[id] ? peak(P[id]) : 0);
  const keepE = (e: ChronEntry) => {
    const ids = e[4] ?? [], top = Math.max(0, ...ids.map(pk)), user = e[3].includes('[USER]');
    if (e[2] === 'signing') return /re-signed/.test(e[3]) ? top >= 90 || user && top >= 78 : top >= 82 || user && top >= 74;
    if (e[2] === 'injury') { const d = +(e[3].match(/est\. (\d+) days/)?.[1] ?? 0), m = +e[1].slice(0, 2); return top >= 83 && d >= 30 || (m >= 4 && m <= 6) && top >= 75 && d >= 10; }
    if (e[2] === 'trade') return top >= 72 || user;
    if (e[2] === 'expansion') return / added /.test(e[3]) || / took /.test(e[3]);
    return true;
  };
  const condense = (L: ChronEntry[]): ChronEntry[] => {
    const res: ChronEntry[] = [], clash: Record<string, ChronEntry[]> = {}, exp: Record<string, string[]> = {};
    for (const e of L) {
      if (e[2] === 'dynasty_incident' && e[4]?.length === 2) { (clash[[...e[4]].sort().join('|')] ??= []).push(e); continue; }
      const m = e[2] === 'expansion' && e[3].match(/^(\w+) took (.+) from (\w+) in the expansion draft/);
      if (m) { (exp[m[1]] ??= []).push(`${m[2]} (${m[3]})`); continue; }
      res.push(e);
    }
    for (const [k, es] of Object.entries(clash)) { const [a, b] = k.split('|'); res.push([es[0][0], es[0][1], 'dynasty_incident', es.length === 1 ? es[0][3] : `${name(a)} and ${name(b)} clashed ${es.length} times (${es.map(x => x[1]).join(', ')}), the first: ${es[0][3]}`, [a, b]]); }
    for (const [t, ps] of Object.entries(exp)) res.push([L[0]?.[0] ?? 0, '05-15', 'expansion', `${t} expansion draft: ${ps.join(', ')}`]);
    return res.sort((a, b) => ord(a[1]) - ord(b[1]));
  };

  // ---------------------------------------------------------------- 2. storylines
  out.push('## 2. STORYLINES (detected from the data; use, combine or ignore)');
  const champs = past.map(s => ({ y: s.year, t: s.champion }));
  const byTeam: Record<string, number[]> = {};
  for (const c of champs) (byTeam[c.t] ??= []).push(c.y);
  // dynasties: 3+ titles in 5 seasons
  for (const [tid, ys] of Object.entries(byTeam)) {
    for (let i = 0; i < ys.length; i++) {
      const win = ys.filter(y => y >= ys[i] && y < ys[i] + 5);
      if (win.length >= 3 && (i === 0 || ys[i - 1] < ys[i] - 4)) {
        const core = scored.map(x => x.p).filter(p => win.filter(y => titlesOf(p).includes(y)).length >= 2).slice(0, 4).map(p => tag(p.id));
        out.push(`- DYNASTY: ${abbrIn(win[0], tid)} won ${win.length} titles in five seasons, from ${SL(win[0])} to ${SL(win[win.length - 1])} (${win.map(SL).join(', ')}). Core: ${core.join(', ') || 'see seasons'}.`);
      }
    }
  }
  for (let i = 0; i < champs.length;) {
    let j = i; while (j + 1 < champs.length && champs[j + 1].t === champs[i].t) j++;
    const n = j - i + 1;
    if (n >= 2) out.push(`- ${n >= 3 ? `${n} STRAIGHT TITLES` : 'REPEAT'}: ${abbrIn(champs[i].y, champs[i].t)} won ${SL(champs[i].y)} through ${SL(champs[j].y)}.`);
    i = j + 1;
  }
  const firstTitles = Object.entries(byTeam).map(([tid, ys]) => ({ tid, y: ys[0] })).sort((a, b) => a.y - b.y);
  out.push(`- FIRST TITLES IN THIS UNIVERSE: ${firstTitles.map(x => `${abbrIn(x.y, x.tid)} ${SL(x.y)}`).join('; ')}.`);
  const never = Object.values(w.teams).filter(t => !byTeam[t.id]).map(t => `${t.abbr}${t.founded ? ` (since ${t.founded})` : ''}`);
  if (never.length) out.push(`- STILL WAITING FOR A TITLE: ${never.join(', ')}.`);
  for (const [tid, ys] of Object.entries(byTeam)) for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] >= 15) out.push(`- DROUGHT ENDED: ${abbrIn(ys[i], tid)} won in ${SL(ys[i])} after ${ys[i] - ys[i - 1] - 1} seasons without a title.`);
  // upsets, cinderellas, rivalries from series
  const meet: Record<string, { n: number; rec: Record<string, number>; ys: number[] }> = {};
  const upsets: { v: number; t: string }[] = [];
  for (const s of past) for (const x of ((s as any).chron?.series ?? []) as any[]) {
    const k = [x.hi, x.lo].sort().join('-'); const m = meet[k] ??= { n: 0, rec: {}, ys: [] }; m.n++; m.rec[x.win] = (m.rec[x.win] ?? 0) + 1; m.ys.push(s.year);
    if (x.win === x.lo && x.sl - x.sh >= 3) upsets.push({ v: (x.sl - x.sh) + x.r * 1.5, t: `- UPSET: ${SL(s.year)} round ${x.r}: (${x.sl}) ${x.lo} beat (${x.sh}) ${x.hi} ${x.wl}-${x.wh}.` });
    if (x.r === 4 && x.win === x.lo && x.sl >= 4) out.push(`- CINDERELLA: ${SL(s.year)} ${x.lo}, a ${x.sl} seed, won the title.`);
  }
  for (const x of upsets.sort((a, b) => b.v - a.v).slice(0, 14)) out.push(x.t);
  for (const [k, m] of Object.entries(meet).filter(([, m]) => m.n >= 4).sort((a, b) => b[1].n - a[1].n).slice(0, 8))
    out.push(`- PLAYOFF RIVALRY: ${k.replace('-', ' vs ')} met ${m.n} times (${Object.entries(m.rec).map(([t, n]) => `${t} ${n}`).join(', ')}) in ${m.ys.map(SL).join(', ')}.`);
  // superteams, trade requests that ended in trades, feuds
  for (const e of C.filter(e => e[2] === 'superteam')) out.push(`- TEAM-UP: ${SL(e[0])}: ${e[3]}.`);
  for (const e of C.filter(e => e[2] === 'trade_request' && (pk(e[4]?.[0]) >= 80 || C.some(x => x[2] === 'trade' && x[4]?.includes(e[4]?.[0] ?? '-') && x[0] >= e[0] && x[0] <= e[0] + 1))).slice(-16)) {
    const pid = e[4]?.[0]; const tr = pid ? C.find(x => x[2] === 'trade' && x[4]?.includes(pid) && (x[0] > e[0] || x[0] === e[0] && ord(x[1]) > ord(e[1])) && x[0] <= e[0] + 1) : undefined;
    out.push(`- WANTED OUT: ${SL(e[0])} ${e[3]}${tr ? ` → traded ${SL(tr[0])}: ${tr[3]}` : ' → stayed (for now)'}.`);
  }
  const feudCount: Record<string, number> = {};
  for (const e of C.filter(e => (e[2] === 'dynasty_incident' || e[2] === 'feud') && e[4]?.length === 2)) { const k = [...e[4]!].sort().join('|'); feudCount[k] = (feudCount[k] ?? 0) + (e[2] === 'dynasty_incident' ? 2 : 1); }
  for (const [k, n] of Object.entries(feudCount).sort((a, b) => b[1] - a[1]).slice(0, 10)) { const [a, b] = k.split('|'); out.push(`- FEUD: ${tag(a)} and ${tag(b)} (intensity ${n}; see Sections 3 and 6).`); }
  // careers: ringless greats, multi-MVPs, cut short, draft steals and busts
  let ringless = 0;
  for (const { p } of scored.slice(0, 60)) {
    const t = titlesOf(p), mv = aw(p, 'MVP');
    if (!t.length && (peak(p) >= 88 || mv.length) && ringless++ < 10) out.push(`- RINGLESS GREAT: ${tag(p.id)} (peak OVR ${peak(p)}${mv.length ? `, ${mv.length}× MVP` : ''}) never won a title.`);
    if (mv.length >= 3) out.push(`- MULTIPLE MVP: ${tag(p.id)} won MVP ${mv.length}× (${mv.map(SL).join(', ')}).`);
    if (p.retired && (p.age ?? 40) <= 32 && peak(p) >= 84) out.push(`- CAREER CUT SHORT: ${tag(p.id)} retired at ${p.age} after peaking at ${peak(p)}.`);
    const pk = (p as any).draftPick as number | undefined;
    if (pk && pk >= 15 && (peak(p) >= 84 || mv.length)) out.push(`- DRAFT STEAL: ${tag(p.id)} went No. ${pk} to ${p.draftedBy ? abbrIn(p.draftClass ?? first, p.draftedBy) : '?'} in ${p.draftClass ?? '?'} and peaked at ${peak(p)}.`);
  }
  let busts = 0;
  for (const p of played) { const pk = (p as any).draftPick as number | undefined; if (busts < 8 && pk && pk <= 3 && reg(p).length >= 3 && peak(p) <= 68 && (p.draftClass ?? 0) <= last - 4) out.push(`- DRAFT BUST: ${p.name} went No. ${pk} in ${p.draftClass} and peaked at ${peak(p)}.`) && busts++; }
  for (const e of C.filter(e => e[2] === 'franchise' || e[2] === 'expansion')) out.push(`- FRANCHISE MOVE/BIRTH: ${SL(e[0])}: ${e[3]}.`);
  out.push('');

  // ---------------------------------------------------------------- 3. seasons
  out.push('## 3. SEASONS');
  const KIND_RANK: Record<string, number> = { superteam: 0, trade_request: 0, dynasty_incident: 0, crisis: 0, fired: 0, gm_hired: 0, franchise: 0, expansion: 0, game7: 1, trade: 1, feud: 1, superteam_talk: 1, culture: 2, signing: 2, injury: 2, coach_change: 2, mediation: 2, meeting: 2, promise: 2, mentor: 3, retire: 3, feat: 3, draft: 3, release: 3, recruit: 2, clock: 3 };
  for (const s of past) {
    const y = s.year, ch = (s as any).chron;
    out.push(`### ${SL(y)}`);
    const fin = (ch?.series ?? []).find((x: any) => x.r === 4);
    out.push(`Champion: ${champAbbr[y]}${s.runnerUp ? ` def. ${abbrIn(y, s.runnerUp)} ${s.finals ?? ''}` : ''}${fin ? ` · Finals games: ${fin.games.join(', ')}` : ''}${s.awards?.['Finals MVP'] ? ` · Finals MVP ${tag(s.awards['Finals MVP'])}` : ''}`);
    const st = [...s.standings].sort((a, b) => b.w - a.w);
    out.push(`Standings: best ${st.slice(0, 4).map(x => `${abbrIn(y, x.team)} ${x.w}-${x.l}`).join(', ')} · worst ${st.slice(-2).map(x => `${abbrIn(y, x.team)} ${x.w}-${x.l}`).join(', ')}`);
    const awl: string[] = [];
    for (const k of AWARD_ORDER) {
      const v = s.awards?.[k]; if (!v) continue;
      if (Array.isArray(v)) awl.push(`${k}: ${v.map(tag).join(', ')}`);
      else if (k === 'MVP') { const g = P[v] ? perGame(P[v], y) : null; awl.push(`MVP: ${tag(v)}${g?.g ? ` (${g.team} ${f1(g.ppg)} ppg ${f1(g.rpg)} rpg ${f1(g.apg)} apg)` : ''}`); }
      else if (k === 'Scoring title') awl.push(`Scoring title: ${tag(v)}${s.awards.scoringPPG ? ` ${s.awards.scoringPPG}` : ''}`);
      else awl.push(`${k}: ${tag(v)}`);
    }
    if (s.awards?.COY) awl.push(`COY: ${s.awards.COY}${s.awards.COYteam ? ` (${abbrIn(y, s.awards.COYteam)})` : ''}`);
    if (awl.length) out.push(`Awards: ${awl.join(' · ')}`);
    if (ch?.leaders) out.push(`Leaders: PPG ${ch.leaders.ppg} · RPG ${ch.leaders.rpg} · APG ${ch.leaders.apg}`);
    if (ch?.series?.length) {
      const flag = (x: any) => [x.win === x.lo && x.sl - x.sh >= 3 ? 'UPSET' : '', x.wh + x.wl >= 7 ? 'G7' : '', Math.min(x.wh, x.wl) === 0 && Math.max(x.wh, x.wl) >= 3 ? 'SWEEP' : ''].filter(Boolean).join(' ');
      out.push(`Playoffs: ${ch.series.sort((a: any, b: any) => a.r - b.r).map((x: any) => `R${x.r} ${x.win === x.hi ? `${x.hi}(${x.sh}) d. ${x.lo}(${x.sl}) ${x.wh}-${x.wl}` : `${x.lo}(${x.sl}) d. ${x.hi}(${x.sh}) ${x.wl}-${x.wh}`}${flag(x) ? ` [${flag(x)}]` : ''}`).join(' | ')}`);
      if (ch.poTop?.length) out.push(`Playoff scoring: ${ch.poTop.join('; ')}`);
    }
    if (ch?.user) out.push(`[USER] GM ${ch.user.gm} with ${ch.user.abbr}: ${ch.user.w}-${ch.user.l}, ${ch.user.result ?? '?'}${ch.user.fired ? ', then fired' : ''}`);
    const ev = condense(C.filter(e => e[0] === y && keepE(e)).sort((a, b) => ord(a[1]) - ord(b[1])));
    const capped = ev.length > 24 ? ev.filter(e => (KIND_RANK[e[2]] ?? 3) <= (ev.filter(x => (KIND_RANK[x[2]] ?? 3) <= 1).length > 24 ? 0 : ev.filter(x => (KIND_RANK[x[2]] ?? 3) <= 2).length > 24 ? 1 : 2)) : ev;
    if (capped.length) { out.push('Events:'); for (const e of capped.slice(0, 28)) out.push(`- ${e[1]} ${e[2]}: ${e[3]}`); }
    out.push('');
  }

  // ---------------------------------------------------------------- 4. players
  out.push('## 4. PLAYER DOSSIERS (★), most decorated first');
  for (const id of dossier) {
    const p = P[id]; if (!p) continue;
    const L = reg(p).sort((a, b) => a.season - b.season);
    const stints: string[] = [];
    for (const l of L) { const lastS = stints[stints.length - 1]; const key = l.team; if (lastS?.startsWith(key + ' ')) { stints[stints.length - 1] = `${key} ${lastS.split(' ')[1].split('–')[0]}–${l.season}`; } else stints.push(`${key} ${l.season}`); }
    const T = tot(p), best = L.reduce((b, l) => (l.g && l.pts / l.g > (b?.pts ?? 0) / (b?.g || 1) ? l : b), L[0]);
    const t = titlesOf(p);
    const hon = ['MVP', 'Finals MVP', 'All-NBA 1st', 'All-NBA 2nd', 'All-NBA 3rd', 'DPOY', 'ROY', '6MOY', 'MIP', 'All-Defensive', 'Scoring title'].map(k => ({ k, ys: aw(p, k) })).filter(x => x.ys.length)
      .map(x => `${x.ys.length}× ${x.k}${(x.k === 'MVP' || x.k === 'Finals MVP') ? ` (${x.ys.join(', ')})` : ''}`).join('; ');
    out.push(`#### ${p.name} — ${p.pos}, born ${p.born?.slice(0, 4) ?? '?'}${(p as any).draftPick ? `, drafted ${p.draftClass} No. ${(p as any).draftPick} by ${p.draftedBy ? abbrIn(p.draftClass ?? first, p.draftedBy) : '?'}` : p.nbaId ? '' : ', fictional (generated)'}${p.retired ? `, retired at ${p.age}` : `, active (age ${p.age}, ${p.team ? w.teams[p.team].abbr : 'free agent'})`}`);
    out.push(`Teams: ${stints.join(', ')}`);
    out.push(`Career: ${T.g} g, ${f1(T.pts / Math.max(1, T.g))} ppg, ${f1(T.reb / Math.max(1, T.g))} rpg, ${f1(T.ast / Math.max(1, T.g))} apg, ${T.pts} pts${best ? ` · best season ${SL(best.season)} ${f1(best.pts / Math.max(1, best.g))} ppg` : ''} · peak OVR ${peak(p)}${(p as any).peakAge ? ` at ${(p as any).peakAge}` : ''}`);
    out.push(`Titles: ${t.length ? `${t.length} (${t.map(SL).join(', ')})` : 'none'}${hon ? ` · Honors: ${hon}` : ''}`);
    const tr = p.traits;
    out.push(`Personality (simulated): ${personaLabel(p) ?? 'no archetype'}; mentality ${mentalityWord(p)} (${Math.round(mentality(p))}); drive ${tr.drive}, ego ${tr.ego}, assertive ${tr.assert ?? '?'}, composure ${tr.poise ?? '?'}, team-first ${tr.team ?? '?'}, loyalty ${tr.loyalty}, work ethic ${tr.discipline}; driven by ${topMotives(p, 3).join(', ').toLowerCase() || '?'}`);
    const bonds: string[] = [];
    for (const q of dossier) { if (q === id) continue; const a = rel(w, id, q), b = rel(w, q, id); if (!a && !b) continue; const aff = Math.min(a?.[0] ?? 50, b?.[0] ?? 50), conf = Math.max(a?.[3] ?? 0, b?.[3] ?? 0); if (aff >= 72) bonds.push(`close with ${name(q)}`); else if (conf >= 50) bonds.push(`friction with ${name(q)}`); }
    const allNotes = (((w as any).relNotes ?? []) as { a: string; b: string; s: number; t: string }[]).filter(x => x.a === id || x.b === id);
    const oly = allNotes.filter(x => /Olympic team/.test(x.t)).map(x => name(x.a === id ? x.b : x.a));
    const notes = [...(oly.length ? [`Olympic teammates: ${oly.slice(0, 5).join(', ')}`] : []), ...allNotes.filter(x => !/Olympic team/.test(x.t)).slice(0, 3).map(x => `${x.s}: ${x.t}`)];
    const ev = condense(C.filter(e => e[4]?.includes(id) && keepE(e) && ['trade', 'trade_request', 'superteam', 'dynasty_incident', 'feud', 'injury', 'game7'].includes(e[2]))).slice(-6).map(e => `${SL(e[0])} ${e[2]}: ${e[3]}`);
    if (bonds.length) out.push(`Bonds: ${bonds.slice(0, 6).join('; ')}`);
    if (notes.length) out.push(`Remembers: ${notes.join(' | ')}`);
    if (ev.length) out.push(`Key moments: ${ev.join(' | ')}`);
    out.push('');
  }

  // ---------------------------------------------------------------- 5. franchises
  out.push('## 5. FRANCHISES');
  for (const t of Object.values(w.teams)) {
    const names: string[] = [];
    let cur = '', from = 0;
    for (const s of past) { const n = s.names?.[t.id]; if (!n) continue; const lbl = `${n.city} ${n.name} (${n.abbr})`; if (lbl !== cur) { if (cur) names.push(`${cur} ${from}–${s.year - 1}`); cur = lbl; from = s.year; } }
    if (cur) names.push(`${cur} ${from}–`); else names.push(`${t.city} ${t.name} (${t.abbr}) ${t.founded ?? first}–`);
    const h = t.history;
    const ti = h.filter(x => x.result === 'Champion').map(x => SL(x.season)), fl = h.filter(x => x.result === 'Finals').map(x => SL(x.season));
    const bestS = [...h].sort((a, b) => b.w - a.w)[0], worstS = [...h].sort((a, b) => a.w - b.w)[0];
    // franchise greats: most points in this franchise's colours
    const abbrs = new Set(past.map(s => s.names?.[t.id]?.abbr).filter(Boolean).concat([t.abbr]));
    const greats = played.map(p => ({ p, pts: reg(p).filter(l => abbrs.has(l.team)).reduce((a, l) => a + l.pts, 0), yrs: reg(p).filter(l => abbrs.has(l.team)).length })).filter(x => x.yrs >= 3).sort((a, b) => b.pts - a.pts).slice(0, 5);
    const c = culture(t);
    out.push(`- ${t.id}: ${names.join(' → ')} · titles ${ti.length}${ti.length ? ` (${ti.join(', ')})` : ''} · Finals losses ${fl.length}${fl.length ? ` (${fl.join(', ')})` : ''} · playoffs ${h.filter(x => x.result !== 'Missed playoffs').length}/${h.length} · best ${bestS ? `${SL(bestS.season)} ${bestS.w}-${bestS.l}` : '-'} · worst ${worstS ? `${SL(worstS.season)} ${worstS.w}-${worstS.l}` : '-'} · culture now ${c?.label ?? '?'} · franchise greats: ${greats.map(x => `${tag(x.p.id)} (${x.yrs} yrs, ${x.pts} pts)`).join(', ')}`);
  }
  out.push('');

  // ---------------------------------------------------------------- 6. rivalries and bonds
  out.push('## 6. RIVALRIES, FEUDS AND BONDS');
  for (const [k, m] of Object.entries(meet).filter(([, m]) => m.n >= 3).sort((a, b) => b[1].n - a[1].n).slice(0, 12)) out.push(`- Teams ${k}: ${m.n} playoff series (${Object.entries(m.rec).map(([t, n]) => `${t} won ${n}`).join(', ')})`);
  for (const [k, n] of Object.entries(feudCount).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    const [a, b] = k.split('|'); const inc = C.filter(e => e[4]?.includes(a) && e[4]?.includes(b) && ['dynasty_incident', 'feud', 'crisis', 'mediation'].includes(e[2])).map(e => `${SL(e[0])} ${e[3]}`);
    out.push(`- Feud ${name(a)} vs ${name(b)}: ${inc.slice(0, 5).join(' | ')}`);
  }
  const friends: string[] = [];
  const ids = [...dossier];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const a = rel(w, ids[i], ids[j]), b = rel(w, ids[j], ids[i]); if (a && b && a[0] >= 78 && b[0] >= 78) friends.push(`${name(ids[i])} & ${name(ids[j])}`); }
  if (friends.length) out.push(`- Close friendships among stars: ${friends.slice(0, 25).join('; ')}`);
  const ment = C.filter(e => e[2] === 'mentor').map(e => `${SL(e[0])} ${e[3]}`);
  if (ment.length) out.push(`- Mentorships: ${ment.slice(0, 25).join(' | ')}`);
  const talks = C.filter(e => e[2] === 'superteam_talk').map(e => `${SL(e[0])} ${e[3]}`);
  if (talks.length) out.push(`- Team-up talks (formed ones are in Section 2): ${talks.join(' | ')}`);
  out.push('');

  // ---------------------------------------------------------------- 7. the GM
  out.push('## 7. THE GM [USER]');
  const gl = past.map(s => (s as any).chron?.user).filter(Boolean);
  if (gl.length) out.push(`Season by season: ${past.filter(s => (s as any).chron?.user).map(s => { const x = (s as any).chron.user; return `${SL(s.year)} ${x.abbr} ${x.w}-${x.l} ${x.result ?? ''}${x.fired ? ' FIRED' : ''}`; }).join(' | ')}`);
  else out.push(`Current team: ${u.abbr}. Season-by-season GM records are kept from the version that added this export onward.`);
  const mine = C.filter(e => ['fired', 'gm_hired', 'clock', 'promise', 'crisis', 'mediation', 'meeting'].includes(e[2]) || (e[3].includes('[USER]') && ['trade', 'signing', 'superteam', 'trade_request', 'recruit'].includes(e[2]) && keepE(e)));
  for (const e of mine.slice(-120)) out.push(`- ${SL(e[0])} ${e[1]} ${e[2]}: ${e[3]}`);
  const pr = (w.promises ?? []).filter(x => x.status === 'kept' || x.status === 'broken');
  if (pr.length) out.push(`Promises: ${pr.filter(x => x.status === 'kept').length} kept, ${pr.filter(x => x.status === 'broken').length} broken. ${pr.slice(-10).map(x => `${x.status} to ${name(x.to)}: "${x.text ?? x.kind}"`).join('; ')}`);
  out.push('');

  // ---------------------------------------------------------------- 8. records
  out.push('## 8. RECORDS');
  const top = (f: (p: Player) => number, n = 10) => played.map(p => ({ p, v: f(p) })).sort((a, b) => b.v - a.v).slice(0, n).map(x => `${tag(x.p.id)} ${Math.round(x.v)}`).join(', ');
  out.push(`Career points: ${top(p => tot(p).pts)}`);
  out.push(`Career rebounds: ${top(p => tot(p).reb)}`);
  out.push(`Career assists: ${top(p => tot(p).ast)}`);
  out.push(`Most titles: ${top(p => titlesOf(p).length, 8)}`);
  out.push(`Most MVPs: ${top(p => aw(p, 'MVP').length, 6)}`);
  const seasons = played.flatMap(p => reg(p).filter(l => l.g >= 50).map(l => ({ p, l, ppg: l.pts / l.g }))).sort((a, b) => b.ppg - a.ppg).slice(0, 8);
  out.push(`Highest-scoring seasons: ${seasons.map(x => `${x.p.name} ${SL(x.l.season)} ${x.l.team} ${f1(x.ppg)}`).join(', ')}`);
  const teamS = past.flatMap(s => s.standings.map(x => ({ y: s.year, t: abbrIn(s.year, x.team), w: x.w, l: x.l, pct: x.w / Math.max(1, x.w + x.l) }))).sort((a, b) => b.pct - a.pct);
  out.push(`Best records: ${teamS.slice(0, 6).map(x => `${x.t} ${SL(x.y)} ${x.w}-${x.l}`).join(', ')} · worst: ${teamS.slice(-4).map(x => `${x.t} ${SL(x.y)} ${x.w}-${x.l}`).join(', ')}`);
  const feats = C.filter(e => e[2] === 'feat').map(e => ({ e, pts: +(e[3].match(/\) (\d+) pts/)?.[1] ?? 0) })).sort((a, b) => b.pts - a.pts).slice(0, 12);
  if (feats.length) out.push(`Greatest single games: ${feats.map(x => `${SL(x.e[0])} ${x.e[3]}`).join(' | ')}`);
  out.push('');
  out.push('— end of chronicle —');
  return out.join('\n');
}

export type { ChronEntry };
