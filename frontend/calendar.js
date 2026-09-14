const CAL_RATES_KEY = "calendar_arb_rates_v1";
const CAL_HIST_KEY = "calendar_arb_hist_v1";

const calState = {
  pairs: [],
  books: {},
  stocks: [],
  ticker: null,
  started: false,
  source: "",
  rows: [],
  selected: null,
  hist: {},
  lastHistAt: {},
};

function calEl(id) {
  return document.getElementById(id);
}

function calNum(id, fallback) {
  const value = Number(calEl(id) && calEl(id).value);
  return Number.isFinite(value) ? value : fallback;
}

function calChecked(id) {
  return Boolean(calEl(id) && calEl(id).checked);
}

function readCalStoredRates() {
  try {
    return CallArbCharges.mergeRates(JSON.parse(localStorage.getItem(CAL_RATES_KEY) || "{}"));
  } catch (_err) {
    return CallArbCharges.mergeRates();
  }
}

function readCalFormRates() {
  const stored = readCalStoredRates();
  const cfg = CalendarEngine.mergeConfig(stored.calendar || {});
  return CallArbCharges.mergeRates({
    ...stored,
    opt: {
      brokerage: calNum("cal-opt-brok", stored.opt.brokerage),
      sttSellPct: calNum("cal-opt-stt", stored.opt.sttSellPct),
      sttExercisePct: calNum("cal-opt-ex-stt", stored.opt.sttExercisePct),
      txnPct: calNum("cal-opt-txn", stored.opt.txnPct),
      stampBuyPct: calNum("cal-opt-stamp", stored.opt.stampBuyPct),
    },
    gstPct: calNum("cal-gst", stored.gstPct),
    sebiPerCrore: calNum("cal-sebi", stored.sebiPerCrore),
    includeExerciseStt: calChecked("cal-include-ex"),
    slippageInr: calNum("cal-slip", stored.slippageInr),
    slipSpreadFrac: calNum("cal-slip-spread", stored.slipSpreadFrac),
    staleMs: calNum("cal-stale", stored.staleMs),
    snapMs: calNum("cal-snap", stored.snapMs),
    maxOptSpreadPct: calNum("cal-opt-spread", stored.maxOptSpreadPct),
    lots: Math.max(1, Math.round(calNum("cal-lots", stored.lots) || 1)),
    calendar: CalendarEngine.mergeConfig({
      ...cfg,
      rate: calNum("cal-rate", cfg.rate * 100) / 100,
      divYield: calNum("cal-div", cfg.divYield * 100) / 100,
      deltaWarn: calNum("cal-delta-warn", cfg.deltaWarn),
      minWatchMis: calNum("cal-min-watch", cfg.minWatchMis),
      minTradeEdge: calNum("cal-min-edge", cfg.minTradeEdge),
      aPlusMis: calNum("cal-aplus", cfg.aPlusMis),
      minHistory: Math.max(8, Math.round(calNum("cal-min-hist", cfg.minHistory) || 20)),
    }),
  });
}

function persistCalRates() {
  localStorage.setItem(CAL_RATES_KEY, JSON.stringify(readCalFormRates()));
}

function fillCalRateForm(rates) {
  const r = CallArbCharges.mergeRates(rates);
  const cfg = CalendarEngine.mergeConfig(r.calendar || {});
  const set = (id, value) => {
    if (calEl(id)) calEl(id).value = value;
  };
  set("cal-opt-brok", r.opt.brokerage);
  set("cal-opt-stt", r.opt.sttSellPct);
  set("cal-opt-ex-stt", r.opt.sttExercisePct);
  set("cal-opt-txn", r.opt.txnPct);
  set("cal-opt-stamp", r.opt.stampBuyPct);
  set("cal-gst", r.gstPct);
  set("cal-sebi", r.sebiPerCrore);
  set("cal-slip", r.slippageInr);
  set("cal-slip-spread", r.slipSpreadFrac);
  set("cal-stale", r.staleMs);
  set("cal-snap", r.snapMs);
  set("cal-opt-spread", r.maxOptSpreadPct);
  set("cal-lots", r.lots);
  set("cal-rate", roundCal(cfg.rate * 100, 2));
  set("cal-div", roundCal(cfg.divYield * 100, 2));
  set("cal-delta-warn", cfg.deltaWarn);
  set("cal-min-watch", cfg.minWatchMis);
  set("cal-min-edge", cfg.minTradeEdge);
  set("cal-aplus", cfg.aPlusMis);
  set("cal-min-hist", cfg.minHistory);
  if (calEl("cal-include-ex")) calEl("cal-include-ex").checked = Boolean(r.includeExerciseStt);
}

function roundCal(n, digits) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  const p = 10 ** (digits || 0);
  return Math.round(x * p) / p;
}

function loadCalHist() {
  try {
    calState.hist = JSON.parse(localStorage.getItem(CAL_HIST_KEY) || "{}") || {};
  } catch (_err) {
    calState.hist = {};
  }
}

function saveCalHist() {
  try {
    const keys = Object.keys(calState.hist);
    if (keys.length > 4000) {
      for (const key of keys.slice(0, keys.length - 3000)) delete calState.hist[key];
    }
    localStorage.setItem(CAL_HIST_KEY, JSON.stringify(calState.hist));
  } catch (_err) { /* quota */ }
}

function calBook(token) {
  return calState.books[String(token)] || {
    ltp: 0, bid: 0, ask: 0, bid_qty: 0, ask_qty: 0, bid_depth: 0, ask_depth: 0, volume: 0, oi: 0, ts: 0,
  };
}

function calLookup(books, ...keys) {
  for (const key of keys) {
    if (key && books[key]) return books[key];
    if (key && books[String(key)]) return books[String(key)];
  }
  return null;
}

function calLegsOf(pair) {
  return [
    [pair.near_ce_token, pair.near_ce_key],
    [pair.near_pe_token, pair.near_pe_key],
    [pair.far_ce_token, pair.far_ce_key],
    [pair.far_pe_token, pair.far_pe_key],
    [pair.near_fut_token, pair.near_fut_key],
    [pair.far_fut_token, pair.far_fut_key],
    [pair.eq_token, pair.eq_key],
  ].filter((row) => row[0]);
}

function applyCalIncomingBooks(books, pairs, ts) {
  if (!books) return;
  for (const pair of pairs) {
    for (const [token, key] of calLegsOf(pair)) {
      const q = calLookup(books, key, token);
      if (!q) continue;
      const prev = calBook(token);
      const ltp = Number(q.last_price || q.ltp || q.close || 0);
      calState.books[String(token)] = {
        ltp: ltp > 0 ? ltp : prev.ltp,
        bid: Number(q.bid || 0) || prev.bid,
        ask: Number(q.ask || 0) || prev.ask,
        bid_qty: Number(q.bid_qty || 0) || prev.bid_qty,
        ask_qty: Number(q.ask_qty || 0) || prev.ask_qty,
        bid_depth: Number(q.bid_depth || q.bid_qty || 0) || prev.bid_depth,
        ask_depth: Number(q.ask_depth || q.ask_qty || 0) || prev.ask_depth,
        volume: Number(q.volume || 0) || prev.volume,
        oi: Number(q.oi || 0) || prev.oi,
        ts: ltp > 0 || Number(q.bid || 0) || Number(q.ask || 0) ? ts : prev.ts,
      };
    }
  }
}

function calExecPx(book, side, session) {
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

function calMarkPx(book, session) {
  if (session.live && book.bid > 0 && book.ask > 0) return (Number(book.bid) + Number(book.ask)) / 2;
  return Number(book.ltp || 0);
}

function paintCalMode(session, method) {
  const box = calEl("cal-mode");
  const label = calEl("cal-mode-label");
  const reason = calEl("cal-mode-reason");
  if (!box) return;
  box.className = `synth-mode ${session.live ? "synth-mode-live" : "synth-mode-ltp"}`;
  if (label) label.textContent = session.live ? "🟢 LIVE / EXECUTABLE" : "🟡 LTP / THEORETICAL";
  if (reason) reason.textContent = `${session.reason} · ${method.label} High-confidence is never labelled from LTP.`;
  const methodEl = calEl("cal-method");
  if (methodEl) methodEl.textContent = method.label;
}

function calSnapshotOk(books, rates, session) {
  if (!session.live) return { ok: true, reason: "" };
  const times = books.map((row) => Number(row.ts || 0));
  if (times.some((ts) => !ts)) return { ok: false, reason: "missing quote timestamp" };
  const age = Date.now() - Math.min(...times);
  const span = Math.max(...times) - Math.min(...times);
  if (age > rates.staleMs) return { ok: false, reason: "stale quotes" };
  if (span > rates.snapMs) return { ok: false, reason: "legs not from the same snapshot" };
  return { ok: true, reason: "" };
}

function calSpreadPct(bid, ask) {
  if (!(bid > 0) || !(ask > 0)) return 0;
  return ((ask - bid) / ((ask + bid) / 2)) * 100;
}

function calCrossed(book) {
  return book.bid > 0 && book.ask > 0 && book.bid > book.ask;
}

function calIvDelta(price, F, K, T, isCall, rate) {
  if (!(price > 0) || !(F > 0) || !(K > 0) || !(T > 0)) return { iv: null, delta: null };
  const iv = OptionRv.impliedVol({ price, F, K, T, isCall, rate });
  if (!iv.iv) return { iv: null, delta: null, reason: iv.reason };
  return {
    iv: iv.iv,
    delta: OptionRv.black76Delta({ F, K, T, sigma: iv.iv, isCall, rate }),
  };
}

function evaluateCalPair(pair, session, rates) {
  const cfg = CalendarEngine.mergeConfig(rates.calendar || {});
  const nearCeB = calBook(pair.near_ce_token);
  const nearPeB = calBook(pair.near_pe_token);
  const farCeB = calBook(pair.far_ce_token);
  const farPeB = calBook(pair.far_pe_token);
  const nearFutB = calBook(pair.near_fut_token);
  const farFutB = calBook(pair.far_fut_token);
  const eqB = calBook(pair.eq_token);
  const lot = pair.lot_size || 1;
  const lots = rates.lots;
  const qty = lot * lots;
  const tNear = OptionRv.yearFraction(pair.near_expiry);
  const tFar = OptionRv.yearFraction(pair.far_expiry);
  const rate = cfg.rate;
  const div = cfg.divYield;

  const nearCeAsk = calExecPx(nearCeB, "ask", session);
  const nearPeBid = calExecPx(nearPeB, "bid", session);
  const nearCeBid = calExecPx(nearCeB, "bid", session);
  const nearPeAsk = calExecPx(nearPeB, "ask", session);
  const farCeBid = calExecPx(farCeB, "bid", session);
  const farPeAsk = calExecPx(farPeB, "ask", session);
  const farCeAsk = calExecPx(farCeB, "ask", session);
  const farPeBid = calExecPx(farPeB, "bid", session);

  const reasons = [];
  const quotes = [nearCeAsk, nearPeBid, farCeBid, farPeAsk, nearCeBid, nearPeAsk, farCeAsk, farPeBid];
  const incomplete = quotes.some((row) => row.missing);
  if (incomplete) reasons.push("missing CE/PE bid/ask or LTP");
  if ([nearCeB, nearPeB, farCeB, farPeB].some(calCrossed)) reasons.push("crossed/invalid book");

  const snap = calSnapshotOk([nearCeB, nearPeB, farCeB, farPeB], rates, session);
  if (session.live && !snap.ok) reasons.push(snap.reason);
  const spreads = [nearCeB, nearPeB, farCeB, farPeB].map((book) => calSpreadPct(book.bid, book.ask));
  if (session.live && spreads.some((pctVal) => pctVal > rates.maxOptSpreadPct)) reasons.push("option spread too wide");

  const exec = incomplete ? null : CalendarEngine.executableSynthetics({
    strike: pair.strike, rate, tNear, tFar,
    nearCeAsk: nearCeAsk.price, nearPeBid: nearPeBid.price,
    nearCeBid: nearCeBid.price, nearPeAsk: nearPeAsk.price,
    farCeBid: farCeBid.price, farPeAsk: farPeAsk.price,
    farCeAsk: farCeAsk.price, farPeBid: farPeBid.price,
  });

  const spot = calMarkPx(eqB, session) || calMarkPx(nearFutB, session);
  let fair = 0;
  let fairSource = "none";
  if (spot > 0 && calMarkPx(eqB, session) > 0) {
    fair = CalendarEngine.fairSpread(spot, rate, div, tNear, tFar);
    fairSource = "spot carry";
  } else if (calMarkPx(nearFutB, session) > 0) {
    const fn = calMarkPx(nearFutB, session);
    const ff = fn * Math.exp((rate - div) * Math.max(tFar - tNear, 0));
    fair = ff - fn;
    fairSource = "near future carry";
  } else {
    reasons.push("missing spot/future for fair calendar");
  }

  const chargesA = incomplete ? { total: 0, legs: [] } : CallArbCharges.calendarCharges({
    buyNear: true, nearCe: nearCeAsk.price, nearPe: nearPeBid.price,
    farCe: farCeBid.price, farPe: farPeAsk.price, qty, rates,
  });
  const chargesB = incomplete ? { total: 0, legs: [] } : CallArbCharges.calendarCharges({
    buyNear: false, nearCe: nearCeBid.price, nearPe: nearPeAsk.price,
    farCe: farCeAsk.price, farPe: farPeBid.price, qty, rates,
  });
  const slipShare = CallArbCharges.calendarSlippagePerShare({
    nearCeBid: nearCeB.bid || nearCeBid.price, nearCeAsk: nearCeB.ask || nearCeAsk.price,
    nearPeBid: nearPeB.bid || nearPeBid.price, nearPeAsk: nearPeB.ask || nearPeAsk.price,
    farCeBid: farCeB.bid || farCeBid.price, farCeAsk: farCeB.ask || farCeAsk.price,
    farPeBid: farPeB.bid || farPeBid.price, farPeAsk: farPeB.ask || farPeAsk.price,
    rates,
  });
  const costA = qty && !incomplete ? chargesA.total / qty + slipShare : 0;
  const costB = qty && !incomplete ? chargesB.total / qty + slipShare : 0;
  const picked = exec
    ? CalendarEngine.pickDirection({ spreadA: exec.spreadA, spreadB: exec.spreadB, fair, costA, costB })
    : { id: "A", label: "incomplete", currentSpread: 0, gross: 0, net: 0, buyNear: true };

  const current = incomplete ? 0 : picked.currentSpread;
  const mis = CalendarEngine.mispricing(current, fair);
  const misPct = CalendarEngine.mispricingPct(current, fair);
  const charges = picked.buyNear ? chargesA : chargesB;
  const netShare = incomplete ? 0 : picked.net;
  const netLot = netShare * lot;
  const net = netShare * qty;

  const buyPx = picked.buyNear
    ? [nearCeAsk, nearPeBid, farCeBid, farPeAsk]
    : [nearCeBid, nearPeAsk, farCeAsk, farPeBid];
  const topOk = session.live && buyPx.every((row) => row.qty >= qty);
  if (session.live && !incomplete && !topOk) reasons.push(`available qty below ${qty} on one of four legs`);
  const qAvail = Math.min(...buyPx.map((row) => Number(row.qty || 0)));
  const qLots = lot ? Math.floor(qAvail / lot) : 0;

  const Fnear = calMarkPx(nearFutB, session) || (exec ? (picked.buyNear ? exec.buyNear : exec.sellNear) : 0);
  const Ffar = calMarkPx(farFutB, session) || (exec ? (picked.buyNear ? exec.sellFar : exec.buyFar) : 0);
  const nearCeG = calIvDelta(picked.buyNear ? nearCeAsk.price : nearCeBid.price, Fnear, pair.strike, tNear, true, rate);
  const nearPeG = calIvDelta(picked.buyNear ? nearPeBid.price : nearPeAsk.price, Fnear, pair.strike, tNear, false, rate);
  const farCeG = calIvDelta(picked.buyNear ? farCeBid.price : farCeAsk.price, Ffar, pair.strike, tFar, true, rate);
  const farPeG = calIvDelta(picked.buyNear ? farPeAsk.price : farPeBid.price, Ffar, pair.strike, tFar, false, rate);
  const nearDelta = OptionRv.syntheticDelta(nearCeG.delta, nearPeG.delta);
  const farDelta = OptionRv.syntheticDelta(farCeG.delta, farPeG.delta);
  const netDelta = nearDelta == null || farDelta == null
    ? null
    : (picked.buyNear ? nearDelta - farDelta : farDelta - nearDelta);
  if (nearDelta == null || farDelta == null) reasons.push("delta incomplete (IV missing)");
  else if (Math.abs(netDelta) > cfg.deltaWarn) reasons.push("net calendar delta not near zero");

  const ivNear = [nearCeG.iv, nearPeG.iv].filter((n) => n > 0);
  const ivFar = [farCeG.iv, farPeG.iv].filter((n) => n > 0);
  const nearIv = ivNear.length ? ivNear.reduce((s, n) => s + n, 0) / ivNear.length : null;
  const farIv = ivFar.length ? ivFar.reduce((s, n) => s + n, 0) / ivFar.length : null;
  const ivDiff = nearIv != null && farIv != null ? (farIv - nearIv) * 100 : null;

  const listedSpread = calMarkPx(farFutB, session) && calMarkPx(nearFutB, session)
    ? calMarkPx(farFutB, session) - calMarkPx(nearFutB, session)
    : null;

  const histKey = `${pair.symbol}|${pair.near_expiry}|${pair.far_expiry}|${pair.strike}`;
  const history = calState.hist[histKey] || [];
  const now = Date.now();
  if (!incomplete && now - (calState.lastHistAt[histKey] || 0) > 15000) {
    calState.hist[histKey] = history.concat([mis]).slice(-120);
    calState.lastHistAt[histKey] = now;
  }
  const percentile = CalendarEngine.percentileRank(mis, calState.hist[histKey] || history);
  const histMedian = CalendarEngine.median(calState.hist[histKey] || history);

  const executable = session.live && !incomplete && topOk && snap.ok
    && ![nearCeB, nearPeB, farCeB, farPeB].some(calCrossed)
    && !buyPx.some((row) => row.usedLtp);
  const grade = CalendarEngine.classifyCalendar({
    absMis: Math.abs(mis),
    netEdge: netShare,
    netDelta,
    live: session.live,
    executable,
    qLots,
    percentile,
    cfg,
  });
  const action = CalendarEngine.actionForGrade(grade.grade);
  const margin = CallArbCharges.estimateCalendarMargins({
    strike: pair.strike, tNear, tFar, lot, lots,
  });

  return {
    id: `cal|${pair.symbol}|${pair.near_expiry}|${pair.far_expiry}|${pair.strike}|${qty}`,
    pair,
    exchange: pair.exchange || "NSE",
    symbol: pair.symbol,
    strike: pair.strike,
    nearExpiry: pair.near_expiry,
    farExpiry: pair.far_expiry,
    pairKind: pair.pair_kind,
    lot,
    lots,
    qty,
    spot,
    fair,
    fairSource,
    current,
    mis,
    misPct,
    listedSpread,
    direction: picked,
    nearSynth: exec ? (picked.buyNear ? exec.buyNear : exec.sellNear) : 0,
    farSynth: exec ? (picked.buyNear ? exec.sellFar : exec.buyFar) : 0,
    charges,
    slipShare,
    slipLot: slipShare * lot,
    netShare,
    netLot,
    net,
    nearDelta,
    farDelta,
    netDelta,
    nearIv,
    farIv,
    ivDiff,
    qAvail,
    qLots,
    live: session.live,
    usedLtp: quotes.some((row) => row.usedLtp),
    incomplete,
    executable,
    percentile,
    histMedian,
    grade: grade.grade,
    gradeLabel: grade.label,
    gradeNote: grade.note,
    action: action.action,
    actionNote: action.note,
    reasons: [...new Set(reasons)],
    ts: { nearCe: nearCeB.ts, nearPe: nearPeB.ts, farCe: farCeB.ts, farPe: farPeB.ts },
    margin,
    method: CalendarEngine.methodology(),
    near_ce_symbol: pair.near_ce_symbol,
    near_pe_symbol: pair.near_pe_symbol,
    far_ce_symbol: pair.far_ce_symbol,
    far_pe_symbol: pair.far_pe_symbol,
    px: {
      nearCe: picked.buyNear ? nearCeAsk.price : nearCeBid.price,
      nearPe: picked.buyNear ? nearPeBid.price : nearPeAsk.price,
      farCe: picked.buyNear ? farCeBid.price : farCeAsk.price,
      farPe: picked.buyNear ? farPeAsk.price : farPeBid.price,
    },
  };
}

function evaluateCalendar() {
  const session = nseSession();
  const rates = readCalFormRates();
  paintCalMode(session, CalendarEngine.methodology());
  const rows = calState.pairs.map((pair) => evaluateCalPair(pair, session, rates));
  const rank = { "A+": 0, A: 1, B: 2, IGNORE: 3 };
  rows.sort((a, b) => {
    const rs = (rank[a.grade] ?? 9) - (rank[b.grade] ?? 9);
    if (rs) return rs;
    return (Math.abs(b.netLot) - Math.abs(a.netLot))
      || (Math.abs(b.mis) - Math.abs(a.mis))
      || (b.qAvail - a.qAvail)
      || a.symbol.localeCompare(b.symbol)
      || a.strike - b.strike;
  });
  calState.rows = rows;
  return rows;
}

function visibleCalendar(rows) {
  const minMis = calNum("cal-filter-mis", 0);
  const minEdge = calNum("cal-filter-edge", 0);
  const showIgnore = calChecked("cal-show-ignore");
  const q = String((calEl("cal-filter") && calEl("cal-filter").value) || "").trim().toUpperCase();
  return rows.filter((row) => {
    if (q && !row.symbol.includes(q) && !String(row.strike).includes(q)) return false;
    if (row.incomplete) return showIgnore;
    if (row.grade === "IGNORE") return showIgnore && Math.abs(row.mis) > 0;
    if (Math.abs(row.mis) + 1e-9 < minMis) return false;
    if (row.netLot + 1e-9 < minEdge) return false;
    return true;
  });
}

function setCalendarStatus(text) {
  const el = calEl("cal-status");
  if (el) el.textContent = `${text}${calState.source ? ` · ${calState.source}` : ""}`;
}

function calStrike(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return inr(x, Math.abs(x % 1) > 1e-9 ? 2 : 0);
}

function calDelta(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toFixed(2);
}

function renderCalendarRows(rows) {
  const body = calEl("cal-body");
  const empty = calEl("cal-empty");
  if (!body) return;
  body.innerHTML = "";
  const visible = visibleCalendar(rows);
  const strong = rows.filter((row) => row.grade === "A+" || row.grade === "A").length;
  if (calEl("opp-count") && state.tab === "calendar") {
    calEl("opp-count").textContent = `${strong} A/A+ / ${visible.length} shown`;
    calEl("stocks-scanned").textContent = String(new Set(calState.pairs.map((row) => row.symbol)).size);
  }
  if (!visible.length) {
    empty.classList.remove("hidden");
    empty.textContent = calState.pairs.length
      ? (nseSession().live
        ? "No near/far synthetic calendars passing filters after costs."
        : "No calendar dislocation after costs. Weekend/holiday rows cannot be HIGH-CONFIDENCE.")
      : "Connect Zerodha, then start the calendar scanner.";
    return;
  }
  empty.classList.add("hidden");
  for (const row of visible) {
    const tr = document.createElement("tr");
    tr.className = row.grade === "A+" || row.grade === "A" ? "hit" : row.grade === "B" ? "theo" : "miss";
    tr.dataset.id = row.id;
    tr.title = `${row.gradeNote} ${row.actionNote}`;
    tr.innerHTML = `
      <td>
        <div class="stock-cell">
          <strong>${row.symbol}</strong>
          <span class="stock-meta">${row.exchange} · ${row.pairKind} · ${row.direction.id}</span>
        </div>
      </td>
      <td>${fmtExpiryLong(row.nearExpiry)}</td>
      <td>${fmtExpiryLong(row.farExpiry)}</td>
      <td class="num">${calStrike(row.strike)}</td>
      <td class="num">${row.incomplete ? "—" : money(row.current)}</td>
      <td class="num">${row.incomplete ? "—" : money(row.fair)}</td>
      <td class="num">${row.incomplete ? "—" : `${row.mis > 0 ? "+" : ""}${inr(row.mis)}`}</td>
      <td class="num">${row.incomplete ? "—" : pct(row.misPct)}</td>
      <td class="num">${calDelta(row.netDelta)}</td>
      <td class="num ${row.netLot > 0 ? "signal-yes" : "signal-no"}">${row.incomplete ? "—" : money(row.netLot)}</td>
      <td class="num">${row.live && row.qLots ? `${row.qLots} lots` : inr(row.lot, 0)}</td>
      <td class="${row.grade === "A+" || row.grade === "A" ? "signal-yes" : row.grade === "IGNORE" ? "signal-no-red" : "signal-no"}">${row.gradeLabel}</td>
      <td>${row.action}</td>
    `;
    tr.addEventListener("click", () => openCalendarDrawer(row));
    body.appendChild(tr);
  }
}

function calChargeLines(leg) {
  if (!leg) return "";
  return `${money(leg.total)} · brk ${money(leg.brokerage)} · STT ${money(leg.stt)} · txn ${money(leg.txn)} · GST ${money(leg.gst)} · SEBI ${money(leg.sebi)} · stamp ${money(leg.stamp)}`;
}

function openCalendarDrawer(row) {
  calState.selected = row.id;
  const drawer = calEl("drawer");
  drawer.classList.add("wide");
  calEl("d-symbol").textContent = `${row.symbol} — ${fmtExpiryLong(row.nearExpiry)}/${fmtExpiryLong(row.farExpiry)} — ${calStrike(row.strike)}`;
  calEl("d-name").textContent = `${row.gradeLabel} · ${row.action}`;
  const legs = row.charges.legs || [];
  const ts = (ms) => ms ? new Date(ms).toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" }) : "—";
  const nearSide = row.direction.buyNear ? "BUY" : "SELL";
  const farSide = row.direction.buyNear ? "SELL" : "BUY";
  calEl("drawer-body").innerHTML = `
    <p class="badge ${row.grade === "A+" || row.grade === "A" ? "net" : ""}">${row.gradeLabel} · ${row.action}</p>
    <p class="index-meta">${row.gradeNote}</p>
    <div class="kv">
      ${kv("Current synthetic calendar", row.incomplete ? "—" : money(row.current))}
      ${kv("Fair calendar", row.incomplete ? "—" : `${money(row.fair)} (${row.fairSource})`)}
      ${kv("Mispricing", row.incomplete ? "—" : `${row.mis > 0 ? "+" : ""}${money(row.mis)}`)}
      ${kv("Mispricing %", row.incomplete ? "—" : pct(row.misPct))}
      ${kv("Net executable edge / lot", money(row.netLot), row.netLot > 0 ? "net" : "")}
      ${kv("Near synthetic delta", calDelta(row.nearDelta))}
      ${kv("Far synthetic delta", calDelta(row.farDelta))}
      ${kv("Net calendar delta", calDelta(row.netDelta))}
      ${kv("Available quantity", row.live ? `${row.qLots} lots` : "LTP — quantity not confirmed")}
      ${kv("Historical percentile", row.percentile == null ? "need more stored observations" : `${row.percentile.toFixed(0)}th`)}
      ${kv("Historical median mispricing", row.histMedian == null ? "—" : money(row.histMedian))}
    </div>
    <hr class="rule" />
    <div class="kv">
      ${kv("Direction", row.direction.label)}
      ${kv("Near synth F", row.incomplete ? "—" : money(row.nearSynth))}
      ${kv("Far synth F", row.incomplete ? "—" : money(row.farSynth))}
      ${kv("Listed fut calendar", row.listedSpread == null ? "—" : money(row.listedSpread))}
      ${kv("Near IV", row.nearIv == null ? "—" : `${(row.nearIv * 100).toFixed(1)}%`)}
      ${kv("Far IV", row.farIv == null ? "—" : `${(row.farIv * 100).toFixed(1)}%`)}
      ${kv("IV difference (far − near)", row.ivDiff == null ? "—" : `${row.ivDiff.toFixed(1)} vol pts`)}
      ${kv("Lot × lots", `${row.lot} × ${row.lots} = ${row.qty}`)}
      ${kv("Mode", row.live ? "LIVE / EXECUTABLE" : "LTP / THEORETICAL")}
    </div>
    <hr class="rule" />
    <div class="legs">
      <div class="leg"><em>${nearSide} ${row.near_ce_symbol}</em><span>${row.qty} @ ${row.px.nearCe ? money(row.px.nearCe) : "—"}</span></div>
      <div class="leg"><em>${row.direction.buyNear ? "SELL" : "BUY"} ${row.near_pe_symbol}</em><span>${row.qty} @ ${row.px.nearPe ? money(row.px.nearPe) : "—"}</span></div>
      <div class="leg"><em>${farSide} ${row.far_ce_symbol}</em><span>${row.qty} @ ${row.px.farCe ? money(row.px.farCe) : "—"}</span></div>
      <div class="leg"><em>${row.direction.buyNear ? "BUY" : "SELL"} ${row.far_pe_symbol}</em><span>${row.qty} @ ${row.px.farPe ? money(row.px.farPe) : "—"}</span></div>
    </div>
    <hr class="rule" />
    <div class="kv">
      ${kv("Near CE charges", calChargeLines(legs[0]))}
      ${kv("Near PE charges", calChargeLines(legs[1]))}
      ${kv("Far CE charges", calChargeLines(legs[2]))}
      ${kv("Far PE charges", calChargeLines(legs[3]))}
      ${kv("Total charges (4 orders)", money(row.charges.total || 0))}
      ${kv("Slippage / lot", money(row.slipLot))}
      ${kv("Estimated margin *", money(row.margin.required || 0))}
      ${kv("Near CE ts", ts(row.ts.nearCe))}
      ${kv("Near PE ts", ts(row.ts.nearPe))}
      ${kv("Far CE ts", ts(row.ts.farCe))}
      ${kv("Far PE ts", ts(row.ts.farPe))}
    </div>
    <p class="footnote">${row.actionNote} A four-option synthetic calendar is a market-neutral convergence candidate, not structural arbitrage like a box or a positive-credit butterfly. HIGH-CONFIDENCE means scanner conditions passed — it does not imply a locked payoff.</p>
  `;
  drawer.hidden = false;
  calEl("backdrop").hidden = false;
}

function refreshCalendar() {
  if (typeof state === "undefined" || state.tab !== "calendar") return;
  const rows = evaluateCalendar();
  renderCalendarRows(rows);
  const now = new Date().toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" });
  if (calEl("last-update")) calEl("last-update").textContent = now;
}

let calPaint = 0;
function applyCalTicks(ticks) {
  const now = Date.now();
  for (const tick of ticks) {
    const prev = calBook(tick.instrument_token);
    calState.books[String(tick.instrument_token)] = {
      ltp: tick.ltp || prev.ltp,
      bid: tick.bid || prev.bid,
      ask: tick.ask || prev.ask,
      bid_qty: tick.bid_qty || prev.bid_qty,
      ask_qty: tick.ask_qty || prev.ask_qty,
      bid_depth: tick.bid_depth || tick.bid_qty || prev.bid_depth,
      ask_depth: tick.ask_depth || tick.ask_qty || prev.ask_depth,
      volume: tick.volume || prev.volume,
      oi: tick.oi || prev.oi,
      ts: now,
    };
  }
  if (!calPaint) {
    calPaint = window.requestAnimationFrame(() => {
      calPaint = 0;
      refreshCalendar();
    });
  }
}

function fillCalStockSelect(stocks) {
  const sel = calEl("cal-stock");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">All F&amp;O + indexes</option>` + stocks
    .map((row) => `<option value="${row.symbol}">${row.index ? "IDX " : ""}${row.symbol}</option>`)
    .join("");
  if ([...sel.options].some((opt) => opt.value === current)) sel.value = current;
}

async function seedCalMissing(pairs) {
  const keys = [...new Set(pairs.flatMap((row) => [
    row.near_ce_key, row.near_pe_key, row.far_ce_key, row.far_pe_key,
    row.near_fut_key, row.far_fut_key, row.eq_key,
  ].filter(Boolean)))];
  const need = keys.filter((key) => {
    const pair = pairs.find((row) => [
      row.near_ce_key, row.near_pe_key, row.far_ce_key, row.far_pe_key,
      row.near_fut_key, row.far_fut_key, row.eq_key,
    ].includes(key));
    if (!pair) return false;
    const token = [
      ["near_ce_key", "near_ce_token"], ["near_pe_key", "near_pe_token"],
      ["far_ce_key", "far_ce_token"], ["far_pe_key", "far_pe_token"],
      ["near_fut_key", "near_fut_token"], ["far_fut_key", "far_fut_token"],
      ["eq_key", "eq_token"],
    ].find(([field]) => pair[field] === key);
    const book = calBook(pair[token[1]]);
    return !(book.ltp > 0 || book.bid > 0 || book.ask > 0);
  });
  for (let i = 0; i < need.length; i += 40) {
    const chunk = need.slice(i, i + 40);
    setCalendarStatus(`Seeding calendar quotes… ${Math.min(i + chunk.length, need.length)}/${need.length}`);
    const data = await fetchJson(`/api/quotes?hist=false&keys=${encodeURIComponent(chunk.join(","))}`);
    applyCalIncomingBooks(data.books || {}, pairs, Date.now());
    refreshCalendar();
  }
}

async function startCalendarScanner() {
  if (!state.connected) {
    setCalendarStatus("Connect Zerodha first.");
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
  if (typeof stopButterflyScanner === "function") stopButterflyScanner();
  persistCalRates();
  const btn = calEl("cal-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Starting…";
  }
  try {
    const pair = (calEl("cal-pair") && calEl("cal-pair").value) || "near-next";
    const symbol = (calEl("cal-stock") && calEl("cal-stock").value) || "";
    const band = calNum("cal-band", 6);
    const maxStrikes = calNum("cal-max-strikes", symbol ? 11 : 3);
    const snapshot = await fetchJson(
      `/api/calendar-arb?seed=true&pair=${encodeURIComponent(pair)}&symbol=${encodeURIComponent(symbol)}&band=${encodeURIComponent(band)}&max_strikes=${encodeURIComponent(maxStrikes)}`,
    );
    calState.pairs = snapshot.pairs || [];
    calState.books = snapshot.books || {};
    calState.stocks = snapshot.stocks || [];
    calState.started = true;
    state.connected = Boolean(snapshot.connected);
    setPill(state.connected);
    fillCalStockSelect(calState.stocks);
    const bar = calEl("alert-bar");
    if (bar && (snapshot.message || snapshot.error)) {
      bar.classList.remove("hidden");
      bar.textContent = snapshot.message || snapshot.error;
    }
    refreshCalendar();
    setCalendarStatus("Seeding calendar quotes…");
    await seedCalMissing(calState.pairs);

    if (calState.ticker) {
      calState.ticker.close();
      calState.ticker = null;
    }
    const creds = await fetchJson("/api/ticker");
    if (creds.ws_url && calState.pairs.length) {
      calState.source = "Kite WebSocket";
      setCalendarStatus("Connecting ticker…");
      calState.ticker = connectKiteTicker({
        wsUrl: creds.ws_url,
        tokens: snapshot.tokens || [],
        onTicks: applyCalTicks,
        onStatus: setCalendarStatus,
      });
    } else {
      calState.source = "REST quotes";
      setCalendarStatus(creds.error || "WebSocket unavailable — snapshot quotes only.");
    }
    refreshCalendar();
  } catch (error) {
    setCalendarStatus(error.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Start scanner";
    }
  }
}

function stopCalendarScanner() {
  if (calState.ticker) calState.ticker.close();
  calState.ticker = null;
  calState.started = false;
  saveCalHist();
  setCalendarStatus("Stopped");
}

window.setInterval(() => {
  if (typeof state !== "undefined" && state.tab === "calendar") {
    refreshCalendar();
    saveCalHist();
  }
}, 30000);

window.startCalendarScanner = startCalendarScanner;
window.stopCalendarScanner = stopCalendarScanner;
window.refreshCalendar = refreshCalendar;
window.fillCalendarRates = fillCalRateForm;
window.persistCalendarRates = persistCalRates;

loadCalHist();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => fillCalRateForm(readCalStoredRates()));
} else {
  fillCalRateForm(readCalStoredRates());
}
