// Save system: IndexedDB (gzip when the browser supports CompressionStream) + file export/import.
import { buildChronicle } from '../sim/export';
import type { World } from '../sim/types';

const DB = 'historical-nba-gm', STORE = 'saves';
export interface SaveSummary { id: string; title: string; savedAt: string; season: number; day: string; phase: string; team: string; record: string; mode: string; }

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function gzip(s: string): Promise<Blob> {
  if (typeof CompressionStream === 'undefined') return new Blob([s], { type: 'application/json' });
  const cs = new Blob([s]).stream().pipeThrough(new CompressionStream('gzip'));
  return await new Response(cs).blob();
}
async function gunzip(b: Blob): Promise<string> {
  const head = new Uint8Array(await b.slice(0, 2).arrayBuffer());
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const ds = b.stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(ds).text();
  }
  return await b.text();
}
export function summarize(w: World): SaveSummary {
  const t = w.teams[w.meta.userTeam];
  return { id: w.meta.saveId, title: w.meta.title, savedAt: new Date().toISOString(), season: w.season.year, day: w.season.day, phase: w.season.phase,
    team: t.abbr, record: `${t.w}-${t.l}`, mode: w.meta.mode };
}
export async function saveWorld(w: World) {
  const blob = await gzip(JSON.stringify(w));
  const db = await open();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ id: w.meta.saveId, summary: summarize(w), blob });
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
  try { localStorage.setItem('hnba-last', w.meta.saveId); } catch { /* storage may be unavailable */ }
}
export async function listSaves(): Promise<SaveSummary[]> {
  const db = await open();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE).objectStore(STORE).getAll();
    r.onsuccess = () => res((r.result as any[]).map(x => x.summary).sort((a, b) => b.savedAt.localeCompare(a.savedAt)));
    r.onerror = () => rej(r.error);
  });
}
export async function loadSave(id: string): Promise<World> {
  const db = await open();
  const rec: any = await new Promise((res, rej) => { const r = db.transaction(STORE).objectStore(STORE).get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  if (!rec) throw new Error('Save not found');
  return JSON.parse(await gunzip(rec.blob));
}
export async function deleteSave(id: string) {
  const db = await open();
  await new Promise<void>((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
export async function exportSave(w: World) {
  const blob = await gzip(JSON.stringify(w));
  const a = document.createElement('a');
  const t = w.teams[w.meta.userTeam];
  a.href = URL.createObjectURL(blob);
  a.download = `hnba-${t.abbr}-${w.season.year}-${w.season.day}.hnba${typeof CompressionStream === 'undefined' ? '.json' : '.gz'}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
export async function importSaveFile(f: File): Promise<World> {
  const w = JSON.parse(await gunzip(f)) as World;
  if (!w?.meta?.saveId || !w.teams) throw new Error('Not a Historical NBA GM save file');
  return w;
}
export function lastSaveId(): string | null { try { return localStorage.getItem('hnba-last'); } catch { return null; } }

/** League chronicle for an AI writer: one Markdown file of causes and results (see sim/export.ts). */
export function exportChronicle(w: World) {
  const text = buildChronicle(w);
  const a = document.createElement('a');
  const t = w.teams[w.meta.userTeam];
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  a.download = `league-chronicle-${t.abbr}-${w.season.year}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
