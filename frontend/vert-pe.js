const VPE_RATES_KEY = "vert_pe_rates_v1";

const vpeState = {
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

function vpeEl(id) {
  return document.getElementById(id);
}

function vpeNum(id, fallback) {
  const value = Number(vpeEl(id) && vpeEl(id).value);
  return Number.isFinite(value) ? value : fallback;
}

function vpeChecked(id) {
  return Boolean(vpeEl(id) && vpeEl(id).checked);
}

function readVpeStoredRates() {
  try {
    return CallArbCharges.mergeRates(JSON.parse(localStorage.getItem(VPE_RATES_KEY) || "{}"));
  } catch (_err) {
    return CallArbCharges.mergeRates();
  }
}

function readVpeFormRates() {
  const stored = readVpeStoredRates();
  return CallArbCharges.mergeRates({
    ...stored,
    opt: {
      brokerage: vpeNum("vpe-opt-brok", stored.opt.brokerage),
      sttSellPct: vpeNum("vpe-opt-stt", stored.opt.sttSellPct),
      sttExercisePct: vpeNum("vpe-opt-ex-stt", stored.opt.sttExercisePct),
      txnPct: vpeNum("vpe-opt-txn", stored.opt.txnPct),
      stampBuyPct: vpeNum("vpe-opt-stamp", stored.opt.stampBuyPct),
    },
    gstPct: vpeNum("vpe-gst", stored.gstPct),
    sebiPerCrore: vpeNum("vpe-sebi", stored.sebiPerCrore),
    includeExerciseStt: vpeChecked("vpe-include-ex"),
    slippageInr: vpeNum("vpe-slip", stored.slippageInr),
    slipSpreadFrac: vpeNum("vpe-slip-spread", stored.slipSpreadFrac),
    staleMs: vpeNum("vpe-stale", stored.staleMs),
    snapMs: vpeNum("vpe-snap", stored.snapMs),
    maxOptSpreadPct: vpeNum("vpe-opt-spread", stored.maxOptSpreadPct),
    lots: Math.max(1, Math.round(vpeNum("vpe-lots", stored.lots) || 1)),
  });
}

function persistVpeRates() {
  localStorage.setItem(VPE_RATES_KEY, JSON.stringify(readVpeFormRates()));
}

function fillVpeRateForm(rates) {
  const r = CallArbCharges.mergeRates(rates);
  const set = (id, value) => {
    if (vpeEl(id)) vpeEl(id).value = value;
  };
  set("vpe-opt-brok", r.opt.brokerage);
  set("vpe-opt-stt", r.opt.sttSellPct);
  set("vpe-opt-ex-stt", r.opt.sttExercisePct);
  set("vpe-opt-txn", r.opt.txnPct);
  set("vpe-opt-stamp", r.opt.stampBuyPct);
  set("vpe-gst", r.gstPct);
  set("vpe-sebi", r.sebiPerCrore);
  set("vpe-slip", r.slippageInr);
  set("vpe-slip-spread", r.slipSpreadFrac);
  set("vpe-stale", r.staleMs);
  set("vpe-snap", r.snapMs);
  set("vpe-opt-spread", r.maxOptSpreadPct);
  set("vpe-lots", r.lots);
  if (vpeEl("vpe-include-ex")) vpeEl("vpe-include-ex").checked = Boolean(r.includeExerciseStt);
}

function vpeBook(token) {
  return vpeState.books[String(token)] || {
    ltp: 0, bid: 0, ask: 0, bid_qty: 0, ask_qty: 0, bid_depth: 0, ask_depth: 0, ts: 0,
  };
}

function vpeLookup(books, ...keys) {
  for (const key of keys) {
    if (key && books[key]) return books[key];
    if (key && books[String(key)]) return books[String(key)];
  }
  return null;
}

function vpeLegsOf(pair) {
  return [
    [pair.k1_pe_token, pair.k1_pe_key],
    [pair.k2_pe_token, pair.k2_pe_key],
  ];
}

function applyVpeIncomingBooks(books, pairs, ts) {
  if (!books) return;
  for (const pair of pairs) {
    for (const [token, key] of vpeLegsOf(pair)) {
      const q = vpeLookup(books, key, token);
      if (!q) continue;
      const prev = vpeBook(token);
      const ltp = Number(q.last_price || q.ltp || 0);
      vpeState.books[String(token)] = {
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

function vpeExecPx(book, side, session) {
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

function paintVpeMode(session, method) {
  const box = vpeEl("vpe-mode");
  const label = vpeEl("vpe-mode-label");
  const reason = vpeEl("vpe-mode-reason");
  if (!box) return;
  box.className = `synth-mode ${session.live ? "synth-mode-live" : "synth-mode-ltp"}`;
  if (label) label.textContent = session.live ? "🟢 LIVE / EXECUTABLE" : "🟡 LTP / THEORETICAL";
  if (reason) reason.textContent = `${session.reason} · ${method.label} Confirmed arbitrage is never labelled from LTP.`;
  const methodEl = vpeEl("vpe-method");
  if (methodEl) methodEl.textContent = `${method.label} · (B) buy K1 PE · (S) sell K2 PE`;
}

function vpeSnapshotOk(books, rates, session) {
  if (!session.live) return { ok: true, reason: "" };
  const times = books.map((row) => Number(row.ts || 0));
  if (times.some((ts) => !ts)) return { ok: false, reason: "missing quote timestamp" };
  const age = Date.now() - Math.min(...times);
  const span = Math.max(...times) - Math.min(...times);
  if (age > rates.staleMs) return { ok: false, reason: "stale quotes" };
  if (span > rates.snapMs) return { ok: false, reason: "legs not from the same snapshot" };
  return { ok: true, reason: "" };
}

function vpeSpreadPct(bid, ask) {
  if (!(bid > 0) || !(ask > 0)) return 0;
  return ((ask - bid) / ((ask + bid) / 2)) * 100;
}

function vpeCrossed(book) {
  return book.bid > 0 && book.ask > 0 && book.bid > book.ask;
}

function classifyVpeRow(row) {
  if (row.incomplete) return { status: "POTENTIAL", label: "🟡 POTENTIAL", reason: row.reasons[0] || "incomplete quotes" };
  if (!(row.net > 0)) return { status: "NO", label: "🔴 NO ARBITRAGE", reason: "net profit ≤ 0 after costs and slippage" };
  if (!row.live) return { status: "POTENTIAL", label: "🟡 POTENTIAL", reason: "LTP / theoretical only — not executable" };
  if (!row.executable) return { status: "POTENTIAL", label: "🟡 POTENTIAL", reason: row.reasons[0] || "not executable" };
  if (row.reasons.length) return { status: "POTENTIAL", label: "🟡 POTENTIAL", reason: row.reasons[0] };
  return { status: "CONFIRMED", label: "🟢 CONFIRMED ARBITRAGE", reason: "executable after costs, slippage and liquidity" };
}

function evaluateVpePair(pair, session, rates) {
  const k1PeB = vpeBook(pair.k1_pe_token);
  const k2PeB = vpeBook(pair.k2_pe_token);
  const lot = pair.lot_size || 1;
  const lots = rates.lots;
  const qty = lot * lots;
  const k1Pe = vpeExecPx(k1PeB, "ask", session);
  const k2Pe = vpeExecPx(k2PeB, "bid", session);
  const reasons = [];
  const incomplete = k1Pe.missing || k2Pe.missing;
  if (k1Pe.missing) reasons.push("missing K1 Put ask/LTP");
  if (k2Pe.missing) reasons.push("missing K2 Put bid/LTP");
  if (vpeCrossed(k1PeB) || vpeCrossed(k2PeB)) reasons.push("crossed/invalid book");

  const sanity = CallArbCharges.putVerticalSanity(pair.k1, pair.k2);
  if (!sanity.ok) reasons.push("put-spread payoff cap failed");

  const snap = vpeSnapshotOk([k1PeB, k2PeB], rates, session);
  if (session.live && !snap.ok) reasons.push(snap.reason);

  const quotes = [k1Pe, k2Pe];
  const topOk = session.live && quotes.every((row) => row.qty >= qty);
  const depthOk = session.live && quotes.every((row) => (row.depth || row.qty) >= qty);
  if (session.live && !incomplete && !topOk) {
    reasons.push(depthOk
      ? `top-of-book qty below ${qty} (depth may walk)`
      : `available qty below ${qty}`);
  }

  const spreads = [k1PeB, k2PeB].map((book) => vpeSpreadPct(book.bid, book.ask));
  if (session.live && spreads.some((pct) => pct > rates.maxOptSpreadPct)) reasons.push("option spread too wide");

  const width = CallArbCharges.boxPayoff(pair.k1, pair.k2);
  const credit = incomplete ? 0 : CallArbCharges.putVerticalCredit(k2Pe.price, k1Pe.price);
  const gross = incomplete || !sanity.ok ? 0 : credit - width;
  const charges = incomplete
    ? { total: 0, legs: [] }
    : CallArbCharges.twoLegPutVerticalCharges({
      k1Pe: k1Pe.price,
      k2Pe: k2Pe.price,
      qty,
      rates,
    });
  const slipShare = CallArbCharges.verticalSlippagePerShare({
    k1Bid: k1PeB.bid || k1Pe.price,
    k1Ask: k1PeB.ask || k1Pe.price,
    k2Bid: k2PeB.bid || k2Pe.price,
    k2Ask: k2PeB.ask || k2Pe.price,
    rates,
  });
  const costShare = qty ? charges.total / qty : 0;
  const netShare = incomplete || !sanity.ok ? 0 : gross - costShare - slipShare;
  const netLot = netShare * lot;
  const net = netShare * qty;
  const marginKey = `vpe|${pair.symbol}|${pair.expiry}|${pair.k1}|${pair.k2}|${qty}`;
  const liveMargin = vpeState.margins[marginKey];
  const margin = liveMargin && liveMargin.required > 0
    ? liveMargin
    : CallArbCharges.estimatePutVerticalMargins({
      k1: pair.k1,
      k2: pair.k2,
      k1Pe: k1Pe.price,
      k2Pe: k2Pe.price,
      lot,
      lots,
    });
  if (!liveMargin || liveMargin.uncertain || !(margin.required > 0)) {
    if (gross > 0) reasons.push(margin.source === "kite-basket" ? "margin incomplete" : "margin estimated / uncertain");
  }
  const rom = margin.required > 0 && net > 0 ? (net / margin.required) * 100 : 0;
  const executable = session.live && !incomplete && topOk && snap.ok && sanity.ok
    && !vpeCrossed(k1PeB) && !vpeCrossed(k2PeB);

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
    sideLabel: "SHORT PUT SPREAD · BUY K1 PE / SELL K2 PE",
    k1_pe_symbol: pair.k1_pe_symbol,
    k2_pe_symbol: pair.k2_pe_symbol,
    k1Pe: k1Pe.price,
    k2Pe: k2Pe.price,
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
    ts: { k1Pe: k1PeB.ts, k2Pe: k2PeB.ts },
    method: CallArbCharges.putVerticalMethodology(),
  };
  const cls = classifyVpeRow(row);
  row.status = cls.status;
  row.statusLabel = cls.label;
  row.statusReason = cls.reason;
  return row;
}

function evaluateVertPe() {
  const session = nseSession();
  const rates = readVpeFormRates();
  const method = CallArbCharges.putVerticalMethodology();
  paintVpeMode(session, method);
  const rows = vpeState.pairs.map((pair) => evaluateVpePair(pair, session, rates));
  const rank = { CONFIRMED: 0, POTENTIAL: 1, NO: 2 };
  rows.sort((a, b) => {
    const rs = rank[a.status] - rank[b.status];
    if (rs) return rs;
    return (b.rom - a.rom) || (b.net - a.net) || a.symbol.localeCompare(b.symbol) || a.width - b.width;
  });
  vpeState.rows = rows;
  return rows;
}

function visibleVertPe(rows) {
  const minNet = vpeNum("vpe-min-net", 0);
  const minRom = vpeNum("vpe-min-rom", 0);
  const minEdge = vpeNum("vpe-min-edge", 0);
  const showNo = vpeChecked("vpe-show-no");
  const q = String((vpeEl("vpe-filter") && vpeEl("vpe-filter").value) || "").trim().toUpperCase();
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

function setVertPeStatus(text) {
  const el = vpeEl("vpe-status");
  if (el) el.textContent = `${text}${vpeState.source ? ` · ${vpeState.source}` : ""}`;
}

function vpeSideMark(buy) {
  return `<span class="side-mark ${buy ? "side-buy" : "side-sell"}">${buy ? "(B)" : "(S)"}</span>`;
}

function vpeMoneySide(price, buy, incomplete) {
  if (incomplete || !(Number(price) > 0)) return "—";
  return `${money(price)} ${vpeSideMark(buy)}`;
}

function vpeStrike(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return inr(x, Math.abs(x % 1) > 1e-9 ? 2 : 0);
}

function renderVertPeRows(rows) {
  const body = vpeEl("vpe-body");
  const empty = vpeEl("vpe-empty");
  if (!body) return;
  body.innerHTML = "";
  const visible = visibleVertPe(rows);
  const confirmed = rows.filter((row) => row.status === "CONFIRMED").length;
  if (vpeEl("opp-count") && state.tab === "vertpe") {
    vpeEl("opp-count").textContent = `${confirmed} confirmed / ${visible.length} shown`;
    vpeEl("stocks-scanned").textContent = String(new Set(vpeState.pairs.map((row) => row.symbol)).size);
  }
  if (!visible.length) {
    empty.classList.remove("hidden");
    empty.textContent = vpeState.pairs.length
      ? (nseSession().live
        ? "No executable same-expiry Put vertical after costs, slippage and filters."
        : "No theoretical LTP edge after costs. Weekend/holiday rows are never CONFIRMED ARBITRAGE.")
      : "Connect Zerodha, then start the Put vertical scanner.";
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
          <span class="stock-meta">short PE spread</span>
        </div>
      </td>
      <td>${fmtExpiryLong(row.expiry)}</td>
      <td class="num">${vpeStrike(row.k1)}</td>
      <td class="num">${vpeStrike(row.k2)}</td>
      <td class="num">${vpeStrike(row.width)}</td>
      <td class="num">${vpeMoneySide(row.k1Pe, true, row.incomplete)}</td>
      <td class="num">${vpeMoneySide(row.k2Pe, false, row.incomplete)}</td>
      <td class="num">${row.incomplete ? "—" : money(row.credit)}</td>
      <td class="num">${vpeStrike(row.width)}</td>
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
    tr.addEventListener("click", () => openVertPeDrawer(row));
    body.appendChild(tr);
  }
}

function vpeChargeLines(leg) {
  if (!leg) return "";
  return `${money(leg.total)} · brk ${money(leg.brokerage)} · STT ${money(leg.stt)} · txn ${money(leg.txn)} · GST ${money(leg.gst)} · SEBI ${money(leg.sebi)} · stamp ${money(leg.stamp)}`;
}

function openVertPeDrawer(row, opts = {}) {
  vpeState.selected = row.id;
  const drawer = vpeEl("drawer");
  drawer.classList.add("wide");
  vpeEl("d-symbol").textContent = `${row.symbol} ${vpeStrike(row.k1)}/${vpeStrike(row.k2)} · ${row.statusLabel}`;
  vpeEl("d-name").textContent = row.sideLabel;
  const legs = row.charges.legs || [];
  const ts = (ms) => ms ? new Date(ms).toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" }) : "—";
  vpeEl("drawer-body").innerHTML = `
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
      ${kv("Payoff cap", row.sanity && row.sanity.ok ? "Put spread ≤ K2 − K1" : "FAILED")}
    </div>
    <hr class="rule" />
    <div class="legs">
      <div class="leg"><em>BUY ${row.k1_pe_symbol}</em><span>${row.qty} @ ${row.k1Pe ? money(row.k1Pe) : "—"}</span></div>
      <div class="leg"><em>SELL ${row.k2_pe_symbol}</em><span>${row.qty} @ ${row.k2Pe ? money(row.k2Pe) : "—"}</span></div>
    </div>
    <hr class="rule" />
    <div class="kv">
      ${kv("Net credit (K2 bid − K1 ask)", row.incomplete ? "—" : money(row.credit))}
      ${kv("Max payoff K2 − K1", money(row.width))}
      ${kv("Gross edge / sh", row.incomplete ? "—" : money(row.gross))}
      ${kv("Gross / lot", row.incomplete ? "—" : money(row.gross * row.lot))}
      ${kv("K1 PE charges (buy)", vpeChargeLines(legs[0]))}
      ${kv("K2 PE charges (sell)", vpeChargeLines(legs[1]))}
      ${kv("Total charges (2 option legs)", money(row.charges.total || 0))}
      ${kv("Slippage / lot", money(row.slipLot))}
      ${kv("Net / share", money(row.netShare), row.netShare > 0 ? "net" : "")}
      ${kv("Net / lot", money(row.netLot), row.netLot > 0 ? "net" : "")}
      ${kv("Net (all lots)", money(row.net), row.net > 0 ? "net" : "")}
      ${kv("Combined margin", money(row.margin.combined || row.margin.required || 0))}
      ${kv("Final required margin", money(row.margin.required || 0))}
      ${kv("Return on margin", row.rom ? pct(row.rom) : "—")}
      ${kv("Margin source", row.margin.uncertain ? `${row.margin.source} (uncertain → not confirmed)` : row.margin.source)}
      ${kv("K1 PE quote ts", ts(row.ts.k1Pe))}
      ${kv("K2 PE quote ts", ts(row.ts.k2Pe))}
    </div>
    <p class="footnote">Identification only. No order is sent. Two option legs only — not the three-leg synthetic cost model.</p>
  `;
  drawer.hidden = false;
  vpeEl("backdrop").hidden = false;
  if (opts.fetchMargin !== false) requestVpeMargin(row, Boolean(opts.forceMargin));
}

function refreshVertPe() {
  if (typeof state === "undefined" || state.tab !== "vertpe") return;
  const rows = evaluateVertPe();
  renderVertPeRows(rows);
  const now = new Date().toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" });
  if (vpeEl("last-update")) vpeEl("last-update").textContent = now;
  prefetchVpeMargins(rows);
}

let vpePaint = 0;
function applyVertPeTicks(ticks) {
  const now = Date.now();
  for (const tick of ticks) {
    vpeState.books[String(tick.instrument_token)] = {
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
  if (!vpePaint) {
    vpePaint = window.requestAnimationFrame(() => {
      vpePaint = 0;
      refreshVertPe();
    });
  }
}

function fillVpeStockSelect(stocks) {
  const sel = vpeEl("vpe-stock");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">All F&O stocks</option>` + stocks
    .map((row) => `<option value="${row.symbol}">${row.symbol}</option>`)
    .join("");
  if ([...sel.options].some((opt) => opt.value === current)) sel.value = current;
}

async function seedVpeMissingOptionBooks(pairs) {
  const keys = [...new Set(pairs.flatMap((row) => [row.k1_pe_key, row.k2_pe_key]))];
  const need = keys.filter((key) => {
    const pair = pairs.find((row) => row.k1_pe_key === key || row.k2_pe_key === key);
    if (!pair) return false;
    const token = key === pair.k1_pe_key ? pair.k1_pe_token : pair.k2_pe_token;
    const book = vpeBook(token);
    return !(book.ltp > 0 || book.bid > 0 || book.ask > 0);
  });
  for (let i = 0; i < need.length; i += 40) {
    const chunk = need.slice(i, i + 40);
    setVertPeStatus(`Seeding Put quotes… ${Math.min(i + chunk.length, need.length)}/${need.length}`);
    const data = await fetchJson(`/api/quotes?hist=false&keys=${encodeURIComponent(chunk.join(","))}`);
    applyVpeIncomingBooks(data.books || {}, pairs, Date.now());
    refreshVertPe();
  }
}

const vpeMarginInflight = new Set();

async function requestVpeMargin(row, force) {
  if (row.incomplete || !(row.qty > 0)) return;
  const key = row.id;
  const prev = vpeState.margins[key];
  if (!force && prev && Date.now() - prev.at < 60000) return;
  if (vpeMarginInflight.has(key)) return;
  vpeMarginInflight.add(key);
  try {
    const data = await fetchJson("/api/margins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orders: [
          { tradingsymbol: row.k1_pe_symbol, transaction_type: "BUY", quantity: row.qty },
          { tradingsymbol: row.k2_pe_symbol, transaction_type: "SELL", quantity: row.qty },
        ],
      }),
    });
    vpeState.margins[key] = {
      combined: Number(data.combined || 0),
      required: Number(data.required || 0),
      uncertain: data.uncertain !== false && !(Number(data.required) > 0),
      source: data.source || "kite",
      at: Date.now(),
    };
    refreshVertPe();
    if (vpeState.selected === key) {
      const latest = vpeState.rows.find((item) => item.id === key);
      if (latest) openVertPeDrawer(latest, { fetchMargin: false });
    }
  } catch (_err) {
    vpeState.margins[key] = { ...(prev || {}), at: Date.now(), uncertain: true, source: "unavailable" };
  } finally {
    vpeMarginInflight.delete(key);
  }
}

let vpeMarginQueue = Promise.resolve();
function prefetchVpeMargins(rows) {
  const session = nseSession();
  const candidates = rows.filter((row) => !row.incomplete && row.net > 0).slice(0, session.live ? 8 : 4);
  for (const row of candidates) {
    vpeMarginQueue = vpeMarginQueue.then(() => requestVpeMargin(row, false)).catch(() => {});
  }
}

async function startVertPeScanner() {
  if (!state.connected) {
    setVertPeStatus("Connect Zerodha first.");
    return;
  }
  if (typeof stopSynthScanner === "function") stopSynthScanner();
  if (typeof stopCallArbScanner === "function") stopCallArbScanner();
  if (typeof stopPutArbScanner === "function") stopPutArbScanner();
  if (typeof stopBoxArbScanner === "function") stopBoxArbScanner();
  if (typeof stopVertCeScanner === "function") stopVertCeScanner();
  persistVpeRates();
  const btn = vpeEl("vpe-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Starting…";
  }
  try {
    const expiry = (vpeEl("vpe-expiry") && vpeEl("vpe-expiry").value) || "nearest";
    const symbol = (vpeEl("vpe-stock") && vpeEl("vpe-stock").value) || "";
    const band = vpeNum("vpe-band", 6);
    const maxStrikes = vpeNum("vpe-max-strikes", symbol ? 40 : 5);
    const snapshot = await fetchJson(
      `/api/vert-pe?seed=true&expiry=${encodeURIComponent(expiry)}&symbol=${encodeURIComponent(symbol)}&band=${encodeURIComponent(band)}&max_strikes=${encodeURIComponent(maxStrikes)}`,
    );
    vpeState.pairs = snapshot.pairs || [];
    vpeState.books = snapshot.books || {};
    vpeState.stocks = snapshot.stocks || [];
    vpeState.started = true;
    state.connected = Boolean(snapshot.connected);
    setPill(state.connected);
    fillVpeStockSelect(vpeState.stocks);
    const bar = vpeEl("alert-bar");
    if (bar && (snapshot.message || snapshot.error)) {
      bar.classList.remove("hidden");
      bar.textContent = snapshot.message || snapshot.error;
    }
    refreshVertPe();
    setVertPeStatus("Seeding Put quotes…");
    await seedVpeMissingOptionBooks(vpeState.pairs);

    if (vpeState.ticker) {
      vpeState.ticker.close();
      vpeState.ticker = null;
    }
    const creds = await fetchJson("/api/ticker");
    if (creds.ws_url && vpeState.pairs.length) {
      vpeState.source = "Kite WebSocket";
      setVertPeStatus("Connecting ticker…");
      vpeState.ticker = connectKiteTicker({
        wsUrl: creds.ws_url,
        tokens: snapshot.tokens || [],
        onTicks: applyVertPeTicks,
        onStatus: setVertPeStatus,
      });
    } else {
      vpeState.source = "REST quotes";
      setVertPeStatus(creds.error || "WebSocket unavailable — snapshot quotes only.");
    }
    refreshVertPe();
  } catch (error) {
    setVertPeStatus(error.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Start scanner";
    }
  }
}

function stopVertPeScanner() {
  if (vpeState.ticker) vpeState.ticker.close();
  vpeState.ticker = null;
  vpeState.started = false;
  setVertPeStatus("Stopped");
}

window.setInterval(() => {
  if (typeof state !== "undefined" && state.tab === "vertpe") refreshVertPe();
}, 30000);

window.startVertPeScanner = startVertPeScanner;
window.stopVertPeScanner = stopVertPeScanner;
window.refreshVertPe = refreshVertPe;
window.fillVertPeRates = fillVpeRateForm;
window.persistVertPeRates = persistVpeRates;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => fillVpeRateForm(readVpeStoredRates()));
} else {
  fillVpeRateForm(readVpeStoredRates());
}
