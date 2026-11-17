"""Build the alpha data pack (1976-77 baseline) for the NBA GM simulator.

Every output keeps provenance: real historical evidence is tagged `reported`/`unverified`,
model outputs are tagged `reconstructed`/`inferred`/`simulated`. Nothing here is verified history.
"""
import csv, json, math, random, re, unicodedata, os
from collections import defaultdict
import pandas as pd

BASE = "/mnt/user-data/uploads/Historical NBA GM Game/"
OUT = "/home/claude/data/out"
os.makedirs(OUT, exist_ok=True)
rng = random.Random(1976)

def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.replace("’", "'").replace("“", '"').replace("”", '"')
    s = re.sub(r'"[^"]*"', "", s)          # remove nicknames in quotes
    s = re.sub(r"[^a-z ]", "", s.lower().replace(".", "").replace("'", "").replace("-", " "))
    return " ".join(s.split())

# ------------------------------------------------------------------ teams (1976-77)
TEAMS = [
 # id, city, name, abbr, conf, div, primary, secondary, accent, logo, coach, gm, owner
 (1610612738,"Boston","Celtics","BOS","East","Atlantic","#007A33","#FFFFFF","#BA9653","Boston Celtics (1976-1996).jpg","Tom Heinsohn","Red Auerbach","Irv Levin"),
 (1610612746,"Buffalo","Braves","BUF","East","Atlantic","#0A2C6E","#F26B21","#FFFFFF","Buffalo_Braves_(1976-1978).svg","Tates Locke","Bob MacKinnon","John Y. Brown Jr."),
 (1610612752,"New York","Knicks","NYK","East","Atlantic","#006BB6","#F58426","#BEC0C2","New York Knicks (1976-1983).webp","Red Holzman","Eddie Donovan","Madison Square Garden Corp."),
 (1610612751,"New York","Nets","NYN","East","Atlantic","#002A60","#D21033","#FFFFFF","new-york-nets (1976-1977).png","Kevin Loughery","Roy Boe","Roy Boe"),
 (1610612755,"Philadelphia","76ers","PHI","East","Atlantic","#006BB6","#ED174C","#FFFFFF","Philadelphia 76ers (1976-1977).png","Gene Shue","Pat Williams","F. Eugene Dixon Jr."),
 (1610612737,"Atlanta","Hawks","ATL","East","Central","#C8102E","#FDB927","#FFFFFF","Atlanta Hawks (1976-1992).png","Hubie Brown","Bud Seretean","Tom Cousins"),
 (1610612739,"Cleveland","Cavaliers","CLE","East","Central","#860038","#FDBB30","#FFFFFF","Clevland Cavs (1976-1982).png","Bill Fitch","Bill Fitch","Nick Mileti"),
 (1610612745,"Houston","Rockets","HOU","East","Central","#CE1141","#FDB927","#FFFFFF","houston-rockets (1976-1995).png","Tom Nissalke","Ray Patterson","Kenneth Schnitzer"),
 (1610612762,"New Orleans","Jazz","NOJ","East","Central","#4B2B7F","#00843D","#F9A01B","New Orleans Jazz (1976-1979).webp","Butch van Breda Kolff","Barry Mendelson","Sam Battistone"),
 (1610612759,"San Antonio","Spurs","SAS","East","Central","#1E1E1E","#C4CED4","#E35205","san_antonio_spurs_1976-1989.png","Doug Moe","John Begzos","Angelo Drossos"),
 (1610612764,"Washington","Bullets","WSB","East","Central","#002B5C","#E31837","#FFFFFF","washington-bullets-logo (1976-1987).png","Dick Motta","Bob Ferry","Abe Pollin"),
 (1610612741,"Chicago","Bulls","CHI","West","Midwest","#CE1141","#000000","#FFFFFF","chicago_bulls_logo.png","Ed Badger","Jon Kovler","Arthur Wirtz"),
 (1610612743,"Denver","Nuggets","DEN","West","Midwest","#0E2240","#FEC524","#8B2131","denver-nuggets-1976-1981.png","Larry Brown","Carl Scheer","Nuggets ownership group"),
 (1610612765,"Detroit","Pistons","DET","West","Midwest","#C8102E","#1D42BA","#FFFFFF","detroit_pistons_1975-1978.jpg","Herb Brown","Oscar Feldman","Bill Davidson"),
 (1610612754,"Indiana","Pacers","IND","West","Midwest","#002D62","#FDBB30","#FFFFFF","Indiana Pacers 1976-1990.png","Bob “Slick” Leonard","Bob “Slick” Leonard","Pacers ownership group"),
 (1610612758,"Kansas City","Kings","KCK","West","Midwest","#0076B6","#C8102E","#FFFFFF","kansas_city_kings_1976-1985.png","Phil Johnson","Joe Axelson","Kings ownership group"),
 (1610612749,"Milwaukee","Bucks","MIL","West","Midwest","#00471B","#C8102E","#EEE1C6","milwaukee_bucks_logo (1968-1993).png","Larry Costello","Wayne Embry","Jim Fitzgerald"),
 (1610612744,"Golden State","Warriors","GSW","West","Pacific","#1D428A","#FFC72C","#FFFFFF","Logo_Warriors_75-88.gif","Al Attles","Al Attles","Franklin Mieuli"),
 (1610612747,"Los Angeles","Lakers","LAL","West","Pacific","#552583","#FDB927","#FFFFFF","LA Lakers (1976-2001).jpg","Jerry West","Bill Sharman","Jack Kent Cooke"),
 (1610612756,"Phoenix","Suns","PHX","West","Pacific","#1D1160","#E56020","#FFFFFF","Phoenix Suns (1968-1992).svg","John MacLeod","Jerry Colangelo","Suns ownership group"),
 (1610612757,"Portland","Trail Blazers","POR","West","Pacific","#E03A3E","#000000","#FFFFFF","Portland-Trail-Blazers-Logo-1970-1990.png","Jack Ramsay","Harry Glickman","Larry Weinberg"),
 (1610612760,"Seattle","SuperSonics","SEA","West","Pacific","#00653A","#FFC200","#FFFFFF","Seattle Supersonics (1976-1995).gif","Bill Russell","Bill Russell","Sam Schulman"),
]
TEAM_BY_NAME = {f"{c} {n}": t for t in TEAMS for c, n in [(t[1], t[2])]}
TEAM_BY_NAME["New York Nets"] = TEAMS[3]
ABBR_BY_ID = {t[0]: t[3] for t in TEAMS}
# NBA dataset team ids for 1976 (Jazz/Kings/Bullets/Pistons/Sonics ids differ in source data); map by nickname
NICK_TO_ABBR = {t[2]: t[3] for t in TEAMS}

# ------------------------------------------------------------------ sources
players_csv = list(csv.DictReader(open(BASE + "historical league data/Players.csv")))
pinfo = {}
by_name = defaultdict(list)
for p in players_csv:
    pid = int(p["personId"])
    pinfo[pid] = p
    by_name[norm(p["firstName"] + " " + p["lastName"])].append(pid)

tot = pd.read_pickle("/home/claude/data/season_totals.pkl")
tot["personId"] = tot["personId"].astype(int)
for c in ["first", "last"]:
    tot[c] = tot[c].fillna("")
tot_by_pid = {pid: g.sort_values("season") for pid, g in tot.groupby("personId")}
for _, r in tot[["personId", "first", "last"]].drop_duplicates("personId").iterrows():
    k = norm(r["first"] + " " + r["last"])
    if r["personId"] not in by_name[k]:
        by_name[k].append(int(r["personId"]))

ALIASES = {
    "nate tiny archibald": "nate archibald", "mike dantoni": "mike dantoni", "world b free": "world b free",
    "harthorne wingo": "harthorne wingo", "e c coleman": "ec coleman", "m l carr": "ml carr", "c j kupec": "charles kupec",
    "bob slick leonard": "bob leonard", "jo jo white": "jo jo white", "bingo smith": "bingo smith",
    "fatty taylor": "roland taylor", "roger brown detroit c": "roger brown",
    "bird averitt": "william averitt", "ticky burden": "luther burden", "mo layton": "dennis layton", "kenny charles": "ken charles",
    "james mcelroy": "jim mcelroy", "bud stallworth": "isaac stallworth", "louie dampier": "lou dampier", "ted mcclain": "ted hound dog mcclain",
    "david meyers": "dave meyers", "dwight davis": "double d davis", "charles johnson": "charlie johnson", "cj kupec": "charles kupec", "gar heard": "garfield heard",
}

def find_pid(name, team_abbr=None, year=None):
    k = norm(name)
    k = ALIASES.get(k, k)
    cands = list(by_name.get(k, []))
    if not cands:
        # try without middle tokens / alternative spellings
        parts = k.split()
        if len(parts) > 2:
            cands = by_name.get(parts[0] + " " + parts[-1], [])
        if not cands:
            for kk, v in by_name.items():
                if kk.replace(" ", "") == k.replace(" ", ""):
                    cands = v; break
    if len(cands) <= 1:
        return cands[0] if cands else None
    if year:
        def yscore(pid):
            p = pinfo.get(pid, {})
            dy = p.get('draftYear'); fy = p.get('fromYear')
            if dy and str(dy).isdigit() and int(dy) == year: return 0
            if fy and str(fy).isdigit(): return abs(int(fy) - year - 1)
            return 99
        return sorted(cands, key=yscore)[0]
    # disambiguate: who played 1976 (or 1975) season, prefer matching team
    best, bscore = None, -1
    for pid in cands:
        g = tot_by_pid.get(pid)
        s = 0
        if g is not None:
            r76 = g[g.season.isin([1975, 1976])]
            if len(r76):
                s = 1 + float(r76.numMinutes.sum()) / 1000
                if team_abbr and any(NICK_TO_ABBR.get(t) == team_abbr for t in r76.team):
                    s += 10
        if s > bscore:
            best, bscore = pid, s
    return best

# ------------------------------------------------------------------ ratings model
def age_on(pid, date="1976-10-21"):
    b = pinfo.get(pid, {}).get("birthDate") or ""
    if not b:
        return None
    y, m, d = map(int, b[:10].split("-"))
    Y, M, D = map(int, date.split("-"))
    return Y - y - ((M, D) < (m, d))

def seasons(pid):
    g = tot_by_pid.get(pid)
    return [] if g is None else g.to_dict("records")

def rates(rows):
    """Per-36 and percentage profile from a list of season rows (weighted totals)."""
    if not rows:
        return None
    t = defaultdict(float)
    for r in rows:
        w = r.get("_w", 1.0)
        for k in ["numMinutes", "points", "assists", "blocks", "steals", "fieldGoalsAttempted", "fieldGoalsMade",
                  "freeThrowsAttempted", "freeThrowsMade", "reboundsDefensive", "reboundsOffensive", "reboundsTotal",
                  "foulsPersonal", "turnovers", "g", "threePointersAttempted", "threePointersMade"]:
            t[k] += w * float(r.get(k, 0) or 0)
        if r.get("season", 0) >= 1977:
            t["toMin"] += w * float(r.get("numMinutes", 0)); t["toCnt"] += w * float(r.get("turnovers", 0))
    m = t["numMinutes"]
    if m < 1:
        return None
    p36 = lambda k: t[k] * 36.0 / m
    fga = t["fieldGoalsAttempted"]; fta = t["freeThrowsAttempted"]
    reb_split = t["reboundsOffensive"] + t["reboundsDefensive"]
    oreb = t["reboundsOffensive"] if reb_split > 0 else t["reboundsTotal"] * 0.32
    dreb = t["reboundsDefensive"] if reb_split > 0 else t["reboundsTotal"] * 0.68
    return dict(min=m, g=t["g"], mpg=m / max(t["g"], 1),
                pts=p36("points"), ast=p36("assists"), blk=p36("blocks"), stl=p36("steals"),
                fga=p36("fieldGoalsAttempted"), fta=p36("freeThrowsAttempted"),
                oreb=oreb * 36 / m, dreb=dreb * 36 / m, pf=p36("foulsPersonal"),
                fgp=(t["fieldGoalsMade"] + 2) / (fga + 5), ftp=(t["freeThrowsMade"] + 3) / (fta + 4),
                tov=(t["toCnt"] * 36 / t["toMin"]) if t["toMin"] > 200 else None,
                ts=t["points"] / max(1, 2 * (fga + 0.44 * fta)))

def pos_of(raw, pid):
    raw = (raw or "").upper()
    if raw:
        return raw.split("/")[0].strip()
    p = pinfo.get(pid, {})
    if p.get("center") == "1": return "C"
    if p.get("forward") == "1": return "SF"
    return "SG"

def height_of(pid, pos):
    h = pinfo.get(pid, {}).get("heightInches")
    try:
        return int(float(h))
    except Exception:
        return {"PG": 74, "SG": 77, "SF": 79, "PF": 81, "C": 83}.get(pos, 78)

# league reference distribution (1976 season, >=600 min) for percentile mapping
ref = tot[(tot.season == 1976) & (tot.numMinutes >= 600)]
REF = []
for _, r in ref.iterrows():
    REF.append(rates([r.to_dict()]))
def pct(key, val):
    vals = sorted(x[key] for x in REF if x and x.get(key) is not None)
    if val is None or not vals: return 0.5
    lo = sum(1 for v in vals if v < val); eq = sum(1 for v in vals if v == val)
    return (lo + 0.5 * eq) / len(vals)

def scale(p, lo=30, hi=92):
    return lo + (hi - lo) * p

POS_H = {"PG": 0, "SG": 1, "SF": 2, "PF": 3, "C": 4}

def ratings_from(rt, pos, height, age, shrink):
    """Return 0-100 skill dict. shrink in [0,1] = weight of evidence vs replacement prior."""
    big = POS_H.get(pos, 2) / 4.0
    if rt is None:
        rt = dict(pts=9, ast=2.2, blk=0.4, stl=0.9, fga=9, fta=2.5, oreb=1.8, dreb=3.6, pf=4.8, fgp=0.42, ftp=0.70, tov=None, ts=0.48, mpg=8)
        shrink = 0.0
    def S(key, val, invert=False, lo=30, hi=92):
        p = pct(key, val)
        if invert: p = 1 - p
        rep = 0.18  # replacement-level percentile prior
        return scale(rep + (p - rep) * shrink, lo, hi)
    hgt = (height - 72) / 14.0  # 0 at 6'0", 1 at 7'2"
    r = {}
    r["ins"] = S("fgp", rt["fgp"]) * 0.55 + S("pts", rt["pts"]) * 0.25 + (40 + 45 * max(big, hgt)) * 0.20
    r["post"] = r["ins"] * (0.6 + 0.4 * big) + 12 * big - 4
    r["mid"] = S("ftp", rt["ftp"]) * 0.45 + S("fgp", rt["fgp"]) * 0.25 + S("pts", rt["pts"]) * 0.30 - 6 * big
    r["ft"] = scale(min(1, max(0, (rt["ftp"] - 0.50) / 0.42)) * (0.3 + 0.7 * shrink) + 0.35 * (1 - shrink) * 0.5, 30, 95)
    r["three"] = r["mid"] * 0.80 - 4 - 10 * big
    r["pass"] = S("ast", rt["ast"]) * 0.9 + 6 * (1 - big)
    r["handle"] = (S("tov", rt["tov"], invert=True) if rt.get("tov") is not None else 55 - 18 * big) * 0.5 + S("ast", rt["ast"]) * 0.3 + (60 - 25 * big) * 0.2
    r["drive"] = S("fta", rt["fta"]) * 0.45 + S("pts", rt["pts"]) * 0.35 + (55 - 15 * big) * 0.20
    r["oreb"] = S("oreb", rt["oreb"])
    r["dreb"] = S("dreb", rt["dreb"])
    r["blk"] = S("blk", rt["blk"], lo=25, hi=95)
    r["stl"] = S("stl", rt["stl"])
    r["perD"] = S("stl", rt["stl"]) * 0.45 + (58 - 18 * big) * 0.35 + S("pf", rt["pf"], invert=True) * 0.20
    r["intD"] = S("blk", rt["blk"]) * 0.45 + S("dreb", rt["dreb"]) * 0.25 + (35 + 45 * hgt) * 0.30
    r["foulDraw"] = S("fta", rt["fta"])
    r["foulAvoid"] = S("pf", rt["pf"], invert=True)
    r["usage"] = S("fga", rt["fga"])
    r["stamina"] = scale(min(1, max(0, (rt.get("mpg", 15) - 6) / 34.0)) * (0.3 + 0.7 * shrink) + 0.4 * (1 - shrink) * 0.5, 35, 95)
    ath_age = 0 if age is None else max(0, age - 27) * 2.2 - max(0, 24 - age) * 0.5
    r["ath"] = scale(0.5 * pct("stl", rt["stl"]) + 0.5 * pct("blk", rt["blk"]) * (0.3 + 0.7 * big) + 0.2, 35, 92) - ath_age
    r["iq"] = S("ast", rt["ast"]) * 0.35 + S("ts", rt["ts"]) * 0.45 + (min(age or 24, 31) - 20) * 1.6
    out = {k: int(round(max(20, min(99, v)))) for k, v in r.items()}
    out["hgt"] = height
    return out

def overall(r, pos):
    big = POS_H.get(pos, 2) / 4.0
    off = 0.22 * r["ins"] + 0.16 * r["mid"] + 0.14 * r["pass"] + 0.10 * r["drive"] + 0.08 * r["handle"] + 0.08 * r["iq"] + 0.06 * r["ft"]
    deff = 0.06 * r["perD"] * (1 - big) + 0.06 * r["intD"] * big + 0.04 * (r["dreb"] if big > .5 else r["stl"]) + 0.03 * r["blk"] * big + 0.03 * r["oreb"] * big
    return off + deff + 0.05 * r["ath"] + 0.04 * r["usage"]

def composite(rt):
    """Single number for peak/potential comparisons."""
    if rt is None: return 0
    return 1.0 * rt["pts"] * (0.6 + rt["ts"]) + 0.9 * rt["ast"] + 0.8 * (rt["oreb"] + rt["dreb"]) * 0.6 + 1.2 * rt["stl"] + 1.0 * rt["blk"]

# ------------------------------------------------------------------ build player record
PEOPLE = {}
def make_player(pid, name, pos_raw, team_abbr, status, src, age_rep=None, draft=None, kind="veteran"):
    if pid in PEOPLE:
        return PEOPLE[pid]
    rows = seasons(pid)
    pos = pos_of(pos_raw, pid)
    height = height_of(pid, pos)
    age = age_on(pid) if pid else None
    if age is None and age_rep:
        age = int(age_rep)
    if kind == "veteran":
        ev = []
        for r in rows:
            w = {1975: 0.30, 1976: 0.55, 1977: 0.15}.get(r["season"], 0)
            if w: r = dict(r); r["_w"] = w; ev.append(r)
        rt = rates(ev)
        mins = sum(r["numMinutes"] * r["_w"] for r in ev) if ev else 0
    else:  # draft prospect: readiness from first NBA season, heavily regressed
        first = [dict(r, _w=1.0) for r in rows[:1]]
        rt = rates(first)
        mins = first[0]["numMinutes"] * 0.6 if first else 0
    shrink = min(1.0, mins / 1400.0) ** 0.6 if mins else 0.0
    cur = ratings_from(rt, pos, height, age, shrink)
    # potential: retrospective peak (allowed to calibrate latent talent; never shown in scouting)
    peak_rt, peak_c = None, -1
    for r in rows:
        if r["numMinutes"] >= 500 and r["season"] >= (1976 if kind == "veteran" else 1977):
            rr = rates([dict(r, _w=1.0)]); c = composite(rr)
            if c > peak_c: peak_c, peak_rt = c, rr
    if peak_rt is not None:
        pk_age = None
        pot = ratings_from(peak_rt, pos, height, (age or 24) + 3, min(1.0, 0.85))
    else:
        pot = {k: v for k, v in cur.items()}
    ceil = {}
    for k in cur:
        if k == "hgt": continue
        base = max(cur[k], pot[k]) if (age or 30) < 29 else cur[k]
        # uncertainty: young players have a wider latent ceiling distribution
        sd = 6 if (age or 30) < 24 else 4 if (age or 30) < 28 else 2
        ceil[k] = {"mu": int(round(min(99, base + rng.gauss(0, 2)))), "sd": sd}
    ln = name.strip()
    person = dict(
        id=f"p{pid}" if pid else f"g{len(PEOPLE)}", nbaId=pid, name=ln, pos=pos, age=age,
        born=(pinfo.get(pid, {}).get("birthDate") or "")[:10] or None,
        hgt=height, wgt=int(float(pinfo[pid]["bodyWeightLbs"])) if pid and pinfo.get(pid, {}).get("bodyWeightLbs") else None,
        college=(pinfo.get(pid, {}).get("school") or None) if pid else None,
        team=team_abbr, rosterStatus=status, source=src, evidence="unverified",
        r=cur, ceil=ceil, ovr=round(overall(cur, pos)),
        traits={k: int(rng.gauss(50, 14)) for k in ["drive", "ambition", "ego", "loyalty", "discipline", "adapt", "patience", "social"]},
        traitsNote="In this universe: simulated personality, not a claim about the real person.",
        draft=draft, kind=kind, sampleMin=int(mins),
        draftYear=int(pinfo[pid]['draftYear']) if pid and pinfo.get(pid, {}).get('draftYear') not in (None, '') else None,
    )
    PEOPLE[pid if pid else person["id"]] = person
    return person

# ------------------------------------------------------------------ opening rosters
cand = list(csv.DictReader(open(BASE + "NBA_GM_Data_Audit_Implementation_Pack/opening_roster_candidates.csv")))
team_rows = defaultdict(list)
unmatched = []
for row in cand:
    t = TEAM_BY_NAME.get(row["team_raw"])
    if not t:
        print("NO TEAM", row["team_raw"]); continue
    abbr = t[3]
    pid = find_pid(row["name_raw"], abbr)
    if pid is None:
        unmatched.append((row["team_raw"], row["name_raw"]))
    team_rows[abbr].append((row, pid))

MAX_ROSTER = 12
rosters = {}
fa_pool = []
for abbr, rows in team_rows.items():
    def mins_with_team(pid):
        g = tot_by_pid.get(pid)
        if g is None: return 0
        r = g[(g.season == 1976)]
        return float(r.numMinutes.sum())
    pool = "PERSONNEL POOL" in rows[0][0]["source_status_raw"]
    rows_sorted = sorted(rows, key=lambda x: -mins_with_team(x[1]) if x[1] else 0) if pool or len(rows) > MAX_ROSTER else rows
    keep, cut = rows_sorted[:MAX_ROSTER], rows_sorted[MAX_ROSTER:]
    rosters[abbr] = []
    for row, pid in keep:
        p = make_player(pid, row["name_raw"].replace("“", "").replace("”", ""), row["position_raw"], abbr,
                        row["source_status_raw"].split("•")[-1].strip(), row["source"] + " " + row["source_locator"], row["age_reported_at_1976_10_21"])
        rosters[abbr].append(p["id"])
    for row, pid in cut:
        p = make_player(pid, row["name_raw"], row["position_raw"], None, "Camp cut (alpha roster limit)",
                        row["source"] + " " + row["source_locator"], row["age_reported_at_1976_10_21"])
        p["team"] = None
        fa_pool.append(p["id"])

# notable unsigned players & short-term FAs from the verification doc
FA_NAMES = [("Connie Hawkins","PF",34),("Donnie Freeman","SG",32),("Zaid Abdul-Aziz","C",30),("Bob Weiss","PG",34),("Billy Keller","SG",29),
            ("Rick Mount","SG",29),("Wali Jones","PG",34),("Clem Haskins","SG",33),("LaRue Martin","C",26),("John Roche","SG",27),
            ("Harthorne Wingo","PF",29),("Dean Meminger","PG",28),("Charlie Criss","PG",27),("Bobby Wilson","SG",25),
            ("Glenn McDonald","SF",24),("Jerome Anderson","SG",23),("Al Fleming","SF",22),("George Irvine","SF",28),("Gus Bailey","SG",25),
            ("Roger Brown","C",26),("Tom Kozelko","PF",25),("Connie Norman","SG",23),("Wilbur Holland","SG",24),("Goo Kennedy","SF",27),
            ("Dale Schlueter","C",30),("Corky Calhoun","SF",25)]
for nm, pos, ag in FA_NAMES:
    pid = find_pid(nm)
    if pid and (pid in PEOPLE): continue
    p = make_player(pid, nm, pos, None, "Unsigned at opening (doc: notable FA/cut)", "NBA_1976_77_Rosters_Verification_and_Data_Repair.docx", ag)
    fa_pool.append(p["id"])

# everyone else who played NBA minutes in 1976-77 but is not on an opening roster -> free agent pool
known = {p["nbaId"] for p in PEOPLE.values() if p["nbaId"]}
late = tot[(tot.season == 1976) & (~tot.personId.isin(known))]
for _, r in late.iterrows():
    pid = int(r.personId)
    if pid in known: continue
    nm = (r["first"] + " " + r["last"]).strip()
    p = make_player(pid, nm, None, None, "Not on opening roster; appeared later in real 1976-77", "PlayerStatistics.csv (season presence only)")
    fa_pool.append(p["id"])
    known.add(pid)

# ------------------------------------------------------------------ draft classes 1977-1980
draft_rows = [json.loads(l) for l in open(BASE + "NBA_GM_Data_Audit_Implementation_Pack/draft_selections_candidate.jsonl")]
draft_classes = {}
for yr in (1977, 1978, 1979, 1980):
    cls = []
    for d in draft_rows:
        if d["year"] != yr or not d["player_name_raw"].strip(): continue
        nm = d["player_name_raw"].strip()
        pid = find_pid(nm, None, yr)
        if pid and pid in PEOPLE:  # already in league (e.g. hardship / prior rights); skip duplicate
            continue
        # birth/age fallback: typical senior
        rk = int(d["pick_raw"]) if str(d["pick_raw"]).isdigit() else 999
        p = make_player(pid, nm, None, None, "Draft-eligible prospect", f"draft_selections_candidate.jsonl {yr} row {d['row_locator']}", 22,
                        draft=dict(year=yr, college=d["college_raw"] or None, realPick=rk, realTeam=d["team_raw"]), kind="prospect")
        if not p.get("college"): p["college"] = d["college_raw"] or None
        if p["age"] is None: p["age"] = 22
        if not seasons(pid):
            # never played in the NBA: low latent talent with a small chance of being better than his record
            lvl = rng.gauss(36, 5) + (6 if rk <= 20 else 0)
            for k in p["r"]:
                if k != "hgt": p["r"][k] = int(max(20, min(70, lvl + rng.gauss(0, 7))))
            for k in p["ceil"]:
                p["ceil"][k] = {"mu": int(min(75, p["r"][k] + abs(rng.gauss(4, 4)))), "sd": 6}
            p["ovr"] = round(overall(p["r"], p["pos"]))
        p["draftClass"] = yr
        cls.append(p["id"])
    draft_classes[yr] = cls

# ------------------------------------------------------------------ contracts (reconstructed, simulation only)
def recon_salary(p):
    o = p["ovr"]; a = p["age"] or 26
    base = math.exp(10.9 + 0.075 * (o - 45))  # ~$54k at 45, ~$190k at 62, ~$500k at 75
    base *= 0.9 if a < 23 else 1.0
    base *= rng.uniform(0.85, 1.15)
    return int(round(min(650000, max(30000, base)) / 5000) * 5000)
for p in PEOPLE.values():
    if p["team"]:
        yrs = rng.choice([1, 1, 2, 2, 3, 3, 4]) if (p["age"] or 26) < 31 else rng.choice([1, 1, 2])
        p["contract"] = dict(salary=recon_salary(p), years=yrs, known=None, provenance="RECONSTRUCTED — simulation only (model alpha-0.1)")
    else:
        p["contract"] = None
        p["ask"] = recon_salary(p)

# ------------------------------------------------------------------ coaches (simulated tendencies, In this universe)
COACH_STYLE = {
 # name: pace, post, motion, iso, pnr, pressure, depth, dev, experiment, tactics, development, communication, adaptability
 "Tom Heinsohn":(70,55,60,40,20,60,55,50,35,66,55,60,50), "Tates Locke":(55,55,45,55,20,55,50,50,40,52,50,50,48),
 "Red Holzman":(50,50,72,35,20,65,55,50,30,72,58,72,55), "Kevin Loughery":(62,40,50,60,25,55,50,50,45,58,50,55,52),
 "Gene Shue":(66,45,40,72,20,40,45,45,40,60,48,55,50), "Hubie Brown":(58,55,60,40,25,82,60,62,55,74,62,50,60),
 "Bill Fitch":(52,55,58,40,20,62,60,55,40,68,60,55,55), "Tom Nissalke":(55,62,50,50,20,55,50,55,40,60,55,52,50),
 "Butch van Breda Kolff":(50,45,62,55,20,52,45,45,40,58,48,45,45), "Doug Moe":(80,50,62,50,20,35,58,50,60,62,52,62,58),
 "Dick Motta":(52,62,68,35,20,62,55,55,40,70,58,52,52), "Ed Badger":(45,62,50,45,20,70,50,50,35,58,52,52,50),
 "Larry Brown":(75,50,62,45,30,70,62,72,60,74,72,60,66), "Herb Brown":(55,55,50,50,20,55,50,50,40,55,52,50,48),
 "Bob “Slick” Leonard":(72,45,55,55,20,60,55,50,45,62,52,58,52), "Phil Johnson":(55,55,55,45,20,60,55,55,40,62,56,58,52),
 "Larry Costello":(48,62,55,45,20,60,50,50,30,62,52,48,45), "Al Attles":(62,50,55,50,20,62,55,58,40,64,58,62,55),
 "Jerry West":(58,70,55,45,20,58,50,50,40,63,55,52,52), "John MacLeod":(60,55,62,45,20,60,58,60,45,66,60,60,56),
 "Jack Ramsay":(66,55,82,30,25,70,58,62,55,78,66,62,62), "Bill Russell":(55,60,55,45,20,65,50,48,40,60,50,45,50),
 "Lenny Wilkens":(58,50,62,45,25,60,55,58,45,66,58,64,60), "Joe Mullaney":(55,50,58,45,20,58,50,52,40,60,52,55,52),
 "Johnny Egan":(55,55,50,50,20,55,50,50,35,55,50,52,48), "Zelmo Beaty":(52,62,48,50,20,55,50,55,40,54,55,52,48),
 "Bill Musselman":(50,55,55,45,20,80,55,50,45,62,50,42,50),
}
coaches = []
for t in TEAMS:
    coaches.append(dict(name=t[10], team=t[3], role="Head coach"))
for nm in ["Lenny Wilkens", "Joe Mullaney", "Johnny Egan", "Zelmo Beaty", "Bill Musselman"]:
    coaches.append(dict(name=nm, team=None, role="Available"))
for c in coaches:
    s = COACH_STYLE[c["name"]]
    keys = ["pace", "post", "motion", "iso", "pnr", "pressure", "depth", "devFocus", "experiment", "tactics", "development", "communication", "adaptability"]
    c.update({k: v for k, v in zip(keys, s)})
    c["id"] = "c" + norm(c["name"]).replace(" ", "_")
    c["stubborn"] = int(rng.gauss(50, 12)); c["ego"] = int(rng.gauss(50, 12))
    c["note"] = "In this universe: coaching tendencies are simulated estimates, not historical claims."
    c["evidence"] = "reported (name/assignment) + simulated (tendencies)"

# ------------------------------------------------------------------ schedules from real dated schedules
g = pd.read_csv(BASE + "historical league data/Games.csv", low_memory=False)
g["d"] = pd.to_datetime(g.gameDateTimeEst, errors="coerce")
def sched(y0):
    s = g[(g.gameType == "Regular Season") & (g.d >= f"{y0}-09-01") & (g.d <= f"{y0+1}-05-31")].sort_values("d")
    out = []
    for _, r in s.iterrows():
        h, a = NICK_TO_ABBR.get(r.hometeamName), NICK_TO_ABBR.get(r.awayteamName)
        if y0 == 1977:  # 1977-78: Nets moved to New Jersey (same franchise)
            pass
        if not h or not a:
            continue
        out.append([r.d.strftime("%Y-%m-%d"), h, a])
    return out
schedule76 = sched(1976)
schedule77 = sched(1977)
print("schedule 76", len(schedule76), "77", len(schedule77))
cnt = defaultdict(int)
for d, h, a in schedule76: cnt[h] += 1; cnt[a] += 1
print("games per team 76", sorted(cnt.values())[:3], sorted(cnt.values())[-3:])

# ------------------------------------------------------------------ league calibration anchors (reference, not commands)
r76 = tot[tot.season == 1976]
team_games = 902 * 2
anchors = dict(
    season="1976-77", source="NBA_1976_77_Rosters_Verification_and_Data_Repair.docx §5 + PlayerStatistics.csv (unverified sums)",
    ppg=106.5, fgPct=0.465, rpg=47.1, pace=106.5,
    fga=float(r76.fieldGoalsAttempted.sum() / team_games), fta=float(r76.freeThrowsAttempted.sum() / team_games),
    ftPct=float(r76.freeThrowsMade.sum() / r76.freeThrowsAttempted.sum()), ast=float(r76.assists.sum() / team_games),
    oreb=float(r76.reboundsOffensive.sum() / team_games), dreb=float(r76.reboundsDefensive.sum() / team_games),
    stl=float(r76.steals.sum() / team_games), blk=float(r76.blocks.sum() / team_games), pf=float(r76.foulsPersonal.sum() / team_games),
    teamRecords={"LAL":(53,29),"PHI":(50,32),"DEN":(50,32),"HOU":(49,33),"POR":(49,33),"WSB":(48,34),"GSW":(46,36),"DET":(44,38),"BOS":(44,38),
                 "CHI":(44,38),"SAS":(44,38),"CLE":(43,39),"NYK":(40,42),"SEA":(40,42),"KCK":(40,42),"IND":(36,46),"NOJ":(35,47),"PHX":(34,48),
                 "ATL":(31,51),"BUF":(30,52),"MIL":(30,52),"NYN":(22,60)},
)
print(json.dumps({k: v for k, v in anchors.items() if k != "teamRecords"}, indent=0))

# ------------------------------------------------------------------ headshots available
hs = set(json.load(open("/tmp/headshot_ids.json")))
for p in PEOPLE.values():
    p["headshot"] = bool(p["nbaId"] and str(p["nbaId"]) in hs)

# ------------------------------------------------------------------ write
teams_out = [dict(id=t[3], nbaTeamId=t[0], city=t[1], name=t[2], abbr=t[3], conf=t[4], div=t[5], colors=[t[6], t[7], t[8]],
                  logo=t[9], coach="c" + norm(t[10]).replace(" ", "_"), gm=t[11], owner=t[12], roster=rosters.get(t[3], []),
                  evidence="reported (identity) / unverified (staff assignments)") for t in TEAMS]
players_out = list(PEOPLE.values())
json.dump(dict(version="alpha-0.1-data", built="2026-11-17", teams=teams_out, players=players_out, coaches=coaches,
               freeAgents=fa_pool, draftClasses={str(k): v for k, v in draft_classes.items()},
               schedules={"1976": schedule76, "1977": schedule77}, anchors=anchors,
               franchiseEvents=[dict(season=1977, team="NYN", type="relocation", city="New Jersey", name="Nets", abbr="NJN", logo="new-york-nets (1977-1978).png",
                                     evidence="reported; NY Nets became New Jersey Nets for 1977-78")],
               rules={"1976": dict(quarters=4, qMin=12, otMin=5, shotClock=24, three=False, foulOut=6, teamFoulBonus=4, rosterMax=12, rosterMin=8,
                                   evidence="VERIFIED: 22 teams, 82 games, 12-team playoffs, no 3PT. HIGH: 24s clock, 4x12, foul-out 6. UNRESOLVED (alpha assumption): bonus after 4 team fouls/quarter, 12-man roster."),
                      "1977": dict(quarters=4, qMin=12, otMin=5, shotClock=24, three=False, foulOut=6, teamFoulBonus=4, rosterMax=12, rosterMin=8, evidence="alpha assumption: unchanged")}),
          open(f"{OUT}/world1976.json", "w"), separators=(",", ":"))
print("players", len(players_out), "FA", len(fa_pool), "unmatched", unmatched)
for yr, c in draft_classes.items(): print("draft", yr, len(c))
top = sorted([p for p in players_out if p["team"]], key=lambda p: -p["ovr"])[:25]
for p in top: print(p["ovr"], p["name"], p["team"], p["pos"], p["age"], p["r"]["ins"], p["r"]["mid"], p["r"]["pass"], p["r"]["dreb"], p["sampleMin"])
