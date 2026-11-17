// Keyboard-first navigation: arrows move a spatial selection across [data-nav] elements, Enter activates.
// The mouse and keyboard share one selection: hovering a control selects it.

export function scopeRoot(): HTMLElement | null {
  const scopes = Array.from(document.querySelectorAll<HTMLElement>('[data-scope]'));
  return scopes.length ? scopes[scopes.length - 1] : document.querySelector<HTMLElement>('.stage');
}

function candidates(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-nav]')).filter(el => {
    if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

export function focusFirst() {
  const root = scopeRoot(); if (!root) return;
  const auto = root.querySelector<HTMLElement>('[data-autofocus]');
  const el = auto ?? candidates(root)[0];
  el?.focus({ preventScroll: false });
}

export function moveSelection(dir: 'up' | 'down' | 'left' | 'right') {
  const root = scopeRoot(); if (!root) return;
  const els = candidates(root);
  if (!els.length) return;
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || !els.includes(cur)) { focusFirst(); return; }
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best: HTMLElement | null = null, bestScore = Infinity;
  for (const el of els) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2, by = b.top + b.height / 2;
    let primary: number, ortho: number;
    if (dir === 'down') { primary = b.top - (a.bottom - 4); ortho = Math.max(0, Math.max(b.left - a.right, a.left - b.right)); if (by <= ay + 2) continue; }
    else if (dir === 'up') { primary = (a.top + 4) - b.bottom; ortho = Math.max(0, Math.max(b.left - a.right, a.left - b.right)); if (by >= ay - 2) continue; }
    else if (dir === 'right') { primary = b.left - (a.right - 4); ortho = Math.max(0, Math.max(b.top - a.bottom, a.top - b.bottom)); if (bx <= ax + 2) continue; }
    else { primary = (a.left + 4) - b.right; ortho = Math.max(0, Math.max(b.top - a.bottom, a.top - b.bottom)); if (bx >= ax - 2) continue; }
    const centreOff = dir === 'up' || dir === 'down' ? Math.abs(bx - ax) : Math.abs(by - ay);
    const score = Math.max(0, primary) + ortho * 3 + centreOff * 0.15;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) { best.focus({ preventScroll: true }); best.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
}

export function isTyping() {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/** Hover selects: unify mouse and keyboard focus. */
export function installHoverFocus() {
  document.addEventListener('mouseover', e => {
    if (isTyping()) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-nav]');
    if (el && document.activeElement !== el && !(el as HTMLButtonElement).disabled) el.focus({ preventScroll: true });
  });
}
