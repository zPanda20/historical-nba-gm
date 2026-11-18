import { useEffect, useMemo, useState } from 'preact/hooks';
import { setUI, toast } from './store';
import { listSaves, loadSave, deleteSave, importSaveFile, SaveSummary, lastSaveId } from './saves';
import { loadData, startNewGame, enterLoaded } from './actions';
import { Logo, Headshot, seasonLabel, PHASE_LABEL } from './util';
import { createWorld } from '../sim/world';
import { playerValue } from '../sim/coach';
import { fmt$, payroll } from '../sim/gm';
import { teamTheme } from './theme';
import type { World } from '../sim/types';

export function Title() {
  const [saves, setSaves] = useState<SaveSummary[] | null>(null);
  const [showLoad, setShowLoad] = useState(false);
  useEffect(() => { listSaves().then(setSaves).catch(() => setSaves([])); }, []);
  const last = saves?.find(s => s.id === lastSaveId()) ?? saves?.[0];
  const load = async (id: string) => {
    setUI({ busy: 'Loading save' });
    try { await loadData(); enterLoaded(await loadSave(id)); } catch (e: any) { toast(`Could not load: ${e.message}`); }
    setUI({ busy: null });
  };
  const onImport = async (e: any) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { await loadData(); enterLoaded(await importSaveFile(f)); toast('Save imported.'); } catch (err: any) { toast(err.message); }
  };
  return <div class="title-scr">
    <div class="title-lights" />
    <div class="title-center">
      <div class="title-pre">A front-office life · 1976 – 2040</div>
      <h1 class="title-h">Historical<br />NBA GM</h1>
      <div class="title-stripe" />
      <div class="title-ver">Alpha 0.5 · 1976 to 2040</div>
      <div class="title-menu">
        {last && <button data-nav data-autofocus class="tm-i" onClick={() => load(last.id)}>
          <span>Continue</span><small>{last.title} · {seasonLabel(last.season)} {PHASE_LABEL[last.phase]} · {last.record}</small></button>}
        <button data-nav data-autofocus={last ? undefined : ''} class="tm-i" onClick={() => setUI({ mode: 'newgame' })}><span>New game</span><small>Take over a franchise in October 1976</small></button>
        {!!saves?.length && <button data-nav class="tm-i" onClick={() => setShowLoad(!showLoad)}><span>Load game</span><small>{saves.length} save{saves.length > 1 ? 's' : ''} on this browser</small></button>}
        <label data-nav tabIndex={0} class="tm-i" onKeyDown={(e: any) => { if (e.key === 'Enter') e.currentTarget.querySelector('input')?.click(); }}>
          <span>Import save file</span><small>A .hnba file exported from Settings</small>
          <input type="file" accept=".gz,.json,.hnba" style={{ display: 'none' }} onChange={onImport} />
        </label>
      </div>
      {showLoad && saves && <div class="load-list" data-scope>
        {saves.map(s => <div class="load-row">
          <button data-nav class="load-i" onClick={() => load(s.id)}>
            <Logo t={s.team} size={34} /><div><b>{s.title}</b><small>{seasonLabel(s.season)} · {PHASE_LABEL[s.phase]} · {s.day} · {s.record} · {s.mode}</small></div></button>
          <button data-nav class="btn ghost sm" onClick={async () => { if (confirm(`Delete "${s.title}"?`)) { await deleteSave(s.id); setSaves(await listSaves()); } }}>Delete</button>
        </div>)}
        <button data-nav class="btn ghost" onClick={() => setShowLoad(false)}>Close</button>
      </div>}
    </div>
    <div class="title-foot">Unofficial, non-commercial fan prototype. Real league, team and player names, logos and photos belong to their owners. Results are simulated — history is a starting point, not a script.</div>
  </div>;
}

const ABA = [
  { id: 'KEN', name: 'Kentucky Colonels' }, { id: 'STL', name: 'Spirits of St. Louis' }, { id: 'VIR', name: 'Virginia Squires' }, { id: 'PIT', name: 'Pittsburgh Condors' },
];
const DIVS: [string, string][] = [['East', 'Atlantic'], ['East', 'Central'], ['West', 'Midwest'], ['West', 'Pacific']];

export function NewGame() {
  const [data, setData] = useState<any>(null);
  const [team, setTeam] = useState<string | null>(null);
  const [mode, setMode] = useState<'career' | 'sandbox'>('career');
  const [gm, setGm] = useState('');
  const [seed] = useState(() => `NBA-${Date.now().toString(36)}`);
  useEffect(() => { loadData().then(setData).catch(e => toast(`Could not load data: ${e.message}`)); }, []);
  const preview: World | null = useMemo(() => data && team ? createWorld(data, { userTeam: team, mode, gmName: gm || 'GM', seed }) : null, [data, team]);
  if (!data) return <div class="title-scr"><div class="title-center"><div class="title-ver">Loading the 1976 league files…</div></div></div>;

  if (!team || !preview) return <div class="ng-scr">
    <div class="ng-head"><h2>Choose your franchise</h2><p>October 1976. The ABA–NBA merger is done and 22 teams open the season. Pick the job you want.</p></div>
    <div class="ng-grid">
      {DIVS.map(([conf, div]) => <div class="ng-div">
        <div class="ng-div-h">{conf} · {div}</div>
        {data.teams.filter((t: any) => t.div === div).map((t: any) => <button data-nav class="ng-team" style={teamTheme(t).vars as any} onClick={() => setTeam(t.id)}>
          <Logo t={t} size={52} /><div><div class="ng-city">{t.city}</div><div class="ng-name">{t.name}</div></div>
        </button>)}
      </div>)}
      <div class="ng-div aba">
        <div class="ng-div-h">ABA survivors · coming later</div>
        {ABA.map(a => <button data-nav class="ng-team disabled" aria-disabled="true" onClick={() => toast('ABA survivor clubs arrive in a later alpha.')}>
          <Logo t={a.id} size={52} /><div><div class="ng-name">{a.name}</div><div class="ng-city">Alternate history · not in this alpha</div></div>
        </button>)}
      </div>
    </div>
    <div class="ng-foot"><button data-nav class="btn ghost" onClick={() => setUI({ mode: 'title' })}>Back</button></div>
  </div>;

  const w = preview;
  const t = w.teams[team];
  const coach = w.coaches[t.coach];
  const best = t.roster.map(id => w.players[id]).sort((a, b) => playerValue(b) - playerValue(a)).slice(0, 4);
  const th = teamTheme(t);
  return <div class="ng-scr setup" style={th.vars as any}>
    <div class="setup-l">
      <Logo t={t} size={150} class="setup-logo" />
      <div class="setup-city">{t.city}</div>
      <div class="setup-name">{t.name}</div>
      <div class="setup-form">
        <label class="fld"><span>Your name</span><input data-nav value={gm} placeholder="General Manager" maxLength={28} onInput={(e: any) => setGm(e.target.value)} /></label>
        <div class="fld"><span>Mode</span>
          <div class="seg">
            <button data-nav class={mode === 'career' ? 'on' : ''} onClick={() => setMode('career')}>Career<small>The owner can fire you</small></button>
            <button data-nav class={mode === 'sandbox' ? 'on' : ''} onClick={() => setMode('sandbox')}>Sandbox<small>No firing</small></button>
          </div></div>
        <div class="fld"><span>World</span>
          <div class="seg">
            <button data-nav class="on">Historical start<small>Real 1976 rosters; simulated from there</small></button>
            <button data-nav class="disabled" aria-disabled="true" onClick={() => toast('Living NBA World arrives in a later alpha.')}>Living NBA World<small>Coming later</small></button>
          </div></div>
      </div>
      <div class="setup-btns">
        <button data-nav class="btn ghost" onClick={() => setTeam(null)}>Back</button>
        <button data-nav data-autofocus class="btn big" onClick={() => startNewGame(data, { userTeam: team, mode, gmName: gm.trim() || 'General Manager', seed })}>Take the job</button>
      </div>
    </div>
    <div class="setup-r">
      <div class="report">
        <div class="report-h">Front office briefing · October 1976</div>
        <div class="report-grid">
          <div><label>Owner</label><b>{t.owner}</b></div>
          <div><label>Owner expects</label><b>About {w.owner.expectedWins} wins</b></div>
          <div class="wide"><label>Objective</label><b>{w.owner.objective}</b></div>
          <div><label>Head coach</label><b>{coach.name}</b></div>
          <div><label>Franchise clock</label><b>{t.clock}</b></div>
          <div><label>Payroll (reconstructed)</label><b>{fmt$(payroll(w, team))}</b></div>
          <div><label>Owner budget</label><b>{fmt$(w.owner.budget)}</b></div>
          <div class="wide"><label>Coach's style</label><b class="small">{coach.note || 'A steady hand.'}</b></div>
        </div>
        <div class="report-h sm">Your best players</div>
        <div class="report-players">{best.map(p => <div class="rp"><Headshot p={p} size={78} /><b>{p.name}</b><small>{p.pos} · {p.age} · {p.ovr} OVR</small></div>)}</div>
        <p class="report-note">Salaries before your arrival are reconstructed estimates for simulation. Personalities are "in this universe" — simulated, not claims about real people. History stops at the opening tip.</p>
      </div>
    </div>
  </div>;
}
