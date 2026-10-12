"""총선 비례대표 정당 투표를 지역구 성향 계산에 더하면 과거 두 총선 적중이 오르는지 비교 (2026.10.13 검증 → 안 넣음)

자료: raw/nec_g20_partylist_raw.json(2016)·nec_g21_partylist_raw.json(2020)·nec_g22_partylist_raw.json(2024)
  선관위 역대선거 VCCP08_#1 electionType 2 electionCode 7 투표구별 — build_outlook.party_table 로 대선 표 모양으로 바꿔 합산
결과 → web/data/partylist_test.json (화면 안내문 '검증했지만 넣지 않은 것')
"""
import json, math, os, statistics as st
from collections import defaultdict
import build_outlook as bo, backtest as bt, backtest2 as bt2, calibrate as cb
load = bt2.load

def margins(acc):
    return {k: (v["D"] - v["R"]) / v["valid"] * 100 for k, v in acc.items() if v["valid"]}

def run(rows_parts, actual, ids):
    nat = {e: st.mean(p[e] for p in rows_parts.values() if e in p) for e in ids}
    env = st.mean(a for a, _ in actual.values())
    out = []
    for k, (a, w) in actual.items():
        p = {e: v for e, v in rows_parts.get(k, {}).items() if e in ids}
        if p:
            out.append((st.mean(v - nat[e] for e, v in p.items()) + env, a, w))
    return out

RESULT = {}


def score(name, r, key=None):
    P = lambda x: cb.phi(x / (5 if x < 0 else 7.5))
    hit = sum((x > 0) == w for x, _, w in r)
    ll = -st.mean(math.log(max(1e-9, P(x) if w else 1 - P(x))) for x, _, w in r)
    sd = st.pstdev([a - x for x, a, _ in r])
    print(f"  {name:28} 적중 {hit}/{len(r)} ({hit/len(r)*100:.1f}%) · 로그손실 {ll:.4f} · 오차 흩어짐 {sd:.2f}")
    if key:
        RESULT[key] = [hit, len(r)]

# 1차: 기존 parts 다시 만들기 (calibrate.first 와 같은 재료) + 2020 비례
r1, _, _ = cb.first()
p20, _ = bo.aggregate(bt.remap(load("nec_p20_precinct_raw.json")), True)
l8, _ = bo.aggregate(bt.remap(load("nec_l8_partylist_raw.json")), False)
g21 = bt.g21_districts(load("nec_g21_district_raw.json"))
same = bt.g21_match(load("nec_g21_precinct_raw.json"))
src20 = bo.party_table(bt.remap(load("nec_g21_partylist_raw.json")))
prA = margins(bo.aggregate(src20, True, d_parties=["더불어시민당"])[0])
prB = margins(bo.aggregate(src20, True, d_parties=["더불어시민당", "열린민주당"])[0])
g = next(e for e in json.load(open(os.path.join(bo.OUT, "results.json")))["elections"] if e["id"] == "g22")["district"]
parts, actual = defaultdict(dict), {}
for k in g:
    c = g[k]["cands"]; ps = [x["party"] + "|" for x in c]
    di, ri = bo.pick(ps, bo.LEFT), bo.rival(ps, [x["votes"] for x in c])
    if di is None: continue
    actual[k] = ((c[di]["votes"] - (c[ri]["votes"] if ri is not None else 0)) / g[k]["valid"] * 100, max(c, key=lambda x: x["votes"])["party"] in bo.LEFT)
    if k in same and same[k] in g21: parts[k]["g"] = g21[same[k]]
    for e, m in (("p", margins(p20)), ("l", margins(l8)), ("prA", prA), ("prB", prB)):
        if k in m: parts[k][e] = m[k]
print("1차 → 2024 총선")
for name, ids, key in (("지금(총선·대선·지선)", ("g", "p", "l"), "now2024"), ("+비례 민주만", ("g", "p", "l", "prA"), "add2024"),
                       ("+비례 민주 계열 합", ("g", "p", "l", "prB"), None),
                       ("총선 지역구→비례(민주만)", ("prA", "p", "l"), None), ("총선 지역구→비례(계열 합)", ("prB", "p", "l"), None)):
    score(name, run(parts, actual, ids), key)

# 2차
bt2.use_21_maps(load("nec_g21_precinct_raw.json"))
p19, _ = bo.aggregate(load("nec_p19_precinct_raw.json"), True)
l7, _ = bo.aggregate(load("nec_l7_partylist_raw.json"), False)
g20 = bt2.districts(load("nec_g20_district_raw.json"))
same2 = bt2.match(load("nec_g20_precinct_raw.json"))
act = bt2.districts(load("nec_g21_district_raw.json"))
src16 = bo.party_table(load("nec_g20_partylist_raw.json"))
pr16 = margins(bo.aggregate(src16, True, d_parties=["더불어민주당"])[0])
parts2, actual2 = defaultdict(dict), {}
for k, a in act.items():
    if a["m"] is None: continue
    actual2[k] = (a["m"], a["won"])
    if k in same2 and g20.get(same2[k], {}).get("m") is not None: parts2[k]["g"] = g20[same2[k]]["m"]
    for e, m in (("p", margins(p19)), ("l", margins(l7)), ("prA", pr16)):
        if k in m: parts2[k][e] = m[k]
print("2차 → 2020 총선")
for name, ids, key in (("지금(총선·대선·지선)", ("g", "p", "l"), "now2020"), ("+비례", ("g", "p", "l", "prA"), "add2020"),
                       ("총선 지역구→비례", ("prA", "p", "l"), None)):
    score(name, run(parts2, actual2, ids), key)
json.dump(RESULT, open(os.path.join(bo.OUT, "partylist_test.json"), "w"), separators=(",", ":"))
print(RESULT)
