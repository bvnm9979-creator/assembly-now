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

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const state = { members: null, hexes: null, geo: null, sido: null, party: null, sel: null, map: null, view: "geo", counts: [] };

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
  $("#parties").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    setParty(state.party === b.dataset.p ? null : b.dataset.p);
  });
}

function setParty(p) {
  state.party = p;
  $("#parties").classList.toggle("filtering", !!p);
  $$("#parties button").forEach((b) => { b.classList.toggle("on", b.dataset.p === p); b.setAttribute("aria-pressed", b.dataset.p === p); });
  paintScore();
  if (state.map?.getLayer("fill")) state.map.setPaintProperty("fill", "fill-color", fillExpr());
  $$("#hex .cell").forEach((c) => c.setAttribute("fill", paint(c.dataset.party)));
  $$("#view-pr .prgroup").forEach((g) => (g.hidden = !!p && g.dataset.p !== p));
  $$(".hemi circle").forEach((c) => c.setAttribute("fill", paint(c.dataset.p)));
  $$(".table tr[data-p]").forEach((r) => (r.style.opacity = !p || r.dataset.p === p ? 1 : 0.4));
}

// ── 실제 지도 ───────────────────────────────────────────
function fillExpr() {
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
      return `<polygon class="cell" data-key="${esc(c.key)}" data-party="${esc(party)}" points="${c.pts.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ")}" fill="${paint(party)}"${m ? "" : ' stroke-dasharray="3 2" style="stroke:#6b7079"'}/>`;
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
    <ul class="facts">
      <li><span>당선</span>${esc(m.reele)}</li>
      ${age ? `<li><span>나이</span>${age}세 · ${esc(m.sex)}</li>` : ""}
      ${m.cmit ? `<li><span>위원회</span>${esc(m.cmit)}</li>` : ""}
      ${m.office ? `<li><span>사무실</span>${esc(m.office)}</li>` : ""}
      ${m.tel ? `<li><span>전화</span>${esc(m.tel)}</li>` : ""}
      ${m.home ? `<li><span>홈페이지</span><a href="${esc(m.home)}" target="_blank" rel="noopener">${esc(m.home.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a></li>` : ""}
    </ul>
    ${key ? electionHTML(key, m.name) : ""}`;
  bindBack();
  if (window.matchMedia("(max-width: 1080px)").matches) {
    const y = $("#panel").getBoundingClientRect().top + scrollY - $("#bar").offsetHeight - 12;
    window.scrollTo({ top: y, behavior: "smooth" });
  }
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

// ── 말풍선 ─────────────────────────────────────────────
function showTip(key, ev) {
  const m = state.members.district[key];
  const tip = $("#tip");
  tip.innerHTML = `<div class="k">${esc(key)}</div>` +
    (m ? `<i style="background:${colorOf(m.party)}"></i><b>${esc(m.name)}</b> · ${esc(m.party)}` : "공석");
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
