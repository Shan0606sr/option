const LIQUIDITY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2, LTP: 3 };
const LIQUIDITY_FLOOR = { ALL: 3, MEDIUM: 1, HIGH: 0 };

const state = {
  expiry: "nearest",
  tab: "index",
  rows: [],
  expiries: [],
  nearest: null,
  next: null,
  connected: false,
  snapshot: null,
  scanned: false,
  plan1: null,
  plan1Scanned: false,
};

function inr(n, digits = 2) {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function money(n) {
  return `₹${inr(n)}`;
}

function capitalFmt(n) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  return money(n);
}

function pct(n) {
  return `${Number(n).toFixed(2)}%`;
}

function fmtExpiry(iso) {
  const [y, m, d] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d)}-${months[Number(m) - 1]}`;
}

function fmtExpiryLong(iso) {
  const [y, m, d] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d)}-${months[Number(m) - 1]}-${y}`;
}

function visibleRows(rows) {
  const floor = LIQUIDITY_FLOOR[document.getElementById("min-liquidity").value];
  const minReturn = Number(document.getElementById("min-return").value) || 0;
  const wantA = document.getElementById("strat-a").checked;
  const wantB = document.getElementById("strat-b").checked;
  return rows.filter((row) => {
    if (row.used_ltp) {
      if (minReturn > 0 && row.gross_return < minReturn) return false;
    } else if (row.gross_return < minReturn) {
      return false;
    }
    if (row.strategy === "A" && !wantA) return false;
    if (row.strategy === "B" && !wantB) return false;
    if (LIQUIDITY_RANK[row.liquidity] > floor) return false;
    if (state.expiry === "nearest") return row.expiry === state.nearest;
    if (state.expiry === "next") return row.expiry === state.next;
    return true;
  }).map((row, i) => ({ ...row, rank: i + 1 }));
}

function setPill(connected, needReconnect) {
  const pill = document.getElementById("conn-pill");
  const login = document.getElementById("login-btn");
  const logout = document.getElementById("logout-btn");
  logout.hidden = !connected;
  if (connected && needReconnect) {
    pill.textContent = "Connected — reconnect for quotes";
    pill.className = "pill pill-dummy";
    login.hidden = false;
    login.textContent = "Reconnect Zerodha";
  } else if (connected) {
    pill.textContent = "Zerodha connected";
    pill.className = "pill pill-live";
    login.hidden = true;
    login.textContent = "Connect Zerodha";
  } else {
    pill.textContent = "Zerodha login required";
    pill.className = "pill pill-dummy";
    login.hidden = false;
    login.textContent = "Connect Zerodha";
  }
}

function render(snapshot) {
  state.snapshot = snapshot;
  state.connected = Boolean(snapshot.connected);
  const denied = /PermissionException|Insufficient permission|quotes denied|Reconnect Zerodha/i.test(
    `${snapshot.message || ""} ${snapshot.price_error || ""} ${snapshot.error || ""}`
  );
  setPill(state.connected, Boolean(state.connected && denied && !(snapshot.spots_priced || snapshot.futures_priced)));

  const rows = snapshot.underlyings || [];
  document.getElementById("last-update").textContent = snapshot.last_update || "--:--:--";
  document.getElementById("stocks-scanned").textContent = snapshot.stocks_scanned || rows.length || 0;
  document.getElementById("opp-count").textContent = `${snapshot.spots_priced || 0} spot / ${snapshot.futures_priced || 0} fut`;

  const bar = document.getElementById("alert-bar");
  const notice = snapshot.message || snapshot.error;
  if (notice) {
    bar.classList.remove("hidden");
    bar.textContent = notice;
  } else {
    bar.classList.add("hidden");
  }

  const body = document.getElementById("results-body");
  const empty = document.getElementById("empty-state");
  body.innerHTML = "";
  if (!rows.length) {
    empty.classList.remove("hidden");
    empty.textContent = state.connected
      ? (snapshot.message || "No stock/future prices returned.")
      : "Connect Zerodha to load live prices.";
    return;
  }
  empty.classList.add("hidden");

  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${row.symbol}</strong></td>
      <td class="num">${row.spot ? money(row.spot) : "—"}</td>
      <td class="num">${row.future ? money(row.future) : "—"}</td>
      <td>${row.expiry ? fmtExpiry(row.expiry) : "—"}</td>
      <td class="num">${row.spot && row.future ? money(row.basis) : "—"}</td>
      <td class="num">${row.spot && row.future ? pct(row.basis_pct) : "—"}</td>
    `;
    body.appendChild(tr);
  }
}

function kv(label, value, extra = "") {
  return `<div><span>${label}</span><b class="${extra}">${value}</b></div>`;
}

function openDrawer(row) {
  document.getElementById("d-symbol").textContent = `${row.symbol} ${inr(row.strike, 0)} · ${pct(row.gross_return)}`;
  document.getElementById("d-name").textContent = row.name;
  const buyStock = row.strategy === "A";
  const c = row.charges || {};
  const ce = row.ce || {};
  const pe = row.pe || {};
  document.getElementById("drawer-body").innerHTML = `
    <div class="kv">
      ${kv("Spot", money(row.spot))}
      ${kv("Expiry", fmtExpiryLong(row.expiry))}
      ${kv("Strike", money(row.strike))}
      ${kv("Strategy", row.strategy_label)}
    </div>
    <hr class="rule" />
    <div class="legs">
      <div class="leg"><em>${buyStock ? "BUY STOCK" : "SELL STOCK"}</em><span>${money(row.spot)}</span></div>
      <div class="leg"><em>${buyStock ? "SELL" : "BUY"} ${inr(row.strike, 0)} CE</em><span>${money(row.ce_px)}</span></div>
      <div class="leg"><em>${buyStock ? "BUY" : "SELL"} ${inr(row.strike, 0)} PE</em><span>${money(row.pe_px)}</span></div>
    </div>
    <hr class="rule" />
    <div class="kv">
      ${kv(buyStock ? "Effective cost" : "Effective credit", money(row.effective_cost))}
      ${kv("Guaranteed value", money(row.guaranteed_value))}
      ${kv("Profit / share", money(row.profit_per_share))}
      ${kv("Lot size", inr(row.lot_size, 0))}
      ${kv("Executable qty", inr(row.executable_qty, 0))}
      ${kv(row.partial ? "Gross profit (executable)" : "Gross profit", money(row.gross_profit))}
      ${kv("Estimated charges", money(c.total || 0))}
      ${kv("Estimated net profit", money(row.net_profit), "net")}
      ${kv("Net return", pct(row.net_return), "net")}
    </div>
    <hr class="rule" />
    <div class="kv">
      ${kv("CE bid / qty", `${inr(ce.bid || 0)} · ${inr(ce.bid_qty || 0, 0)}`)}
      ${kv("CE ask / qty", `${inr(ce.ask || 0)} · ${inr(ce.ask_qty || 0, 0)}`)}
      ${kv("CE LTP (info only)", inr(ce.ltp || ce.last_price || 0))}
      ${kv("PE bid / qty", `${inr(pe.bid || 0)} · ${inr(pe.bid_qty || 0, 0)}`)}
      ${kv("PE ask / qty", `${inr(pe.ask || 0)} · ${inr(pe.ask_qty || 0, 0)}`)}
      ${kv("PE LTP (info only)", inr(pe.ltp || pe.last_price || 0))}
    </div>
    <div class="badge liq liq-${row.liquidity}">Liquidity ${row.liquidity}${row.partial ? " · partial" : ""}</div>
  `;
  document.getElementById("drawer").hidden = false;
  document.getElementById("backdrop").hidden = false;
}

function closeDrawer() {
  document.getElementById("drawer").hidden = true;
  document.getElementById("drawer").classList.remove("wide");
  document.getElementById("backdrop").hidden = true;
}

async function fetchJson(url, options) {
  const res = await fetch(url, { credentials: "same-origin", ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data.error) data.error = `Request failed (${res.status})`;
  return data;
}

function recountPrices(rows) {
  return {
    spots_priced: rows.filter((row) => row.spot > 0).length,
    futures_priced: rows.filter((row) => row.future > 0).length,
  };
}

function applyCloses(rows, closes, spots = {}, futures = {}) {
  for (const row of rows) {
    if (!row.spot && closes[String(row.spot_token)]) row.spot = closes[String(row.spot_token)];
    if (!row.future && closes[String(row.fut_token)]) row.future = closes[String(row.fut_token)];
    if (!row.spot && spots[row.symbol]) row.spot = spots[row.symbol];
    if (!row.future && futures[row.symbol]) row.future = futures[row.symbol];
    row.basis = row.future && row.spot ? row.future - row.spot : 0;
    row.basis_pct = row.spot ? (row.basis / row.spot) * 100 : 0;
  }
}

let priceFillId = 0;

async function fillMissingPrices(snapshot, id) {
  const rows = snapshot.underlyings || [];
  const missing = rows.filter((row) => (!row.spot || !row.future) && (row.spot_token || row.fut_token || row.symbol));
  if (!missing.length) return;

  const chunk = 6;
  for (let i = 0; i < missing.length; i += chunk) {
    if (id !== priceFillId) return;
    const batch = missing.slice(i, i + chunk);
    const tokens = batch.flatMap((row) => [row.spot_token, row.fut_token].filter(Boolean));
    const params = new URLSearchParams({
      tokens: tokens.join(","),
      symbols: batch.map((row) => row.symbol).join(","),
      expiry: batch[0].expiry || "",
    });
    const data = await fetchJson(`/api/prices?${params}`);
    if (id !== priceFillId) return;
    applyCloses(rows, data.closes || {}, data.spots || {}, data.futures || {});
    const counts = recountPrices(rows);
    const done = Math.min(i + chunk, missing.length);
    render({
      ...snapshot,
      ...counts,
      underlyings: rows,
      price_error: "",
      message: counts.spots_priced || counts.futures_priced
        ? `Last close: ${counts.spots_priced} stocks, ${counts.futures_priced} futures (${done}/${missing.length}). Saturday uses Friday close.`
        : (data.error || "Still no prices. Reconnect Zerodha and confirm Netlify KITE_API_KEY is the paid app."),
      error: counts.spots_priced || counts.futures_priced ? "" : (data.error || snapshot.error),
    });
    if (data.error && !(counts.spots_priced || counts.futures_priced)) return;
  }
}

async function runScan() {
  const id = ++priceFillId;
  const btn = document.getElementById("scan-btn");
  btn.disabled = true;
  btn.textContent = "Scanning…";
  try {
    const params = new URLSearchParams({
      min_return: "0",
      strategy_a: "true",
      strategy_b: "true",
    });
    const snapshot = await fetchJson(`/api/scan?${params}`);
    render(snapshot);
    btn.textContent = "Loading prices…";
    await fillMissingPrices(snapshot, id);
  } catch (error) {
    render({
      connected: state.connected,
      opportunities: [],
      error: error.message,
      last_update: new Date().toLocaleTimeString("en-IN", { hour12: false }),
    });
  } finally {
    btn.disabled = false;
    btn.textContent = "Scan now";
  }
}

function renderNifty(data) {
  state.connected = Boolean(data.connected);
  setPill(state.connected, Boolean(data.error && /PermissionException|Insufficient permission/i.test(data.error)));
  if (data.last_update) document.getElementById("last-update").textContent = data.last_update;

  const liveEl = document.getElementById("nifty-live");
  const prevEl = document.getElementById("nifty-prev");
  const chEl = document.getElementById("nifty-change");
  liveEl.textContent = data.live ? inr(data.live) : "—";
  prevEl.textContent = data.previous_close ? inr(data.previous_close) : "—";
  if (data.live && data.previous_close) {
    const sign = data.change > 0 ? "+" : "";
    chEl.textContent = `${sign}${inr(data.change)} (${sign}${Number(data.change_pct).toFixed(2)}%)`;
    chEl.className = data.change >= 0 ? "up" : "down";
  } else {
    chEl.textContent = "—";
    chEl.className = "";
  }

  const bits = [];
  if (data.source) bits.push(`via ${data.source}`);
  if (data.market_open === false) bits.push("market closed — last session price");
  if (data.api_key_tail) bits.push(`Netlify key …${data.api_key_tail}`);
  if (data.live || data.previous_close) {
    bits.push("Zerodha price received");
  } else {
    bits.push(data.error || "No Nifty price yet");
  }
  document.getElementById("nifty-meta").textContent = bits.join(" · ");

  const bar = document.getElementById("alert-bar");
  if (!(data.live || data.previous_close) && (data.error || data.message)) {
    bar.classList.remove("hidden");
    bar.textContent = data.error || data.message;
  } else if (state.tab === "index") {
    bar.classList.add("hidden");
  }
}

async function loadNifty() {
  const btn = document.getElementById("nifty-btn");
  btn.disabled = true;
  btn.textContent = "Loading…";
  try {
    const data = await fetchJson("/api/nifty");
    renderNifty(data);
  } catch (error) {
    renderNifty({ connected: state.connected, error: error.message, live: 0, previous_close: 0 });
  } finally {
    btn.disabled = false;
    btn.textContent = "Refresh Nifty";
  }
}

function showTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".page-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  document.getElementById("panel-index").hidden = tab !== "index";
  document.getElementById("panel-stocks").hidden = tab !== "stocks";
  document.getElementById("panel-plan1").hidden = tab !== "plan1";
  document.getElementById("panel-synth").hidden = tab !== "synth";
  document.getElementById("panel-callarb").hidden = tab !== "callarb";
  document.getElementById("panel-putarb").hidden = tab !== "putarb";
  document.getElementById("panel-boxarb").hidden = tab !== "boxarb";
  document.getElementById("panel-vertce").hidden = tab !== "vertce";
  document.getElementById("panel-vertpe").hidden = tab !== "vertpe";
}

async function consumeKiteRedirect() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("request_token")) {
    await fetchJson("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_token: params.get("request_token") }),
    });
    window.history.replaceState({}, "", "/");
  } else if (params.get("kite")) {
    window.history.replaceState({}, "", "/");
  }
}

async function boot() {
  await consumeKiteRedirect();
  const status = await fetchJson("/api/status").catch(() => ({ connected: false }));
  setPill(Boolean(status.connected));
  showTab("index");
  if (status.connected) {
    await loadNifty();
  } else {
    renderNifty({
      connected: false,
      error: "Connect Zerodha to test Nifty live price.",
      live: 0,
      previous_close: 0,
    });
  }
}

document.querySelectorAll("[data-expiry]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-expiry]").forEach((el) => el.classList.remove("active"));
    btn.classList.add("active");
    state.expiry = btn.dataset.expiry;
    if (state.snapshot) render(state.snapshot);
  });
});

["min-return", "min-liquidity", "strat-a", "strat-b"].forEach((id) => {
  document.getElementById(id).addEventListener("change", () => {
    if (state.snapshot) render(state.snapshot);
  });
});

function bookLtp(books, closes, key, token) {
  const book = (books && (books[key] || books[String(token)])) || null;
  if (book && book.ltp) return book.ltp;
  if (token && closes && closes[String(token)]) return closes[String(token)];
  return 0;
}

function finishPlan1Row(row) {
  row.synthetic = row.strike && row.ce ? row.strike + row.ce - (row.pe || 0) : 0;
  row.edge = row.spot && row.synthetic ? row.synthetic - row.spot : 0;
  row.edge_pct = row.spot && row.synthetic ? (row.edge / row.spot) * 100 : 0;
  if (row.spot && row.synthetic) {
    row.side = row.edge > 0 ? "positive" : row.edge < 0 ? "negative" : "flat";
  } else {
    row.side = "";
  }
  row.hit = row.side === "positive";
  return row;
}

function fillPlan1StockSelect(stocks, selected) {
  const select = document.getElementById("plan1-stock");
  const current = selected || select.value;
  select.innerHTML = `<option value="">Select F&amp;O stock</option>`;
  for (const stock of stocks || []) {
    const symbol = stock.symbol || stock;
    const opt = document.createElement("option");
    opt.value = symbol;
    opt.textContent = symbol;
    if (symbol === current) opt.selected = true;
    select.appendChild(opt);
  }
}

function renderPlan1(snapshot) {
  state.plan1 = snapshot;
  state.connected = Boolean(snapshot.connected);
  setPill(state.connected);
  if (snapshot.last_update) document.getElementById("last-update").textContent = snapshot.last_update;
  fillPlan1StockSelect(snapshot.stocks, snapshot.symbol);
  const rows = snapshot.rows || [];
  const priced = rows.filter((row) => row.ce > 0).length;
  const pos = rows.filter((row) => row.side === "positive").length;
  const neg = rows.filter((row) => row.side === "negative").length;
  document.getElementById("stocks-scanned").textContent = (snapshot.stocks || []).length || snapshot.stocks_scanned || 0;
  document.getElementById("opp-count").textContent = `${pos} + / ${neg} −`;

  const bar = document.getElementById("alert-bar");
  const notice = snapshot.message || snapshot.error;
  if (notice) {
    bar.classList.remove("hidden");
    bar.textContent = notice;
  } else {
    bar.classList.add("hidden");
  }

  const body = document.getElementById("plan1-body");
  const empty = document.getElementById("plan1-empty");
  body.innerHTML = "";
  if (!rows.length) {
    empty.classList.remove("hidden");
    empty.textContent = state.connected
      ? (snapshot.message || "Select a stock to load every strike.")
      : "Connect Zerodha, then select a stock.";
    return;
  }
  empty.classList.add("hidden");

  for (const row of rows) {
    const ready = row.spot && row.ce;
    const tr = document.createElement("tr");
    if (row.side === "positive") tr.className = "hit";
    if (row.side === "negative") tr.className = "miss";
    const pctText = ready
      ? `${row.edge_pct > 0 ? "+" : ""}${Number(row.edge_pct).toFixed(2)}% ${row.side === "negative" ? "loss" : row.side === "positive" ? "return" : ""}`
      : "—";
    const sideText = row.side === "positive" ? "Positive" : row.side === "negative" ? "Negative" : ready ? "Flat" : "…";
    tr.innerHTML = `
      <td class="num">${row.strike ? inr(row.strike, 0) : "—"}</td>
      <td class="num">${row.ce ? inr(row.ce) : "—"}</td>
      <td class="num">${row.pe || row.pe === 0 ? inr(row.pe) : "—"}</td>
      <td class="num">${ready ? money(row.synthetic) : "—"}</td>
      <td class="num">${row.spot ? money(row.spot) : "—"}</td>
      <td class="num">${ready ? `${row.edge > 0 ? "+" : ""}${inr(row.edge)}` : "—"}</td>
      <td class="num ${row.side === "positive" ? "signal-yes" : row.side === "negative" ? "signal-no-red" : ""}">${pctText}</td>
      <td class="${row.side === "positive" ? "signal-yes" : row.side === "negative" ? "signal-no-red" : "signal-no"}">${sideText}</td>
    `;
    body.appendChild(tr);
  }
}

async function fillPlan1Premiums(snapshot, id) {
  const rows = snapshot.rows || [];
  const missing = rows.filter((row) => (!row.ce || !row.pe) && (row.ce_key || row.pe_key));
  if (!missing.length) return;
  const chunk = 16;
  for (let i = 0; i < missing.length; i += chunk) {
    if (id !== priceFillId) return;
    const batch = missing.slice(i, i + chunk);
    const params = new URLSearchParams({
      keys: batch.flatMap((row) => [row.ce_key, row.pe_key].filter(Boolean)).join(","),
      tokens: batch.flatMap((row) => [row.ce_token, row.pe_token].filter(Boolean)).join(","),
    });
    const data = await fetchJson(`/api/quotes?${params}`);
    if (id !== priceFillId) return;
    const books = data.books || {};
    const closes = data.closes || {};
    for (const row of rows) {
      if (!row.ce) row.ce = bookLtp(books, closes, row.ce_key, row.ce_token);
      if (!row.pe) row.pe = bookLtp(books, closes, row.pe_key, row.pe_token);
      finishPlan1Row(row);
    }
    rows.sort((a, b) => a.strike - b.strike);
    const priced = rows.filter((row) => row.ce > 0).length;
    const pos = rows.filter((row) => row.side === "positive").length;
    const neg = rows.filter((row) => row.side === "negative").length;
    renderPlan1({
      ...snapshot,
      rows,
      pairs_priced: priced,
      hits: pos,
      message: `${snapshot.symbol || "Stock"}: ${priced} strikes priced · ${pos} positive · ${neg} negative.`,
      error: priced ? "" : (data.error || snapshot.error),
    });
    if (data.error && !priced) return;
  }
}

async function loadPlan1Universe() {
  const snapshot = await fetchJson("/api/plan1");
  renderPlan1(snapshot);
}

async function runPlan1() {
  const symbol = document.getElementById("plan1-stock").value;
  const id = ++priceFillId;
  const btn = document.getElementById("plan1-btn");
  btn.disabled = true;
  btn.textContent = symbol ? "Loading strikes…" : "Loading names…";
  try {
    const snapshot = await fetchJson(symbol ? `/api/plan1?symbol=${encodeURIComponent(symbol)}` : "/api/plan1");
    renderPlan1(snapshot);
    if (symbol) {
      btn.textContent = "Loading premiums…";
      await fillPlan1Premiums(snapshot, id);
    }
  } catch (error) {
    renderPlan1({
      connected: state.connected,
      stocks: (state.plan1 && state.plan1.stocks) || [],
      rows: [],
      error: error.message,
    });
  } finally {
    btn.disabled = false;
    btn.textContent = "Load strikes";
  }
}

document.querySelectorAll(".page-tab").forEach((btn) => {
  btn.addEventListener("click", async () => {
    showTab(btn.dataset.tab);
    if (btn.dataset.tab === "index") {
      if (state.connected) await loadNifty();
      return;
    }
    if (btn.dataset.tab === "plan1") {
      if (state.connected && !state.plan1Scanned) {
        state.plan1Scanned = true;
        await loadPlan1Universe();
      } else if (state.plan1) {
        renderPlan1(state.plan1);
      }
      return;
    }
    if (btn.dataset.tab === "synth") {
      if (state.connected && !synthState.started) await startSynthScanner();
      else refreshSynth();
      return;
    }
    if (btn.dataset.tab === "callarb") {
      if (state.connected && !carState.started) await startCallArbScanner();
      else refreshCallArb();
      return;
    }
    if (btn.dataset.tab === "putarb") {
      if (state.connected && !parState.started) await startPutArbScanner();
      else refreshPutArb();
      return;
    }
    if (btn.dataset.tab === "boxarb") {
      if (state.connected && !boxState.started) await startBoxArbScanner();
      else refreshBoxArb();
      return;
    }
    if (btn.dataset.tab === "vertce") {
      if (state.connected && !vceState.started) await startVertCeScanner();
      else refreshVertCe();
      return;
    }
    if (btn.dataset.tab === "vertpe") {
      if (state.connected && !vpeState.started) await startVertPeScanner();
      else refreshVertPe();
      return;
    }
    if (state.connected && !state.scanned) {
      state.scanned = true;
      await runScan();
    } else if (state.snapshot) {
      render(state.snapshot);
    }
  });
});

async function logoutZerodha() {
  priceFillId += 1;
  await fetchJson("/api/logout", { method: "POST" });
  state.connected = false;
  state.snapshot = null;
  state.scanned = false;
  state.plan1 = null;
  state.plan1Scanned = false;
  setPill(false);
  document.getElementById("stocks-scanned").textContent = "0";
  document.getElementById("opp-count").textContent = "0";
  document.getElementById("last-update").textContent = "--:--:--";
  renderNifty({
    connected: false,
    live: 0,
    previous_close: 0,
    error: "Logged out. Connect Zerodha again to authorize the current Netlify API key.",
  });
  if (state.tab === "stocks") {
    render({
      connected: false,
      opportunities: [],
      stocks_scanned: 0,
      error: "Logged out. Connect Zerodha again.",
    });
  }
  if (state.tab === "plan1") {
    renderPlan1({
      connected: false,
      rows: [],
      error: "Logged out. Connect Zerodha again.",
    });
  }
  stopSynthScanner();
  stopCallArbScanner();
  stopPutArbScanner();
  stopBoxArbScanner();
  stopVertCeScanner();
  stopVertPeScanner();
}

document.getElementById("logout-btn").addEventListener("click", logoutZerodha);
document.getElementById("nifty-btn").addEventListener("click", loadNifty);
document.getElementById("scan-btn").addEventListener("click", () => {
  state.scanned = true;
  runScan();
});
document.getElementById("plan1-btn").addEventListener("click", () => {
  state.plan1Scanned = true;
  runPlan1();
});
document.getElementById("plan1-stock").addEventListener("change", () => {
  if (document.getElementById("plan1-stock").value) {
    state.plan1Scanned = true;
    runPlan1();
  }
});
document.getElementById("synth-btn").addEventListener("click", startSynthScanner);
document.getElementById("synth-log-btn").addEventListener("click", downloadSynthLog);
document.getElementById("car-btn").addEventListener("click", startCallArbScanner);
document.getElementById("par-btn").addEventListener("click", startPutArbScanner);
document.getElementById("box-btn").addEventListener("click", startBoxArbScanner);
document.getElementById("vce-btn").addEventListener("click", startVertCeScanner);
document.getElementById("vpe-btn").addEventListener("click", startVertPeScanner);
[
  "car-min-net", "car-min-rom", "car-min-edge", "car-filter", "car-lots", "car-df",
  "car-slip", "car-slip-spread", "car-side-a", "car-side-b", "car-show-no",
].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("input", refreshCallArb);
});
[
  "par-min-net", "par-min-rom", "par-min-edge", "par-filter", "par-lots", "par-df",
  "par-slip", "par-slip-spread", "par-side-a", "par-side-b", "par-show-no",
].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("input", refreshPutArb);
});
document.querySelectorAll("#panel-callarb input, #panel-callarb select").forEach((el) => {
  el.addEventListener("change", () => {
    persistCallArbRates();
    if (el.id === "car-expiry" || el.id === "car-stock" || el.id === "car-band" || el.id === "car-max-strikes") {
      if (state.connected) startCallArbScanner();
      return;
    }
    refreshCallArb();
  });
});
document.querySelectorAll("#panel-putarb input, #panel-putarb select").forEach((el) => {
  el.addEventListener("change", () => {
    persistPutArbRates();
    if (el.id === "par-expiry" || el.id === "par-stock" || el.id === "par-band" || el.id === "par-max-strikes") {
      if (state.connected) startPutArbScanner();
      return;
    }
    refreshPutArb();
  });
});
[
  "box-min-net", "box-min-rom", "box-min-edge", "box-filter", "box-lots",
  "box-slip", "box-slip-spread", "box-side-a", "box-side-b", "box-show-no",
].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("input", refreshBoxArb);
});
document.querySelectorAll("#panel-boxarb input, #panel-boxarb select").forEach((el) => {
  el.addEventListener("change", () => {
    persistBoxArbRates();
    if (el.id === "box-expiry" || el.id === "box-stock" || el.id === "box-band" || el.id === "box-max-strikes") {
      if (state.connected) startBoxArbScanner();
      return;
    }
    refreshBoxArb();
  });
});
[
  "vce-min-net", "vce-min-rom", "vce-min-edge", "vce-filter", "vce-lots",
  "vce-slip", "vce-slip-spread", "vce-show-no",
].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("input", refreshVertCe);
});
document.querySelectorAll("#panel-vertce input, #panel-vertce select").forEach((el) => {
  el.addEventListener("change", () => {
    persistVertCeRates();
    if (el.id === "vce-expiry" || el.id === "vce-stock" || el.id === "vce-band" || el.id === "vce-max-strikes") {
      if (state.connected) startVertCeScanner();
      return;
    }
    refreshVertCe();
  });
});
[
  "vpe-min-net", "vpe-min-rom", "vpe-min-edge", "vpe-filter", "vpe-lots",
  "vpe-slip", "vpe-slip-spread", "vpe-show-no",
].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("input", refreshVertPe);
});
document.querySelectorAll("#panel-vertpe input, #panel-vertpe select").forEach((el) => {
  el.addEventListener("change", () => {
    persistVertPeRates();
    if (el.id === "vpe-expiry" || el.id === "vpe-stock" || el.id === "vpe-band" || el.id === "vpe-max-strikes") {
      if (state.connected) startVertPeScanner();
      return;
    }
    refreshVertPe();
  });
});
["synth-allin", "synth-slip-fut", "synth-slip-opt", "synth-min-net"].forEach((id) => {
  document.getElementById(id).addEventListener("change", refreshSynth);
});
document.getElementById("synth-expiry").addEventListener("change", () => {
  if (state.connected) startSynthScanner();
});
document.getElementById("drawer-close").addEventListener("click", closeDrawer);
document.getElementById("backdrop").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDrawer();
});

window.setInterval(() => {
  if (!state.connected || document.visibilityState !== "visible") return;
  if (state.tab === "index") {
    if (!document.getElementById("nifty-btn").disabled) loadNifty();
    return;
  }
  if (state.tab === "plan1") {
    if (!document.getElementById("plan1-btn").disabled) runPlan1();
    return;
  }
  if (state.tab === "synth" || state.tab === "callarb" || state.tab === "putarb" || state.tab === "boxarb" || state.tab === "vertce" || state.tab === "vertpe") return;
  if (document.getElementById("scan-btn").disabled) return;
  runScan();
}, 120000);

boot();
