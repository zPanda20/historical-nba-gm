"""Shrink NBA headshots to small webp files for the players in this game, and write the id index.

usage: python3 tools/build_headshots.py <folder with <personId>.png files>
Only ids that appear in the 1976 world or in the draft classes are kept. Output: public/assets/headshots/<id>.webp + index.json
"""
import json, os, sys
from PIL import Image

src = sys.argv[1]
out = "public/assets/headshots"
os.makedirs(out, exist_ok=True)
w = json.load(open("public/data/world1976.json"))
c = json.load(open("public/data/classes.json"))
ids = {p["nbaId"] for p in w["players"] if p.get("nbaId")}
for grp in ("classes", "undrafted"):
    for v in c[grp].values():
        ids |= {p["nb"] for p in v if p.get("nb")}
done = 0
for f in os.listdir(src):
    stem, ext = os.path.splitext(f)
    if not stem.isdigit() or int(stem) not in ids or ext.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
        continue
    im = Image.open(os.path.join(src, f)).convert("RGBA")
    bb = im.getbbox()
    if bb: im = im.crop(bb)
    # NBA cut-outs are wider than tall (260x190): keep the face, centred, in a square
    W, H = im.size
    side = min(W, H)
    left = (W - side) // 2
    im = im.crop((left, 0, left + side, side)).resize((160, 160), Image.LANCZOS)
    im.save(os.path.join(out, f"{int(stem)}.webp"), "WEBP", quality=80, method=6)
    done += 1
have = sorted(int(os.path.splitext(f)[0]) for f in os.listdir(out) if f.endswith(".webp"))
json.dump(have, open(os.path.join(out, "index.json"), "w"))
print("converted", done, "index", len(have))
