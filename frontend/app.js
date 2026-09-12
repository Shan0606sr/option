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
  row.edge_pct = row.spot ? (row.edge / row.spot) * 100 : 0;
  row.hit = Boolean(row.spot && row.synthetic && row.synthetic > row.spot);
  return row;
}

function renderPlan1(snapshot) {
  state.plan1 = snapshot;
  state.connected = Boolean(snapshot.connected);
  setPill(state.connected);
  if (snapshot.last_update) document.getElementById("last-update").textContent = snapshot.last_update;
  const rows = snapshot.rows || [];
  const priced = rows.filter((row) => row.ce > 0 && row.pe > 0).length;
  const hits = rows.filter((row) => row.hit).length;
  document.getElementById("stocks-scanned").textContent = snapshot.stocks_scanned || rows.length || 0;
  document.getElementById("opp-count").textContent = `${hits} hits / ${priced} priced`;

  const bar = document.getElementById("alert-bar");
  const notice = snapshot.message || snapshot.error;
  if (notice) {
    bar.classList.remove("hidden");
    bar.textContent = notice;
  } else {
    bar.classList.add("hidden");
  }

  const hitsOnly = document.getElementById("plan1-hits-only").checked;
  const visible = rows.filter((row) => !hitsOnly || row.hit);
  const body = document.getElementById("plan1-body");
  const empty = document.getElementById("plan1-empty");
  body.innerHTML = "";
  if (!visible.length) {
    empty.classList.remove("hidden");
    empty.textContent = state.connected
      ? (hitsOnly ? "No row where LTP is below strike + CE − PE yet." : (snapshot.message || "No Option plan 1 rows."))
      : "Connect Zerodha, then scan Option plan 1.";
    return;
  }
  empty.classList.add("hidden");

  for (const row of visible) {
    const ready = row.spot && row.ce && row.pe;
    const tr = document.createElement("tr");
    if (row.hit) tr.className = "hit";
    tr.innerHTML = `
      <td><strong>${row.symbol}</strong></td>
      <td class="num">${row.spot ? money(row.spot) : "—"}</td>
      <td class="num">${row.strike ? inr(row.strike, 0) : "—"}</td>
      <td class="num">${row.ce ? inr(row.ce) : "—"}</td>
      <td class="num">${row.pe ? inr(row.pe) : "—"}</td>
      <td class="num">${ready ? money(row.synthetic) : "—"}</td>
      <td class="num">${ready ? `${row.edge > 0 ? "+" : ""}${inr(row.edge)}` : "—"}</td>
      <td class="${row.hit ? "signal-yes" : "signal-no"}">${ready ? (row.hit ? "LTP < synth" : "No") : "…"}</td>
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
    rows.sort((a, b) => (b.edge || 0) - (a.edge || 0) || a.symbol.localeCompare(b.symbol));
    const priced = rows.filter((row) => row.ce > 0 && row.pe > 0).length;
    const hits = rows.filter((row) => row.hit).length;
    renderPlan1({
      ...snapshot,
      rows,
      pairs_priced: priced,
      hits,
      message: `Option plan 1: ${priced} pairs priced, ${hits} with LTP < strike + CE − PE.`,
      error: priced ? "" : (data.error || snapshot.error),
    });
    if (data.error && !priced) return;
  }
}

async function runPlan1() {
  const id = ++priceFillId;
  const btn = document.getElementById("plan1-btn");
  btn.disabled = true;
  btn.textContent = "Scanning…";
  try {
    const snapshot = await fetchJson("/api/plan1");
    renderPlan1(snapshot);
    btn.textContent = "Loading premiums…";
    await fillPlan1Premiums(snapshot, id);
  } catch (error) {
    renderPlan1({
      connected: state.connected,
      rows: [],
      error: error.message,
    });
  } finally {
    btn.disabled = false;
    btn.textContent = "Scan plan 1";
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
        await runPlan1();
      } else if (state.plan1) {
        renderPlan1(state.plan1);
      }
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
document.getElementById("plan1-hits-only").addEventListener("change", () => {
  if (state.plan1) renderPlan1(state.plan1);
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
  if (document.getElementById("scan-btn").disabled) return;
  runScan();
}, 120000);

boot();
