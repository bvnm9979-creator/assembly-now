"""민주당 현역 의원이 없는 지역구의 지역위원장 기사 제목 수집(구글 뉴스 RSS) → raw/chair/search.json
사람이 읽고 확인해서 data/chairs.json 을 만든다."""
import json, os, re, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def words(key):
    """'경기 포천시가평군' → '포천 가평', '부산 북구갑' → '부산 북구갑'"""
    sido, name = key.split(" ", 1)
    m = re.match(r"^(.*?)([갑을병정무])?$", name)
    body, gap = m.group(1), m.group(2) or ""
    parts = re.findall(r".+?(?:시|군|구)(?=.|$)", body) or [body]
    parts = [re.sub(r"(특별자치시|시|군)$", "", p) if len(p) > 2 and not p.endswith("구") else p for p in parts]
    q = " ".join(parts) + gap
    return (sido + " " + q) if all(p.endswith("구") for p in parts) else q

def rss(q):
    url = "https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": q, "hl": "ko", "gl": "KR", "ceid": "KR:ko"})
    for _ in range(3):
        try:
            t = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=20).read().decode()
            return [{"title": re.sub(r"&[a-z]+;|<.*?>", "", a), "date": d[5:16], "link": l}
                    for a, l, d in re.findall(r"<item><title>(.*?)</title><link>(.*?)</link>.*?<pubDate>(.*?)</pubDate>", t, re.S)]
        except Exception:
            time.sleep(2)
    return []

if __name__ == "__main__":
    keys = json.load(open(sys.argv[1]))
    def one(k):
        q = words(k)
        a = rss(f'민주당 {q} 지역위원장 after:2026-05-15')
        if len(a) < 3:
            a += rss(f'민주당 {q} 지역위원장 after:2025-01-01')
        return k, {"q": q, "items": a[:25]}
    with ThreadPoolExecutor(6) as ex:
        out = dict(ex.map(one, keys))
    json.dump(out, open(os.path.join(ROOT, "raw", "chair", "search.json"), "w"), ensure_ascii=False, indent=1)
    print(len(out), sum(len(v["items"]) for v in out.values()))
