const CAR_RATES_KEY = "call_arb_rates_v1";

const carState = {
  pairs: [],
  books: {},
  stocks: [],
  ticker: null,
  started: false,
  source: "",
  margins: {},
  rows: [],
  selected: null,
};

function carEl(id) {
  return document.getElementById(id);
}

function carNum(id, fallback) {
  const value = Number(carEl(id) && carEl(id).value);
  return Number.isFinite(value) ? value : fallback;
}

function carChecked(id) {
  return Boolean(carEl(id) && carEl(id).checked);
}

function readStoredRates() {
  try {
    return CallArbCharges.mergeRates(JSON.parse(localStorage.getItem(CAR_RATES_KEY) || "{}"));
  } catch (_err) {
    return CallArbCharges.mergeRates();
  }
}

function readFormRates() {
  const stored = readStoredRates();
  return CallArbCharges.mergeRates({
    ...stored,
    fut: {
      brokeragePct: carNum("car-fut-brok-pct", stored.fut.brokeragePct),
      brokerageCap: carNum("car-fut-brok-cap", stored.fut.brokerageCap),
      sttSellPct: carNum("car-fut-stt", stored.fut.sttSellPct),
      txnPct: carNum("car-fut-txn", stored.fut.txnPct),
      stampBuyPct: carNum("car-fut-stamp", stored.fut.stampBuyPct),
    },
    opt: {
      brokerage: carNum("car-opt-brok", stored.opt.brokerage),
      sttSellPct: carNum("car-opt-stt", stored.opt.sttSellPct),
      sttExercisePct: carNum("car-opt-ex-stt", stored.opt.sttExercisePct),
      txnPct: carNum("car-opt-txn", stored.opt.txnPct),
      stampBuyPct: carNum("car-opt-stamp", stored.opt.stampBuyPct),
    },
    gstPct: carNum("car-gst", stored.gstPct),
    sebiPerCrore: carNum("car-sebi", stored.sebiPerCrore),
    includeExerciseStt: carChecked("car-include-ex"),
    slippageInr: carNum("car-slip", stored.slippageInr),
    slipSpreadFrac: carNum("car-slip-spread", stored.slipSpreadFrac),
    staleMs: carNum("car-stale", stored.staleMs),
    snapMs: carNum("car-snap", stored.snapMs),
    maxOptSpreadPct: carNum("car-opt-spread", stored.maxOptSpreadPct),
    maxFutSpreadPct: carNum("car-fut-spread", stored.maxFutSpreadPct),
    discountFactor: carNum("car-df", stored.discountFactor),
    lots: Math.max(1, Math.round(carNum("car-lots", stored.lots) || 1)),
  });
}

function persistRates() {
  localStorage.setItem(CAR_RATES_KEY, JSON.stringify(readFormRates()));
}

function fillRateForm(rates) {
  const r = CallArbCharges.mergeRates(rates);
  const set = (id, value) => {
    if (carEl(id)) carEl(id).value = value;
  };
  set("car-fut-brok-pct", r.fut.brokeragePct);
  set("car-fut-brok-cap", r.fut.brokerageCap);
  set("car-fut-stt", r.fut.sttSellPct);
  set("car-fut-txn", r.fut.txnPct);
  set("car-fut-stamp", r.fut.stampBuyPct);
  set("car-opt-brok", r.opt.brokerage);
  set("car-opt-stt", r.opt.sttSellPct);
  set("car-opt-ex-stt", r.opt.sttExercisePct);
  set("car-opt-txn", r.opt.txnPct);
  set("car-opt-stamp", r.opt.stampBuyPct);
  set("car-gst", r.gstPct);
  set("car-sebi", r.sebiPerCrore);
  set("car-slip", r.slippageInr);
  set("car-slip-spread", r.slipSpreadFrac);
  set("car-stale", r.staleMs);
  set("car-snap", r.snapMs);
  set("car-opt-spread", r.maxOptSpreadPct);
  set("car-fut-spread", r.maxFutSpreadPct);
  set("car-df", r.discountFactor);
  set("car-lots", r.lots);
  if (carEl("car-include-ex")) carEl("car-include-ex").checked = Boolean(r.includeExerciseStt);
}

function carBook(token) {
  return carState.books[String(token)] || {
    ltp: 0, bid: 0, ask: 0, bid_qty: 0, ask_qty: 0, bid_depth: 0, ask_depth: 0, ts: 0,
  };
}

function carLookup(books, ...keys) {
  for (const key of keys) {
    if (key && books[key]) return books[key];
    if (key && books[String(key)]) return books[String(key)];
  }
  return null;
}

function applyIncomingBooks(books, pairs, ts) {
  if (!books) return;
  for (const pair of pairs) {
    for (const [token, key] of [
      [pair.ce_token, pair.ce_key],
      [pair.pe_token, pair.pe_key],
      [pair.fut_token, pair.fut_key],
    ]) {
      const q = carLookup(books, key, token);
      if (!q) continue;
      const prev = carBook(token);
      const ltp = Number(q.last_price || q.ltp || 0);
      carState.books[String(token)] = {
        ltp: ltp > 0 ? ltp : prev.ltp,
        bid: Number(q.bid || 0) || prev.bid,
        ask: Number(q.ask || 0) || prev.ask,
        bid_qty: Number(q.bid_qty || 0) || prev.bid_qty,
        ask_qty: Number(q.ask_qty || 0) || prev.ask_qty,
        bid_depth: Number(q.bid_depth || q.bid_qty || 0) || prev.bid_depth,
        ask_depth: Number(q.ask_depth || q.ask_qty || 0) || prev.ask_depth,
        ts: ltp > 0 || Number(q.bid || 0) || Number(q.ask || 0) ? ts : prev.ts,
      };
    }
  }
}

function execPx(book, side, session) {
  if (session.live) {
    const live = Number(book[side] || 0);
    if (live > 0) {
      return {
        price: live,
        qty: Number(book[`${side}_qty`] || 0),
        depth: Number(book[`${side}_depth`] || book[`${side}_qty`] || 0),
        usedLtp: false,
        missing: false,
      };
    }
    return { price: 0, qty: 0, depth: 0, usedLtp: false, missing: true };
  }
  const ltp = Number(book.ltp || 0);
  if (ltp > 0) return { price: ltp, qty: 0, depth: 0, usedLtp: true, missing: false };
  return { price: 0, qty: 0, depth: 0, usedLtp: true, missing: true };
}

function paintCallArbMode(session, method) {
  const box = carEl("car-mode");
  const label = carEl("car-mode-label");
  const reason = carEl("car-mode-reason");
  if (!box) return;
  box.className = `synth-mode ${session.live ? "synth-mode-live" : "synth-mode-ltp"}`;
  if (label) label.textContent = session.live ? "🟢 LIVE / EXECUTABLE" : "🟡 LTP / THEORETICAL";
  if (reason) reason.textContent = `${session.reason} · ${method.label}. Confirmed arbitrage is never labelled from LTP.`;
  const methodEl = carEl("car-method");
  if (methodEl) methodEl.textContent = `${method.label} · (B) buy · (S) sell`;
}

function snapshotOk(ce, pe, fut, rates, session) {
  if (!session.live) return { ok: true, reason: "" };
  const times = [Number(ce.ts || 0), Number(pe.ts || 0), Number(fut.ts || 0)];
  if (times.some((ts) => !ts)) return { ok: false, reason: "missing quote timestamp" };
  const age = Date.now() - Math.min(...times);
  const span = Math.max(...times) - Math.min(...times);
  if (age > rates.staleMs) return { ok: false, reason: "stale quotes" };
  if (span > rates.snapMs) return { ok: false, reason: "legs not from the same snapshot" };
  return { ok: true, reason: "" };
}

function spreadPct(bid, ask) {
  if (!(bid > 0) || !(ask > 0)) return 0;
  return ((ask - bid) / ((ask + bid) / 2)) * 100;
}

function crossedBook(book) {
  return book.bid > 0 && book.ask > 0 && book.bid > book.ask;
}

function classifyRow(row) {
  if (row.incomplete) return { status: "POTENTIAL", label: "🟡 POTENTIAL", reason: row.reasons[0] || "incomplete quotes" };
  if (!(row.net > 0)) return { status: "NO", label: "🔴 NO ARBITRAGE", reason: "net profit ≤ 0 after costs and slippage" };
  if (!row.live) return { status: "POTENTIAL", label: "🟡 POTENTIAL", reason: "LTP / theoretical only — not executable" };
  if (!row.executable) return { status: "POTENTIAL", label: "🟡 POTENTIAL", reason: row.reasons[0] || "not executable" };
  if (row.reasons.length) return { status: "POTENTIAL", label: "🟡 POTENTIAL", reason: row.reasons[0] };
  return { status: "CONFIRMED", label: "🟢 CONFIRMED ARBITRAGE", reason: "executable after costs, slippage and liquidity" };
}

function evaluateSide(pair, side, session, rates) {
  const ce = carBook(pair.ce_token);
  const pe = carBook(pair.pe_token);
  const fut = carBook(pair.fut_token);
  const lot = pair.lot_size || 1;
  const lots = rates.lots;
  const qty = lot * lots;
  const buyCall = side === "A";
  const call = execPx(ce, buyCall ? "ask" : "bid", session);
  const put = execPx(pe, buyCall ? "bid" : "ask", session);
  const future = execPx(fut, buyCall ? "bid" : "ask", session);
  const reasons = [];
  const incomplete = call.missing || put.missing || future.missing;
  if (call.missing) reasons.push("missing Call quote");
  if (put.missing) reasons.push("missing Put quote");
  if (future.missing) reasons.push("missing Future quote");
  if (crossedBook(ce) || crossedBook(pe) || crossedBook(fut)) reasons.push("crossed/invalid book");

  const snap = snapshotOk(ce, pe, fut, rates, session);
  if (session.live && !snap.ok) reasons.push(snap.reason);

  const callAvail = call.depth || call.qty;
  const putAvail = buyCall ? (put.depth || put.qty) : (put.depth || put.qty);
  const futAvail = buyCall ? (future.depth || future.qty) : (future.depth || future.qty);
  const topOk = session.live && call.qty >= qty && put.qty >= qty && future.qty >= qty;
  const depthOk = session.live && callAvail >= qty && putAvail >= qty && futAvail >= qty;
  if (session.live && !incomplete && !topOk) {
    reasons.push(depthOk
      ? `top-of-book qty below ${qty} (depth may walk)`
      : `available qty below ${qty}`);
  }

  const callSpread = spreadPct(ce.bid, ce.ask);
  const putSpread = spreadPct(pe.bid, pe.ask);
  const futSpread = spreadPct(fut.bid, fut.ask);
  if (session.live && callSpread > rates.maxOptSpreadPct) reasons.push("Call spread too wide");
  if (session.live && putSpread > rates.maxOptSpreadPct) reasons.push("Put spread too wide");
  if (session.live && futSpread > rates.maxFutSpreadPct) reasons.push("Future spread too wide");

  const df = rates.discountFactor;
  const synth = incomplete ? 0 : CallArbCharges.syntheticCall(future.price, put.price, pair.strike, df);
  const gross = incomplete ? 0 : (buyCall ? synth - call.price : call.price - synth);
  const charges = incomplete
    ? { total: 0, legs: [] }
    : CallArbCharges.threeLegCharges({
      strategy: side,
      callPx: call.price,
      putPx: put.price,
      futPx: future.price,
      strike: pair.strike,
      qty,
      rates,
    });
  const slipShare = CallArbCharges.slippagePerShare({
    callBid: ce.bid || call.price,
    callAsk: ce.ask || call.price,
    putBid: pe.bid || put.price,
    putAsk: pe.ask || put.price,
    futBid: fut.bid || future.price,
    futAsk: fut.ask || future.price,
    rates,
  });
  const costShare = qty ? charges.total / qty : 0;
  const netShare = incomplete ? 0 : gross - costShare - slipShare;
  const netLot = netShare * lot;
  const net = netShare * qty;
  const marginKey = `${pair.symbol}|${pair.expiry}|${pair.strike}|${side}|${qty}`;
  const liveMargin = carState.margins[marginKey];
  const margin = liveMargin && liveMargin.required > 0
    ? liveMargin
    : CallArbCharges.estimateMargins({
      strategy: side,
      callPx: call.price,
      putPx: put.price,
      futPx: future.price,
      strike: pair.strike,
      lot,
      lots,
    });
  if (!liveMargin || liveMargin.uncertain || !(margin.required > 0)) {
    if (gross > 0) reasons.push(margin.source === "kite-basket" ? "margin incomplete" : "margin estimated / uncertain");
  }
  const rom = margin.required > 0 && net > 0 ? (net / margin.required) * 100 : (net > 0 ? 0 : 0);

  const executable = session.live && !incomplete && topOk && snap.ok && !crossedBook(ce) && !crossedBook(pe) && !crossedBook(fut);
  const row = {
    id: marginKey,
    pair,
    symbol: pair.symbol,
    expiry: pair.expiry,
    strike: pair.strike,
    lot,
    lots,
    qty,
    side,
    sideLabel: buyCall ? "BUY CE / SELL PE / SELL FUT" : "SELL CE / BUY PE / BUY FUT",
    ce_symbol: pair.ce_symbol,
    pe_symbol: pair.pe_symbol,
    fut_symbol: pair.fut_symbol,
    call: call.price,
    put: put.price,
    future: future.price,
    synth,
    gross,
    charges,
    costShare,
    slipShare,
    slipLot: slipShare * lot,
    netShare,
    netLot,
    net,
    margin,
    rom,
    live: session.live,
    usedLtp: call.usedLtp || put.usedLtp || future.usedLtp,
    incomplete,
    executable,
    reasons: [...new Set(reasons)],
    ts: {
      call: ce.ts,
      put: pe.ts,
      future: fut.ts,
    },
    callQty: call.qty,
    putQty: put.qty,
    futQty: future.qty,
    method: CallArbCharges.methodology(df),
  };
  const cls = classifyRow(row);
  row.status = cls.status;
  row.statusLabel = cls.label;
  row.statusReason = cls.reason;
  return row;
}

function evaluateCallArb() {
  const session = nseSession();
  const rates = readFormRates();
  const method = CallArbCharges.methodology(rates.discountFactor);
  paintCallArbMode(session, method);
  const rows = [];
  for (const pair of carState.pairs) {
    rows.push(evaluateSide(pair, "A", session, rates));
    rows.push(evaluateSide(pair, "B", session, rates));
  }
  const rank = { CONFIRMED: 0, POTENTIAL: 1, NO: 2 };
  rows.sort((a, b) => {
    const rs = rank[a.status] - rank[b.status];
    if (rs) return rs;
    return (b.rom - a.rom) || (b.net - a.net) || a.symbol.localeCompare(b.symbol);
  });
  carState.rows = rows;
  return rows;
}

function visibleCallArb(rows) {
  const minNet = carNum("car-min-net", 0);
  const minRom = carNum("car-min-rom", 0);
  const minEdge = carNum("car-min-edge", 0);
  const showNo = carChecked("car-show-no");
  const showA = !carEl("car-side-a") || carChecked("car-side-a");
  const showB = !carEl("car-side-b") || carChecked("car-side-b");
  const q = String((carEl("car-filter") && carEl("car-filter").value) || "").trim().toUpperCase();
  return rows.filter((row) => {
    if (row.side === "A" && !showA) return false;
    if (row.side === "B" && !showB) return false;
    if (q && !row.symbol.includes(q) && !String(row.strike).includes(q)) return false;
    if (row.incomplete) return showNo;
    if (row.status === "NO") return showNo && row.gross !== 0;
    if (row.netLot + 1e-9 < minNet) return false;
    if (row.rom + 1e-9 < minRom) return false;
    if (row.gross + 1e-9 < minEdge) return false;
    return true;
  });
}

function setCallArbStatus(text) {
  const el = carEl("car-status");
  if (el) el.textContent = `${text}${carState.source ? ` · ${carState.source}` : ""}`;
}

function sideMark(buy) {
  return `<span class="side-mark ${buy ? "side-buy" : "side-sell"}">${buy ? "(B)" : "(S)"}</span>`;
}

function moneySide(price, buy, incomplete) {
  if (incomplete || !(Number(price) > 0)) return "—";
  return `${money(price)} ${sideMark(buy)}`;
}

function renderCallArbRows(rows) {
  const body = carEl("car-body");
  const empty = carEl("car-empty");
  if (!body) return;
  body.innerHTML = "";
  const visible = visibleCallArb(rows);
  const confirmed = rows.filter((row) => row.status === "CONFIRMED").length;
  if (carEl("opp-count") && state.tab === "callarb") {
    carEl("opp-count").textContent = `${confirmed} confirmed / ${visible.length} shown`;
    carEl("stocks-scanned").textContent = String(new Set(carState.pairs.map((row) => row.symbol)).size);
  }
  if (!visible.length) {
    empty.classList.remove("hidden");
    empty.textContent = carState.pairs.length
      ? (nseSession().live
        ? "No executable same-expiry Call vs synthetic Call after costs, slippage and filters."
        : "No theoretical LTP edge after costs. Weekend/holiday rows are never CONFIRMED ARBITRAGE.")
      : "Connect Zerodha, then start the stock Call-arbitrage scanner.";
    return;
  }
  empty.classList.add("hidden");
  for (const row of visible) {
    const tr = document.createElement("tr");
    tr.className = row.status === "CONFIRMED" ? "hit" : row.status === "POTENTIAL" ? "theo" : "miss";
    tr.dataset.id = row.id;
    tr.title = row.statusReason;
    tr.innerHTML = `
      <td>
        <div class="stock-cell">
          <strong>${row.symbol}</strong>
          <span class="stock-meta">${row.side === "A" ? "A · buy CE" : "B · sell CE"}</span>
        </div>
      </td>
      <td>${fmtExpiryLong(row.expiry)}</td>
      <td class="num">${inr(row.strike, 0)}</td>
      <td class="num">${moneySide(row.call, row.side === "A", row.incomplete)}</td>
      <td class="num">${moneySide(row.put, row.side === "B", row.incomplete)}</td>
      <td class="num">${moneySide(row.future, row.side === "B", row.incomplete)}</td>
      <td class="num">${row.incomplete ? "—" : money(row.synth)}</td>
      <td class="num">${row.incomplete ? "—" : `${row.gross > 0 ? "+" : ""}${inr(row.gross)}`}</td>
      <td class="num">${row.incomplete ? "—" : money(row.charges.total)}</td>
      <td class="num">${row.incomplete ? "—" : money(row.slipLot)}</td>
      <td class="num ${row.netLot > 0 ? "signal-yes" : "signal-no"}">${row.incomplete ? "—" : money(row.netLot)}</td>
      <td class="num">${row.incomplete ? "—" : `${money(row.margin.required)}${row.margin.uncertain ? "*" : ""}`}</td>
      <td class="num">${row.incomplete || !(row.rom > 0) ? "—" : pct(row.rom)}</td>
      <td class="${row.status === "CONFIRMED" ? "signal-yes" : row.status === "NO" ? "signal-no-red" : "signal-no"}">${row.statusLabel}</td>
    `;
    tr.addEventListener("click", () => openCallArbDrawer(row));
    body.appendChild(tr);
  }
}

function chargeLines(leg) {
  if (!leg) return "";
  return `${money(leg.total)} · brk ${money(leg.brokerage)} · STT ${money(leg.stt)} · txn ${money(leg.txn)} · GST ${money(leg.gst)} · SEBI ${money(leg.sebi)} · stamp ${money(leg.stamp)}`;
}

function openCallArbDrawer(row, opts = {}) {
  carState.selected = row.id;
  const drawer = carEl("drawer");
  drawer.classList.add("wide");
  carEl("d-symbol").textContent = `${row.symbol} ${inr(row.strike, 0)} · ${row.statusLabel}`;
  carEl("d-name").textContent = row.sideLabel;
  const a = row.side === "A";
  const legs = row.charges.legs || [];
  const ts = (ms) => ms ? new Date(ms).toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" }) : "—";
  carEl("drawer-body").innerHTML = `
    <p class="badge ${row.status === "CONFIRMED" ? "net" : ""}">${row.statusLabel}</p>
    <p class="index-meta">${row.statusReason}</p>
    <div class="kv">
      ${kv("Stock", row.symbol)}
      ${kv("Expiry", fmtExpiryLong(row.expiry))}
      ${kv("Strike", money(row.strike))}
      ${kv("Lot × lots", `${row.lot} × ${row.lots} = ${row.qty}`)}
      ${kv("Methodology", row.method.label)}
      ${kv("Mode", row.live ? "LIVE / EXECUTABLE" : "LTP / THEORETICAL")}
    </div>
    <hr class="rule" />
    <div class="legs">
      <div class="leg"><em>${a ? "BUY" : "SELL"} ${row.ce_symbol}</em><span>${row.qty} @ ${row.call ? money(row.call) : "—"}</span></div>
      <div class="leg"><em>${a ? "SELL" : "BUY"} ${row.pe_symbol}</em><span>${row.qty} @ ${row.put ? money(row.put) : "—"}</span></div>
      <div class="leg"><em>${a ? "SELL" : "BUY"} ${row.fut_symbol}</em><span>${row.qty} @ ${row.future ? money(row.future) : "—"}</span></div>
    </div>
    <hr class="rule" />
    <div class="kv">
      ${kv("Synthetic Call", row.synth ? money(row.synth) : "—")}
      ${kv("Gross edge / sh", row.incomplete ? "—" : money(row.gross))}
      ${kv("Gross / lot", row.incomplete ? "—" : money(row.gross * row.lot))}
      ${kv("Call charges", chargeLines(legs[0]))}
      ${kv("Put charges", chargeLines(legs[1]))}
      ${kv("Future charges", chargeLines(legs[2]))}
      ${kv("Total charges", money(row.charges.total || 0))}
      ${kv("Slippage / lot", money(row.slipLot))}
      ${kv("Net / lot", money(row.netLot), row.netLot > 0 ? "net" : "")}
      ${kv("Net (all lots)", money(row.net), row.net > 0 ? "net" : "")}
      ${kv("Standalone Future margin", money(row.margin.standaloneFuture || 0))}
      ${kv("Standalone short Put margin", money(row.margin.standaloneShortPut || 0))}
      ${kv("Combined strategy margin", money(row.margin.combined || row.margin.required || 0))}
      ${kv("Margin benefit", money(row.margin.benefit || 0))}
      ${kv("Final required margin", money(row.margin.required || 0))}
      ${kv("Return on margin", row.rom ? pct(row.rom) : "—")}
      ${kv("Margin source", row.margin.uncertain ? `${row.margin.source} (uncertain → not confirmed)` : row.margin.source)}
      ${kv("Call quote ts", ts(row.ts.call))}
      ${kv("Put quote ts", ts(row.ts.put))}
      ${kv("Future quote ts", ts(row.ts.future))}
    </div>
    <p class="footnote">Identification only. No order is sent.</p>
  `;
  drawer.hidden = false;
  carEl("backdrop").hidden = false;
  if (opts.fetchMargin !== false) requestMargin(row, Boolean(opts.forceMargin));
}

function refreshCallArb() {
  if (typeof state === "undefined" || state.tab !== "callarb") return;
  const rows = evaluateCallArb();
  renderCallArbRows(rows);
  const now = new Date().toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" });
  if (carEl("last-update")) carEl("last-update").textContent = now;
  prefetchMargins(rows);
}

let carPaint = 0;
function applyCallArbTicks(ticks) {
  const now = Date.now();
  for (const tick of ticks) {
    carState.books[String(tick.instrument_token)] = {
      ltp: tick.ltp || 0,
      bid: tick.bid || 0,
      ask: tick.ask || 0,
      bid_qty: tick.bid_qty || 0,
      ask_qty: tick.ask_qty || 0,
      bid_depth: tick.bid_depth || tick.bid_qty || 0,
      ask_depth: tick.ask_depth || tick.ask_qty || 0,
      ts: now,
    };
  }
  if (!carPaint) {
    carPaint = window.requestAnimationFrame(() => {
      carPaint = 0;
      refreshCallArb();
    });
  }
}

function fillStockSelect(stocks) {
  const sel = carEl("car-stock");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">All F&O stocks</option>` + stocks
    .map((row) => `<option value="${row.symbol}">${row.symbol}</option>`)
    .join("");
  if ([...sel.options].some((opt) => opt.value === current)) sel.value = current;
}

async function seedMissingOptionBooks(pairs) {
  const keys = [...new Set(pairs.flatMap((row) => [row.ce_key, row.pe_key, row.fut_key]))];
  const need = keys.filter((key) => {
    const pair = pairs.find((row) => row.ce_key === key || row.pe_key === key || row.fut_key === key);
    if (!pair) return false;
    const token = key === pair.ce_key ? pair.ce_token : key === pair.pe_key ? pair.pe_token : pair.fut_token;
    const book = carBook(token);
    return !(book.ltp > 0 || book.bid > 0 || book.ask > 0);
  });
  for (let i = 0; i < need.length; i += 40) {
    const chunk = need.slice(i, i + 40);
    setCallArbStatus(`Seeding option quotes… ${Math.min(i + chunk.length, need.length)}/${need.length}`);
    const data = await fetchJson(`/api/quotes?hist=false&keys=${encodeURIComponent(chunk.join(","))}`);
    applyIncomingBooks(data.books || {}, pairs, Date.now());
    refreshCallArb();
  }
}

const carMarginInflight = new Set();

async function requestMargin(row, force) {
  if (row.incomplete || !(row.qty > 0)) return;
  const key = row.id;
  const prev = carState.margins[key];
  if (!force && prev && Date.now() - prev.at < 60000) return;
  if (carMarginInflight.has(key)) return;
  carMarginInflight.add(key);
  try {
    const data = await fetchJson("/api/margins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orders: [
          { tradingsymbol: row.ce_symbol, transaction_type: row.side === "A" ? "BUY" : "SELL", quantity: row.qty },
          { tradingsymbol: row.pe_symbol, transaction_type: row.side === "A" ? "SELL" : "BUY", quantity: row.qty },
          { tradingsymbol: row.fut_symbol, transaction_type: row.side === "A" ? "SELL" : "BUY", quantity: row.qty },
        ],
      }),
    });
    carState.margins[key] = {
      standaloneFuture: Number(data.standaloneFuture || 0),
      standaloneShortPut: Number(data.standaloneShortPut || 0),
      combined: Number(data.combined || 0),
      benefit: Number(data.benefit || 0),
      required: Number(data.required || 0),
      uncertain: data.uncertain !== false && !(Number(data.required) > 0),
      source: data.source || "kite",
      at: Date.now(),
    };
    refreshCallArb();
    if (carState.selected === key) {
      const latest = carState.rows.find((item) => item.id === key);
      if (latest) openCallArbDrawer(latest, { fetchMargin: false });
    }
  } catch (_err) {
    carState.margins[key] = { ...(prev || {}), at: Date.now(), uncertain: true, source: "unavailable" };
  } finally {
    carMarginInflight.delete(key);
  }
}

let marginQueue = Promise.resolve();
function prefetchMargins(rows) {
  const session = nseSession();
  const candidates = rows.filter((row) => !row.incomplete && row.net > 0).slice(0, session.live ? 8 : 4);
  for (const row of candidates) {
    marginQueue = marginQueue.then(() => requestMargin(row, false)).catch(() => {});
  }
}

async function startCallArbScanner() {
  if (!state.connected) {
    setCallArbStatus("Connect Zerodha first.");
    return;
  }
  if (typeof stopSynthScanner === "function") stopSynthScanner();
  if (typeof stopPutArbScanner === "function") stopPutArbScanner();
  if (typeof stopBoxArbScanner === "function") stopBoxArbScanner();
  if (typeof stopVertCeScanner === "function") stopVertCeScanner();
  if (typeof stopVertPeScanner === "function") stopVertPeScanner();
  persistRates();
  const btn = carEl("car-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Starting…";
  }
  try {
    const expiry = (carEl("car-expiry") && carEl("car-expiry").value) || "nearest";
    const symbol = (carEl("car-stock") && carEl("car-stock").value) || "";
    const band = carNum("car-band", 6);
    const maxStrikes = carNum("car-max-strikes", symbol ? 40 : 5);
    const snapshot = await fetchJson(
      `/api/call-arb?seed=true&expiry=${encodeURIComponent(expiry)}&symbol=${encodeURIComponent(symbol)}&band=${encodeURIComponent(band)}&max_strikes=${encodeURIComponent(maxStrikes)}`,
    );
    carState.pairs = snapshot.pairs || [];
    carState.books = snapshot.books || {};
    carState.stocks = snapshot.stocks || [];
    carState.started = true;
    state.connected = Boolean(snapshot.connected);
    setPill(state.connected);
    fillStockSelect(carState.stocks);
    const bar = carEl("alert-bar");
    if (bar && (snapshot.message || snapshot.error)) {
      bar.classList.remove("hidden");
      bar.textContent = snapshot.message || snapshot.error;
    }
    refreshCallArb();
    setCallArbStatus("Seeding option quotes…");
    await seedMissingOptionBooks(carState.pairs);

    if (carState.ticker) {
      carState.ticker.close();
      carState.ticker = null;
    }
    const creds = await fetchJson("/api/ticker");
    if (creds.ws_url && carState.pairs.length) {
      carState.source = "Kite WebSocket";
      setCallArbStatus("Connecting ticker…");
      carState.ticker = connectKiteTicker({
        wsUrl: creds.ws_url,
        tokens: snapshot.tokens || [],
        onTicks: applyCallArbTicks,
        onStatus: setCallArbStatus,
      });
    } else {
      carState.source = "REST quotes";
      setCallArbStatus(creds.error || "WebSocket unavailable — snapshot quotes only.");
    }
    refreshCallArb();
  } catch (error) {
    setCallArbStatus(error.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Start scanner";
    }
  }
}

function stopCallArbScanner() {
  if (carState.ticker) carState.ticker.close();
  carState.ticker = null;
  carState.started = false;
  setCallArbStatus("Stopped");
}

window.setInterval(() => {
  if (typeof state !== "undefined" && state.tab === "callarb") refreshCallArb();
}, 30000);

window.startCallArbScanner = startCallArbScanner;
window.stopCallArbScanner = stopCallArbScanner;
window.refreshCallArb = refreshCallArb;
window.fillCallArbRates = fillRateForm;
window.persistCallArbRates = persistRates;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => fillRateForm(readStoredRates()));
} else {
  fillRateForm(readStoredRates());
}
