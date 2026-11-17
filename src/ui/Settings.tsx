import { useStore, setUI, setWorld, toast } from './store';
import { Btn } from './util';
import { saveWorld, exportSave } from './saves';
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
          <Btn kind="ghost" onClick={async () => { await saveWorld(w!); setWorld(null); setUI({ mode: 'title', settings: false, screen: 'home' }); }}>Save & quit to title</Btn>
        </div>
        <div class="set-info">
          <h4>Controls</h4>
          <p>Arrow keys move the selection, Enter chooses. Number keys 1–8 jump between sections. Tab opens the most urgent call on your desk. Space looks up to the rafters and back. Esc closes things and opens this menu.</p>
          <h4>About this alpha</h4>
          <p>Alpha 0.1 covers the 1976–77 season, the playoffs, the 1977 draft and free agency into 1977–78. Results come from a possession-by-possession simulation tuned to 1976–77 league numbers; nothing is scripted. The game autosaves in this browser — export a save file to keep a backup.</p>
          <p class="muted small">Save: {w!.meta.title} · seed {w!.meta.seed} · model {MODEL_VERSION} · data {w!.meta.dataVersion}</p>
        </div>
      </div>
    </div>
  </div>;
}
