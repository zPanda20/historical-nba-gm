// Tiny global store: the World (save state) + UI state, with pub/sub and debounced autosave.
import { useEffect, useState } from 'preact/hooks';
import type { World } from '../sim/types';
import { saveWorld } from './saves';

export type Screen = 'home' | 'roster' | 'staff' | 'office' | 'draft' | 'league' | 'games' | 'people' | 'finances';
export const SECTIONS: { id: Screen; label: string; key: string }[] = [
  { id: 'home', label: 'Home', key: '1' },
  { id: 'roster', label: 'Roster & Dev', key: '2' },
  { id: 'staff', label: 'Staff', key: '3' },
  { id: 'office', label: 'Front Office', key: '4' },
  { id: 'draft', label: 'Draft & Scouting', key: '5' },
  { id: 'league', label: 'League', key: '6' },
  { id: 'games', label: 'Games', key: '7' },
  { id: 'people', label: 'People', key: '8' },
  { id: 'finances', label: 'Finances', key: '9' },
];

export interface Modal { kind: string; arg?: any }
export interface UIState {
  mode: 'title' | 'newgame' | 'game';
  screen: Screen;
  tab: Record<string, string>;
  modal: Modal | null;
  rafters: boolean;
  settings: boolean;
  busy: string | null;
  toast: { text: string; id: number } | null;
  gamecast: string | null; // game id being watched
  castSpeed: number;
  tradeDraft: { other: string; give: string[]; get: string[]; givePicks: any[]; getPicks: any[]; sat?: any } | null;
  stopRequested?: boolean;
  busyPace?: number;   // ms between steps (0 = as fast as possible)
  busyThin?: boolean;  // slim, see-through busy bar (the screen behind stays visible)
  peopleEra?: string;
}

let world: World | null = null;
let version = 0;
export const ui: UIState = {
  mode: 'title', screen: 'home', tab: {}, modal: null, rafters: false, settings: false, busy: null, toast: null, gamecast: null, castSpeed: 24, tradeDraft: null,
};
const subs = new Set<() => void>();
const notify = () => { version++; subs.forEach(f => f()); };

export function getWorld(): World { return world!; }
export function hasWorld() { return !!world; }
export function setWorld(w: World | null) { world = w; notify(); }

let saveTimer: any = null;
/** Call after mutating the world. Re-renders and schedules an autosave. */
export function commit(save = true) {
  hooks.afterStep?.(world);
  notify();
  if (save && world) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (world) saveWorld(world).catch(e => console.error('autosave failed', e)); }, 1200);
  }
}
export function setUI(patch: Partial<UIState>) { Object.assign(ui, patch); notify(); }
export function toast(text: string) { ui.toast = { text, id: Date.now() }; notify(); setTimeout(() => { if (ui.toast && Date.now() - ui.toast.id > 3900) { ui.toast = null; notify(); } }, 4000); }
export function go(screen: Screen, tab?: string) {
  ui.screen = screen; ui.rafters = false; ui.modal = null; ui.settings = false;
  if (tab) ui.tab[screen] = tab;
  notify();
}
export function openModal(kind: string, arg?: any) { ui.modal = { kind, arg }; notify(); }
export function closeModal() { ui.modal = null; notify(); }

export function useStore() {
  const [, setV] = useState(0);
  useEffect(() => { const f = () => setV(version); subs.add(f); return () => { subs.delete(f); }; }, []);
  return { world, ui, version };
}

/** Run a long simulation step without freezing the page: calls `step` repeatedly in slices until it returns false. */
export function runBusy(label: string, step: () => boolean, done?: () => void) {
  setUI({ busy: label });
  const slice = () => {
    // a showcase on screen holds the clock until it is dismissed (or times out in autopilot)
    if (((ui as any).shows ?? []).length && !ui.stopRequested) { setTimeout(slice, 150); return; }
    const t0 = performance.now();
    let more = true;
    const pace = ui.busyPace ?? 0;
    if (pace > 0) more = step();
    else while (more && performance.now() - t0 < 30) { more = step(); if (((ui as any).shows ?? []).length || (ui.busyPace ?? 0) > 0) break; }
    hooks.afterStep?.(world);
    notify();
    if (more) setTimeout(slice, (ui.busyPace ?? 0) > 0 ? ui.busyPace : 0);
    else { ui.busy = null; ui.busyPace = 0; ui.busyThin = false; commit(); done?.(); }
  };
  setTimeout(slice, 30);
}
/** Late-bound hooks (keeps the store free of UI imports). */
export const hooks: { afterStep?: (w: World | null) => void } = {};
