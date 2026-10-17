"""민주당 흐름: 2016~2026년 선거 9개를 지금(22대) 지역구 254곳으로 다시 더해, 지역구마다
'전국 평균보다 민주 계열이 얼마나 더 받았나(상대 성향)'가 커지는지·줄어드는지 본다.

선거 종류별로 세 번씩 (후보 개인 인기가 덜 섞이도록 총선·지선은 비례 정당 투표):
 - 총선 비례: 2016 · 2020 · 2024      (투표구별, build_outlook.party_table 로 바꿔 합산)
 - 대선:      2017 · 2022 · 2025      (투표구별)
 - 지선 광역비례: 2018 · 2022 · 2026  (읍면동별)
격차 = (민주 계열 − 보수 1당) / 유효표. 보수 쪽은 정당을 고정 — 2016·2017 호남은 국민의당이 1위였지만 비교 상대는 새누리·자유한국당.
상대 성향 = 그 선거 지역구 격차 − 254곳 단순 평균 (build_outlook 판세와 같은 방식)

흐름 = 양당 구도 6개 선거(2020~2026)로 지역구마다 '격차 = a + b × 전국 평균 격차 + c × 연도' 를 맞춘 c × 6 (2020→2026 6년 변화).
 - 상대 성향을 그냥 빼면 이미 80~90%인 호남은 전국 분위기가 좋아질 때 '덜 올라' 떨어지는 것처럼 보인다(천장).
   b(전국 분위기 1%p에 이 지역 몇 %p 움직이나)를 따로 두어 그 몫을 뺀다.
 - 2016~2018은 국민의당 3당 구도라(호남 격차가 작게 나옴) 흐름 계산엔 안 쓰고 표로만 보여 준다.
 - 6개로 3개 값을 맞추므로 흔들림이 크다 → t ≥ 2.35(자유도 3, 한쪽 95%)만 '뚜렷'
결과 → web/data/trend.json
"""
import json, os, statistics as st

import numpy as np

import build_outlook as bo
import backtest as bt

bo.ALIAS[("2800", "남구")] = ["미추홀구"]      # 인천 남구 → 2018.7 미추홀구 (2016·2017·2018 자료)
FIT = ("g21", "g22", "p20", "p21", "l8", "l9")
T_SIG = 2.35
STEP = 3.0      # 두 방식 모두 6년간 3%p 넘게 같은 방향이면 좋아짐·나빠짐

load = lambda f: json.load(open(os.path.join(bo.RAW, f)))
# 지선 비례의 민주 계열 = 2024 총선 비례(더불어민주연합 = 민주·진보·기본소득·사민 + 조국혁신당)와 같은 묶음.
# 더불어민주당만 세면 2026 조국혁신당이 후보를 안 낸 부산·대구·경북은 오르고, 12~15% 받은 호남은 내려가는 착시가 생김
DBLOC = ["더불어민주당", "조국혁신당", "진보당", "기본소득당", "사회민주당"]
# (id, 종류, 연도, 이름, 원자료, 투표구별?, 비례 표?, 민주 계열, 보수 1당)
ELECTIONS = [
    ("g20", "총선", 2016, "2016 총선 비례", "nec_g20_partylist_raw.json", True, True, ["더불어민주당"], ["새누리당"]),
    ("g21", "총선", 2020, "2020 총선 비례", "nec_g21_partylist_raw.json", True, True, ["더불어시민당", "열린민주당"], ["미래한국당"]),
    ("g22", "총선", 2024, "2024 총선 비례", "nec_g22_partylist_raw.json", True, True, ["더불어민주연합", "조국혁신당"], ["국민의미래"]),
    ("p19", "대선", 2017, "2017 대선", "nec_p19_precinct_raw.json", True, False, ["더불어민주당"], ["자유한국당"]),
    ("p20", "대선", 2022, "2022 대선", "nec_p20_precinct_raw.json", True, False, ["더불어민주당"], ["국민의힘"]),
    ("p21", "대선", 2025, "2025 대선", "nec_p21_precinct_raw.json", True, False, ["더불어민주당"], ["국민의힘"]),
    ("l7", "지선", 2018, "2018 지선 비례", "nec_l7_partylist_raw.json", False, False, ["더불어민주당"], ["자유한국당"]),
    ("l8", "지선", 2022, "2022 지선 비례", "nec_l8_partylist_raw.json", False, False, DBLOC, ["국민의힘"]),
    ("l9", "지선", 2026, "2026 지선 비례", "nec_l9_partylist_raw.json", False, False, DBLOC, ["국민의힘"]),
]
KINDS = {"총선": ("g20", "g21", "g22"), "대선": ("p19", "p20", "p21"), "지선": ("l7", "l8", "l9")}


def main():
    g = next(e for e in json.load(open(os.path.join(bo.OUT, "results.json")))["elections"] if e["id"] == "g22")["district"]
    # 두 가지 격차로 따로 계산: share = 전체 유효표 대비, two = 민주 계열 + 보수 1당 두 쪽 표만
    # (호남처럼 보수 표가 아주 적은 곳은 작은 정당 표가 어디로 가느냐에 따라 두 방식이 반대로 나옴 → 둘이 같은 방향일 때만 좋아짐·나빠짐)
    rel = {"share": {}, "two": {}}
    nat = {"share": {}, "two": {}}
    lost_share = {}
    for eid, _, _, name, f, prec, party, d, r in ELECTIONS:
        src = bt.remap(load(f))
        if party:
            src = bo.party_table(src)
        acc, lost = bo.aggregate(src, prec, d_parties=d, r_parties=r)
        for how in rel:
            m = {k: (v["D"] - v["R"]) / (v["valid"] if how == "share" else v["D"] + v["R"]) * 100
                 for k, v in acc.items() if k in g and v["valid"]}
            nat[how][eid] = st.mean(m.values())
            rel[how][eid] = {k: x - nat[how][eid] for k, x in m.items()}
        tot = sum(v["valid"] for v in acc.values())
        lost_share[eid] = sum(lost.values()) / (tot + sum(lost.values())) * 100
        print(f"{name}: 전국 평균 격차 {nat['share'][eid]:+.1f} · 동 짝 못 찾은 표 {lost_share[eid]:.2f}%")

    year = {e[0]: e[2] for e in ELECTIONS}

    def fit(how, k):
        X = np.array([[1, nat[how][e], year[e] - 2023] for e in FIT])
        XtXi = np.linalg.inv(X.T @ X)
        y = np.array([rel[how][e][k] + nat[how][e] for e in FIT])
        c = XtXi @ X.T @ y
        res = y - X @ c
        se = float(np.sqrt(res @ res / (len(FIT) - 3) * XtXi[2, 2]))
        return float(c[2]) * 6, float(c[1]), (float(c[2]) / se if se else 0)

    out = {}
    for k in sorted(g):
        (ca, ea, ta), (cb, _, tb) = fit("share", k), fit("two", k)
        same = (ca > 0) == (cb > 0)
        sig = same and abs(ta) >= T_SIG and abs(tb) >= T_SIG
        big = same and min(abs(ca), abs(cb)) >= STEP
        cls = ("확실히 좋아짐" if ca > 0 else "확실히 나빠짐") if sig else ("좋아짐" if ca > 0 else "나빠짐") if big else "그대로"
        out[k] = {"rel": {e: round(rel["share"][e][k], 1) for e in rel["share"] if k in rel["share"][e]},
                  "chg": round((ca + cb) / 2, 1), "a": round(ca, 1), "b": round(cb, 1), "el": round(ea, 2),
                  "sig": sig, "cls": cls}

    json.dump({"source": "중앙선거관리위원회 선거통계시스템 투표구·읍면동별 개표결과를 22대 지역구로 다시 합산",
               "elections": [{"id": e[0], "kind": e[1], "year": e[2], "name": e[3]} for e in ELECTIONS],
               "fit": FIT, "national": {e: round(v, 1) for e, v in nat["share"].items()},
               "lost": {e: round(v, 2) for e, v in lost_share.items()},
               "rule": "흐름 = 2020~2026 선거 6개로 '지역구 격차 = a + b × 전국 평균 격차 + c × 연도'를 맞춘 c × 6년, 격차 두 방식(전체 표 대비·두 쪽 표만) 평균 · 두 방식이 같은 방향으로 ±3%p 이상이면 좋아짐·나빠짐, 둘 다 t ≥ 2.35면 확실히",
               "district": out},
              open(os.path.join(bo.OUT, "trend.json"), "w"), ensure_ascii=False, separators=(",", ":"))

    from collections import Counter
    print(Counter(v["cls"] for v in out.values()))
    for c in ("확실히 나빠짐", "확실히 좋아짐"):
        print(c, [(k, v["chg"]) for k, v in sorted(out.items(), key=lambda x: x[1]["chg"]) if v["cls"] == c])


if __name__ == "__main__":
    main()
