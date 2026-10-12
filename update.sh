#!/bin/bash
# 국회의원 명단을 새로 받아 지도 데이터를 갱신한다 (탈당·보궐선거 반영)
cd "$(dirname "$0")"
python3 scripts/fetch_members.py && python3 scripts/fetch_sns.py && python3 scripts/build_data.py && python3 scripts/build_results.py && python3 scripts/build_outlook.py && python3 scripts/build_local.py && python3 scripts/build_primary.py && python3 scripts/fetch_news.py
