// 22대 국회 지역구 지도 — 실제 지도(MapLibre) + 육각형 지도(SVG) + 비례대표 목록

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
const KOREA = [[124.6, 33.1], [130.95, 38.65]];
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
                mode: "seat", grade: null, outlook: null, chairs: null };

init();

async function init() {
  // 서버가 잠깐 오류(503 등)를 내면 최대 4번까지 다시 받음
  const load = async (f) => {
    for (let i = 0; ; i++) {
      try {
        const r = await fetch("data/" + f);
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
  load("outlook.json").then((o) => {
    state.outlook = o;
    applyEnv(o.env_default);
    if (state.mode === "outlook") refreshMode();
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

// 예상 격차 = 지역구 성향 + 전국 분위기 → 등급 (scripts/build_outlook.py 와 같은 기준)
const gradeOf = (m) => m >= 10 ? "우세" : m >= 5 ? "경합우세" : m > -5 ? "경합" : m > -10 ? "경합열세" : "열세";
function applyEnv(env) {
  state.env = env;
  for (const d of Object.values(state.outlook.district)) {
    d.exp = Math.round((d.lean + env) * 10) / 10;
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
    attributionControl: { compact: true, customAttribution: "선거구 경계 © 오마이뉴스" },
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
    <div class="envbox">
      <label for="env">전국 분위기 <b id="envv" class="${state.env >= 0 ? "pos" : "neg"}">${envLabel(state.env)}</b></label>
      <input type="range" id="env" min="-15" max="15" step="0.5" value="${state.env}">
      <div class="envscale"><span>국민의힘 +15</span><span>0</span><span>민주 +15</span></div>
      <p>기본값 ${signed(def)} = 최근 세 선거 전국 평균 격차 ${state.env !== def ? `<button class="clear" id="envReset">기본값으로</button>` : ""}</p>
    </div>
    <div class="gradebar">${GRADES.map(([g, c]) => cnt[g] ? `<span data-g="${g}" style="flex:${cnt[g]};background:${c}" title="${g} ${cnt[g]}곳"></span>` : "").join("")}</div>
    <ul class="gradelegend">${GRADES.map(([g, c]) => `<li data-g="${g}" class="${state.grade === g ? "on" : ""}"><i style="background:${c}"></i>${g} <b>${cnt[g]}</b></li>`).join("")}</ul>
    <details class="notice">
      <summary>판세 기준</summary>
      <p class="src"><b>한 줄 요약</b></p>
      <p class="oneline">예상 격차 = <b>지역구 성향</b>(평소 전국보다 민주당이 몇 %p 더 나오는 곳인지) + <b>전국 분위기</b>(위 막대)</p>
      <p class="src"><b>계산 순서</b></p>
      <ol class="formula">
        <li><b>격차</b>: 선거마다 민주당 득표율 − 상대 1위 득표율<br><small>2024 총선 · 2025 대선 · 2026 지선</small></li>
        <li><b>지역구 성향</b>: 그 격차가 전국 평균보다 몇 %p 높은지(낮은지)를 세 선거 평균<br><small>전국 평균 격차: 2024 총선 ${signed(o.national.g22)} · 2025 대선 ${signed(o.national.p21)} · 2026 지선 ${signed(o.national.l9)}</small></li>
        <li><b>예상 격차</b>: 지역구 성향 + 전국 분위기</li>
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
        <tr><td>2024 총선</td><td>+6.8</td><td>+6.4</td><td>+0.4</td></tr>
        <tr><td>2025 대선</td><td>+8.3</td><td>+8.2</td><td>+0.1</td></tr>
        <tr><td>2026 지선</td><td>+2.9</td><td>+8.4</td><td>−5.5</td></tr>
        <tr class="sum"><td colspan="3">지역구 성향 = (+0.4 +0.1 −5.5) ÷ 3</td><td>−1.7</td></tr>
      </table>
      <ul>
        <li>전국 분위기 민주 +7.7이면 → −1.7 + 7.7 = <b>+6.0 경합우세</b></li>
        <li>전국 분위기 양당 같음(0)이면 → −1.7 + 0 = <b>−1.7 경합</b></li>
      </ul>
      <p class="src"><b>등급 기준</b>(예상 격차)</p>
      <ul>
        <li>+10%p 이상 우세 · +5~10 경합우세 · ±5 안 경합 · −5~−10 경합열세 · −10 이하 열세</li>
      </ul>
      <p class="src"><b>이렇게 계산하는 이유</b></p>
      <ul>
        <li>선거마다 전국 분위기가 달라서, 세 선거 결과를 그냥 평균 내면 지도 전체가 한쪽으로 쏠림</li>
        <li>지역구 고유의 성향만 뽑고, 전국 분위기는 막대로 따로 정함</li>
      </ul>
      <p class="src"><b>검증</b></p>
      <ul>
        <li>2020 총선·2022 대선·2022 지선만으로 2024 총선을 이 방식으로 예측 → 254곳 중 237곳(93%) 승패 적중</li>
        <li>우세로 본 107곳 중 105곳 민주 승리, 열세로 본 66곳 중 64곳 패배</li>
        <li>그냥 평균 낸 방식은 80% 적중</li>
      </ul>
      <p class="src"><b>참고 사항</b></p>
      <ul>
        <li>대선·지방선거 숫자는 지역구에 맞춰 다시 더한 추정치</li>
        <li>민주당이 후보를 안 낸 곳은 같은 계열 후보로 계산</li>
        <li>민주 계열 후보가 없던 3곳(세종갑·대구 서구·경북 의성청송영덕울진)은 총선 빼고 두 선거만으로 성향 계산</li>
        <li>전국 평균 격차는 254개 지역구 단순 평균</li>
        <li>검증 때 전국 분위기는 2024 실제 값(민주 +5.5) 입력, 2020 총선은 선거구 경계가 2024년과 같은 199곳만 사용</li>
        <li>여론조사·후보 인지도·현역 여부는 들어가지 않음</li>
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
  // 막대: 움직이는 동안 지도·띠만 다시 칠하고, 손을 떼면 목록까지 다시 그림
  const env = $("#env");
  env.addEventListener("input", () => {
    applyEnv(+env.value);
    $("#envv").textContent = envLabel(state.env);
    $("#envv").className = state.env >= 0 ? "pos" : "neg";
    drawGrades(); repaint();
  });
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
    <p class="lc-h">성향 계산 <small>전국보다 민주당이 몇 %p 더 나오는 곳인지</small></p>
    <table class="ex">
      <tr><th></th><th>이 지역구</th><th>전국 평균</th><th>차이</th></tr>
      ${rows}
      <tr class="sum"><td colspan="3">성향 = (${sum}) ÷ ${used.length}</td><td>${signed(o.lean)}</td></tr>
      <tr class="sum"><td colspan="3">예상 격차 = 성향 ${signed(o.lean)} + 전국 분위기 ${signed(state.env)}</td><td>${signed(o.exp)}</td></tr>
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
    <div class="grade-badge" style="--c:${GRADE_COLOR[o.grade]}"><b>${o.grade}</b><span>예상 격차 <b>${signed(o.exp)}%p</b> <small>= 성향 ${signed(o.lean)} + 전국 분위기 ${signed(state.env)}</small></span></div>
    <ul class="mrows">${state.outlook.elections.map(row).join("")}</ul>
    ${leanHTML(o)}
    ${o.trend != null ? `<p class="trend">2024 총선 → 2026 지선: 민주당 격차 <b class="${o.trend >= 0 ? "pos" : "neg"}">${o.trend >= 0 ? "▲" : "▼"} ${Math.abs(o.trend).toFixed(1)}%p</b> ${o.trend >= 0 ? "좋아짐" : "나빠짐"}</p>` : ""}
    <p class="src">대선·지선은 투표구·읍면동 결과를 이 지역구로 다시 더한 값(일부 나뉜 동은 비율로 추정)</p>
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
    ? `<i style="background:${GRADE_COLOR[o.grade]}"></i><b>${o.grade}</b> · 예상 ${signed(o.exp)}%p${chairName(key) ? `<div class="k2">민주당 ${esc(chairName(key))}</div>` : ""}`
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
