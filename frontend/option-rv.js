const ORV_RATES_KEY = "option_rv_rates_v1";
const ORV_HIST_KEY = "option_rv_hist_v1";

const orvState = {
  pairs: [],
  books: {},
  stocks: [],
  ticker: null,
  started: false,
  source: "",
  rows: [],
  selected: null,
  hist: {},
  lastHistAt: {},
};

function orvEl(id) {
  return document.getElementById(id);
}

function orvNum(id, fallback) {
  const value = Number(orvEl(id) && orvEl(id).value);
  return Number.isFinite(value) ? value : fallback;
}

function orvChecked(id) {
  return Boolean(orvEl(id) && orvEl(id).checked);
}

function readOrvStored() {
  try {
    return { ...OptionRv.DEFAULTS, ...(JSON.parse(localStorage.getItem(ORV_RATES_KEY) || "{}")) };
  } catch (_err) {
    return { ...OptionRv.DEFAULTS };
  }
}

function readOrvForm() {
  const stored = readOrvStored();
  return OptionRv.mergeConfig({
    ...stored,
    rate: orvNum("orv-rate", stored.rate),
    maxSpreadPct: orvNum("orv-opt-spread", stored.maxSpreadPct),
    cheapResidualPct: orvNum("orv-cheap-res", stored.cheapResidualPct),
    extremeResidualPct: orvNum("orv-ext-res", stored.extremeResidualPct),
    cheapZ: orvNum("orv-cheap-z", stored.cheapZ),
    extremeCheapZ: orvNum("orv-ext-cheap-z", stored.extremeCheapZ),
    expensiveZ: orvNum("orv-exp-z", stored.expensiveZ),
    extremeExpensiveZ: orvNum("orv-ext-exp-z", stored.extremeExpensiveZ),
    minHistory: Math.max(5, Math.round(orvNum("orv-min-hist", stored.minHistory) || 20)),
    staleMs: orvNum("orv-stale", stored.staleMs || 2500),
    minFit: Math.max(3, Math.round(orvNum("orv-min-fit", stored.minFit) || 4)),
  });
}

function persistOrvRates() {
  localStorage.setItem(ORV_RATES_KEY, JSON.stringify(readOrvForm()));
}

function fillOrvForm(cfg) {
  const c = OptionRv.mergeConfig(cfg);
  const set = (id, value) => { if (orvEl(id)) orvEl(id).value = value; };
  set("orv-rate", c.rate);
  set("orv-opt-spread", c.maxSpreadPct);
  set("orv-cheap-res", c.cheapResidualPct);
  set("orv-ext-res", c.extremeResidualPct);
  set("orv-cheap-z", c.cheapZ);
  set("orv-ext-cheap-z", c.extremeCheapZ);
  set("orv-exp-z", c.expensiveZ);
  set("orv-ext-exp-z", c.extremeExpensiveZ);
  set("orv-min-hist", c.minHistory);
  set("orv-stale", c.staleMs || 2500);
  set("orv-min-fit", c.minFit);
}

function loadOrvHist() {
  try {
    orvState.hist = JSON.parse(localStorage.getItem(ORV_HIST_KEY) || "{}") || {};
  } catch (_err) {
    orvState.hist = {};
  }
}

function saveOrvHist() {
  try {
    const keys = Object.keys(orvState.hist);
    if (keys.length > 4000) {
      for (const key of keys.slice(0, keys.length - 3000)) delete orvState.hist[key];
    }
    localStorage.setItem(ORV_HIST_KEY, JSON.stringify(orvState.hist));
  } catch (_err) { /* quota */ }
}

function orvBook(token) {
  return orvState.books[String(token)] || {
    ltp: 0, bid: 0, ask: 0, bid_qty: 0, ask_qty: 0, bid_depth: 0, ask_depth: 0, volume: 0, oi: 0, ts: 0,
  };
}

function orvLookup(books, ...keys) {
  for (const key of keys) {
    if (key && books[key]) return books[key];
    if (key && books[String(key)]) return books[String(key)];
  }
  return null;
}

function applyOrvIncomingBooks(books, pairs, ts) {
  if (!books) return;
  for (const pair of pairs) {
    for (const [token, key] of [
      [pair.ce_token, pair.ce_key],
      [pair.pe_token, pair.pe_key],
      [pair.fut_token, pair.fut_key],
      [pair.eq_token, pair.eq_key],
    ]) {
      if (!token) continue;
      const q = orvLookup(books, key, token);
      if (!q) continue;
      const prev = orvBook(token);
      const ltp = Number(q.last_price || q.ltp || q.close || 0);
      orvState.books[String(token)] = {
        ltp: ltp > 0 ? ltp : prev.ltp,
        bid: Number(q.bid || 0) || prev.bid,
        ask: Number(q.ask || 0) || prev.ask,
        bid_qty: Number(q.bid_qty || 0) || prev.bid_qty,
        ask_qty: Number(q.ask_qty || 0) || prev.ask_qty,
        bid_depth: Number(q.bid_depth || q.bid_qty || 0) || prev.bid_depth,
        ask_depth: Number(q.ask_depth || q.ask_qty || 0) || prev.ask_depth,
        volume: Number(q.volume || 0) || prev.volume,
        oi: Number(q.oi || 0) || prev.oi,
        ts: ltp > 0 || Number(q.bid || 0) || Number(q.ask || 0) ? ts : prev.ts,
      };
    }
  }
}

function paintOrvMode(session, method) {
  const box = orvEl("orv-mode");
  if (!box) return;
  box.className = `synth-mode ${session.live ? "synth-mode-live" : "synth-mode-ltp"}`;
  if (orvEl("orv-mode-label")) orvEl("orv-mode-label").textContent = session.live ? "🟢 LIVE BID/ASK" : "🟡 LTP / THEORETICAL";
  if (orvEl("orv-mode-reason")) {
    orvEl("orv-mode-reason").textContent = `${session.reason}. Relative-value labels, never guaranteed arbitrage.`;
  }
  if (orvEl("orv-method")) orvEl("orv-method").textContent = `${method.label} · (B) buy/ask · (S) sell/bid`;
}

function futPx(book, session) {
  if (session.live) {
    if (book.bid > 0 && book.ask > 0) return (book.bid + book.ask) / 2;
    if (book.ltp > 0) return book.ltp;
    return 0;
  }
  return Number(book.ltp || 0) || ((Number(book.bid || 0) && Number(book.ask || 0)) ? (book.bid + book.ask) / 2 : 0);
}

function ivFromPrice(price, F, K, T, isCall, cfg) {
  if (!(price > 0) || !(F > 0) || !(T > 0)) return { iv: null, reason: "missing" };
  if (!OptionRv.timeValueOk(price, F, K, T, isCall, cfg.rate, cfg)) {
    return { iv: null, reason: "too little time value" };
  }
  return OptionRv.impliedVol({
    price, F, K, T, isCall, rate: cfg.rate, minIv: cfg.minIv, maxIv: cfg.maxIv,
  });
}

function evaluateOrvOption(pair, type, session, cfg, F, T, smile, now) {
  const isCall = type === "CE";
  const token = isCall ? pair.ce_token : pair.pe_token;
  const symbol = isCall ? pair.ce_symbol : pair.pe_symbol;
  if (!token) return null;
  const book = orvBook(token);
  const futB = orvBook(pair.fut_token);
  const eqB = pair.eq_token ? orvBook(pair.eq_token) : { ltp: 0 };
  const liveQuote = OptionRv.quoteValid(book, cfg, session.live);
  const reasons = [];
  if (!liveQuote.ok) reasons.push(liveQuote.reason);
  if (session.live && book.ts && Date.now() - book.ts > (cfg.staleMs || 2500)) reasons.push("stale quote");
  if (!(F > 0)) reasons.push("missing future");
  if (!(T > 0)) reasons.push("invalid expiry");
  if (!smile || !smile.ok || smile.n < cfg.minFit) reasons.push("curve not fitted");

  const bidIV = ivFromPrice(book.bid, F, pair.strike, T, isCall, cfg);
  const askIV = ivFromPrice(book.ask, F, pair.strike, T, isCall, cfg);
  const midPx = liveQuote.ok ? liveQuote.mid : Number(book.ltp || 0);
  const midIV = ivFromPrice(midPx, F, pair.strike, T, isCall, cfg);
  const expected = smile && smile.ok ? smile.predict(pair.strike) : null;
  const expectedClamped = expected != null ? Math.min(cfg.maxIv, Math.max(cfg.minIv, expected)) : null;

  const resAsk = askIV.iv && expectedClamped ? (askIV.iv - expectedClamped) * 100 : null;
  const resBid = bidIV.iv && expectedClamped ? (bidIV.iv - expectedClamped) * 100 : null;
  const resMid = midIV.iv && expectedClamped ? (midIV.iv - expectedClamped) * 100 : null;

  let residual = resMid;
  let market = midPx;
  let marketSide = session.live ? "mid" : "ltp";
  if (session.live && resAsk != null && resAsk <= -cfg.cheapResidualPct) {
    residual = resAsk;
    market = book.ask;
    marketSide = "ask";
  } else if (session.live && resBid != null && resBid >= cfg.cheapResidualPct) {
    residual = resBid;
    market = book.bid;
    marketSide = "bid";
  } else if (session.live && askIV.iv && expectedClamped && askIV.iv < expectedClamped) {
    residual = resAsk;
    market = book.ask;
    marketSide = "ask";
  } else if (session.live && bidIV.iv && expectedClamped && bidIV.iv > expectedClamped) {
    residual = resBid;
    market = book.bid;
    marketSide = "bid";
  }

  const ivUsed = marketSide === "ask" ? askIV.iv : marketSide === "bid" ? bidIV.iv : midIV.iv;
  const histKey = `${pair.symbol}|${pair.expiry}|${pair.strike}|${type}`;
  const history = orvState.hist[histKey] || [];
  const z = residual != null ? OptionRv.zScore(residual, history, cfg.minHistory) : null;
  if (residual != null && now - (orvState.lastHistAt[histKey] || 0) > 15000) {
    const next = history.concat([residual]).slice(-120);
    orvState.hist[histKey] = next;
    orvState.lastHistAt[histKey] = now;
  }

  const incomplete = residual == null || expectedClamped == null || !(market > 0);
  const fair = (!incomplete && expectedClamped)
    ? OptionRv.black76({ F, K: pair.strike, T, sigma: expectedClamped, isCall, rate: cfg.rate })
    : 0;
  const mis = incomplete ? 0 : fair - market;
  const misPct = market > 0 && !incomplete ? (mis / market) * 100 : 0;
  const liq = OptionRv.liquidityScore({
    bid: book.bid, ask: book.ask, bidQty: book.bid_qty, askQty: book.ask_qty,
    volume: book.volume, oi: book.oi, lot: pair.lot_size,
  });
  const cls = incomplete
    ? { bucket: "INVALID", label: "⚫ NO IV", cheap: false, expensive: false, via: "none", relativeValue: true, live: session.live, note: reasons[0] || "no IV" }
    : OptionRv.classify({ z, residualPct: residual, cfg, live: session.live });
  if (!incomplete && session.live && liq.quality === "LOW" && (cls.cheap || cls.expensive)) {
    cls.label = `${cls.label} · LOW LIQ`;
    cls.note = `${cls.note}. Wide spread or thin book — not a high-quality print.`;
  }
  const score = incomplete ? 0 : OptionRv.rvScore({
    absResidualPct: Math.abs(residual),
    z,
    liquidity: liq,
    r2: smile && smile.r2,
    live: session.live,
    stale: reasons.includes("stale quote"),
  });

  return {
    id: `orv|${pair.symbol}|${pair.expiry}|${type}|${pair.strike}`,
    pair,
    type,
    symbol: pair.symbol,
    expiry: pair.expiry,
    strike: pair.strike,
    lot: pair.lot_size,
    optSymbol: symbol,
    F,
    T,
    spot: Number(eqB.ltp || 0),
    future: F,
    futBid: futB.bid,
    futAsk: futB.ask,
    market,
    marketSide,
    bid: book.bid,
    ask: book.ask,
    ltp: book.ltp,
    iv: ivUsed,
    bidIv: bidIV.iv,
    askIv: askIV.iv,
    midIv: midIV.iv,
    expected: expectedClamped,
    residual,
    z,
    histN: history.length,
    fair,
    mis,
    misPct,
    liq,
    score,
    smileN: smile ? smile.n : 0,
    smileR2: smile ? smile.r2 : 0,
    smileKind: smile ? smile.kind : "none",
    live: session.live,
    usedLtp: !session.live,
    incomplete,
    reasons,
    status: cls.bucket,
    statusLabel: cls.label,
    statusNote: cls.note,
    cheap: cls.cheap,
    expensive: cls.expensive,
    volume: book.volume,
    oi: book.oi,
    ts: book.ts,
  };
}

function evaluateOptionRv() {
  const session = nseSession();
  const cfg = readOrvForm();
  const method = OptionRv.methodology();
  paintOrvMode(session, method);
  const groups = new Map();
  for (const pair of orvState.pairs) {
    const key = `${pair.symbol}|${pair.expiry}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(pair);
  }
  const rows = [];
  const now = Date.now();
  for (const group of groups.values()) {
    const futB = orvBook(group[0].fut_token);
    const F = futPx(futB, session);
    const T = OptionRv.yearFraction(group[0].expiry, now);
    const callPts = [];
    const putPts = [];
    for (const pair of group) {
      const ceB = pair.ce_token ? orvBook(pair.ce_token) : null;
      const peB = pair.pe_token ? orvBook(pair.pe_token) : null;
      if (ceB && F > 0) {
        const q = OptionRv.quoteValid(ceB, cfg, session.live);
        if (q.ok) {
          const iv = ivFromPrice(q.mid, F, pair.strike, T, true, cfg);
          if (iv.iv) callPts.push({ strike: pair.strike, iv: iv.iv, weight: 1 / Math.max(0.25, OptionRv.spreadPct(ceB.bid, ceB.ask) || 8) });
        }
      }
      if (peB && F > 0) {
        const q = OptionRv.quoteValid(peB, cfg, session.live);
        if (q.ok) {
          const iv = ivFromPrice(q.mid, F, pair.strike, T, false, cfg);
          if (iv.iv) putPts.push({ strike: pair.strike, iv: iv.iv, weight: 1 / Math.max(0.25, OptionRv.spreadPct(peB.bid, peB.ask) || 8) });
        }
      }
    }
    const callSmile = OptionRv.fitSmile(callPts, F);
    const putSmile = OptionRv.fitSmile(putPts, F);
    for (const pair of group) {
      const ce = evaluateOrvOption(pair, "CE", session, cfg, F, T, callSmile, now);
      const pe = evaluateOrvOption(pair, "PE", session, cfg, F, T, putSmile, now);
      if (ce) rows.push(ce);
      if (pe) rows.push(pe);
    }
  }
  const rank = { EXTREME_CHEAP: 0, EXTREME_EXPENSIVE: 0, CHEAP: 1, EXPENSIVE: 1, NORMAL: 2, INVALID: 3 };
  rows.sort((a, b) => {
    const rs = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
    if (rs) return rs;
    const liq = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    const lq = (liq[a.liq && a.liq.quality] ?? 3) - (liq[b.liq && b.liq.quality] ?? 3);
    if (lq) return lq;
    return (b.score - a.score)
      || (Math.abs(b.z != null ? b.z : (b.residual || 0)) - Math.abs(a.z != null ? a.z : (a.residual || 0)));
  });
  orvState.rows = rows;
  return rows;
}

function visibleOrv(rows) {
  const minRes = orvNum("orv-min-res", 0);
  const minMis = orvNum("orv-min-mis", 0);
  const minScore = orvNum("orv-min-score", 0);
  const showNormal = orvChecked("orv-show-normal");
  const showCeCheap = !orvEl("orv-ce-cheap") || orvChecked("orv-ce-cheap");
  const showCeExp = !orvEl("orv-ce-exp") || orvChecked("orv-ce-exp");
  const showPeCheap = !orvEl("orv-pe-cheap") || orvChecked("orv-pe-cheap");
  const showPeExp = !orvEl("orv-pe-exp") || orvChecked("orv-pe-exp");
  const filter = (orvEl("orv-filter") && orvEl("orv-filter").value || "").trim().toUpperCase();
  return rows.filter((row) => {
    if (filter && !row.symbol.includes(filter)) return false;
    if (row.incomplete) return showNormal;
    if (row.status === "NORMAL" || row.status === "INVALID") return showNormal;
    if (Math.abs(row.residual || 0) + 1e-9 < minRes) return false;
    if (Math.abs(row.mis || 0) + 1e-9 < minMis) return false;
    if (row.score + 1e-9 < minScore) return false;
    if (row.type === "CE" && row.cheap && !showCeCheap) return false;
    if (row.type === "CE" && row.expensive && !showCeExp) return false;
    if (row.type === "PE" && row.cheap && !showPeCheap) return false;
    if (row.type === "PE" && row.expensive && !showPeExp) return false;
    return true;
  });
}

function setOrvStatus(text) {
  const el = orvEl("orv-status");
  if (el) el.textContent = `${text}${orvState.source ? ` · ${orvState.source}` : ""}`;
}

function orvVol(iv) {
  return iv == null ? "—" : `${(iv * 100).toFixed(2)}%`;
}

function orvMark(side) {
  if (side === "ask") return `<span class="side-mark side-buy">(B)</span>`;
  if (side === "bid") return `<span class="side-mark side-sell">(S)</span>`;
  return "";
}

function renderOrvRows(rows) {
  const body = orvEl("orv-body");
  const empty = orvEl("orv-empty");
  if (!body) return;
  body.innerHTML = "";
  const visible = visibleOrv(rows);
  const flagged = rows.filter((row) => row.cheap || row.expensive).length;
  if (orvEl("opp-count") && state.tab === "optrv") {
    orvEl("opp-count").textContent = `${flagged} relative-value / ${visible.length} shown`;
    orvEl("stocks-scanned").textContent = String(new Set(orvState.pairs.map((row) => row.symbol)).size);
  }
  if (!visible.length) {
    empty.classList.remove("hidden");
    empty.textContent = orvState.pairs.length
      ? "No cheap/expensive prints after quote filters. Enable “Show normal” to see the full chain."
      : "Connect Zerodha, then start Option Intelligence.";
    return;
  }
  empty.classList.add("hidden");
  for (const row of visible) {
    const tr = document.createElement("tr");
    tr.className = row.incomplete ? "nodata" : row.cheap ? "hit" : row.expensive ? "miss" : "";
    tr.dataset.id = row.id;
    tr.title = row.statusNote;
    tr.innerHTML = `
      <td>
        <div class="stock-cell">
          <strong>${row.symbol}</strong>
          <span class="stock-meta">${row.type} · ${row.optSymbol || ""}</span>
        </div>
      </td>
      <td>${fmtExpiryLong(row.expiry)}</td>
      <td>${row.type}</td>
      <td class="num">${inr(row.strike, 0)}</td>
      <td class="num">${row.spot ? money(row.spot) : "—"}</td>
      <td class="num">${row.future ? money(row.future) : "—"}</td>
      <td class="num">${row.incomplete ? "—" : `${money(row.market)} ${orvMark(row.marketSide)}`}</td>
      <td class="num">${row.bid ? money(row.bid) : "—"}</td>
      <td class="num">${row.ask ? money(row.ask) : "—"}</td>
      <td class="num">${orvVol(row.iv)}</td>
      <td class="num">${orvVol(row.expected)}</td>
      <td class="num">${row.residual == null ? "—" : `${row.residual > 0 ? "+" : ""}${row.residual.toFixed(2)}`}</td>
      <td class="num">${row.z == null ? "—" : row.z.toFixed(2)}</td>
      <td class="num">${row.incomplete ? "—" : money(row.fair)}</td>
      <td class="num ${row.mis > 0 ? "signal-yes" : row.mis < 0 ? "signal-no" : ""}">${row.incomplete ? "—" : money(row.mis)}</td>
      <td class="num">${row.incomplete ? "—" : pct(row.misPct)}</td>
      <td class="num">${row.liq.spreadPct == null ? "—" : pct(row.liq.spreadPct)}</td>
      <td>${row.liq.quality}</td>
      <td class="num">${row.score || "—"}</td>
      <td class="${row.cheap ? "signal-yes" : row.expensive ? "signal-no-red" : "signal-no"}">${row.statusLabel}</td>
    `;
    tr.addEventListener("click", () => openOrvDrawer(row));
    body.appendChild(tr);
  }
}

function openOrvDrawer(row) {
  orvState.selected = row.id;
  const drawer = orvEl("drawer");
  drawer.classList.add("wide");
  orvEl("d-symbol").textContent = `${row.symbol} ${row.type} ${inr(row.strike, 0)} · ${row.statusLabel}`;
  orvEl("d-name").textContent = row.optSymbol || row.symbol;
  const ts = (ms) => ms ? new Date(ms).toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" }) : "—";
  orvEl("drawer-body").innerHTML = `
    <p class="badge ${row.cheap ? "net" : ""}">${row.statusLabel}</p>
    <p class="index-meta">${row.statusNote}</p>
    <div class="kv">
      ${kv("Underlying", row.symbol)}
      ${kv("Expiry", fmtExpiryLong(row.expiry))}
      ${kv("Type", row.type)}
      ${kv("Strike", inr(row.strike, 0))}
      ${kv("Lot", String(row.lot))}
      ${kv("Spot", row.spot ? money(row.spot) : "—")}
      ${kv("Future", row.future ? money(row.future) : "—")}
      ${kv("Future bid", row.futBid ? money(row.futBid) : "—")}
      ${kv("Future ask", row.futAsk ? money(row.futAsk) : "—")}
      ${kv("T (years)", row.T ? row.T.toFixed(4) : "—")}
      ${kv("Mode", row.live ? "LIVE bid/ask" : "LTP / theoretical")}
    </div>
    <hr class="rule" />
    <div class="legs">
      <div class="leg"><em>Bid</em><span>${row.bid ? money(row.bid) : "—"} ${orvMark("bid")} · IV ${orvVol(row.bidIv)}</span></div>
      <div class="leg"><em>Ask</em><span>${row.ask ? money(row.ask) : "—"} ${orvMark("ask")} · IV ${orvVol(row.askIv)}</span></div>
      <div class="leg"><em>LTP</em><span>${row.ltp ? money(row.ltp) : "—"}</span></div>
      <div class="leg"><em>Signal price</em><span>${row.market ? money(row.market) : "—"} ${orvMark(row.marketSide)}</span></div>
    </div>
    <hr class="rule" />
    <div class="kv">
      ${kv("Market IV", orvVol(row.iv))}
      ${kv("Expected IV", orvVol(row.expected))}
      ${kv("IV residual", row.residual == null ? "—" : `${row.residual.toFixed(2)} vol pts`)}
      ${kv("Z-score", row.z == null ? `— · ${row.histN}/${readOrvForm().minHistory} obs` : row.z.toFixed(2))}
      ${kv("Fair ₹", row.incomplete ? "—" : money(row.fair))}
      ${kv("Mispricing ₹", row.incomplete ? "—" : money(row.mis), row.mis > 0 ? "net" : "")}
      ${kv("Mispricing %", row.incomplete ? "—" : pct(row.misPct))}
      ${kv("Curve", `${row.smileKind} · n=${row.smileN} · R² ${(row.smileR2 || 0).toFixed(2)}`)}
      ${kv("Liquidity", `${row.liq.quality} · score ${row.liq.score}`)}
      ${kv("RV score", String(row.score))}
      ${kv("Volume", row.volume ? inr(row.volume, 0) : "—")}
      ${kv("Open interest", row.oi ? inr(row.oi, 0) : "—")}
      ${kv("Quote ts", ts(row.ts))}
    </div>
    <p class="footnote">Relative-value vs the ${row.type === "CE" ? "Call" : "Put"} IV curve only. This is not a locked payoff and is not synthetic / box / vertical arbitrage. Z-score is shown only with enough stored residuals — it is never invented from a single snapshot.</p>
  `;
  drawer.hidden = false;
  orvEl("backdrop").hidden = false;
}

function refreshOptionRv() {
  if (typeof state === "undefined" || state.tab !== "optrv") return;
  const rows = evaluateOptionRv();
  renderOrvRows(rows);
  const now = new Date().toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" });
  if (orvEl("last-update")) orvEl("last-update").textContent = now;
}

let orvPaint = 0;
function applyOrvTicks(ticks) {
  const now = Date.now();
  for (const tick of ticks) {
    const prev = orvBook(tick.instrument_token);
    orvState.books[String(tick.instrument_token)] = {
      ...prev,
      ltp: tick.ltp || prev.ltp,
      bid: tick.bid || prev.bid,
      ask: tick.ask || prev.ask,
      bid_qty: tick.bid_qty || prev.bid_qty,
      ask_qty: tick.ask_qty || prev.ask_qty,
      bid_depth: tick.bid_depth || tick.bid_qty || prev.bid_depth,
      ask_depth: tick.ask_depth || tick.ask_qty || prev.ask_depth,
      volume: tick.volume || prev.volume,
      oi: tick.oi || prev.oi,
      ts: now,
    };
  }
  if (!orvPaint) {
    orvPaint = window.requestAnimationFrame(() => {
      orvPaint = 0;
      refreshOptionRv();
    });
  }
}

function fillOrvStockSelect(stocks) {
  const sel = orvEl("orv-stock");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">All F&amp;O + indexes</option>` + stocks
    .map((row) => `<option value="${row.symbol}">${row.index ? "IDX " : ""}${row.symbol}</option>`)
    .join("");
  if ([...sel.options].some((opt) => opt.value === current)) sel.value = current;
}

async function seedOrvMissing(pairs) {
  const keys = [...new Set(pairs.flatMap((row) => [row.ce_key, row.pe_key, row.fut_key, row.eq_key].filter(Boolean)))];
  const need = keys.filter((key) => {
    const pair = pairs.find((row) => row.ce_key === key || row.pe_key === key || row.fut_key === key || row.eq_key === key);
    if (!pair) return false;
    const token = key === pair.ce_key ? pair.ce_token : key === pair.pe_key ? pair.pe_token : key === pair.eq_key ? pair.eq_token : pair.fut_token;
    const book = orvBook(token);
    return !(book.ltp > 0 || book.bid > 0 || book.ask > 0);
  });
  for (let i = 0; i < need.length; i += 40) {
    const chunk = need.slice(i, i + 40);
    setOrvStatus(`Seeding option quotes… ${Math.min(i + chunk.length, need.length)}/${need.length}`);
    const data = await fetchJson(`/api/quotes?hist=false&keys=${encodeURIComponent(chunk.join(","))}`);
    applyOrvIncomingBooks(data.books || {}, pairs, Date.now());
    refreshOptionRv();
  }
}

async function startOptionRvScanner() {
  if (!state.connected) {
    setOrvStatus("Connect Zerodha first.");
    return;
  }
  if (typeof stopSynthScanner === "function") stopSynthScanner();
  if (typeof stopCallArbScanner === "function") stopCallArbScanner();
  if (typeof stopPutArbScanner === "function") stopPutArbScanner();
  if (typeof stopBoxArbScanner === "function") stopBoxArbScanner();
  if (typeof stopVertCeScanner === "function") stopVertCeScanner();
  if (typeof stopVertPeScanner === "function") stopVertPeScanner();
  if (typeof stopSilverArbScanner === "function") stopSilverArbScanner();
  if (typeof stopButterflyScanner === "function") stopButterflyScanner();
  persistOrvRates();
  const btn = orvEl("orv-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Starting…";
  }
  try {
    const expiry = (orvEl("orv-expiry") && orvEl("orv-expiry").value) || "nearest";
    const symbol = (orvEl("orv-stock") && orvEl("orv-stock").value) || "";
    const band = orvNum("orv-band", 8);
    const maxStrikes = orvNum("orv-max-strikes", symbol ? 31 : 7);
    const snapshot = await fetchJson(
      `/api/option-rv?seed=true&expiry=${encodeURIComponent(expiry)}&symbol=${encodeURIComponent(symbol)}&band=${encodeURIComponent(band)}&max_strikes=${encodeURIComponent(maxStrikes)}`,
    );
    orvState.pairs = snapshot.pairs || [];
    orvState.books = snapshot.books || {};
    orvState.stocks = snapshot.stocks || [];
    orvState.started = true;
    state.connected = Boolean(snapshot.connected);
    setPill(state.connected);
    fillOrvStockSelect(orvState.stocks);
    const bar = orvEl("alert-bar");
    if (bar && (snapshot.message || snapshot.error)) {
      bar.classList.remove("hidden");
      bar.textContent = snapshot.message || snapshot.error;
    }
    refreshOptionRv();
    setOrvStatus("Seeding option quotes…");
    await seedOrvMissing(orvState.pairs);

    if (orvState.ticker) {
      orvState.ticker.close();
      orvState.ticker = null;
    }
    const creds = await fetchJson("/api/ticker");
    if (creds.ws_url && orvState.pairs.length) {
      orvState.source = "Kite WebSocket";
      setOrvStatus("Connecting ticker…");
      orvState.ticker = connectKiteTicker({
        wsUrl: creds.ws_url,
        tokens: snapshot.tokens || [],
        onTicks: applyOrvTicks,
        onStatus: setOrvStatus,
      });
    } else {
      orvState.source = "REST quotes";
      setOrvStatus(creds.error || "WebSocket unavailable — snapshot quotes only.");
    }
    refreshOptionRv();
  } catch (error) {
    setOrvStatus(error.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Start scanner";
    }
  }
}

function stopOptionRvScanner() {
  if (orvState.ticker) orvState.ticker.close();
  orvState.ticker = null;
  orvState.started = false;
  saveOrvHist();
  setOrvStatus("Stopped");
}

window.startOptionRvScanner = startOptionRvScanner;
window.stopOptionRvScanner = stopOptionRvScanner;
window.refreshOptionRv = refreshOptionRv;
window.fillOptionRvRates = fillOrvForm;
window.persistOptionRvRates = persistOrvRates;

window.setInterval(() => {
  if (typeof state !== "undefined" && state.tab === "optrv") {
    refreshOptionRv();
    saveOrvHist();
  }
}, 30000);

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    loadOrvHist();
    fillOrvForm(readOrvStored());
  });
} else {
  loadOrvHist();
  fillOrvForm(readOrvStored());
}
