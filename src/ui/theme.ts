// Team identity as a full theme on top of the era skin (1976–77 broadcast/arena look).
import type { Team } from '../sim/types';

const hex = (h: string) => { const s = h.replace('#', ''); const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (c: number[]) => '#' + c.map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
const lum = (h: string) => { const [r, g, b] = hex(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const sat = (h: string) => { const c = hex(h); const mx = Math.max(...c), mn = Math.min(...c); return mx === 0 ? 0 : (mx - mn) / mx; };
export const mix = (a: string, b: string, t: number) => { const A = hex(a), B = hex(b); return toHex(A.map((v, i) => v + (B[i] - v) * t)); };
export const rgba = (h: string, a: number) => { const [r, g, b] = hex(h); return `rgba(${r},${g},${b},${a})`; };

export interface TeamTheme { primary: string; accent: string; third: string; light: string; onAccent: string; vars: Record<string, string> }

export function teamTheme(t: Team | null): TeamTheme {
  const cols = (t?.colors?.length ? t.colors : ['#5d2f8e', '#f2b632', '#e07b2a']).filter(Boolean);
  const isNeutral = (c: string) => lum(c) > 0.82 || lum(c) < 0.02 || sat(c) < 0.12;
  const colored = cols.filter(c => !isNeutral(c));
  let primary = colored[0] ?? cols[0];
  // accent: the brightest saturated team colour different from primary; fallback era gold
  let accent = colored.slice(1).sort((a, b) => lum(b) - lum(a))[0] ?? '#f2b632';
  if (lum(primary) > lum(accent) && lum(primary) > 0.25 && colored.length > 1) [primary, accent] = [accent, primary];
  if (lum(accent) < 0.12) accent = mix(accent, '#ffffff', 0.45);
  const third = colored.find(c => c !== primary && c !== accent) ?? mix(primary, accent, 0.5);
  const light = cols.find(c => lum(c) > 0.82) ?? '#f6ecd4';
  const onAccent = lum(accent) > 0.35 ? '#1d120b' : '#fff8ea';
  const deep = mix(primary, '#0d0806', 0.72);
  const vars: Record<string, string> = {
    '--tp': primary, '--ta': accent, '--t3': third, '--tl': light, '--on-ta': onAccent,
    '--tp-deep': deep, '--tp-glow': rgba(primary, 0.55), '--ta-glow': rgba(accent, 0.55), '--ta-soft': rgba(accent, 0.16),
    '--tp-soft': rgba(primary, 0.35), '--tp-text': lum(primary) < 0.06 ? mix(primary, '#ffffff', 0.55) : mix(primary, '#ffffff', 0.25),
    '--stripe': `linear-gradient(180deg, ${accent} 0 33%, ${third} 33% 66%, ${primary} 66% 100%)`,
    '--stripe-h': `linear-gradient(90deg, ${accent} 0 33%, ${third} 33% 66%, ${primary} 66% 100%)`,
  };
  return { primary, accent, third, light, onAccent, vars };
}
