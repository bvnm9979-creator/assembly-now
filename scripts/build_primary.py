"""2024 총선 민주당 지역구 예비후보·경선 명단(나무위키 '제22대 국회의원 선거/후보자/더불어민주당')
raw/namu/g22_dem_candidates.html → data/primary_2024.json  {지역구: {"method", "cands":[{name, career, round, won, note}]}}"""
import html, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIDO = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"]
keys = {f["properties"]["key"] for f in json.load(open(os.path.join(ROOT, "web", "data", "districts.geojson")))["features"]}

def text(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()

t = open(os.path.join(ROOT, "raw", "namu", "g22_dem_candidates.html")).read()
t = t[:t.find("2. 비례대표[편집]")] if "2. 비례대표[편집]" in t else t
rows = re.findall(r"<td style='background-color: rgb\(245,245,245\); text-align:center;'[^>]*>((?:(?!<td).)*?)</td>"
                  r"<td style='text-align:left;'[^>]*>(.*?)</td></tr>", t, re.S)
out, cur = {}, 0
for left, right in rows:
    name = re.sub(r"[·\s]", "", text(left))
    if not name or "<em" not in right:
        continue
    order = SIDO[cur:] + SIDO[:cur]
    sido = next((s for s in order if f"{s} {name}" in keys), None)
    if sido is None:
        continue
    cur = SIDO.index(sido)
    key = f"{sido} {name}"
    parts = re.split(r"<br[^>]*>", right)
    method = text(parts[0])
    cands = []
    for p in parts[1:]:
        if "<sup" not in p and "<sub" not in p:
            if text(p).startswith(("/", "전략경선")) and cands:
                method += " · " + text(p).strip("/ ")
            continue
        won = "<strong" in p
        dropped = "<del" in p
        nm = re.match(r"\s*(?:<[^>]+>\s*)*([^<\[]+)", p)
        career = re.search(r"<sub[^>]*>(.*?)</sub>", p, re.S)
        sups = [text(x) for x in re.findall(r"<sup[^>]*>(.*?)</sup>", p, re.S)]
        sups += [text(x) for x in re.findall(r"<a class='_[^']*'[^>]*>(.*?)</a>", p, re.S)]   # 각주 꼬리표 [컷오프] 등
        rnd = next((s for s in sups if re.fullmatch(r"\d+차", s)), "")
        notes = [s.strip("[]") for s in sups if s.startswith("[") and not re.fullmatch(r"\[\d+\]", s)]
        # 전략경선 등 이름 앞 꼬리표
        n = text(nm.group(1)) if nm else ""
        n = re.sub(r"^(전략경선|/)\s*", "", n).strip()
        if not n:
            continue
        cands.append({"name": n, "career": text(career.group(1)) if career else "", "round": rnd,
                      "won": won, "note": "·".join(dict.fromkeys(notes)) or ("탈락" if dropped else "")})
    out[key] = {"method": method, "cands": cands}

json.dump(out, open(os.path.join(ROOT, "data", "primary_2024.json"), "w"), ensure_ascii=False, indent=1)
missing = sorted(keys - set(out))
print(f"{len(out)}곳, 후보 {sum(len(v['cands']) for v in out.values())}명, 공천자 표시 {sum(any(c['won'] for c in v['cands']) for v in out.values())}곳")
print("빠진 곳:", missing)
