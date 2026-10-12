"""'여론조사' 버튼 값: 중앙선거여론조사심의위원회(선관위 산하)에 등록된 전국 정당 지지도 조사의 최근 2주 평균 + 과거 선거 보정.

1) nesdc.go.kr '여론조사결과 주요 데이터'(매주 월요일 게시) 최신 글의 엑셀을 받는다
   — 2023.10.30부터 등록된 전국 조사 전부: 등록번호·조사기관·조사일자·방법·정당 지지율
2) 조사마다 민주 계열(더불어민주당+조국혁신당+진보당 …) − 국민의힘
3) 최근 2주(가장 늦게 끝난 조사 기준) 조사를 조사기관별로 먼저 평균 → 기관 평균들의 평균
   (한 기관이 여러 번 조사해도 한 표만 갖게)
4) 보정: 과거 세 선거 직전 20일 여론조사 평균(같은 방식)과 실제 전국 평균 격차(판세 계산과 같은 정의)의 차이를 평균해 더함
   — 지방선거 실제값은 광역비례 '더불어민주당' 표만 쓰므로 여론조사도 더불어민주당만으로 비교
결과 → web/data/poll.json · 실행: python3 scripts/fetch_polls.py
"""
import datetime as dt, json, os, re, statistics as st, urllib.request, zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XLSX = os.path.join(ROOT, "raw", "nesdc_polls.xlsx")
OUT = os.path.join(ROOT, "web", "data", "poll.json")
BASE = "https://www.nesdc.go.kr"
LIST = BASE + "/portal/bbs/B0000025/list.do?menuNo=200500"
DBLOC = ("더불어민주당", "조국혁신당", "진보당", "기본소득당", "사회민주당", "더불어민주연합", "새진보연합")
RIVAL = ("국민의힘", "국민의미래")
# 과거 선거: (날짜, 실제 전국 평균 격차 = outlook.json national 과 같은 정의, 여론조사 쪽 민주 기준)
PAST = [("2024 총선", dt.date(2024, 4, 10), 6.4, "bloc"),
        ("2025 대선", dt.date(2025, 6, 3), 8.2, "bloc"),
        ("2026 지방선거", dt.date(2026, 6, 3), 6.0, "dem")]
M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    return urllib.request.urlopen(req, timeout=60).read()


def download():
    """최신 '주요 데이터' 글 → 엑셀 첨부 받기. 돌려주는 값: 글 제목(예: 2026.10.1주차), 글 주소"""
    html = get(LIST).decode("utf-8", "ignore")
    ntt = re.search(r"view\.do[^\"?]*\?nttId=(\d+)", html).group(1)          # 주소에 ;jsessionid=… 가 끼어 있음
    view = f"{BASE}/portal/bbs/B0000025/view.do?nttId={ntt}&menuNo=200500"
    page = get(view).decode("utf-8", "ignore")
    title = re.search(r"(\d{4}\.\d{1,2}\.\d주차)[^<]*주요 데이터", page).group(1)
    for href, name in re.findall(r'href="(/portal/cmm/fms/FileDown\.do\?[^"]+)"[^>]*>\s*([^<]+?\.xlsx)', page):
        open(XLSX, "wb").write(get(BASE + href.replace("&amp;", "&")))
        return title, view
    raise SystemExit("엑셀 첨부를 찾지 못함: " + view)


def read_xlsx(path):
    """표준 라이브러리만으로 엑셀 읽기 → 시트마다 [{열: 값}]"""
    z = zipfile.ZipFile(path)
    ss = ["".join(t.text or "" for t in si.iter(M + "t")) for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(M + "si")]
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    rid = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    for s in ET.fromstring(z.read("xl/workbook.xml")).iter(M + "sheet"):
        rows = []
        for r in ET.fromstring(z.read("xl/" + rels[s.get(rid)].replace("/xl/", "").lstrip("/"))).iter(M + "row"):
            out = {}
            for c in r.findall(M + "c"):
                v = c.find(M + "v")
                if v is not None:
                    out[re.match(r"[A-Z]+", c.get("r")).group()] = ss[int(v.text)] if c.get("t") == "s" else v.text
            rows.append(out)
        yield s.get("name"), rows


def end_date(s):
    """'26.09.28.~30.' · '24.06.05,06.07.' · '23.12.30.~24.01.02.' → 조사가 끝난 날"""
    n = [int(x) for x in re.findall(r"\d+", s)]
    if len(n) < 3:
        return None
    y, mo, d = n[:3]
    rest = n[3:]
    if len(rest) == 1:
        d = rest[0]
    elif len(rest) == 2:
        mo, d = rest
    elif len(rest) >= 3:
        y, mo, d = rest[-3:]
    try:
        return dt.date(2000 + y, mo, d)
    except ValueError:
        return None


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def polls():
    out = []
    for _, rows in read_xlsx(XLSX):
        cols = {v.replace("\n", ""): k for k, v in rows[1].items()}      # 둘째 줄 = 정당 이름
        for r in rows[2:]:
            day = end_date(r.get("D", ""))
            if not r.get("A") or not day:
                continue
            out.append({"no": r["A"], "org": r.get("B", "").replace("\n", " ").strip(), "date": day, "method": r.get("E", ""),
                        "bloc": round(sum(num(r.get(cols[p])) for p in DBLOC if p in cols), 1),
                        "dem": num(r.get(cols["더불어민주당"])), "R": round(sum(num(r.get(cols[p])) for p in RIVAL if p in cols), 1)})
    return out


def org_avg(ps, key):
    """조사기관별 평균 → 기관 평균들의 평균"""
    by = defaultdict(list)
    for p in ps:
        by[p["org"]].append(p[key] - p["R"])
    return st.mean(st.mean(v) for v in by.values()), len(by)


def main():
    title, view = download()
    ps = polls()
    past = []
    for name, day, actual, key in PAST:
        w = [p for p in ps if day - dt.timedelta(days=20) <= p["date"] < day]
        avg, n_org = org_avg(w, key)
        past.append({"name": name, "date": day.isoformat(), "poll": round(avg, 1), "actual": actual, "diff": round(actual - avg, 1),
                     "n": len(w), "orgs": n_org, "basis": "민주 계열" if key == "bloc" else "더불어민주당"})
    corr = round(st.mean(x["diff"] for x in past), 1)
    last = max(p["date"] for p in ps)
    recent = sorted((p for p in ps if p["date"] > last - dt.timedelta(days=14)), key=lambda p: p["date"])
    avg, n_org = org_avg(recent, "bloc")
    out = {"kind": "average", "source": "중앙선거여론조사심의위원회 '여론조사결과 주요 데이터' " + title, "url": view,
           "window": [recent[0]["date"].isoformat(), last.isoformat()], "n": len(recent), "orgs": n_org,
           "avg": round(avg, 1), "correction": corr, "gap": round(avg + corr, 1), "past": past,
           "polls": [{"no": p["no"], "org": p["org"], "date": p["date"].isoformat(), "method": p["method"], "bloc": p["bloc"], "R": p["R"]} for p in recent],
           "updated": dt.date.today().isoformat()}
    json.dump(out, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
    print(f"{title}: 전국 조사 {len(ps)}건 · 최근 2주({out['window'][0]}~{out['window'][1]}) {len(recent)}건 {n_org}개 기관")
    print(f"평균 {out['avg']:+.1f} · 과거 보정 {corr:+.1f} → 여론조사 버튼 {out['gap']:+.1f}")
    for x in past:
        print(f"  {x['name']}: 직전 20일 {x['n']}건({x['orgs']}개 기관, {x['basis']}) {x['poll']:+.1f} → 실제 {x['actual']:+.1f} ({x['diff']:+.1f})")


if __name__ == "__main__":
    main()
