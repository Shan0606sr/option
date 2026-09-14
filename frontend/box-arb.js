const BOX_RATES_KEY = "box_arb_rates_v1";

const boxState = {
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

function boxEl(id) {
  return document.getElementById(id);
}

function boxNum(id, fallback) {
  const value = Number(boxEl(id) && boxEl(id).value);
  return Number.isFinite(value) ? value : fallback;
}

function boxChecked(id) {
  return Boolean(boxEl(id) && boxEl(id).checked);
}

function readBoxStoredRates() {
  try {
    return CallArbCharges.mergeRates(JSON.parse(localStorage.getItem(BOX_RATES_KEY) || "{}"));
  } catch (_err) {
    return CallArbCharges.mergeRates();
  }
}

function readBoxFormRates() {
  const stored = readBoxStoredRates();
  return CallArbCharges.mergeRates({
    ...stored,
    opt: {
      brokerage: boxNum("box-opt-brok", stored.opt.brokerage),
      sttSellPct: boxNum("box-opt-stt", stored.opt.sttSellPct),
      sttExercisePct: boxNum("box-opt-ex-stt", stored.opt.sttExercisePct),
      txnPct: boxNum("box-opt-txn", stored.opt.txnPct),
      stampBuyPct: boxNum("box-opt-stamp", stored.opt.stampBuyPct),
    },
    gstPct: boxNum("box-gst", stored.gstPct),
    sebiPerCrore: boxNum("box-sebi", stored.sebiPerCrore),
    includeExerciseStt: boxChecked("box-include-ex"),
    slippageInr: boxNum("box-slip", stored.slippageInr),
    slipSpreadFrac: boxNum("box-slip-spread", stored.slipSpreadFrac),
    staleMs: boxNum("box-stale", stored.staleMs),
    snapMs: boxNum("box-snap", stored.snapMs),
    maxOptSpreadPct: boxNum("box-opt-spread", stored.maxOptSpreadPct),
    lots: Math.max(1, Math.round(boxNum("box-lots", stored.lots) || 1)),
  });
}

function persistBoxRates() {
  localStorage.setItem(BOX_RATES_KEY, JSON.stringify(readBoxFormRates()));
}

function fillBoxRateForm(rates) {
  const r = CallArbCharges.mergeRates(rates);
  const set = (id, value) => {
    if (boxEl(id)) boxEl(id).value = value;
  };
  set("box-opt-brok", r.opt.brokerage);
  set("box-opt-stt", r.opt.sttSellPct);
  set("box-opt-ex-stt", r.opt.sttExercisePct);
  set("box-opt-txn", r.opt.txnPct);
  set("box-opt-stamp", r.opt.stampBuyPct);
  set("box-gst", r.gstPct);
  set("box-sebi", r.sebiPerCrore);
  set("box-slip", r.slippageInr);
  set("box-slip-spread", r.slipSpreadFrac);
  set("box-stale", r.staleMs);
  set("box-snap", r.snapMs);
  set("box-opt-spread", r.maxOptSpreadPct);
  set("box-lots", r.lots);
  if (boxEl("box-include-ex")) boxEl("box-include-ex").checked = Boolean(r.includeExerciseStt);
}

function boxBook(token) {
  return boxState.books[String(token)] || {
    ltp: 0, bid: 0, ask: 0, bid_qty: 0, ask_qty: 0, bid_depth: 0, ask_depth: 0, ts: 0,
  };
}

function boxLookup(books, ...keys) {
  for (const key of keys) {
    if (key && books[key]) return books[key];
    if (key && books[String(key)]) return books[String(key)];
  }
  return null;
}

function boxLegsOf(pair) {
  return [
    [pair.k1_ce_token, pair.k1_ce_key],
    [pair.k1_pe_token, pair.k1_pe_key],
    [pair.k2_ce_token, pair.k2_ce_key],
    [pair.k2_pe_token, pair.k2_pe_key],
  ];
}

function applyBoxIncomingBooks(books, pairs, ts) {
  if (!books) return;
  for (const pair of pairs) {
    for (const [token, key] of boxLegsOf(pair)) {
      const q = boxLookup(books, key, token);
      if (!q) continue;
      const prev = boxBook(token);
      const ltp = Number(q.last_price || q.ltp || 0);
      boxState.books[String(token)] = {
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

function boxExecPx(book, side, session) {
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

function paintBoxArbMode(session, method) {
  const box = boxEl("box-mode");
  const label = boxEl("box-mode-label");
  const reason = boxEl("box-mode-reason");
  if (!box) return;
  box.className = `synth-mode ${session.live ? "synth-mode-live" : "synth-mode-ltp"}`;
  if (label) label.textContent = session.live ? "🟢 LIVE / EXECUTABLE" : "🟡 LTP / THEORETICAL";
  if (reason) reason.textContent = `${session.reason} · ${method.label} Confirmed arbitrage is never labelled from LTP.`;
  const methodEl = boxEl("box-method");
  if (methodEl) methodEl.textContent = `${method.label} · (B) buy · (S) sell`;
}

function boxSnapshotOk(books, rates, session) {
  if (!session.live) return { ok: true, reason: "" };
  const times = books.map((row) => Number(row.ts || 0));
  if (times.some((ts) => !ts)) return { ok: false, reason: "missing quote timestamp" };
  const age = Date.now() - Math.min(...times);
  const span = Math.max(...times) - Math.min(...times);
  if (age > rates.staleMs) return { ok: false, reason: "stale quotes" };
  if (span > rates.snapMs) return { ok: false, reason: "legs not from the same snapshot" };
  return { ok: true, reason: "" };
}

function boxSpreadPct(bid, ask) {
  if (!(bid > 0) || !(ask > 0)) return 0;
  return ((ask - bid) / ((ask + bid) / 2)) * 100;
}

function boxCrossed(book) {
  return book.bid > 0 && book.ask > 0 && book.bid > book.ask;
}

function classifyBoxRow(row) {
  if (row.incomplete) return { status: "POTENTIAL", label: "🟡 POTENTIAL", reason: row.reasons[0] || "incomplete quotes" };
  if (!(row.net > 0)) return { status: "NO", label: "🔴 NO ARBITRAGE", reason: "net profit ≤ 0 after costs and slippage" };
  if (!row.live) return { status: "POTENTIAL", label: "🟡 POTENTIAL", reason: "LTP / theoretical only — not executable" };
  if (!row.executable) return { status: "POTENTIAL", label: "🟡 POTENTIAL", reason: row.reasons[0] || "not executable" };
  if (row.reasons.length) return { status: "POTENTIAL", label: "🟡 POTENTIAL", reason: row.reasons[0] };
  return { status: "CONFIRMED", label: "🟢 CONFIRMED ARBITRAGE", reason: "executable after costs, slippage and liquidity" };
}

function evaluateBoxSide(pair, side, session, rates) {
  const k1CeB = boxBook(pair.k1_ce_token);
  const k2CeB = boxBook(pair.k2_ce_token);
  const k2PeB = boxBook(pair.k2_pe_token);
  const k1PeB = boxBook(pair.k1_pe_token);
  const lot = pair.lot_size || 1;
  const lots = rates.lots;
  const qty = lot * lots;
  const longBox = side === "A";
  const k1Ce = boxExecPx(k1CeB, longBox ? "ask" : "bid", session);
  const k2Ce = boxExecPx(k2CeB, longBox ? "bid" : "ask", session);
  const k2Pe = boxExecPx(k2PeB, longBox ? "ask" : "bid", session);
  const k1Pe = boxExecPx(k1PeB, longBox ? "bid" : "ask", session);
  const reasons = [];
  const incomplete = k1Ce.missing || k2Ce.missing || k2Pe.missing || k1Pe.missing;
  if (k1Ce.missing) reasons.push("missing K1 Call quote");
  if (k2Ce.missing) reasons.push("missing K2 Call quote");
  if (k2Pe.missing) reasons.push("missing K2 Put quote");
  if (k1Pe.missing) reasons.push("missing K1 Put quote");
  if (boxCrossed(k1CeB) || boxCrossed(k2CeB) || boxCrossed(k2PeB) || boxCrossed(k1PeB)) reasons.push("crossed/invalid book");

  const sanity = CallArbCharges.boxPayoffSanity(pair.k1, pair.k2);
  if (!sanity.ok) reasons.push("box payoff identity failed");

  const snap = boxSnapshotOk([k1CeB, k2CeB, k2PeB, k1PeB], rates, session);
  if (session.live && !snap.ok) reasons.push(snap.reason);

  const quotes = [k1Ce, k2Ce, k2Pe, k1Pe];
  const topOk = session.live && quotes.every((row) => row.qty >= qty);
  const depthOk = session.live && quotes.every((row) => (row.depth || row.qty) >= qty);
  if (session.live && !incomplete && !topOk) {
    reasons.push(depthOk
      ? `top-of-book qty below ${qty} (depth may walk)`
      : `available qty below ${qty}`);
  }

  const spreads = [k1CeB, k2CeB, k2PeB, k1PeB].map((book) => boxSpreadPct(book.bid, book.ask));
  if (session.live && spreads.some((pct) => pct > rates.maxOptSpreadPct)) reasons.push("option spread too wide");

  const width = CallArbCharges.boxPayoff(pair.k1, pair.k2);
  const entry = incomplete
    ? 0
    : (longBox
      ? CallArbCharges.longBoxCost(k1Ce.price, k2Ce.price, k2Pe.price, k1Pe.price)
      : CallArbCharges.shortBoxCredit(k1Ce.price, k2Ce.price, k2Pe.price, k1Pe.price));
  const gross = incomplete || !sanity.ok ? 0 : (longBox ? width - entry : entry - width);
  const charges = incomplete
    ? { total: 0, legs: [] }
    : CallArbCharges.fourLegBoxCharges({
      longBox,
      k1Ce: k1Ce.price,
      k2Ce: k2Ce.price,
      k2Pe: k2Pe.price,
      k1Pe: k1Pe.price,
      qty,
      rates,
    });
  const slipShare = CallArbCharges.boxSlippagePerShare({
    k1CeBid: k1CeB.bid || k1Ce.price,
    k1CeAsk: k1CeB.ask || k1Ce.price,
    k2CeBid: k2CeB.bid || k2Ce.price,
    k2CeAsk: k2CeB.ask || k2Ce.price,
    k2PeBid: k2PeB.bid || k2Pe.price,
    k2PeAsk: k2PeB.ask || k2Pe.price,
    k1PeBid: k1PeB.bid || k1Pe.price,
    k1PeAsk: k1PeB.ask || k1Pe.price,
    rates,
  });
  const costShare = qty ? charges.total / qty : 0;
  const netShare = incomplete || !sanity.ok ? 0 : gross - costShare - slipShare;
  const netLot = netShare * lot;
  const net = netShare * qty;
  const marginKey = `box|${pair.symbol}|${pair.expiry}|${pair.k1}|${pair.k2}|${side}|${qty}`;
  const liveMargin = boxState.margins[marginKey];
  const margin = liveMargin && liveMargin.required > 0
    ? liveMargin
    : CallArbCharges.estimateBoxMargins({
      longBox,
      k1: pair.k1,
      k2: pair.k2,
      k1Ce: k1Ce.price,
      k2Ce: k2Ce.price,
      k2Pe: k2Pe.price,
      k1Pe: k1Pe.price,
      lot,
      lots,
    });
  if (!liveMargin || liveMargin.uncertain || !(margin.required > 0)) {
    if (gross > 0) reasons.push(margin.source === "kite-basket" ? "margin incomplete" : "margin estimated / uncertain");
  }
  const rom = margin.required > 0 && net > 0 ? (net / margin.required) * 100 : 0;
  const executable = session.live && !incomplete && topOk && snap.ok && sanity.ok
    && !boxCrossed(k1CeB) && !boxCrossed(k2CeB) && !boxCrossed(k2PeB) && !boxCrossed(k1PeB);

  const row = {
    id: marginKey,
    pair,
    symbol: pair.symbol,
    expiry: pair.expiry,
    k1: pair.k1,
    k2: pair.k2,
    width,
    lot,
    lots,
    qty,
    side,
    longBox,
    sideLabel: longBox ? "LONG BOX · BUY K1 CE / SELL K2 CE / BUY K2 PE / SELL K1 PE" : "SHORT BOX · SELL K1 CE / BUY K2 CE / SELL K2 PE / BUY K1 PE",
    k1_ce_symbol: pair.k1_ce_symbol,
    k2_ce_symbol: pair.k2_ce_symbol,
    k2_pe_symbol: pair.k2_pe_symbol,
    k1_pe_symbol: pair.k1_pe_symbol,
    k1Ce: k1Ce.price,
    k2Ce: k2Ce.price,
    k2Pe: k2Pe.price,
    k1Pe: k1Pe.price,
    entry,
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
    usedLtp: quotes.some((row) => row.usedLtp),
    incomplete,
    executable,
    sanity,
    reasons: [...new Set(reasons)],
    ts: { k1Ce: k1CeB.ts, k2Ce: k2CeB.ts, k2Pe: k2PeB.ts, k1Pe: k1PeB.ts },
    method: CallArbCharges.boxMethodology(),
  };
  const cls = classifyBoxRow(row);
  row.status = cls.status;
  row.statusLabel = cls.label;
  row.statusReason = cls.reason;
  return row;
}

function evaluateBoxArb() {
  const session = nseSession();
  const rates = readBoxFormRates();
  const method = CallArbCharges.boxMethodology();
  paintBoxArbMode(session, method);
  const rows = [];
  for (const pair of boxState.pairs) {
    rows.push(evaluateBoxSide(pair, "A", session, rates));
    rows.push(evaluateBoxSide(pair, "B", session, rates));
  }
  const rank = { CONFIRMED: 0, POTENTIAL: 1, NO: 2 };
  rows.sort((a, b) => {
    const rs = rank[a.status] - rank[b.status];
    if (rs) return rs;
    return (b.rom - a.rom) || (b.net - a.net) || a.symbol.localeCompare(b.symbol) || a.width - b.width;
  });
  boxState.rows = rows;
  return rows;
}

function visibleBoxArb(rows) {
  const minNet = boxNum("box-min-net", 0);
  const minRom = boxNum("box-min-rom", 0);
  const minEdge = boxNum("box-min-edge", 0);
  const showNo = boxChecked("box-show-no");
  const showA = !boxEl("box-side-a") || boxChecked("box-side-a");
  const showB = !boxEl("box-side-b") || boxChecked("box-side-b");
  const q = String((boxEl("box-filter") && boxEl("box-filter").value) || "").trim().toUpperCase();
  return rows.filter((row) => {
    if (row.side === "A" && !showA) return false;
    if (row.side === "B" && !showB) return false;
    if (q && !row.symbol.includes(q) && !String(row.k1).includes(q) && !String(row.k2).includes(q)) return false;
    if (row.incomplete) return showNo;
    if (row.status === "NO") return showNo && row.gross !== 0;
    if (row.netLot + 1e-9 < minNet) return false;
    if (row.rom + 1e-9 < minRom) return false;
    if (row.gross + 1e-9 < minEdge) return false;
    return true;
  });
}

function setBoxArbStatus(text) {
  const el = boxEl("box-status");
  if (el) el.textContent = `${text}${boxState.source ? ` · ${boxState.source}` : ""}`;
}

function boxSideMark(buy) {
  return `<span class="side-mark ${buy ? "side-buy" : "side-sell"}">${buy ? "(B)" : "(S)"}</span>`;
}

function boxMoneySide(price, buy, incomplete) {
  if (incomplete || !(Number(price) > 0)) return "—";
  return `${money(price)} ${boxSideMark(buy)}`;
}

function renderBoxArbRows(rows) {
  const body = boxEl("box-body");
  const empty = boxEl("box-empty");
  if (!body) return;
  body.innerHTML = "";
  const visible = visibleBoxArb(rows);
  const confirmed = rows.filter((row) => row.status === "CONFIRMED").length;
  if (boxEl("opp-count") && state.tab === "boxarb") {
    boxEl("opp-count").textContent = `${confirmed} confirmed / ${visible.length} shown`;
    boxEl("stocks-scanned").textContent = String(new Set(boxState.pairs.map((row) => row.symbol)).size);
  }
  if (!visible.length) {
    empty.classList.remove("hidden");
    empty.textContent = boxState.pairs.length
      ? (nseSession().live
        ? "No executable same-expiry box after costs, slippage and filters."
        : "No theoretical LTP edge after costs. Weekend/holiday rows are never CONFIRMED ARBITRAGE.")
      : "Connect Zerodha, then start the box-arbitrage scanner.";
    return;
  }
  empty.classList.add("hidden");
  for (const row of visible) {
    const tr = document.createElement("tr");
    tr.className = row.status === "CONFIRMED" ? "hit" : row.status === "POTENTIAL" ? "theo" : "miss";
    tr.dataset.id = row.id;
    tr.title = row.statusReason;
    const long = row.longBox;
    tr.innerHTML = `
      <td>
        <div class="stock-cell">
          <strong>${row.symbol}</strong>
          <span class="stock-meta">${long ? "A · long box" : "B · short box"}</span>
        </div>
      </td>
      <td>${fmtExpiryLong(row.expiry)}</td>
      <td class="num">${inr(row.k1, 0)}</td>
      <td class="num">${inr(row.k2, 0)}</td>
      <td class="num">${inr(row.width, 0)}</td>
      <td class="num">${boxMoneySide(row.k1Ce, long, row.incomplete)}</td>
      <td class="num">${boxMoneySide(row.k2Ce, !long, row.incomplete)}</td>
      <td class="num">${boxMoneySide(row.k2Pe, long, row.incomplete)}</td>
      <td class="num">${boxMoneySide(row.k1Pe, !long, row.incomplete)}</td>
      <td class="num">${row.incomplete ? "—" : `${long ? "cost" : "credit"} ${money(row.entry)}`}</td>
      <td class="num">${row.incomplete ? "—" : `${row.gross > 0 ? "+" : ""}${inr(row.gross)}`}</td>
      <td class="num">${row.incomplete ? "—" : money(row.charges.total)}</td>
      <td class="num">${row.incomplete ? "—" : money(row.slipLot)}</td>
      <td class="num">${row.incomplete ? "—" : money(row.netShare)}</td>
      <td class="num">${inr(row.lot, 0)}</td>
      <td class="num ${row.netLot > 0 ? "signal-yes" : "signal-no"}">${row.incomplete ? "—" : money(row.netLot)}</td>
      <td class="num">${row.incomplete ? "—" : `${money(row.margin.required)}${row.margin.uncertain ? "*" : ""}`}</td>
      <td class="num">${row.incomplete || !(row.rom > 0) ? "—" : pct(row.rom)}</td>
      <td class="${row.status === "CONFIRMED" ? "signal-yes" : row.status === "NO" ? "signal-no-red" : "signal-no"}">${row.statusLabel}</td>
    `;
    tr.addEventListener("click", () => openBoxArbDrawer(row));
    body.appendChild(tr);
  }
}

function boxChargeLines(leg) {
  if (!leg) return "";
  return `${money(leg.total)} · brk ${money(leg.brokerage)} · STT ${money(leg.stt)} · txn ${money(leg.txn)} · GST ${money(leg.gst)} · SEBI ${money(leg.sebi)} · stamp ${money(leg.stamp)}`;
}

function openBoxArbDrawer(row, opts = {}) {
  boxState.selected = row.id;
  const drawer = boxEl("drawer");
  drawer.classList.add("wide");
  boxEl("d-symbol").textContent = `${row.symbol} ${inr(row.k1, 0)}/${inr(row.k2, 0)} · ${row.statusLabel}`;
  boxEl("d-name").textContent = row.sideLabel;
  const long = row.longBox;
  const legs = row.charges.legs || [];
  const ts = (ms) => ms ? new Date(ms).toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" }) : "—";
  boxEl("drawer-body").innerHTML = `
    <p class="badge ${row.status === "CONFIRMED" ? "net" : ""}">${row.statusLabel}</p>
    <p class="index-meta">${row.statusReason}</p>
    <div class="kv">
      ${kv("Stock", row.symbol)}
      ${kv("Expiry", fmtExpiryLong(row.expiry))}
      ${kv("Lower K1", money(row.k1))}
      ${kv("Higher K2", money(row.k2))}
      ${kv("Fixed payoff K2 − K1", money(row.width))}
      ${kv("Lot × lots", `${row.lot} × ${row.lots} = ${row.qty}`)}
      ${kv("Methodology", row.method.label)}
      ${kv("Mode", row.live ? "LIVE / EXECUTABLE" : "LTP / THEORETICAL")}
      ${kv("Payoff identity", row.sanity && row.sanity.ok ? "K2 − K1 at S < K1, between, and S > K2" : "FAILED")}
    </div>
    <hr class="rule" />
    <div class="legs">
      <div class="leg"><em>${long ? "BUY" : "SELL"} ${row.k1_ce_symbol}</em><span>${row.qty} @ ${row.k1Ce ? money(row.k1Ce) : "—"}</span></div>
      <div class="leg"><em>${long ? "SELL" : "BUY"} ${row.k2_ce_symbol}</em><span>${row.qty} @ ${row.k2Ce ? money(row.k2Ce) : "—"}</span></div>
      <div class="leg"><em>${long ? "BUY" : "SELL"} ${row.k2_pe_symbol}</em><span>${row.qty} @ ${row.k2Pe ? money(row.k2Pe) : "—"}</span></div>
      <div class="leg"><em>${long ? "SELL" : "BUY"} ${row.k1_pe_symbol}</em><span>${row.qty} @ ${row.k1Pe ? money(row.k1Pe) : "—"}</span></div>
    </div>
    <hr class="rule" />
    <div class="kv">
      ${kv(long ? "Net box cost" : "Net box credit", row.incomplete ? "—" : money(row.entry))}
      ${kv("Gross edge / sh", row.incomplete ? "—" : money(row.gross))}
      ${kv("Gross / lot", row.incomplete ? "—" : money(row.gross * row.lot))}
      ${kv("K1 CE charges", boxChargeLines(legs[0]))}
      ${kv("K2 CE charges", boxChargeLines(legs[1]))}
      ${kv("K2 PE charges", boxChargeLines(legs[2]))}
      ${kv("K1 PE charges", boxChargeLines(legs[3]))}
      ${kv("Total charges", money(row.charges.total || 0))}
      ${kv("Slippage / lot", money(row.slipLot))}
      ${kv("Net / box (₹/sh)", money(row.netShare), row.netShare > 0 ? "net" : "")}
      ${kv("Net / lot", money(row.netLot), row.netLot > 0 ? "net" : "")}
      ${kv("Net (all lots)", money(row.net), row.net > 0 ? "net" : "")}
      ${kv("Combined margin", money(row.margin.combined || row.margin.required || 0))}
      ${kv("Final required margin", money(row.margin.required || 0))}
      ${kv("Return on margin", row.rom ? pct(row.rom) : "—")}
      ${kv("Margin source", row.margin.uncertain ? `${row.margin.source} (uncertain → not confirmed)` : row.margin.source)}
      ${kv("K1 CE quote ts", ts(row.ts.k1Ce))}
      ${kv("K2 CE quote ts", ts(row.ts.k2Ce))}
      ${kv("K2 PE quote ts", ts(row.ts.k2Pe))}
      ${kv("K1 PE quote ts", ts(row.ts.k1Pe))}
    </div>
    <p class="footnote">Identification only. No order is sent. Version 1 does not discount K2 − K1 for financing.</p>
  `;
  drawer.hidden = false;
  boxEl("backdrop").hidden = false;
  if (opts.fetchMargin !== false) requestBoxMargin(row, Boolean(opts.forceMargin));
}

function refreshBoxArb() {
  if (typeof state === "undefined" || state.tab !== "boxarb") return;
  const rows = evaluateBoxArb();
  renderBoxArbRows(rows);
  const now = new Date().toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" });
  if (boxEl("last-update")) boxEl("last-update").textContent = now;
  prefetchBoxMargins(rows);
}

let boxPaint = 0;
function applyBoxArbTicks(ticks) {
  const now = Date.now();
  for (const tick of ticks) {
    boxState.books[String(tick.instrument_token)] = {
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
  if (!boxPaint) {
    boxPaint = window.requestAnimationFrame(() => {
      boxPaint = 0;
      refreshBoxArb();
    });
  }
}

function fillBoxStockSelect(stocks) {
  const sel = boxEl("box-stock");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">All F&O stocks</option>` + stocks
    .map((row) => `<option value="${row.symbol}">${row.symbol}</option>`)
    .join("");
  if ([...sel.options].some((opt) => opt.value === current)) sel.value = current;
}

async function seedBoxMissingOptionBooks(pairs) {
  const keys = [...new Set(pairs.flatMap((row) => [row.k1_ce_key, row.k1_pe_key, row.k2_ce_key, row.k2_pe_key]))];
  const need = keys.filter((key) => {
    const pair = pairs.find((row) => (
      row.k1_ce_key === key || row.k1_pe_key === key || row.k2_ce_key === key || row.k2_pe_key === key
    ));
    if (!pair) return false;
    const token = key === pair.k1_ce_key ? pair.k1_ce_token
      : key === pair.k1_pe_key ? pair.k1_pe_token
        : key === pair.k2_ce_key ? pair.k2_ce_token
          : pair.k2_pe_token;
    const book = boxBook(token);
    return !(book.ltp > 0 || book.bid > 0 || book.ask > 0);
  });
  for (let i = 0; i < need.length; i += 40) {
    const chunk = need.slice(i, i + 40);
    setBoxArbStatus(`Seeding option quotes… ${Math.min(i + chunk.length, need.length)}/${need.length}`);
    const data = await fetchJson(`/api/quotes?hist=false&keys=${encodeURIComponent(chunk.join(","))}`);
    applyBoxIncomingBooks(data.books || {}, pairs, Date.now());
    refreshBoxArb();
  }
}

const boxMarginInflight = new Set();

async function requestBoxMargin(row, force) {
  if (row.incomplete || !(row.qty > 0)) return;
  const key = row.id;
  const prev = boxState.margins[key];
  if (!force && prev && Date.now() - prev.at < 60000) return;
  if (boxMarginInflight.has(key)) return;
  boxMarginInflight.add(key);
  try {
    const long = row.longBox;
    const data = await fetchJson("/api/margins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orders: [
          { tradingsymbol: row.k1_ce_symbol, transaction_type: long ? "BUY" : "SELL", quantity: row.qty },
          { tradingsymbol: row.k2_ce_symbol, transaction_type: long ? "SELL" : "BUY", quantity: row.qty },
          { tradingsymbol: row.k2_pe_symbol, transaction_type: long ? "BUY" : "SELL", quantity: row.qty },
          { tradingsymbol: row.k1_pe_symbol, transaction_type: long ? "SELL" : "BUY", quantity: row.qty },
        ],
      }),
    });
    boxState.margins[key] = {
      combined: Number(data.combined || 0),
      required: Number(data.required || 0),
      uncertain: data.uncertain !== false && !(Number(data.required) > 0),
      source: data.source || "kite",
      at: Date.now(),
    };
    refreshBoxArb();
    if (boxState.selected === key) {
      const latest = boxState.rows.find((item) => item.id === key);
      if (latest) openBoxArbDrawer(latest, { fetchMargin: false });
    }
  } catch (_err) {
    boxState.margins[key] = { ...(prev || {}), at: Date.now(), uncertain: true, source: "unavailable" };
  } finally {
    boxMarginInflight.delete(key);
  }
}

let boxMarginQueue = Promise.resolve();
function prefetchBoxMargins(rows) {
  const session = nseSession();
  const candidates = rows.filter((row) => !row.incomplete && row.net > 0).slice(0, session.live ? 8 : 4);
  for (const row of candidates) {
    boxMarginQueue = boxMarginQueue.then(() => requestBoxMargin(row, false)).catch(() => {});
  }
}

async function startBoxArbScanner() {
  if (!state.connected) {
    setBoxArbStatus("Connect Zerodha first.");
    return;
  }
  if (typeof stopSynthScanner === "function") stopSynthScanner();
  if (typeof stopCallArbScanner === "function") stopCallArbScanner();
  if (typeof stopPutArbScanner === "function") stopPutArbScanner();
  if (typeof stopVertCeScanner === "function") stopVertCeScanner();
  if (typeof stopVertPeScanner === "function") stopVertPeScanner();
  if (typeof stopSilverArbScanner === "function") stopSilverArbScanner();
  if (typeof stopOptionRvScanner === "function") stopOptionRvScanner();
  persistBoxRates();
  const btn = boxEl("box-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Starting…";
  }
  try {
    const expiry = (boxEl("box-expiry") && boxEl("box-expiry").value) || "nearest";
    const symbol = (boxEl("box-stock") && boxEl("box-stock").value) || "";
    const band = boxNum("box-band", 6);
    const maxStrikes = boxNum("box-max-strikes", symbol ? 40 : 5);
    const snapshot = await fetchJson(
      `/api/box-arb?seed=true&expiry=${encodeURIComponent(expiry)}&symbol=${encodeURIComponent(symbol)}&band=${encodeURIComponent(band)}&max_strikes=${encodeURIComponent(maxStrikes)}`,
    );
    boxState.pairs = snapshot.pairs || [];
    boxState.books = snapshot.books || {};
    boxState.stocks = snapshot.stocks || [];
    boxState.started = true;
    state.connected = Boolean(snapshot.connected);
    setPill(state.connected);
    fillBoxStockSelect(boxState.stocks);
    const bar = boxEl("alert-bar");
    if (bar && (snapshot.message || snapshot.error)) {
      bar.classList.remove("hidden");
      bar.textContent = snapshot.message || snapshot.error;
    }
    refreshBoxArb();
    setBoxArbStatus("Seeding option quotes…");
    await seedBoxMissingOptionBooks(boxState.pairs);

    if (boxState.ticker) {
      boxState.ticker.close();
      boxState.ticker = null;
    }
    const creds = await fetchJson("/api/ticker");
    if (creds.ws_url && boxState.pairs.length) {
      boxState.source = "Kite WebSocket";
      setBoxArbStatus("Connecting ticker…");
      boxState.ticker = connectKiteTicker({
        wsUrl: creds.ws_url,
        tokens: snapshot.tokens || [],
        onTicks: applyBoxArbTicks,
        onStatus: setBoxArbStatus,
      });
    } else {
      boxState.source = "REST quotes";
      setBoxArbStatus(creds.error || "WebSocket unavailable — snapshot quotes only.");
    }
    refreshBoxArb();
  } catch (error) {
    setBoxArbStatus(error.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Start scanner";
    }
  }
}

function stopBoxArbScanner() {
  if (boxState.ticker) boxState.ticker.close();
  boxState.ticker = null;
  boxState.started = false;
  setBoxArbStatus("Stopped");
}

window.setInterval(() => {
  if (typeof state !== "undefined" && state.tab === "boxarb") refreshBoxArb();
}, 30000);

window.startBoxArbScanner = startBoxArbScanner;
window.stopBoxArbScanner = stopBoxArbScanner;
window.refreshBoxArb = refreshBoxArb;
window.fillBoxArbRates = fillBoxRateForm;
window.persistBoxArbRates = persistBoxRates;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => fillBoxRateForm(readBoxStoredRates()));
} else {
  fillBoxRateForm(readBoxStoredRates());
}
