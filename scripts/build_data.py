"""raw/ 의 선거구 경계·육각형 + data/members_raw.json 을 묶어 web/data/ 에 지도용 파일 생성.
지역구 이름(예: '경기 수원시갑')이 세 파일을 잇는 열쇠다."""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw")
OUT = os.path.join(ROOT, "web", "data")
os.makedirs(OUT, exist_ok=True)

SHORT = {"서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구", "인천광역시": "인천", "광주광역시": "광주",
         "대전광역시": "대전", "울산광역시": "울산", "세종특별자치시": "세종", "경기도": "경기", "강원특별자치도": "강원",
         "충청북도": "충북", "충청남도": "충남", "전북특별자치도": "전북", "전라남도": "전남",
         "경상북도": "경북", "경상남도": "경남", "제주특별자치도": "제주"}

def rnd(coords):
    """좌표 소수 4자리(약 10m)로 줄여 파일 크기 축소."""
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], 4), round(coords[1], 4)]
    return [rnd(c) for c in coords]

# 1) 선거구 경계
geo = json.load(open(os.path.join(RAW, "district_22_geojson.json")))
features = []
for f in geo["features"]:
    p = f["properties"]
    key = p["SIDO"] + " " + p["SGG"]
    features.append({"type": "Feature", "id": len(features),
                     "properties": {"key": key, "sido": p["SIDO"], "sgg": p["SGG"]},
                     "geometry": {"type": f["geometry"]["type"], "coordinates": rnd(f["geometry"]["coordinates"])}})
keys = {f["properties"]["key"] for f in features}

# 2) 시도 경계(굵은 선용)
sido = json.load(open(os.path.join(RAW, "district_22_sido.json")))
for f in sido["features"]:
    f["geometry"]["coordinates"] = rnd(f["geometry"]["coordinates"])

# 3) 육각형
hexes = [{"key": SHORT[h["sido"]] + " " + h["name"], "sido": SHORT[h["sido"]], "c": h["c"], "r": h["r"]}
         for h in json.load(open(os.path.join(RAW, "district_hex_22.json")))]
assert {h["key"] for h in hexes} == keys, "육각형과 경계 파일의 지역구 이름이 다름"

# 4) 의원 → 지역구 이름 맞추기
raw = json.load(open(os.path.join(ROOT, "data", "members_raw.json")))
sgg_to_key = {}
for k in keys:
    s, g = k.split(" ", 1)
    if s in ("광주", "전남"):
        assert g not in sgg_to_key, g
        sgg_to_key[g] = k

def to_key(orig):
    orig = orig.strip()
    if orig.startswith("전남광주통합특별시 "):
        return sgg_to_key[orig.split(" ", 1)[1]]
    if orig.startswith("세종특별자치시"):
        return "세종 " + orig
    return orig

# SNS(없으면 빈 칸) — scripts/fetch_sns.py
sns_path = os.path.join(ROOT, "data", "sns_raw.json")
sns = json.load(open(sns_path)) if os.path.exists(sns_path) else {}

def slim(r):
    return {"name": r["HG_NM"], "hanja": r["HJ_NM"], "party": r["POLY_NM"], "orig": r["ORIG_NM"],
            "reele": r["REELE_GBN_NM"], "sex": r["SEX_GBN_NM"], "birth": r["BTH_DATE"],
            "cmit": r["CMITS"] or r["CMIT_NM"] or "", "photo": r.get("PHOTO") or "",
            "home": r.get("HOMEPAGE") or "", "office": r.get("ASSEM_ADDR") or "", "tel": r.get("TEL_NO") or "",
            "sns": {k: v for k, v in sns.get(r["MONA_CD"], {}).items() if v}}

district, pr = {}, []
for r in raw["members"]:
    if r["ORIG_NM"] == "비례대표":
        pr.append(slim(r)); continue
    k = to_key(r["ORIG_NM"])
    assert k in keys, ("모르는 지역구", r["ORIG_NM"])
    assert k not in district, ("한 지역구에 두 명", k)
    district[k] = slim(r)
pr.sort(key=lambda m: (m["party"], m["name"]))
vacant = sorted(keys - set(district))

def add_dokdo(features, sido):
    """독도(경북 울릉군 울릉읍 독도리) — 원본 선거구 경계(오마이뉴스)에 없어 따로 더한다.
    해안선은 raw/dokdo_osm.geojson: OpenStreetMap natural=coastline(© OpenStreetMap contributors, ODbL)을
    이어 붙인 동도·서도와 주변 바위(30㎡ 이상) 54조각. 좌표는 소수 5자리(약 1m)로 둬 섬 모양을 살린다."""
    dokdo = json.load(open(os.path.join(RAW, "dokdo_osm.geojson")))["features"][0]["geometry"]["coordinates"]
    for f in features:
        if f["properties"].get("key") == "경북 포항시남구울릉군" and f["geometry"]["type"] == "MultiPolygon":
            f["geometry"]["coordinates"] += dokdo
    for f in sido["features"]:
        if f["properties"].get("SIDO") == "경북" and f["geometry"]["type"] == "MultiPolygon":
            f["geometry"]["coordinates"] += dokdo

add_dokdo(features, sido)
json.dump({"type": "FeatureCollection", "features": features}, open(os.path.join(OUT, "districts.geojson"), "w"),
          ensure_ascii=False, separators=(",", ":"))
json.dump(sido, open(os.path.join(OUT, "sido.geojson"), "w"), ensure_ascii=False, separators=(",", ":"))
json.dump(hexes, open(os.path.join(OUT, "hex.json"), "w"), ensure_ascii=False, separators=(",", ":"))
json.dump({"fetched": raw["fetched"], "district": district, "pr": pr, "vacant": vacant},
          open(os.path.join(OUT, "members.json"), "w"), ensure_ascii=False, separators=(",", ":"))
print(f"지역구 {len(district)}명 + 비례 {len(pr)}명 = {len(district) + len(pr)}명, 공석 {vacant}")
for n in ("districts.geojson", "sido.geojson", "hex.json", "members.json"):
    print(n, round(os.path.getsize(os.path.join(OUT, n)) / 1024), "KB")
