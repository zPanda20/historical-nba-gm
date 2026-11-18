"""Turn the sportslogos asset pack into game assets plus a season timeline.

usage: python3 tools/build_asset_pack.py "<path to sportslogos_nba>"
Writes public/assets/logos/P-<FID>-<year>.png (primary logos, transparent, 256px),
public/assets/pack/{home,road,word,court,event}/... (webp) and src/sim/assetPack.ts (timelines by franchise and season).
"""
import csv, json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = sys.argv[1].rstrip('/') + '/'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGOS = os.path.join(ROOT, 'public/assets/logos')
PACK = os.path.join(ROOT, 'public/assets/pack')

FID = {
    'Atlanta Hawks': 'ATL', 'Boston Celtics': 'BOS', 'Brooklyn Nets': 'NYN', 'New Jersey Nets': 'NYN', 'New York Nets': 'NYN',
    'Buffalo Braves': 'BUF', 'San Diego Clippers': 'BUF', 'Los Angeles Clippers': 'BUF', 'Capital Bullets': 'WSB', 'Washington Bullets': 'WSB',
    'Washington Wizards': 'WSB', 'Charlotte Bobcats': 'CHA', 'Chicago Bulls': 'CHI', 'Cleveland Cavaliers': 'CLE', 'Dallas Mavericks': 'DAL',
    'Denver Nuggets': 'DEN', 'Detroit Pistons': 'DET', 'Golden State Warriors': 'GSW', 'San Francisco Warriors': 'GSW', 'Houston Rockets': 'HOU',
    'Indiana Pacers': 'IND', 'Kansas City Kings': 'KCK', 'Kansas City-Omaha Kings': 'KCK', 'Sacramento Kings': 'KCK', 'Memphis Grizzlies': 'VAN',
    'Vancouver Grizzlies': 'VAN', 'Miami Heat': 'MIA', 'Milwaukee Bucks': 'MIL', 'Minnesota Timberwolves': 'MIN', 'New Orleans Hornets': 'CHH',
    'NO-Oklahoma City Hornets': 'CHH', 'New Orleans Jazz': 'NOJ', 'Utah Jazz': 'NOJ', 'New York Knicks': 'NYK', 'Oklahoma City Thunder': 'SEA',
    'Seattle Supersonics': 'SEA', 'Orlando Magic': 'ORL', 'Philadelphia 76ers': 'PHI', 'Phoenix Suns': 'PHX', 'Portland Trail Blazers': 'POR',
    'San Antonio Spurs': 'SAS', 'Toronto Raptors': 'TOR', 'Los Angeles Lakers': 'LAL',
}
def fid_of(team, fs):
    if team == 'Charlotte Hornets': return 'CHA' if fs >= 2013 else 'CHH'
    return FID.get(team)
def yr(s):
    if not s or s.lower().startswith('present'): return 9999
    return int(s.split('/')[0])

rows = list(csv.DictReader(open(SRC + 'manifest.csv')))
for r in rows:
    r['fs'] = yr(r['first_season']); r['ls'] = yr(r['last_season']); r['path'] = SRC + r['file'].replace('\\', '/')

def clean(im, peel=1, tol=28):
    a = np.array(im.convert('RGBA')).astype(int)
    h, w, _ = a.shape
    for _ in range(peel):
        seeds = []
        for (y0, x0, dy, dx) in [(0, 0, 1, 1), (0, w - 1, 1, -1), (h - 1, 0, -1, 1), (h - 1, w - 1, -1, -1)]:
            y, x = y0, x0
            while 0 <= y < h and 0 <= x < w and a[y, x, 3] < 200: y += dy; x += dx
            if 0 <= y < h and 0 <= x < w: seeds.append((y, x))
        cols = [a[y, x, :3] for y, x in seeds]
        if len(cols) < 3 or not all(np.abs(c - cols[0]).sum() < 45 for c in cols): break
        diff = np.abs(a[:, :, :3] - cols[0]).sum(axis=2)
        near = (diff < tol) & (a[:, :, 3] > 0)
        lab, n = ndimage.label(near)
        ids = [lab[y, x] for y, x in seeds if lab[y, x] > 0]
        bg = np.isin(lab, ids)
        a[bg, 3] = 0
        edge = ndimage.binary_dilation(bg, iterations=1) & ~bg
        a[edge, 3] = (a[edge, 3] * np.clip(diff[edge] / 110, 0.3, 1)).astype(int)
    alpha = a[:, :, 3] > 30
    lab, n = ndimage.label(alpha)
    if n > 1:
        sizes = ndimage.sum(alpha, lab, range(1, n + 1))
        for i, sz in enumerate(sizes, 1):
            if sz < sizes.max() * 0.012: a[lab == i, 3] = 0
    out = Image.fromarray(a.astype('uint8'))
    bb = out.getbbox()
    return out.crop(bb) if bb else out

def square(im, size):
    w, h = im.size; s = max(w, h)
    c = Image.new('RGBA', (s, s), (0, 0, 0, 0)); c.paste(im, ((s - w) // 2, (s - h) // 2))
    return c.resize((size, size), Image.LANCZOS)

def fit(im, maxw, maxh):
    im = im.copy(); im.thumbnail((maxw, maxh), Image.LANCZOS); return im

def first_frame(p):
    im = Image.open(p)
    try: im.seek(0)
    except Exception: pass
    return im.convert('RGBA')

timeline = {'logo': {}, 'home': {}, 'road': {}, 'word': {}, 'court': {}}
events = {'draft': [], 'finals': [], 'playoffs': [], 'league': []}
os.makedirs(LOGOS, exist_ok=True)
for d in ('home', 'road', 'word', 'court', 'event'): os.makedirs(os.path.join(PACK, d), exist_ok=True)

def add(kind, fid, fs, ls, key):
    lst = timeline[kind].setdefault(fid, [])
    if any(x[0] == fs for x in lst): return False
    lst.append([fs, ls, key]); return True

CAT = {'Primary Logos': 'logo', 'Primary Dark Logos': 'logo2', 'Home Uniforms': 'home', 'Primary White Uniforms': 'home', 'Road Uniforms': 'road',
       'Primary Dark Uniforms': 'road', 'Wordmark Logos': 'word', 'Playing Surfaces': 'court'}
done = 0
# primary logos first, dark versions only where no primary exists for that start
for pref in ('logo', 'logo2', 'home', 'road', 'word', 'court'):
    for r in sorted(rows, key=lambda r: (r['team'], r['fs'], -os.path.getsize(r['path']) if os.path.exists(r['path']) else 0)):
        kind = CAT.get(r['category'])
        if kind != pref or not os.path.exists(r['path']): continue
        fid = fid_of(r['team'], r['fs'])
        if not fid or r['ls'] < 1976: continue
        k = 'logo' if kind == 'logo2' else kind
        fs = max(r['fs'], 1976) if r['fs'] < 1976 else r['fs']
        try: im = first_frame(r['path'])
        except Exception as e: print('skip', r['path'], e); continue
        if k == 'logo':
            key = f'P-{fid}-{fs}'
            if not add('logo', fid, fs, r['ls'], key): continue
            square(clean(im, peel=2 if kind == 'logo2' else 1), 256).save(os.path.join(LOGOS, key + '.png'), optimize=True)
        elif k in ('home', 'road'):
            name = f'{fid}-{fs}.webp'
            if not add(k, fid, fs, r['ls'], f'{k}/{name}'): continue
            fit(clean(im), 220, 240).save(os.path.join(PACK, k, name), 'WEBP', quality=82, method=4)
        elif k == 'word':
            name = f'{fid}-{fs}.webp'
            if not add('word', fid, fs, r['ls'], f'word/{name}'): continue
            fit(clean(im), 520, 120).save(os.path.join(PACK, 'word', name), 'WEBP', quality=85, method=4)
        elif k == 'court':
            name = f'{fid}-{fs}.webp'
            if not add('court', fid, fs, r['ls'], f'court/{name}'): continue
            fit(im, 900, 520).save(os.path.join(PACK, 'court', name), 'WEBP', quality=80, method=4)
        done += 1
# league marks: draft, finals, playoffs, league logo
EV = {'NBA Draft': 'draft', 'NBA Finals': 'finals', 'NBA Playoffs': 'playoffs', 'National Basketball Association': 'league'}
for r in sorted(rows, key=lambda r: r['fs']):
    kind = EV.get(r['team'])
    if not kind or r['category'] not in ('Primary Logos', 'Primary Dark Logos') or not os.path.exists(r['path']): continue
    if any(x[0] == r['fs'] for x in events[kind]): continue
    name = f'{kind}-{r["fs"]}.png'
    square(clean(first_frame(r['path'])), 256).save(os.path.join(PACK, 'event', name), optimize=True)
    events[kind].append([r['fs'], r['ls'], f'event/{name}'])
for k in timeline:
    for f in timeline[k]: timeline[k][f].sort()
ts = '// Generated by tools/build_asset_pack.py from the sportslogos pack. Do not edit by hand.\n'
ts += '// [firstSeason, lastSeason (9999 = still current when the pack was made), key]\n'
ts += 'export type Span = [number, number, string];\n'
ts += f'export const PACK_TIMELINE: Record<string, Record<string, Span[]>> = {json.dumps(timeline, separators=(",", ":"))};\n'
ts += f'export const PACK_EVENTS: Record<string, Span[]> = {json.dumps(events, separators=(",", ":"))};\n'
open(os.path.join(ROOT, 'src/sim/assetPack.ts'), 'w').write(ts)
print('assets', done, {k: sum(len(v) for v in timeline[k].values()) for k in timeline}, {k: len(v) for k, v in events.items()})
