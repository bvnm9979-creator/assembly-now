"""판세 기준 검증: 2024 총선 '이전' 선거만으로 지금과 같은 방법으로 등급을 매긴 뒤, 실제 2024 총선 결과와 맞춰 본다.

- 2020 총선(21대): 선관위가 투표구별 후보 득표를 주지 않아(선거구가 둘 이상인 구는 후보 칸이 빠짐)
  21대와 22대 선거구 경계가 사실상 같은 곳만 21대 선거구 결과를 그대로 쓴다.
- 2022 대선(20대, 투표구별)·2022 지선(8회 시·도지사, 읍면동별): build_outlook.aggregate 로 22대 지역구에 다시 합산
- 결과 → data/backtest.json (공개 안 함), 요약은 화면에 출력
"""
import json, os
from collections import Counter, defaultdict

import build_outlook as bo

RAW = bo.RAW
CODE_NOW = {"4200": "5200", "4500": "5300"}     # 2022년 강원도·전라북도 → 지금 특별자치도 코드
LEFT_2020 = ["더불어민주당", "열린민주당", "민중당", "정의당"]
SKIP = bo.TOWN_ROWS | {"소계", "관내사전투표", "계"}


def num(s):
    return bo.num(s) if s else 0


def code_of(code, page):
    """2022 시도 코드를 지금 코드로, 경북 군위군(2023.7 대구 편입)은 대구로"""
    return "2700" if page.endswith("|군위군") else CODE_NOW.get(code, code)


def remap(src):
    out = defaultdict(dict)
    for code, pages in src.items():
        for page, rows in pages.items():
            out[code_of(code, page)][page] = rows
    return dict(out)


def g21_districts(dist_raw):
    """VCCP09 선거구별 표 → {'서울 종로구': Counter(D, R, valid)}. 선거구 머리줄(이름+후보) 뒤에 구시군 줄이 이어진다."""
    sums, cands = defaultdict(Counter), {}
    for code, rows in dist_raw.items():
        c, cur = CODE_NOW.get(code, code), None
        for r in rows or []:
            if len(r) > 4 and r[0] and "|" in r[4]:          # 후보 칸은 표 전체 폭으로 고정, 빈 칸 뒤에 '계'
                cur = bo.CITY[c] + " " + r[0]
                width = r[4:].index("계")
                cands[cur] = (r[4:4 + width], width)
            elif cur and len(r) > 4 and not r[0] and r[1] and r[2]:
                names, width = cands[cur]
                for i in range(width):
                    sums[cur][i] += num(r[4 + i])
                sums[cur]["valid"] += num(r[4 + width])
    out = {}
    for k, (cs, width) in cands.items():
        votes = [sums[k][i] for i in range(width)]
        iD, iR = bo.pick(cs, LEFT_2020), bo.rival(cs, votes)
        if iD is not None and sums[k]["valid"]:
            out[k] = (votes[iD] - (votes[iR] if iR is not None else 0)) / sums[k]["valid"] * 100
    return out


def g21_match(prec_raw):
    """22대 선거구 → 경계가 사실상 같은 21대 선거구. 투표구 선거인수가 양쪽으로 95% 이상 겹치면 같다고 본다."""
    flow = defaultdict(Counter)       # 21대 → {22대: 선거인수}
    for code, pages in prec_raw.items():
        for page, rows in pages.items():
            c, b, sgg = code_of(code, page), bo.base(page.split("|")[1]), None
            for r in rows:
                if len(r) < 3:
                    continue
                if r[0] and r[1] == "계":
                    sgg = bo.CITY[c] + " " + r[0]
                elif sgg and not r[0] and r[1] not in SKIP and not r[1].startswith("국외"):
                    s22 = bo.prec_map.get((c, b, r[1]))
                    if not s22:
                        for d, _ in bo.dong_of(r[1]):
                            m = bo.dong_map.get((c, b, d)) or bo.loose_map.get((c, b, bo.loose(d)))
                            if m and len(m) == 1:
                                s22 = next(iter(m))
                                break
                    flow[sgg][s22 or "?"] += num(r[2])
    back = defaultdict(Counter)
    for a, m in flow.items():
        for s, v in m.items():
            if s != "?":
                back[s][a] += v
    same = {}
    for s, m in back.items():
        a, va = m.most_common(1)[0]
        known_a = sum(v for k, v in flow[a].items() if k != "?")
        if va / sum(m.values()) >= 0.95 and flow[a][s] / known_a >= 0.95:
            same[s] = a
    return same


def main():
    p20, _ = bo.aggregate(remap(json.load(open(os.path.join(RAW, "nec_p20_precinct_raw.json")))), True)
    l8, _ = bo.aggregate(remap(json.load(open(os.path.join(RAW, "nec_l8_governor_raw.json")))), False)
    g21 = g21_districts(json.load(open(os.path.join(RAW, "nec_g21_district_raw.json"))))
    same = g21_match(json.load(open(os.path.join(RAW, "nec_g21_precinct_raw.json"))))

    res = json.load(open(os.path.join(bo.OUT, "results.json")))
    g = next(e for e in res["elections"] if e["id"] == "g22")["district"]
    out = {}
    for k in sorted(g):
        c = g[k]["cands"]
        win = max(c, key=lambda x: x["votes"])
        parties = [x["party"] + "|" for x in c]
        di, ri = bo.pick(parties, bo.LEFT), bo.rival(parties, [x["votes"] for x in c])
        actual = ((c[di]["votes"] if di is not None else 0) - (c[ri]["votes"] if ri is not None else 0)) / g[k]["valid"] * 100
        ms = {}
        if k in same and same[k] in g21:
            ms["g21"] = g21[same[k]]
        for eid, acc in (("p20", p20), ("l8", l8)):
            e = acc.get(k)
            if e and e["valid"]:
                ms[eid] = (e["D"] - e["R"]) / e["valid"] * 100
        avg = round(sum(ms.values()) / len(ms), 1)
        out[k] = {"pred": avg, "grade": bo.grade(avg), "parts": {x: round(v, 1) for x, v in ms.items()},
                  "g21_from": same.get(k), "actual": round(actual, 1), "won": win["party"] in bo.LEFT,
                  "winner": f"{win['party']} {win['name']}"}
    json.dump(out, open(os.path.join(bo.ROOT, "data", "backtest.json"), "w"), ensure_ascii=False, indent=1)

    # ── 요약 ──
    print(f"2020 총선 결과를 쓴 곳(경계 같음) {sum('g21' in v['parts'] for v in out.values())}/{len(out)}곳")
    for gname in ["우세", "경합우세", "경합", "경합열세", "열세"]:
        xs = [v for v in out.values() if v["grade"] == gname]
        if xs:
            w = sum(v["won"] for v in xs)
            print(f"{gname:5} {len(xs):3}곳 → 실제 민주 계열 승리 {w:3}곳 ({w / len(xs) * 100:5.1f}%)")
    err = [v["actual"] - v["pred"] for v in out.values()]
    print(f"평균 차이(실제−예측) {sum(err) / len(err):+.1f}%p, 평균 절대 오차 {sum(map(abs, err)) / len(err):.1f}%p")
    for shift in (0, 3, 5, 8):
        right = sum((v["pred"] + shift > 0) == v["won"] for v in out.values())
        print(f"  전국 분위기 +{shift}%p 보정 시 승패 적중 {right}/{len(out)} ({right / len(out) * 100:.1f}%)")


if __name__ == "__main__":
    main()
