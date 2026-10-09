"""raw/nec_22_district_raw.json(선관위 선거통계시스템 '개표현황' 표, 시도별) →
web/data/results.json: 22대 총선(2024.4.10) 지역구별 후보 득표.
지역구 이름(예: '경기 수원시갑')으로 지도와 연결한다."""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw")
OUT = os.path.join(ROOT, "web", "data")

CITY = {"1100": "서울", "2600": "부산", "2700": "대구", "2800": "인천", "2900": "광주", "3000": "대전",
        "3100": "울산", "5100": "세종", "4100": "경기", "5200": "강원", "4300": "충북", "4400": "충남",
        "5300": "전북", "4600": "전남", "4700": "경북", "4800": "경남", "4900": "제주"}

def num(s):
    return int(s.replace(",", "")) if s else 0

def parse(rows):
    """한 시도 표 → {지역구명: 결과}. 표 모양:
    [지역구명, '', '', '', '정당|이름', ..., '계', '', '']   ← 후보 머리줄
    ['', 구시군(또는 '소계'), 선거인수, 투표수, 득표..., 계, 무효, 기권]
    ['', '', '', '', 득표율...]                              ← 바로 위 줄의 득표율
    여러 구시군에 걸친 지역구는 '소계' 줄 다음에 구시군별 줄이 이어진다."""
    out, cur, last = {}, None, None
    for r in rows:
        if r[0] == "검색된 결과가 없습니다.":
            continue
        if r[0]:
            slots = r[4:r.index("계")]             # 빈 칸('' 또는 '|') 포함 후보 자리
            idx = [i for i, c in enumerate(slots) if c.strip("|")]
            cur = out[r[0]] = {"cands": [dict(zip(("party", "name"), slots[i].split("|"))) for i in idx],
                               "idx": idx, "n": len(slots), "areas": []}
            continue
        idx, n = cur["idx"], cur["n"]
        if r[1]:
            last = {"name": r[1], "electors": num(r[2]), "turnout": num(r[3]),
                    "votes": [num(r[4 + i]) for i in idx],
                    "valid": num(r[4 + n]), "invalid": num(r[5 + n])}
            cur["areas"].append(last)
        elif last is not None:
            last["pct"] = [float(r[4 + i]) if r[4 + i] else 0.0 for i in idx]
            last = None
    return out

keys = {f["properties"]["key"] for f in json.load(open(os.path.join(OUT, "districts.geojson")))["features"]}

def load(fname):
    results = {}
    for code, rows in json.load(open(os.path.join(RAW, fname))).items():
        for name, d in parse(rows).items():
            key = CITY[code] + " " + name
            assert key in keys, ("지도에 없는 지역구", key)
            total = next((a for a in d["areas"] if a["name"] == "소계"), d["areas"][0])
            areas = [a for a in d["areas"] if a["name"] != "소계"]
            order = sorted(range(len(d["cands"])), key=lambda i: -total["votes"][i])
            results[key] = {
                "electors": total["electors"], "turnout": total["turnout"],
                "valid": total["valid"], "invalid": total["invalid"],
                "cands": [dict(d["cands"][i], votes=total["votes"][i], pct=total["pct"][i]) for i in order],
                # 여러 구시군에 걸친 지역구만 구시군별 득표율(후보 순서는 cands와 같음)
                "areas": [{"name": a["name"], "pct": [a["pct"][i] for i in order]} for a in areas]
                         if len(areas) > 1 else [],
            }
    return results

general = load("nec_22_district_raw.json")
by = load("nec_byelection_20260603_raw.json")
missing = sorted(keys - set(general))
assert not missing, ("결과 없는 지역구", missing)
json.dump({"source": "중앙선거관리위원회 선거통계시스템",
           "elections": [{"id": "g22", "name": "제22대 총선", "date": "2024.4.10", "district": general},
                         {"id": "by20260603", "name": "재·보궐선거", "date": "2026.6.3", "district": by}]},
          open(os.path.join(OUT, "results.json"), "w"), ensure_ascii=False, separators=(",", ":"))
print(f"총선 {len(general)}곳(후보 {sum(len(r['cands']) for r in general.values())}명), 재보궐 {len(by)}곳,",
      round(os.path.getsize(os.path.join(OUT, 'results.json')) / 1024), "KB")
