"""리스크 후보 기사(단어로 1차 거른 것)를 Gemini가 읽고 '지역위원장 본인의 비리·물의 기사인가'를 판단한다.

- 단어로 거른 1차 후보: data/news_candidates.json (공개 안 함)
- 판단 결과: data/news_judged.json 에 기사 링크별로 저장 → 같은 기사는 다시 묻지 않는다
- 사람이 고치는 목록: data/news_override.json  {"exclude": [링크...], "include": [링크...]}
- AI 판단을 못 받은 기사는 공개하지 않는다(확인 안 된 기사를 '리스크'로 붙이지 않기 위해)
python3 scripts/judge_news.py  → 기사를 새로 모으지 않고 지금 후보만 다시 판단해서 web/data/chairs.json 에 반영
"""
import json, os, re, threading, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CANDS = os.path.join(ROOT, "data", "news_candidates.json")
CACHE = os.path.join(ROOT, "data", "news_judged.json")
OVERRIDE = os.path.join(ROOT, "data", "news_override.json")
MODELS = ["gemini-3.5-flash", "gemini-3.1-flash-lite"]   # 3.7·3.8·flash-latest 는 무료 한도(429)에 자주 걸림

RULE = """너는 정당 캠프의 기사 분류 담당이다. 아래 기사들이 '{name}'(더불어민주당 {area} 지역위원장) 본인의 리스크 기사인지 판단해라.

리스크(keep=true):
- {name} 본인이 비리·범죄 혐의(금품·뇌물·횡령·특혜·이해충돌·정치자금·선거법 위반·성범죄·폭행·음주운전 등)의 당사자로 의혹이 보도되거나 수사·기소·재판·징계를 받는 기사
- {name} 본인이 사회적 물의(막말·폭언·갑질·부적절한 언행이나 처신·불법 경선운동·공천 잡음 등)를 일으켜 비판받는 기사
- {name} 본인이 고소·고발을 당한 기사(누가 냈든, 모욕·명예훼손 등 발언 문제 포함)

리스크 아님(keep=false):
- 법안 발의, 정책 주장, 국정감사 질의, 토론, 당 활동, 현장 방문
- {name}이 다른 사람을 비판·고발·고소하거나 사퇴를 요구하는 기사, {name}이 피해자인 기사
- 다른 사람의 사건에 {name}이 이름만 나오는 기사, 동명이인

keep=true면 level: 수사·압수수색·기소·재판·징계·경찰 출석처럼 공식 절차가 진행 중이면 "high", 의혹·논란 단계면 "low".
reason: 한국어 한 줄(25자 안팎), 무슨 일인지 사실만.

기사:
{items}

JSON 배열만 답해라: [{{"i": 번호, "keep": true/false, "level": "high"|"low"|"", "reason": "..."}}]"""


def _call(prompt):
    key = os.environ["GEMINI_API_KEY"].strip()
    body = json.dumps({"contents": [{"parts": [{"text": prompt}]}],
                       "generationConfig": {"responseMimeType": "application/json", "temperature": 0}}).encode()
    last = None
    for attempt in range(4):
        for model in MODELS:
            req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                                         data=body, headers={"Content-Type": "application/json", "x-goog-api-key": key})
            try:
                r = json.load(urllib.request.urlopen(req, timeout=60))
                return json.loads(r["candidates"][0]["content"]["parts"][0]["text"])
            except Exception as e:      # 503(사람 몰림)·시간 초과면 다음 모델, 한 바퀴 돌면 잠깐 쉬고 다시
                last = e
        time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"Gemini 판단 실패: {last}")


def load(path, empty):
    return json.load(open(path)) if os.path.exists(path) else empty


def judge(key, name, items, cache):
    """items 가운데 아직 판단 안 한 것만 Gemini에 물어 cache 를 채운다."""
    todo = [x for x in items if x["link"] not in cache]
    area = re.sub(r"^\S+ ", "", key)
    for s in range(0, len(todo), 15):
        part = todo[s:s + 15]
        lines = "\n".join(f"{i}. [{x['date']}] {x['title']} — {x['body']}" for i, x in enumerate(part))
        for r in _call(RULE.format(name=name, area=area, items=lines)):
            if isinstance(r, dict) and isinstance(r.get("i"), int) and 0 <= r["i"] < len(part):
                cache[part[r["i"]]["link"]] = {"keep": bool(r.get("keep")), "level": r.get("level") or "low",
                                               "reason": (r.get("reason") or "").strip(), "name": name}


def apply(items, cache, override):
    """판단·사람 수정 목록대로 걸러 낸 기사 목록"""
    out = []
    for x in items:
        j = cache.get(x["link"])
        if x["link"] in override.get("exclude", []):
            continue
        if x["link"] in override.get("include", []):
            out.append(dict(x, reason=(j or {}).get("reason", "")))
        elif j and j["keep"]:
            out.append(dict(x, level=j["level"], reason=j["reason"]))
    out.sort(key=lambda x: (x["level"] == "high", x["date"]), reverse=True)
    return out


def run(cands, names):
    """{지역구: 후보 기사} → {지역구: 리스크 기사}. 판단 결과는 저장해 둔다."""
    from concurrent.futures import ThreadPoolExecutor
    cache, override = load(CACHE, {}), load(OVERRIDE, {"exclude": [], "include": []})

    lock = threading.Lock()

    def one(k):
        try:
            if cands.get(k) and names.get(k):
                judge(k, names[k], cands[k], cache)
        except Exception as e:
            print("판단 실패", k, e, flush=True)
        with lock:                       # 중간에 멈춰도 판단한 만큼은 남게 지역구마다 저장
            json.dump(cache, open(CACHE, "w"), ensure_ascii=False, indent=0)
    with ThreadPoolExecutor(2) as ex:
        list(ex.map(one, list(cands)))
    left = sum(1 for v in cands.values() for x in v if x["link"] not in cache)
    print(f"후보 {sum(len(v) for v in cands.values())}건 판단 (판단 못 한 {left}건은 숨김)")
    return {k: apply(v, cache, override) for k, v in cands.items()}


if __name__ == "__main__":
    path = os.path.join(ROOT, "web", "data", "chairs.json")
    data = json.load(open(path))
    if not os.path.exists(CANDS):         # 처음 한 번: 지금 공개된 기사들을 후보로 옮긴다
        json.dump({k: v["news"] for k, v in data["district"].items()}, open(CANDS, "w"), ensure_ascii=False)
    cands = json.load(open(CANDS))
    names = {k: (v.get("chair") or {}).get("name", "") for k, v in data["district"].items()}
    risk = run(cands, names)
    for k, v in data["district"].items():
        v["news"] = risk.get(k, [])
    json.dump(data, open(path, "w"), ensure_ascii=False, separators=(",", ":"))
    print(f"리스크 기사 {sum(len(v) for v in risk.values())}건")
