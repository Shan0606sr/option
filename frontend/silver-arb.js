const SIL_RATES_KEY = "silver_arb_rates_v1";

const silState = {
  pairs: [],
  books: {},
  ticker: null,
  started: false,
  source: "",
  rows: [],
  selected: null,
};

function silEl(id) {
  return document.getElementById(id);
}

function silNum(id, fallback) {
  const value = Number(silEl(id) && silEl(id).value);
  return Number.isFinite(value) ? value : fallback;
}

function silChecked(id) {
  return Boolean(silEl(id) && silEl(id).checked);
}

function readSilStoredRates() {
  try {
    return CallArbCharges.mergeRates(JSON.parse(localStorage.getItem(SIL_RATES_KEY) || "{}"));
  } catch (_err) {
    return CallArbCharges.mergeRates();
  }
}

function readSilFormRates() {
  const stored = readSilStoredRates();
  return CallArbCharges.mergeRates({
    ...stored,
    eq: {
      brokeragePct: silNum("sil-eq-brok", stored.eq.brokeragePct),
      sttPct: silNum("sil-eq-stt", stored.eq.sttPct),
      txnPct: silNum("sil-eq-txn", stored.eq.txnPct),
      stampBuyPct: silNum("sil-eq-stamp", stored.eq.stampBuyPct),
    },
    mcx: {
      brokeragePct: silNum("sil-mcx-brok", stored.mcx.brokeragePct),
      brokerageCap: silNum("sil-mcx-cap", stored.mcx.brokerageCap),
      cttSellPct: silNum("sil-mcx-ctt", stored.mcx.cttSellPct),
      txnPct: silNum("sil-mcx-txn", stored.mcx.txnPct),
      stampBuyPct: silNum("sil-mcx-stamp", stored.mcx.stampBuyPct),
    },
    gstPct: silNum("sil-gst", stored.gstPct),
    sebiPerCrore: silNum("sil-sebi", stored.sebiPerCrore),
    silver: {
      ...stored.silver,
      gramsPerUnit: silNum("sil-grams", stored.silver.gramsPerUnit),
      kgPerFutLot: silNum("sil-kg-lot", stored.silver.kgPerFutLot),
      nav: silNum("sil-nav", stored.silver.nav),
      minGrossPct: silNum("sil-min-gross", stored.silver.minGrossPct),
      targetPct: silNum("sil-target", stored.silver.targetPct),
      strongPct: silNum("sil-strong", stored.silver.strongPct),
      exceptionalPct: silNum("sil-except", stored.silver.exceptionalPct),
      maxNavDevPct: silNum("sil-max-nav", stored.silver.maxNavDevPct),
      syncMs: silNum("sil-sync", stored.silver.syncMs),
      fundingPct: silNum("sil-fund", stored.silver.fundingPct),
      marginPct: silNum("sil-margin-pct", stored.silver.marginPct),
      mtmBufferPct: silNum("sil-mtm", stored.silver.mtmBufferPct),
      slippageInrPerKg: silNum("sil-slip", stored.silver.slippageInrPerKg),
      slipSpreadFrac: silNum("sil-slip-spread", stored.silver.slipSpreadFrac),
      maxEtfSpreadPct: silNum("sil-etf-spread", stored.silver.maxEtfSpreadPct),
      maxFutSpreadPct: silNum("sil-fut-spread", stored.silver.maxFutSpreadPct),
    },
    lots: Math.max(1, Math.round(silNum("sil-lots", stored.lots) || 1)),
  });
}

function persistSilRates() {
  localStorage.setItem(SIL_RATES_KEY, JSON.stringify(readSilFormRates()));
}

function fillSilRateForm(rates) {
  const r = CallArbCharges.mergeRates(rates);
  const set = (id, value) => {
    if (silEl(id)) silEl(id).value = value;
  };
  set("sil-grams", r.silver.gramsPerUnit);
  set("sil-kg-lot", r.silver.kgPerFutLot);
  set("sil-nav", r.silver.nav);
  set("sil-lots", r.lots);
  set("sil-min-gross", r.silver.minGrossPct);
  set("sil-target", r.silver.targetPct);
  set("sil-strong", r.silver.strongPct);
  set("sil-except", r.silver.exceptionalPct);
  set("sil-max-nav", r.silver.maxNavDevPct);
  set("sil-sync", r.silver.syncMs);
  set("sil-fund", r.silver.fundingPct);
  set("sil-margin-pct", r.silver.marginPct);
  set("sil-mtm", r.silver.mtmBufferPct);
  set("sil-slip", r.silver.slippageInrPerKg);
  set("sil-slip-spread", r.silver.slipSpreadFrac);
  set("sil-etf-spread", r.silver.maxEtfSpreadPct);
  set("sil-fut-spread", r.silver.maxFutSpreadPct);
  set("sil-eq-brok", r.eq.brokeragePct);
  set("sil-eq-stt", r.eq.sttPct);
  set("sil-eq-txn", r.eq.txnPct);
  set("sil-eq-stamp", r.eq.stampBuyPct);
  set("sil-mcx-brok", r.mcx.brokeragePct);
  set("sil-mcx-cap", r.mcx.brokerageCap);
  set("sil-mcx-ctt", r.mcx.cttSellPct);
  set("sil-mcx-txn", r.mcx.txnPct);
  set("sil-mcx-stamp", r.mcx.stampBuyPct);
  set("sil-gst", r.gstPct);
  set("sil-sebi", r.sebiPerCrore);
}

function silBook(token) {
  return silState.books[String(token)] || {
    ltp: 0, bid: 0, ask: 0, bid_qty: 0, ask_qty: 0, bid_depth: 0, ask_depth: 0,
    volume: 0, oi: 0, ts: 0,
  };
}

function silLookup(books, ...keys) {
  for (const key of keys) {
    if (key && books[key]) return books[key];
    if (key && books[String(key)]) return books[String(key)];
  }
  return null;
}

function applySilIncomingBooks(books, pairs, ts) {
  if (!books) return;
  for (const pair of pairs) {
    for (const [token, key] of [[pair.etf_token, pair.etf_key], [pair.fut_token, pair.fut_key]]) {
      const q = silLookup(books, key, token);
      if (!q) continue;
      const prev = silBook(token);
      const ltp = Number(q.last_price || q.ltp || 0);
      silState.books[String(token)] = {
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

function silExecPx(book, side, session) {
  if (session.live) {
    const live = Number(book[side] || 0);
    if (live > 0) {
      return { price: live, qty: Number(book[`${side}_qty`] || 0), usedLtp: false, missing: false };
    }
    return { price: 0, qty: 0, usedLtp: false, missing: true };
  }
  const ltp = Number(book.ltp || 0);
  if (ltp > 0) return { price: ltp, qty: 0, usedLtp: true, missing: false };
  return { price: 0, qty: 0, usedLtp: true, missing: true };
}

function silSpreadPct(bid, ask) {
  if (!(bid > 0) || !(ask > 0)) return 0;
  return ((ask - bid) / ((ask + bid) / 2)) * 100;
}

function paintSilMode(session, method) {
  const box = silEl("sil-mode");
  if (!box) return;
  box.className = `synth-mode ${session.live ? "synth-mode-live" : "synth-mode-ltp"}`;
  if (silEl("sil-mode-label")) silEl("sil-mode-label").textContent = session.live ? "🟢 LIVE / EXECUTABLE" : "🟡 LTP / THEORETICAL";
  if (silEl("sil-mode-reason")) {
    silEl("sil-mode-reason").textContent = `${session.reason}. High-confidence labels require overlapping live ETF and MCX books.`;
  }
  if (silEl("sil-method")) silEl("sil-method").textContent = `${method.label} · (B) buy · (S) sell`;
}

function classifySilRow(row) {
  if (row.dataInvalid) return { status: "INVALID", label: "⚫ DATA INVALID", reason: row.reasons[0] || "missing data" };
  if (!(row.netKg > 0)) return { status: "RED", label: "🔴 REJECT", reason: "net spread ≤ 0 after costs and slippage" };
  if (!row.live) return { status: "YELLOW", label: "🟡 INVESTIGATE", reason: "LTP / theoretical — ETF and MCX were not in the overlap window" };
  if (!row.executable) return { status: "YELLOW", label: "🟡 INVESTIGATE", reason: row.reasons[0] || "not executable" };
  if (row.reasons.length) return { status: "YELLOW", label: "🟡 INVESTIGATE", reason: row.reasons[0] };
  if (row.netPct + 1e-9 < row.minGrossPct) return { status: "YELLOW", label: "🟡 INVESTIGATE", reason: `net ${row.netPct.toFixed(2)}% below ${row.minGrossPct}% threshold` };
  return { status: "GREEN", label: "🟢 HIGH CONFIDENCE", reason: "executable net spread after costs, liquidity and overlap" };
}

function evaluateSilSide(pair, buyEtf, session, rates) {
  const etfB = silBook(pair.etf_token);
  const futB = silBook(pair.fut_token);
  const grams = rates.silver.gramsPerUnit || pair.grams_per_unit || 1;
  const units = CallArbCharges.unitsPerKg(grams);
  const hedge = CallArbCharges.silverHedge({
    gramsPerUnit: grams,
    futLotSize: pair.lot_size,
    kgPerFutLot: rates.silver.kgPerFutLot || pair.kg_per_lot || 1,
    lots: rates.lots,
  });
  const etfPx = silExecPx(etfB, buyEtf ? "ask" : "bid", session);
  const futPx = silExecPx(futB, buyEtf ? "bid" : "ask", session);
  const reasons = [];
  const incomplete = etfPx.missing || futPx.missing || !(units > 0);
  if (!(units > 0)) reasons.push("ETF silver-equivalent grams per unit is missing");
  if (etfPx.missing) reasons.push("missing ETF quote");
  if (futPx.missing) reasons.push("missing MCX quote");

  const etfKg = incomplete ? 0 : CallArbCharges.etfPerKg(etfPx.price, grams);
  const futKg = incomplete ? 0 : futPx.price;
  const ltpEtfKg = CallArbCharges.etfPerKg(etfB.ltp, grams);
  const ltpFutKg = Number(futB.ltp || 0);
  const theoGross = ltpEtfKg > 0 && ltpFutKg > 0
    ? (buyEtf ? ltpFutKg - ltpEtfKg : ltpEtfKg - ltpFutKg)
    : 0;
  const execGross = incomplete ? 0 : (buyEtf ? futKg - etfKg : etfKg - futKg);
  const basisPx = buyEtf ? etfKg : futKg;
  const execPct = basisPx > 0 ? (execGross / basisPx) * 100 : 0;
  const theoPct = ltpEtfKg > 0 ? (theoGross / ltpEtfKg) * 100 : 0;
  const days = Number(pair.days) || 0;

  if (session.live && etfB.ts && futB.ts && Math.abs(etfB.ts - futB.ts) > rates.silver.syncMs) {
    reasons.push("ETF and MCX timestamps outside the sync window");
  }
  const etfSpread = silSpreadPct(etfB.bid, etfB.ask);
  const futSpread = silSpreadPct(futB.bid, futB.ask);
  if (session.live && etfSpread > rates.silver.maxEtfSpreadPct) reasons.push("ETF bid/ask too wide");
  if (session.live && futSpread > rates.silver.maxFutSpreadPct) reasons.push("MCX bid/ask too wide");
  if (session.live && !incomplete && etfPx.qty < hedge.etfUnits) reasons.push("ETF top-of-book qty below hedge");
  if (session.live && !incomplete && futPx.qty < hedge.futQty) reasons.push("MCX top-of-book qty below 1 lot");

  const nav = rates.silver.nav;
  const navPrem = CallArbCharges.navPremiumPct(etfPx.price || etfB.ltp, nav);
  if (navPrem != null && Math.abs(navPrem) > rates.silver.maxNavDevPct) {
    reasons.push(`ETF vs NAV ${navPrem.toFixed(2)}% exceeds ${rates.silver.maxNavDevPct}%`);
  }

  const charges = incomplete
    ? { total: 0, legs: [] }
    : CallArbCharges.silverSpreadCharges({
      buyEtf,
      etfPx: etfPx.price,
      futPx: futPx.price,
      etfQty: hedge.etfUnits,
      futQty: hedge.futQty,
      rates,
    });
  const slipKg = CallArbCharges.silverSlippagePerKg({
    etfBid: etfB.bid || etfPx.price,
    etfAsk: etfB.ask || etfPx.price,
    futBid: futB.bid || futPx.price,
    futAsk: futB.ask || futPx.price,
    gramsPerUnit: grams,
    rates,
  });
  const capital = CallArbCharges.estimateSilverCapital({
    etfPx: etfPx.price,
    futPx: futPx.price,
    etfQty: hedge.etfUnits,
    futQty: hedge.futQty,
    kg: hedge.kg,
    rates,
  });
  const costKg = hedge.kg ? charges.total / hedge.kg : 0;
  const funding = CallArbCharges.silverFundingCost({ capital: capital.required, days, rates });
  const fundingKg = hedge.kg ? funding / hedge.kg : 0;
  const netKg = incomplete ? 0 : execGross - costKg - slipKg - fundingKg;
  const netPct = capital.required > 0 ? (netKg * hedge.kg / capital.required) * 100 : 0;
  const executable = session.live && !incomplete && etfPx.qty >= hedge.etfUnits && futPx.qty >= hedge.futQty
    && !(etfB.ts && futB.ts && Math.abs(etfB.ts - futB.ts) > rates.silver.syncMs);

  const row = {
    id: `sil|${pair.etf_symbol}|${pair.fut_symbol}|${buyEtf ? "A" : "B"}|${hedge.futQty}`,
    pair,
    buyEtf,
    sideLabel: buyEtf
      ? `BUY ${hedge.etfUnits.toLocaleString("en-IN")} ${pair.etf_symbol} · SELL ${hedge.futQty} ${pair.fut_symbol}`
      : `SELL ${hedge.etfUnits.toLocaleString("en-IN")} ${pair.etf_symbol} · BUY ${hedge.futQty} ${pair.fut_symbol}`,
    etf: pair.etf_symbol,
    fut: pair.fut_symbol,
    expiry: pair.expiry,
    days,
    grams,
    units,
    hedge,
    etfPx: etfPx.price,
    futPx: futPx.price,
    etfKg,
    futKg,
    execGross,
    execPct,
    theoGross,
    theoPct,
    charges,
    costKg,
    slipKg,
    fundingKg,
    netKg,
    netPct,
    capital,
    nav,
    navPrem,
    live: session.live,
    usedLtp: etfPx.usedLtp || futPx.usedLtp,
    incomplete,
    dataInvalid: incomplete || !(units > 0),
    executable,
    minGrossPct: rates.silver.minGrossPct,
    reasons: [...new Set(reasons)],
    ts: { etf: etfB.ts, fut: futB.ts },
    method: CallArbCharges.silverMethodology(),
    annualSimple: CallArbCharges.annualizeSimple(execPct, days),
    annualCompound: CallArbCharges.annualizeCompound(execPct, days),
  };
  const cls = classifySilRow(row);
  row.status = cls.status;
  row.statusLabel = cls.label;
  row.statusReason = cls.reason;
  return row;
}

function evaluateSilverArb() {
  const session = typeof silverOverlapSession === "function" ? silverOverlapSession() : nseSession();
  const rates = readSilFormRates();
  const method = CallArbCharges.silverMethodology();
  paintSilMode(session, method);
  const rows = [];
  for (const pair of silState.pairs) {
    rows.push(evaluateSilSide(pair, true, session, rates));
    if (!silEl("sil-side-b") || silChecked("sil-side-b")) {
      rows.push(evaluateSilSide(pair, false, session, rates));
    }
  }
  const rank = { GREEN: 0, YELLOW: 1, RED: 2, INVALID: 3 };
  rows.sort((a, b) => {
    const rs = rank[a.status] - rank[b.status];
    if (rs) return rs;
    return (b.netKg - a.netKg) || (b.execGross - a.execGross) || a.days - b.days;
  });
  silState.rows = rows;
  return rows;
}

function visibleSilver(rows) {
  const minNet = silNum("sil-min-net", 0);
  const showNo = silChecked("sil-show-no");
  const showA = !silEl("sil-side-a") || silChecked("sil-side-a");
  const showB = !silEl("sil-side-b") || silChecked("sil-side-b");
  return rows.filter((row) => {
    if (row.buyEtf && !showA) return false;
    if (!row.buyEtf && !showB) return false;
    if (row.dataInvalid) return showNo;
    if (row.status === "RED") return showNo;
    if (row.netKg + 1e-9 < minNet) return false;
    return true;
  });
}

function setSilStatus(text) {
  const el = silEl("sil-status");
  if (el) el.textContent = `${text}${silState.source ? ` · ${silState.source}` : ""}`;
}

function silMark(buy) {
  return `<span class="side-mark ${buy ? "side-buy" : "side-sell"}">${buy ? "(B)" : "(S)"}</span>`;
}

function silMoneySide(price, buy, incomplete) {
  if (incomplete || !(Number(price) > 0)) return "—";
  return `${money(price)} ${silMark(buy)}`;
}

function renderSilverRows(rows) {
  const body = silEl("sil-body");
  const empty = silEl("sil-empty");
  const term = silEl("sil-term-body");
  if (!body) return;
  body.innerHTML = "";
  const visible = visibleSilver(rows);
  const green = rows.filter((row) => row.status === "GREEN").length;
  if (silEl("opp-count") && state.tab === "silver") {
    silEl("opp-count").textContent = `${green} high-confidence / ${visible.length} shown`;
    silEl("stocks-scanned").textContent = String(new Set(silState.pairs.map((row) => row.etf_symbol)).size);
  }
  if (!visible.length) {
    empty.classList.remove("hidden");
    empty.textContent = silState.pairs.length
      ? (silverOverlapSession().live
        ? "No executable ETF/MCX basis after costs, slippage and filters."
        : "No theoretical LTP edge after costs. After 15:30 IST the ETF last price is never compared as a live hedge against MCX.")
      : "Connect Zerodha, then start the Silver ETF vs MCX scanner.";
  } else {
    empty.classList.add("hidden");
    for (const row of visible) {
      const tr = document.createElement("tr");
      tr.className = row.status === "GREEN" ? "hit" : row.status === "YELLOW" ? "theo" : row.status === "INVALID" ? "nodata" : "miss";
      tr.dataset.id = row.id;
      tr.title = row.statusReason;
      tr.innerHTML = `
        <td>
          <div class="stock-cell">
            <strong>${row.etf}</strong>
            <span class="stock-meta">${row.buyEtf ? "A · buy ETF / sell future" : "B · buy future / sell ETF"}</span>
          </div>
        </td>
        <td>${row.fut}</td>
        <td>${fmtExpiryLong(row.expiry)}</td>
        <td class="num">${row.incomplete ? "—" : money(row.etfKg)}</td>
        <td class="num">${row.incomplete ? "—" : money(row.futKg)}</td>
        <td class="num">${row.incomplete ? "—" : `${row.execPct > 0 ? "+" : ""}${pct(row.execPct)}`}</td>
        <td class="num ${row.netKg > 0 ? "signal-yes" : "signal-no"}">${row.incomplete ? "—" : `${row.netPct > 0 ? "+" : ""}${pct(row.netPct)}`}</td>
        <td class="num">${row.days}</td>
        <td class="${row.status === "GREEN" ? "signal-yes" : row.status === "RED" ? "signal-no-red" : "signal-no"}">${row.statusLabel}</td>
      `;
      tr.addEventListener("click", () => openSilDrawer(row));
      body.appendChild(tr);
    }
  }

  if (term) {
    term.innerHTML = "";
    const aRows = rows.filter((row) => row.buyEtf).sort((a, b) => a.days - b.days);
    for (const row of aRows) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${fmtExpiryLong(row.expiry)}</td>
        <td class="num">${row.days}</td>
        <td class="num">${row.incomplete ? "—" : money(row.etfKg)}</td>
        <td class="num">${row.incomplete ? "—" : money(row.futKg)}</td>
        <td class="num">${row.incomplete ? "—" : money(row.execGross)}</td>
        <td class="num">${row.incomplete ? "—" : pct(row.execPct)}</td>
        <td class="num">${row.incomplete || !(row.days > 0) ? "—" : pct(row.annualSimple)}</td>
      `;
      term.appendChild(tr);
    }
  }
}

function silChargeLines(leg) {
  if (!leg) return "";
  return `${money(leg.total)} · brk ${money(leg.brokerage)} · STT/CTT ${money(leg.stt)} · txn ${money(leg.txn)} · GST ${money(leg.gst)} · SEBI ${money(leg.sebi)} · stamp ${money(leg.stamp)}`;
}

function openSilDrawer(row) {
  silState.selected = row.id;
  const drawer = silEl("drawer");
  drawer.classList.add("wide");
  silEl("d-symbol").textContent = `${row.etf} / ${row.fut} · ${row.statusLabel}`;
  silEl("d-name").textContent = row.sideLabel;
  const legs = row.charges.legs || [];
  const ts = (ms) => ms ? new Date(ms).toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" }) : "—";
  silEl("drawer-body").innerHTML = `
    <p class="badge ${row.status === "GREEN" ? "net" : ""}">${row.statusLabel}</p>
    <p class="index-meta">${row.statusReason}</p>
    <div class="kv">
      ${kv("ETF", `${row.etf} · ${row.grams} g silver / unit`)}
      ${kv("Future", row.fut)}
      ${kv("Expiry", fmtExpiryLong(row.expiry))}
      ${kv("Days to expiry", String(row.days))}
      ${kv("Hedge", row.sideLabel)}
      ${kv("Mode", row.live ? "LIVE overlap" : "LTP / theoretical")}
      ${kv("Methodology", row.method.label)}
    </div>
    <hr class="rule" />
    <div class="legs">
      <div class="leg"><em>${row.buyEtf ? "BUY" : "SELL"} ${row.etf}</em><span>${row.hedge.etfUnits.toLocaleString("en-IN")} @ ${row.etfPx ? money(row.etfPx) : "—"} ${silMark(row.buyEtf)}</span></div>
      <div class="leg"><em>${row.buyEtf ? "SELL" : "BUY"} ${row.fut}</em><span>${row.hedge.futQty} @ ${row.futPx ? money(row.futPx) : "—"} ${silMark(!row.buyEtf)}</span></div>
    </div>
    <hr class="rule" />
    <div class="kv">
      ${kv("ETF ₹/kg", row.incomplete ? "—" : money(row.etfKg))}
      ${kv("Futures ₹/kg", row.incomplete ? "—" : money(row.futKg))}
      ${kv(row.usedLtp ? "LTP gross ₹/kg" : "Executable gross ₹/kg", row.incomplete ? "—" : money(row.execGross))}
      ${kv(row.usedLtp ? "LTP gross %" : "Executable gross %", row.incomplete ? "—" : pct(row.execPct))}
      ${kv("LTP theoretical ₹/kg", money(row.theoGross))}
      ${kv("Annualized simple", row.days ? pct(row.annualSimple) : "—")}
      ${kv("Annualized compounded", row.days ? pct(row.annualCompound) : "—")}
      ${kv("ETF vs NAV", row.navPrem == null ? "NAV not set" : pct(row.navPrem))}
      ${kv("ETF charges", silChargeLines(legs[0]))}
      ${kv("MCX charges", silChargeLines(legs[1]))}
      ${kv("Estimated costs / kg", money(row.costKg))}
      ${kv("Slippage / kg", money(row.slipKg))}
      ${kv("Funding / kg", money(row.fundingKg))}
      ${kv("Net ₹/kg", money(row.netKg), row.netKg > 0 ? "net" : "")}
      ${kv("Net return on capital", pct(row.netPct), row.netPct > 0 ? "net" : "")}
      ${kv("ETF capital", money(row.capital.etfCapital))}
      ${kv("Futures margin (est.)", money(row.capital.futMargin))}
      ${kv("MTM buffer (est.)", money(row.capital.mtmBuffer))}
      ${kv("Total capital (est.)", money(row.capital.required))}
      ${kv("ETF quote ts", ts(row.ts.etf))}
      ${kv("MCX quote ts", ts(row.ts.fut))}
    </div>
    <p class="footnote">Identification only. This is a basis / convergence opportunity, not a guaranteed or locked profit. No order is sent. Annualized return is not evidence the trade is risk-free.</p>
  `;
  drawer.hidden = false;
  silEl("backdrop").hidden = false;
}

function refreshSilverArb() {
  if (typeof state === "undefined" || state.tab !== "silver") return;
  const rows = evaluateSilverArb();
  renderSilverRows(rows);
  const now = new Date().toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" });
  if (silEl("last-update")) silEl("last-update").textContent = now;
}

let silPaint = 0;
function applySilTicks(ticks) {
  const now = Date.now();
  for (const tick of ticks) {
    const prev = silBook(tick.instrument_token);
    silState.books[String(tick.instrument_token)] = {
      ...prev,
      ltp: tick.ltp || prev.ltp,
      bid: tick.bid || prev.bid,
      ask: tick.ask || prev.ask,
      bid_qty: tick.bid_qty || prev.bid_qty,
      ask_qty: tick.ask_qty || prev.ask_qty,
      bid_depth: tick.bid_depth || tick.bid_qty || prev.bid_depth,
      ask_depth: tick.ask_depth || tick.ask_qty || prev.ask_depth,
      ts: now,
    };
  }
  if (!silPaint) {
    silPaint = window.requestAnimationFrame(() => {
      silPaint = 0;
      refreshSilverArb();
    });
  }
}

async function startSilverArbScanner() {
  if (!state.connected) {
    setSilStatus("Connect Zerodha first.");
    return;
  }
  if (typeof stopSynthScanner === "function") stopSynthScanner();
  if (typeof stopCallArbScanner === "function") stopCallArbScanner();
  if (typeof stopPutArbScanner === "function") stopPutArbScanner();
  if (typeof stopBoxArbScanner === "function") stopBoxArbScanner();
  if (typeof stopVertCeScanner === "function") stopVertCeScanner();
  if (typeof stopVertPeScanner === "function") stopVertPeScanner();
  if (typeof stopOptionRvScanner === "function") stopOptionRvScanner();
  if (typeof stopButterflyScanner === "function") stopButterflyScanner();
  if (typeof stopCalendarScanner === "function") stopCalendarScanner();
  persistSilRates();
  const btn = silEl("sil-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Starting…";
  }
  try {
    const etf = (silEl("sil-etf") && silEl("sil-etf").value) || "SILVERBEES";
    const future = (silEl("sil-fut") && silEl("sil-fut").value) || "SILVERMIC";
    const snapshot = await fetchJson(
      `/api/silver-arb?seed=true&etf=${encodeURIComponent(etf)}&future=${encodeURIComponent(future)}`,
    );
    silState.pairs = snapshot.pairs || [];
    silState.books = snapshot.books || {};
    silState.started = true;
    state.connected = Boolean(snapshot.connected);
    setPill(state.connected);
    const bar = silEl("alert-bar");
    if (bar && (snapshot.message || snapshot.error)) {
      bar.classList.remove("hidden");
      bar.textContent = snapshot.message || snapshot.error;
    }
    applySilIncomingBooks(snapshot.books || {}, silState.pairs, Date.now());
    refreshSilverArb();

    if (silState.ticker) {
      silState.ticker.close();
      silState.ticker = null;
    }
    const creds = await fetchJson("/api/ticker");
    if (creds.ws_url && silState.pairs.length) {
      silState.source = "Kite WebSocket";
      setSilStatus("Connecting ticker…");
      silState.ticker = connectKiteTicker({
        wsUrl: creds.ws_url,
        tokens: snapshot.tokens || [],
        onTicks: applySilTicks,
        onStatus: setSilStatus,
      });
    } else {
      silState.source = "REST quotes";
      setSilStatus(creds.error || "WebSocket unavailable — snapshot quotes only.");
    }
    refreshSilverArb();
  } catch (error) {
    setSilStatus(error.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Start scanner";
    }
  }
}

function stopSilverArbScanner() {
  if (silState.ticker) silState.ticker.close();
  silState.ticker = null;
  silState.started = false;
  setSilStatus("Stopped");
}

window.setInterval(() => {
  if (typeof state !== "undefined" && state.tab === "silver") refreshSilverArb();
}, 30000);

window.startSilverArbScanner = startSilverArbScanner;
window.stopSilverArbScanner = stopSilverArbScanner;
window.refreshSilverArb = refreshSilverArb;
window.fillSilverRates = fillSilRateForm;
window.persistSilverRates = persistSilRates;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => fillSilRateForm(readSilStoredRates()));
} else {
  fillSilRateForm(readSilStoredRates());
}
