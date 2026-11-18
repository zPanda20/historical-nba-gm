// Playoff bracket for any era: 12 teams with byes (1977–83), 16 teams (1984–), play-in (2021–).
// East on the left, West on the right, the Finals in the middle.
import type { Series, World } from '../sim/types';
import { seedConference } from '../sim/league';
import { eraRules } from '../sim/history';
import { Logo, place, seasonLabel } from './util';
import { openModal, setUI } from './store';

function seedsOf(w: World, conf: string): string[] {
  const s = w.season.playoffs?.seeds?.[conf] ?? (w.season as any)[`seeds${conf}`] as string[] | undefined;
  return s ?? seedConference(w, conf);
}

function Slot({ w, tid, seed, wins, won, lost, live }: { w: World; tid?: string; seed?: number; wins?: number; won?: boolean; lost?: boolean; live?: boolean }) {
  if (!tid) return <div class="bk-slot tbd"><span class="bk-seed">{seed ?? ''}</span><span class="bk-n">{seed ? 'Play-in winner' : 'To be decided'}</span></div>;
  const t = w.teams[tid];
  return <div class={`bk-slot ${won ? 'won' : ''} ${lost ? 'lost' : ''} ${tid === w.meta.userTeam ? 'me' : ''}`}>
    <span class="bk-seed">{seed}</span><Logo t={t} size={24} /><span class="bk-n">{place(t)}</span>{wins !== undefined && <b class={live ? 'live' : ''}>{wins}</b>}
  </div>;
}

function Box({ w, s, seeds, label, proj, projSeeds }: { w: World; s?: Series; seeds: Record<string, number>; label?: string; proj?: [string | undefined, string | undefined]; projSeeds?: [number, number] }) {
  if (!s) return <div class="bk-box">{label && <div class="bk-lab">{label}</div>}
    <Slot w={w} tid={proj?.[0]} seed={proj?.[0] ? seeds[proj[0]] : projSeeds?.[0]} /><Slot w={w} tid={proj?.[1]} seed={proj?.[1] ? seeds[proj[1]] : projSeeds?.[1]} /></div>;
  const live = !s.winner;
  const last = s.games.length ? s.games[s.games.length - 1] : null;
  const lg = last ? w.season.games.find(g => g.id === last) : null;
  return <button data-nav class={`bk-box ${live ? 'live' : ''}`} title={lg?.log ? 'Replay the last game' : 'Box score'} onClick={() => lg && (lg.log ? setUI({ gamecast: lg.id }) : openModal('box', { id: lg.id }))}>
    <div class="bk-lab">{label ?? ''}{label ? ' · ' : ''}{s.bestOf === 1 ? 'one game' : `best of ${s.bestOf}`}</div>
    <Slot w={w} tid={s.hi} seed={seeds[s.hi]} wins={s.bestOf === 1 ? undefined : s.wHi} won={s.winner === s.hi} lost={!!s.winner && s.winner !== s.hi} live={live} />
    <Slot w={w} tid={s.lo} seed={seeds[s.lo]} wins={s.bestOf === 1 ? undefined : s.wLo} won={s.winner === s.lo} lost={!!s.winner && s.winner !== s.lo} live={live} />
  </button>;
}

function Bye({ w, tid, seed }: { w: World; tid?: string; seed: number }) {
  return <div class="bk-box bye"><div class="bk-lab">First-round bye</div><Slot w={w} tid={tid} seed={seed} /></div>;
}

export function Bracket({ w, compact }: { w: World; compact?: boolean }) {
  const P = w.season.playoffs;
  const R = eraRules(w.season.year);
  const byes = P?.format ? P.format.byes : R.byes;
  const r1Best = P?.format?.bestOf?.[1] ?? R.r1BestOf;
  const ser = (round: number, conf: string) => (P?.series ?? []).filter(s => s.round === round && s.conf === conf).sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
  const conf = (c: 'East' | 'West') => {
    const sd = seedsOf(w, c);
    const seeds: Record<string, number> = {}; sd.forEach((id, i) => (seeds[id] = i + 1));
    return { c, sd, seeds, r1: ser(1, c), r2: ser(2, c), cf: ser(3, c)[0], pi: ser(0, c) };
  };
  const E = conf('East'), Wc = conf('West');
  const allSeeds = { ...E.seeds, ...Wc.seeds };
  const fin = (P?.series ?? []).find(s => s.round === 4);
  const champ = w.season.champion;
  const playIn = P?.format ? P.format.playIn : R.playIn;
  const col = (c: typeof E, side: 'l' | 'r') => {
    // old saves stored the 3v6 series first; slot tells us the bracket position when present
    const r1 = c.r1;
    const s7 = playIn && (!P || P.round === 0) ? undefined : c.sd[6], s8 = playIn && (!P || P.round === 0) ? undefined : c.sd[7];
    const firstCol = byes
      ? (() => { const lo45 = r1.find(s => [c.sd[3], c.sd[4]].includes(s.hi)), lo36 = r1.find(s => [c.sd[2], c.sd[5]].includes(s.hi));
        return [<Bye w={w} tid={c.sd[0]} seed={1} />, <Box w={w} s={lo45} seeds={c.seeds} label={P ? undefined : `Best of ${r1Best}`} proj={[c.sd[3], c.sd[4]]} />,
          <Bye w={w} tid={c.sd[1]} seed={2} />, <Box w={w} s={lo36} seeds={c.seeds} label={P ? undefined : `Best of ${r1Best}`} proj={[c.sd[2], c.sd[5]]} />]; })()
      : [[0, 7], [3, 4], [2, 5], [1, 6]].map(([a, b], k) => <Box w={w} s={r1[k]} seeds={c.seeds} label={P ? undefined : `Best of ${r1Best}`} proj={[c.sd[a], b === 7 ? s8 : b === 6 ? s7 : c.sd[b]]} projSeeds={[a + 1, b + 1]} />);
    return [
      <div class={`bk-col r1 ${side} ${byes ? '' : 'n4'}`}>{firstCol}</div>,
      <div class={`bk-col sf ${side}`}><Box w={w} s={c.r2[0]} seeds={c.seeds} /><Box w={w} s={c.r2[1]} seeds={c.seeds} /></div>,
      <div class={`bk-col cf ${side}`}><Box w={w} s={c.cf} seeds={c.seeds} /></div>,
    ];
  };
  const [e1, e2, e3] = col(E, 'l'), [w1, w2, w3] = col(Wc, 'r');
  const piRow = playIn && (P ? P.series.some(s => s.round === 0) && !(compact && P.round >= 1) : true) && <div class="bk-playin">
    {[E, Wc].map(c => <div class="bk-pi"><span>{c.c} play-in</span>
      {P ? c.pi.map(s => <Box w={w} s={s} seeds={c.seeds} label={s.id.endsWith('a') ? '7 v 8' : s.id.endsWith('b') ? '9 v 10' : 'For the 8 seed'} />)
        : [<Box w={w} seeds={c.seeds} label="7 v 8" proj={[c.sd[6], c.sd[7]]} />, <Box w={w} seeds={c.seeds} label="9 v 10" proj={[c.sd[8], c.sd[9]]} />]}
    </div>)}
  </div>;
  return <div class={`bracket2 ${compact ? 'compact' : ''}`}>
    <div class="bk-heads"><span>East · first round</span><span>Semifinals</span><span>East final</span><span class="mid">NBA Finals</span><span>West final</span><span>Semifinals</span><span>West · first round</span></div>
    <div class="bk-grid">
      {e1}{e2}{e3}
      <div class="bk-col fin">
        <Box w={w} s={fin} seeds={allSeeds} />
        {champ && <div class="bk-champ"><Logo t={w.teams[champ]} size={compact ? 56 : 84} /><span>{seasonLabel(w.season.year)} champions</span><b>{w.teams[champ].city} {w.teams[champ].name}</b></div>}
      </div>
      {w3}{w2}{w1}
    </div>
    {piRow}
    {!P && <div class="bk-note">If the season ended today. {byes ? `Division winners take seeds 1–2 and skip the best-of-${r1Best} first round.` : playIn ? 'Seeds 7–10 go to the play-in.' : `${R.playoffTeams} teams; first round best of ${r1Best}.`}</div>}
  </div>;
}
