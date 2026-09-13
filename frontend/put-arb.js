const PAR_RATES_KEY = "put_arb_rates_v1";

const parState = {
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

function parEl(id) {
  return document.getElementById(id);
}

function parNum(id, fallback) {
  const value = Number(parEl(id) && parEl(id).value);
  return Number.isFinite(value) ? value : fallback;
}

function parChecked(id) {
  return Boolean(parEl(id) && parEl(id).checked);
}

function readPutStoredRates() {
  try {
    return CallArbCharges.mergeRates(JSON.parse(localStorage.getItem(PAR_RATES_KEY) || "{}"));
  } catch (_err) {
    return CallArbCharges.mergeRates();
  }
}

function readPutFormRates() {
  const stored = readPutStoredRates();
  return CallArbCharges.mergeRates({
    ...stored,
    fut: {
      brokeragePct: parNum("par-fut-brok-pct", stored.fut.brokeragePct),
      brokerageCap: parNum("par-fut-brok-cap", stored.fut.brokerageCap),
      sttSellPct: parNum("par-fut-stt", stored.fut.sttSellPct),
      txnPct: parNum("par-fut-txn", stored.fut.txnPct),
      stampBuyPct: parNum("par-fut-stamp", stored.fut.stampBuyPct),
    },
    opt: {
      brokerage: parNum("par-opt-brok", stored.opt.brokerage),
      sttSellPct: parNum("par-opt-stt", stored.opt.sttSellPct),
      sttExercisePct: parNum("par-opt-ex-stt", stored.opt.sttExercisePct),
      txnPct: parNum("par-opt-txn", stored.opt.txnPct),
      stampBuyPct: parNum("par-opt-stamp", stored.opt.stampBuyPct),
    },
    gstPct: parNum("par-gst", stored.gstPct),
    sebiPerCrore: parNum("par-sebi", stored.sebiPerCrore),
    includeExerciseStt: parChecked("par-include-ex"),
    slippageInr: parNum("par-slip", stored.slippageInr),
    slipSpreadFrac: parNum("par-slip-spread", stored.slipSpreadFrac),
    staleMs: parNum("par-stale", stored.staleMs),
    snapMs: parNum("par-snap", stored.snapMs),
    maxOptSpreadPct: parNum("par-opt-spread", stored.maxOptSpreadPct),
    maxFutSpreadPct: parNum("par-fut-spread", stored.maxFutSpreadPct),
    discountFactor: parNum("par-df", stored.discountFactor),
    lots: Math.max(1, Math.round(parNum("par-lots", stored.lots) || 1)),
  });
}

function persistPutRates() {
  localStorage.setItem(PAR_RATES_KEY, JSON.stringify(readPutFormRates()));
}

function fillPutRateForm(rates) {
  const r = CallArbCharges.mergeRates(rates);
  const set = (id, value) => {
    if (parEl(id)) parEl(id).value = value;
  };
  set("par-fut-brok-pct", r.fut.brokeragePct);
  set("par-fut-brok-cap", r.fut.brokerageCap);
  set("par-fut-stt", r.fut.sttSellPct);
  set("par-fut-txn", r.fut.txnPct);
  set("par-fut-stamp", r.fut.stampBuyPct);
  set("par-opt-brok", r.opt.brokerage);
  set("par-opt-stt", r.opt.sttSellPct);
  set("par-opt-ex-stt", r.opt.sttExercisePct);
  set("par-opt-txn", r.opt.txnPct);
  set("par-opt-stamp", r.opt.stampBuyPct);
  set("par-gst", r.gstPct);
  set("par-sebi", r.sebiPerCrore);
  set("par-slip", r.slippageInr);
  set("par-slip-spread", r.slipSpreadFrac);
  set("par-stale", r.staleMs);
  set("par-snap", r.snapMs);
  set("par-opt-spread", r.maxOptSpreadPct);
  set("par-fut-spread", r.maxFutSpreadPct);
  set("par-df", r.discountFactor);
  set("par-lots", r.lots);
  if (parEl("par-include-ex")) parEl("par-include-ex").checked = Boolean(r.includeExerciseStt);
}

function parBook(token) {
  return parState.books[String(token)] || {
    ltp: 0, bid: 0, ask: 0, bid_qty: 0, ask_qty: 0, bid_depth: 0, ask_depth: 0, ts: 0,
  };
}

function parLookup(books, ...keys) {
  for (const key of keys) {
    if (key && books[key]) return books[key];
    if (key && books[String(key)]) return books[String(key)];
  }
  return null;
}

function applyPutIncomingBooks(books, pairs, ts) {
  if (!books) return;
  for (const pair of pairs) {
    for (const [token, key] of [
      [pair.ce_token, pair.ce_key],
      [pair.pe_token, pair.pe_key],
      [pair.fut_token, pair.fut_key],
    ]) {
      const q = parLookup(books, key, token);
      if (!q) continue;
      const prev = parBook(token);
      const ltp = Number(q.last_price || q.ltp || 0);
      parState.books[String(token)] = {
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

function parExecPx(book, side, session) {
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

function paintPutArbMode(session, method) {
  const box = parEl("par-mode");
  const label = parEl("par-mode-label");
  const reason = parEl("par-mode-reason");
  if (!box) return;
  box.className = `synth-mode ${session.live ? "synth-mode-live" : "synth-mode-ltp"}`;
  if (label) label.textContent = session.live ? "🟢 LIVE / EXECUTABLE" : "🟡 LTP / THEORETICAL";
  if (reason) reason.textContent = `${session.reason} · ${method.label}. Confirmed arbitrage is never labelled from LTP.`;
  const methodEl = parEl("par-method");
  if (methodEl) methodEl.textContent = `${method.label} · (B) buy · (S) sell`;
}

function parSnapshotOk(ce, pe, fut, rates, session) {
  if (!session.live) return { ok: true, reason: "" };
  const times = [Number(ce.ts || 0), Number(pe.ts || 0), Number(fut.ts || 0)];
  if (times.some((ts) => !ts)) return { ok: false, reason: "missing quote timestamp" };
  const age = Date.now() - Math.min(...times);
  const span = Math.max(...times) - Math.min(...times);
  if (age > rates.staleMs) return { ok: false, reason: "stale quotes" };
  if (span > rates.snapMs) return { ok: false, reason: "legs not from the same snapshot" };
  return { ok: true, reason: "" };
}

function parSpreadPct(bid, ask) {
  if (!(bid > 0) || !(ask > 0)) return 0;
  return ((ask - bid) / ((ask + bid) / 2)) * 100;
}

function parCrossedBook(book) {
  return book.bid > 0 && book.ask > 0 && book.bid > book.ask;
}

function classifyPutRow(row) {
  if (row.incomplete) return { status: "POTENTIAL", label: "🟡 POTENTIAL", reason: row.reasons[0] || "incomplete quotes" };
  if (!(row.net > 0)) return { status: "NO", label: "🔴 NO ARBITRAGE", reason: "net profit ≤ 0 after costs and slippage" };
  if (!row.live) return { status: "POTENTIAL", label: "🟡 POTENTIAL", reason: "LTP / theoretical only — not executable" };
  if (!row.executable) return { status: "POTENTIAL", label: "🟡 POTENTIAL", reason: row.reasons[0] || "not executable" };
  if (row.reasons.length) return { status: "POTENTIAL", label: "🟡 POTENTIAL", reason: row.reasons[0] };
  return { status: "CONFIRMED", label: "🟢 CONFIRMED ARBITRAGE", reason: "executable after costs, slippage and liquidity" };
}

function evaluatePutSide(pair, side, session, rates) {
  const ce = parBook(pair.ce_token);
  const pe = parBook(pair.pe_token);
  const fut = parBook(pair.fut_token);
  const lot = pair.lot_size || 1;
  const lots = rates.lots;
  const qty = lot * lots;
  const buyPut = side === "A";
  const put = parExecPx(pe, buyPut ? "ask" : "bid", session);
  const call = parExecPx(ce, buyPut ? "bid" : "ask", session);
  const future = parExecPx(fut, buyPut ? "ask" : "bid", session);
  const reasons = [];
  const incomplete = call.missing || put.missing || future.missing;
  if (call.missing) reasons.push("missing Call quote");
  if (put.missing) reasons.push("missing Put quote");
  if (future.missing) reasons.push("missing Future quote");
  if (parCrossedBook(ce) || parCrossedBook(pe) || parCrossedBook(fut)) reasons.push("crossed/invalid book");

  const snap = parSnapshotOk(ce, pe, fut, rates, session);
  if (session.live && !snap.ok) reasons.push(snap.reason);

  const callAvail = call.depth || call.qty;
  const putAvail = put.depth || put.qty;
  const futAvail = future.depth || future.qty;
  const topOk = session.live && call.qty >= qty && put.qty >= qty && future.qty >= qty;
  const depthOk = session.live && callAvail >= qty && putAvail >= qty && futAvail >= qty;
  if (session.live && !incomplete && !topOk) {
    reasons.push(depthOk
      ? `top-of-book qty below ${qty} (depth may walk)`
      : `available qty below ${qty}`);
  }

  const callSpread = parSpreadPct(ce.bid, ce.ask);
  const putSpread = parSpreadPct(pe.bid, pe.ask);
  const futSpread = parSpreadPct(fut.bid, fut.ask);
  if (session.live && callSpread > rates.maxOptSpreadPct) reasons.push("Call spread too wide");
  if (session.live && putSpread > rates.maxOptSpreadPct) reasons.push("Put spread too wide");
  if (session.live && futSpread > rates.maxFutSpreadPct) reasons.push("Future spread too wide");

  const df = rates.discountFactor;
  const synth = incomplete ? 0 : CallArbCharges.syntheticPut(call.price, future.price, pair.strike, df);
  const gross = incomplete ? 0 : (buyPut ? synth - put.price : put.price - synth);
  const charges = incomplete
    ? { total: 0, legs: [] }
    : CallArbCharges.threeLegCharges({
      strategy: side,
      kind: "put",
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
  const marginKey = `put|${pair.symbol}|${pair.expiry}|${pair.strike}|${side}|${qty}`;
  const liveMargin = parState.margins[marginKey];
  const margin = liveMargin && liveMargin.required > 0
    ? liveMargin
    : CallArbCharges.estimateMargins({
      strategy: side,
      kind: "put",
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
  const rom = margin.required > 0 && net > 0 ? (net / margin.required) * 100 : 0;

  const executable = session.live && !incomplete && topOk && snap.ok && !parCrossedBook(ce) && !parCrossedBook(pe) && !parCrossedBook(fut);
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
    sideLabel: buyPut ? "BUY PE / SELL CE / BUY FUT" : "SELL PE / BUY CE / SELL FUT",
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
    method: CallArbCharges.putMethodology(df),
  };
  const cls = classifyPutRow(row);
  row.status = cls.status;
  row.statusLabel = cls.label;
  row.statusReason = cls.reason;
  return row;
}

function evaluatePutArb() {
  const session = nseSession();
  const rates = readPutFormRates();
  const method = CallArbCharges.putMethodology(rates.discountFactor);
  paintPutArbMode(session, method);
  const rows = [];
  for (const pair of parState.pairs) {
    rows.push(evaluatePutSide(pair, "A", session, rates));
    rows.push(evaluatePutSide(pair, "B", session, rates));
  }
  const rank = { CONFIRMED: 0, POTENTIAL: 1, NO: 2 };
  rows.sort((a, b) => {
    const rs = rank[a.status] - rank[b.status];
    if (rs) return rs;
    return (b.rom - a.rom) || (b.net - a.net) || a.symbol.localeCompare(b.symbol);
  });
  parState.rows = rows;
  return rows;
}

function visiblePutArb(rows) {
  const minNet = parNum("par-min-net", 0);
  const minRom = parNum("par-min-rom", 0);
  const minEdge = parNum("par-min-edge", 0);
  const showNo = parChecked("par-show-no");
  const showA = !parEl("par-side-a") || parChecked("par-side-a");
  const showB = !parEl("par-side-b") || parChecked("par-side-b");
  const q = String((parEl("par-filter") && parEl("par-filter").value) || "").trim().toUpperCase();
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

function setPutArbStatus(text) {
  const el = parEl("par-status");
  if (el) el.textContent = `${text}${parState.source ? ` · ${parState.source}` : ""}`;
}

function parSideMark(buy) {
  return `<span class="side-mark ${buy ? "side-buy" : "side-sell"}">${buy ? "(B)" : "(S)"}</span>`;
}

function parMoneySide(price, buy, incomplete) {
  if (incomplete || !(Number(price) > 0)) return "—";
  return `${money(price)} ${parSideMark(buy)}`;
}

function renderPutArbRows(rows) {
  const body = parEl("par-body");
  const empty = parEl("par-empty");
  if (!body) return;
  body.innerHTML = "";
  const visible = visiblePutArb(rows);
  const confirmed = rows.filter((row) => row.status === "CONFIRMED").length;
  if (parEl("opp-count") && state.tab === "putarb") {
    parEl("opp-count").textContent = `${confirmed} confirmed / ${visible.length} shown`;
    parEl("stocks-scanned").textContent = String(new Set(parState.pairs.map((row) => row.symbol)).size);
  }
  if (!visible.length) {
    empty.classList.remove("hidden");
    empty.textContent = parState.pairs.length
      ? (nseSession().live
        ? "No executable same-expiry Put vs synthetic Put after costs, slippage and filters."
        : "No theoretical LTP edge after costs. Weekend/holiday rows are never CONFIRMED ARBITRAGE.")
      : "Connect Zerodha, then start the stock Put-arbitrage scanner.";
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
          <span class="stock-meta">${row.side === "A" ? "A · buy PE" : "B · sell PE"}</span>
        </div>
      </td>
      <td>${fmtExpiryLong(row.expiry)}</td>
      <td class="num">${inr(row.strike, 0)}</td>
      <td class="num">${parMoneySide(row.call, row.side === "B", row.incomplete)}</td>
      <td class="num">${parMoneySide(row.put, row.side === "A", row.incomplete)}</td>
      <td class="num">${parMoneySide(row.future, row.side === "A", row.incomplete)}</td>
      <td class="num">${row.incomplete ? "—" : money(row.synth)}</td>
      <td class="num">${row.incomplete ? "—" : `${row.gross > 0 ? "+" : ""}${inr(row.gross)}`}</td>
      <td class="num">${row.incomplete ? "—" : money(row.charges.total)}</td>
      <td class="num">${row.incomplete ? "—" : money(row.slipLot)}</td>
      <td class="num ${row.netLot > 0 ? "signal-yes" : "signal-no"}">${row.incomplete ? "—" : money(row.netLot)}</td>
      <td class="num">${row.incomplete ? "—" : `${money(row.margin.required)}${row.margin.uncertain ? "*" : ""}`}</td>
      <td class="num">${row.incomplete || !(row.rom > 0) ? "—" : pct(row.rom)}</td>
      <td class="${row.status === "CONFIRMED" ? "signal-yes" : row.status === "NO" ? "signal-no-red" : "signal-no"}">${row.statusLabel}</td>
    `;
    tr.addEventListener("click", () => openPutArbDrawer(row));
    body.appendChild(tr);
  }
}

function putChargeLines(leg) {
  if (!leg) return "";
  return `${money(leg.total)} · brk ${money(leg.brokerage)} · STT ${money(leg.stt)} · txn ${money(leg.txn)} · GST ${money(leg.gst)} · SEBI ${money(leg.sebi)} · stamp ${money(leg.stamp)}`;
}

function openPutArbDrawer(row, opts = {}) {
  parState.selected = row.id;
  const drawer = parEl("drawer");
  drawer.classList.add("wide");
  parEl("d-symbol").textContent = `${row.symbol} ${inr(row.strike, 0)} · ${row.statusLabel}`;
  parEl("d-name").textContent = row.sideLabel;
  const a = row.side === "A";
  const legs = row.charges.legs || [];
  const ts = (ms) => ms ? new Date(ms).toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" }) : "—";
  parEl("drawer-body").innerHTML = `
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
      <div class="leg"><em>${a ? "BUY" : "SELL"} ${row.pe_symbol}</em><span>${row.qty} @ ${row.put ? money(row.put) : "—"}</span></div>
      <div class="leg"><em>${a ? "SELL" : "BUY"} ${row.ce_symbol}</em><span>${row.qty} @ ${row.call ? money(row.call) : "—"}</span></div>
      <div class="leg"><em>${a ? "BUY" : "SELL"} ${row.fut_symbol}</em><span>${row.qty} @ ${row.future ? money(row.future) : "—"}</span></div>
    </div>
    <hr class="rule" />
    <div class="kv">
      ${kv("Synthetic Put", row.synth ? money(row.synth) : "—")}
      ${kv("Gross edge / sh", row.incomplete ? "—" : money(row.gross))}
      ${kv("Gross / lot", row.incomplete ? "—" : money(row.gross * row.lot))}
      ${kv("Call charges", putChargeLines(legs[0]))}
      ${kv("Put charges", putChargeLines(legs[1]))}
      ${kv("Future charges", putChargeLines(legs[2]))}
      ${kv("Total charges", money(row.charges.total || 0))}
      ${kv("Slippage / lot", money(row.slipLot))}
      ${kv("Net / lot", money(row.netLot), row.netLot > 0 ? "net" : "")}
      ${kv("Net (all lots)", money(row.net), row.net > 0 ? "net" : "")}
      ${kv("Standalone Future margin", money(row.margin.standaloneFuture || 0))}
      ${kv("Standalone short Call margin", money(row.margin.standaloneShortCall || 0))}
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
  parEl("backdrop").hidden = false;
  if (opts.fetchMargin !== false) requestPutMargin(row, Boolean(opts.forceMargin));
}

function refreshPutArb() {
  if (typeof state === "undefined" || state.tab !== "putarb") return;
  const rows = evaluatePutArb();
  renderPutArbRows(rows);
  const now = new Date().toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" });
  if (parEl("last-update")) parEl("last-update").textContent = now;
  prefetchPutMargins(rows);
}

let parPaint = 0;
function applyPutArbTicks(ticks) {
  const now = Date.now();
  for (const tick of ticks) {
    parState.books[String(tick.instrument_token)] = {
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
  if (!parPaint) {
    parPaint = window.requestAnimationFrame(() => {
      parPaint = 0;
      refreshPutArb();
    });
  }
}

function fillPutStockSelect(stocks) {
  const sel = parEl("par-stock");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">All F&O stocks</option>` + stocks
    .map((row) => `<option value="${row.symbol}">${row.symbol}</option>`)
    .join("");
  if ([...sel.options].some((opt) => opt.value === current)) sel.value = current;
}

async function seedPutMissingOptionBooks(pairs) {
  const keys = [...new Set(pairs.flatMap((row) => [row.ce_key, row.pe_key, row.fut_key]))];
  const need = keys.filter((key) => {
    const pair = pairs.find((row) => row.ce_key === key || row.pe_key === key || row.fut_key === key);
    if (!pair) return false;
    const token = key === pair.ce_key ? pair.ce_token : key === pair.pe_key ? pair.pe_token : pair.fut_token;
    const book = parBook(token);
    return !(book.ltp > 0 || book.bid > 0 || book.ask > 0);
  });
  for (let i = 0; i < need.length; i += 40) {
    const chunk = need.slice(i, i + 40);
    setPutArbStatus(`Seeding option quotes… ${Math.min(i + chunk.length, need.length)}/${need.length}`);
    const data = await fetchJson(`/api/quotes?hist=false&keys=${encodeURIComponent(chunk.join(","))}`);
    applyPutIncomingBooks(data.books || {}, pairs, Date.now());
    refreshPutArb();
  }
}

const parMarginInflight = new Set();

async function requestPutMargin(row, force) {
  if (row.incomplete || !(row.qty > 0)) return;
  const key = row.id;
  const prev = parState.margins[key];
  if (!force && prev && Date.now() - prev.at < 60000) return;
  if (parMarginInflight.has(key)) return;
  parMarginInflight.add(key);
  try {
    const a = row.side === "A";
    const data = await fetchJson("/api/margins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orders: [
          { tradingsymbol: row.pe_symbol, transaction_type: a ? "BUY" : "SELL", quantity: row.qty },
          { tradingsymbol: row.ce_symbol, transaction_type: a ? "SELL" : "BUY", quantity: row.qty },
          { tradingsymbol: row.fut_symbol, transaction_type: a ? "BUY" : "SELL", quantity: row.qty },
        ],
      }),
    });
    parState.margins[key] = {
      standaloneFuture: Number(data.standaloneFuture || 0),
      standaloneShortPut: Number(data.standaloneShortPut || 0),
      standaloneShortCall: Number(data.standaloneShortCall || 0),
      combined: Number(data.combined || 0),
      benefit: Number(data.benefit || 0),
      required: Number(data.required || 0),
      uncertain: data.uncertain !== false && !(Number(data.required) > 0),
      source: data.source || "kite",
      at: Date.now(),
    };
    refreshPutArb();
    if (parState.selected === key) {
      const latest = parState.rows.find((item) => item.id === key);
      if (latest) openPutArbDrawer(latest, { fetchMargin: false });
    }
  } catch (_err) {
    parState.margins[key] = { ...(prev || {}), at: Date.now(), uncertain: true, source: "unavailable" };
  } finally {
    parMarginInflight.delete(key);
  }
}

let putMarginQueue = Promise.resolve();
function prefetchPutMargins(rows) {
  const session = nseSession();
  const candidates = rows.filter((row) => !row.incomplete && row.net > 0).slice(0, session.live ? 8 : 4);
  for (const row of candidates) {
    putMarginQueue = putMarginQueue.then(() => requestPutMargin(row, false)).catch(() => {});
  }
}

async function startPutArbScanner() {
  if (!state.connected) {
    setPutArbStatus("Connect Zerodha first.");
    return;
  }
  if (typeof stopSynthScanner === "function") stopSynthScanner();
  if (typeof stopCallArbScanner === "function") stopCallArbScanner();
  if (typeof stopBoxArbScanner === "function") stopBoxArbScanner();
  if (typeof stopVertCeScanner === "function") stopVertCeScanner();
  if (typeof stopVertPeScanner === "function") stopVertPeScanner();
  persistPutRates();
  const btn = parEl("par-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Starting…";
  }
  try {
    const expiry = (parEl("par-expiry") && parEl("par-expiry").value) || "nearest";
    const symbol = (parEl("par-stock") && parEl("par-stock").value) || "";
    const band = parNum("par-band", 6);
    const maxStrikes = parNum("par-max-strikes", symbol ? 40 : 5);
    const snapshot = await fetchJson(
      `/api/put-arb?seed=true&expiry=${encodeURIComponent(expiry)}&symbol=${encodeURIComponent(symbol)}&band=${encodeURIComponent(band)}&max_strikes=${encodeURIComponent(maxStrikes)}`,
    );
    parState.pairs = snapshot.pairs || [];
    parState.books = snapshot.books || {};
    parState.stocks = snapshot.stocks || [];
    parState.started = true;
    state.connected = Boolean(snapshot.connected);
    setPill(state.connected);
    fillPutStockSelect(parState.stocks);
    const bar = parEl("alert-bar");
    if (bar && (snapshot.message || snapshot.error)) {
      bar.classList.remove("hidden");
      bar.textContent = snapshot.message || snapshot.error;
    }
    refreshPutArb();
    setPutArbStatus("Seeding option quotes…");
    await seedPutMissingOptionBooks(parState.pairs);

    if (parState.ticker) {
      parState.ticker.close();
      parState.ticker = null;
    }
    const creds = await fetchJson("/api/ticker");
    if (creds.ws_url && parState.pairs.length) {
      parState.source = "Kite WebSocket";
      setPutArbStatus("Connecting ticker…");
      parState.ticker = connectKiteTicker({
        wsUrl: creds.ws_url,
        tokens: snapshot.tokens || [],
        onTicks: applyPutArbTicks,
        onStatus: setPutArbStatus,
      });
    } else {
      parState.source = "REST quotes";
      setPutArbStatus(creds.error || "WebSocket unavailable — snapshot quotes only.");
    }
    refreshPutArb();
  } catch (error) {
    setPutArbStatus(error.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Start scanner";
    }
  }
}

function stopPutArbScanner() {
  if (parState.ticker) parState.ticker.close();
  parState.ticker = null;
  parState.started = false;
  setPutArbStatus("Stopped");
}

window.setInterval(() => {
  if (typeof state !== "undefined" && state.tab === "putarb") refreshPutArb();
}, 30000);

window.startPutArbScanner = startPutArbScanner;
window.stopPutArbScanner = stopPutArbScanner;
window.refreshPutArb = refreshPutArb;
window.fillPutArbRates = fillPutRateForm;
window.persistPutArbRates = persistPutRates;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => fillPutRateForm(readPutStoredRates()));
} else {
  fillPutRateForm(readPutStoredRates());
}
