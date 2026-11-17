// Seeded, reproducible PRNG with named, derived streams (GDD §4.4).
// sfc32 core; streams are derived by hashing (saveSeed, streamKey, ...ids, modelVersion).
// No global RNG: every consumer must be handed a stream explicitly.

export const MODEL_VERSION = 'alpha-0.1.0';

export function hashStr(s: string): number {
  // cyrb53-style 32-bit mix
  let h1 = 0xdeadbeef ^ s.length, h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0) ^ (h1 >>> 0);
}

export class Rng {
  private a: number; private b: number; private c: number; private d: number;
  draws = 0;
  constructor(seed: string) {
    this.a = hashStr(seed + '#a'); this.b = hashStr(seed + '#b');
    this.c = hashStr(seed + '#c'); this.d = hashStr(seed + '#d') | 1;
    for (let i = 0; i < 12; i++) this.next();
    this.draws = 0;
  }
  next(): number {
    this.draws++;
    let { a, b, c, d } = this;
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b | 0) + d | 0;
    d = d + 1 | 0;
    a = b ^ b >>> 9;
    b = c + (c << 3) | 0;
    c = (c << 21 | c >>> 11);
    c = c + t | 0;
    this.a = a; this.b = b; this.c = c; this.d = d;
    return (t >>> 0) / 4294967296;
  }
  /** uniform in [lo, hi) */
  range(lo: number, hi: number) { return lo + (hi - lo) * this.next(); }
  int(lo: number, hi: number) { return Math.floor(this.range(lo, hi + 1)); }
  chance(p: number) { return this.next() < p; }
  normal(mu = 0, sd = 1) {
    const u = Math.max(1e-12, this.next()), v = this.next();
    return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  pick<T>(arr: T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  /** weighted index; weights must be >= 0 */
  weighted(w: number[]): number {
    let s = 0; for (const x of w) s += x;
    if (s <= 0) return Math.floor(this.next() * w.length);
    let r = this.next() * s;
    for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; }
    return w.length - 1;
  }
}

/** Derive a named stream: e.g. stream(save.seed, 'game', gameId) */
export function stream(seed: string, key: string, ...ids: (string | number)[]): Rng {
  return new Rng([seed, key, ...ids, MODEL_VERSION].join('|'));
}

export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
export const logit = (p: number) => Math.log(p / (1 - p));
export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
/** rating 0-100 -> standardized z (mean ~55, sd ~15 among NBA players) */
export const z = (r: number) => (r - 55) / 15;
