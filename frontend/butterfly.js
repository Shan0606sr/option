const BFLY_RATES_KEY = "butterfly_rates_v1";

const bflyState = {
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

function bflyEl(id) {
  return document.getElementById(id);
}

function bflyNum(id, fallback) {
  const value = Number(bflyEl(id) && bflyEl(id).value);
  return Number.isFinite(value) ? value : fallback;
}

function bflyChecked(id) {
  return Boolean(bflyEl(id) && bflyEl(id).checked);
}

function readBflyStoredRates() {
  try {
    return CallArbCharges.mergeRates(JSON.parse(localStorage.getItem(BFLY_RATES_KEY) || "{}"));
  } catch (_err) {
    return CallArbCharges.mergeRates();
  }
}

function readBflyFormRates() {
  const stored = readBflyStoredRates();
  return CallArbCharges.mergeRates({
    ...stored,
    opt: {
      brokerage: bflyNum("bfly-opt-brok", stored.opt.brokerage),
      sttSellPct: bflyNum("bfly-opt-stt", stored.opt.sttSellPct),
      sttExercisePct: bflyNum("bfly-opt-ex-stt", stored.opt.sttExercisePct),
      txnPct: bflyNum("bfly-opt-txn", stored.opt.txnPct),
      stampBuyPct: bflyNum("bfly-opt-stamp", stored.opt.stampBuyPct),
    },
    gstPct: bflyNum("bfly-gst", stored.gstPct),
    sebiPerCrore: bflyNum("bfly-sebi", stored.sebiPerCrore),
    includeExerciseStt: bflyChecked("bfly-include-ex"),
    slippageInr: bflyNum("bfly-slip", stored.slippageInr),
    slipSpreadFrac: bflyNum("bfly-slip-spread", stored.slipSpreadFrac),
    staleMs: bflyNum("bfly-stale", stored.staleMs),
    snapMs: bflyNum("bfly-snap", stored.snapMs),
    maxOptSpreadPct: bflyNum("bfly-opt-spread", stored.maxOptSpreadPct),
    lots: Math.max(1, Math.round(bflyNum("bfly-lots", stored.lots) || 1)),
  });
}

function persistBflyRates() {
  localStorage.setItem(BFLY_RATES_KEY, JSON.stringify(readBflyFormRates()));
}

function fillBflyRateForm(rates) {
  const r = CallArbCharges.mergeRates(rates);
  const set = (id, value) => {
    if (bflyEl(id)) bflyEl(id).value = value;
  };
  set("bfly-opt-brok", r.opt.brokerage);
  set("bfly-opt-stt", r.opt.sttSellPct);
  set("bfly-opt-ex-stt", r.opt.sttExercisePct);
  set("bfly-opt-txn", r.opt.txnPct);
  set("bfly-opt-stamp", r.opt.stampBuyPct);
  set("bfly-gst", r.gstPct);
  set("bfly-sebi", r.sebiPerCrore);
  set("bfly-slip", r.slippageInr);
  set("bfly-slip-spread", r.slipSpreadFrac);
  set("bfly-stale", r.staleMs);
  set("bfly-snap", r.snapMs);
  set("bfly-opt-spread", r.maxOptSpreadPct);
  set("bfly-lots", r.lots);
  if (bflyEl("bfly-include-ex")) bflyEl("bfly-include-ex").checked = Boolean(r.includeExerciseStt);
}

function bflyBook(token) {
  return bflyState.books[String(token)] || {
    ltp: 0, bid: 0, ask: 0, bid_qty: 0, ask_qty: 0, bid_depth: 0, ask_depth: 0, ts: 0,
  };
}

function bflyLookup(books, ...keys) {
  for (const key of keys) {
    if (key && books[key]) return books[key];
    if (key && books[String(key)]) return books[String(key)];
  }
  return null;
}

function bflyLegsOf(pair) {
  return [
    [pair.k1_ce_token, pair.k1_ce_key],
    [pair.k2_ce_token, pair.k2_ce_key],
    [pair.k3_ce_token, pair.k3_ce_key],
    [pair.k1_pe_token, pair.k1_pe_key],
    [pair.k2_pe_token, pair.k2_pe_key],
    [pair.k3_pe_token, pair.k3_pe_key],
  ].filter((row) => row[0]);
}

function applyBflyIncomingBooks(books, pairs, ts) {
  if (!books) return;
  for (const pair of pairs) {
    for (const [token, key] of bflyLegsOf(pair)) {
      const q = bflyLookup(books, key, token);
      if (!q) continue;
      const prev = bflyBook(token);
      const ltp = Number(q.last_price || q.ltp || q.close || 0);
      bflyState.books[String(token)] = {
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

function bflyExecPx(book, side, session) {
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

function paintBflyMode(session, method) {
  const box = bflyEl("bfly-mode");
  const label = bflyEl("bfly-mode-label");
  const reason = bflyEl("bfly-mode-reason");
  if (!box) return;
  box.className = `synth-mode ${session.live ? "synth-mode-live" : "synth-mode-ltp"}`;
  if (label) label.textContent = session.live ? "🟢 LIVE / EXECUTABLE" : "🟡 LTP / THEORETICAL";
  if (reason) reason.textContent = `${session.reason} · ${method.label} Confirmed butterfly credit is never labelled from LTP.`;
  const methodEl = bflyEl("bfly-method");
  if (methodEl) methodEl.textContent = `${method.label} · (B) buy K1/K3 ask · (S) sell 2× K2 bid`;
}

function bflySnapshotOk(books, rates, session) {
  if (!session.live) return { ok: true, reason: "" };
  const times = books.map((row) => Number(row.ts || 0));
  if (times.some((ts) => !ts)) return { ok: false, reason: "missing quote timestamp" };
  const age = Date.now() - Math.min(...times);
  const span = Math.max(...times) - Math.min(...times);
  if (age > rates.staleMs) return { ok: false, reason: "stale quotes" };
  if (span > rates.snapMs) return { ok: false, reason: "legs not from the same snapshot" };
  return { ok: true, reason: "" };
}

function bflySpreadPct(bid, ask) {
  if (!(bid > 0) || !(ask > 0)) return 0;
  return ((ask - bid) / ((ask + bid) / 2)) * 100;
}

function bflyCrossed(book) {
  return book.bid > 0 && book.ask > 0 && book.bid > book.ask;
}

function classifyBflyRow(row) {
  if (row.incomplete) return { status: "POTENTIAL", label: "🟡 POTENTIAL", reason: row.reasons[0] || "incomplete quotes" };
  if (!(row.net > 0)) return { status: "NO", label: "⚪ NO ARBITRAGE", reason: "net credit ≤ 0 after costs and slippage" };
  if (!row.live || row.usedLtp) return { status: "POTENTIAL", label: "🟡 POTENTIAL", reason: "LTP / theoretical only — not executable" };
  if (!row.executable) return { status: "POTENTIAL", label: "🟡 POTENTIAL", reason: row.reasons[0] || "not executable" };
  if (row.reasons.length) return { status: "POTENTIAL", label: "🟡 POTENTIAL", reason: row.reasons[0] };
  return { status: "CONFIRMED", label: "🟢 CONFIRMED ARBITRAGE", reason: "executable 1:-2:1 net credit after costs, slippage and liquidity" };
}

function evaluateBflySide(pair, session, rates, isCall) {
  const prefix = isCall ? "ce" : "pe";
  const k1Tok = pair[`k1_${prefix}_token`];
  const k2Tok = pair[`k2_${prefix}_token`];
  const k3Tok = pair[`k3_${prefix}_token`];
  if (!k1Tok || !k2Tok || !k3Tok) return null;

  const k1B = bflyBook(k1Tok);
  const k2B = bflyBook(k2Tok);
  const k3B = bflyBook(k3Tok);
  const lot = pair.lot_size || 1;
  const lots = rates.lots;
  const qty = lot * lots;
  const k1 = bflyExecPx(k1B, "ask", session);
  const k2 = bflyExecPx(k2B, "bid", session);
  const k3 = bflyExecPx(k3B, "ask", session);
  const type = isCall ? "CALL" : "PUT";
  const reasons = [];
  const incomplete = k1.missing || k2.missing || k3.missing;
  if (k1.missing) reasons.push(`missing K1 ${type} ask/LTP`);
  if (k2.missing) reasons.push(`missing K2 ${type} bid/LTP`);
  if (k3.missing) reasons.push(`missing K3 ${type} ask/LTP`);
  if (bflyCrossed(k1B) || bflyCrossed(k2B) || bflyCrossed(k3B)) reasons.push("crossed/invalid book");

  const width = CallArbCharges.butterflyWidth(pair.k1, pair.k2, pair.k3);
  const sanity = CallArbCharges.butterflyPayoffSanity(pair.k1, pair.k2, pair.k3);
  if (!(width > 0) || !sanity.ok) reasons.push("strikes are not equidistant / payoff not in [0, D]");

  const snap = bflySnapshotOk([k1B, k2B, k3B], rates, session);
  if (session.live && !snap.ok) reasons.push(snap.reason);

  const needK2 = qty * 2;
  const k1QtyOk = k1.qty >= qty;
  const k2QtyOk = k2.qty >= needK2;
  const k3QtyOk = k3.qty >= qty;
  const topOk = session.live && k1QtyOk && k2QtyOk && k3QtyOk;
  const depthOk = session.live
    && (k1.depth || k1.qty) >= qty
    && (k2.depth || k2.qty) >= needK2
    && (k3.depth || k3.qty) >= qty;
  if (session.live && !incomplete && !topOk) {
    reasons.push(depthOk
      ? `top-of-book qty below 1:${needK2 / lot}:${1} lots (depth may walk)`
      : `available qty below 1×/${2}×/1× of ${qty}`);
  }

  const spreads = [k1B, k2B, k3B].map((book) => bflySpreadPct(book.bid, book.ask));
  if (session.live && spreads.some((pctVal) => pctVal > rates.maxOptSpreadPct)) reasons.push("option spread too wide");

  const gross = incomplete || !(width > 0) ? 0 : CallArbCharges.butterflyGrossCredit(k1.price, k2.price, k3.price);
  const charges = incomplete
    ? { total: 0, legs: [] }
    : CallArbCharges.butterflyCharges({
      isCall,
      k1Px: k1.price,
      k2Px: k2.price,
      k3Px: k3.price,
      qty,
      rates,
    });
  const slipShare = CallArbCharges.butterflySlippagePerShare({
    k1Bid: k1B.bid || k1.price,
    k1Ask: k1B.ask || k1.price,
    k2Bid: k2B.bid || k2.price,
    k2Ask: k2B.ask || k2.price,
    k3Bid: k3B.bid || k3.price,
    k3Ask: k3B.ask || k3.price,
    rates,
  });
  const costShare = qty ? charges.total / qty : 0;
  const netShare = incomplete || !(width > 0) ? 0 : gross - costShare - slipShare;
  const netLot = netShare * lot;
  const net = netShare * qty;
  const minProfitShare = netShare;
  const maxProfitShare = netShare + width;
  const maxRiskShare = netShare > 0 ? 0 : Math.max(0, -netShare);
  const qAvail = Math.min(k1.qty || 0, Math.floor((k2.qty || 0) / 2), k3.qty || 0);
  const qLots = lot ? Math.floor(qAvail / lot) : 0;
  const marginKey = `bfly|${pair.exchange || "NSE"}|${pair.symbol}|${pair.expiry}|${type}|${pair.k1}|${pair.k2}|${pair.k3}|${qty}`;
  const liveMargin = bflyState.margins[marginKey];
  const margin = liveMargin && liveMargin.required > 0
    ? liveMargin
    : CallArbCharges.estimateButterflyMargins({
      k1: pair.k1,
      k2: pair.k2,
      k3: pair.k3,
      credit: netShare,
      lot,
      lots,
    });
  const romMin = margin.required > 0 && net > 0 ? (net / margin.required) * 100 : 0;
  const romMax = margin.required > 0 && maxProfitShare > 0 ? ((maxProfitShare * qty) / margin.required) * 100 : 0;
  const freshness = Math.min(Number(k1B.ts || 0), Number(k2B.ts || 0), Number(k3B.ts || 0));
  const executable = session.live && !incomplete && topOk && snap.ok && sanity.ok && width > 0
    && !bflyCrossed(k1B) && !bflyCrossed(k2B) && !bflyCrossed(k3B)
    && !k1.usedLtp && !k2.usedLtp && !k3.usedLtp;

  const row = {
    id: marginKey,
    pair,
    exchange: pair.exchange || "NSE",
    symbol: pair.symbol,
    expiry: pair.expiry,
    type,
    isCall,
    k1: pair.k1,
    k2: pair.k2,
    k3: pair.k3,
    width,
    lot,
    lots,
    qty,
    k1_symbol: pair[`k1_${prefix}_symbol`],
    k2_symbol: pair[`k2_${prefix}_symbol`],
    k3_symbol: pair[`k3_${prefix}_symbol`],
    k1Px: k1.price,
    k2Px: k2.price,
    k3Px: k3.price,
    gross,
    charges,
    costShare,
    slipShare,
    slipLot: slipShare * lot,
    netShare,
    netLot,
    net,
    minProfitShare,
    maxProfitShare,
    minProfitLot: minProfitShare * lot,
    maxProfitLot: maxProfitShare * lot,
    maxRiskShare,
    maxRiskLot: maxRiskShare * lot,
    qAvail,
    qLots,
    margin,
    rom: romMin,
    romMax,
    live: session.live,
    usedLtp: k1.usedLtp || k2.usedLtp || k3.usedLtp,
    incomplete,
    executable,
    sanity,
    reasons: [...new Set(reasons)],
    ts: { k1: k1B.ts, k2: k2B.ts, k3: k3B.ts },
    freshness,
    method: CallArbCharges.butterflyMethodology(),
  };
  const cls = classifyBflyRow(row);
  row.status = cls.status;
  row.statusLabel = cls.label;
  row.statusReason = cls.reason;
  return row;
}

function evaluateButterfly() {
  const session = nseSession();
  const rates = readBflyFormRates();
  const method = CallArbCharges.butterflyMethodology();
  paintBflyMode(session, method);
  const wantCe = bflyChecked("bfly-ce");
  const wantPe = bflyChecked("bfly-pe");
  const rows = [];
  for (const pair of bflyState.pairs) {
    if (wantCe) {
      const ce = evaluateBflySide(pair, session, rates, true);
      if (ce) rows.push(ce);
    }
    if (wantPe) {
      const pe = evaluateBflySide(pair, session, rates, false);
      if (pe) rows.push(pe);
    }
  }
  const rank = { CONFIRMED: 0, POTENTIAL: 1, NO: 2 };
  rows.sort((a, b) => {
    const rs = rank[a.status] - rank[b.status];
    if (rs) return rs;
    return (b.minProfitLot - a.minProfitLot)
      || (b.rom - a.rom)
      || (b.maxProfitLot - a.maxProfitLot)
      || (b.qAvail - a.qAvail)
      || (b.freshness - a.freshness)
      || a.symbol.localeCompare(b.symbol)
      || a.width - b.width
      || a.k1 - b.k1;
  });
  bflyState.rows = rows;
  return rows;
}

function visibleButterfly(rows) {
  const minNet = bflyNum("bfly-min-net", 0);
  const minRom = bflyNum("bfly-min-rom", 0);
  const minCredit = bflyNum("bfly-min-credit", 0);
  const showNo = bflyChecked("bfly-show-no");
  const q = String((bflyEl("bfly-filter") && bflyEl("bfly-filter").value) || "").trim().toUpperCase();
  return rows.filter((row) => {
    if (q && !row.symbol.includes(q) && !String(row.k1).includes(q) && !String(row.k2).includes(q) && !String(row.k3).includes(q) && !row.type.includes(q)) {
      return false;
    }
    if (row.incomplete) return showNo;
    if (row.status === "NO") return showNo && row.gross !== 0;
    if (row.netLot + 1e-9 < minNet) return false;
    if (row.rom + 1e-9 < minRom) return false;
    if (row.gross + 1e-9 < minCredit) return false;
    return true;
  });
}

function setButterflyStatus(text) {
  const el = bflyEl("bfly-status");
  if (el) el.textContent = `${text}${bflyState.source ? ` · ${bflyState.source}` : ""}`;
}

function bflySideMark(buy) {
  return `<span class="side-mark ${buy ? "side-buy" : "side-sell"}">${buy ? "(B)" : "(S)"}</span>`;
}

function bflyMoneySide(price, buy, incomplete) {
  if (incomplete || !(Number(price) > 0)) return "—";
  return `${money(price)} ${bflySideMark(buy)}`;
}

function bflyStrike(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return inr(x, Math.abs(x % 1) > 1e-9 ? 2 : 0);
}

function renderButterflyRows(rows) {
  const body = bflyEl("bfly-body");
  const empty = bflyEl("bfly-empty");
  if (!body) return;
  body.innerHTML = "";
  const visible = visibleButterfly(rows);
  const confirmed = rows.filter((row) => row.status === "CONFIRMED").length;
  if (bflyEl("opp-count") && state.tab === "butterfly") {
    bflyEl("opp-count").textContent = `${confirmed} confirmed / ${visible.length} shown`;
    bflyEl("stocks-scanned").textContent = String(new Set(bflyState.pairs.map((row) => row.symbol)).size);
  }
  if (!visible.length) {
    empty.classList.remove("hidden");
    empty.textContent = bflyState.pairs.length
      ? (nseSession().live
        ? "No executable same-expiry Call/Put butterfly with net credit after costs, slippage and filters."
        : "No theoretical LTP net credit after costs. Weekend/holiday rows are never CONFIRMED ARBITRAGE.")
      : "Connect Zerodha, then start the butterfly scanner.";
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
          <span class="stock-meta">${row.exchange} · ${row.type} 1:-2:1</span>
        </div>
      </td>
      <td>${fmtExpiryLong(row.expiry)}</td>
      <td>${row.type}</td>
      <td class="num">${bflyStrike(row.k1)}</td>
      <td class="num">${bflyStrike(row.k2)}</td>
      <td class="num">${bflyStrike(row.k3)}</td>
      <td class="num">${bflyStrike(row.width)}</td>
      <td class="num">${bflyMoneySide(row.k1Px, true, row.incomplete)}</td>
      <td class="num">${bflyMoneySide(row.k2Px, false, row.incomplete)}</td>
      <td class="num">${bflyMoneySide(row.k3Px, true, row.incomplete)}</td>
      <td class="num">${row.incomplete ? "—" : `${row.gross > 0 ? "+" : ""}${inr(row.gross)}`}</td>
      <td class="num">${row.incomplete ? "—" : money(row.charges.total)}</td>
      <td class="num">${row.incomplete ? "—" : money(row.slipLot)}</td>
      <td class="num ${row.netLot > 0 ? "signal-yes" : "signal-no"}">${row.incomplete ? "—" : money(row.netLot)}</td>
      <td class="num">${row.live && row.qLots ? `${row.qLots} lots` : inr(row.lot, 0)}</td>
      <td class="num">${row.incomplete ? "—" : money(row.minProfitLot)}</td>
      <td class="num">${row.incomplete ? "—" : money(row.maxProfitLot)}</td>
      <td class="num">${row.incomplete ? "—" : `${money(row.maxRiskLot)}${row.netShare > 0 ? "*" : ""}`}</td>
      <td class="num">${row.incomplete ? "—" : `${money(row.margin.required)}${row.margin.uncertain ? "*" : ""}`}</td>
      <td class="num">${row.incomplete || !(row.rom > 0) ? "—" : pct(row.rom)}</td>
      <td class="${row.status === "CONFIRMED" ? "signal-yes" : row.status === "NO" ? "signal-no-red" : "signal-no"}">${row.statusLabel}</td>
    `;
    tr.addEventListener("click", () => openButterflyDrawer(row));
    body.appendChild(tr);
  }
}

function bflyChargeLines(leg) {
  if (!leg) return "";
  return `${money(leg.total)} · brk ${money(leg.brokerage)} · STT ${money(leg.stt)} · txn ${money(leg.txn)} · GST ${money(leg.gst)} · SEBI ${money(leg.sebi)} · stamp ${money(leg.stamp)}`;
}

function openButterflyDrawer(row, opts = {}) {
  bflyState.selected = row.id;
  const drawer = bflyEl("drawer");
  drawer.classList.add("wide");
  bflyEl("d-symbol").textContent = `${row.symbol} ${bflyStrike(row.k1)}/${bflyStrike(row.k2)}/${bflyStrike(row.k3)} ${row.type} · ${row.statusLabel}`;
  bflyEl("d-name").textContent = `${row.exchange} ${row.type} butterfly · BUY 1 / SELL 2 / BUY 1`;
  const legs = row.charges.legs || [];
  const ts = (ms) => ms ? new Date(ms).toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" }) : "—";
  bflyEl("drawer-body").innerHTML = `
    <p class="badge ${row.status === "CONFIRMED" ? "net" : ""}">${row.statusLabel}</p>
    <p class="index-meta">${row.statusReason}</p>
    <div class="kv">
      ${kv("Exchange", row.exchange)}
      ${kv("Underlying", row.symbol)}
      ${kv("Expiry", fmtExpiryLong(row.expiry))}
      ${kv("Type", row.type)}
      ${kv("K1 / K2 / K3", `${bflyStrike(row.k1)} / ${bflyStrike(row.k2)} / ${bflyStrike(row.k3)}`)}
      ${kv("Strike width D", money(row.width))}
      ${kv("Lot × lots", `${row.lot} × ${row.lots} = ${row.qty} (middle ${row.qty * 2})`)}
      ${kv("Available qty", row.live ? `${row.qLots} lots (min of K1, K2/2, K3)` : "LTP — quantity not confirmed")}
      ${kv("Methodology", row.method.label)}
      ${kv("Mode", row.live ? "LIVE / EXECUTABLE" : "LTP / THEORETICAL")}
      ${kv("Payoff band", row.sanity && row.sanity.ok ? "long butterfly ∈ [0, D]" : "FAILED")}
    </div>
    <hr class="rule" />
    <div class="legs">
      <div class="leg"><em>BUY ${row.k1_symbol}</em><span>${row.qty} @ ${row.k1Px ? money(row.k1Px) : "—"} ask</span></div>
      <div class="leg"><em>SELL ${row.k2_symbol}</em><span>${row.qty * 2} @ ${row.k2Px ? money(row.k2Px) : "—"} bid</span></div>
      <div class="leg"><em>BUY ${row.k3_symbol}</em><span>${row.qty} @ ${row.k3Px ? money(row.k3Px) : "—"} ask</span></div>
    </div>
    <hr class="rule" />
    <div class="kv">
      ${kv("Gross credit / sh", row.incomplete ? "—" : money(row.gross))}
      ${kv("K1 charges (buy)", bflyChargeLines(legs[0]))}
      ${kv("K2 charges (sell 2×)", bflyChargeLines(legs[1]))}
      ${kv("K3 charges (buy)", bflyChargeLines(legs[2]))}
      ${kv("Total charges (3 orders)", money(row.charges.total || 0))}
      ${kv("Slippage / lot", money(row.slipLot))}
      ${kv("Net credit / share", money(row.netShare), row.netShare > 0 ? "net" : "")}
      ${kv("Net min profit / lot", money(row.minProfitLot), row.minProfitLot > 0 ? "net" : "")}
      ${kv("Net max profit / lot", money(row.maxProfitLot))}
      ${kv("Max expiry payoff loss / lot", `${money(row.maxRiskLot)}${row.netShare > 0 ? " *" : ""}`)}
      ${kv("Estimated margin *", money(row.margin.combined || row.margin.required || 0))}
      ${kv("Min profit / margin", row.rom ? pct(row.rom) : "—")}
      ${kv("Max profit / margin", row.romMax ? pct(row.romMax) : "—")}
      ${kv("Margin source", row.margin.uncertain ? `${row.margin.source} (estimated *)` : row.margin.source)}
      ${kv("K1 quote ts", ts(row.ts.k1))}
      ${kv("K2 quote ts", ts(row.ts.k2))}
      ${kv("K3 quote ts", ts(row.ts.k3))}
    </div>
    <p class="footnote">Identification only. No order is sent. A credit butterfly payoff is never negative, so maximum expiry payoff loss is ₹0* if net credit &gt; 0. That does not remove execution, settlement, assignment or operational risk. LTP is never used to confirm.</p>
  `;
  drawer.hidden = false;
  bflyEl("backdrop").hidden = false;
  if (opts.fetchMargin !== false) requestBflyMargin(row, Boolean(opts.forceMargin));
}

function refreshButterfly() {
  if (typeof state === "undefined" || state.tab !== "butterfly") return;
  const rows = evaluateButterfly();
  renderButterflyRows(rows);
  const now = new Date().toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" });
  if (bflyEl("last-update")) bflyEl("last-update").textContent = now;
  prefetchBflyMargins(rows);
}

let bflyPaint = 0;
function applyBflyTicks(ticks) {
  const now = Date.now();
  for (const tick of ticks) {
    bflyState.books[String(tick.instrument_token)] = {
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
  if (!bflyPaint) {
    bflyPaint = window.requestAnimationFrame(() => {
      bflyPaint = 0;
      refreshButterfly();
    });
  }
}

function fillBflyStockSelect(stocks) {
  const sel = bflyEl("bfly-stock");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">All F&amp;O + indexes</option>` + stocks
    .map((row) => `<option value="${row.symbol}">${row.index ? "IDX " : ""}${row.symbol}</option>`)
    .join("");
  if ([...sel.options].some((opt) => opt.value === current)) sel.value = current;
}

async function seedBflyMissingOptionBooks(pairs) {
  const keys = [...new Set(pairs.flatMap((row) => [
    row.k1_ce_key, row.k2_ce_key, row.k3_ce_key,
    row.k1_pe_key, row.k2_pe_key, row.k3_pe_key,
  ].filter(Boolean)))];
  const need = keys.filter((key) => {
    const pair = pairs.find((row) => [
      row.k1_ce_key, row.k2_ce_key, row.k3_ce_key,
      row.k1_pe_key, row.k2_pe_key, row.k3_pe_key,
    ].includes(key));
    if (!pair) return false;
    const token = [
      ["k1_ce_key", "k1_ce_token"], ["k2_ce_key", "k2_ce_token"], ["k3_ce_key", "k3_ce_token"],
      ["k1_pe_key", "k1_pe_token"], ["k2_pe_key", "k2_pe_token"], ["k3_pe_key", "k3_pe_token"],
    ].find(([field]) => pair[field] === key);
    const book = bflyBook(pair[token[1]]);
    return !(book.ltp > 0 || book.bid > 0 || book.ask > 0);
  });
  for (let i = 0; i < need.length; i += 40) {
    const chunk = need.slice(i, i + 40);
    setButterflyStatus(`Seeding option quotes… ${Math.min(i + chunk.length, need.length)}/${need.length}`);
    const data = await fetchJson(`/api/quotes?hist=false&keys=${encodeURIComponent(chunk.join(","))}`);
    applyBflyIncomingBooks(data.books || {}, pairs, Date.now());
    refreshButterfly();
  }
}

const bflyMarginInflight = new Set();

async function requestBflyMargin(row, force) {
  if (row.incomplete || !(row.qty > 0) || !row.k1_symbol || !row.k2_symbol || !row.k3_symbol) return;
  const key = row.id;
  const prev = bflyState.margins[key];
  if (!force && prev && Date.now() - prev.at < 60000) return;
  if (bflyMarginInflight.has(key)) return;
  bflyMarginInflight.add(key);
  try {
    const data = await fetchJson("/api/margins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orders: [
          { tradingsymbol: row.k1_symbol, transaction_type: "BUY", quantity: row.qty },
          { tradingsymbol: row.k2_symbol, transaction_type: "SELL", quantity: row.qty * 2 },
          { tradingsymbol: row.k3_symbol, transaction_type: "BUY", quantity: row.qty },
        ],
      }),
    });
    bflyState.margins[key] = {
      combined: Number(data.combined || 0),
      required: Number(data.required || 0),
      uncertain: data.uncertain !== false && !(Number(data.required) > 0),
      source: data.source || "kite-basket",
      at: Date.now(),
    };
    refreshButterfly();
    if (bflyState.selected === key) {
      const latest = bflyState.rows.find((item) => item.id === key);
      if (latest) openButterflyDrawer(latest, { fetchMargin: false });
    }
  } catch (_err) {
    bflyState.margins[key] = { ...(prev || {}), at: Date.now(), uncertain: true, source: "unavailable" };
  } finally {
    bflyMarginInflight.delete(key);
  }
}

let bflyMarginQueue = Promise.resolve();
function prefetchBflyMargins(rows) {
  const session = nseSession();
  const candidates = rows.filter((row) => !row.incomplete && row.net > 0).slice(0, session.live ? 8 : 4);
  for (const row of candidates) {
    bflyMarginQueue = bflyMarginQueue.then(() => requestBflyMargin(row, false)).catch(() => {});
  }
}

async function startButterflyScanner() {
  if (!state.connected) {
    setButterflyStatus("Connect Zerodha first.");
    return;
  }
  if (typeof stopSynthScanner === "function") stopSynthScanner();
  if (typeof stopCallArbScanner === "function") stopCallArbScanner();
  if (typeof stopPutArbScanner === "function") stopPutArbScanner();
  if (typeof stopBoxArbScanner === "function") stopBoxArbScanner();
  if (typeof stopVertCeScanner === "function") stopVertCeScanner();
  if (typeof stopVertPeScanner === "function") stopVertPeScanner();
  if (typeof stopSilverArbScanner === "function") stopSilverArbScanner();
  if (typeof stopOptionRvScanner === "function") stopOptionRvScanner();
  persistBflyRates();
  const btn = bflyEl("bfly-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Starting…";
  }
  try {
    const expiry = (bflyEl("bfly-expiry") && bflyEl("bfly-expiry").value) || "nearest";
    const symbol = (bflyEl("bfly-stock") && bflyEl("bfly-stock").value) || "";
    const band = bflyNum("bfly-band", 6);
    const maxStrikes = bflyNum("bfly-max-strikes", symbol ? 21 : 5);
    const snapshot = await fetchJson(
      `/api/butterfly-arb?seed=true&expiry=${encodeURIComponent(expiry)}&symbol=${encodeURIComponent(symbol)}&band=${encodeURIComponent(band)}&max_strikes=${encodeURIComponent(maxStrikes)}`,
    );
    bflyState.pairs = snapshot.pairs || [];
    bflyState.books = snapshot.books || {};
    bflyState.stocks = snapshot.stocks || [];
    bflyState.started = true;
    state.connected = Boolean(snapshot.connected);
    setPill(state.connected);
    fillBflyStockSelect(bflyState.stocks);
    const bar = bflyEl("alert-bar");
    if (bar && (snapshot.message || snapshot.error)) {
      bar.classList.remove("hidden");
      bar.textContent = snapshot.message || snapshot.error;
    }
    refreshButterfly();
    setButterflyStatus("Seeding option quotes…");
    await seedBflyMissingOptionBooks(bflyState.pairs);

    if (bflyState.ticker) {
      bflyState.ticker.close();
      bflyState.ticker = null;
    }
    const creds = await fetchJson("/api/ticker");
    if (creds.ws_url && bflyState.pairs.length) {
      bflyState.source = "Kite WebSocket";
      setButterflyStatus("Connecting ticker…");
      bflyState.ticker = connectKiteTicker({
        wsUrl: creds.ws_url,
        tokens: snapshot.tokens || [],
        onTicks: applyBflyTicks,
        onStatus: setButterflyStatus,
      });
    } else {
      bflyState.source = "REST quotes";
      setButterflyStatus(creds.error || "WebSocket unavailable — snapshot quotes only.");
    }
    refreshButterfly();
  } catch (error) {
    setButterflyStatus(error.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Start scanner";
    }
  }
}

function stopButterflyScanner() {
  if (bflyState.ticker) bflyState.ticker.close();
  bflyState.ticker = null;
  bflyState.started = false;
  setButterflyStatus("Stopped");
}

window.setInterval(() => {
  if (typeof state !== "undefined" && state.tab === "butterfly") refreshButterfly();
}, 30000);

window.startButterflyScanner = startButterflyScanner;
window.stopButterflyScanner = stopButterflyScanner;
window.refreshButterfly = refreshButterfly;
window.fillButterflyRates = fillBflyRateForm;
window.persistButterflyRates = persistBflyRates;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => fillBflyRateForm(readBflyStoredRates()));
} else {
  fillBflyRateForm(readBflyStoredRates());
}
