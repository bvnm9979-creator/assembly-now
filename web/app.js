// 22대 국회 지역구 지도 — 실제 지도(MapLibre) + 육각형 지도(SVG) + 비례대표 목록

// 배포 버전: index.html 의 app.js?v=… (배포 때 커밋 번호로 자동으로 바뀜) → 자료 파일에도 붙여 예전 파일 캐시를 피함
const BUILD = new URL(document.currentScript.src).searchParams.get("v") || "";

const PARTY_COLOR = {
  "더불어민주당": "#1F5BC4",
  "국민의힘": "#E2333C",
  "조국혁신당": "#0BA0DA",
  "개혁신당": "#FF8A1F",
  "진보당": "#B8256A",
  "기본소득당": "#00A497",
  "사회민주당": "#EDB200",
  "무소속": "#9A9FA8",
  // 선거 결과에만 나오는 정당
  "새로운미래": "#2E9C9A",
  "녹색정의당": "#E9B800",
  "새미래민주당": "#4FA3C7",
};
// 의석도·막대에서 왼쪽→오른쪽 순서
const PARTY_ORDER = ["진보당", "기본소득당", "사회민주당", "조국혁신당", "더불어민주당", "무소속", "개혁신당", "국민의힘"];
const OFF = "#E3E5E9";            // 정당 선택 시 나머지
const VACANT = "#FFFFFF";
const KOREA = [[124.6, 33.1], [132.0, 38.65]];   // 동쪽 끝은 독도(131.87)까지
const colorOf = (p) => (p === "공석" ? VACANT : PARTY_COLOR[p] || "#B8BBC2");
// 정당 필터를 반영한 실제 칠할 색
const paint = (p) => (!state.party || state.party === p ? colorOf(p) : OFF);
// 판세: 세 선거(2024 총선·2025 대선·2026 지선) 민주 득표율 − 상대 후보 득표율 평균
const GRADES = [["우세", "#1F5BC4"], ["경합우세", "#8DB1EC"], ["경합", "#F0C24B"], ["경합열세", "#F3A3A7"], ["열세", "#E2333C"]];
const GRADE_COLOR = Object.fromEntries(GRADES);
const gpaint = (g) => (!state.grade || state.grade === g ? GRADE_COLOR[g] || "#B8BBC2" : OFF);
// 지역구 칸 색: 지금 색칠 기준(현재 의원 / 판세)에 따라
const cellColor = (key) => {
  if (state.mode === "outlook") return gpaint(state.outlook?.district[key]?.grade);
  const m = state.members.district[key];
  return paint(m ? m.party : "공석");
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const state = { members: null, hexes: null, geo: null, sido: null, party: null, sel: null, map: null, view: "geo", counts: [],
                mode: "seat", grade: null, outlook: null, chairs: null, regAdj: {} };   // regAdj: 권역별 조정(%p), 기본 0

init();

async function init() {
  // 서버가 잠깐 오류(503 등)를 내면 최대 4번까지 다시 받음
  const load = async (f) => {
    for (let i = 0; ; i++) {
      try {
        const r = await fetch("data/" + f + (BUILD ? "?v=" + BUILD : ""));
        if (r.ok) return await r.json();
        throw new Error(r.status);
      } catch (e) {
        if (i >= 3) throw e;
        await new Promise((ok) => setTimeout(ok, 800 * (i + 1)));
      }
    }
  };
  let members, hexes, geo, sido;
  try {
    [members, hexes, geo, sido] = await Promise.all(["members.json", "hex.json", "districts.geojson", "sido.geojson"].map(load));
  } catch {
    $("#panel").innerHTML = `<p class="ov-sub">지도 자료를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.</p>`;
    return;
  }
  for (const f of geo.features) {
    const m = members.district[f.properties.key];
    f.properties.party = m ? m.party : "공석";
  }
  Object.assign(state, { members, hexes, geo, sido });
  // 선거 결과는 없어도 지도는 보이게 따로 받음
  load("results.json").then((r) => { state.results = r; if (state.sel) select(state.sel, false); }).catch(() => {});
  // 판세 + 검증 수치(calibration) + 재합산 정확도(accuracy): 안내문·팝업이 같이 쓰므로 함께 받음
  Promise.all([load("outlook.json"), load("calibration.json").catch(() => null), load("accuracy.json").catch(() => null)]).then(([o, cal, acc]) => {
    Object.assign(state, { outlook: o, cal, acc });
    applyEnv(o.env_default);
    if (state.mode === "outlook") refreshMode();
    if (!methodHidden()) openMethod(true);
  }).catch(() => {});
  load("chairs.json").then((c) => { state.chairs = c; if (state.sel) select(state.sel, false); else if (state.mode === "outlook") showOverview(); }).catch(() => {});
  state.counts = partyCounts();
  $("#asof").textContent = members.fetched.replace(/-/g, ".") + " 기준";
  $("#prcount").textContent = members.pr.length;

  trackBarHeight();
  drawScore();
  drawParties();
  drawGeo();
  drawHex();
  drawPR();
  setupSearch();
  setupTabs();
  setupMode();

  if (new URLSearchParams(location.search).get("mode") === "outlook") setMode("outlook");
  const fromHash = decodeURIComponent(location.hash.slice(1));
  if (fromHash && (members.district[fromHash] || members.vacant.includes(fromHash))) select(fromHash);
  else showOverview();
}

// 고정 띠 높이를 CSS 변수로(패널·지도 높이 계산용)
function trackBarHeight() {
  const set = () => document.documentElement.style.setProperty("--bar-h", $("#bar").offsetHeight + "px");
  new ResizeObserver(set).observe($("#bar"));
  set();
}

// ── 의석 집계 ───────────────────────────────────────────
function partyCounts() {
  const c = {};
  const add = (p, k) => { c[p] ??= { party: p, district: 0, pr: 0 }; c[p][k]++; };
  Object.values(state.members.district).forEach((m) => add(m.party, "district"));
  state.members.pr.forEach((m) => add(m.party, "pr"));
  const rank = (p) => { const i = PARTY_ORDER.indexOf(p); return i < 0 ? PARTY_ORDER.length - 1.5 : i; };
  const list = Object.values(c).map((x) => ({ ...x, total: x.district + x.pr })).sort((a, b) => rank(a.party) - rank(b.party));
  const vac = state.members.vacant.length;
  if (vac) list.push({ party: "공석", district: vac, pr: 0, total: vac });
  return list;
}

// ── 상단 띠: 막대 + 1·2당 ───────────────────────────────
function drawScore() {
  $("#seatbar").innerHTML = state.counts.map((x) =>
    `<span data-p="${esc(x.party)}" style="flex:${x.total}" title="${esc(x.party)} ${x.total}석"></span>`).join("");
  const top = state.counts.filter((x) => x.party !== "공석").sort((a, b) => b.total - a.total);
  const [a, b] = [top[0], top[1]].sort((x, y) => PARTY_ORDER.indexOf(x.party) - PARTY_ORDER.indexOf(y.party));
  $("#leadL").innerHTML = `<i style="background:${colorOf(a.party)}"></i>${esc(a.party)} <b>${a.total}</b>`;
  $("#leadR").innerHTML = `<b>${b.total}</b> ${esc(b.party)}<i style="background:${colorOf(b.party)}"></i>`;
  paintScore();
}
function paintScore() {
  $$("#seatbar span").forEach((s) => {
    const p = s.dataset.p;
    s.style.background = p === "공석" && (!state.party || state.party === "공석")
      ? "repeating-linear-gradient(135deg,#fff 0 3px,#c9ccd2 3px 6px)" : paint(p);
  });
}

// ── 정당 선택 ───────────────────────────────────────────
function drawParties() {
  const byTotal = [...state.counts].sort((a, b) => (a.party === "공석") - (b.party === "공석") || b.total - a.total);
  $("#parties").innerHTML = byTotal.map((x) =>
    `<button data-p="${esc(x.party)}" style="--c:${x.party === "공석" ? "#888" : colorOf(x.party)}" aria-pressed="false">
       <i style="background:${colorOf(x.party)};${x.party === "공석" ? "box-shadow:inset 0 0 0 1px #888" : ""}"></i>${esc(x.party)} <b>${x.total}</b>
     </button>`).join("");
  $("#parties").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    setParty(state.party === b.dataset.p ? null : b.dataset.p);
  };
}

// 예상 격차 = 지역구 성향 + 전국 분위기 → 승리 확률 → 등급 (scripts/build_outlook.py 와 같은 기준)
// 승리 확률 = Φ(예상 격차 / σ), σ는 과거 총선 검증으로 정한 값(민주 불리 쪽 5.0 · 유리 쪽 7.5, scripts/calibrate.py)
function erf(x) {   // Abramowitz–Stegun 7.1.26 (오차 1.5e-7)
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x < 0 ? -y : y;
}
const probOf = (m) => { const [l, r] = state.outlook?.sigma || [5, 7.5]; return 0.5 * (1 + erf(m / (m < 0 ? l : r) / Math.SQRT2)); };
const gradeOf = (m) => { const p = probOf(m); return p >= 0.9 ? "우세" : p >= 0.7 ? "경합우세" : p > 0.3 ? "경합" : p > 0.1 ? "경합열세" : "열세"; };
const pct = (m) => { const p = Math.round(probOf(m) * 100); return p >= 99 ? "99% 이상" : p <= 1 ? "1% 미만" : p + "%"; };
// 등급 경계를 예상 격차로: 확률 90·70·30·10% 지점
const GRADE_CUTS = () => { const [l, r] = state.outlook?.sigma || [5, 7.5]; return [1.2816 * r, 0.5244 * r, -0.5244 * l, -1.2816 * l].map((x) => Math.round(x * 10) / 10); };
function gradeRange(i) {
  const c = GRADE_CUTS(), f = (x) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(1);
  return ["격차 " + f(c[0]) + " 이상", f(c[1]) + " ~ " + f(c[0]), f(c[2]) + " ~ " + f(c[1]), f(c[3]) + " ~ " + f(c[2]), f(c[3]) + " 미만"][i];
}
const GRADE_PROB = ["90% 이상", "70~90%", "30~70%", "10~30%", "10% 미만"];
// 권역: 시도 → 수도권·충청·호남·부울경·대구·경북·강원·제주 (outlook.json region)
const regionOf = (key) => state.outlook?.region?.[key.split(" ")[0]] || "";
const REGIONS = ["수도권", "충청", "호남", "부울경", "대구·경북", "강원·제주"];
function applyEnv(env) {
  state.env = env;
  for (const [k, d] of Object.entries(state.outlook.district)) {
    d.adj = state.regAdj[regionOf(k)] || 0;
    d.exp = Math.round((d.lean + env + d.adj) * 10) / 10;
    d.grade = gradeOf(d.exp);
  }
  for (const f of state.geo.features) f.properties.grade = state.outlook.district[f.properties.key]?.grade || "";
  state.map?.getSource("d")?.setData(state.geo);
}

// 판세 모드의 띠: 우세~열세 버튼(누르면 그 등급만 표시)
function drawGrades() {
  const n = (g) => Object.values(state.outlook?.district || {}).filter((d) => d.grade === g).length;
  $("#parties").innerHTML = GRADES.map(([g, c]) =>
    `<button data-g="${g}" style="--c:${c}" aria-pressed="false"><i style="background:${c}"></i>${g} <b>${n(g)}</b></button>`).join("");
  $("#parties").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    setGrade(state.grade === b.dataset.g ? null : b.dataset.g);
  };
}

function setGrade(g) {
  state.grade = g;
  $("#parties").classList.toggle("filtering", !!g);
  $$("#parties button").forEach((b) => { b.classList.toggle("on", b.dataset.g === g); b.setAttribute("aria-pressed", b.dataset.g === g); });
  repaint();
  if (state.mode === "outlook" && !state.sel && state.outlook) { state.listScroll = 0; showOutlookOverview(); }
}

// ── 색칠 기준: 현재 의원 / 판세 ───────────────────────────
document.addEventListener("keydown", (e) => {
  if (state.mode !== "outlook" || !state.sel || e.target.closest("input")) return;
  if (e.key === "Escape") clearSelection();
  if (e.key === "ArrowLeft" || e.key === "ArrowUp") $("#prevK")?.click();
  if (e.key === "ArrowRight" || e.key === "ArrowDown") { $("#nextK")?.click(); }
});
function setupMode() {
  $(".seg.mode").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-mode]");
    if (b) setMode(b.dataset.mode);
  });
}
function setMode(m) {
  state.mode = m;
  $$(".seg.mode button").forEach((b) => { b.classList.toggle("on", b.dataset.mode === m); b.setAttribute("aria-pressed", b.dataset.mode === m); });
  const u = new URL(location.href);
  m === "outlook" ? u.searchParams.set("mode", "outlook") : u.searchParams.delete("mode");
  history.replaceState(null, "", u);
  refreshMode();
}
function refreshMode() {
  state.party = null; state.grade = null;
  $("#parties").classList.remove("filtering");
  state.mode === "outlook" ? drawGrades() : drawParties();
  repaint();
  paintScore();
  state.sel ? select(state.sel, false) : showOverview();
}
// 지도·육각형 색 다시 칠하기
function repaint() {
  if (state.map?.getLayer("fill")) state.map.setPaintProperty("fill", "fill-color", fillExpr());
  $$("#hex .cell").forEach((c) => c.setAttribute("fill", cellColor(c.dataset.key)));
}

function setParty(p) {
  state.party = p;
  $("#parties").classList.toggle("filtering", !!p);
  $$("#parties button").forEach((b) => { b.classList.toggle("on", b.dataset.p === p); b.setAttribute("aria-pressed", b.dataset.p === p); });
  paintScore();
  repaint();
  $$("#view-pr .prgroup").forEach((g) => (g.hidden = !!p && g.dataset.p !== p));
  $$(".hemi circle").forEach((c) => c.setAttribute("fill", paint(c.dataset.p)));
  $$(".table tr[data-p]").forEach((r) => (r.style.opacity = !p || r.dataset.p === p ? 1 : 0.4));
}

// ── 실제 지도 ───────────────────────────────────────────
function fillExpr() {
  if (state.mode === "outlook") {
    const g = ["match", ["get", "grade"]];
    for (const [k] of GRADES) g.push(k, gpaint(k));
    g.push("#B8BBC2");
    return g;
  }
  const e = ["match", ["get", "party"]];
  for (const p of [...Object.keys(PARTY_COLOR), "공석"]) e.push(p, paint(p));
  e.push(state.party ? OFF : "#B8BBC2");
  return e;
}

function drawGeo() {
  const map = new maplibregl.Map({
    container: "map",
    style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#eef0f1" } }] },
    bounds: KOREA,
    fitBoundsOptions: { padding: { top: 64, bottom: 24, left: 24, right: 24 } },
    minZoom: 5, maxZoom: 13,
    dragRotate: false, pitchWithRotate: false,
    attributionControl: { compact: true, customAttribution: "선거구 경계 © 오마이뉴스 · 독도 해안선 © OpenStreetMap 기여자" },
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  state.map = map;

  // 화면 크기가 바뀌면 다시 맞춤(사용자가 지도를 움직이기 전까지는 전국이 다 보이게)
  let touched = false;
  map.on("dragstart", () => (touched = true));
  map.on("wheel", () => (touched = true));
  new ResizeObserver(() => {
    map.resize();
    if (!touched && !state.sel) map.fitBounds(KOREA, { padding: { top: 64, bottom: 24, left: 24, right: 24 }, duration: 0 });
  }).observe($("#map"));

  map.on("load", () => {
    map.addSource("d", { type: "geojson", data: state.geo });
    map.addSource("s", { type: "geojson", data: state.sido });
    map.addLayer({ id: "fill", type: "fill", source: "d", paint: { "fill-color": fillExpr(), "fill-color-transition": { duration: 250 } } });
    map.addLayer({ id: "line", type: "line", source: "d", paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.35, 10, 1.2] } });
    map.addLayer({ id: "vacant", type: "line", source: "d", filter: ["==", ["get", "party"], "공석"], paint: { "line-color": "#6b7079", "line-width": 1, "line-dasharray": [2, 2] } });
    map.addLayer({ id: "sido", type: "line", source: "s", paint: { "line-color": "rgba(17,19,24,0.55)", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 10, 1.6] } });
    map.addLayer({ id: "hover", type: "line", source: "d", filter: ["==", ["get", "key"], ""], paint: { "line-color": "#111318", "line-width": 1.6 } });
    map.addLayer({ id: "sel", type: "line", source: "d", filter: ["==", ["get", "key"], ""], paint: { "line-color": "#111318", "line-width": 3 } });
    if (state.sel) highlightGeo(state.sel, true);

    // 독도: 전국 지도에서는 섬이 점보다 작아 이름표를 항상 붙여 둠(누르면 포항남구·울릉 선거구)
    const dokdo = document.createElement("button");
    dokdo.className = "dokdo";
    dokdo.textContent = "독도";
    dokdo.title = "독도 · 경북 울릉군 울릉읍 독도리 (경북 포항시남구울릉군 선거구)";
    dokdo.addEventListener("click", () => select("경북 포항시남구울릉군", false));
    new maplibregl.Marker({ element: dokdo, anchor: "left", offset: [4, 0] }).setLngLat([131.8735, 37.2405]).addTo(map);   // 동도 동쪽 끝 바로 옆, 섬 모양을 가리지 않게

    map.on("mousemove", "fill", (e) => {
      const k = e.features[0].properties.key;
      map.getCanvas().style.cursor = "pointer";
      map.setFilter("hover", ["==", ["get", "key"], k]);
      showTip(k, e.originalEvent);
    });
    map.on("mouseleave", "fill", () => {
      map.getCanvas().style.cursor = "";
      map.setFilter("hover", ["==", ["get", "key"], ""]);
      hideTip();
    });
    map.on("click", "fill", (e) => select(e.features[0].properties.key, false));
  });
}

function bboxOf(key) {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  const walk = (c) => typeof c[0] === "number"
    ? (x0 = Math.min(x0, c[0]), y0 = Math.min(y0, c[1]), x1 = Math.max(x1, c[0]), y1 = Math.max(y1, c[1]))
    : c.forEach(walk);
  state.geo.features.filter((f) => f.properties.key === key).forEach((f) => walk(f.geometry.coordinates));
  return [[x0, y0], [x1, y1]];
}

function highlightGeo(key, fly) {
  const map = state.map;
  if (!map?.getLayer("sel")) return;
  map.setFilter("sel", ["==", ["get", "key"], key || ""]);
  if (key && fly) map.fitBounds(bboxOf(key), { padding: { top: 80, bottom: 40, left: 40, right: 40 }, maxZoom: 9.5, duration: 800 });
}

// ── 육각형 지도 ─────────────────────────────────────────
function drawHex() {
  const S = 14, W = Math.sqrt(3) * S, H = 1.5 * S, PAD = 16;
  const center = (c, r) => [PAD + W / 2 + (c + (r & 1 ? 0.5 : 0)) * W, PAD + S + r * H];
  const corners = (x, y) => Array.from({ length: 6 }, (_, i) => {
    const a = Math.PI / 180 * (60 * i - 90);
    return [x + S * Math.cos(a), y + S * Math.sin(a)];
  });
  const byPos = new Map();
  const cells = state.hexes.map((h) => {
    const [x, y] = center(h.c, h.r);
    const cell = { ...h, x, y, pts: corners(x, y) };
    byPos.set(`${Math.round(x)},${Math.round(y)}`, cell);
    return cell;
  });
  const maxX = Math.max(...cells.map((c) => c.x)) + W / 2 + PAD;
  const maxY = Math.max(...cells.map((c) => c.y)) + S + PAD;

  // 시도 경계: 이웃 칸이 다른 시도(또는 빈칸)인 변만 그림
  const edges = [];
  for (const c of cells) {
    for (let i = 0; i < 6; i++) {
      const a = c.pts[i], b = c.pts[(i + 1) % 6];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const n = byPos.get(`${Math.round(2 * mx - c.x)},${Math.round(2 * my - c.y)}`);
      if (!n || n.sido !== c.sido) edges.push(`M${a[0].toFixed(1)},${a[1].toFixed(1)}L${b[0].toFixed(1)},${b[1].toFixed(1)}`);
    }
  }

  // 시도 이름: 각 시도 칸들의 중심에 가장 가까운 칸 위
  const groups = cells.reduce((g, c) => ((g[c.sido] ??= []).push(c), g), {});
  const labels = Object.entries(groups).map(([s, list]) => {
    const ax = list.reduce((t, c) => t + c.x, 0) / list.length, ay = list.reduce((t, c) => t + c.y, 0) / list.length;
    const best = list.reduce((b, c) => (Math.hypot(c.x - ax, c.y - ay) < Math.hypot(b.x - ax, b.y - ay) ? c : b));
    return `<text class="sidolabel" x="${best.x.toFixed(1)}" y="${(best.y + 3.5).toFixed(1)}" text-anchor="middle">${esc(s)}</text>`;
  });

  const svg = $("#hex");
  svg.setAttribute("viewBox", `0 0 ${maxX.toFixed(0)} ${maxY.toFixed(0)}`);
  svg.innerHTML =
    cells.map((c) => {
      const m = state.members.district[c.key];
      const party = m ? m.party : "공석";
      return `<polygon class="cell" data-key="${esc(c.key)}" data-party="${esc(party)}" points="${c.pts.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ")}" fill="${cellColor(c.key)}"${m ? "" : ' stroke-dasharray="3 2" style="stroke:#6b7079"'}/>`;
    }).join("") +
    `<path class="sidoline" d="${edges.join("")}"/>` + labels.join("");

  svg.addEventListener("mousemove", (e) => {
    const t = e.target.closest(".cell");
    t ? showTip(t.dataset.key, e) : hideTip();
  });
  svg.addEventListener("mouseleave", hideTip);
  svg.addEventListener("click", (e) => {
    const t = e.target.closest(".cell");
    if (t) select(t.dataset.key, false);
  });
}

function highlightHex(key) {
  $$("#hex .cell.sel").forEach((c) => c.classList.remove("sel"));
  if (!key) return;
  const el = document.querySelector(`#hex .cell[data-key="${CSS.escape(key)}"]`);
  // 굵은 테두리가 이웃 칸에 가리지 않게 칸들 중 맨 위로
  if (el) { el.classList.add("sel"); el.parentNode.insertBefore(el, el.parentNode.querySelector(".sidoline")); }
}

// ── 비례대표 ───────────────────────────────────────────
function drawPR() {
  const groups = {};
  state.members.pr.forEach((m, i) => (groups[m.party] ??= []).push([m, i]));
  const order = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length || a.localeCompare(b));
  $("#pr").innerHTML = order.map((p) => `
    <section class="prgroup" data-p="${esc(p)}">
      <h3><i style="background:${colorOf(p)}"></i>${esc(p)} <small>${groups[p].length}명</small></h3>
      <div class="prgrid">${groups[p].map(([m, i]) => `
        <button class="prcard" data-i="${i}">
          <img src="${esc(m.photo)}" alt="" loading="lazy">
          <b>${esc(m.name)}</b><small>${esc(m.reele)}</small>
        </button>`).join("")}
      </div>
    </section>`).join("");
  $("#pr").addEventListener("click", (e) => {
    const b = e.target.closest(".prcard");
    if (b) showMember(state.members.pr[+b.dataset.i], null);
  });
}

// ── 오른쪽 패널: 전체 현황(반원 의석도) ─────────────────
function hemicycle() {
  const total = state.counts.reduce((t, x) => t + x.total, 0);
  const rows = 9, r0 = 0.42;
  const radii = Array.from({ length: rows }, (_, i) => r0 + (1 - r0) * i / (rows - 1));
  const sumR = radii.reduce((a, b) => a + b, 0);
  const per = radii.map((r) => Math.round(total * r / sumR));
  per[rows - 1] += total - per.reduce((a, b) => a + b, 0);
  const seats = [];
  radii.forEach((r, i) => {
    for (let k = 0; k < per[i]; k++) {
      const t = Math.PI * (1 - k / (per[i] - 1));
      seats.push({ t, r, x: r * Math.cos(t), y: -r * Math.sin(t) });
    }
  });
  seats.sort((a, b) => b.t - a.t || a.r - b.r);
  const owners = state.counts.flatMap((x) => Array(x.total).fill(x.party));
  const dot = (1 - r0) / (rows - 1) * 0.42;
  const lead = [...state.counts].filter((x) => x.party !== "공석").sort((a, b) => b.total - a.total)[0];
  return `<svg class="hemi" viewBox="-1.06 -1.06 2.12 1.12" role="img" aria-label="정당별 의석 반원 그림">
    ${seats.map((s, i) => `<circle data-p="${esc(owners[i])}" cx="${s.x.toFixed(4)}" cy="${s.y.toFixed(4)}" r="${dot.toFixed(4)}" fill="${paint(owners[i])}"${owners[i] === "공석" ? ' stroke="#8a8f99" stroke-width="0.006"' : ""}/>`).join("")}
    <g transform="scale(0.0042)"><text class="num" x="0" y="-24" text-anchor="middle">${total}</text><text class="cap" x="0" y="-2" text-anchor="middle">전체 의석 · 1당 ${esc(lead.party)}</text></g>
  </svg>`;
}

function showOverview() {
  if (state.mode === "outlook") return showOutlookOverview();
  const rows = [...state.counts].sort((a, b) => (a.party === "공석") - (b.party === "공석") || b.total - a.total);
  $("#panel").innerHTML = `
    <h2 class="ov-title">지금 국회는</h2>
    <p class="ov-sub">지역구를 누르면 그 지역 의원이 나와요.</p>
    ${hemicycle()}
    <table class="table">
      <thead><tr><th>정당</th><th>지역구</th><th>비례</th><th>합계</th></tr></thead>
      <tbody>${rows.map((x) => `<tr data-p="${esc(x.party)}"><td><i style="background:${colorOf(x.party)};${x.party === "공석" ? "box-shadow:inset 0 0 0 1px #888" : ""}"></i>${esc(x.party)}</td><td>${x.district}</td><td>${x.pr || "–"}</td><td>${x.total}</td></tr>`).join("")}</tbody>
    </table>`;
  $("#panel tbody").addEventListener("click", (e) => {
    const r = e.target.closest("tr"); if (r) setParty(state.party === r.dataset.p ? null : r.dataset.p);
  });
  setParty(state.party);
}

// ── 선택 / 의원 정보 ───────────────────────────────────
// fly: 검색·주소로 고른 경우 그 지역구로 지도 이동
function select(key, fly = true) {
  state.sel = key;
  highlightGeo(key, fly && state.view === "geo");
  highlightHex(key);
  history.replaceState(null, "", "#" + encodeURIComponent(key));
  const m = state.members.district[key];
  if (state.mode === "outlook") return showOutlook(key, m);
  if (m) return showMember(m, key);
  $("#panel").innerHTML = `${backBtn()}<p class="where"><span>지역구</span><b>${esc(key)}</b></p>
    <div class="vacant"><b>공석</b> — 재보궐선거 전까지 이 지역구의 국회의원이 없어요.</div>
    ${electionHTML(key, null)}`;
  bindBack();
}

function clearSelection() {
  state.sel = null;
  highlightGeo(null);
  highlightHex(null);
  history.replaceState(null, "", location.pathname + location.search);
  showOverview();
}

const backBtn = () => `<button class="back" id="back">← 전체 현황</button>`;
const bindBack = () => $("#back").addEventListener("click", clearSelection);

function showMember(m, key) {
  const age = m.birth ? Math.floor((Date.now() - new Date(m.birth)) / 31557600000) : null;
  $("#panel").innerHTML = `
    ${backBtn()}
    <p class="where"><span>${key ? "지역구" : "비례대표"}</span><b>${esc(key || m.party + " 비례대표")}</b></p>
    <div class="person">
      ${m.photo ? `<img src="${esc(m.photo)}" alt="${esc(m.name)} 의원 사진">` : "<div></div>"}
      <div>
        <p class="nm">${esc(m.name)}</p>
        <p class="hj">${esc(m.hanja)}</p>
        <span class="party-tag"><i style="background:${colorOf(m.party)}"></i>${esc(m.party)}</span>
      </div>
    </div>
    ${snsHTML(m.sns)}
    <ul class="facts">
      <li><span>당선</span>${esc(m.reele)}</li>
      ${age ? `<li><span>나이</span>${age}세 · ${esc(m.sex)}</li>` : ""}
      ${m.cmit ? `<li><span>위원회</span>${esc(m.cmit)}</li>` : ""}
      ${m.office ? `<li><span>사무실</span>${esc(m.office)}</li>` : ""}
      ${m.tel ? `<li><span>전화</span>${esc(m.tel)}</li>` : ""}
      ${m.home ? `<li><span>홈페이지</span><a href="${esc(m.home)}" target="_blank" rel="noopener">${esc(m.home.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a></li>` : ""}
    </ul>
    ${key ? electionHTML(key, m.name) : ""}
    ${key && state.outlook ? `<button class="to-outlook" id="toOutlook">이 지역구 판세 · 민주당 지역위원장 보기 →</button>` : ""}`;
  bindBack();
  $("#toOutlook")?.addEventListener("click", () => setMode("outlook"));
  if (window.matchMedia("(max-width: 1080px)").matches) {
    const y = $("#panel").getBoundingClientRect().top + scrollY - $("#bar").offsetHeight - 12;
    window.scrollTo({ top: y, behavior: "smooth" });
  }
}

// ── SNS ───────────────────────────────────────────────
const SNS = [
  ["youtube", "유튜브", "#FF0033", '<path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3z"/>'],
  ["facebook", "페이스북", "#0866FF", '<path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12z"/>'],
  ["blog", "블로그", "#03C75A", '<path d="M4 3h16a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-5.5L12 21l-2.5-3H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm3.2 4.5v6h2.3c1.3 0 2.1-.7 2.1-1.7 0-.7-.4-1.2-1-1.4.5-.2.8-.7.8-1.2 0-1-.8-1.7-2-1.7zm1.4 1.1h.8c.4 0 .7.2.7.6s-.3.6-.7.6h-.8zm0 2.2h.9c.5 0 .8.3.8.7s-.3.7-.8.7h-.9zm4.6-3.3v6h1.4v-6z"/>'],
  ["x", "X", "#111318", '<path d="M17.8 3h3.1l-6.8 7.7 8 10.3h-6.2l-4.9-6.3L5.4 21H2.3l7.2-8.3L1.8 3h6.4l4.4 5.8zm-1.1 16.2h1.7L7.4 4.7H5.6z"/>'],
];
function snsHTML(sns) {
  const links = SNS.filter(([k]) => sns?.[k]);
  if (!links.length) return "";
  return `<div class="sns">${links.map(([k, label, c, path]) =>
    `<a href="${esc(sns[k])}" target="_blank" rel="noopener" style="--c:${c}" title="${label}"><svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>${label}</a>`).join("")}</div>`;
}

// ── 선거 결과 ─────────────────────────────────────────
const n0 = (x) => x.toLocaleString("ko-KR");
const p1 = (x) => x.toFixed(2).replace(/\.?0+$/, "");

// 이 의원이 당선된 선거(재보궐이 있으면 그것) + 그 전 총선 결과
function electionHTML(key, name) {
  if (!state.results) return "";
  const found = state.results.elections
    .map((e) => ({ e, r: e.district[key] }))
    .filter((x) => x.r);
  if (!found.length) return "";
  const won = [...found].reverse().find((x) => x.r.cands[0].name === name) || found[found.length - 1];
  const before = found.filter((x) => x !== won && x.e.date < won.e.date);
  return `<section class="elec">
      ${raceHTML(won, true)}
      ${before.map((x) => `<details class="prev"><summary>${esc(x.e.name)} 결과 보기 <small>${esc(x.e.date)} · ${esc(x.r.cands[0].name)} 당선</small></summary>${raceHTML(x, false)}</details>`).join("")}
      <p class="src">출처 중앙선거관리위원회 선거통계시스템</p>
    </section>`;
}

function raceHTML({ e, r }, main) {
  const [w, s] = r.cands;
  const top = r.cands[0].votes;
  const head = main
    ? `<div class="elec-head"><h3>${esc(e.name)} 결과</h3><span>${esc(e.date)}</span></div>
       <p class="margin">${s
         ? `<b>${p1(w.pct)}%</b>로 당선 · 2위 ${esc(s.name)}<small>(${esc(s.party)})</small>에 <b>${n0(w.votes - s.votes)}표</b>(${p1(w.pct - s.pct)}%p) 앞섬`
         : `<b>${p1(w.pct)}%</b>로 당선`}</p>`
    : "";
  return `${head}
    <ol class="cands">${r.cands.map((c, i) => `
      <li class="${i === 0 ? "win" : ""}">
        <div class="c-top"><span class="c-nm"><i style="background:${colorOf(c.party)}"></i>${esc(c.name)}<small>${esc(c.party)}</small></span>
          <span class="c-pct">${p1(c.pct)}%</span></div>
        <div class="c-bar"><span style="width:${(c.votes / top) * 100}%;background:${colorOf(c.party)}"></span></div>
        <div class="c-v">${n0(c.votes)}표${i === 0 ? " · 당선" : ""}</div>
      </li>`).join("")}
    </ol>
    <p class="turnout">투표율 <b>${p1((r.turnout / r.electors) * 100)}%</b> · 선거인 ${n0(r.electors)}명 · 투표 ${n0(r.turnout)}명 · 무효 ${n0(r.invalid)}표</p>
    ${r.areas.length ? `<div class="areas"><p class="areas-t">지역별 득표율</p>
      ${r.areas.map((a) => `<div class="area"><span>${esc(a.name)}</span>
        <div class="stack">${a.pct.map((p, i) => p ? `<span style="width:${p}%;background:${colorOf(r.cands[i].party)}" title="${esc(r.cands[i].name)} ${p1(p)}%"></span>` : "").join("")}</div>
        <small>${esc(r.cands[0].name)} ${p1(a.pct[0])} · ${esc(r.cands[1].name)} ${p1(a.pct[1])}</small></div>`).join("")}
    </div>` : ""}`;
}

// ── 판세 · 민주당 지역위원장 ────────────────────────────
const signed = (x) => (x > 0 ? "+" : x < 0 ? "−" : "±") + Math.abs(x).toFixed(1);
const leanTag = (x) => x > 0 ? `민+${x.toFixed(1)}` : x < 0 ? `국+${(-x).toFixed(1)}` : "중립";
const leanSay = (x) => x > 0 ? `전국 평균보다 더불어민주당 쪽으로 ${x.toFixed(1)}%p 기운 곳` : x < 0 ? `전국 평균보다 국민의힘 쪽으로 ${(-x).toFixed(1)}%p 기운 곳` : "전국 평균과 같은 곳";
const envLabel = (x) => x > 0 ? `민주 +${x.toFixed(1)}%p` : x < 0 ? `국민의힘 +${(-x).toFixed(1)}%p` : "양당 같음";
const chairOf = (key) => state.chairs?.district[key];
const chairName = (key) => chairOf(key)?.chair?.name || "";
const naverNews = (q) => "https://search.naver.com/search.naver?where=news&sort=1&query=" + encodeURIComponent(q);
const highCount = (key) => (chairOf(key)?.news || []).filter((n) => n.level === "high").length;

// 오른쪽 목록: 경합권 / 전체 / 리스크 탭. 지역구를 눌렀다 돌아와도 탭·스크롤 위치 유지
const LIST_TABS = [["close", "경합권"], ["all", "전체"], ["risk", "리스크"]];
function listKeys(tab) {
  const d = state.outlook.district;
  let keys = Object.keys(d);
  if (state.grade) keys = keys.filter((k) => d[k].grade === state.grade);
  if (tab === "close") return keys.filter((k) => ["경합우세", "경합", "경합열세"].includes(d[k].grade)).sort((a, b) => Math.abs(d[a].exp) - Math.abs(d[b].exp));
  if (tab === "risk") return keys.filter((k) => highCount(k) || (chairOf(k)?.news || []).length)
    .sort((a, b) => highCount(b) - highCount(a) || (chairOf(b)?.news.length || 0) - (chairOf(a)?.news.length || 0));
  return keys.sort((a, b) => d[b].exp - d[a].exp);
}

// 판세 산출 방법 팝업: 방법론 출처(Cook PVI · Antony Green 스윙) + 검증 결과
// 처음 들어오면 자동으로 뜨고, '다시 보지 않기'를 누르면 이 브라우저에서는 다음부터 자동으로 안 뜸
const METHOD_KEY = "methodHidden";
function methodHidden() {
  try { return localStorage.getItem(METHOD_KEY) === "1"; } catch { return false; }
}
function openMethod(auto = false) {
  const o = state.outlook;
  $("#method")?.remove();
  const box = document.createElement("div");
  box.id = "method";
  box.innerHTML = `<div class="m-card" role="dialog" aria-modal="true" aria-labelledby="m-title">
    <button class="m-x" aria-label="닫기">×</button>
    <p class="m-kicker">METHODOLOGY</p>
    <h2 id="m-title">판세 산출 방법</h2>
    <p class="m-lead">미국·호주 선거 분석에서 쓰는 방식을 22대 254개 지역구에 맞춰 적용</p>

    <div class="m-eq">
      <div><small>STEP 1</small><b>지역구 성향</b><em>Cook PVI 방식</em></div>
      <i>+</i>
      <div><small>STEP 2</small><b>전국 분위기</b><em>스윙 계산 방식</em></div>
      <i>=</i>
      <div class="m-res"><small>STEP 3</small><b>예상 격차</b><em>→ 승리 확률 → 등급</em></div>
    </div>

    <section>
      <h3><span>1</span>지역구 성향 — 미국 Cook Political Report ‘PVI’</h3>
      <ul>
        <li>PVI(Partisan Voter Index, 정당 성향 지수): 미국에서 지역구가 전국 평균보다 어느 당 쪽으로 몇 %p 기우는지 나타내는 지수</li>
        <li>표기: <b>D+5</b> = 전국보다 민주당(Democratic) 쪽으로 5%p · <b>R+3</b> = 공화당(Republican) 쪽으로 3%p · EVEN = 전국과 같음</li>
        <li>계산: 지역구 대선 득표율 − 전국 대선 득표율, 최근 대선 75%·직전 대선 25% 반영(2022년부터)</li>
        <li><b>이 지도</b>: 선거마다 (지역구 격차 − 전국 평균 격차)를 구해 세 선거 평균 · 표기는 <b>민+5</b>(전국보다 더불어민주당 쪽) · <b>국+3</b>(국민의힘 쪽)</li>
      </ul>
    </section>
    <section>
      <h3><span>2</span>전국 분위기 — 호주 ABC Antony Green ‘스윙 계산기’</h3>
      <ul>
        <li>스윙(swing): 전국 지지율이 한쪽으로 움직인 폭 · 이 폭을 입력하면 모든 지역구에 똑같이 더해 결과를 다시 계산하는 방식</li>
        <li><b>이 지도</b>: 판세 현황의 막대 · 기본값 ${signed(o.env_default)} = 최근 세 선거 전국 평균 격차(${signed(o.national.g22)} · ${signed(o.national.p21)} · ${signed(o.national.l9)})의 평균</li>
      </ul>
    </section>
    <section>
      <h3><span>3</span>예상 격차 → 승리 확률 → 등급</h3>
      <ul>
        <li>승리 확률: 과거 총선에서 예상 격차가 이만큼이던 지역구가 실제로 몇 % 이겼는지를 공식으로 만든 값 (미국 FiveThirtyEight·Economist 예측 모델과 비슷한 원리 — 과거 예측 오차로 확률을 냄)</li>
        <li>계산: 정규분포 Φ(예상 격차 ÷ σ) · σ = 예측이 빗나가는 정도 · 민주 불리 쪽 ${(o.sigma || [5, 7.5])[0]} · 유리 쪽 ${(o.sigma || [5, 7.5])[1]}(불리한 곳은 예상보다 더 크게 지는 일이 많아 따로 맞춤)</li>
        <li>예: 예상 격차 +3 → ${pct(3)} · +6 → ${pct(6)} · −3 → ${pct(-3)}</li>
      </ul>
      <div class="m-grades">${GRADES.map(([g, c], i) => `<span style="--c:${c}"><b>${g}</b>${GRADE_PROB[i]}<small>${gradeRange(i)}</small></span>`).join("")}</div>
    </section>

    <section>
      <h3><span>4</span>예상 의석 — 모의 선거 2,000번</h3>
      <ul>
        <li>지역구마다 승리 확률대로 모의 선거를 2,000번 치러 민주 계열 지역구 의석을 셈 · 평균 = 예상 의석, 가운데 80% = 범위 (FiveThirtyEight·Economist 의석 전망과 비슷한 원리)</li>
        <li>한 권역이 통째로 같이 움직이는 일을 반영해 권역별로 ±${o.sigma_region || 4}%p씩 함께 흔듦 — 이 폭을 빼면 범위가 너무 좁아져 과거 실제 의석이 범위 밖으로 나감</li>
      </ul>
      ${state.cal?.seats ? `<div class="m-stats m-stats2">
        ${["2024", "2020"].map((y) => { const v = state.cal.seats[y]; return `<div><b>${v.actual}<small>석</small></b><span>${y} 총선 실제<br>예상 ${v.mean.toFixed(0)}석 · 범위 ${v.lo}~${v.hi}</span></div>`; }).join("")}
      </div><p class="m-note">그해 실제 전국 분위기를 넣고, 그 이전 선거만으로 계산한 결과 · 두 번 모두 실제 의석이 80% 범위 안</p>` : ""}
    </section>

    <section class="m-check">
      <h3>검증 — 과거 총선 두 번을 미리 맞혀 보기</h3>
      <p>과거 선거만으로 같은 방식으로 계산해 실제 총선 결과와 두 번 대조 · 1차 2020·2022 선거 → 2024 총선 · 2차 2016·2017·2018 선거 → 2020 총선</p>
      ${checkHTML(true)}
    </section>

    <section>
      <h3>용어 풀이</h3>
      <dl class="m-gloss">
        <dt>%p</dt><dd>퍼센트포인트 · 비율끼리 뺀 차이 (51%와 46%의 차이 = 5%p)</dd>
        <dt>격차</dt><dd>민주당 득표율 − 상대 1위(국민의힘 등 민주당 외 가장 많이 받은 후보) 득표율</dd>
        <dt>지역구 성향</dt><dd>그 지역구가 전국 평균보다 어느 당 쪽으로 기우는 정도 · 민+는 민주당 쪽, 국+는 국민의힘 쪽</dd>
        <dt>전국 분위기</dt><dd>그해 선거에서 전국적으로 민주당이 몇 %p 앞설지에 대한 가정 · 화면의 막대로 정함</dd>
        <dt>예상 격차</dt><dd>지역구 성향 + 전국 분위기 · 그 분위기라면 이 지역구에서 민주당이 몇 %p 앞설지</dd>
        <dt>승리 확률</dt><dd>그 전국 분위기라면 민주 계열 후보가 이길 가능성 · 과거 총선 결과로 맞춘 값</dd>
        <dt>경합</dt><dd>승리 확률 30~70%인 접전 지역 · 경합우세 70~90%, 경합열세 10~30%</dd>
        <dt>적중</dt><dd>예상한 승패가 실제 결과와 맞은 비율</dd>
      </dl>
    </section>
    <section>
      <h3>원래 방식과 다른 점</h3>
      <div class="m-tbl"><table>
        <tr><th></th><th>Cook PVI</th><th>이 지도</th></tr>
        <tr><td>쓰는 선거</td><td>대통령 선거 2회</td><td>총선 · 대선 · 지방선거 3회</td></tr>
        <tr><td>비교 기준</td><td>양당 득표 비율</td><td>민주 − 상대 1위 격차</td></tr>
        <tr><td>전국 기준</td><td>실제 전국 득표</td><td>254개 지역구 단순 평균</td></tr>
        <tr><td>가중치</td><td>최근 75 · 직전 25</td><td>세 선거 같게</td></tr>
      </table></div>
      <p class="m-note">여론조사·후보 요인은 들어가지 않음 · 현역 의원 효과는 과거 총선으로 검증해 보니 해마다 방향이 달라 넣지 않음</p>
    </section>
    <section>
      <h3>대선·지방선거 숫자를 지역구에 맞춘 방법</h3>
      ${accHTML()}
    </section>

    <p class="m-src">참고: <a href="https://www.cookpolitical.com/cook-pvi/2022-partisan-voting-index/state-map-and-list" target="_blank" rel="noopener">Cook Political Report — 2022 Cook PVI</a> · <a href="https://aceproject.org/ero-en/regions/pacific/AU/australia-antony-greens-house-of-reps-calculator" target="_blank" rel="noopener">Antony Green’s House of Reps Calculator (ABC)</a> · 자료: 중앙선거관리위원회 선거통계시스템</p>
    <div class="m-btns">
      ${auto ? `<button class="m-hide">다시 보지 않기</button>` : ""}
      <button class="m-close">확인</button>
    </div>
  </div>`;
  document.body.append(box);
  const close = () => { box.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  box.addEventListener("click", (e) => {
    if (e.target.closest(".m-hide")) { try { localStorage.setItem(METHOD_KEY, "1"); } catch {} close(); }
    else if (e.target === box || e.target.closest(".m-x, .m-close")) close();
  });
  box.querySelector(".m-close").focus({ preventScroll: true });
}

// 예상 의석: 권역마다 함께 흔들리는 폭(sigma_region) + 지역구 승리 확률로 2000번 모의 선거 → 평균·80% 범위
// 같은 입력이면 같은 숫자가 나오도록 씨앗 고정 난수(mulberry32)
function seatSim(n = 2000) {
  const o = state.outlook, sr = o.sigma_region || 4;
  let a = 20280412;
  const rnd = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const ds = Object.entries(o.district).map(([k, d]) => [REGIONS.indexOf(regionOf(k)), d.exp]);
  const sims = [];
  for (let i = 0; i < n; i++) {
    const sh = REGIONS.map(() => gauss() * sr);
    let w = 0;
    for (const [r, x] of ds) if (rnd() < probOf(x + (sh[r] || 0))) w++;
    sims.push(w);
  }
  sims.sort((x, y) => x - y);
  return { mean: Math.round(sims.reduce((x, y) => x + y, 0) / n), lo: sims[Math.floor(n * 0.1)], hi: sims[Math.floor(n * 0.9)], total: ds.length };
}
function seatHTML() {
  const s = seatSim(), half = Math.floor(s.total / 2) + 1, pc = (x) => (x / s.total * 100).toFixed(1) + "%";
  return `<p class="sb-h">민주 계열 지역구 예상 의석 <b>${s.mean}석</b> <small>/ ${s.total}석</small></p>
      <div class="sb-bar" title="80% 범위 ${s.lo}~${s.hi}석">
        <span class="sb-rng" style="left:${pc(s.lo)};width:${pc(s.hi - s.lo)}"></span>
        <span class="sb-mean" style="left:${pc(s.mean)}"></span>
        <span class="sb-half" style="left:${pc(half)}"><em>지역구 과반 ${half}</em></span>
      </div>
      <p class="sb-sub">10번 중 8번은 <b>${s.lo}~${s.hi}석</b> 사이 · 지역구만(비례대표 제외) · 위 전국 분위기 기준</p>`;
}

// 검증 결과: calibration.json (scripts/calibrate.py)
function checkHTML(cards) {
  const c = state.cal;
  if (!c) return `<p class="m-note">검증 자료를 불러오지 못했어요</p>`;
  const h = c.hit, g = c.grades, r = (a, b) => Math.round(a / b * 100);
  if (cards) return `<div class="m-stats">
        <div><b>${r(h.r2024, h.n2024)}<small>%</small></b><span>1차 · 2024 총선<br>${h.n2024}곳 중 ${h.r2024}곳 적중</span></div>
        <div><b>${r(h.r2020, h.n2020)}<small>%</small></b><span>2차 · 2020 총선<br>${h.n2020}곳 중 ${h.r2020}곳 적중</span></div>
        <div><b>${g["우세"][1]}<small>/${g["우세"][0]}</small></b><span>우세로 본 곳<br>민주 승리</span></div>
        <div><b>${g["열세"][0] - g["열세"][1]}<small>/${g["열세"][0]}</small></b><span>열세로 본 곳<br>민주 패배</span></div>
      </div>
      <div class="m-tbl"><table>
        <tr><th>등급</th><th>예상 승리 확률</th><th>실제 민주 승리</th></tr>
        ${GRADES.map(([n], i) => g[n] ? `<tr><td>${n}</td><td>${GRADE_PROB[i]}</td><td>${g[n][0]}곳 중 ${g[n][1]}곳 (${Math.round(g[n][2])}%)</td></tr>` : "").join("")}
      </table></div>
      <p class="m-note">등급마다 실제 승률이 예상 확률 범위에 들어옴 · 세 선거를 그냥 평균 낸 방식은 ${h.simple2024}%·${h.simple2020}% 적중 · 전국 분위기를 ±3%p 틀리게 넣어도 ${h.env_err3[0]}~${h.env_err3[1]}%</p>`;
  return `<ul>
        <li>1차: 2020 총선·2022 대선·2022 지방선거만으로 2024 총선 예측 → ${h.n2024}곳 중 ${h.r2024}곳(${r(h.r2024, h.n2024)}%) 승패 적중</li>
        <li>2차: 2016 총선·2017 대선·2018 지방선거만으로 2020 총선 예측 → ${h.n2020}곳 중 ${h.r2020}곳(${r(h.r2020, h.n2020)}%) 승패 적중</li>
        <li>두 번 합친 등급별 실제 민주 승리: ${GRADES.map(([n]) => g[n] ? `${n} ${g[n][0]}곳 중 ${g[n][1]}곳(${Math.round(g[n][2])}%)` : "").filter(Boolean).join(" · ")}</li>
        <li>그냥 평균 낸 방식은 ${h.simple2024}%·${h.simple2020}% 적중 · 전국 분위기를 ±3%p 틀리게 넣어도 ${h.env_err3[0]}~${h.env_err3[1]}%</li>
      </ul>`;
}
// 재합산 정확도: accuracy.json (scripts/accuracy.py)
function accHTML() {
  const a = state.acc;
  if (!a) return "";
  const n = (x) => x.toLocaleString("ko-KR"), e = (x) => (100 - x.exact).toFixed(1);
  return `<ul>
        <li>표 보존: 지역구로 나눠 더한 유효표 합계가 선관위 공식 합계와 같음 — 대선 ${n(a.p21.summed)}표(차이 ${n(a.p21.diff)}) · 지방선거 ${n(a.l9.summed)}표(차이 ${n(a.l9.diff)})</li>
        <li>그대로 배정: 유효표의 ${a.p21.exact}%(대선)·${a.l9.exact}%(지방선거)는 동·투표구 단위로 정확히 한 지역구에 들어감 · 22대 선거구는 동 하나가 둘로 나뉜 곳이 없음</li>
        <li>비율로 나눈 표: 관외사전·거소·재외처럼 구 단위로만 나오는 ${e(a.p21)}%·${e(a.l9)}%는 구 하나가 여러 지역구인 곳에서 동 득표 비율로 나눔 · 이로 인한 지역구 격차 오차는 평균 ${a.p21.town_error.mean_abs}%p, 가장 큰 곳 ${Math.max(a.p21.town_error.max, a.l9.town_error.max)}%p 추정</li>
      </ul>`;
}

function showOutlookOverview() {
  const d = state.outlook?.district;
  if (!d) { $("#panel").innerHTML = `<h2 class="ov-title">판세</h2><p class="ov-sub">판세 자료를 불러오는 중이에요…</p>`; return; }
  state.listTab ??= "close";
  const keys = Object.keys(d);
  const cnt = Object.fromEntries(GRADES.map(([g]) => [g, keys.filter((k) => d[k].grade === g).length]));
  const list = listKeys(state.listTab);
  state.list = list;
  const right = (k) => state.listTab === "risk"
    ? `${esc(chairName(k))} · <b class="hi">${highCount(k)}</b>/${(chairOf(k)?.news || []).length}건`
    : `<b class="${d[k].exp >= 0 ? "pos" : "neg"}">${signed(d[k].exp)}</b>`;
  const o = state.outlook, def = o.env_default;
  $("#panel").innerHTML = `
    <h2 class="ov-title">판세 현황</h2>
    <p class="ov-sub">이 지역구가 평소 전국보다 민주당에 얼마나 유리한지 + 전국 분위기 = 예상 격차</p>
    <button class="method-btn" id="openMethod"><span>i</span>판세 산출 방법 · 검증 결과</button>
    <div class="envbox">
      <label for="env">전국 분위기 <b id="envv" class="${state.env >= 0 ? "pos" : "neg"}">${envLabel(state.env)}</b></label>
      <input type="range" id="env" min="-15" max="15" step="0.5" value="${state.env}">
      <div class="envscale"><span>국민의힘 +15</span><span>0</span><span>민주 +15</span></div>
      <p>기본값 ${signed(def)} = 최근 세 선거 전국 평균 격차 ${state.env !== def ? `<button class="clear" id="envReset">기본값으로</button>` : ""}</p>
      <details class="regbox" ${state.regOpen ? "open" : ""}>
        <summary>권역별 조정 <small>(선택 · 특정 권역만 분위기가 다를 때)</small>${Object.values(state.regAdj).some(Boolean) ? ` <b class="on">조정 중</b>` : ""}</summary>
        ${REGIONS.map((g) => `<label class="reg"><span>${g}</span><input type="range" min="-10" max="10" step="0.5" value="${state.regAdj[g] || 0}" data-r="${g}"><b class="${(state.regAdj[g] || 0) >= 0 ? "pos" : "neg"}">${signed(state.regAdj[g] || 0)}</b></label>`).join("")}
        <p>전국 분위기에 더해지는 값 · 예: 부울경 −3 = 부울경만 전국보다 국민의힘 쪽으로 3%p ${Object.values(state.regAdj).some(Boolean) ? `<button class="clear" id="regReset">모두 0으로</button>` : ""}</p>
      </details>
    </div>
    <div class="seatbox" id="seatbox">${seatHTML()}</div>
    <div class="gradebar">${GRADES.map(([g, c]) => cnt[g] ? `<span data-g="${g}" style="flex:${cnt[g]};background:${c}" title="${g} ${cnt[g]}곳"></span>` : "").join("")}</div>
    <ul class="gradelegend">${GRADES.map(([g, c]) => `<li data-g="${g}" class="${state.grade === g ? "on" : ""}"><i style="background:${c}"></i>${g} <b>${cnt[g]}</b></li>`).join("")}</ul>
    <details class="notice">
      <summary>판세 기준</summary>
      <p class="src"><b>한 줄 요약</b></p>
      <p class="oneline">예상 격차 = <b>지역구 성향</b>(평소 전국보다 민주당이 몇 %p 더 나오는 곳인지) + <b>전국 분위기</b>(위 막대)</p>
      <p class="src"><b>계산 순서</b></p>
      <ol class="formula">
        <li><b>격차</b>: 선거마다 민주당 득표율 − 상대 1위 득표율<br><small>2024 총선(지역구 후보) · 2025 대선 · 2026 지방선거(광역의원 비례대표 정당 투표)</small></li>
        <li><b>지역구 성향</b>: 그 격차가 전국 평균보다 몇 %p 높은지(낮은지)를 세 선거 평균<br><small>전국 평균 격차: 2024 총선 ${signed(o.national.g22)} · 2025 대선 ${signed(o.national.p21)} · 2026 지방선거 ${signed(o.national.l9)}</small></li>
        <li><b>예상 격차</b>: 지역구 성향 + 전국 분위기</li>
        <li><b>승리 확률 → 등급</b>: 과거 총선에서 같은 예상 격차의 지역구가 실제로 이긴 비율로 계산</li>
      </ol>
      <p class="src"><b>전국 분위기란</b></p>
      <ul>
        <li>그해 선거에서 민주당이 전국적으로 상대보다 몇 %p 앞설지에 대한 가정</li>
        <li>기본값 ${signed(o.env_default)} = 최근 세 선거 전국 평균 격차의 평균 (${signed(o.national.g22)} · ${signed(o.national.p21)} · ${signed(o.national.l9)})</li>
        <li>2028 분위기는 아직 모르므로 위 막대로 직접 정함 (예: 여론조사 민주 3%p 우위면 민주 +3, 접전이면 0)</li>
      </ul>
      <p class="src"><b>예시 — 서울 종로구</b></p>
      <table class="ex">
        <tr><th></th><th>종로구</th><th>전국</th><th>차이</th></tr>
        ${(() => { const z = o.district["서울 종로구"], es = o.elections.filter((e) => z[e.id]?.m !== undefined), df = (e) => Math.round((z[e.id].m - o.national[e.id]) * 10) / 10;
          return es.map((e) => `<tr><td>${esc(e.name)}</td><td>${signed(z[e.id].m)}</td><td>${signed(o.national[e.id])}</td><td>${signed(df(e))}</td></tr>`).join("")
            + `<tr class="sum"><td colspan="3">지역구 성향 = (${es.map((e) => signed(df(e))).join(" ")}) ÷ ${es.length}</td><td>${signed(z.lean)}</td></tr>
      </table>
      <ul>
        <li>전국 분위기 ${envLabel(o.env_default)}이면 → ${signed(z.lean)} + ${o.env_default.toFixed(1)} = <b>${signed(z.lean + o.env_default)} → 승리 확률 ${pct(z.lean + o.env_default)} ${gradeOf(z.lean + o.env_default)}</b></li>
        <li>전국 분위기 양당 같음(0)이면 → ${signed(z.lean)} + 0 = <b>${signed(z.lean)} → 승리 확률 ${pct(z.lean)} ${gradeOf(z.lean)}</b></li>
      </ul>`; })()}
      <p class="src"><b>예상 의석</b></p>
      <ul>
        <li>254개 지역구마다 승리 확률대로 모의 선거를 2,000번 치러 민주 계열이 이긴 지역구 수를 셈 → 평균이 예상 의석, 가운데 80%가 범위</li>
        <li>실제 선거에서는 한 권역이 통째로 같이 움직이므로(예: 2020 부울경 −8%p) 모의 선거마다 권역별로 ±${o.sigma_region || 4}%p 정도씩 함께 흔듦</li>
        ${state.cal?.seats ? `<li>검증: 2024 총선 예상 ${state.cal.seats["2024"].mean.toFixed(0)}석(${state.cal.seats["2024"].lo}~${state.cal.seats["2024"].hi}) → 실제 ${state.cal.seats["2024"].actual}석 · 2020 총선 예상 ${state.cal.seats["2020"].mean.toFixed(0)}석(${state.cal.seats["2020"].lo}~${state.cal.seats["2020"].hi}) → 실제 ${state.cal.seats["2020"].actual}석 — 두 번 모두 범위 안</li>` : ""}
      </ul>
      <p class="src"><b>권역별 조정</b>(선택)</p>
      <ul>
        <li>특정 권역만 분위기가 다를 때 그 권역 지역구에만 더하는 값 · 기본 0</li>
        <li>권역: 수도권(서울·인천·경기) · 충청(대전·세종·충북·충남) · 호남(광주·전북·전남) · 부울경(부산·울산·경남) · 대구·경북 · 강원·제주</li>
      </ul>
      <p class="src"><b>등급 기준</b>(민주 계열 승리 확률)</p>
      <ul>
        ${GRADES.map(([g], i) => `<li>${g}: ${GRADE_PROB[i]} <small>(예상 ${gradeRange(i)})</small></li>`).join("")}
        <li>승리 확률 = 정규분포 Φ(예상 격차 ÷ σ) · σ 민주 불리 쪽 ${(o.sigma || [5, 7.5])[0]} · 유리 쪽 ${(o.sigma || [5, 7.5])[1]} — 과거 총선 두 번(503곳)의 실제 승패로 맞춘 값</li>
      </ul>
      <p class="src"><b>이렇게 계산하는 이유</b></p>
      <ul>
        <li>선거마다 전국 분위기가 달라서, 세 선거 결과를 그냥 평균 내면 지도 전체가 한쪽으로 쏠림</li>
        <li>지역구 고유의 성향만 뽑고, 전국 분위기는 막대로 따로 정함</li>
      </ul>
      <p class="src"><b>검증</b></p>
      ${checkHTML(false)}
      <p class="src"><b>대선·지방선거 숫자를 지역구에 맞춘 정확도</b></p>
      ${accHTML()}
      <p class="src"><b>참고 사항</b></p>
      <ul>
        <li>민주당이 후보를 안 낸 곳은 같은 계열 후보로 계산</li>
        <li>민주 계열 후보가 없던 3곳(세종갑·대구 서구·경북 의성청송영덕울진)은 총선 빼고 두 선거만으로 성향 계산</li>
        <li>전국 평균 격차는 254개 지역구 단순 평균</li>
        <li>검증 때 전국 분위기는 그해 실제 값 입력 · 이전 총선은 선거구 경계가 같은 곳만 사용(1차 199곳·2차 210곳) · 민주 계열 후보가 없던 곳은 대조에서 뺌</li>
        <li>지방선거는 시·도지사보다 정당 투표가 더 정확해 정당 투표를 씀(2차 검증 89% → 91%)</li>
        <li>여론조사·후보 인지도는 들어가지 않음</li>
        ${state.cal?.incumbent ? `<li>현역 의원 효과는 검증 후 뺐음: 이전 당선자가 다시 나온 곳은 현역 없는 곳보다 민주 현역 +${state.cal.incumbent["2024"].D}%p(2024)·+${state.cal.incumbent["2020"].D}%p(2020), 국민의힘 현역 ${signed(state.cal.incumbent["2024"].R)}%p·${signed(state.cal.incumbent["2020"].R)}%p로 해마다 들쭉날쭉하고, 넣어도 적중률이 거의 그대로(0~1곳)</li>` : ""}
      </ul>
    </details>
    <div class="ltabs" role="tablist">${LIST_TABS.map(([t, n]) => `<button data-t="${t}" class="${state.listTab === t ? "on" : ""}">${n}</button>`).join("")}</div>
    <p class="lmeta">${state.grade ? `<b>${state.grade}</b>만 · ` : ""}${list.length}곳 · ${state.listTab === "close" ? "차이가 작은 순" : state.listTab === "risk" ? "리스크 기사 많은 순(높음/전체)" : "민주당 우세한 순"}
      ${state.grade ? `<button class="clear" id="clearGrade">등급 해제</button>` : ""}</p>
    <ul class="klist" id="klist">${list.map((k, i) => `<li data-k="${esc(k)}"><em>${i + 1}</em><i style="background:${GRADE_COLOR[d[k].grade]}"></i><span>${esc(k.replace(/^(\S+) /, "$1 "))}</span><small>${right(k)}</small></li>`).join("") || "<li class='none'>해당 지역구가 없어요</li>"}</ul>
    ${state.chairs ? `<p class="ov-hint">리스크 기사 갱신 ${esc(state.chairs.updated)}</p>` : ""}`;
  $$("#klist li[data-k]").forEach((li) => li.addEventListener("click", () => {
    state.listScroll = $("#panel").scrollTop;
    select(li.dataset.k, true);
  }));
  $$(".ltabs button").forEach((b) => b.addEventListener("click", () => { state.listTab = b.dataset.t; state.listScroll = 0; showOutlookOverview(); }));
  $$(".gradelegend li").forEach((li) => li.addEventListener("click", () => setGrade(state.grade === li.dataset.g ? null : li.dataset.g)));
  $("#clearGrade")?.addEventListener("click", () => setGrade(null));
  $("#openMethod").addEventListener("click", () => openMethod());
  // 막대: 움직이는 동안 지도·띠만 다시 칠하고, 손을 떼면 목록까지 다시 그림
  const env = $("#env");
  env.addEventListener("input", () => {
    applyEnv(+env.value);
    $("#envv").textContent = envLabel(state.env);
    $("#envv").className = state.env >= 0 ? "pos" : "neg";
    drawGrades(); repaint();
    $("#seatbox").innerHTML = seatHTML();
  });
  $(".regbox").addEventListener("toggle", (e) => (state.regOpen = e.target.open));
  $$(".regbox input").forEach((r) => {
    r.addEventListener("input", () => {
      state.regAdj[r.dataset.r] = +r.value;
      const b = r.nextElementSibling; b.textContent = signed(+r.value); b.className = +r.value >= 0 ? "pos" : "neg";
      applyEnv(state.env); drawGrades(); repaint();
      $("#seatbox").innerHTML = seatHTML();
    });
    r.addEventListener("change", () => { state.listScroll = $("#panel").scrollTop; showOutlookOverview(); });
  });
  $("#regReset")?.addEventListener("click", () => { state.regAdj = {}; applyEnv(state.env); drawGrades(); repaint(); showOutlookOverview(); });
  env.addEventListener("change", () => { state.listScroll = $("#panel").scrollTop; showOutlookOverview(); });
  $("#envReset")?.addEventListener("click", () => { applyEnv(def); drawGrades(); repaint(); showOutlookOverview(); });
  $("#panel").scrollTop = state.listScroll || 0;
  $$(".gradebar span").forEach((sp) => (sp.style.opacity = !state.grade || sp.dataset.g === state.grade ? 1 : 0.25));
}

// 지역구 화면 위에 붙는 띠: 목록으로 / 이전 · 다음
function navBar(key) {
  const list = state.list || [];
  const i = list.indexOf(key);
  return `<div class="pnav">
    <button class="pback" id="back">← ${LIST_TABS.find(([t]) => t === state.listTab)?.[1] || "지역구"} 목록</button>
    ${i >= 0 ? `<span class="pstep"><button id="prevK" ${i === 0 ? "disabled" : ""} aria-label="이전 지역구">‹</button><b>${i + 1}</b>/${list.length}<button id="nextK" ${i === list.length - 1 ? "disabled" : ""} aria-label="다음 지역구">›</button></span>` : ""}
  </div>`;
}

function showOutlook(key, m) {
  $("#panel").innerHTML = `
    ${navBar(key)}
    <p class="where big"><span>지역구</span><b>${esc(key)}</b></p>
    ${outlookHTML(key)}
    ${chairHTML(key, m)}
    ${primaryHTML(key)}
    <details class="prev"><summary>현재 국회의원 · 2024 총선 결과 <small>${m ? `${esc(m.name)} (${esc(m.party)})` : "공석"}</small></summary>
      ${electionHTML(key, m?.name) || ""}
    </details>`;
  bindBack();
  $("#panel").scrollTop = 0;
  const list = state.list || [], i = list.indexOf(key);
  $("#prevK")?.addEventListener("click", () => select(list[i - 1], true));
  $("#nextK")?.addEventListener("click", () => select(list[i + 1], true));
  if (window.matchMedia("(max-width: 1080px)").matches) {
    const y = $("#panel").getBoundingClientRect().top + scrollY - $("#bar").offsetHeight - 12;
    window.scrollTo({ top: y, behavior: "smooth" });
  }
}

// 성향 계산 표: 선거마다 (이 지역구 격차 − 전국 평균 격차) → 평균 → + 전국 분위기
function leanHTML(o) {
  const nat = state.outlook.national;
  const used = state.outlook.elections.filter((e) => o[e.id]?.m !== undefined);
  const diff = (e) => Math.round((o[e.id].m - nat[e.id]) * 10) / 10;
  const rows = used.map((e) => `<tr><td>${esc(e.name)}</td><td>${signed(o[e.id].m)}</td><td>${signed(nat[e.id])}</td><td><b>${signed(diff(e))}</b></td></tr>`).join("");
  const sum = used.map((e) => signed(diff(e))).join(" ");
  return `<div class="leancalc">
    <p class="lc-h">지역구 성향 <span class="ltag ${o.lean >= 0 ? "pos" : "neg"}">${leanTag(o.lean)}</span></p>
    <p class="lc-say">${leanSay(o.lean)}</p>
    <table class="ex">
      <tr><th></th><th>이 지역구</th><th>전국 평균</th><th>차이</th></tr>
      ${rows}
      <tr class="sum"><td colspan="3">성향 = (${sum}) ÷ ${used.length}</td><td>${signed(o.lean)}</td></tr>
      <tr class="sum"><td colspan="3">예상 격차 = 성향 ${signed(o.lean)} + 전국 분위기 ${signed(state.env)}${o.adj ? ` + 권역 조정 ${signed(o.adj)}` : ""}</td><td>${signed(o.exp)}</td></tr>
      <tr class="sum"><td colspan="3">민주 계열 승리 확률 → ${o.grade}</td><td>${pct(o.exp)}</td></tr>
    </table>
  </div>`;
}

function outlookHTML(key) {
  const o = state.outlook?.district[key];
  if (!o) return "";
  const row = (e) => {
    const r = o[e.id];
    if (!r || r.m === undefined) return `<li><span class="el">${esc(e.name)}</span><span class="na">${esc(r?.none || "자료 없음")}</span></li>`;
    const w = Math.min(Math.abs(r.m), 50) / 50 * 50;
    return `<li><span class="el">${esc(e.name)}<small>${esc(e.desc)}</small></span>
      <span class="mbar"><span class="${r.m >= 0 ? "pos" : "neg"}" style="width:${w}%"></span></span>
      <b class="${r.m >= 0 ? "pos" : "neg"}">${signed(r.m)}</b>
      <small class="dr">민주 ${r.d}% · 상대 ${r.r}%</small>
      ${r.note ? `<small class="note">${esc(r.note)}</small>` : ""}</li>`;
  };
  return `<section class="outlook">
    <div class="grade-badge" style="--c:${GRADE_COLOR[o.grade]}"><b>${o.grade}</b><span>승리 확률 <b>${pct(o.exp)}</b> · 예상 격차 <b>${signed(o.exp)}%p</b> <small>= 성향 ${signed(o.lean)} + 전국 분위기 ${signed(state.env)}${o.adj ? ` + 권역 조정 ${signed(o.adj)}` : ""}</small></span></div>
    <ul class="mrows">${state.outlook.elections.map(row).join("")}</ul>
    ${leanHTML(o)}
    ${o.trend != null ? `<p class="trend">2024 총선 → 2026 지방선거: 민주당 격차 <b class="${o.trend >= 0 ? "pos" : "neg"}">${o.trend >= 0 ? "▲" : "▼"} ${Math.abs(o.trend).toFixed(1)}%p</b> ${o.trend >= 0 ? "좋아짐" : "나빠짐"}</p>` : ""}
    <p class="src">대선·지방선거는 투표구·읍면동 결과를 이 지역구로 다시 더한 값(관외사전·재외 등 구 단위 표만 비율로 나눔)</p>
  </section>`;
}

const STATUS_CLASS = { "현역 의원": "s-mp", "위원장": "s-chair", "직무대행": "s-acting", "확인필요": "s-unknown" };
function chairHTML(key, m) {
  const c = chairOf(key);
  if (!state.chairs) return `<section class="chair"><h3 class="sec-h">민주당 지역위원장</h3><p class="ov-sub">불러오는 중…</p></section>`;
  if (!c?.chair) return "";
  const ch = c.chair;
  const isMP = ch.status === "현역 의원" && m && m.name === ch.name;
  const news = c.news || [];
  const hi = news.filter((n) => n.level === "high"), lo = news.filter((n) => n.level === "low");
  const li = (n) => `<li class="${n.level}"><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>
      <small>${esc(n.date)} · ${esc(n.press)}${n.reason ? ` · ${esc(n.reason)}` : ""}</small></li>`;
  const ordered = [...hi, ...lo, ...news.filter((n) => !n.level)];
  return `<section class="chair">
    <h3 class="sec-h">민주당 지역위원장</h3>
    <div class="chair-card">
      ${isMP && m.photo ? `<img src="${esc(m.photo)}" alt="">` : ""}
      <div>
        <p class="cn">${ch.name ? esc(ch.name) : "이름 확인 필요"}<span class="st ${STATUS_CLASS[ch.status] || ""}">${esc(ch.status)}</span></p>
        ${ch.note ? `<p class="cnote">${esc(ch.note)}</p>` : ""}
        ${ch.name ? `<a class="nlink" href="${naverNews(ch.name + " " + key.split(" ")[1].replace(/[갑을병정]$/, ""))}" target="_blank" rel="noopener">네이버 뉴스에서 더 보기 ↗</a>` : ""}
      </div>
    </div>
    ${ch.name ? `<h4 class="risk-h">리스크 기사 <small>최근 90일</small></h4>
    <div class="riskline"><span class="rk hi">높음 ${hi.length}</span><span class="rk lo">주의 ${lo.length}</span></div>
    <ul class="news">${ordered.slice(0, 8).map(li).join("") || "<li class='none'>최근 90일 동안 리스크 기사가 없어요</li>"}</ul>
    ${ordered.length > 8 ? `<details class="more"><summary>기사 ${ordered.length - 8}건 더 보기</summary><ul class="news">${ordered.slice(8).map(li).join("")}</ul></details>` : ""}
    <p class="src">자동 수집 ${esc(state.chairs.updated)} · 본인의 비리·범죄 혐의·사회적 물의 기사만(AI 판단) · 높음: 수사·기소·재판·징계 진행 / 주의: 의혹·논란 단계 · 법안 발의·정책 주장·상대 측 정치 공방 고소는 제외</p>` : ""}
  </section>`;
}

function primaryHTML(key) {
  const p = chairOf(key)?.primary2024;
  if (!p) return "";
  const method = p.method.replace(/\[\d+\]/g, "");
  return `<section class="primary">
    <h3 class="sec-h">2024 총선 민주당 후보군 <small>${esc(method)}</small></h3>
    <ul class="plist">${p.cands.map((c) => `<li class="${c.won ? "won" : ""}">
      <a href="${naverNews(c.name + " " + key.split(" ")[1].replace(/[갑을병정]$/, ""))}" target="_blank" rel="noopener"><b>${esc(c.name)}</b></a>
      ${c.won ? `<span class="tag w">공천</span>` : ""}${c.note ? `<span class="tag">${esc(c.note)}</span>` : ""}
      <small>${esc(c.career)}</small></li>`).join("")}</ul>
    <p class="src">예비후보·경선·컷오프 명단(나무위키 정리) · 이름을 누르면 최근 기사</p>
  </section>`;
}

// ── 말풍선 ─────────────────────────────────────────────
function showTip(key, ev) {
  const m = state.members.district[key];
  const tip = $("#tip");
  const o = state.outlook?.district[key];
  tip.innerHTML = `<div class="k">${esc(key)}</div>` + (state.mode === "outlook" && o
    ? `<i style="background:${GRADE_COLOR[o.grade]}"></i><b>${o.grade}</b> · 승리 확률 ${pct(o.exp)} · 예상 ${signed(o.exp)}%p${chairName(key) ? `<div class="k2">민주당 ${esc(chairName(key))}</div>` : ""}`
    : (m ? `<i style="background:${colorOf(m.party)}"></i><b>${esc(m.name)}</b> · ${esc(m.party)}` : "공석"));
  tip.hidden = false;
  tip.style.left = Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 8) + "px";
  tip.style.top = Math.min(ev.clientY + 14, innerHeight - tip.offsetHeight - 8) + "px";
}
function hideTip() { $("#tip").hidden = true; }

// ── 검색: 직접 만든 결과 목록 ───────────────────────────
// (예전 datalist 는 검색창에서 포커스가 빠질 때 'change' 가 다시 일어나
//  지도에서 고른 지역구를 검색 결과로 덮어썼다 → 고른 순간에만 이동하도록 변경)
function setupSearch() {
  const items = [];
  for (const h of state.hexes) {
    const m = state.members.district[h.key];
    items.push({ key: h.key, title: h.key, sub: m ? m.name : "공석", party: m ? m.party : "공석", text: h.key.replace(/\s/g, "") });
  }
  for (const [k, m] of Object.entries(state.members.district)) items.push({ key: k, title: m.name, sub: k, party: m.party, text: m.name });
  state.members.pr.forEach((m, i) => items.push({ pr: i, title: m.name, sub: "비례대표", party: m.party, text: m.name }));

  const input = $("#q"), list = $("#results");
  let hits = [], cur = -1, pendingEnter = false;

  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); cur = -1; };
  const render = () => {
    list.innerHTML = hits.length
      ? hits.map((it, i) => `<li role="option" data-i="${i}" aria-selected="${i === cur}"><i style="background:${colorOf(it.party)};${it.party === "공석" ? "box-shadow:inset 0 0 0 1px #888" : ""}"></i><span>${esc(it.title)}</span><small>${esc(it.sub)}</small></li>`).join("")
      : `<li class="none">결과가 없어요</li>`;
    list.hidden = false; input.setAttribute("aria-expanded", "true");
  };
  const choose = (it) => {
    if (!it) return;
    close(); input.blur();
    // 한글 입력기가 조합 중이던 글자를 다시 넣지 않도록 포커스를 뺀 뒤 비움
    setTimeout(() => (input.value = ""), 0);
    if (it.pr !== undefined) { switchView("pr"); showMember(state.members.pr[it.pr], null); }
    else { if (state.view === "pr") switchView("geo"); select(it.key, true); }
  };

  const update = () => {
    const v = input.value.replace(/\s/g, "");
    if (!v) { hits = []; return close(); }
    // 이름·지역구가 정확히 같은 것 → 앞부분이 같은 것 → 짧은 것 순
    hits = items.filter((it) => it.text.includes(v))
      .sort((a, b) => (b.text === v) - (a.text === v) || a.text.indexOf(v) - b.text.indexOf(v) || a.text.length - b.text.length)
      .slice(0, 8);
    cur = hits.length ? 0 : -1;
    render();
  };

  input.addEventListener("input", update);
  // 한글은 조합이 끝난 뒤에 검색어가 확정됨. 조합 중 Enter 는 확정 후 처리
  input.addEventListener("compositionend", () => setTimeout(() => {
    update();
    if (pendingEnter) { pendingEnter = false; choose(hits[cur]); }
  }, 0));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.isComposing || e.keyCode === 229)) { pendingEnter = true; e.preventDefault(); return; }
    if (e.key === "Enter") { update(); choose(hits[cur]); e.preventDefault(); return; }
    if (list.hidden) return;
    if (e.key === "ArrowDown") { cur = Math.min(cur + 1, hits.length - 1); render(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { cur = Math.max(cur - 1, 0); render(); e.preventDefault(); }
    else if (e.key === "Escape") close();
  });
  list.addEventListener("mousedown", (e) => {   // blur 보다 먼저 잡아야 클릭이 먹힘
    const li = e.target.closest("li[data-i]"); if (!li) return;
    e.preventDefault(); choose(hits[+li.dataset.i]);
  });
  input.addEventListener("blur", () => setTimeout(close, 100));
}

// ── 보기 전환 ──────────────────────────────────────────
function setupTabs() {
  $(".seg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-view]");
    if (b) switchView(b.dataset.view);
  });
}
function switchView(v) {
  state.view = v;
  $$(".seg button").forEach((b) => { b.classList.toggle("on", b.dataset.view === v); b.setAttribute("aria-selected", b.dataset.view === v); });
  for (const id of ["geo", "hex", "pr"]) $("#view-" + id).hidden = id !== v;
  hideTip();
  if (v === "geo" && state.map) { state.map.resize(); if (state.sel) highlightGeo(state.sel, true); }
}
