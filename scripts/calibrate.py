"""승리 확률·등급 경계 보정: 지금 판세 방식(성향 + 전국 분위기, 지선은 광역비례 정당 투표)으로
1차(2020 총선·2022 대선·2022 지선 → 2024 총선)·2차(2016·2017·2018 → 2020 총선) 예측을 다시 만들고,
승패 결과로 '민주 계열 승리 확률 = Φ(예상 격차 / σ)'의 σ를 정한다. 민주 불리 쪽(예상 격차 < 0)과
유리 쪽의 σ를 따로 둔다 — 불리 쪽은 예상보다 더 크게 지는 일이 많아 흩어짐이 작다(2024·2020 검증 503곳).
등급은 이 확률로 나눈다: 우세 90%↑ · 경합우세 70~90 · 경합 30~70 · 경합열세 10~30 · 열세 10%↓ (build_outlook.grade)
전국 분위기는 그해 실제 값을 넣는다(화면 막대도 '이 분위기라면'을 묻는 방식이라 같은 조건).

결과 → web/data/calibration.json · 실행 순서 주의: 2차는 build_outlook 짝을 21대로 바꿔 끼우므로 1차 뒤에 돈다.
"""
import json, math, os, random, statistics as st
from collections import defaultdict

import build_outlook as bo
import backtest as bt
import backtest2 as bt2

IDS1, IDS2 = ("g21", "p20", "l8"), ("g20", "p19", "l7")
load = bt2.load


def phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def predict(parts, actual, ids):
    """parts {지역구: {선거: 격차}}, actual {지역구: (실제 격차, 민주 계열 승리)} → [(예상 격차, 실제 격차, 승리, 지역구)]"""
    nat = {e: st.mean(p[e] for p in parts.values() if e in p) for e in ids}
    env = st.mean(a for a, _ in actual.values())
    out = []
    for k, (a, won) in actual.items():
        p = parts.get(k)
        if p:
            out.append((st.mean(v - nat[e] for e, v in p.items()) + env, a, won, k, st.mean(p.values())))
    return out, env, nat


def first_parts():
    """2024 총선 예측 재료: ({지역구: {선거: 격차}}, {지역구: (실제 격차, 민주 계열 승리)})"""
    p20, _ = bo.aggregate(bt.remap(load("nec_p20_precinct_raw.json")), True)
    l8, _ = bo.aggregate(bt.remap(load("nec_l8_partylist_raw.json")), False)
    g21 = bt.g21_districts(load("nec_g21_district_raw.json"))
    same = bt.g21_match(load("nec_g21_precinct_raw.json"))
    g = next(e for e in json.load(open(os.path.join(bo.OUT, "results.json")))["elections"] if e["id"] == "g22")["district"]
    parts, actual = defaultdict(dict), {}
    for k in g:
        c = g[k]["cands"]
        ps = [x["party"] + "|" for x in c]
        di, ri = bo.pick(ps, bo.LEFT), bo.rival(ps, [x["votes"] for x in c])
        if di is None:                                   # 민주 계열 후보 없는 곳은 맞출 대상이 아님
            continue
        actual[k] = ((c[di]["votes"] - (c[ri]["votes"] if ri is not None else 0)) / g[k]["valid"] * 100,
                     max(c, key=lambda x: x["votes"])["party"] in bo.LEFT)
        if k in same and same[k] in g21:
            parts[k]["g21"] = g21[same[k]]
        for eid, acc in (("p20", p20), ("l8", l8)):
            e = acc.get(k)
            if e and e["valid"]:
                parts[k][eid] = (e["D"] - e["R"]) / e["valid"] * 100
    return parts, actual


def first():
    return predict(*first_parts(), IDS1)


def second_parts():
    """2020 총선 예측 재료 (build_outlook 짝을 21대로 바꿔 끼우므로 2024 뒤에 부를 것)"""
    bt2.use_21_maps(load("nec_g21_precinct_raw.json"))
    p19, _ = bo.aggregate(load("nec_p19_precinct_raw.json"), True)
    l7, _ = bo.aggregate(load("nec_l7_partylist_raw.json"), False)
    g20 = bt2.districts(load("nec_g20_district_raw.json"))
    same = bt2.match(load("nec_g20_precinct_raw.json"))
    act = bt2.districts(load("nec_g21_district_raw.json"))
    parts, actual = defaultdict(dict), {}
    for k, a in act.items():
        if a["m"] is None:
            continue
        actual[k] = (a["m"], a["won"])
        if k in same and g20.get(same[k], {}).get("m") is not None:
            parts[k]["g20"] = g20[same[k]]["m"]
        for eid, acc in (("p19", p19), ("l7", l7)):
            e = acc.get(k)
            if e and e["valid"]:
                parts[k][eid] = (e["D"] - e["R"]) / e["valid"] * 100
    return parts, actual


def second():
    return predict(*second_parts(), IDS2)


def incumbents_2024(r1):
    """2024 지역구 → 2020 당선자가 다시 나왔으면 그 사람 정당 쪽(민주 계열 1, 그 외 −1), 안 나왔으면 0, 경계 다르면 None"""
    same = bt.g21_match(load("nec_g21_precinct_raw.json"))
    w20 = bt2.districts(load("nec_g21_district_raw.json"))
    g = next(e for e in json.load(open(os.path.join(bo.OUT, "results.json")))["elections"] if e["id"] == "g22")["district"]
    out = {}
    for *_, k, _ in r1:
        s = same.get(k)
        if not s or s not in w20:
            out[k] = None; continue
        name = w20[s]["winner"].split("|")[1]
        c = next((c for c in g[k]["cands"] if c["name"] == name), None)
        out[k] = 0 if not c else 1 if c["party"] in bo.LEFT else -1
    return out


def incumbents_2020(r2):
    """2020 지역구 → 2016 당선자가 다시 나왔으면 그 사람 정당 쪽 (second() 뒤에 불러야 함: 21대 짝 사용)"""
    same = bt2.match(load("nec_g20_precinct_raw.json"))
    w16 = bt2.districts(load("nec_g20_district_raw.json"))
    cands = {}
    for code, rows in load("nec_g21_district_raw.json").items():
        for r in rows or []:
            if len(r) > 4 and r[0] and "|" in r[4]:
                cands[bt2.CITY[code] + " " + r[0]] = [c for c in r[4:4 + r[4:].index("계")] if c]
    out = {}
    for *_, k, _ in r2:
        s = same.get(k)
        if not s or s not in w16:
            out[k] = None; continue
        name = w16[s]["winner"].split("|")[1]
        c = next((c for c in cands.get(k, []) if c.split("|")[1] == name), None)
        out[k] = 0 if not c else 1 if c.split("|")[0] in bt2.LEFT else -1
    return out


def seats(r, prob, n=4000, seed=1):
    """권역 흔들림(SIGMA_REGION) + 지역구 확률로 의석 모의실험 → (평균, 80% 범위 아래, 위)"""
    rnd = random.Random(seed)
    regs = sorted(set(bo.REGION.values()))
    sims = []
    for _ in range(n):
        sh = {g: rnd.gauss(0, bo.SIGMA_REGION) for g in regs}
        sims.append(sum(rnd.random() < prob(x + sh[bo.REGION[k.split()[0]]]) for x, _, _, k, _ in r))
    sims.sort()
    return round(st.mean(sims), 1), sims[int(n * 0.1)], sims[int(n * 0.9)]


def main():
    r1, env1, nat1 = first()
    inc1 = incumbents_2024(r1)
    r2, env2, nat2 = second()
    inc2 = incumbents_2020(r2)
    rows = r1 + r2
    res = [a - x for x, a, *_ in rows]
    for name, r in (("1차(2024)", r1), ("2차(2020)", r2), ("합계", rows)):
        e = [a - x for x, a, *_ in r]
        right = sum((x > 0) == w for x, _, w, *_ in r)
        print(f"{name}: {len(r)}곳 · 승패 적중 {right / len(r) * 100:.1f}% · 치우침 {st.mean(e):+.2f} · 흩어짐 σ {st.pstdev(e):.2f}")
    print(f"전국 분위기(실제): 2024 {env1:+.1f} (사전 세 선거 평균 {st.mean(nat1.values()):+.1f}) · "
          f"2020 {env2:+.1f} (사전 {st.mean(nat2.values()):+.1f})")

    # σ: 양쪽 따로, 승패를 가장 잘 맞히는 값(로그 손실 최소)
    sd = st.pstdev(res)

    def fit(side):
        def loss(s):
            return -sum(math.log(max(1e-9, phi(x / s) if w else 1 - phi(x / s))) for x, _, w, *_ in rows if side(x))
        return min((s / 10 for s in range(10, 200)), key=loss)
    sigma = (fit(lambda x: x < 0), fit(lambda x: x >= 0))
    print(f"오차 흩어짐 {sd:.2f} · 승리 확률 σ: 불리 쪽 {sigma[0]} · 유리 쪽 {sigma[1]} (build_outlook.SIGMA 와 같아야 함: {bo.SIGMA})")

    def prob(x):
        return phi(x / (sigma[0] if x < 0 else sigma[1]))

    bins = [(0, 10), (10, 30), (30, 50), (50, 70), (70, 90), (90, 101)]
    cal = []
    print("\n확률 구간별 실제 민주 계열 승률")
    for lo, hi in bins:
        xs = [(prob(x) * 100, w) for x, _, w, *_ in rows if lo <= prob(x) * 100 < hi]
        if xs:
            c = {"bin": f"{lo}~{min(hi, 100)}%", "n": len(xs), "pred": round(st.mean(p for p, _ in xs), 1),
                 "won": round(sum(w for _, w in xs) / len(xs) * 100, 1)}
            cal.append(c)
            print(f"  {c['bin']:>8}: {c['n']:3}곳 · 예상 평균 {c['pred']:5.1f}% · 실제 {c['won']:5.1f}%")

    def by_grade(gr):
        g = defaultdict(list)
        for x, _, w, *_ in rows:
            g[gr(x)].append(w)
        return {n: [len(g[n]), sum(g[n]), round(sum(g[n]) / len(g[n]) * 100, 1)] for n in order if g[n]}

    def old(x):
        return "우세" if x >= 10 else "경합우세" if x >= 5 else "경합" if x > -5 else "경합열세" if x > -10 else "열세"
    order = ["우세", "경합우세", "경합", "경합열세", "열세"]
    grades, before = by_grade(bo.grade), by_grade(old)
    for name, r in (("예전 ±5/±10", before), ("확률 기준", grades)):
        print(f"  {name}: " + " · ".join(f"{n} {v[0]}곳 승 {v[1]} ({v[2]}%)" for n, v in r.items()))
    def right(r, shift=0, simple=False):
        return sum(((avg if simple else x) + shift > 0) == w for x, _, w, _, avg in r)
    hit = {"n2024": len(r1), "n2020": len(r2), "r2024": right(r1), "r2020": right(r2),
           "simple2024": round(right(r1, simple=True) / len(r1) * 100), "simple2020": round(right(r2, simple=True) / len(r2) * 100),
           "env_err3": sorted(round(right(r, sh) / len(r) * 100) for r in (r1, r2) for sh in (-3, 3))}
    hit["env_err3"] = [hit["env_err3"][0], hit["env_err3"][-1]]
    print("적중", hit)

    # 예상 의석 검증: 그해 실제 전국 분위기를 넣었을 때 민주 계열 지역구 의석
    seat = {}
    for y, r in (("2024", r1), ("2020", r2)):
        m, lo, hi = seats(r, prob)
        seat[y] = {"mean": m, "lo": lo, "hi": hi, "actual": sum(w for _, _, w, *_ in r), "n": len(r)}
    print("의석", seat)

    # 현역 효과: 이전 당선자가 다시 나온 곳의 오차(실제 − 예상) 평균, 현역 없는 곳과 비교
    inc = {}
    for y, r, ic in (("2024", r1, inc1), ("2020", r2, inc2)):
        e = defaultdict(list)
        for x, a, _, k, _ in r:
            e[ic.get(k)].append(a - x)
        open_ = st.mean(e[0])
        inc[y] = {"D": round(st.mean(e[1]) - open_, 1), "R": round(-(st.mean(e[-1]) - open_), 1),
                  "nD": len(e[1]), "nR": len(e[-1]), "nOpen": len(e[0])}
    print("현역 효과(현역 없는 곳 대비, +면 그 현역 쪽에 유리)", inc)

    json.dump({"sigma": sigma, "sd": round(sd, 2), "n": len(rows), "calibration": cal, "hit": hit,
               "grades": grades, "grades_old": before, "seats": seat, "incumbent": inc, "sigma_region": bo.SIGMA_REGION},
              open(os.path.join(bo.OUT, "calibration.json"), "w"), ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
