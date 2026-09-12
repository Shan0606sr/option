const LIQUIDITY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2, LTP: 3 };
const LIQUIDITY_FLOOR = { ALL: 3, MEDIUM: 1, HIGH: 0 };

const state = {
  expiry: "nearest",
  rows: [],
  expiries: [],
  nearest: null,
  next: null,
  connected: false,
  snapshot: null,
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

function setPill(connected) {
  const pill = document.getElementById("conn-pill");
  const login = document.getElementById("login-btn");
  if (connected) {
    pill.textContent = "Zerodha connected";
    pill.className = "pill pill-live";
    login.hidden = true;
  } else {
    pill.textContent = "Zerodha login required";
    pill.className = "pill pill-dummy";
    login.hidden = false;
  }
}

function render(snapshot) {
  state.snapshot = snapshot;
  state.connected = Boolean(snapshot.connected);
  setPill(state.connected);

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

function applyCloses(rows, closes) {
  for (const row of rows) {
    if (!row.spot && closes[String(row.spot_token)]) row.spot = closes[String(row.spot_token)];
    if (!row.future && closes[String(row.fut_token)]) row.future = closes[String(row.fut_token)];
    row.basis = row.future && row.spot ? row.future - row.spot : 0;
    row.basis_pct = row.spot ? (row.basis / row.spot) * 100 : 0;
  }
}

let priceFillId = 0;

async function fillMissingPrices(snapshot) {
  const rows = snapshot.underlyings || [];
  const tokens = [];
  for (const row of rows) {
    if (!row.spot && row.spot_token) tokens.push(String(row.spot_token));
    if (!row.future && row.fut_token) tokens.push(String(row.fut_token));
  }
  if (!tokens.length) return;

  const id = ++priceFillId;
  const unique = [...new Set(tokens)];
  const chunk = 12;
  for (let i = 0; i < unique.length; i += chunk) {
    if (id !== priceFillId) return;
    const slice = unique.slice(i, i + chunk);
    const data = await fetchJson(`/api/prices?tokens=${encodeURIComponent(slice.join(","))}`);
    if (id !== priceFillId) return;
    applyCloses(rows, data.closes || {});
    const counts = recountPrices(rows);
    const done = Math.min(i + chunk, unique.length);
    render({
      ...snapshot,
      ...counts,
      underlyings: rows,
      price_source: "historical",
      message: counts.spots_priced || counts.futures_priced
        ? `Last daily close: ${counts.spots_priced} stocks, ${counts.futures_priced} futures (${done}/${unique.length} tokens). Weekend close is fine.`
        : (data.error || "Historical closes also failed. This Kite app may not include market data."),
      error: counts.spots_priced || counts.futures_priced ? "" : (data.error || snapshot.error),
    });
    if (data.error && !(counts.spots_priced || counts.futures_priced)) return;
  }
}

async function runScan() {
  priceFillId += 1;
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
    await fillMissingPrices(snapshot);
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
  if (status.connected) {
    await runScan();
  } else {
    render({
      connected: false,
      opportunities: [],
      stocks_scanned: 0,
      error: "Connect Zerodha to load live NSE bid/ask. This cannot run from dummy data.",
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

document.getElementById("scan-btn").addEventListener("click", runScan);
document.getElementById("drawer-close").addEventListener("click", closeDrawer);
document.getElementById("backdrop").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDrawer();
});

window.setInterval(() => {
  if (state.connected && document.visibilityState === "visible") runScan();
}, 30000);

boot();
