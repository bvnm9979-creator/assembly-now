"""판세 분석: 2024 총선 · 2025 대선 · 2026 지선(시·도지사)을 22대 지역구 단위로 맞춰 비교한다.

대선·지선은 국회의원 지역구별 결과가 없으므로
 1) 2024 총선 투표구별 표(raw/nec_22_precinct_raw.json)로 '어느 동이 어느 지역구인지' 짝을 만들고
 2) 대선(투표구별, raw/nec_p21_precinct_raw.json)·지선(읍면동별, raw/nec_l9_governor_raw.json)을 그 짝대로 더한다.
 - 두 지역구에 나뉜 동: 대선은 투표구 이름으로 나누고(관내사전은 투표구 득표 비율로),
   지선은 투표구가 없어 2024 선거인수 비율로 나눈다.
 - 구시군 단위로만 나오는 표(관외사전·거소·재외): 그 구시군 안 지역구별 동 득표 비율로 나눈다.
결과 → web/data/outlook.json
"""
import json, os, re, collections
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW, OUT = os.path.join(ROOT, "raw"), os.path.join(ROOT, "web", "data")
CITY = {"1100": "서울", "2600": "부산", "2700": "대구", "2800": "인천", "2900": "광주", "3000": "대전",
        "3100": "울산", "5100": "세종", "4100": "경기", "5200": "강원", "4300": "충북", "4400": "충남",
        "5300": "전북", "4600": "전남", "4700": "경북", "4800": "경남", "4900": "제주"}
TOWN_ROWS = {"거소·선상투표", "거소투표", "관외사전투표", "재외투표", "국외부재자투표", "잘못 투입·구분된 투표지"}
LEFT = ["더불어민주당", "진보당", "조국혁신당", "녹색정의당", "새진보연합"]   # 민주당이 후보를 안 낸 곳은 다음 순서로 대신

def num(s):
    return int(s.replace(",", "")) if s and s.strip() else 0

def base(town):
    """구시군 이름 → 짝 맞출 때 쓰는 기준 이름. '화성시을'·'화성시동탄구'·'수원시장안구' → '화성시'/'수원시'."""
    town = re.sub(r"[갑을병정무]$", "", town)
    m = re.match(r"^(.+?[시군])(.+구)?$", town)
    return m.group(1) if m else town

def dong_of(precinct):
    """투표구 이름 → [(동 이름, 비중)]. '중계2·3동'은 그 이름 그대로,
    '광명2동·광명1동'처럼 두 동이 한 투표구를 쓰면 각 동에도 나눠 적는다."""
    whole = re.sub(r"(제?\d+)?투(표소)?$", "", precinct)
    parts = [d for d in whole.split("·") if d.endswith(("동", "읍", "면", "가"))]
    return [(whole, 1)] + ([(d, 1 / len(parts)) for d in parts] if len(parts) > 1 else [])

def loose(dong):
    """동 이름이 나뉘거나 합쳐진 경우(금암1·2동→금암동, 유림동→유림1·2동) 비교용 이름."""
    return re.sub(r"제?\d+(가)?동$", "동", dong)

# 2026년 7월 인천 행정구역 개편: 새 구 → 2024년 옛 구
ALIAS = {("2800", "영종구"): ["중구"], ("2800", "제물포구"): ["중구", "동구"], ("2800", "검단구"): ["서구"]}

def scale(v, f):
    return Counter({k: x * f for k, x in v.items()})

def pick(cands, parties):
    for p in parties:
        for i, c in enumerate(cands):
            if c.split("|")[0] == p:
                return i
    return None

def rival(cands, votes):
    """민주 계열이 아닌 후보 가운데 가장 많이 받은 후보 번호(대부분 국민의힘, 2024 화성시을은 개혁신당)."""
    idx = [i for i, c in enumerate(cands) if c.split("|")[0] not in LEFT]
    return max(idx, key=lambda i: votes[i]) if idx else None

# ── 1) 2024 총선 투표구별: 동 → 지역구 ──────────────────────────────
dong_map = collections.defaultdict(Counter)   # (시도,기준,동) → {지역구: 선거인수}
loose_map = collections.defaultdict(Counter)  # (시도,기준,비교용 동) → {지역구: 선거인수}
prec_map = {}                                 # (시도,기준,투표구) → 지역구
town_sgg = collections.defaultdict(set)       # (시도,기준) → {지역구}
for code, pages in json.load(open(os.path.join(RAW, "nec_22_precinct_raw.json"))).items():
    for page, rows in pages.items():
        b, sgg = base(page.split("|")[1]), None
        for r in rows[2:]:
            if len(r) < 4:
                continue
            if r[0] and r[1] == "계":
                sgg = CITY[code] + " " + r[0]
                town_sgg[(code, b)].add(sgg)
            elif sgg and not r[0] and r[1] not in TOWN_ROWS | {"소계", "관내사전투표", "계"}:
                for d, w in dong_of(r[1]):
                    dong_map[(code, b, d)][sgg] += num(r[2]) * w
                    loose_map[(code, b, loose(d))][sgg] += num(r[2]) * w
                prec_map[(code, b, r[1])] = sgg

# ── 2) 대선·지선 표를 지역구별로 더하기 ───────────────────────────────
def aggregate(src, precinct_level):
    """{시도: {'코드|구시군': rows}} → ({지역구: Counter(D,R,valid)}, {짝 못 찾은 곳: 유효표})"""
    acc, lost = collections.defaultdict(Counter), Counter()
    for code, pages in src.items():
        for page, rows in pages.items():
            town = page.split("|")[1]
            b = base(town)
            cands = [c for c in rows[1] if c and c != "계"]
            n = len(cands)
            iD = pick(cands, LEFT)
            total = next(r for r in rows[2:] if r[0] == "합계")
            iR = rival(cands, [num(x) for x in total[4:4 + n]])   # 시도 전체에서 2위(대선 김문수, 지선 국민의힘 후보)

            def vec(r):
                return Counter({"D": num(r[4 + iD]) if iD is not None else 0,
                                "R": num(r[4 + iR]) if iR is not None else 0, "valid": num(r[4 + n])})
            bases = ALIAS.get((code, town), [b])
            sggs = set().union(*(town_sgg.get((code, x), set()) for x in bases))

            def find(dong):
                for x in bases:
                    if (code, x, dong) in dong_map:
                        return dong_map[(code, x, dong)]
                for x in bases:
                    if (code, x, loose(dong)) in loose_map:
                        return loose_map[(code, x, loose(dong))]
                if len(sggs) == 1:                             # 구시군 전체가 한 지역구
                    return {next(iter(sggs)): 1}
                return None
            local = collections.defaultdict(Counter)   # 이 구시군 안 지역구별 동 득표
            town_rows, unknown = Counter(), Counter()
            split = None                               # 지금 읽는 '나뉜 동': [동 전체, {지역구: 투표구 합}]

            def close_split():
                whole, parts = split
                rest = whole - sum(parts.values(), Counter())          # 관내사전 등 투표구에 없는 표
                pv = sum(v["valid"] for v in parts.values()) or 1
                for s, v in parts.items():
                    local[s] += v + scale(rest, v["valid"] / pv)

            for r in rows[2:]:
                if len(r) < 5 + n or r[0] == "합계":
                    continue
                if r[0] in TOWN_ROWS:
                    town_rows += vec(r)
                elif r[0] and r[1] == "계":                            # 동 합계 줄
                    if split:
                        close_split(); split = None
                    m = find(r[0])
                    if not m:                                          # 새로 생긴 동: 아래에서 구시군 비율로 나눔
                        lost[f"{CITY[code]} {town} {r[0]}"] += vec(r)["valid"]
                        unknown += vec(r)
                    elif precinct_level and len(m) > 1:
                        split = [vec(r), collections.defaultdict(Counter)]
                    else:
                        tot = sum(m.values()) or 1
                        for s, w in m.items():
                            local[s] += scale(vec(r), w / tot)
                elif split and not r[0] and r[1] != "관내사전투표":     # 나뉜 동의 투표구 줄
                    s = next((prec_map[(code, x, r[1])] for x in bases if (code, x, r[1]) in prec_map), None)
                    if s:
                        split[1][s] += vec(r)
            if split:
                close_split()
            tv = sum(v["valid"] for v in local.values()) or 1
            for s, v in local.items():
                acc[s] += v + scale(town_rows + unknown, v["valid"] / tv)
    return acc, lost

p21, lost_p = aggregate(json.load(open(os.path.join(RAW, "nec_p21_precinct_raw.json"))), True)
l9, lost_l = aggregate(json.load(open(os.path.join(RAW, "nec_l9_governor_raw.json"))), False)

# ── 3) 2024 총선은 공식 지역구 결과 그대로, 세 선거 비교 ──────────────────
res = json.load(open(os.path.join(OUT, "results.json")))
g = next(e for e in res["elections"] if e["id"] == "g22")["district"]

def grade(m):
    if m >= 10: return "우세"
    if m >= 5: return "경합우세"
    if m > -5: return "경합"
    if m > -10: return "경합열세"
    return "열세"

out = {}
for k in sorted(g):
    c = g[k]["cands"]
    parties = [x["party"] + "|" for x in c]
    di, ri = pick(parties, LEFT), rival(parties, [x["votes"] for x in c])
    e24 = Counter({"D": c[di]["votes"] if di is not None else 0,
                   "R": c[ri]["votes"] if ri is not None else 0, "valid": g[k]["valid"]})
    row = {}
    for eid, e in (("g22", e24), ("p21", p21.get(k)), ("l9", l9.get(k))):
        row[eid] = {"d": round(e["D"] / e["valid"] * 100, 1), "r": round(e["R"] / e["valid"] * 100, 1),
                    "m": round((e["D"] - e["R"]) / e["valid"] * 100, 1)} if e and e["valid"] else None
    notes = []
    if di is not None and c[di]["party"] != "더불어민주당":
        notes.append(f"민주당 무공천 — {c[di]['party']} {c[di]['name']} 기준")
    if ri is not None and c[ri]["party"] != "국민의힘":
        notes.append(f"상대 후보 {c[ri]['party']} {c[ri]['name']}")
    if notes:
        row["g22"]["note"] = " · ".join(notes)
    if di is None:                                   # 세종갑(민주당 공천 취소)·대구 서구·의성청송영덕울진: 민주 계열 후보 없음
        why = "(공천 취소)" if k == "세종 세종특별자치시갑" else ""
        row["g22"] = {"none": f"민주 계열 후보 없음{why} — 평균에서 제외"}
    ms = [row[x]["m"] for x in ("g22", "p21", "l9") if row[x] and "m" in row[x]]
    avg = round(sum(ms) / len(ms), 1)
    out[k] = dict(row, avg=avg, grade=grade(avg),
                  trend=round(row["l9"]["m"] - row["g22"]["m"], 1) if row["l9"] and "m" in row["g22"] else None)

json.dump({"source": "중앙선거관리위원회 선거통계시스템 투표구·읍면동별 개표결과를 22대 지역구로 다시 합산",
           "elections": [{"id": "g22", "name": "2024 총선", "desc": "지역구 후보"},
                         {"id": "p21", "name": "2025 대선", "desc": "이재명 · 김문수"},
                         {"id": "l9", "name": "2026 지선", "desc": "시·도지사 후보"}],
           "rule": "세 선거의 '민주 득표율 − 상대(국민의힘 등) 최다 득표 후보 득표율' 평균 · +10%p 이상 우세 · +5~10 경합우세 · ±5 안 경합 · −5~−10 경합열세 · −10 이하 열세",
           "district": out},
          open(os.path.join(OUT, "outlook.json"), "w"), ensure_ascii=False, separators=(",", ":"))

# ── 확인 ─────────────────────────────────────────────────────────────
for name, acc, lost in (("대선", p21, lost_p), ("지선", l9, lost_l)):
    tot, lv = sum(v["valid"] for v in acc.values()), sum(lost.values())
    print(f"{name}: 지역구 {len([k for k in g if k in acc])}/{len(g)}곳, 지도에 없는 이름 {sorted(set(acc) - set(g))[:5]},",
          f"유효표 {tot:,.0f}, 동 짝 못 찾아 구시군 비율로 나눈 표 {lv:,} ({lv / (tot + lv) * 100:.2f}%)")
    for k, v in lost.most_common(10):
        print("   못 찾음:", k, f"{v:,}")
print(Counter(v["grade"] for v in out.values()))
