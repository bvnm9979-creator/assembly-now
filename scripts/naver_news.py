"""네이버 뉴스 검색 결과(제목·요약·언론사·날짜·링크) 가져오기. 인증키 없이 검색 페이지를 읽는다."""
import html, re, time, urllib.parse, urllib.request

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"

def clean(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()

def search(query, sort=1, start=1, extra=""):
    """sort: 0 관련도순, 1 최신순. extra 예: '&pd=3&ds=2026.06.01&de=2026.10.11'"""
    url = ("https://search.naver.com/search.naver?where=news&" +
           urllib.parse.urlencode({"query": query, "sort": sort, "start": start}) + extra)
    for i in range(3):
        try:
            t = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=20).read().decode("utf-8", "ignore")
            break
        except Exception:
            time.sleep(2 + i * 3)
    else:
        return []
    out = []
    for m in re.finditer(r'href="([^"]+)"[^>]*data-heatmap-target="\.tit">(.*?)</a>(.*?)data-heatmap-target="\.body">(.*?)</a>', t, re.S):
        link, title, _, body = m.groups()
        head = t[max(0, m.start() - 6000):m.start()]
        date = re.findall(r">(\d{4}\.\d{2}\.\d{2})\.<|>(\d+(?:분|시간|일|주) 전)<", head)
        press = re.findall(r'sds-comps-profile-info-title-text[^>]*>(?:<[^>]+>)*([^<]+)<', head)
        out.append({"title": clean(re.sub(r"<span[^>]*>\s*새 창 열림\s*</span>", "", title)).removesuffix("새 창 열림").strip(),
                    "body": clean(body.replace('<span class="fender-ui_0cb57fb2">새 창 열림</span>', "")),
                    "date": "".join(date[-1]) if date else "", "press": press[-1].strip() if press else "",
                    "link": html.unescape(link)})
    return out

if __name__ == "__main__":
    import sys, json
    for x in search(" ".join(sys.argv[1:]))[:10]:
        print(json.dumps(x, ensure_ascii=False))
