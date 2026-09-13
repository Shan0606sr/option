const SYNTH_LOG_KEY = "synth_future_log_v1";
// 15-Sep 22550 CSV check (after hours): Call LTP missing, Put LTP 3.20
// → NO DATA. Must not become 22550 + stale_close − 3.20 = 24621.05.
// Live executable, if the book is used: buy 22550 + 1018.85 − 3.15 = 23565.70;
// sell 22550 + 708.10 − 3.35 = 23254.75.
const SYNTH_LOG_MAX = 4000;

const synthState = {
  pairs: [],
  books: {},
  ticker: null,
  started: false,
  source: "",
};

function synthNum(id, fallback) {
  const value = Number(document.getElementById(id).value);
  return Number.isFinite(value) ? value : fallback;
}

function synthCosts(lot) {
  const allIn = synthNum("synth-allin", 80);
  const slipF = synthNum("synth-slip-fut", 0.5);
  const slipO = synthNum("synth-slip-opt", 0.05);
  const perShare = (lot ? allIn / lot : 0) + slipF + slipO * 2;
  return { allIn, slipF, slipO, perShare };
}

function synthBook(token) {
  return synthState.books[String(token)] || { ltp: 0, bid: 0, ask: 0, bid_qty: 0, ask_qty: 0 };
}

function execPx(book, side, session) {
  if (session.live) {
    const live = Number(book[side] || 0);
    if (live > 0) return { price: live, qty: Number(book[`${side}_qty`] || 0), usedLtp: false, missing: false };
    return { price: 0, qty: 0, usedLtp: false, missing: true };
  }
  const ltp = Number(book.ltp || 0);
  if (ltp > 0) return { price: ltp, qty: 0, usedLtp: true, missing: false };
  return { price: 0, qty: 0, usedLtp: true, missing: true };
}

function paintSynthMode(session) {
  const box = document.getElementById("synth-mode");
  const label = document.getElementById("synth-mode-label");
  const reason = document.getElementById("synth-mode-reason");
  if (!box) return;
  box.className = `synth-mode ${session.live ? "synth-mode-live" : "synth-mode-ltp"}`;
  label.textContent = session.live ? "🟢 LIVE / EXECUTABLE" : "🟡 LTP / THEORETICAL";
  reason.textContent = session.reason;
}

function readSynthLog() {
  try {
    return JSON.parse(localStorage.getItem(SYNTH_LOG_KEY) || "[]");
  } catch (_err) {
    return [];
  }
}

function appendSynthLog(entries) {
  if (!entries.length) return;
  const log = readSynthLog();
  log.push(...entries);
  localStorage.setItem(SYNTH_LOG_KEY, JSON.stringify(log.slice(-SYNTH_LOG_MAX)));
  const count = document.getElementById("synth-log-count");
  if (count) count.textContent = String(Math.min(log.length, SYNTH_LOG_MAX));
}

function downloadSynthLog() {
  const rows = readSynthLog();
  const header = [
    "ts", "expiry", "strike", "side", "fut_bid", "fut_ask", "ce_bid", "ce_ask", "pe_bid", "pe_ask",
    "synth", "future", "gross", "cost", "net", "net_lot", "mode", "executable", "used_ltp", "no_data", "shown",
  ];
  const lines = [header.join(",")].concat(rows.map((row) => header.map((key) => row[key] ?? "").join(",")));
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `synthetic-futures-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function evaluateSynth() {
  const session = nseSession();
  paintSynthMode(session);
  const minNet = synthNum("synth-min-net", 0);
  const rows = [];
  const logs = [];
  const now = new Date().toISOString();

  for (const pair of synthState.pairs) {
    const ce = synthBook(pair.ce_token);
    const pe = synthBook(pair.pe_token);
    const fut = synthBook(pair.fut_token);
    const lot = pair.lot_size || 65;
    const cost = synthCosts(lot);

    if (!session.live && !(ce.ltp > 0 && pe.ltp > 0 && fut.ltp > 0)) {
      logs.push({
        ts: now,
        expiry: pair.expiry,
        strike: pair.strike,
        side: "NO DATA",
        fut_bid: fut.bid,
        fut_ask: fut.ask,
        ce_bid: ce.bid,
        ce_ask: ce.ask,
        pe_bid: pe.bid,
        pe_ask: pe.ask,
        synth: "",
        future: fut.ltp || "",
        gross: "",
        cost: "",
        net: "",
        net_lot: "",
        mode: session.mode,
        executable: false,
        used_ltp: true,
        no_data: true,
        shown: true,
      });
      rows.push({
        ...pair,
        noData: true,
        executable: false,
        usedLtp: true,
        mode: session.mode,
        side: "—",
      });
      continue;
    }

    const legs = {
      buySynth: {
        side: "Buy synth / sell fut",
        ce: execPx(ce, "ask", session),
        pe: execPx(pe, "bid", session),
        fut: execPx(fut, "bid", session),
        synth: (cePx, pePx) => pair.strike + cePx - pePx,
        future: (futPx) => futPx,
        gross: (synth, future) => future - synth,
      },
      sellSynth: {
        side: "Sell synth / buy fut",
        ce: execPx(ce, "bid", session),
        pe: execPx(pe, "ask", session),
        fut: execPx(fut, "ask", session),
        synth: (cePx, pePx) => pair.strike + cePx - pePx,
        future: (futPx) => futPx,
        gross: (synth, future) => synth - future,
      },
    };

    for (const spec of Object.values(legs)) {
      const missing = spec.ce.missing || spec.pe.missing || spec.fut.missing;
      const ready = !missing && spec.ce.price && spec.pe.price && spec.fut.price;
      const synthPx = ready ? spec.synth(spec.ce.price, spec.pe.price) : 0;
      const futPx = ready ? spec.future(spec.fut.price) : 0;
      const gross = ready ? spec.gross(synthPx, futPx) : 0;
      const net = ready ? gross - cost.perShare : 0;
      const usedLtp = !session.live;
      const executable = Boolean(session.live && ready);
      const shown = Boolean(ready && net > minNet);
      const qty = executable ? Math.min(lot, spec.ce.qty || 0, spec.pe.qty || 0, spec.fut.qty || 0) : 0;
      logs.push({
        ts: now,
        expiry: pair.expiry,
        strike: pair.strike,
        side: spec.side,
        fut_bid: fut.bid,
        fut_ask: fut.ask,
        ce_bid: ce.bid,
        ce_ask: ce.ask,
        pe_bid: pe.bid,
        pe_ask: pe.ask,
        synth: synthPx,
        future: futPx,
        gross,
        cost: cost.perShare,
        net,
        net_lot: net * lot,
        mode: session.mode,
        executable,
        used_ltp: usedLtp,
        no_data: false,
        shown,
      });
      if (!shown) continue;
      rows.push({
        ...pair,
        side: spec.side,
        synth: synthPx,
        future: futPx,
        gross,
        cost: cost.perShare,
        net,
        net_lot: net * lot,
        qty,
        usedLtp,
        executable,
        mode: session.mode,
        ce: spec.ce.price,
        pe: spec.pe.price,
      });
    }
  }

  appendSynthLog(logs);
  rows.sort((a, b) => Number(Boolean(b.noData)) - Number(Boolean(a.noData)) || (b.net || 0) - (a.net || 0));
  return rows;
}

function renderSynthRows(rows) {
  const body = document.getElementById("synth-body");
  const empty = document.getElementById("synth-empty");
  body.innerHTML = "";
  document.getElementById("opp-count").textContent = `${rows.length} edges`;
  document.getElementById("stocks-scanned").textContent = String(synthState.pairs.length);
  if (!rows.length) {
    empty.classList.remove("hidden");
    empty.textContent = synthState.pairs.length
      ? (nseSession().live
        ? "No LIVE / EXECUTABLE quote. Missing bid or ask is skipped — LTP is not used in session."
        : "No theoretical LTP edge after costs. These after-hours rows are never executable.")
      : "Connect Zerodha, then start the NIFTY scanner.";
    return;
  }
  empty.classList.add("hidden");
  const visible = rows.filter((row) => row.noData || row.net > 0);
  visible.sort((a, b) => Number(Boolean(b.noData)) - Number(Boolean(a.noData)) || (b.net || 0) - (a.net || 0));
  if (!visible.length) {
    empty.classList.remove("hidden");
    empty.textContent = synthState.pairs.length
      ? (nseSession().live
        ? "No LIVE / EXECUTABLE quote. Missing bid or ask is skipped — LTP is not used in session."
        : "No theoretical LTP edge after costs. Missing LTP is NO DATA, not a filled-in price.")
      : "Connect Zerodha, then start the NIFTY scanner.";
    return;
  }
  empty.classList.add("hidden");
  for (const row of visible) {
    const tr = document.createElement("tr");
    if (row.noData) {
      tr.className = "nodata";
      tr.innerHTML = `
        <td>${row.expiry ? fmtExpiry(row.expiry) : "—"}</td>
        <td class="num">${inr(row.strike, 0)}</td>
        <td>—</td>
        <td class="num">—</td>
        <td class="num signal-no">NO DATA</td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td class="signal-no">NO DATA</td>
      `;
      body.appendChild(tr);
      continue;
    }
    tr.className = row.executable ? "hit" : "theo";
    tr.innerHTML = `
      <td>${row.expiry ? fmtExpiry(row.expiry) : "—"}</td>
      <td class="num">${inr(row.strike, 0)}</td>
      <td>${row.side}</td>
      <td class="num">${money(row.future)}</td>
      <td class="num">${money(row.synth)}</td>
      <td class="num">${row.gross > 0 ? "+" : ""}${inr(row.gross)}</td>
      <td class="num">${inr(row.cost)}</td>
      <td class="num signal-yes">${row.net > 0 ? "+" : ""}${inr(row.net)}</td>
      <td class="num signal-yes">${row.net_lot > 0 ? "+" : ""}${inr(row.net_lot)}</td>
      <td class="num">${row.executable ? (row.qty || "—") : "—"}</td>
      <td class="${row.executable ? "signal-yes" : "signal-no"}">${row.executable ? "LIVE / EXECUTABLE" : "LTP / THEORETICAL"}</td>
    `;
    body.appendChild(tr);
  }
}

function refreshSynth() {
  if (state.tab !== "synth") return;
  const rows = evaluateSynth();
  renderSynthRows(rows);
  const now = new Date().toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" });
  document.getElementById("last-update").textContent = now;
}

function applySynthTicks(ticks) {
  for (const tick of ticks) {
    synthState.books[String(tick.instrument_token)] = {
      ltp: tick.ltp || 0,
      bid: tick.bid || 0,
      ask: tick.ask || 0,
      bid_qty: tick.bid_qty || 0,
      ask_qty: tick.ask_qty || 0,
    };
  }
  refreshSynth();
}

function setSynthStatus(text) {
  const el = document.getElementById("synth-status");
  if (el) el.textContent = `${text}${synthState.source ? ` · ${synthState.source}` : ""}`;
}

async function startSynthScanner() {
  if (!state.connected) {
    setSynthStatus("Connect Zerodha first.");
    return;
  }
  if (typeof stopCallArbScanner === "function") stopCallArbScanner();
  if (typeof stopPutArbScanner === "function") stopPutArbScanner();
  if (typeof stopBoxArbScanner === "function") stopBoxArbScanner();
  if (typeof stopVertCeScanner === "function") stopVertCeScanner();
  if (typeof stopVertPeScanner === "function") stopVertPeScanner();
  const expiry = document.getElementById("synth-expiry").value || "nearest";
  const btn = document.getElementById("synth-btn");
  btn.disabled = true;
  btn.textContent = "Starting…";
  try {
    const snapshot = await fetchJson(`/api/synth?seed=true&expiry=${encodeURIComponent(expiry)}`);
    synthState.pairs = snapshot.pairs || [];
    synthState.books = snapshot.books || {};
    synthState.started = true;
    state.connected = Boolean(snapshot.connected);
    setPill(state.connected);
    const bar = document.getElementById("alert-bar");
    if (snapshot.message || snapshot.error) {
      bar.classList.remove("hidden");
      bar.textContent = snapshot.message || snapshot.error;
    }
    refreshSynth();

    if (synthState.ticker) {
      synthState.ticker.close();
      synthState.ticker = null;
    }
    const creds = await fetchJson("/api/ticker");
    if (creds.ws_url && synthState.pairs.length) {
      synthState.source = "Kite WebSocket";
      setSynthStatus("Connecting ticker…");
      synthState.ticker = connectKiteTicker({
        wsUrl: creds.ws_url,
        tokens: snapshot.tokens || [],
        onTicks: applySynthTicks,
        onStatus: setSynthStatus,
      });
    } else {
      synthState.source = "REST quotes";
      setSynthStatus(creds.error || "WebSocket unavailable — using snapshot quotes.");
    }
  } catch (error) {
    setSynthStatus(error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Start scanner";
  }
}

function stopSynthScanner() {
  if (synthState.ticker) synthState.ticker.close();
  synthState.ticker = null;
  synthState.started = false;
  setSynthStatus("Stopped");
}

window.setInterval(() => {
  if (typeof state !== "undefined" && state.tab === "synth") refreshSynth();
}, 30000);

window.startSynthScanner = startSynthScanner;
window.stopSynthScanner = stopSynthScanner;
window.refreshSynth = refreshSynth;
window.downloadSynthLog = downloadSynthLog;
