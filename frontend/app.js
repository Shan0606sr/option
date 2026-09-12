const ALERT_NET_RETURN = 1.0;
const ALERT_MIN_EXPIRY_DAYS = 7;
const NARROW_SPREAD = 0.05;
const WIDE_SPREAD = 0.08;
const VERY_WIDE_SPREAD = 0.15;
const GOOD_VOLUME = 20000;
const GOOD_OI = 100000;
const LOW_VOLUME = 2000;
const LOW_OI = 10000;
const PARTIAL_LOW_FRACTION = 0.1;
const LIQUIDITY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const LIQUIDITY_FLOOR = { ALL: 2, MEDIUM: 1, HIGH: 0 };

const DUMMY_QUOTES = [
  {
    symbol: "POLYCAB", name: "Polycab India", expiry: "2026-09-29", strike: 1250, spot: 1230, lot_size: 1000,
    ce: { bid: 42.5, ask: 43.1, bid_qty: 2800, ask_qty: 1900, ltp: 42.8, volume: 89000, oi: 1450000 },
    pe: { bid: 29.4, ask: 30.0, bid_qty: 2200, ask_qty: 3100, ltp: 29.7, volume: 72000, oi: 1280000 },
  },
  {
    symbol: "BSE", name: "BSE", expiry: "2026-09-29", strike: 2500, spot: 2480, lot_size: 375,
    ce: { bid: 45.0, ask: 45.8, bid_qty: 1200, ask_qty: 800, ltp: 45.4, volume: 64000, oi: 980000 },
    pe: { bid: 37.2, ask: 38.0, bid_qty: 900, ask_qty: 1500, ltp: 37.6, volume: 51000, oi: 870000 },
  },
  {
    symbol: "INFY", name: "Infosys", expiry: "2026-09-29", strike: 1500, spot: 1520, lot_size: 400,
    ce: { bid: 37.4, ask: 38.0, bid_qty: 4000, ask_qty: 5600, ltp: 37.7, volume: 210000, oi: 3200000 },
    pe: { bid: 28.0, ask: 28.55, bid_qty: 4800, ask_qty: 3200, ltp: 28.25, volume: 188000, oi: 2750000 },
  },
  {
    symbol: "HINDZINC", name: "Hindustan Zinc", expiry: "2026-09-29", strike: 570, spot: 576.45, lot_size: 1225,
    ce: { bid: 21.35, ask: 23.8, bid_qty: 4200, ask_qty: 3100, ltp: 22.4, volume: 156000, oi: 2100000 },
    pe: { bid: 10.2, ask: 11.3, bid_qty: 2800, ask_qty: 3900, ltp: 10.85, volume: 134000, oi: 1890000 },
  },
  {
    symbol: "KALYAN", name: "Kalyan Jewellers", expiry: "2026-09-29", strike: 610, spot: 601, lot_size: 1350,
    ce: { bid: 15.85, ask: 16.25, bid_qty: 500, ask_qty: 2100, ltp: 16.0, volume: 184200, oi: 2101500 },
    pe: { bid: 21.05, ask: 21.45, bid_qty: 800, ask_qty: 1350, ltp: 21.2, volume: 156000, oi: 1890000 },
  },
  {
    symbol: "DIXON", name: "Dixon Technologies", expiry: "2026-09-29", strike: 16600, spot: 16500, lot_size: 50,
    ce: { bid: 280, ask: 284, bid_qty: 200, ask_qty: 150, ltp: 282, volume: 42000, oi: 186000 },
    pe: { bid: 346, ask: 350, bid_qty: 180, ask_qty: 220, ltp: 348, volume: 38000, oi: 164000 },
  },
  {
    symbol: "IREDA", name: "Indian Renewable Energy Dev Agency", expiry: "2026-09-29", strike: 175, spot: 172, lot_size: 2875,
    ce: { bid: 6.8, ask: 8.4, bid_qty: 80, ask_qty: 200, ltp: 7.5, volume: 1400, oi: 8200 },
    pe: { bid: 4.1, ask: 5.2, bid_qty: 50, ask_qty: 90, ltp: 4.6, volume: 1100, oi: 6400 },
  },
  {
    symbol: "RELIANCE", name: "Reliance Industries", expiry: "2026-10-27", strike: 1400, spot: 1385, lot_size: 250,
    ce: { bid: 28.5, ask: 28.9, bid_qty: 6000, ask_qty: 5400, ltp: 28.7, volume: 320000, oi: 4500000 },
    pe: { bid: 36.1, ask: 36.8, bid_qty: 5100, ask_qty: 5500, ltp: 36.4, volume: 280000, oi: 3900000 },
  },
];

const state = {
  expiry: "nearest",
  rows: [],
  expiries: [],
  nearest: null,
  next: null,
};

function spreadPct(bid, ask) {
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : Math.max(bid, ask, 0);
  if (mid <= 0 || ask <= 0 || bid <= 0) return 1;
  return Math.max(ask - bid, 0) / mid;
}

function daysToExpiry(expiry) {
  const exp = new Date(`${expiry}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((exp - today) / 86400000);
}

function execQty(strategy, lot, ce, pe) {
  return strategy === "A"
    ? Math.min(lot, ce.bid_qty || 0, pe.ask_qty || 0)
    : Math.min(lot, ce.ask_qty || 0, pe.bid_qty || 0);
}

function fullLot(strategy, lot, ce, pe) {
  return strategy === "A"
    ? ce.bid_qty >= lot && pe.ask_qty >= lot
    : ce.ask_qty >= lot && pe.bid_qty >= lot;
}

function liquidityScore(strategy, lot, ce, pe) {
  const qty = execQty(strategy, lot, ce, pe);
  const worst = Math.max(spreadPct(ce.bid, ce.ask), spreadPct(pe.bid, pe.ask));
  const veryLowQty = qty < lot * PARTIAL_LOW_FRACTION;
  const veryLowDepth = ce.volume < LOW_VOLUME || pe.volume < LOW_VOLUME || ce.oi < LOW_OI || pe.oi < LOW_OI;
  if (veryLowQty || worst >= VERY_WIDE_SPREAD || veryLowDepth) return "LOW";
  const goodVol = ce.volume >= GOOD_VOLUME && pe.volume >= GOOD_VOLUME;
  const goodOi = ce.oi >= GOOD_OI && pe.oi >= GOOD_OI;
  if (!fullLot(strategy, lot, ce, pe)) return "MEDIUM";
  if (worst >= WIDE_SPREAD || !goodVol || !goodOi) return "MEDIUM";
  if (worst <= NARROW_SPREAD && goodVol && goodOi) return "HIGH";
  return "MEDIUM";
}

function equityLeg(turnover, buy) {
  const brokerage = 0;
  const stt = turnover * 0.001;
  const exchange = turnover * 0.0000297;
  const sebi = turnover * 0.000001;
  const stamp = buy ? turnover * 0.00015 : 0;
  const other = turnover * 0.000001;
  const gst = 0.18 * (brokerage + exchange + sebi);
  return { brokerage, stt, exchange, gst, stamp, sebi, other };
}

function optionLeg(turnover, buy) {
  const brokerage = Math.min(20, turnover * 0.0003);
  const stt = buy ? 0 : turnover * 0.001;
  const exchange = turnover * 0.0003503;
  const sebi = turnover * 0.000001;
  const stamp = buy ? turnover * 0.00003 : 0;
  const other = turnover * 0.000005;
  const gst = 0.18 * (brokerage + exchange + sebi);
  return { brokerage, stt, exchange, gst, stamp, sebi, other };
}

function estimateCharges(strategy, spot, cePx, pePx, qty) {
  const empty = { brokerage: 0, stt: 0, exchange: 0, gst: 0, stamp: 0, sebi: 0, other: 0, total: 0 };
  if (qty <= 0) return empty;
  const legs = [
    equityLeg(spot * qty, strategy === "A"),
    optionLeg(cePx * qty, strategy === "B"),
    optionLeg(pePx * qty, strategy === "A"),
  ];
  const out = { ...empty };
  for (const leg of legs) {
    for (const key of Object.keys(leg)) out[key] += leg[key];
  }
  out.total = out.brokerage + out.stt + out.exchange + out.gst + out.stamp + out.sebi + out.other;
  for (const key of Object.keys(out)) out[key] = round2(out[key]);
  return out;
}

function buildOpportunity(quote, strategy) {
  const { spot, strike, lot_size: lot, ce, pe } = quote;
  const cePx = strategy === "A" ? ce.bid : ce.ask;
  const pePx = strategy === "A" ? pe.ask : pe.bid;
  if (cePx <= 0 || pePx <= 0) return null;

  const pps = strategy === "A" ? strike - spot + ce.bid - pe.ask : spot - strike - ce.ask + pe.bid;
  const cps = strategy === "A" ? spot - ce.bid + pe.ask : strike + ce.ask - pe.bid;
  if (cps <= 0) return null;

  const qty = execQty(strategy, lot, ce, pe);
  const isFull = fullLot(strategy, lot, ce, pe);
  const liq = liquidityScore(strategy, lot, ce, pe);
  const grossReturn = (pps / cps) * 100;
  const capital = cps * qty;
  const grossProfit = pps * qty;
  const charges = estimateCharges(strategy, spot, cePx, pePx, qty);
  const netProfit = grossProfit - charges.total;
  const netReturn = capital ? (netProfit / capital) * 100 : 0;
  const dte = daysToExpiry(quote.expiry);

  return {
    id: `${quote.symbol}-${quote.expiry}-${strike}-${strategy}`,
    symbol: quote.symbol,
    name: quote.name,
    expiry: quote.expiry,
    strike,
    spot,
    lot_size: lot,
    strategy,
    strategy_label: strategy === "A" ? "Buy Stock + Sell CE + Buy PE" : "Sell Stock + Buy CE + Sell PE",
    ce, pe, ce_px: cePx, pe_px: pePx,
    profit_per_share: pps,
    capital_per_share: cps,
    gross_return: grossReturn,
    net_return: netReturn,
    capital,
    gross_profit: grossProfit,
    lot_profit: pps * lot,
    net_profit: netProfit,
    charges,
    executable_qty: qty,
    full_lot: isFull,
    partial: qty > 0 && !isFull,
    liquidity: liq,
    days_to_expiry: dte,
    effective_cost: strategy === "A" ? cps : spot - ce.ask + pe.bid,
    guaranteed_value: strike,
    alert: netReturn >= ALERT_NET_RETURN && isFull && dte >= ALERT_MIN_EXPIRY_DAYS,
  };
}

function scanDummy() {
  const strategies = [];
  if (document.getElementById("strat-a").checked) strategies.push("A");
  if (document.getElementById("strat-b").checked) strategies.push("B");
  const minReturn = Number(document.getElementById("min-return").value) || 0;
  const rows = [];
  for (const quote of DUMMY_QUOTES) {
    for (const strategy of strategies) {
      const row = buildOpportunity(quote, strategy);
      if (row && row.gross_return >= minReturn) rows.push(row);
    }
  }
  rows.sort((a, b) => {
    const liq = LIQUIDITY_RANK[a.liquidity] - LIQUIDITY_RANK[b.liquidity];
    return liq !== 0 ? liq : b.net_return - a.net_return;
  });
  rows.forEach((row, i) => { row.rank = i + 1; });
  const expiries = [...new Set(DUMMY_QUOTES.map((q) => q.expiry))].sort();
  return {
    last_update: new Date().toLocaleTimeString("en-IN", { hour12: false }),
    stocks_scanned: 185,
    expiries,
    nearest_expiry: expiries[0] || null,
    next_expiry: expiries[1] || null,
    opportunities: rows,
  };
}

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
  return `${n.toFixed(2)}%`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
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
  return rows.filter((row) => {
    if (LIQUIDITY_RANK[row.liquidity] > floor) return false;
    if (state.expiry === "nearest") return row.expiry === state.nearest;
    if (state.expiry === "next") return row.expiry === state.next;
    return true;
  }).map((row, i) => ({ ...row, rank: i + 1 }));
}

function render(snapshot) {
  state.rows = snapshot.opportunities;
  state.expiries = snapshot.expiries;
  state.nearest = snapshot.nearest_expiry;
  state.next = snapshot.next_expiry;

  const shown = visibleRows(state.rows);
  document.getElementById("last-update").textContent = snapshot.last_update;
  document.getElementById("stocks-scanned").textContent = snapshot.stocks_scanned;
  document.getElementById("opp-count").textContent = shown.length;

  const alerts = shown.filter((row) => row.alert);
  const bar = document.getElementById("alert-bar");
  if (alerts.length) {
    bar.classList.remove("hidden");
    bar.textContent = alerts
      .map((row) => `${row.symbol} — ${pct(row.net_return)} parity opportunity`)
      .join("   ·   ");
  } else {
    bar.classList.add("hidden");
  }

  const body = document.getElementById("results-body");
  const empty = document.getElementById("empty-state");
  body.innerHTML = "";
  if (!shown.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  for (const row of shown) {
    const tr = document.createElement("tr");
    tr.dataset.id = row.id;
    tr.setAttribute("role", "button");
    tr.tabIndex = 0;
    tr.setAttribute("aria-label", `${row.symbol} ${row.strike} ${row.gross_return.toFixed(2)} percent`);
    const ceSide = row.strategy === "A" ? "bid" : "ask";
    const peSide = row.strategy === "A" ? "ask" : "bid";
    tr.innerHTML = `
      <td class="rank rank-${row.liquidity}">${row.rank}</td>
      <td>
        <div class="stock-cell">
          <strong>${row.symbol}</strong>
          <span class="stock-meta">${row.strategy === "A" ? "Buy stock / sell CE / buy PE" : "Sell stock / buy CE / sell PE"}</span>
          ${row.partial ? `<span class="warn">Partial liquidity · ${inr(row.executable_qty, 0)} / ${inr(row.lot_size, 0)}</span>` : ""}
        </div>
      </td>
      <td>${fmtExpiry(row.expiry)}</td>
      <td class="num">${inr(row.strike, 0)}</td>
      <td class="num">${inr(row.spot)}</td>
      <td class="num">${inr(row.ce_px)}<span class="px-note">${ceSide}</span></td>
      <td class="num">${inr(row.pe_px)}<span class="px-note">${peSide}</span></td>
      <td class="num">${money(row.profit_per_share)}</td>
      <td class="num ${row.gross_return >= 1 ? "ret-strong" : ""}">${pct(row.gross_return)}</td>
      <td class="num">${pct(row.net_return)}</td>
      <td class="num">${capitalFmt(row.capital)}</td>
      <td class="num">${money(row.lot_profit)}</td>
      <td class="liq liq-${row.liquidity}">${row.liquidity}</td>
    `;
    const open = () => openDrawer(row);
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
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
  const c = row.charges;
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
      ${kv("Estimated charges", money(c.total))}
      ${kv("  Brokerage", money(c.brokerage))}
      ${kv("  STT", money(c.stt))}
      ${kv("  Exchange", money(c.exchange))}
      ${kv("  GST", money(c.gst))}
      ${kv("  Stamp duty", money(c.stamp))}
      ${kv("  SEBI + other", money(c.sebi + c.other))}
      ${kv("Estimated net profit", money(row.net_profit), "net")}
      ${kv("Net return", pct(row.net_return), "net")}
    </div>
    <hr class="rule" />
    <div class="kv">
      ${kv("CE bid / qty", `${inr(row.ce.bid)} · ${inr(row.ce.bid_qty, 0)}`)}
      ${kv("CE ask / qty", `${inr(row.ce.ask)} · ${inr(row.ce.ask_qty, 0)}`)}
      ${kv("CE LTP (info only)", inr(row.ce.ltp))}
      ${kv("PE bid / qty", `${inr(row.pe.bid)} · ${inr(row.pe.bid_qty, 0)}`)}
      ${kv("PE ask / qty", `${inr(row.pe.ask)} · ${inr(row.pe.ask_qty, 0)}`)}
      ${kv("PE LTP (info only)", inr(row.pe.ltp))}
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

function runScan() {
  const btn = document.getElementById("scan-btn");
  btn.disabled = true;
  btn.textContent = "Scanning…";
  window.setTimeout(() => {
    render(scanDummy());
    btn.disabled = false;
    btn.textContent = "Scan now";
  }, 450);
}

document.querySelectorAll("[data-expiry]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-expiry]").forEach((el) => el.classList.remove("active"));
    btn.classList.add("active");
    state.expiry = btn.dataset.expiry;
    render(scanDummy());
  });
});

["min-return", "min-liquidity", "strat-a", "strat-b"].forEach((id) => {
  document.getElementById(id).addEventListener("change", () => render(scanDummy()));
});

document.getElementById("scan-btn").addEventListener("click", runScan);
document.getElementById("drawer-close").addEventListener("click", closeDrawer);
document.getElementById("backdrop").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDrawer();
});

render(scanDummy());
