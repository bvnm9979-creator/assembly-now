"""판세 기준 2차 검증: 2016 총선(20대)·2017 대선(19대)·2018 지선(7회 시·도지사)만으로 2020 총선(21대 선거구 253곳)을 예측해 맞춰 본다.

1차 검증(backtest.py, 2024 예측)과 같은 방식:
- 대선·지선은 투표구·읍면동 결과를 21대 선거구로 다시 더함 (build_outlook.aggregate 를 21대 짝으로 바꿔 씀)
- 2016 총선은 20대·21대 경계가 사실상 같은 곳만 그대로 씀
- 지역구 성향 = 선거마다 (지역구 격차 − 전국 평균 격차)의 평균, 예상 격차 = 성향 + 전국 분위기
결과 → data/backtest2.json (공개 안 함)
"""
import json, os, statistics as st
from collections import Counter, defaultdict

import build_outlook as bo
import backtest as bt

RAW = bo.RAW
CITY = dict(bo.CITY, **{"4200": "강원", "4500": "전북"})      # 2016~2020년 시도 코드
LEFT = ["더불어민주당", "정의당", "민중당", "열린민주당"]
SKIP = bt.SKIP


def load(name):
    return json.load(open(os.path.join(RAW, name)))


def use_21_maps(prec_raw):
    """build_outlook 의 동→선거구 짝을 21대(2020 총선 투표구) 기준으로 바꿔 끼운다."""
    dong_map, loose_map, prec_map, town_sgg = (defaultdict(Counter), defaultdict(Counter), {}, defaultdict(set))
    for code, pages in prec_raw.items():
        for page, rows in pages.items():
            b, sgg = bo.base(page.split("|")[1]), None
            for r in rows[2:]:
                if len(r) < 4:
                    continue
                if r[0] and r[1] == "계":
                    sgg = CITY[code] + " " + r[0]
                    town_sgg[(code, b)].add(sgg)
                elif sgg and not r[0] and r[1] not in SKIP and not r[1].startswith("국외"):
                    for d, w in bo.dong_of(r[1]):
                        dong_map[(code, b, d)][sgg] += bo.num(r[2]) * w
                        loose_map[(code, b, bo.loose(d))][sgg] += bo.num(r[2]) * w
                    prec_map[(code, b, r[1])] = sgg
    bo.dong_map, bo.loose_map, bo.prec_map, bo.town_sgg = dong_map, loose_map, prec_map, town_sgg
    bo.CITY = CITY
    bo.ALIAS = {}


def districts(dist_raw):
    """VCCP09 선거구별 표 → {선거구: {m: 민주−상대1위 격차, won: 민주 계열 당선}}"""
    sums, cands = defaultdict(Counter), {}
    for code, rows in dist_raw.items():
        cur = None
        for r in rows or []:
            if len(r) > 4 and r[0] and "|" in r[4]:
                cur = CITY[code] + " " + r[0]
                width = r[4:].index("계")
                cands[cur] = (r[4:4 + width], width)
            elif cur and len(r) > 4 and not r[0] and r[1] and r[2]:
                names, width = cands[cur]
                for i in range(width):
                    sums[cur][i] += bt.num(r[4 + i])
                sums[cur]["valid"] += bt.num(r[4 + width])
    out = {}
    for k, (cs, width) in cands.items():
        votes = [sums[k][i] for i in range(width)]
        iD, iR = bo.pick(cs, LEFT), bo.rival(cs, votes)
        top = cs[max(range(width), key=lambda i: votes[i])]
        out[k] = {"m": (votes[iD] - (votes[iR] if iR is not None else 0)) / sums[k]["valid"] * 100 if iD is not None else None,
                  "won": top.split("|")[0] in LEFT, "winner": top}
    return out


def match(prec_raw):
    """21대 선거구 → 경계가 사실상 같은 20대 선거구 (투표구 선거인수가 양쪽으로 95% 이상 겹침)"""
    flow = defaultdict(Counter)
    for code, pages in prec_raw.items():
        for page, rows in pages.items():
            b, sgg = bo.base(page.split("|")[1]), None
            for r in rows:
                if len(r) < 3:
                    continue
                if r[0] and r[1] == "계":
                    sgg = CITY[code] + " " + r[0]
                elif sgg and not r[0] and r[1] not in SKIP and not r[1].startswith("국외"):
                    s = bo.prec_map.get((code, b, r[1]))
                    if not s:
                        for d, _ in bo.dong_of(r[1]):
                            m = bo.dong_map.get((code, b, d)) or bo.loose_map.get((code, b, bo.loose(d)))
                            if m and len(m) == 1:
                                s = next(iter(m))
                                break
                    flow[sgg][s or "?"] += bt.num(r[2])
    back = defaultdict(Counter)
    for a, m in flow.items():
        for s, v in m.items():
            if s != "?":
                back[s][a] += v
    same = {}
    for s, m in back.items():
        a, va = m.most_common(1)[0]
        known = sum(v for k, v in flow[a].items() if k != "?")
        if va / sum(m.values()) >= 0.95 and flow[a][s] / known >= 0.95:
            same[s] = a
    return same


def margins(acc):
    return {k: (v["D"] - v["R"]) / v["valid"] * 100 for k, v in acc.items() if v["valid"]}


def report(name, out):
    print(f"\n[{name}]")
    for g in ["우세", "경합우세", "경합", "경합열세", "열세"]:
        xs = [v for v in out.values() if v["grade"] == g]
        if xs:
            w = sum(v["won"] for v in xs)
            print(f"  {g:5} {len(xs):3}곳 → 민주 계열 승리 {w:3}곳 ({w / len(xs) * 100:5.1f}%)")
    err = [v["actual"] - v["exp"] for v in out.values()]
    right = sum((v["exp"] > 0) == v["won"] for v in out.values())
    print(f"  승패 적중 {right}/{len(out)} ({right / len(out) * 100:.1f}%) · 치우침 {st.mean(err):+.1f} · 오차 흩어짐 {st.pstdev(err):.1f}")


def main():
    g21p = load("nec_g21_precinct_raw.json")
    use_21_maps(g21p)
    p19, _ = bo.aggregate(load("nec_p19_precinct_raw.json"), True)
    l7, _ = bo.aggregate(load("nec_l7_governor_raw.json"), False)
    g20 = districts(load("nec_g20_district_raw.json"))
    same = match(load("nec_g20_precinct_raw.json"))
    actual = districts(load("nec_g21_district_raw.json"))

    parts = defaultdict(dict)
    for k in actual:
        if k in same and g20.get(same[k], {}).get("m") is not None:
            parts[k]["g20"] = g20[same[k]]["m"]
    for eid, acc in (("p19", margins(p19)), ("l7", margins(l7))):
        for k in actual:
            if k in acc:
                parts[k][eid] = acc[k]
    nat = {e: st.mean(p[e] for p in parts.values() if e in p) for e in ("g20", "p19", "l7")}
    env_actual = st.mean(v["m"] for v in actual.values() if v["m"] is not None)
    print(f"21대 선거구 {len(actual)}곳 · 2016 총선 결과를 쓴 곳(경계 같음) {sum('g20' in p for p in parts.values())}곳 · "
          f"대선 합산 {sum('p19' in p for p in parts.values())}곳 · 지선 합산 {sum('l7' in p for p in parts.values())}곳")
    print("전국 평균 격차: 2016 총선 %+.1f · 2017 대선 %+.1f · 2018 지선 %+.1f → 2020 총선 실제 %+.1f" % (nat["g20"], nat["p19"], nat["l7"], env_actual))

    def run(env, use_lean=True):
        out = {}
        for k, a in actual.items():
            p = parts[k]
            if not p:
                continue
            lean = st.mean(v - nat[e] for e, v in p.items())
            exp = lean + env if use_lean else st.mean(p.values())
            out[k] = {"exp": round(exp, 1), "lean": round(lean, 1), "grade": bo.grade(exp), "parts": {e: round(v, 1) for e, v in p.items()},
                      "actual": round(a["m"], 1) if a["m"] is not None else -100.0, "won": a["won"], "winner": a["winner"]}
        return out

    main_out = run(env_actual)
    report(f"지금 방식 · 전국 분위기 = 2020 실제 {env_actual:+.1f}", main_out)
    report(f"전국 분위기를 3%p 낮게({env_actual - 3:+.1f})", run(env_actual - 3))
    report(f"전국 분위기를 3%p 높게({env_actual + 3:+.1f})", run(env_actual + 3))
    report("성향 없이 세 선거 단순 평균(예전 방식)", run(0, use_lean=False))
    json.dump(main_out, open(os.path.join(bo.ROOT, "data", "backtest2.json"), "w"), ensure_ascii=False, indent=1)

    print("\n빗나간 곳")
    for k, v in sorted(main_out.items(), key=lambda x: x[1]["exp"]):
        if (v["exp"] > 0) != v["won"]:
            print(f"  {k:24} 예상 {v['exp']:+6.1f} {v['grade']:4} 실제 {v['actual']:+6.1f} {v['winner']}  {v['parts']}")


if __name__ == "__main__":
    main()
