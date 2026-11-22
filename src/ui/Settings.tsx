import { useStore, setUI, setWorld, toast, ui } from './store';
import { Btn } from './util';
import { saveWorld, exportSave, exportChronicle } from './saves';
import { MODEL_VERSION } from '../sim/rng';

export function Settings() {
  const { world: w } = useStore();
  return <div class="modal-bg" data-scope>
    <div class="modal settings">
      <div class="modal-h"><h3>Paused</h3></div>
      <div class="modal-b">
        <div class="set-btns">
          <Btn kind="big" auto onClick={() => setUI({ settings: false })}>Resume</Btn>
          <Btn onClick={async () => { await saveWorld(w!); toast('Saved.'); }}>Save now</Btn>
          <Btn onClick={() => exportSave(w!)}>Export save file</Btn>
          <Btn onClick={() => { exportChronicle(w!); toast('League chronicle exported. Upload it to Claude and ask for the story of your league.'); }}>Export league chronicle</Btn>
          <Btn kind="ghost" onClick={async () => { await saveWorld(w!); setWorld(null); setUI({ mode: 'title', settings: false, screen: 'home' }); }}>Save & quit to title</Btn>
        </div>
        <div class="set-row"><span>People page look</span><div class="seg sm">{[['auto', 'By era'], ['70s', '1970s'], ['90s', '1990s'], ['00s', '2000s'], ['20s', '2020s']].map(([k, l]) => <button data-nav class={(ui.peopleEra ?? 'auto') === k ? 'on' : ''} onClick={() => setUI({ peopleEra: k })}>{l}</button>)}</div><small>Preview how the desk changes over the decades.</small></div>
        <div class="set-info">
          <h4>Controls</h4>
          <p>Arrow keys move the selection, Enter chooses. Number keys 1–8 jump between sections. Tab opens the most urgent call on your desk. Space looks up to the rafters and back. Esc closes things and opens this menu. F toggles full screen.</p>
          <h4>About this alpha</h4>
          <p>Alpha 0.5 runs from 1976–77 to 2040: the real league calendar (moves, new names and logos, expansion, realignment, lockouts), era playoff and lottery formats, and real draft classes through 2026. Results come from a possession-by-possession simulation tuned to each era's league numbers; nothing is scripted. The game autosaves in this browser — export a save file to keep a backup.</p>
          <p class="muted small">Save: {w!.meta.title} · seed {w!.meta.seed} · model {MODEL_VERSION} · data {w!.meta.dataVersion}</p>
        </div>
      </div>
    </div>
  </div>;
}
