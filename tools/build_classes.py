"""Build draft classes 1977-2026 (plus undrafted debutants) for the long-run league.

Ratings are era-normalised: every percentile is taken against the league of the season being
measured, so a 1985 rookie and a 2015 rookie are rated against their own peers.
Real careers only calibrate hidden latent talent (ceilings); scouting in game never sees them.
Output: public/data/classes.json  {year: [compact player, ...]}, undrafted: {year: [...]}
"""
import csv, json, math, random, re, unicodedata, os, sys
from collections import defaultdict
import pandas as pd

BASE = "/mnt/user-data/uploads/Historical NBA GM Game/"
OUT = sys.argv[1] if len(sys.argv) > 1 else "public/data/classes.json"
WORLD = "public/data/world1976.json"
rng = random.Random(1977)

def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r'"[^"]*"', "", s)
    s = re.sub(r"[^a-z ]", "", s.lower().replace(".", "").replace("'", "").replace("-", " "))
    return " ".join(s.split())

players_csv = list(csv.DictReader(open(BASE + "historical league data/Players.csv")))
pinfo, by_name = {}, defaultdict(list)
for p in players_csv:
    pid = int(p["personId"]); pinfo[pid] = p
    by_name[norm(p["firstName"] + " " + p["lastName"])].append(pid)

tot = pd.read_pickle("/home/claude/data/season_totals_all.pkl")
tot["personId"] = tot["personId"].astype(int)
tot = tot[tot.season >= 1973]
tot_by_pid = {pid: g.sort_values("season") for pid, g in tot.groupby("personId")}
for _, r in tot[["personId", "first", "last"]].drop_duplicates("personId").iterrows():
    k = norm(str(r["first"]) + " " + str(r["last"]))
    if r["personId"] not in by_name[k]: by_name[k].append(int(r["personId"]))
first_season = {pid: int(g.season.min()) for pid, g in tot_by_pid.items()}

def find_pid(name, year):
    k = norm(name)
    cands = list(by_name.get(k, []))
    if not cands:
        parts = k.split()
        if len(parts) > 2: cands = by_name.get(parts[0] + " " + parts[-1], [])
        if not cands:
            for kk, v in by_name.items():
                if kk.replace(" ", "") == k.replace(" ", ""): cands = v; break
    if len(cands) <= 1: return cands[0] if cands else None
    def yscore(pid):
        p = pinfo.get(pid, {}); dy = p.get('draftYear'); fy = p.get('fromYear')
        if dy and str(dy).isdigit() and int(dy) == year: return 0
        if pid in first_season: return abs(first_season[pid] - year) + 0.5
        if fy and str(fy).isdigit(): return abs(int(fy) - year - 1) + 1
        return 99
    return sorted(cands, key=yscore)[0]

KEYS = ["numMinutes", "points", "assists", "blocks", "steals", "fieldGoalsAttempted", "fieldGoalsMade", "freeThrowsAttempted", "freeThrowsMade",
        "reboundsDefensive", "reboundsOffensive", "reboundsTotal", "foulsPersonal", "turnovers", "g", "threePointersAttempted", "threePointersMade"]
def rates(rows):
    if not rows: return None
    t = defaultdict(float)
    for r in rows:
        for k in KEYS: t[k] += float(r.get(k, 0) or 0)
        if r.get("season", 0) >= 1977: t["toMin"] += float(r.get("numMinutes", 0)); t["toCnt"] += float(r.get("turnovers", 0))
    m = t["numMinutes"]
    if m < 1: return None
    p36 = lambda k: t[k] * 36.0 / m
    fga, fta = t["fieldGoalsAttempted"], t["freeThrowsAttempted"]
    split = t["reboundsOffensive"] + t["reboundsDefensive"]
    oreb = t["reboundsOffensive"] if split > 0 else t["reboundsTotal"] * 0.32
    dreb = t["reboundsDefensive"] if split > 0 else t["reboundsTotal"] * 0.68
    tpa = t["threePointersAttempted"]
    return dict(min=m, g=t["g"], mpg=m / max(t["g"], 1), pts=p36("points"), ast=p36("assists"), blk=p36("blocks"), stl=p36("steals"),
                fga=p36("fieldGoalsAttempted"), fta=p36("freeThrowsAttempted"), oreb=oreb * 36 / m, dreb=dreb * 36 / m, pf=p36("foulsPersonal"),
                fgp=(t["fieldGoalsMade"] + 2) / (fga + 5), ftp=(t["freeThrowsMade"] + 3) / (fta + 4),
                tov=(t["toCnt"] * 36 / t["toMin"]) if t["toMin"] > 200 else None,
                ts=t["points"] / max(1, 2 * (fga + 0.44 * fta)),
                tpa=tpa * 36 / m, tpp=(t["threePointersMade"] + 1) / (tpa + 4), tpn=tpa)

# era references (one per season, players with >= 600 minutes)
REF = {}
def ref_for(season):
    season = max(1973, min(2026 if 2026 in set(tot.season) else 2025, season))
    if season not in REF:
        rs = tot[(tot.season == season)].groupby("personId").sum(numeric_only=True).reset_index()
        rs = rs[rs.numMinutes >= 600]
        if len(rs) < 60: rs = tot[(tot.season == season - 1)].groupby("personId").sum(numeric_only=True).reset_index(); rs = rs[rs.numMinutes >= 600]
        vals = defaultdict(list)
        for _, r in rs.iterrows():
            rr = rates([dict(r.to_dict(), season=season)])
            if rr:
                for k, v in rr.items():
                    if v is not None: vals[k].append(v)
        REF[season] = {k: sorted(v) for k, v in vals.items()}
    return REF[season]
def pct(key, val, season):
    vals = ref_for(season).get(key, [])
    if val is None or not vals: return 0.5
    lo = sum(1 for v in vals if v < val); eq = sum(1 for v in vals if v == val)
    return (lo + 0.5 * eq) / len(vals)
scale = lambda p, lo=30, hi=92: lo + (hi - lo) * p
POS_H = {"PG": 0, "SG": 1, "SF": 2, "PF": 3, "C": 4}

def ratings_from(rt, pos, height, age, shrink, season):
    big = POS_H.get(pos, 2) / 4.0
    if rt is None:
        rt = dict(pts=9, ast=2.2, blk=0.4, stl=0.9, fga=9, fta=2.5, oreb=1.8, dreb=3.6, pf=4.8, fgp=0.42, ftp=0.70, tov=None, ts=0.48, mpg=8, tpa=0, tpp=0.3, tpn=0)
        shrink = 0.0
    def S(key, val, invert=False, lo=30, hi=92):
        p = pct(key, val, season)
        if invert: p = 1 - p
        rep = 0.18
        return scale(rep + (p - rep) * shrink, lo, hi)
    hgt = (height - 72) / 14.0
    r = {}
    r["ins"] = S("fgp", rt["fgp"]) * 0.55 + S("pts", rt["pts"]) * 0.25 + (40 + 45 * max(big, hgt)) * 0.20
    r["post"] = r["ins"] * (0.6 + 0.4 * big) + 12 * big - 4
    r["mid"] = S("ftp", rt["ftp"]) * 0.45 + S("fgp", rt["fgp"]) * 0.25 + S("pts", rt["pts"]) * 0.30 - 6 * big
    r["ft"] = scale(min(1, max(0, (rt["ftp"] - 0.50) / 0.42)) * (0.3 + 0.7 * shrink) + 0.35 * (1 - shrink) * 0.5, 30, 95)
    est3 = r["mid"] * 0.80 - 4 - 10 * big
    if season >= 1979 and rt.get("tpn", 0) >= 8:
        vol = min(1.0, rt["tpn"] / 150.0)
        real3 = S("tpp", rt["tpp"]) * 0.55 + S("tpa", rt["tpa"]) * 0.45
        r["three"] = est3 * (1 - vol) + real3 * vol
    else:
        r["three"] = est3 - (6 if season >= 1985 else 0)
    r["pass"] = S("ast", rt["ast"]) * 0.9 + 6 * (1 - big)
    r["handle"] = (S("tov", rt["tov"], invert=True) if rt.get("tov") is not None else 55 - 18 * big) * 0.5 + S("ast", rt["ast"]) * 0.3 + (60 - 25 * big) * 0.2
    r["drive"] = S("fta", rt["fta"]) * 0.45 + S("pts", rt["pts"]) * 0.35 + (55 - 15 * big) * 0.20
    r["oreb"] = S("oreb", rt["oreb"]); r["dreb"] = S("dreb", rt["dreb"])
    r["blk"] = S("blk", rt["blk"], lo=25, hi=95); r["stl"] = S("stl", rt["stl"])
    r["perD"] = S("stl", rt["stl"]) * 0.45 + (58 - 18 * big) * 0.35 + S("pf", rt["pf"], invert=True) * 0.20
    r["intD"] = S("blk", rt["blk"]) * 0.45 + S("dreb", rt["dreb"]) * 0.25 + (35 + 45 * hgt) * 0.30
    r["foulDraw"] = S("fta", rt["fta"]); r["foulAvoid"] = S("pf", rt["pf"], invert=True)
    r["usage"] = S("fga", rt["fga"])
    r["stamina"] = scale(min(1, max(0, (rt.get("mpg", 15) - 6) / 34.0)) * (0.3 + 0.7 * shrink) + 0.4 * (1 - shrink) * 0.5, 35, 95)
    ath_age = 0 if age is None else max(0, age - 27) * 2.2 - max(0, 24 - age) * 0.5
    r["ath"] = scale(0.5 * pct("stl", rt["stl"], season) + 0.5 * pct("blk", rt["blk"], season) * (0.3 + 0.7 * big) + 0.2, 35, 92) - ath_age
    r["iq"] = S("ast", rt["ast"]) * 0.35 + S("ts", rt["ts"]) * 0.45 + (min(age or 24, 31) - 20) * 1.6
    out = {k: int(round(max(20, min(99, v)))) for k, v in r.items()}
    out["hgt"] = height
    return out

def composite(rt):
    if rt is None: return 0
    return 1.0 * rt["pts"] * (0.6 + rt["ts"]) + 0.9 * rt["ast"] + 0.8 * (rt["oreb"] + rt["dreb"]) * 0.6 + 1.2 * rt["stl"] + 1.0 * rt["blk"]

def pos_of(pid, height):
    p = pinfo.get(pid, {})
    g, f, c = p.get("guard") == "1", p.get("forward") == "1", p.get("center") == "1"
    if c and not f: return "C"
    if c and f: return "PF" if height < 83 else "C"
    if f and g: return "SF" if height >= 79 else "SG"
    if f: return "PF" if height >= 81 else "SF"
    if g: return "PG" if height <= 75 else "SG"
    return "C" if height >= 83 else "PF" if height >= 81 else "SF" if height >= 79 else "SG" if height >= 76 else "PG"

def height_of(pid):
    try: return int(float(pinfo.get(pid, {}).get("heightInches")))
    except Exception: return None

def age_at(pid, date):
    b = pinfo.get(pid, {}).get("birthDate") or ""
    if not b: return None
    y, m, d = map(int, b[:10].split("-")); Y, M, D = map(int, date.split("-"))
    return Y - y - ((M, D) < (m, d))

RKEYS = ["ins", "post", "mid", "ft", "three", "pass", "handle", "drive", "oreb", "dreb", "blk", "stl", "perD", "intD", "foulDraw", "foulAvoid", "usage", "stamina", "ath", "iq"]
TKEYS = ["drive", "ambition", "ego", "loyalty", "discipline", "adapt", "patience", "social"]

def make(pid, name, year, status, draft=None, college=None):
    rows = tot_by_pid.get(pid)
    rows = [] if rows is None else rows.to_dict("records")
    height = height_of(pid) if pid else None
    if not height: height = int(round(rng.gauss(79, 3.2)))
    pos = pos_of(pid, height) if pid else ("C" if height >= 83 else "PF" if height >= 81 else "SF" if height >= 79 else "SG" if height >= 76 else "PG")
    age = age_at(pid, f"{year - 1}-10-21") if pid else None
    if age is None: age = 21 + rng.choice([0, 0, 1, 1, 1, 2]) - 1
    fs = rows[0]["season"] if rows else year
    first = [r for r in rows if r["season"] == fs]
    rt = rates(first)
    mins = sum(r["numMinutes"] for r in first) * 0.6 if first else 0
    shrink = min(1.0, mins / 1400.0) ** 0.6 if mins else 0.0
    cur = ratings_from(rt, pos, height, age + max(0, fs - year), shrink, fs)
    if rows and fs > year + 1:  # stashed abroad / late debut: arrives a little less ready than his debut line
        for k in RKEYS: cur[k] = int(max(20, cur[k] - 2 * min(4, fs - year - 1)))
    peak_rt, peak_c, peak_season = None, -1, fs
    by_season = defaultdict(list)
    for r in rows: by_season[r["season"]].append(r)
    for s, rs in by_season.items():
        if sum(x["numMinutes"] for x in rs) >= 500:
            rr = rates(rs); c = composite(rr)
            if c > peak_c: peak_c, peak_rt, peak_season = c, rr, s
    pot = ratings_from(peak_rt, pos, height, age + 3, 0.85, peak_season) if peak_rt else dict(cur)
    if not rows:  # never reached the NBA: low latent talent, small chance he outplays his record
        rk = (draft or {}).get("realPick", 999)
        lvl = rng.gauss(36, 5) + (6 if rk <= 20 else 0)
        for k in RKEYS: cur[k] = int(max(20, min(70, lvl + rng.gauss(0, 7))))
        pot = {k: int(min(75, cur[k] + abs(rng.gauss(4, 4)))) for k in RKEYS}
    ceil = [int(round(min(99, max(cur[k], pot[k]) + rng.gauss(0, 2)))) for k in RKEYS]
    p = pinfo.get(pid, {}) if pid else {}
    wgt = None
    try: wgt = int(float(p.get("bodyWeightLbs"))) if p.get("bodyWeightLbs") else None
    except Exception: pass
    return dict(id=f"p{pid}" if pid else f"x{year}_{norm(name).replace(' ', '_')}", n=name, nb=pid, pos=pos, a=age, b=(p.get("birthDate") or "")[:10] or None,
                h=height, w=wgt, c=college or p.get("school") or None, r=[cur[k] for k in RKEYS], ce=ceil,
                t=[int(rng.gauss(50, 14)) for _ in TKEYS], d=draft, m=int(mins), dy=year, st=status)

world = json.load(open(WORLD))
existing = {p["nbaId"] for p in world["players"] if p.get("nbaId") and p.get("kind") != "prospect"}
draft_rows = [json.loads(l) for l in open(BASE + "NBA_GM_Data_Audit_Implementation_Pack/draft_selections_candidate.jsonl")]
classes, undrafted, used = {}, {}, set(existing)
for yr in range(1977, 2027):
    cls = []
    for d in draft_rows:
        if d["year"] != yr or not d["player_name_raw"].strip(): continue
        nm = d["player_name_raw"].strip()
        pid = find_pid(nm, yr)
        if pid and pid in used: continue
        if pid and pid in first_season and first_season[pid] < yr - 1: continue  # already a pro before this draft
        rk = int(d["pick_raw"]) if str(d["pick_raw"]).isdigit() else 999
        cls.append(make(pid, nm, yr, "Draft-eligible prospect", dict(year=yr, college=d["college_raw"] or None, realPick=rk, realTeam=d["team_raw"]), d["college_raw"] or None))
        if pid: used.add(pid)
    classes[yr] = cls
# undrafted debutants: everyone whose first NBA season is Y and who is not in any class
for pid, fs in first_season.items():
    if fs < 1977 or pid in used: continue
    p = pinfo.get(pid, {})
    dy = p.get("draftYear")
    nm = f"{p.get('firstName', '')} {p.get('lastName', '')}".strip()
    if not nm:
        g = tot_by_pid[pid].iloc[0]; nm = f"{g['first']} {g['last']}".strip()
    mins = float(tot_by_pid[pid].numMinutes.sum())
    if mins < 150: continue  # cup-of-coffee careers add noise, not supply
    undrafted.setdefault(fs, []).append(make(pid, nm, fs, "Undrafted free agent" if not (dy and str(dy).isdigit()) else "Late-arriving free agent"))
    used.add(pid)

json.dump(dict(version="classes-0.5", keys=RKEYS, traits=TKEYS, classes={str(k): v for k, v in classes.items()},
               undrafted={str(k): v for k, v in sorted(undrafted.items())}), open(OUT, "w"), separators=(",", ":"))
print({k: len(v) for k, v in classes.items()})
print("undrafted", {k: len(v) for k, v in sorted(undrafted.items())})
for yr in (1984, 1996, 2003, 2009, 2018):
    top = sorted(classes[yr], key=lambda p: -sum(p["ce"]))[:5]
    print(yr, [(p["n"], p["pos"], p["a"], sum(p["r"]) // 20, sum(p["ce"]) // 20, p["r"][4]) for p in top])
