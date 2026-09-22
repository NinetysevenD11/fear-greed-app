const FG_URLS = [
  "https://cdn.jsdelivr.net/gh/whit3rabbit/fear-greed-data@main/fear-greed.csv",
  "https://raw.githubusercontent.com/whit3rabbit/fear-greed-data/main/fear-greed.csv",
  "https://api.allorigins.win/raw?url=" + encodeURIComponent("https://raw.githubusercontent.com/whit3rabbit/fear-greed-data/main/fear-greed.csv")
];
const QQQ_YAHOO = "https://query2.finance.yahoo.com/v8/finance/chart/QQQ?interval=1d&range=15y";
const MAP = {
  "extreme fear": { ko: "극단적 공포", color: "#e53935" },
  "fear": { ko: "공포", color: "#fb8c00" },
  "neutral": { ko: "중립", color: "#fdd835" },
  "greed": { ko: "탐욕", color: "#9ccc65" },
  "extreme greed": { ko: "극단적 탐욕", color: "#43a047" }
};
let ALL = [];
let SELECTED = "";
function pad(n) { return String(n).padStart(2, "0"); }
function fmt(n) { return Number.isFinite(n) ? Math.round(n) : "-"; }
function fmtPx(n) { return Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-"; }
function fmtRsi(n) { return Number.isFinite(n) ? n.toFixed(1) : "-"; }
function rsiColor(n) {
  if (!Number.isFinite(n)) return "#9aa3b8";
  if (n >= 70) return "#e53935";
  if (n <= 30) return "#4fc3f7";
  return "#d7dde8";
}
function normalizeDate(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);
  if (m) return m[1] + "-" + pad(m[2]) + "-" + pad(m[3]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  return "";
}
async function fetchFirst(urls) {
  let last = new Error("주소를 모두 실패했습니다.");
  for (let i = 0; i < urls.length; i++) {
    try {
      const res = await fetch(urls[i], { cache: "no-store" });
      if (!res.ok) { last = new Error("HTTP " + res.status); continue; }
      const text = await res.text();
      if (!text || text.length < 20) { last = new Error("빈 응답"); continue; }
      return text;
    } catch (e) { last = e; }
  }
  throw last;
}
function parseFg(text) {
  const rows = [];
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    const date = (parts[0] || "").trim();
    const score = Number(parts[1]);
    const rating = (parts[2] || "").trim().toLowerCase();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(score)) continue;
    rows.push({ date: date, score: score, rating: rating, close: null, rsi: null, chg: null });
  }
  rows.sort(function(a, b) { return a.date.localeCompare(b.date); });
  return rows;
}
function wilderRsi(closes, period) {
  period = period || 14;
  const out = Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let avgG = 0, avgL = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) avgG += d; else avgL -= d;
  }
  avgG /= period; avgL /= period;
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}
function attachRsi(rows) {
  const rsi = wilderRsi(rows.map(function(r) { return r.close; }));
  rows.forEach(function(r, i) { r.rsi = rsi[i]; });
  return rows;
}
function parseQqqCsv(text) {
  const rows = [];
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return rows;
  const heads = lines[0].toLowerCase().split(",").map(function(h) { return h.trim(); });
  let closeIdx = heads.indexOf("close");
  if (closeIdx < 0) closeIdx = 1;
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    const date = normalizeDate(parts[0]);
    const close = Number(parts[closeIdx] || parts[1]);
    if (!date || !Number.isFinite(close)) continue;
    rows.push({ date: date, close: close });
  }
  rows.sort(function(a, b) { return a.date.localeCompare(b.date); });
  return attachRsi(rows);
}
function parseYahooChart(raw) {
  const json = typeof raw === "string" ? JSON.parse(raw) : raw;
  const result = json && json.chart && json.chart.result && json.chart.result[0];
  if (!result) throw new Error("QQQ 응답이 비어 있습니다.");
  const ts = result.timestamp || [];
  const closes = ((result.indicators.quote[0] || {}).close) || [];
  const rows = [];
  for (let i = 0; i < ts.length; i++) {
    if (closes[i] == null) continue;
    const d = new Date(ts[i] * 1000);
    rows.push({ date: d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()), close: Number(closes[i]) });
  }
  return attachRsi(rows);
}
async function loadQqq() {
  const tries = [
    async function() { return parseYahooChart(await fetchFirst(["https://api.allorigins.win/raw?url=" + encodeURIComponent(QQQ_YAHOO)])); },
    async function() { return parseYahooChart(await fetchFirst(["https://corsproxy.io/?" + encodeURIComponent(QQQ_YAHOO)])); },
    async function() { return parseQqqCsv(await fetchFirst(["https://api.allorigins.win/raw?url=" + encodeURIComponent("https://stooq.com/q/d/l/?s=qqq.us&i=d")])); }
  ];
  let last;
  for (let i = 0; i < tries.length; i++) {
    try { return await tries[i](); } catch (e) { last = e; }
  }
  throw last || new Error("QQQ 실패");
}
function mergeQqq(fgRows, qqqRows) {
  if (!qqqRows || !qqqRows.length) return;
  const map = new Map(qqqRows.map(function(r) { return [r.date, r]; }));
  const dates = qqqRows.map(function(r) { return r.date; });
  function nearest(date) {
    if (map.has(date)) return map.get(date);
    let lo = 0, hi = dates.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (dates[mid] <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans >= 0 ? map.get(dates[ans]) : null;
  }
  for (let i = 0; i < fgRows.length; i++) {
    const hit = nearest(fgRows[i].date);
    if (!hit) continue;
    fgRows[i].close = hit.close;
    fgRows[i].rsi = hit.rsi;
    if (i > 0 && Number.isFinite(fgRows[i - 1].close)) fgRows[i].chg = hit.close - fgRows[i - 1].close;
  }
}
function findRow(date) {
  const exact = ALL.find(function(r) { return r.date === date; });
  if (exact) return { row: exact, approx: false };
  const prev = ALL.slice().reverse().find(function(r) { return r.date <= date; });
  return { row: prev || ALL[0] || null, approx: true };
}
function drawChart(canvas, rows, markDate) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  if (!rows.length) return;
  const padY = 8, min = 0, max = 100;
  ctx.strokeStyle = "#2a3350";
  ctx.lineWidth = 1;
  [25, 50, 75].forEach(function(v) {
    const y = padY + (1 - (v - min) / (max - min)) * (h - padY * 2);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  });
  ctx.beginPath();
  rows.forEach(function(r, i) {
    const x = padY + (i / (rows.length - 1 || 1)) * (w - padY * 2);
    const y = padY + (1 - (r.score - min) / (max - min)) * (h - padY * 2);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.strokeStyle = "#8ab4ff";
  ctx.lineWidth = 2;
  ctx.stroke();
  const idx = rows.findIndex(function(r) { return r.date === markDate; });
  if (idx >= 0) {
    const x = padY + (idx / (rows.length - 1 || 1)) * (w - padY * 2);
    const y = padY + (1 - (rows[idx].score - min) / (max - min)) * (h - padY * 2);
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
  }
}
function chgText(n) {
  if (!Number.isFinite(n)) return "-";
  return (n > 0 ? "+" : "") + n.toFixed(2);
}
function render() {
  if (!ALL.length) return;
  const latest = ALL[ALL.length - 1];
  const wanted = SELECTED || latest.date;
  const found = findRow(wanted);
  const cur = found.row;
  const info = MAP[cur.rating] || { ko: cur.rating, color: "#9aa3b8" };
  const idx = ALL.findIndex(function(r) { return r.date === cur.date; });
  const nearby = ALL.slice(Math.max(0, idx - 14), Math.min(ALL.length, idx + 16)).reverse();
  const chartRows = ALL.slice(Math.max(0, idx - 89), idx + 1);
  const note = document.getElementById("note");
  if (found.approx && wanted !== cur.date) note.textContent = wanted + "에는 값이 없어, 가장 가까운 이전 거래일 " + cur.date + "을 보여 드립니다.";
  else if (cur.date === latest.date) note.textContent = "최신 데이터입니다. 범위: " + ALL[0].date + " ~ " + latest.date;
  else note.textContent = cur.date + " 데이터를 찾았습니다.";
  document.getElementById("datePick").value = cur.date;
  document.getElementById("dateText").value = wanted;
  document.getElementById("app").innerHTML =
    '<section class="hero">' +
      '<div class="score" style="color:' + info.color + '">' + fmt(cur.score) + '</div>' +
      '<div class="rating" style="background:' + info.color + '22;color:' + info.color + '">' + info.ko + '</div>' +
      '<div class="meta">' + cur.date + ' · 공포탐욕 ' + (Number.isFinite(cur.score) ? cur.score.toFixed(1) : "-") + '</div>' +
      '<div class="bar-wrap"><div class="bar"><div class="needle" style="left:' + Math.min(100, Math.max(0, cur.score || 0)) + '%"></div></div>' +
      '<div class="labels"><span>공포</span><span>중립</span><span>탐욕</span></div></div>' +
      '<div class="stats">' +
        '<div class="stat"><span>QQQ 종가</span><b>' + fmtPx(cur.close) + '</b></div>' +
        '<div class="stat"><span>RSI(14)</span><b style="color:' + rsiColor(cur.rsi) + '">' + fmtRsi(cur.rsi) + '</b></div>' +
        '<div class="stat"><span>QQQ 전일</span><b>' + chgText(cur.chg) + '</b></div>' +
      '</div><canvas id="chart"></canvas></section><section class="list">' +
      nearby.map(function(r) {
        const m = MAP[r.rating] || { ko: r.rating, color: "#9aa3b8" };
        const on = r.date === cur.date ? " active" : "";
        return '<div class="row' + on + '" data-date="' + r.date + '">' +
          '<div class="row-left"><span class="dot" style="background:' + m.color + '"></span>' + r.date +
          '<div class="qqq-line">QQQ ' + fmtPx(r.close) + ' · RSI ' + fmtRsi(r.rsi) + '</div></div>' +
          '<div class="row-right">' + fmt(r.score) + ' · ' + m.ko + '</div></div>';
      }).join("") +
      '</section><p class="hint">RSI는 QQQ 종가 기준 14일 Wilder 방식입니다.</p>';
  drawChart(document.getElementById("chart"), chartRows, cur.date);
  document.querySelectorAll(".row[data-date]").forEach(function(el) {
    el.addEventListener("click", function() {
      SELECTED = el.dataset.date;
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}
function searchDate() {
  const fromPick = document.getElementById("datePick").value;
  const fromText = normalizeDate(document.getElementById("dateText").value);
  const date = fromText || fromPick;
  if (!date) {
    document.getElementById("note").textContent = "날짜를 선택하거나 2024-03-15 형식으로 입력해 주세요.";
    return;
  }
  SELECTED = date;
  render();
}
function goLatest() {
  SELECTED = ALL.length ? ALL[ALL.length - 1].date : "";
  if (ALL.length) render();
}
async function load() {
  const app = document.getElementById("app");
  app.innerHTML = '<p class="hint">불러오는 중…</p>';
  try {
    ALL = parseFg(await fetchFirst(FG_URLS));
    if (!ALL.length) throw new Error("공포탐욕 데이터가 비어 있습니다.");
    const last = ALL[ALL.length - 1].date;
    document.getElementById("datePick").min = ALL[0].date;
    document.getElementById("datePick").max = last;
    if (!SELECTED) SELECTED = last;
    render();
  } catch (e) {
    app.innerHTML = '<div class="err">공포탐욕 데이터를 불러오지 못했습니다.<br><br>' + e.message + '</div>';
    return;
  }
  try {
    mergeQqq(ALL, await loadQqq());
    render();
  } catch (e) {
    const note = document.getElementById("note");
    if (note) note.textContent = "지수는 불러왔지만 QQQ는 아직 연결되지 않았습니다.";
  }
}
document.getElementById("reload").addEventListener("click", load);
document.getElementById("searchBtn").addEventListener("click", searchDate);
document.getElementById("todayBtn").addEventListener("click", goLatest);
document.getElementById("datePick").addEventListener("change", function() {
  document.getElementById("dateText").value = document.getElementById("datePick").value;
  searchDate();
});
document.getElementById("dateText").addEventListener("keydown", function(e) {
  if (e.key === "Enter") searchDate();
});
load();
