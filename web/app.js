"use strict";

// ---------- 小工具 ----------
const $ = (s, el = document) => el.querySelector(s);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const pct = (x, d = 1) => (x >= 0 ? "+" : "") + (x * 100).toFixed(d) + "%";
const num = (x) => Number(x).toLocaleString("en-US", { maximumFractionDigits: 2 });
const HOLD_LIMIT = -0.30; // 使用者說過：跌 30% 會想全部賣掉

async function api(path, body) {
  const opt = { headers: { "X-Serenity": "1" } };
  if (body !== undefined) {
    opt.method = "POST";
    opt.headers["Content-Type"] = "application/json";
    opt.body = JSON.stringify(body);
  }
  const r = await fetch(path, opt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3000);
}

// ---------- 推文卡片 ----------
function tweetCard(t, opts = {}) {
  const card = el("div", "card");
  card.dataset.id = t.id;
  const meta = el("div", "meta");
  meta.append(el("span", "", t.time), el("span", "", t.kind));
  if (t.views) meta.append(el("span", "", `${num(t.views)} 次瀏覽`));
  meta.append(el("span", "spacer"));
  const a = el("a", "", "在 X 上看");
  a.href = t.url;
  a.target = "_blank";
  meta.append(a);
  card.append(meta);

  const body = el("div", "text");
  if (t.locked) {
    body.className = "text locked";
    body.textContent = "付費訂閱者限定的推文，看不到內容。";
  } else if (t.zh) {
    body.textContent = t.zh;
  } else {
    body.className = "text pending";
    body.textContent = t.text;
  }
  card.append(body);

  const foot = el("div", "foot");
  if (t.tickers.length) {
    const chips = el("div", "chips");
    chips.style.margin = "0";
    t.tickers.forEach((tk) => {
      const c = el("button", "chip", "$" + tk);
      c.onclick = () => (location.hash = "#ticker/" + tk);
      chips.append(c);
    });
    foot.append(chips);
  }
  if (!t.locked) {
    const tog = el("button", "linkbtn", t.zh ? "看英文原文" : "翻譯中…");
    tog.disabled = !t.zh;
    let en = false;
    tog.onclick = () => {
      en = !en;
      body.textContent = en ? t.text : t.zh;
      body.className = en ? "text en" : "text";
      tog.textContent = en ? "看中文" : "看英文原文";
    };
    card._setZh = (zh) => {
      t.zh = zh;
      if (!en) { body.textContent = zh; body.className = "text"; }
      tog.textContent = "看英文原文";
      tog.disabled = false;
    };
    card._failZh = () => { tog.textContent = "（翻譯失敗，顯示原文）"; };
    foot.append(tog);
  }
  if (opts.onStart) {
    const b = el("button", "btn ghost small", "從這則開始買");
    b.title = "假設看到這則推文就買，算到今天賺賠多少";
    b.onclick = () => opts.onStart(t);
    foot.append(b);
  }
  card.append(foot);
  return card;
}

// 沒翻過的一次送 10 則去翻
async function translateCards(container) {
  const cards = [...container.querySelectorAll(".card")].filter((c) => c._setZh && !c.dataset.zhAsked &&
    $(".text", c).classList.contains("pending"));
  for (let i = 0; i < cards.length; i += 10) {
    const batch = cards.slice(i, i + 10);
    batch.forEach((c) => (c.dataset.zhAsked = "1"));
    try {
      const res = await api("/api/translate", { ids: batch.map((c) => c.dataset.id) });
      batch.forEach((c) => (res[c.dataset.id] ? c._setZh(res[c.dataset.id]) : c._failZh()));
    } catch (e) {
      batch.forEach((c) => c._failZh());
    }
  }
}

// ---------- 狀態列 ----------
async function loadStatus() {
  try {
    const s = await api("/api/status");
    const box = $("#status");
    box.textContent = "";
    box.append(el("div", "", `推文更新到 ${s.latest}`));
    if (s.latestDays >= 2) box.append(el("div", "", `（已經 ${s.latestDays} 天沒有新推文）`));
  } catch (e) {
    $("#status").textContent = "讀不到狀態";
  }
}

$("#refresh").onclick = async () => {
  const b = $("#refresh");
  b.disabled = true;
  b.textContent = "抓取中…";
  try {
    const r = await api("/api/refresh", {});
    toast(r.new ? `抓到 ${r.new} 則新推文` : "沒有新推文");
    await loadStatus();
    if (r.new && current === "latest") renderLatest(true);
  } catch (e) {
    toast("抓取失敗：" + e.message);
  }
  b.disabled = false;
  b.textContent = "抓最新推文";
};

// ---------- 最新推文 ----------
let latestOffset = 0;
async function renderLatest(reset) {
  const list = $("#latest-list");
  if (reset || !list.childElementCount) {
    latestOffset = 0;
    list.textContent = "";
    list.append(el("div", "loading", "讀取中…"));
  }
  try {
    const d = await api(`/api/latest?offset=${latestOffset}&limit=30`);
    if (latestOffset === 0) list.textContent = "";
    d.tweets.forEach((t) => list.append(tweetCard(t)));
    latestOffset += d.tweets.length;
    $("#latest-more").hidden = latestOffset >= d.total;
    translateCards(list);
  } catch (e) {
    list.textContent = "";
    list.append(el("div", "error", "讀取失敗：" + e.message));
  }
}
$("#latest-more").onclick = () => renderLatest(false);

// ---------- 查股票 ----------
const QUICK = ["NBIS", "SIVE", "LITE", "AXTI", "AAOI", "MU", "SNDK", "COHR", "NVDA", "ESMT"];
QUICK.forEach((tk) => {
  const c = el("button", "chip", "$" + tk + (tk === "ESMT" ? "（晶豪科）" : ""));
  c.onclick = () => (location.hash = "#ticker/" + tk);
  $("#ticker-quick").append(c);
});
$("#ticker-form").onsubmit = (e) => {
  e.preventDefault();
  const tk = $("#ticker-input").value.trim().toUpperCase().replace(/^\$/, "");
  if (tk) location.hash = "#ticker/" + tk;
};

let tickerState = null;
async function renderTicker(tk) {
  const out = $("#ticker-result");
  out.textContent = "";
  if (!tk) return;
  $("#ticker-input").value = tk;
  out.append(el("div", "loading", `查 $${tk} 中…`));
  let info;
  try {
    info = await api(`/api/ticker?t=${encodeURIComponent(tk)}`);
  } catch (e) {
    out.textContent = "";
    out.append(el("div", "error", "查詢失敗：" + e.message));
    return;
  }
  out.textContent = "";
  if (!info.count) {
    out.append(el("div", "card", `推文存檔裡沒有他提到 $${tk} 的紀錄。代號打錯了嗎？`));
    return;
  }
  const head = el("div", "t-head");
  head.append(el("h2", "", "$" + tk));
  head.append(el("span", "muted", `他提過 ${info.count} 次，最近 30 天 ${info.recent30} 次`));
  out.append(head);

  const seg = el("div", "seg");
  const bFirst = el("button", "", "他第一次提到就買");
  const bLast = el("button", "", "他最近一次提到才買");
  seg.append(bFirst, bLast);
  out.append(seg);
  const fromNote = el("div", "note");
  out.append(fromNote);
  const btBox = el("div");
  out.append(btBox);

  out.append(el("h2", "sub", `他提到 $${tk} 的推文（最新的在上面）`));
  const list = el("div", "list");
  out.append(list);
  const start = (t) => { load(t.id); window.scrollTo(0, 0); $(".main").scrollTo({ top: 0, behavior: "smooth" }); };
  info.tweets.forEach((t) => list.append(tweetCard(t, { onStart: start })));
  translateCards(list);

  tickerState = { tk };
  async function load(from) {
    [bFirst, bLast].forEach((b) => b.classList.remove("on"));
    if (from === "first") bFirst.classList.add("on");
    if (from === "last") bLast.classList.add("on");
    btBox.textContent = "";
    fromNote.textContent = "";
    btBox.append(el("div", "loading", "計算中…"));
    try {
      const d = await api(`/api/backtest?t=${encodeURIComponent(tk)}&from=${from}`);
      if (tickerState.tk !== tk) return;
      btBox.textContent = "";
      fromNote.textContent = `從 ${d.from.time}（台灣時間）這則推文之後開始買：「${(d.from.zh || d.from.text).slice(0, 60)}…」`;
      renderBacktest(btBox, d);
    } catch (e) {
      btBox.textContent = "";
      btBox.append(el("div", "error", "回測失敗：" + e.message));
    }
  }
  bFirst.onclick = () => load("first");
  bLast.onclick = () => load("last");
  load("first");
}

function tile(k, v, d, extra) {
  const t = el("div", "tile");
  t.append(el("div", "k", k), el("div", "v", v));
  if (d) t.append(el("div", "d", d));
  if (extra) t.append(extra);
  return t;
}

function renderBacktest(box, d) {
  const s = d.stats, b = d.bench;
  const tiles = el("div", "tiles");
  tiles.append(tile("跟他買到今天", pct(s.ret),
    `${s.entry_day} 買 ${num(s.entry)} → ${s.last_day} ${num(s.last)} ${d.currency}`));
  const over = s.max_dd <= HOLD_LIMIT;
  const flag = el("div", over ? "warn" : "ok",
    over ? "⚠ 超過你說能承受的 30%，很可能撐不住" : "✓ 沒有超過你說能承受的 30%");
  tiles.append(tile("中間從高點最多跌", pct(s.max_dd), `${s.dd_from} 高點 → ${s.dd_to} 低點`, flag));
  tiles.append(tile("同期間買 QQQ", pct(b.ret), `那斯達克 100 ETF，最多跌 ${pct(b.max_dd)}`));
  tiles.append(tile("抱了多久", `${s.days} 天`, "交易日（有開盤的日子）"));
  box.append(tiles);

  const card = el("div", "chart-card");
  const legend = el("div", "legend");
  const l1 = el("span"); const k1 = el("span", "key"); k1.style.background = "var(--series-1)";
  l1.append(k1, document.createTextNode(`跟他買 $${d.ticker}`));
  const l2 = el("span"); const k2 = el("span", "key"); k2.style.background = "var(--series-2)";
  l2.append(k2, document.createTextNode("改買 QQQ"));
  const l3 = el("span"); l3.append(el("span", "rug"), document.createTextNode("他那天有提到"));
  legend.append(l1, l2, l3);
  card.append(legend);
  const holder = el("div");
  card.append(holder);
  box.append(card);
  lineChart(holder, card, d);

  const det = el("details", "table");
  det.append(el("summary", "", "看數字表（每 5 個交易日一列）"));
  const tb = el("table", "grid");
  const hr = el("tr");
  ["日期", `$${d.ticker} 收盤`, `跟他買`, "改買 QQQ"].forEach((h, i) => hr.append(el("th", i ? "num" : "", h)));
  tb.append(hr);
  d.series.filter((_, i) => i % 5 === 0 || i === d.series.length - 1).forEach((p) => {
    const tr = el("tr");
    tr.append(el("td", "", p.d), el("td", "num", num(p.c)), el("td", "num", pct(p.s)), el("td", "num", pct(p.q)));
    tb.append(tr);
  });
  det.append(tb);
  box.append(det);
  box.append(el("p", "note", "假設看到推文後用下一個收盤價買進；股價來自 Yahoo Finance，已還原除權息。沒算手續費和匯率。"));
}

// ---------- 折線圖（單一 Y 軸：買進後的報酬 %）----------
function lineChart(holder, card, d) {
  const NS = "http://www.w3.org/2000/svg";
  const H = 300, M = { t: 10, r: 86, b: 44, l: 56 };
  const tip = el("div", "tip");
  tip.hidden = true;
  card.append(tip);

  function draw() {
    holder.textContent = "";
    const W = Math.max(320, holder.clientWidth);
    const pw = W - M.l - M.r, ph = H - M.t - M.b;
    const pts = d.series;
    const n = pts.length;
    const ys = pts.flatMap((p) => [p.s, p.q]).concat([0]);
    let lo = Math.min(...ys), hi = Math.max(...ys);
    const step = niceStep((hi - lo) / 5);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    if (hi === lo) hi = lo + step;
    const x = (i) => M.l + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
    const y = (v) => M.t + (1 - (v - lo) / (hi - lo)) * ph;

    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "chart");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("height", H);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `跟他買 ${d.ticker} 與改買 QQQ 的報酬走勢`);
    const add = (tag, attrs, text) => {
      const e = document.createElementNS(NS, tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      if (text != null) e.textContent = text;
      svg.append(e);
      return e;
    };
    // 橫向格線與 Y 軸刻度
    for (let v = lo; v <= hi + 1e-9; v += step) {
      const yy = y(v);
      add("line", { x1: M.l, x2: M.l + pw, y1: yy, y2: yy, stroke: Math.abs(v) < 1e-9 ? "var(--axis)" : "var(--grid)", "stroke-width": 1 });
      add("text", { x: M.l - 8, y: yy + 4, "text-anchor": "end" }, pct(v, 0));
    }
    // X 軸日期
    const ticks = Math.min(6, n);
    for (let k = 0; k < ticks; k++) {
      const i = Math.round((k / Math.max(1, ticks - 1)) * (n - 1));
      add("text", { x: x(i), y: H - 8, "text-anchor": k === 0 ? "start" : k === ticks - 1 ? "end" : "middle" },
        pts[i].d.slice(2).replace(/-/g, "/"));
    }
    // 他提到的日子：圖下方的小刻度
    const idx = new Map(pts.map((p, i) => [p.d, i]));
    for (const [day, cnt] of Object.entries(d.marks)) {
      const i = idx.get(day);
      if (i == null) continue;
      add("line", { x1: x(i), x2: x(i), y1: M.t + ph + 6, y2: M.t + ph + 6 + Math.min(12, 4 + cnt * 2), stroke: "var(--muted)", "stroke-width": 1.5 });
    }
    // 兩條線
    const path = (key) => pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join("");
    add("path", { d: path("q"), fill: "none", stroke: "var(--series-2)", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" });
    add("path", { d: path("s"), fill: "none", stroke: "var(--series-1)", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" });
    // 線尾直接標數字（兩個太近就錯開）
    const last = pts[n - 1];
    let ys1 = y(last.s), ys2 = y(last.q);
    if (Math.abs(ys1 - ys2) < 16) { if (ys1 < ys2) { ys1 -= 8; ys2 += 8; } else { ys1 += 8; ys2 -= 8; } }
    add("circle", { cx: x(n - 1), cy: y(last.s), r: 4, fill: "var(--series-1)", stroke: "var(--surface)", "stroke-width": 2 });
    add("circle", { cx: x(n - 1), cy: y(last.q), r: 4, fill: "var(--series-2)", stroke: "var(--surface)", "stroke-width": 2 });
    add("text", { x: x(n - 1) + 10, y: ys1 + 4, class: "end" }, `$${d.ticker} ${pct(last.s, 0)}`);
    add("text", { x: x(n - 1) + 10, y: ys2 + 4, class: "end" }, `QQQ ${pct(last.q, 0)}`);

    // 滑鼠十字線
    const cross = add("line", { y1: M.t, y2: M.t + ph, stroke: "var(--axis)", "stroke-width": 1, visibility: "hidden" });
    const dot1 = add("circle", { r: 4, fill: "var(--series-1)", stroke: "var(--surface)", "stroke-width": 2, visibility: "hidden" });
    const dot2 = add("circle", { r: 4, fill: "var(--series-2)", stroke: "var(--surface)", "stroke-width": 2, visibility: "hidden" });
    const hit = add("rect", { x: M.l, y: M.t, width: pw, height: ph + 22, fill: "transparent" });
    hit.addEventListener("pointermove", (ev) => {
      const r = svg.getBoundingClientRect();
      const px = (ev.clientX - r.left) * (W / r.width);
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - M.l) / pw) * (n - 1))));
      const p = pts[i];
      for (const e of [cross, dot1, dot2]) e.setAttribute("visibility", "visible");
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i));
      dot1.setAttribute("cx", x(i)); dot1.setAttribute("cy", y(p.s));
      dot2.setAttribute("cx", x(i)); dot2.setAttribute("cy", y(p.q));
      tip.textContent = "";
      tip.append(el("div", "muted", p.d));
      const row = (color, value, label) => {
        const rr = el("div", "row");
        const k = el("span", "key"); k.style.background = color;
        rr.append(k, el("b", "", value), el("span", "", label));
        return rr;
      };
      tip.append(row("var(--series-1)", pct(p.s), `$${d.ticker}（收盤 ${num(p.c)}）`));
      tip.append(row("var(--series-2)", pct(p.q), "QQQ"));
      if (d.marks[p.d]) tip.append(el("div", "muted", `他這天提到 ${d.marks[p.d]} 次`));
      tip.hidden = false;
      const cardR = card.getBoundingClientRect();
      const left = r.left - cardR.left + (x(i) / W) * r.width;
      tip.style.left = Math.min(cardR.width - tip.offsetWidth - 8, Math.max(8, left + 12)) + "px";
      tip.style.top = (r.top - cardR.top + 20) + "px";
    });
    hit.addEventListener("pointerleave", () => {
      for (const e of [cross, dot1, dot2]) e.setAttribute("visibility", "hidden");
      tip.hidden = true;
    });
    holder.append(svg);
  }
  draw();
  new ResizeObserver(() => draw()).observe(holder);
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 0.01)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

// ---------- 熱門股票 ----------
async function renderTop() {
  const out = $("#top-result");
  if (out.dataset.done) return;
  out.textContent = "";
  out.append(el("div", "loading", "計算中（第一次約 5～10 秒）…"));
  try {
    const d = await api("/api/top?days=30&n=15");
    out.textContent = "";
    const box = el("div", "box");
    const tb = el("table", "grid");
    const hr = el("tr");
    [["代號", ""], ["最近 30 天提到", "num"], ["第一次提到", ""], ["那時就買，到今天", "num"],
     ["中間最多跌", "num"], ["最近才跟，到今天", "num"]].forEach(([h, c]) => hr.append(el("th", c, h)));
    tb.append(hr);
    d.rows.forEach((r) => {
      const tr = el("tr", "click");
      tr.onclick = () => (location.hash = "#ticker/" + r.ticker);
      tr.append(el("td", "", "$" + r.ticker), el("td", "num", `${r.recent} 次`));
      if (r.error) {
        const td = el("td", "muted", "抓不到股價");
        td.colSpan = 4;
        tr.append(td);
      } else {
        tr.append(el("td", "", r.first), el("td", "num" + (r.firstRet < 0 ? " neg" : ""), pct(r.firstRet)));
        tr.append(el("td", "num" + (r.firstDD <= HOLD_LIMIT ? " neg" : ""), pct(r.firstDD) + (r.firstDD <= HOLD_LIMIT ? " ⚠" : "")));
        tr.append(el("td", "num" + (r.lastRet < 0 ? " neg" : ""), pct(r.lastRet)));
      }
      tb.append(tr);
    });
    box.append(tb);
    out.append(box);
    out.append(el("p", "note", `推文算到 ${d.until}。⚠ = 中間從高點跌超過 30%，也就是你說會想全部賣掉的程度。`));
    out.append(el("p", "note", "注意：這張表挑的是他「最近還在講」的股票，本來就偏向賺錢的；他講過、後來不再提的賠錢股不在表裡。"));
    out.dataset.done = "1";
  } catch (e) {
    out.textContent = "";
    out.append(el("div", "error", "計算失敗：" + e.message));
  }
}

// ---------- 問 AI ----------
const EXAMPLES = ["Serenity 最近在講什麼？", "跟他買晶豪科值得嗎？", "他最近明確買進或賣出哪些股票？",
  "用他的方法幫我看台積電", "有人拉我進 Serenity 的 LINE 跟單群，是詐騙嗎？"];
EXAMPLES.forEach((q) => {
  const c = el("button", "chip", q);
  c.type = "button";
  c.onclick = () => { $("#ask-q").value = q; $("#ask-q").focus(); };
  $("#ask-examples").append(c);
});

function renderMarkdown(md) {
  const div = el("div", "answer");
  // 先把 < 換掉，agent 回答裡就算夾帶推文原文的 HTML 也不會被執行
  // 中文旁邊的 **粗體** marked 常常認不出來，先自己換成 <strong>
  const safe = md.replace(/</g, "&lt;").replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  div.innerHTML = window.marked ? marked.parse(safe) : "";
  if (!window.marked) div.textContent = md;
  div.querySelectorAll("a").forEach((a) => {
    if (!/^https?:/i.test(a.getAttribute("href") || "")) a.removeAttribute("href");
    else a.target = "_blank";
  });
  return div;
}

$("#ask-form").onsubmit = async (e) => {
  e.preventDefault();
  const q = $("#ask-q").value.trim();
  if (!q) return;
  const mode = document.querySelector('input[name="mode"]:checked').value;
  $("#ask-send").disabled = true;
  try {
    const r = await api("/api/ask", { q, mode });
    $("#ask-q").value = "";
    watchJob(r.id);
  } catch (err) {
    toast("送出失敗：" + err.message);
  }
  $("#ask-send").disabled = false;
};

const watching = new Set();
function watchJob(id) {
  if (watching.has(id)) return;
  watching.add(id);
  const card = el("div", "card");
  const qEl = el("div", "q", "");
  const st = el("div", "muted", "serenity agent 正在查資料…");
  card.append(qEl, st);
  $("#ask-running").prepend(card);
  const tick = async () => {
    try {
      const j = await api(`/api/ask/${id}`);
      qEl.textContent = j.question;
      if (j.status === "running") {
        st.textContent = `serenity agent 正在查推文、算回測、上網找資料…已經 ${j.seconds} 秒（${j.model === "opus" ? "仔細模式・Opus 5.5 xhigh" : "快速模式・Sonnet 5"}）`;
        setTimeout(tick, 3000);
        return;
      }
      watching.delete(id);
      card.remove();
      renderAskHistory();
      toast(j.status === "done" ? "AI 回答好了" : "AI 沒有回答成功");
    } catch (err) {
      st.textContent = "連不到伺服器，稍後再試。";
      setTimeout(tick, 5000);
    }
  };
  tick();
}

async function renderAskHistory() {
  const box = $("#ask-history");
  try {
    const d = await api("/api/asks");
    d.running.forEach((j) => watchJob(j.id));
    box.textContent = "";
    if (!d.history.length) box.append(el("div", "muted", "還沒有問過。"));
    d.history.forEach((h, i) => {
      const det = el("details", "card hist");
      if (i === 0) det.open = true;
      const sum = el("summary");
      sum.append(el("div", "q", h.question));
      sum.append(el("div", "muted small", `${h.at}・${h.model === "opus" ? "仔細・Opus 5.5 xhigh" : "快速・Sonnet 5"}・花了 ${h.seconds ?? "?"} 秒`));
      det.append(sum);
      det.append(h.status === "done" ? renderMarkdown(h.answer) : el("div", "error", h.answer));
      box.append(det);
    });
  } catch (e) {
    box.textContent = "";
    box.append(el("div", "error", "讀取失敗：" + e.message));
  }
}

// ---------- 分頁切換 ----------
let current = null;
function route() {
  const [page, arg] = (location.hash.slice(1) || "latest").split("/");
  const name = ["latest", "ticker", "top", "ask"].includes(page) ? page : "latest";
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("on", p.id === "page-" + name));
  document.querySelectorAll(".nav").forEach((a) => a.classList.toggle("on", a.dataset.page === name));
  const changed = current !== name;
  current = name;
  if (name === "latest" && changed) renderLatest(!$("#latest-list").childElementCount);
  if (name === "ticker") renderTicker(arg ? decodeURIComponent(arg).toUpperCase() : "");
  if (name === "top") renderTop();
  if (name === "ask" && changed) renderAskHistory();
  $(".main").scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
loadStatus();
route();
