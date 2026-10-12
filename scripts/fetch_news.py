"""지역위원장(민주당) 관련 최근 기사 수집 + 리스크 표시 → web/data/chairs.json

- 지역위원장: 민주당 현역 의원 지역구는 그 의원, 나머지는 data/chairs_manual.json (사람이 확인한 명단)
- 2024 경선 후보군: data/primary_2024.json (build_primary.py)
- 기사: 네이버 뉴스 검색(안 되면 구글 뉴스 RSS)에서 '이름 + 지역' 최근 90일
- 리스크 기사만 저장: 제목, 또는 요약에서 이름 가까이에 RISK_HIGH(고발·수사 등)/RISK_LOW(논란·의혹 등) 단어가 있는 기사
매일 GitHub Actions(.github/workflows/news.yml)가 실행해 자동 갱신한다.
"""
import json, os, re, sys, time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from naver_news import search as naver
from search_chairs import rss as google, words

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KST = timezone(timedelta(hours=9))
RISK_HIGH = ["고발", "고소", "피소", "수사", "압수수색", "기소", "입건", "구속", "재판", "벌금", "유죄", "징계", "윤리심판",
             "폭행", "성추행", "성희롱", "비리", "횡령", "뇌물", "선거법", "정치자금", "제명", "명예훼손", "경찰 조사", "검찰"]
RISK_LOW = ["의혹", "논란", "막말", "폭언", "갑질", "사퇴 요구", "사퇴하라", "반발", "규탄", "탈당", "특혜", "낙하산", "허위", "공천 취소"]

def risk_of(name, title, body):
    """제목에 있거나, 요약에서 이름 앞뒤 60자 안에 있는 위험 단어 → (등급, 단어들)"""
    near = title + " " + " ".join(body[max(0, m.start() - 60):m.end() + 60] for m in re.finditer(re.escape(name), body))
    hi = [w for w in RISK_HIGH if w in near]
    lo = [w for w in RISK_LOW if w in near]
    return ("high" if hi else "low" if lo else ""), hi + lo

def area_word(key):
    """'경기 포천시가평군' → '포천', '서울 강남구갑' → '강남'"""
    q = words(key).split()
    if q[0] in ("서울", "부산", "대구", "인천", "광주", "대전", "울산"):
        q = q[1:]
    w = q[1] if len(q) > 1 and q[1].endswith(("구", "구갑", "구을", "구병")) and not q[0].endswith("구") else q[0]
    w = re.sub(r"[갑을병정]$", "", w)
    return w[:-1] if len(w) >= 3 and w[-1] in "구시군" else w

def chairs():
    members = json.load(open(os.path.join(ROOT, "web", "data", "members.json")))
    manual = json.load(open(os.path.join(ROOT, "data", "chairs_manual.json")))
    out = {}
    for k, m in members["district"].items():
        if m.get("party") == "더불어민주당":
            out[k] = {"name": m["name"], "status": "현역 의원", "note": f"{m.get('reele', '')} 국회의원".strip()}
    for k, v in manual.items():
        if not k.startswith("_"):
            out[k] = v
    return out

def norm_date(d):
    """'2026.09.11' / '3일 전' / 'Thu, 09 Jul 2026' → 'YYYY-MM-DD'"""
    now = datetime.now(KST)
    if m := re.match(r"(\d{4})\.(\d{2})\.(\d{2})", d):
        return "-".join(m.groups())
    if m := re.match(r"(\d+)(분|시간|일|주) 전", d):
        n, u = int(m.group(1)), m.group(2)
        delta = {"분": timedelta(minutes=n), "시간": timedelta(hours=n), "일": timedelta(days=n), "주": timedelta(weeks=n)}[u]
        return (now - delta).strftime("%Y-%m-%d")
    for fmt, part in (("%a, %d %b %Y", d.strip()[:16]), ("%d %b %Y", d.strip()[:11])):   # 구글 RSS 날짜
        try:
            return datetime.strptime(part, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return ""

def news_for(key, name):
    if not name:
        return []
    area = area_word(key)
    since = (datetime.now(KST) - timedelta(days=90)).strftime("%Y.%m.%d")
    today = datetime.now(KST).strftime("%Y.%m.%d")
    items = naver(f'"{name}" {area}', sort=1, extra=f"&pd=3&ds={since}&de={today}")
    items += naver(f'"{name}" {area}', sort=0, extra=f"&pd=3&ds={since}&de={today}")
    items += naver(f'"{name}" {area} 의혹 | 수사 | 논란 | 고발 | 징계 | 반발', sort=0, extra=f"&pd=3&ds={since}&de={today}")
    if not items:   # 네이버가 막히면 구글 뉴스
        items = [{"title": re.sub(r" - [^-]+$", "", x["title"]), "body": "", "press": x["title"].rsplit(" - ", 1)[-1],
                  "date": x["date"], "link": x["link"]}
                 for x in google(f'"{name}" {area} when:90d')]
    seen, out = set(), []
    for x in items:
        text = x["title"] + " " + x["body"]
        if name not in text:
            continue
        sig = re.sub(r"\W", "", x["title"])[:25]
        if sig in seen:
            continue
        seen.add(sig)
        level, risk = risk_of(name, x["title"], x["body"])
        if not level:          # 리스크 기사만 남긴다
            continue
        out.append({"title": x["title"], "body": x["body"][:160], "press": x["press"], "date": norm_date(x["date"]),
                    "link": x["link"], "level": level, "risk": risk})
    out.sort(key=lambda x: (x["level"] == "high", x["date"]), reverse=True)
    return out[:25]

def main():
    ch = chairs()
    primary = json.load(open(os.path.join(ROOT, "data", "primary_2024.json")))
    path = os.path.join(ROOT, "web", "data", "chairs.json")
    old = json.load(open(path))["district"] if os.path.exists(path) else {}

    def one(k):
        try:
            n = news_for(k, (ch.get(k) or {}).get("name", ""))
        except Exception as e:
            print("실패", k, e)
            n = old.get(k, {}).get("news", [])     # 실패하면 지난 기사 유지
        time.sleep(0.3)
        return k, n
    keys = sorted(set(ch) | set(primary))
    with ThreadPoolExecutor(4) as ex:
        news = dict(ex.map(one, keys))
    out = {k: {"chair": ch.get(k), "primary2024": primary.get(k), "news": news.get(k, [])} for k in keys}
    json.dump({"updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "risk_words": {"high": RISK_HIGH, "low": RISK_LOW}, "district": out},
              open(path, "w"), ensure_ascii=False, separators=(",", ":"))
    n_news = sum(len(v["news"]) for v in out.values())
    n_risk = sum(1 for v in out.values() for x in v["news"] if x["level"] == "high")
    with_risk = sum(1 for v in out.values() if v["news"])
    print(f"{len(out)}곳, 리스크 기사 {n_news}건(높음 {n_risk}건), 리스크 기사가 있는 곳 {with_risk}곳")

if __name__ == "__main__":
    main()
