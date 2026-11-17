import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { useStore, setUI, go, closeModal, SECTIONS, ui, getWorld, Screen } from './store';
import { installHoverFocus, isTyping, moveSelection, focusFirst } from './nav';
import { teamTheme } from './theme';
import { openMostUrgent } from './actions';
import { Title, NewGame } from './Title';
import { TopBar, NavRail, UrgentSlot, toggleFullscreen } from './Chrome';
import { Home, CourtsideBg } from './screens/Home';
import { Rafters, RaftersBg } from './screens/Rafters';
import { Roster } from './screens/Roster';
import { Staff } from './screens/Staff';
import { Office } from './screens/Office';
import { Draft } from './screens/Draft';
import { League } from './screens/League';
import { Games, Gamecast } from './screens/Games';
import { People } from './screens/People';
import { Modals } from './Modals';
import { Settings } from './Settings';

const W = 1600, H = 900;

function useScale() {
  const [s, setS] = useState(1);
  useLayoutEffect(() => {
    const f = () => setS(Math.min(window.innerWidth / W, window.innerHeight / H));
    f(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f);
  }, []);
  return s;
}

function onKey(e: KeyboardEvent) {
  const typing = isTyping();
  if (e.key === 'Escape') {
    e.preventDefault();
    if (typing) { (document.activeElement as HTMLElement).blur(); return; }
    if (ui.modal) { closeModal(); return; }
    if (ui.gamecast) { setUI({ gamecast: null }); return; }
    if (ui.rafters) { setUI({ rafters: false }); return; }
    if (ui.mode === 'game') setUI({ settings: !ui.settings });
    else if (ui.mode === 'newgame') setUI({ mode: 'title' });
    return;
  }
  if (typing) return;
  if (ui.busy) { e.preventDefault(); return; }
  const dirs: Record<string, 'up' | 'down' | 'left' | 'right'> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  if (dirs[e.key]) { e.preventDefault(); moveSelection(dirs[e.key]); return; }
  if (e.key === 'Enter') {
    const el = document.activeElement as HTMLElement | null;
    if (el && el.hasAttribute('data-nav') && el.tagName !== 'BUTTON') { e.preventDefault(); el.click(); }
    else if (!el || el === document.body) { e.preventDefault(); focusFirst(); }
    return;
  }
  if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); toggleFullscreen(); return; }
  if (ui.mode !== 'game') return;
  if (e.key === 'Tab') { e.preventDefault(); if (!ui.gamecast) openMostUrgent(); return; }
  if (e.key === ' ') {
    e.preventDefault();
    if (ui.modal || ui.settings || ui.gamecast) return;
    setUI({ rafters: !ui.rafters });
    return;
  }
  if (/^[1-8]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (ui.modal || ui.gamecast) return;
    e.preventDefault();
    go(SECTIONS[+e.key - 1].id as Screen);
  }
}

export function App() {
  const { world, ui: u } = useStore();
  const scale = useScale();
  useEffect(() => {
    installHoverFocus();
    document.addEventListener('fullscreenchange', () => setUI({}));
    window.addEventListener('keydown', onKey);
    const stopSpace = (e: KeyboardEvent) => { if (e.key === ' ' && !isTyping()) e.preventDefault(); };
    window.addEventListener('keyup', stopSpace);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', stopSpace); };
  }, []);
  // keep a selection alive after every screen change
  useEffect(() => {
    const t = setTimeout(() => {
      const a = document.activeElement as HTMLElement | null;
      const scopes = document.querySelectorAll('[data-scope]');
      const scope = scopes.length ? scopes[scopes.length - 1] : document.querySelector('.stage');
      if (!a || a === document.body || (scope && !scope.contains(a))) focusFirst();
    }, 40);
    return () => clearTimeout(t);
  }, [u.mode, u.screen, u.modal, u.rafters, u.settings, u.gamecast, u.tab[u.screen]]);

  const team = world && u.mode === 'game' ? world.teams[world.meta.userTeam] : null;
  const th = teamTheme(team);
  const style: any = { width: W, height: H, transform: `scale(${scale})`, ...th.vars };

  return <div class="viewport">
    <div class="stage" style={style}>
      {u.mode === 'title' && <Title />}
      {u.mode === 'newgame' && <NewGame />}
      {u.mode === 'game' && world && <>
        {u.rafters ? <RaftersBg /> : u.screen === 'home' && !world.meta.fired ? <CourtsideBg w={world} /> : <div class="bg" />}
        <TopBar />
        <NavRail />
        <UrgentSlot />
        <main class={`main ${u.rafters ? 'scr-rafters' : `scr-${u.screen}`}`}>
          {u.rafters ? <Rafters /> : <>
            {u.screen === 'home' && <Home />}
            {u.screen === 'roster' && <Roster />}
            {u.screen === 'staff' && <Staff />}
            {u.screen === 'office' && <Office />}
            {u.screen === 'draft' && <Draft />}
            {u.screen === 'league' && <League />}
            {u.screen === 'games' && <Games />}
            {u.screen === 'people' && <People />}
          </>}
        </main>
        {u.gamecast && <Gamecast id={u.gamecast} />}
        {u.settings && <Settings />}
        {u.modal && <Modals />}
      </>}
      {u.busy && <div class="busy" data-scope><div class="busy-card"><div class="bulbs-sm">● ● ●</div><div class="busy-t">{u.busy}…</div>{world && <div class="busy-d">{world.season.day}</div>}</div></div>}
      {u.toast && <div class="toast" key={u.toast.id}>{u.toast.text}</div>}
    </div>
  </div>;
}
export { getWorld };
// console access for testing and tinkering
(window as any).hnba = { getWorld, commit: () => setUI({}) };
