"""재합산 정확도 점검: 대선·지선 표를 22대 지역구로 다시 더한 결과가 얼마나 믿을 만한지 숫자로 남긴다.

1) 표 보존: 지역구로 나눠 더한 유효표 합 = 선관위 공식 합계(구시군 '합계' 줄의 합)인지
2) 배정 방식: 유효표 중 한 지역구에 그대로 들어간 표(exact) / 두 지역구에 걸친 동(split) /
   관외사전·거소·재외처럼 구시군 단위로만 나오는 표(town) / 짝 못 찾은 새 동(unknown) 비율
3) 구시군 단위 표를 나눌 때 생길 수 있는 오차(추정): 구시군 하나가 여러 지역구로 나뉜 곳에서만 생긴다.
   관외사전 등은 구시군 전체 격차 그대로 지역구에 나눠 담기므로, 실제로는 그 표도 동 표처럼 지역구마다
   (지역구 동 격차 − 구시군 동 격차)만큼 달랐을 것이라 보고 그 차이 × 그 표 비중을 오차로 잡는다.
   (22대 선거구는 동 하나가 두 지역구로 나뉜 곳이 없어 split 은 0)
결과 → web/data/accuracy.json (화면 안내문에 씀)
"""
import json, os, statistics as st
from collections import Counter

import build_outlook as bo


def load(name):
    return json.load(open(os.path.join(bo.RAW, name)))


def margin(v):
    return (v["D"] - v["R"]) / v["valid"] * 100


def main():
    out = {}
    p21_raw, l9_raw = load("nec_p21_precinct_raw.json"), load("nec_l9_partylist_raw.json")
    for eid, raw, prec in (("p21", p21_raw, True), ("l9", l9_raw, False)):
        s = Counter()
        acc, lost = bo.aggregate(raw, prec, s)
        summed = sum(v["valid"] for v in acc.values())
        off = s["official"]
        out[eid] = {"official": off, "summed": round(summed), "diff": round(summed - off),
                    "exact": round(s["exact"] / off * 100, 2), "split": round(s["split"] / off * 100, 2),
                    "town": round(s["town"] / off * 100, 2), "unknown": round(s["unknown"] / off * 100, 2),
                    "districts": len(acc)}
        print(eid, out[eid])

    # 3) 구시군 단위 표를 비율로 나눌 때의 오차 추정 (구시군 하나 = 지역구 여럿인 곳만)
    for eid, raw, prec in (("p21", p21_raw, True), ("l9", l9_raw, False)):
        err, tot = Counter(), Counter()
        for code, pages in raw.items():
            for page, rows in pages.items():
                one = {code: {page: rows}}
                full, _ = bo.aggregate(one, prec)
                if len(full) < 2:
                    continue
                bare, _ = bo.aggregate(one, prec, with_town=False)
                tb = sum(bare.values(), Counter())
                for k in full:
                    tv = full[k]["valid"] - bare[k]["valid"]           # 이 지역구에 나눠 담은 구시군 단위 표
                    err[k] += tv * (margin(bare[k]) - margin(tb))       # 그 표가 동 표처럼 달랐다면 생길 차이(표 수)
                    tot[k] += full[k]["valid"]
        ad = sorted(abs(err[k] / tot[k]) for k in tot)
        out[eid]["town_error"] = {"n": len(ad), "mean_abs": round(st.mean(ad), 2), "p90": round(ad[int(len(ad) * 0.9)], 2),
                                  "max": round(ad[-1], 2), "under_1": sum(x < 1 for x in ad)}
        print(eid, "구시군 단위 표 나누기 오차 추정(나뉜 구시군의 지역구만):", out[eid]["town_error"])
    json.dump(out, open(os.path.join(bo.OUT, "accuracy.json"), "w"), ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
