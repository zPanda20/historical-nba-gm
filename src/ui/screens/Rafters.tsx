import { useStore, setUI } from '../store';
import { seasonLabel } from '../util';

// Real championships before the save starts (titles only). Everything after October 1976 is earned in this save.
const PRE: Record<string, { y: number; label: string; where?: string }[]> = {
  BOS: [1957, 1959, 1960, 1961, 1962, 1963, 1964, 1965, 1966, 1968, 1969, 1974, 1976].map(y => ({ y, label: 'World Champions' })),
  LAL: [...[1949, 1950, 1952, 1953, 1954].map(y => ({ y, label: 'World Champions', where: 'Minneapolis' })), { y: 1972, label: 'World Champions' }],
  PHI: [{ y: 1955, label: 'World Champions', where: 'Syracuse Nationals' }, { y: 1967, label: 'World Champions' }],
  GSW: [{ y: 1947, label: 'World Champions', where: 'Philadelphia' }, { y: 1956, label: 'World Champions', where: 'Philadelphia' }, { y: 1975, label: 'World Champions' }],
  NYK: [{ y: 1970, label: 'World Champions' }, { y: 1973, label: 'World Champions' }],
  MIL: [{ y: 1971, label: 'World Champions' }],
  ATL: [{ y: 1958, label: 'World Champions', where: 'St. Louis' }],
  KCK: [{ y: 1951, label: 'World Champions', where: 'Rochester Royals' }],
  NYN: [{ y: 1974, label: 'ABA Champions' }, { y: 1976, label: 'ABA Champions' }],
  IND: [{ y: 1970, label: 'ABA Champions' }, { y: 1972, label: 'ABA Champions' }, { y: 1973, label: 'ABA Champions' }],
};

export function Rafters() {
  const { world: w } = useStore();
  const t = w!.teams[w!.meta.userTeam];
  const pre = PRE[t.id] ?? [];
  const mine = t.history.filter(h => h.result === 'Champion').map(h => ({ y: h.season + 1, label: 'World Champions' }));
  const finals = t.history.filter(h => h.result === 'Finals');
  const awards = Object.values(w!.players).flatMap(p => (p.awards ?? []).filter(a => a.award === 'MVP' && (p.stats ?? []).some(s => s.season === a.season && s.team === t.id && !s.playoffs)).map(a => ({ y: a.season + 1, name: p.name })));
  const S = w!.season;
  return <div class="rafters" data-scope onClick={(e: any) => { if (e.target.classList.contains('rafters')) setUI({ rafters: false }); }}>
    <div class="rafters-beams" />
    <div class="rafters-lights" />
    <div class="rafters-h">The rafters · {t.city} {t.name}</div>
    <div class="banners">
      {pre.map(b => <div class="banner pre"><div class="bn-y">{b.y}</div><div class="bn-l">{b.label}</div>{b.where && <div class="bn-w">{b.where}</div>}</div>)}
      {mine.map(b => <div class="banner won"><div class="bn-y">{b.y}</div><div class="bn-l">{b.label}</div><div class="bn-w">Won in this save</div></div>)}
      {finals.map(h => <div class="banner pennant"><div class="bn-y">{h.season + 1}</div><div class="bn-l">Conference Champions</div></div>)}
      {awards.map(a => <div class="banner mvp"><div class="bn-y">{a.y}</div><div class="bn-l">MVP</div><div class="bn-w">{a.name}</div></div>)}
      {!mine.length && <div class="banner ghost"><div class="bn-y">?</div><div class="bn-l">Your banner</div><div class="bn-w">Space reserved</div></div>}
    </div>
    <div class="rafters-history">
      <div class="rh-h">Seasons on your watch</div>
      <div class="rh-row">
        {t.history.map(h => <div class="rh-s"><b>{seasonLabel(h.season)}</b><span>{h.w}–{h.l}</span><small>{h.result}</small></div>)}
        <div class="rh-s now"><b>{seasonLabel(S.year)}</b><span>{t.w}–{t.l}</span><small>In progress</small></div>
      </div>
    </div>
    <div class="rafters-foot">Before 1976: the franchise's real championships · After: only what you win in this save</div>
    <button data-nav data-autofocus class="btn ghost rafters-back" onClick={() => setUI({ rafters: false })}>Back to the floor</button>
  </div>;
}
