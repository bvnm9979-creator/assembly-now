"""판세 기준 3차 검증: 2012 총선(19대)·2012 대선(18대)·2014 지선(6회 광역비례 정당 투표)만으로 2016 총선(20대 선거구 253곳)을 맞춰 본다.

승리 확률 공식(σ 불리 5.0·유리 7.5)은 2020·2024 두 총선으로만 정했으므로, 2016은 공식을 만들 때 안 쓴 '처음 보는' 선거로 시험하는 셈.
- 동→선거구 짝: 2016 총선 투표구 표(raw/nec_g20_precinct_raw.json) — backtest2.use_21_maps 를 20대 표로 불러 씀
- 2012 대선 투표구 표는 읍면동 칸이 없어(비례 표와 같은 모양) build_outlook.party_table 로 바꿔 합산
- 2012 총선은 19대·20대 경계가 사실상 같은 곳만(투표구 선거인수 95% 이상 겹침)
- 2016 실제 결과에서 국민의당은 민주 계열로 치지 않음 → 호남에서 크게 빗나감(그래서 호남 뺀 결과도 함께 봄)
자료(선관위 역대선거): nec_g19_district_raw(VCCP09_#2)·nec_g19_precinct_raw·nec_p18_precinct_raw(VCCP08_#1)·nec_l6_partylist_raw(VCCP04_#2 electionCode 8)
결과 → data/backtest3.json (공개 안 함 — 사이트 반영은 사용자 결정 뒤)
"""
import json, os
from collections import defaultdict

import build_outlook as bo
import backtest2 as bt2
import calibrate as cb

load = bt2.load
LEFT12 = ["민주통합당", "통합진보당", "진보신당"]
LEFT16 = ["더불어민주당", "정의당", "민중연합당"]
HONAM = ("광주", "전북", "전남")


def margins(acc):
    return {k: (v["D"] - v["R"]) / v["valid"] * 100 for k, v in acc.items() if v["valid"]}


def main():
    bt2.use_21_maps(load("nec_g20_precinct_raw.json"))          # 이름은 21이지만 넣는 표대로 짝을 만듦 → 20대 선거구
    p18 = margins(bo.aggregate(bo.party_table(load("nec_p18_precinct_raw.json")), True, d_parties=["민주통합당"])[0])
    l6 = margins(bo.aggregate(load("nec_l6_partylist_raw.json"), False, d_parties=["새정치민주연합"])[0])
    bt2.LEFT = LEFT12
    g19 = bt2.districts(load("nec_g19_district_raw.json"))
    same = bt2.match(load("nec_g19_precinct_raw.json"))
    bt2.LEFT = LEFT16
    act = bt2.districts(load("nec_g20_district_raw.json"))

    parts, actual = defaultdict(dict), {}
    for k, a in act.items():
        if a["m"] is None:
            continue
        actual[k] = (a["m"], a["won"])
        if k in same and g19.get(same[k], {}).get("m") is not None:
            parts[k]["g19"] = g19[same[k]]["m"]
        for e, m in (("p18", p18), ("l6", l6)):
            if k in m:
                parts[k][e] = m[k]
    rows, env, nat = cb.predict(parts, actual, ("g19", "p18", "l6"))
    print(f"20대 선거구 {len(act)}곳 · 대조 {len(rows)}곳 · 2012 총선 경계 같은 곳 {sum('g19' in p for p in parts.values())} · "
          f"대선 합산 {sum('p18' in p for p in parts.values())} · 지선 합산 {sum('l6' in p for p in parts.values())}")
    print("전국 평균 격차: 2012 총선 %+.1f · 2012 대선 %+.1f · 2014 지선 %+.1f → 2016 실제 %+.1f" % (nat["g19"], nat["p18"], nat["l6"], env))

    def summary(rs):
        hit = sum((x > 0) == w for x, _, w, *_ in rs)
        g = defaultdict(list)
        for x, _, w, *_ in rs:
            g[bo.grade(x)].append(w)
        return {"n": len(rs), "hit": hit, "pct": round(hit / len(rs) * 100, 1),
                "grades": {n: [len(g[n]), sum(g[n])] for n in ("우세", "경합우세", "경합", "경합열세", "열세") if g[n]},
                "simple": round(sum((avg > 0) == w for _, _, w, _, avg in rs) / len(rs) * 100, 1)}
    allr, noh = summary(rows), summary([r for r in rows if r[3].split()[0] not in HONAM])
    m, lo, hi = cb.seats(rows, bo.win_prob)
    seat = {"mean": m, "lo": lo, "hi": hi, "actual": sum(w for _, _, w, *_ in rows)}
    for name, s in (("전체", allr), ("호남 빼고", noh)):
        print(f"[{name}] 적중 {s['hit']}/{s['n']} ({s['pct']}%) · 단순 평균 {s['simple']}% · 등급별 " +
              " · ".join(f"{g} {v[0]}곳 승 {v[1]}" for g, v in s["grades"].items()))
    print("의석", seat)
    miss = sorted((r for r in rows if (r[0] > 0) != r[2]), key=lambda r: r[0])
    print("빗나간 곳:", ", ".join(f"{r[3]}({r[0]:+.0f})" for r in miss))
    json.dump({"all": allr, "no_honam": noh, "seats": seat, "nat": {k: round(v, 1) for k, v in nat.items()}, "env": round(env, 1),
               "miss_honam": sum(1 for r in miss if r[3].split()[0] in HONAM), "miss": len(miss)},
              open(os.path.join(bo.ROOT, "data", "backtest3.json"), "w"), ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
