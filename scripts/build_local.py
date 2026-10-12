"""우리 지역 단체장: 2026.6.3 제9회 지방선거 구청장·시장·군수(기초단체장)·시도지사 결과를 지역구에 붙인다.

판세 계산에는 쓰지 않는다(후보 인물 효과가 섞여 정확도가 떨어짐 — 판세는 광역비례 정당표).
지역구 화면에서 '그 지역 단체장이 어느 당인지·몇 % 받았는지·투표율'을 참고로 보여주는 용도.

 - 기초단체장: raw/nec_l9_mayor_raw.json (선관위 최근선거 VCCP09_#4 개표진행상황, electionCode 4, 시도별)
 - 시도지사: raw/nec_l9_governor_raw.json 합계 줄
 - 정당표 비교: raw/nec_l9_partylist_raw.json 합계 줄(더불어민주당 광역비례 득표율) → 단체장 후보가 정당보다 더/덜 받은 정도
 - 지역구 ↔ 구시군: build_outlook.aggregate 를 구시군 하나씩 돌려, 지역구 표가 어느 구시군에서 얼마나 왔는지 비율
결과 → web/data/local.json
"""
import json, os, re, collections
from collections import Counter
import build_outlook as bo

RAW, OUT, num = bo.RAW, bo.OUT, bo.num
D_PARTY = "더불어민주당"
# 무투표 당선(후보 1명, 개표 없음) — 선관위 최근선거 '무투표당선인 명부' EPEI02_#4
NOCONTEST = {("2900", "서구"): "김이강", ("2900", "남구"): "김병내", ("4100", "시흥시"): "임병택"}


def mname_of(town):
    """'수원시장안구' → '수원시' (일반구는 시장 선거), 나머지는 그대로"""
    return bo.base(town) if re.match(r"^.+?시.+구$", town) else town


def mayors():
    """{시도코드: {선거구명: {cands, electors, turnout, invalid}}}
    선거구 머리줄(이름·후보·'계') 다음 줄들 가운데 '소계'(일반구 있는 시)나 첫 숫자 줄이 합계"""
    out = {}
    for code, rows in json.load(open(os.path.join(RAW, "nec_l9_mayor_raw.json"))).items():
        res, head, tot = {}, None, None

        def close():
            if not head:
                return
            end = head.index("계")
            cands = [(k, c) for k, c in enumerate(head[4:end]) if c and c != "|"]
            valid = num(tot[end])
            cs = [{"party": c.split("|")[0], "name": c.split("|")[1], "votes": num(tot[4 + k]),
                   "pct": round(num(tot[4 + k]) / valid * 100, 2)} for k, c in cands]
            res[head[0]] = {"cands": sorted(cs, key=lambda c: -c["votes"]), "electors": num(tot[2]),
                            "turnout": num(tot[3]), "invalid": num(tot[end + 1])}

        for r in (rows or [])[2:]:
            if r[0] and "계" in r:
                close(); head, tot = r, None
            elif head and r[1] and num(r[2]) and (tot is None or r[1] == "소계"):
                tot = r
        close()
        out[code] = res
    return out


def totals(src):
    """{시도코드: {구시군: {cands, votes, valid, electors, turnout}}} — 합계 줄"""
    out = collections.defaultdict(dict)
    for code, pages in src.items():
        for page, rows in pages.items():
            cands = [c for c in rows[1] if c and c != "계"]
            tot = next(r for r in rows[2:] if r[0] == "합계")
            n = len(cands)
            out[code][page.split("|")[1]] = {"cands": cands, "votes": [num(x) for x in tot[4:4 + n]],
                                            "valid": num(tot[4 + n]), "electors": num(tot[2]), "turnout": num(tot[3])}
    return out


def office(code, mname):
    return mname + ("청장" if mname.endswith("구") else "수" if mname.endswith("군") else "장")


GOV_TITLE = {"서울": "서울시장", "부산": "부산시장", "대구": "대구시장", "인천": "인천시장", "대전": "대전시장",
             "울산": "울산시장", "세종": "세종시장", "경기": "경기지사", "강원": "강원지사", "충북": "충북지사",
             "충남": "충남지사", "전북": "전북지사", "경북": "경북지사", "경남": "경남지사", "제주": "제주지사",
             "광주": "전남광주통합특별시장", "전남": "전남광주통합특별시장"}


def main():
    gov_raw = json.load(open(os.path.join(RAW, "nec_l9_governor_raw.json")))
    pl = totals(json.load(open(os.path.join(RAW, "nec_l9_partylist_raw.json"))))
    gv = totals(gov_raw)
    my = mayors()

    # 1) 지역구 ↔ 구시군: 구시군 하나씩 지역구로 나눠 더해 본 유효표
    link = collections.defaultdict(Counter)    # 지역구 → {(시도, 선거구명): 유효표}
    town_valid = Counter()
    for code, pages in gov_raw.items():
        for page, rows in pages.items():
            key = (code, mname_of(page.split("|")[1]))
            acc, _ = bo.aggregate({code: {page: rows}}, False)
            for sgg, v in acc.items():
                link[sgg][key] += v["valid"]
                town_valid[key] += v["valid"]

    # 2) 구시군별 더불어민주당 광역비례 득표율
    party, pvalid = Counter(), Counter()
    for code, ts in pl.items():
        for town, t in ts.items():
            key = (code, mname_of(town))
            if D_PARTY in t["cands"]:
                party[key] += t["votes"][t["cands"].index(D_PARTY)]
            pvalid[key] += t["valid"]

    # 3) 시도지사 (시도 전체)
    governor = {}
    if [c for c in next(iter(gv["2900"].values()))["cands"]] == next(iter(gv["4600"].values()))["cands"]:
        gv["2900"] = gv["4600"] = {**gv["2900"], **gv["4600"]}   # 전남광주통합특별시장 — 한 선거
    for code, ts in gv.items():
        cands = next(iter(ts.values()))["cands"]
        valid = sum(t["valid"] for t in ts.values())
        cs = [{"party": c.split("|")[0], "name": c.split("|")[1], "votes": sum(t["votes"][i] for t in ts.values())}
              for i, c in enumerate(cands)]
        for c in cs:
            c["pct"] = round(c["votes"] / valid * 100, 2)
        governor[bo.CITY[code]] = {"title": GOV_TITLE[bo.CITY[code]], "cands": sorted(cs, key=lambda c: -c["votes"])[:3],
                                   "electors": sum(t["electors"] for t in ts.values()),
                                   "turnout": sum(t["turnout"] for t in ts.values())}

    # 4) 기초단체장 (세종·제주는 기초단체 없음)
    mayor, missing = {}, []
    for key in town_valid:
        code, mname = key
        r = my.get(code, {}).get(mname)
        if not r and key in NOCONTEST:
            r = {"cands": [{"party": D_PARTY, "name": NOCONTEST[key]}], "nocontest": True}
        if not r:
            if code not in ("5100", "4900"):
                missing.append(f"{bo.CITY[code]} {mname}")
            continue
        d = next((c for c in r["cands"] if c["party"] == D_PARTY), None)
        mayor[f"{bo.CITY[code]} {mname}"] = {**r, "office": office(code, mname),
                                             "dparty": round(party[key] / pvalid[key] * 100, 2) if pvalid[key] else None,
                                             "dcand": d.get("pct") if d else None}

    # 5) 지역구 → [{t: 구시군, share: 지역구 표 중 이 구시군 %, cover: 이 구시군 표 중 이 지역구 %}]
    district = {}
    for sgg, c in link.items():
        tv = sum(c.values()) or 1
        district[sgg] = [{"t": f"{bo.CITY[code]} {mname}", "share": round(v / tv * 100, 1),
                          "cover": round(v / town_valid[(code, mname)] * 100, 1)}
                         for (code, mname), v in c.most_common() if v / tv >= 0.01]

    out = {"election": {"name": "2026 지방선거", "date": "2026.6.3", "desc": "제9회 전국동시지방선거"},
           "governor": governor, "mayor": mayor, "district": district}
    json.dump(out, open(os.path.join(OUT, "local.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    print("기초단체장", len(mayor), "지역구", len(district), "결과 없음", missing)
    print("당선 정당", Counter(m["cands"][0]["party"] for m in mayor.values()))


if __name__ == "__main__":
    main()
