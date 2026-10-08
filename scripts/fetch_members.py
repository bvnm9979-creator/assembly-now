"""열린국회정보에서 현재 국회의원 명단을 받아 data/members.json 으로 저장.
인증키 없이 쓰면 한 번에 5명까지만 주므로, 지역구는 이름으로 하나씩,
비례대표는 정당→성별→성씨 순으로 쪼개서 받는다."""
import json, urllib.request, urllib.parse, time, sys, os

API = "https://open.assembly.go.kr/portal/openapi/nwvrqwxyaytdsfvhu"
KEY = os.environ.get("ASSEMBLY_KEY")  # 키가 있으면 한 번에 다 받음
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def q(**f):
    params = dict(Type="json", pIndex=1, pSize=300 if KEY else 5, **f)
    if KEY: params["KEY"] = KEY
    u = API + "?" + urllib.parse.urlencode(params)
    for i in range(4):
        try:
            d = json.loads(urllib.request.urlopen(
                urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=20).read().decode())
            break
        except Exception:
            time.sleep(1 + i)
    else:
        raise RuntimeError(u)
    time.sleep(0.08)
    if "nwvrqwxyaytdsfvhu" not in d:
        return 0, []
    h = d["nwvrqwxyaytdsfvhu"]
    return h[0]["head"][0]["list_total_count"], h[1]["row"]

SURNAMES = list("김이박최정강조윤장임한오서신권황안송전홍유고문양손배백허남심노하곽성차주우구민류나진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예경봉사부황보") + ["남궁", "선우", "제갈", "독고", "황보"]

members = {}
def add(rows):
    for r in rows:
        members[r["MONA_CD"]] = r

def split(f, depth=0):
    n, rows = q(**f)
    if n <= 5 or KEY:
        add(rows); return n
    if "SEX_GBN_NM" not in f:
        got = sum(split({**f, "SEX_GBN_NM": s}) for s in ("남", "여"))
    elif "HG_NM" not in f:
        got = sum(split({**f, "HG_NM": s}) for s in sorted(set(SURNAMES)))
    else:
        print("  !! 더 못 쪼갬", f, n, file=sys.stderr); add(rows); return n
    if got < n:
        print("  !! 누락 가능", f, n, got, file=sys.stderr)
    return n

total, _ = q()
print("국회 자료상 현재 의원 수:", total, file=sys.stderr)

# 1) 지역구: 선거구 이름으로 하나씩
SHORT = {"서울특별시":"서울","부산광역시":"부산","대구광역시":"대구","인천광역시":"인천","광주광역시":"전남광주통합특별시",
         "대전광역시":"대전","울산광역시":"울산","세종특별자치시":"","경기도":"경기","강원특별자치도":"강원",
         "충청북도":"충북","충청남도":"충남","전북특별자치도":"전북","전라남도":"전남광주통합특별시",
         "경상북도":"경북","경상남도":"경남","제주특별자치도":"제주"}
hexes = json.load(open(os.path.join(ROOT, "raw/district_hex_22.json")))
vacant = []
for h in hexes:
    orig = (SHORT[h["sido"]] + " " + h["name"]).strip()
    n, rows = q(ORIG_NM=orig)
    if n == 0: vacant.append(orig)
    add(rows)
print("지역구 조회 완료. 의원 없는 지역구:", vacant, file=sys.stderr)

# 2) 비례대표: 정당별로
parties = set()
for r in list(members.values()): parties.add(r["POLY_NM"])
parties |= {"국민의힘","더불어민주당","조국혁신당","개혁신당","진보당","기본소득당","사회민주당","무소속","새로운미래","자유통일당"}
for p in sorted(parties):
    n, _ = q(ORIG_NM="비례대표", POLY_NM=p)
    if n: split({"ORIG_NM": "비례대표", "POLY_NM": p})

# 3) 확인: 정당별 전체 수와 대조
ok = True
for p in sorted({r["POLY_NM"] for r in members.values()} | parties):
    n, _ = q(POLY_NM=p)
    mine = sum(1 for r in members.values() if r["POLY_NM"] == p)
    if n != mine:
        ok = False; print(f"  !! {p}: 국회 {n}명 / 수집 {mine}명", file=sys.stderr)
print(f"수집 {len(members)}명 / 국회 {total}명", "OK" if ok and len(members) == total else "확인 필요", file=sys.stderr)

# 4) 사진 주소: 다른 자료(ALLNAMEMBER)에 있어서 이름으로 하나씩 찾는다
def photo(r):
    u = "https://open.assembly.go.kr/portal/openapi/ALLNAMEMBER?" + urllib.parse.urlencode(
        dict(Type="json", pIndex=1, pSize=5, NAAS_NM=r["HG_NM"], **({"KEY": KEY} if KEY else {})))
    try:
        d = json.loads(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=20).read().decode())
        time.sleep(0.08)
        for x in d["ALLNAMEMBER"][1]["row"]:
            if x.get("BIRDY_DT") == r["BTH_DATE"] and "제22대" in (x.get("GTELT_ERACO") or ""):
                return x.get("NAAS_PIC")
    except Exception:
        pass
    return None
for r in members.values():
    r["PHOTO"] = photo(r)
print("사진 없음:", [r["HG_NM"] for r in members.values() if not r["PHOTO"]], file=sys.stderr)

os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
json.dump({"fetched": time.strftime("%Y-%m-%d"), "vacant": vacant, "members": list(members.values())},
          open(os.path.join(ROOT, "data/members_raw.json"), "w"), ensure_ascii=False, indent=1)
