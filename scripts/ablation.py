"""어떤 선거를 성향 계산에 넣어야 하나: 총선·대선·지선 조합별로 과거 세 총선(2016·2020·2024, 시간 순) 적중을 비교한다.
결과 → web/data/ablation.json (화면 '왜 세 선거를 쓰나' 표)
"""
import json, math, os, statistics as st

import build_outlook as bo
import calibrate as cb
import backtest3 as b3

COMBOS = [("총선 + 대선 + 지방선거", "gpl"), ("대선 빼고", "gl"), ("총선 빼고", "pl"), ("지방선거 빼고", "gp")]


def score(parts, actual, ids, keys):
    """keys: 'g'(총선)·'p'(대선)·'l'(지선) 중 쓸 것 → (적중, 곳 수, 로그 손실)"""
    use = tuple(i for i in ids if i[0] in keys)
    sub = {k: {e: v for e, v in p.items() if e in use} for k, p in parts.items()}
    rows, _, _ = cb.predict(sub, actual, use)
    hit = sum((x > 0) == w for x, _, w, *_ in rows)
    ll = -st.mean(math.log(max(1e-9, bo.win_prob(x) if w else 1 - bo.win_prob(x))) for x, _, w, *_ in rows)
    return hit, len(rows), round(ll, 3)


def main():
    years = {}
    years["2024"] = (cb.first_parts(), cb.IDS1)          # 22대 짝(기본) — 반드시 먼저
    years["2020"] = (cb.second_parts(), cb.IDS2)         # 21대 짝으로 바꿈
    years["2016"] = (b3.parts_2016(), ("g19", "p18", "l6"))   # 20대 짝으로 바꿈
    out = {"years": ["2016", "2020", "2024"], "rows": []}
    for name, keys in COMBOS:
        r = {"name": name}
        for y in out["years"]:
            (parts, actual), ids = years[y]
            r[y] = score(parts, actual, ids, keys)
        out["rows"].append(r)
        print(f"{name:14} " + " · ".join(f"{y} {r[y][0]}/{r[y][1]} ({r[y][0] / r[y][1] * 100:.1f}%) 손실 {r[y][2]}" for y in out["years"]))
    json.dump(out, open(os.path.join(bo.OUT, "ablation.json"), "w"), ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
