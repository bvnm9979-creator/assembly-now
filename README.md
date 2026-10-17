# 어셈블리나우 · 22대 국회 지역구 지도

지금 우리 지역구 국회의원은 누구인가 — 254개 지역구와 비례대표 46명을 정당 색으로 한눈에 보는 지도.

**▶ 바로 보기: https://bvnm9979-creator.github.io/assembly-now/**

- 실제 지도 / 육각형 지도(지역구 1곳 = 1칸) / 비례대표 목록
- 정당을 누르면 그 정당 지역구만 표시
- 지역구·의원 이름 검색, 지역구별 의원 정보(사진·당선 횟수·위원회·연락처)
- 의원 SNS 바로가기(유튜브·페이스북·블로그·X, 국회 제출 자료)
- 당선 선거 결과: 후보별 득표수·득표율, 2위와 표 차이, 투표율, 여러 시군구에 걸친 지역구는 시군구별 득표율
  (재보궐로 바뀐 14곳은 2026.6.3 재보궐 결과 + 2024 총선 결과)
- 국회 본회의장 모양의 반원 의석도
- **판세 모드**(지도 왼쪽 아래 '판세'): 2024 총선 · 2025 대선 · 2026 지선(시·도지사)에서 민주당이 상대 후보보다 앞선 %p 평균으로
  우세(+10 이상) · 경합우세(+5~10) · 경합(±5) · 경합열세(−5~−10) · 열세(−10 이하) 색칠
  - 대선·지선은 선관위 투표구·읍면동별 결과를 22대 지역구로 다시 더함(두 지역구에 나뉜 동은 투표구/선거인수 비율)
- 지역구를 누르면 **민주당 지역위원장**(현역 의원 또는 원외 위원장·직무대행), 리스크 기사(2026.10.1. 이후)(고발·수사·입건·징계 등), **2024 총선 민주당 후보군**(예비후보·경선·컷오프)

## 데이터 갱신 (탈당·보궐선거 후)

```bash
./update.sh          # 국회 열린국회정보에서 의원 명단·사진을 새로 받아 web/data/ 갱신
git add web/data && git commit -m "의원 정보 갱신" && git push   # 올리면 자동 배포
```

마지막 줄에 `수집 299명 / 국회 299명 OK` 처럼 국회 전체 인원과 같으면 정상.
열린국회정보 인증키가 있으면 `ASSEMBLY_KEY=키 ./update.sh` (더 빠름).

## 지역위원장 바뀌었을 때

`data/chairs_manual.json` 에서 그 지역구 이름·상태를 고친 뒤 `python3 scripts/fetch_news.py` (기사 다시 수집, 10분 정도).

## 내 컴퓨터에서 보기

```bash
cd web && python3 -m http.server 8765   # http://localhost:8765
```

## 구조

| 경로 | 내용 |
|---|---|
| `web/` | 웹페이지 (GitHub Pages 로 배포되는 폴더) |
| `web/data/` | 지도용 데이터 (`update.sh` 가 생성) |
| `scripts/fetch_members.py` | 열린국회정보에서 현재 의원 명단·사진 수집 |
| `scripts/fetch_sns.py` | 열린국회정보 '국회의원 SNS정보' 수집 → `data/sns_raw.json` |
| `scripts/build_results.py` | 선관위 개표결과(`raw/nec_*_raw.json`)를 지역구별로 정리 → `web/data/results.json` |
| `scripts/build_outlook.py` | 판세: 2024 총선·2025 대선·2026 지선을 지역구로 재합산 → `web/data/outlook.json` |
| `scripts/build_primary.py` | 2024 민주당 후보군(나무위키 저장본 `raw/namu/`) → `data/primary_2024.json` |
| `data/chairs_manual.json` | **민주당 현역이 없는 101곳의 지역위원장** — 사람이 확인해 고치는 파일(이름·위원장/직무대행/확인필요·메모) |
| `scripts/fetch_news.py` | 지역위원장 기사 수집(네이버→구글 뉴스) + 리스크 표시 → `web/data/chairs.json` |
| `scripts/build_data.py` | 선거구 경계·육각형 배치·의원 정보를 지역구 이름으로 연결 |
| `raw/` | 원본 선거구 경계·육각형 배치 (23대 선거구가 확정되면 이 파일만 교체) |

## 출처

- 의원 정보: [국회 열린국회정보](https://open.assembly.go.kr) (현재 국회의원 인적사항)
- 선거 결과: [중앙선거관리위원회 선거통계시스템](https://info.nec.go.kr) 개표현황 (22대 총선, 2026.6.3 재보궐)
- 22대 선거구 경계: 오마이뉴스 (MIT, `raw/district_22_geojson.LICENSE`)
- 독도 해안선: © OpenStreetMap contributors (ODbL), `raw/dokdo_osm.geojson` — 원본 경계에 독도가 없어 추가
- 육각형 배치: [polis-korea](https://github.com/YangSeungWon/polis-korea) (MIT)
- 지도: [MapLibre GL JS](https://maplibre.org) · 글꼴: 마루부리(MaruBuri, 네이버), IBM Plex Sans KR

지역구 경계는 22대 총선(2024) 기준입니다. 국회 자료의 '전남광주통합특별시' 지역구는 기존 광주·전남 선거구에 맞춰 표시합니다.
