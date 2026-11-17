// 1976–77 playoff bracket: East on the left, West on the right, the Finals in the middle.
import type { Series, World } from '../sim/types';
import { standings } from '../sim/league';
import { Logo, place, seasonLabel } from './util';
import { openModal, setUI } from './store';

function seedsOf(w: World, conf: string): string[] {
  const s = (w.season as any)[`seeds${conf}`] as string[] | undefined;
  if (s) return s;
  const all = standings(w, conf);
  const divs = [...new Set(all.map(t => t.div))];
  const winners = divs.map(d => all.find(t => t.div === d)!).sort((a, b) => (b.w - b.l) - (a.w - a.l));
  return [...winners, ...all.filter(t => !winners.includes(t)).slice(0, 4)].map(t => t.id);
}

function Slot({ w, tid, seed, wins, won, lost, live }: { w: World; tid?: string; seed?: number; wins?: number; won?: boolean; lost?: boolean; live?: boolean }) {
  if (!tid) return <div class="bk-slot tbd"><span class="bk-seed" /><span class="bk-n">To be decided</span></div>;
  const t = w.teams[tid];
  return <div class={`bk-slot ${won ? 'won' : ''} ${lost ? 'lost' : ''} ${tid === w.meta.userTeam ? 'me' : ''}`}>
    <span class="bk-seed">{seed}</span><Logo t={t} size={24} /><span class="bk-n">{place(t)}</span>{wins !== undefined && <b class={live ? 'live' : ''}>{wins}</b>}
  </div>;
}

function Box({ w, s, seeds, label, proj }: { w: World; s?: Series; seeds: Record<string, number>; label?: string; proj?: [string, string] }) {
  if (!s) return <div class="bk-box">{label && <div class="bk-lab">{label}</div>}<Slot w={w} tid={proj?.[0]} seed={proj ? seeds[proj[0]] : undefined} /><Slot w={w} tid={proj?.[1]} seed={proj ? seeds[proj[1]] : undefined} /></div>;
  const live = !s.winner;
  const last = s.games.length ? s.games[s.games.length - 1] : null;
  const lg = last ? w.season.games.find(g => g.id === last) : null;
  return <button data-nav class={`bk-box ${live ? 'live' : ''}`} title={lg?.log ? 'Replay the last game' : 'Box score'} onClick={() => lg && (lg.log ? setUI({ gamecast: lg.id }) : openModal('box', { id: lg.id }))}>
    <div class="bk-lab">{label ?? ''}{label ? ' · ' : ''}best of {s.bestOf}</div>
    <Slot w={w} tid={s.hi} seed={seeds[s.hi]} wins={s.wHi} won={s.winner === s.hi} lost={!!s.winner && s.winner !== s.hi} live={live} />
    <Slot w={w} tid={s.lo} seed={seeds[s.lo]} wins={s.wLo} won={s.winner === s.lo} lost={!!s.winner && s.winner !== s.lo} live={live} />
  </button>;
}

function Bye({ w, tid, seed }: { w: World; tid: string; seed: number }) {
  return <div class="bk-box bye"><div class="bk-lab">First-round bye</div><Slot w={w} tid={tid} seed={seed} /></div>;
}

export function Bracket({ w, compact }: { w: World; compact?: boolean }) {
  const P = w.season.playoffs;
  const find = (id: string) => P?.series.find(s => s.id === id);
  const conf = (c: 'East' | 'West') => {
    const sd = seedsOf(w, c);
    const seeds: Record<string, number> = {}; sd.forEach((id, i) => (seeds[id] = i + 1));
    return { sd, seeds, r1: [find(`${c}-R1-a`), find(`${c}-R1-b`)], sf: [find(`${c}-SF-a`), find(`${c}-SF-b`)], f: find(`${c}-F`) };
  };
  const E = conf('East'), Wc = conf('West');
  const allSeeds = { ...E.seeds, ...Wc.seeds };
  const fin = find('Finals');
  const champ = w.season.champion;
  const col = (c: typeof E, side: 'l' | 'r') => [
    <div class={`bk-col r1 ${side}`}><Bye w={w} tid={c.sd[0]} seed={1} /><Box w={w} s={c.r1[1]} seeds={c.seeds} label={P ? undefined : 'Best of 3'} proj={[c.sd[3], c.sd[4]]} /><Bye w={w} tid={c.sd[1]} seed={2} /><Box w={w} s={c.r1[0]} seeds={c.seeds} label={P ? undefined : 'Best of 3'} proj={[c.sd[2], c.sd[5]]} /></div>,
    <div class={`bk-col sf ${side}`}><Box w={w} s={c.sf[0]} seeds={c.seeds} /><Box w={w} s={c.sf[1]} seeds={c.seeds} /></div>,
    <div class={`bk-col cf ${side}`}><Box w={w} s={c.f} seeds={c.seeds} /></div>,
  ];
  const [e1, e2, e3] = col(E, 'l'), [w1, w2, w3] = col(Wc, 'r');
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
    {!P && <div class="bk-note">If the season ended today. Division winners take seeds 1–2 and skip the best-of-three first round.</div>}
  </div>;
}
