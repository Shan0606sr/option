const { loadInstruments, quoteMany, lookupQuote, isIndex, rowToken } = require("./kite");

const TOKEN_CAP = 2800;

function upcomingExpiries(rows, today, name, type) {
  const found = new Set();
  for (const row of rows) {
    if (row.name !== name || row.instrument_type !== type) continue;
    const exp = (row.expiry || "").slice(0, 10);
    if (exp && exp >= today) found.add(exp);
  }
  return [...found].sort();
}

function bookFromQuote(q) {
  if (!q) return { ltp: 0, bid: 0, ask: 0, bid_qty: 0, ask_qty: 0, bid_depth: 0, ask_depth: 0, ts: 0 };
  const ltp = Number(q.last_price || q.ltp || 0);
  return {
    ltp,
    bid: Number(q.bid || 0),
    ask: Number(q.ask || 0),
    bid_qty: Number(q.bid_qty || 0),
    ask_qty: Number(q.ask_qty || 0),
    bid_depth: Number(q.bid_depth || q.bid_qty || 0),
    ask_depth: Number(q.ask_depth || q.ask_qty || 0),
    ts: 0,
  };
}

function pickStrikes(strikes, futurePx, bandPct, maxStrikes) {
  const unique = [...new Set(strikes.map(Number).filter((n) => n > 0))].sort((a, b) => a - b);
  if (!unique.length) return [];
  const px = Number(futurePx);
  if (!(px > 0)) return unique.slice(0, Math.max(1, Number(maxStrikes) || 5));
  const band = Number(bandPct);
  const pool = band > 0
    ? unique.filter((strike) => Math.abs(strike - px) / px <= band / 100)
    : unique;
  const ranked = (pool.length ? pool : unique)
    .slice()
    .sort((a, b) => Math.abs(a - px) - Math.abs(b - px) || a - b);
  const keep = Number(maxStrikes) > 0 ? ranked.slice(0, Number(maxStrikes)) : ranked;
  return keep.sort((a, b) => a - b);
}

function buildStockUniverse(nfo, today) {
  const futsByName = new Map();
  const pairsByName = new Map();

  for (const row of nfo) {
    if (isIndex(row.name) || !row.name) continue;
    const expiry = (row.expiry || "").slice(0, 10);
    if (!expiry || expiry < today) continue;
    if (row.instrument_type === "FUT") {
      if (!futsByName.has(row.name)) futsByName.set(row.name, []);
      futsByName.get(row.name).push({
        name: row.name,
        expiry,
        token: rowToken(row),
        key: `NFO:${row.tradingsymbol}`,
        tradingsymbol: row.tradingsymbol,
        lot_size: Number(row.lot_size) || 1,
      });
      continue;
    }
    if (row.instrument_type !== "CE" && row.instrument_type !== "PE") continue;
    const strike = Number(row.strike);
    if (!strike) continue;
    if (!pairsByName.has(row.name)) pairsByName.set(row.name, new Map());
    const byKey = pairsByName.get(row.name);
    const key = `${expiry}|${strike}`;
    const cur = byKey.get(key) || {
      name: row.name,
      expiry,
      strike,
      lot_size: Number(row.lot_size) || 1,
      ce: null,
      pe: null,
    };
    if (row.instrument_type === "CE") cur.ce = row;
    else cur.pe = row;
    if (Number(row.lot_size)) cur.lot_size = Number(row.lot_size);
    byKey.set(key, cur);
  }

  for (const list of futsByName.values()) {
    list.sort((a, b) => a.expiry.localeCompare(b.expiry));
  }

  const stocks = [...futsByName.keys()]
    .filter((name) => pairsByName.has(name))
    .sort()
    .map((name) => {
      const futs = futsByName.get(name);
      const expiries = [...new Set(futs.map((row) => row.expiry))];
      return {
        symbol: name,
        expiries,
        nearest_expiry: expiries[0] || null,
        next_expiry: expiries[1] || null,
      };
    });

  return { futsByName, pairsByName, stocks };
}

function targetExpiry(stock, mode) {
  if (mode === "next") return stock.next_expiry || stock.nearest_expiry;
  return stock.nearest_expiry;
}

function pairRecord(pair, fut) {
  return {
    symbol: pair.name,
    expiry: pair.expiry,
    strike: pair.strike,
    lot_size: pair.lot_size || fut.lot_size || 1,
    ce_key: `NFO:${pair.ce.tradingsymbol}`,
    pe_key: `NFO:${pair.pe.tradingsymbol}`,
    fut_key: fut.key,
    ce_token: rowToken(pair.ce),
    pe_token: rowToken(pair.pe),
    fut_token: fut.token,
    ce_symbol: pair.ce.tradingsymbol,
    pe_symbol: pair.pe.tradingsymbol,
    fut_symbol: fut.tradingsymbol,
    settlement: "same-expiry",
  };
}

async function callArbUniverse(accessToken, {
  expiry = "nearest",
  symbol = "",
  bandPct = 6,
  maxStrikes = 5,
  seed = true,
} = {}) {
  const { nfo } = await loadInstruments(accessToken);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const built = buildStockUniverse(nfo, today);
  const wanted = String(symbol || "").toUpperCase();
  const stocks = wanted
    ? built.stocks.filter((row) => row.symbol === wanted)
    : built.stocks;

  const futRows = [];
  const pending = [];
  for (const stock of stocks) {
    const exp = targetExpiry(stock, expiry);
    if (!exp) continue;
    const fut = (built.futsByName.get(stock.symbol) || []).find((row) => row.expiry === exp);
    if (!fut) continue;
    futRows.push(fut);
    const pairs = [...(built.pairsByName.get(stock.symbol) || []).values()]
      .filter((pair) => pair.expiry === exp && pair.ce && pair.pe);
    pending.push({ stock, exp, fut, pairs });
  }

  let books = {};
  let priceError = "";
  if (seed && futRows.length) {
    const quoted = await quoteMany(accessToken, [...new Set(futRows.map((row) => row.key))]);
    books = quoted.books || {};
    priceError = quoted.error || "";
  }

  const oneStock = Boolean(wanted);
  const requested = Number(maxStrikes);
  const strikeCap = requested > 0 ? requested : (oneStock ? 0 : 5);
  const pairs = [];
  for (const item of pending) {
    const q = lookupQuote(books, item.fut.key, item.fut.token);
    const futPx = Number((q && (q.last_price || q.ltp)) || 0);
    const keep = new Set(pickStrikes(
      item.pairs.map((pair) => pair.strike),
      futPx,
      oneStock && Number(bandPct) <= 0 ? 0 : bandPct,
      strikeCap,
    ));
    for (const pair of item.pairs) {
      if (keep.size && !keep.has(pair.strike)) continue;
      pairs.push(pairRecord(pair, item.fut));
    }
  }

  pairs.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.expiry.localeCompare(b.expiry) || a.strike - b.strike);

  let trimmed = pairs;
  let tokens = [...new Set(trimmed.flatMap((row) => [Number(row.ce_token), Number(row.pe_token), Number(row.fut_token)].filter(Boolean)))];
  if (tokens.length > TOKEN_CAP) {
    const byStock = new Map();
    for (const row of trimmed) {
      if (!byStock.has(row.symbol)) byStock.set(row.symbol, []);
      byStock.get(row.symbol).push(row);
    }
    const next = [];
    for (const list of byStock.values()) {
      const futPx = Number((lookupQuote(books, list[0].fut_key, list[0].fut_token) || {}).last_price || 0);
      list.sort((a, b) => Math.abs(a.strike - futPx) - Math.abs(b.strike - futPx));
      next.push(...list.slice(0, 3));
    }
    trimmed = next.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.strike - b.strike);
    tokens = [...new Set(trimmed.flatMap((row) => [Number(row.ce_token), Number(row.pe_token), Number(row.fut_token)].filter(Boolean)))];
  }

  const seedBooks = {};
  const now = Date.now();
  for (const row of trimmed) {
    seedBooks[row.fut_token] = { ...bookFromQuote(lookupQuote(books, row.fut_key, row.fut_token)), ts: now };
    seedBooks[row.ce_token] = bookFromQuote(null);
    seedBooks[row.pe_token] = bookFromQuote(null);
  }

  const expiries = stocks[0]
    ? upcomingExpiries(nfo, today, stocks[0].symbol, "FUT")
    : [...new Set(built.stocks.flatMap((row) => row.expiries))].sort();

  return {
    stocks: built.stocks,
    pairs: trimmed,
    tokens,
    books: seedBooks,
    price_error: priceError,
    nearest_expiry: stocks[0] ? stocks[0].nearest_expiry : null,
    next_expiry: stocks[0] ? stocks[0].next_expiry : null,
    expiries,
    stocks_scanned: new Set(trimmed.map((row) => row.symbol)).size,
    pair_count: trimmed.length,
    methodology: "same underlying + same expiry + same strike + same-expiry future",
  };
}

function applySeedBooks(pairs, books, ts = Date.now()) {
  const out = {};
  for (const row of pairs) {
    out[row.ce_token] = { ...bookFromQuote(lookupQuote(books, row.ce_key, row.ce_token)), ts };
    out[row.pe_token] = { ...bookFromQuote(lookupQuote(books, row.pe_key, row.pe_token)), ts };
    out[row.fut_token] = { ...bookFromQuote(lookupQuote(books, row.fut_key, row.fut_token)), ts };
  }
  return out;
}

module.exports = { callArbUniverse, applySeedBooks, pickStrikes, buildStockUniverse, upcomingExpiries, bookFromQuote, targetExpiry };
