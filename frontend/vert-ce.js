const VCE_RATES_KEY = "vert_ce_rates_v1";

const vceState = {
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

function vceEl(id) {
  return document.getElementById(id);
}

function vceNum(id, fallback) {
  const value = Number(vceEl(id) && vceEl(id).value);
  return Number.isFinite(value) ? value : fallback;
}

function vceChecked(id) {
  return Boolean(vceEl(id) && vceEl(id).checked);
}

function readVceStoredRates() {
  try {
    return CallArbCharges.mergeRates(JSON.parse(localStorage.getItem(VCE_RATES_KEY) || "{}"));
  } catch (_err) {
    return CallArbCharges.mergeRates();
  }
}

function readVceFormRates() {
  const stored = readVceStoredRates();
  return CallArbCharges.mergeRates({
    ...stored,
    opt: {
      brokerage: vceNum("vce-opt-brok", stored.opt.brokerage),
      sttSellPct: vceNum("vce-opt-stt", stored.opt.sttSellPct),
      sttExercisePct: vceNum("vce-opt-ex-stt", stored.opt.sttExercisePct),
      txnPct: vceNum("vce-opt-txn", stored.opt.txnPct),
      stampBuyPct: vceNum("vce-opt-stamp", stored.opt.stampBuyPct),
    },
    gstPct: vceNum("vce-gst", stored.gstPct),
    sebiPerCrore: vceNum("vce-sebi", stored.sebiPerCrore),
    includeExerciseStt: vceChecked("vce-include-ex"),
    slippageInr: vceNum("vce-slip", stored.slippageInr),
    slipSpreadFrac: vceNum("vce-slip-spread", stored.slipSpreadFrac),
    staleMs: vceNum("vce-stale", stored.staleMs),
    snapMs: vceNum("vce-snap", stored.snapMs),
    maxOptSpreadPct: vceNum("vce-opt-spread", stored.maxOptSpreadPct),
    lots: Math.max(1, Math.round(vceNum("vce-lots", stored.lots) || 1)),
  });
}

function persistVceRates() {
  localStorage.setItem(VCE_RATES_KEY, JSON.stringify(readVceFormRates()));
}

function fillVceRateForm(rates) {
  const r = CallArbCharges.mergeRates(rates);
  const set = (id, value) => {
    if (vceEl(id)) vceEl(id).value = value;
  };
  set("vce-opt-brok", r.opt.brokerage);
  set("vce-opt-stt", r.opt.sttSellPct);
  set("vce-opt-ex-stt", r.opt.sttExercisePct);
  set("vce-opt-txn", r.opt.txnPct);
  set("vce-opt-stamp", r.opt.stampBuyPct);
  set("vce-gst", r.gstPct);
  set("vce-sebi", r.sebiPerCrore);
  set("vce-slip", r.slippageInr);
  set("vce-slip-spread", r.slipSpreadFrac);
  set("vce-stale", r.staleMs);
  set("vce-snap", r.snapMs);
  set("vce-opt-spread", r.maxOptSpreadPct);
  set("vce-lots", r.lots);
  if (vceEl("vce-include-ex")) vceEl("vce-include-ex").checked = Boolean(r.includeExerciseStt);
}

function vceBook(token) {
  return vceState.books[String(token)] || {
    ltp: 0, bid: 0, ask: 0, bid_qty: 0, ask_qty: 0, bid_depth: 0, ask_depth: 0, ts: 0,
  };
}

function vceLookup(books, ...keys) {
  for (const key of keys) {
    if (key && books[key]) return books[key];
    if (key && books[String(key)]) return books[String(key)];
  }
  return null;
}

function vceLegsOf(pair) {
  return [
    [pair.k1_ce_token, pair.k1_ce_key],
    [pair.k2_ce_token, pair.k2_ce_key],
  ];
}

function applyVceIncomingBooks(books, pairs, ts) {
  if (!books) return;
  for (const pair of pairs) {
    for (const [token, key] of vceLegsOf(pair)) {
      const q = vceLookup(books, key, token);
      if (!q) continue;
      const prev = vceBook(token);
      const ltp = Number(q.last_price || q.ltp || 0);
      vceState.books[String(token)] = {
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

function vceExecPx(book, side, session) {
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

function paintVceMode(session, method) {
  const box = vceEl("vce-mode");
  const label = vceEl("vce-mode-label");
  const reason = vceEl("vce-mode-reason");
  if (!box) return;
  box.className = `synth-mode ${session.live ? "synth-mode-live" : "synth-mode-ltp"}`;
  if (label) label.textContent = session.live ? "🟢 LIVE / EXECUTABLE" : "🟡 LTP / THEORETICAL";
  if (reason) reason.textContent = `${session.reason} · ${method.label} Confirmed arbitrage is never labelled from LTP.`;
  const methodEl = vceEl("vce-method");
  if (methodEl) methodEl.textContent = `${method.label} · (S) sell K1 CE · (B) buy K2 CE`;
}

function vceSnapshotOk(books, rates, session) {
  if (!session.live) return { ok: true, reason: "" };
  const times = books.map((row) => Number(row.ts || 0));
  if (times.some((ts) => !ts)) return { ok: false, reason: "missing quote timestamp" };
  const age = Date.now() - Math.min(...times);
  const span = Math.max(...times) - Math.min(...times);
  if (age > rates.staleMs) return { ok: false, reason: "stale quotes" };
  if (span > rates.snapMs) return { ok: false, reason: "legs not from the same snapshot" };
  return { ok: true, reason: "" };
}

function vceSpreadPct(bid, ask) {
  if (!(bid > 0) || !(ask > 0)) return 0;
  return ((ask - bid) / ((ask + bid) / 2)) * 100;
}

function vceCrossed(book) {
  return book.bid > 0 && book.ask > 0 && book.bid > book.ask;
}

function classifyVceRow(row) {
  if (row.incomplete) return { status: "POTENTIAL", label: "🟡 POTENTIAL", reason: row.reasons[0] || "incomplete quotes" };
  if (!(row.net > 0)) return { status: "NO", label: "🔴 NO ARBITRAGE", reason: "net profit ≤ 0 after costs and slippage" };
  if (!row.live) return { status: "POTENTIAL", label: "🟡 POTENTIAL", reason: "LTP / theoretical only — not executable" };
  if (!row.executable) return { status: "POTENTIAL", label: "🟡 POTENTIAL", reason: row.reasons[0] || "not executable" };
  if (row.reasons.length) return { status: "POTENTIAL", label: "🟡 POTENTIAL", reason: row.reasons[0] };
  return { status: "CONFIRMED", label: "🟢 CONFIRMED ARBITRAGE", reason: "executable after costs, slippage and liquidity" };
}

function evaluateVcePair(pair, session, rates) {
  const k1CeB = vceBook(pair.k1_ce_token);
  const k2CeB = vceBook(pair.k2_ce_token);
  const lot = pair.lot_size || 1;
  const lots = rates.lots;
  const qty = lot * lots;
  const k1Ce = vceExecPx(k1CeB, "bid", session);
  const k2Ce = vceExecPx(k2CeB, "ask", session);
  const reasons = [];
  const incomplete = k1Ce.missing || k2Ce.missing;
  if (k1Ce.missing) reasons.push("missing K1 Call bid/LTP");
  if (k2Ce.missing) reasons.push("missing K2 Call ask/LTP");
  if (vceCrossed(k1CeB) || vceCrossed(k2CeB)) reasons.push("crossed/invalid book");

  const sanity = CallArbCharges.callVerticalSanity(pair.k1, pair.k2);
  if (!sanity.ok) reasons.push("call-spread payoff cap failed");

  const snap = vceSnapshotOk([k1CeB, k2CeB], rates, session);
  if (session.live && !snap.ok) reasons.push(snap.reason);

  const quotes = [k1Ce, k2Ce];
  const topOk = session.live && quotes.every((row) => row.qty >= qty);
  const depthOk = session.live && quotes.every((row) => (row.depth || row.qty) >= qty);
  if (session.live && !incomplete && !topOk) {
    reasons.push(depthOk
      ? `top-of-book qty below ${qty} (depth may walk)`
      : `available qty below ${qty}`);
  }

  const spreads = [k1CeB, k2CeB].map((book) => vceSpreadPct(book.bid, book.ask));
  if (session.live && spreads.some((pct) => pct > rates.maxOptSpreadPct)) reasons.push("option spread too wide");

  const width = CallArbCharges.boxPayoff(pair.k1, pair.k2);
  const credit = incomplete ? 0 : CallArbCharges.callVerticalCredit(k1Ce.price, k2Ce.price);
  const gross = incomplete || !sanity.ok ? 0 : credit - width;
  const charges = incomplete
    ? { total: 0, legs: [] }
    : CallArbCharges.twoLegCallVerticalCharges({
      k1Ce: k1Ce.price,
      k2Ce: k2Ce.price,
      qty,
      rates,
    });
  const slipShare = CallArbCharges.verticalSlippagePerShare({
    k1Bid: k1CeB.bid || k1Ce.price,
    k1Ask: k1CeB.ask || k1Ce.price,
    k2Bid: k2CeB.bid || k2Ce.price,
    k2Ask: k2CeB.ask || k2Ce.price,
    rates,
  });
  const costShare = qty ? charges.total / qty : 0;
  const netShare = incomplete || !sanity.ok ? 0 : gross - costShare - slipShare;
  const netLot = netShare * lot;
  const net = netShare * qty;
  const marginKey = `vce|${pair.symbol}|${pair.expiry}|${pair.k1}|${pair.k2}|${qty}`;
  const liveMargin = vceState.margins[marginKey];
  const margin = liveMargin && liveMargin.required > 0
    ? liveMargin
    : CallArbCharges.estimateCallVerticalMargins({
      k1: pair.k1,
      k2: pair.k2,
      k1Ce: k1Ce.price,
      k2Ce: k2Ce.price,
      lot,
      lots,
    });
  if (!liveMargin || liveMargin.uncertain || !(margin.required > 0)) {
    if (gross > 0) reasons.push(margin.source === "kite-basket" ? "margin incomplete" : "margin estimated / uncertain");
  }
  const rom = margin.required > 0 && net > 0 ? (net / margin.required) * 100 : 0;
  const executable = session.live && !incomplete && topOk && snap.ok && sanity.ok
    && !vceCrossed(k1CeB) && !vceCrossed(k2CeB);

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
    sideLabel: "SHORT CALL SPREAD · SELL K1 CE / BUY K2 CE",
    k1_ce_symbol: pair.k1_ce_symbol,
    k2_ce_symbol: pair.k2_ce_symbol,
    k1Ce: k1Ce.price,
    k2Ce: k2Ce.price,
    credit,
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
    usedLtp: quotes.some((item) => item.usedLtp),
    incomplete,
    executable,
    sanity,
    reasons: [...new Set(reasons)],
    ts: { k1Ce: k1CeB.ts, k2Ce: k2CeB.ts },
    method: CallArbCharges.callVerticalMethodology(),
  };
  const cls = classifyVceRow(row);
  row.status = cls.status;
  row.statusLabel = cls.label;
  row.statusReason = cls.reason;
  return row;
}

function evaluateVertCe() {
  const session = nseSession();
  const rates = readVceFormRates();
  const method = CallArbCharges.callVerticalMethodology();
  paintVceMode(session, method);
  const rows = vceState.pairs.map((pair) => evaluateVcePair(pair, session, rates));
  const rank = { CONFIRMED: 0, POTENTIAL: 1, NO: 2 };
  rows.sort((a, b) => {
    const rs = rank[a.status] - rank[b.status];
    if (rs) return rs;
    return (b.rom - a.rom) || (b.net - a.net) || a.symbol.localeCompare(b.symbol) || a.width - b.width;
  });
  vceState.rows = rows;
  return rows;
}

function visibleVertCe(rows) {
  const minNet = vceNum("vce-min-net", 0);
  const minRom = vceNum("vce-min-rom", 0);
  const minEdge = vceNum("vce-min-edge", 0);
  const showNo = vceChecked("vce-show-no");
  const q = String((vceEl("vce-filter") && vceEl("vce-filter").value) || "").trim().toUpperCase();
  return rows.filter((row) => {
    if (q && !row.symbol.includes(q) && !String(row.k1).includes(q) && !String(row.k2).includes(q)) return false;
    if (row.incomplete) return showNo;
    if (row.status === "NO") return showNo && row.gross !== 0;
    if (row.netLot + 1e-9 < minNet) return false;
    if (row.rom + 1e-9 < minRom) return false;
    if (row.gross + 1e-9 < minEdge) return false;
    return true;
  });
}

function setVertCeStatus(text) {
  const el = vceEl("vce-status");
  if (el) el.textContent = `${text}${vceState.source ? ` · ${vceState.source}` : ""}`;
}

function vceSideMark(buy) {
  return `<span class="side-mark ${buy ? "side-buy" : "side-sell"}">${buy ? "(B)" : "(S)"}</span>`;
}

function vceMoneySide(price, buy, incomplete) {
  if (incomplete || !(Number(price) > 0)) return "—";
  return `${money(price)} ${vceSideMark(buy)}`;
}

function vceStrike(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return inr(x, Math.abs(x % 1) > 1e-9 ? 2 : 0);
}

function renderVertCeRows(rows) {
  const body = vceEl("vce-body");
  const empty = vceEl("vce-empty");
  if (!body) return;
  body.innerHTML = "";
  const visible = visibleVertCe(rows);
  const confirmed = rows.filter((row) => row.status === "CONFIRMED").length;
  if (vceEl("opp-count") && state.tab === "vertce") {
    vceEl("opp-count").textContent = `${confirmed} confirmed / ${visible.length} shown`;
    vceEl("stocks-scanned").textContent = String(new Set(vceState.pairs.map((row) => row.symbol)).size);
  }
  if (!visible.length) {
    empty.classList.remove("hidden");
    empty.textContent = vceState.pairs.length
      ? (nseSession().live
        ? "No executable same-expiry Call vertical after costs, slippage and filters."
        : "No theoretical LTP edge after costs. Weekend/holiday rows are never CONFIRMED ARBITRAGE.")
      : "Connect Zerodha, then start the Call vertical scanner.";
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
          <span class="stock-meta">short CE spread</span>
        </div>
      </td>
      <td>${fmtExpiryLong(row.expiry)}</td>
      <td class="num">${vceStrike(row.k1)}</td>
      <td class="num">${vceStrike(row.k2)}</td>
      <td class="num">${vceStrike(row.width)}</td>
      <td class="num">${vceMoneySide(row.k1Ce, false, row.incomplete)}</td>
      <td class="num">${vceMoneySide(row.k2Ce, true, row.incomplete)}</td>
      <td class="num">${row.incomplete ? "—" : money(row.credit)}</td>
      <td class="num">${vceStrike(row.width)}</td>
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
    tr.addEventListener("click", () => openVertCeDrawer(row));
    body.appendChild(tr);
  }
}

function vceChargeLines(leg) {
  if (!leg) return "";
  return `${money(leg.total)} · brk ${money(leg.brokerage)} · STT ${money(leg.stt)} · txn ${money(leg.txn)} · GST ${money(leg.gst)} · SEBI ${money(leg.sebi)} · stamp ${money(leg.stamp)}`;
}

function openVertCeDrawer(row, opts = {}) {
  vceState.selected = row.id;
  const drawer = vceEl("drawer");
  drawer.classList.add("wide");
  vceEl("d-symbol").textContent = `${row.symbol} ${vceStrike(row.k1)}/${vceStrike(row.k2)} · ${row.statusLabel}`;
  vceEl("d-name").textContent = row.sideLabel;
  const legs = row.charges.legs || [];
  const ts = (ms) => ms ? new Date(ms).toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" }) : "—";
  vceEl("drawer-body").innerHTML = `
    <p class="badge ${row.status === "CONFIRMED" ? "net" : ""}">${row.statusLabel}</p>
    <p class="index-meta">${row.statusReason}</p>
    <div class="kv">
      ${kv("Stock", row.symbol)}
      ${kv("Expiry", fmtExpiryLong(row.expiry))}
      ${kv("Lower K1", money(row.k1))}
      ${kv("Higher K2", money(row.k2))}
      ${kv("Strike width / max payoff", money(row.width))}
      ${kv("Lot × lots", `${row.lot} × ${row.lots} = ${row.qty}`)}
      ${kv("Methodology", row.method.label)}
      ${kv("Mode", row.live ? "LIVE / EXECUTABLE" : "LTP / THEORETICAL")}
      ${kv("Payoff cap", row.sanity && row.sanity.ok ? "Call spread ≤ K2 − K1" : "FAILED")}
    </div>
    <hr class="rule" />
    <div class="legs">
      <div class="leg"><em>SELL ${row.k1_ce_symbol}</em><span>${row.qty} @ ${row.k1Ce ? money(row.k1Ce) : "—"}</span></div>
      <div class="leg"><em>BUY ${row.k2_ce_symbol}</em><span>${row.qty} @ ${row.k2Ce ? money(row.k2Ce) : "—"}</span></div>
    </div>
    <hr class="rule" />
    <div class="kv">
      ${kv("Net credit (K1 bid − K2 ask)", row.incomplete ? "—" : money(row.credit))}
      ${kv("Max payoff K2 − K1", money(row.width))}
      ${kv("Gross edge / sh", row.incomplete ? "—" : money(row.gross))}
      ${kv("Gross / lot", row.incomplete ? "—" : money(row.gross * row.lot))}
      ${kv("K1 CE charges (sell)", vceChargeLines(legs[0]))}
      ${kv("K2 CE charges (buy)", vceChargeLines(legs[1]))}
      ${kv("Total charges (2 option legs)", money(row.charges.total || 0))}
      ${kv("Slippage / lot", money(row.slipLot))}
      ${kv("Net / share", money(row.netShare), row.netShare > 0 ? "net" : "")}
      ${kv("Net / lot", money(row.netLot), row.netLot > 0 ? "net" : "")}
      ${kv("Net (all lots)", money(row.net), row.net > 0 ? "net" : "")}
      ${kv("Combined margin", money(row.margin.combined || row.margin.required || 0))}
      ${kv("Final required margin", money(row.margin.required || 0))}
      ${kv("Return on margin", row.rom ? pct(row.rom) : "—")}
      ${kv("Margin source", row.margin.uncertain ? `${row.margin.source} (uncertain → not confirmed)` : row.margin.source)}
      ${kv("K1 CE quote ts", ts(row.ts.k1Ce))}
      ${kv("K2 CE quote ts", ts(row.ts.k2Ce))}
    </div>
    <p class="footnote">Identification only. No order is sent. Two option legs only — not the three-leg synthetic cost model.</p>
  `;
  drawer.hidden = false;
  vceEl("backdrop").hidden = false;
  if (opts.fetchMargin !== false) requestVceMargin(row, Boolean(opts.forceMargin));
}

function refreshVertCe() {
  if (typeof state === "undefined" || state.tab !== "vertce") return;
  const rows = evaluateVertCe();
  renderVertCeRows(rows);
  const now = new Date().toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" });
  if (vceEl("last-update")) vceEl("last-update").textContent = now;
  prefetchVceMargins(rows);
}

let vcePaint = 0;
function applyVertCeTicks(ticks) {
  const now = Date.now();
  for (const tick of ticks) {
    vceState.books[String(tick.instrument_token)] = {
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
  if (!vcePaint) {
    vcePaint = window.requestAnimationFrame(() => {
      vcePaint = 0;
      refreshVertCe();
    });
  }
}

function fillVceStockSelect(stocks) {
  const sel = vceEl("vce-stock");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">All F&O stocks</option>` + stocks
    .map((row) => `<option value="${row.symbol}">${row.symbol}</option>`)
    .join("");
  if ([...sel.options].some((opt) => opt.value === current)) sel.value = current;
}

async function seedVceMissingOptionBooks(pairs) {
  const keys = [...new Set(pairs.flatMap((row) => [row.k1_ce_key, row.k2_ce_key]))];
  const need = keys.filter((key) => {
    const pair = pairs.find((row) => row.k1_ce_key === key || row.k2_ce_key === key);
    if (!pair) return false;
    const token = key === pair.k1_ce_key ? pair.k1_ce_token : pair.k2_ce_token;
    const book = vceBook(token);
    return !(book.ltp > 0 || book.bid > 0 || book.ask > 0);
  });
  for (let i = 0; i < need.length; i += 40) {
    const chunk = need.slice(i, i + 40);
    setVertCeStatus(`Seeding Call quotes… ${Math.min(i + chunk.length, need.length)}/${need.length}`);
    const data = await fetchJson(`/api/quotes?hist=false&keys=${encodeURIComponent(chunk.join(","))}`);
    applyVceIncomingBooks(data.books || {}, pairs, Date.now());
    refreshVertCe();
  }
}

const vceMarginInflight = new Set();

async function requestVceMargin(row, force) {
  if (row.incomplete || !(row.qty > 0)) return;
  const key = row.id;
  const prev = vceState.margins[key];
  if (!force && prev && Date.now() - prev.at < 60000) return;
  if (vceMarginInflight.has(key)) return;
  vceMarginInflight.add(key);
  try {
    const data = await fetchJson("/api/margins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orders: [
          { tradingsymbol: row.k1_ce_symbol, transaction_type: "SELL", quantity: row.qty },
          { tradingsymbol: row.k2_ce_symbol, transaction_type: "BUY", quantity: row.qty },
        ],
      }),
    });
    vceState.margins[key] = {
      combined: Number(data.combined || 0),
      required: Number(data.required || 0),
      uncertain: data.uncertain !== false && !(Number(data.required) > 0),
      source: data.source || "kite",
      at: Date.now(),
    };
    refreshVertCe();
    if (vceState.selected === key) {
      const latest = vceState.rows.find((item) => item.id === key);
      if (latest) openVertCeDrawer(latest, { fetchMargin: false });
    }
  } catch (_err) {
    vceState.margins[key] = { ...(prev || {}), at: Date.now(), uncertain: true, source: "unavailable" };
  } finally {
    vceMarginInflight.delete(key);
  }
}

let vceMarginQueue = Promise.resolve();
function prefetchVceMargins(rows) {
  const session = nseSession();
  const candidates = rows.filter((row) => !row.incomplete && row.net > 0).slice(0, session.live ? 8 : 4);
  for (const row of candidates) {
    vceMarginQueue = vceMarginQueue.then(() => requestVceMargin(row, false)).catch(() => {});
  }
}

async function startVertCeScanner() {
  if (!state.connected) {
    setVertCeStatus("Connect Zerodha first.");
    return;
  }
  if (typeof stopSynthScanner === "function") stopSynthScanner();
  if (typeof stopCallArbScanner === "function") stopCallArbScanner();
  if (typeof stopPutArbScanner === "function") stopPutArbScanner();
  if (typeof stopBoxArbScanner === "function") stopBoxArbScanner();
  if (typeof stopVertPeScanner === "function") stopVertPeScanner();
  if (typeof stopSilverArbScanner === "function") stopSilverArbScanner();
  if (typeof stopOptionRvScanner === "function") stopOptionRvScanner();
  if (typeof stopButterflyScanner === "function") stopButterflyScanner();
  persistVceRates();
  const btn = vceEl("vce-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Starting…";
  }
  try {
    const expiry = (vceEl("vce-expiry") && vceEl("vce-expiry").value) || "nearest";
    const symbol = (vceEl("vce-stock") && vceEl("vce-stock").value) || "";
    const band = vceNum("vce-band", 6);
    const maxStrikes = vceNum("vce-max-strikes", symbol ? 40 : 5);
    const snapshot = await fetchJson(
      `/api/vert-ce?seed=true&expiry=${encodeURIComponent(expiry)}&symbol=${encodeURIComponent(symbol)}&band=${encodeURIComponent(band)}&max_strikes=${encodeURIComponent(maxStrikes)}`,
    );
    vceState.pairs = snapshot.pairs || [];
    vceState.books = snapshot.books || {};
    vceState.stocks = snapshot.stocks || [];
    vceState.started = true;
    state.connected = Boolean(snapshot.connected);
    setPill(state.connected);
    fillVceStockSelect(vceState.stocks);
    const bar = vceEl("alert-bar");
    if (bar && (snapshot.message || snapshot.error)) {
      bar.classList.remove("hidden");
      bar.textContent = snapshot.message || snapshot.error;
    }
    refreshVertCe();
    setVertCeStatus("Seeding Call quotes…");
    await seedVceMissingOptionBooks(vceState.pairs);

    if (vceState.ticker) {
      vceState.ticker.close();
      vceState.ticker = null;
    }
    const creds = await fetchJson("/api/ticker");
    if (creds.ws_url && vceState.pairs.length) {
      vceState.source = "Kite WebSocket";
      setVertCeStatus("Connecting ticker…");
      vceState.ticker = connectKiteTicker({
        wsUrl: creds.ws_url,
        tokens: snapshot.tokens || [],
        onTicks: applyVertCeTicks,
        onStatus: setVertCeStatus,
      });
    } else {
      vceState.source = "REST quotes";
      setVertCeStatus(creds.error || "WebSocket unavailable — snapshot quotes only.");
    }
    refreshVertCe();
  } catch (error) {
    setVertCeStatus(error.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Start scanner";
    }
  }
}

function stopVertCeScanner() {
  if (vceState.ticker) vceState.ticker.close();
  vceState.ticker = null;
  vceState.started = false;
  setVertCeStatus("Stopped");
}

window.setInterval(() => {
  if (typeof state !== "undefined" && state.tab === "vertce") refreshVertCe();
}, 30000);

window.startVertCeScanner = startVertCeScanner;
window.stopVertCeScanner = stopVertCeScanner;
window.refreshVertCe = refreshVertCe;
window.fillVertCeRates = fillVceRateForm;
window.persistVertCeRates = persistVceRates;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => fillVceRateForm(readVceStoredRates()));
} else {
  fillVceRateForm(readVceStoredRates());
}
