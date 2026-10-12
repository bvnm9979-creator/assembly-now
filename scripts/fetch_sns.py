"""열린국회정보 '국회의원 SNS정보'(negnlnyvatsjwocar) → data/sns_raw.json {MONA_CD: {x, facebook, youtube, blog}}.
인증키 없으면 한 번에 5명까지라 data/members_raw.json 의원 이름으로 하나씩 받는다."""
import json, urllib.request, urllib.parse, time, sys, os

API = "https://open.assembly.go.kr/portal/openapi/negnlnyvatsjwocar"
KEY = os.environ.get("ASSEMBLY_KEY")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIELDS = {"T_URL": "x", "F_URL": "facebook", "Y_URL": "youtube", "B_URL": "blog"}

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
    return d["negnlnyvatsjwocar"][1]["row"] if "negnlnyvatsjwocar" in d else []

def clean(u):
    u = (u or "").strip()
    if not u: return ""
    if not u.startswith("http"): u = "https://" + u
    return u.replace("://web.facebook.com", "://www.facebook.com")

members = json.load(open(os.path.join(ROOT, "data", "members_raw.json")))["members"]
rows = q() if KEY else [r for name in sorted({m["HG_NM"] for m in members}) for r in q(HG_NM=name)]
codes = {m["MONA_CD"] for m in members}
sns = {r["MONA_CD"]: {v: clean(r.get(k)) for k, v in FIELDS.items()} for r in rows if r["MONA_CD"] in codes}
json.dump(sns, open(os.path.join(ROOT, "data", "sns_raw.json"), "w"), ensure_ascii=False, indent=1)
print(f"SNS 정보 {len(sns)}명 / 의원 {len(codes)}명,",
      {v: sum(1 for s in sns.values() if s[v]) for v in FIELDS.values()}, file=sys.stderr)
