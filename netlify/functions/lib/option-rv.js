const { loadInstruments, quoteMany, lookupQuote, isIndex, rowToken } = require("./kite");
const { pickStrikes, upcomingExpiries } = require("./call-arb");

const TOKEN_CAP = 2800;

const INDEX_SPOT = {
  NIFTY: { key: "NSE:NIFTY 50", token: 256265 },
  BANKNIFTY: { key: "NSE:NIFTY BANK", token: 260105 },
  FINNIFTY: { key: "NSE:NIFTY FIN SERVICE", token: 257801 },
  MIDCPNIFTY: { key: "NSE:NIFTY MID SELECT", token: 288009 },
  NIFTYNXT50: { key: "NSE:NIFTY NEXT 50", token: 270745 },
};

function bookFromQuote(q) {
  if (!q) {
    return { ltp: 0, bid: 0, ask: 0, bid_qty: 0, ask_qty: 0, bid_depth: 0, ask_depth: 0, volume: 0, oi: 0, ts: 0 };
  }
  const ltp = Number(q.last_price || q.ltp || 0) || Number(q.close || 0);
  return {
    ltp,
    bid: Number(q.bid || 0),
    ask: Number(q.ask || 0),
    bid_qty: Number(q.bid_qty || 0),
    ask_qty: Number(q.ask_qty || 0),
    bid_depth: Number(q.bid_depth || q.bid_qty || 0),
    ask_depth: Number(q.ask_depth || q.ask_qty || 0),
    volume: Number(q.volume || 0),
    oi: Number(q.oi || 0),
    ts: 0,
  };
}

function findEquity(nse, name) {
  const wanted = String(name || "").toUpperCase();
  const indexed = INDEX_SPOT[wanted];
  if (indexed) {
    const hit = (nse || []).find((row) => {
      const ts = String(row.tradingsymbol || "").toUpperCase();
      return ts === String(indexed.key.split(":")[1] || "").toUpperCase();
    });
    return {
      key: indexed.key,
      token: hit ? rowToken(hit) : indexed.token,
    };
  }
  const eq = (nse || []).find((row) => {
    const ts = String(row.tradingsymbol || "").toUpperCase();
    const type = String(row.instrument_type || "").toUpperCase();
    return ts === wanted && (type === "EQ" || type === "BE" || type === "");
  });
  if (!eq) return { key: `NSE:${wanted}`, token: 0 };
  return { key: `NSE:${eq.tradingsymbol}`, token: rowToken(eq) };
}

function buildRvUniverse(nfo, nse, today) {
  const futsByName = new Map();
  const pairsByName = new Map();

  for (const row of nfo) {
    if (!row.name) continue;
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

  const names = [...futsByName.keys()].filter((name) => pairsByName.has(name)).sort((a, b) => {
    const ia = isIndex(a) ? 0 : 1;
    const ib = isIndex(b) ? 0 : 1;
    return ia - ib || a.localeCompare(b);
  });

  const stocks = names.map((name) => {
    const futs = futsByName.get(name);
    const expiries = [...new Set(futs.map((row) => row.expiry))];
    const spot = findEquity(nse, name);
    return {
      symbol: name,
      index: isIndex(name),
      expiries,
      nearest_expiry: expiries[0] || null,
      next_expiry: expiries[1] || null,
      eq_key: spot.key,
      eq_token: spot.token,
    };
  });

  return { futsByName, pairsByName, stocks };
}

function targetExpiry(stock, mode) {
  if (mode === "next") return stock.next_expiry || stock.nearest_expiry;
  return stock.nearest_expiry;
}

function pairRecord(pair, fut, stock) {
  return {
    symbol: pair.name,
    index: Boolean(stock.index),
    expiry: pair.expiry,
    strike: pair.strike,
    lot_size: pair.lot_size || fut.lot_size || 1,
    ce_key: pair.ce ? `NFO:${pair.ce.tradingsymbol}` : "",
    pe_key: pair.pe ? `NFO:${pair.pe.tradingsymbol}` : "",
    fut_key: fut.key,
    eq_key: stock.eq_key || "",
    ce_token: pair.ce ? rowToken(pair.ce) : 0,
    pe_token: pair.pe ? rowToken(pair.pe) : 0,
    fut_token: fut.token,
    eq_token: stock.eq_token || 0,
    ce_symbol: pair.ce ? pair.ce.tradingsymbol : "",
    pe_symbol: pair.pe ? pair.pe.tradingsymbol : "",
    fut_symbol: fut.tradingsymbol,
  };
}

function pairTokens(row) {
  return [row.ce_token, row.pe_token, row.fut_token, row.eq_token].map(Number).filter(Boolean);
}

async function optionRvUniverse(accessToken, {
  expiry = "nearest",
  symbol = "",
  bandPct = 8,
  maxStrikes = 7,
  seed = true,
} = {}) {
  const { nfo, nse } = await loadInstruments(accessToken);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const built = buildRvUniverse(nfo, nse, today);
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
      .filter((pair) => pair.expiry === exp && (pair.ce || pair.pe));
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
  const strikeCap = requested > 0 ? requested : (oneStock ? 0 : 7);
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
      pairs.push(pairRecord(pair, item.fut, item.stock));
    }
  }

  pairs.sort((a, b) => Number(b.index) - Number(a.index) || a.symbol.localeCompare(b.symbol) || a.strike - b.strike);

  let trimmed = pairs;
  let tokens = [...new Set(trimmed.flatMap(pairTokens))];
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
      next.push(...list.slice(0, 4));
    }
    trimmed = next.sort((a, b) => Number(b.index) - Number(a.index) || a.symbol.localeCompare(b.symbol) || a.strike - b.strike);
    tokens = [...new Set(trimmed.flatMap(pairTokens))];
  }

  const seedBooks = {};
  const now = Date.now();
  for (const row of trimmed) {
    seedBooks[row.fut_token] = { ...bookFromQuote(lookupQuote(books, row.fut_key, row.fut_token)), ts: now };
    if (row.eq_token) seedBooks[row.eq_token] = { ...bookFromQuote(lookupQuote(books, row.eq_key, row.eq_token)), ts: now };
    if (row.ce_token) seedBooks[row.ce_token] = bookFromQuote(null);
    if (row.pe_token) seedBooks[row.pe_token] = bookFromQuote(null);
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
    methodology: "Black-76 IV vs separate Call and Put curves. Relative value, not arbitrage.",
  };
}

function applySeedBooks(pairs, books, ts = Date.now()) {
  const out = {};
  for (const row of pairs) {
    if (row.ce_token) out[row.ce_token] = { ...bookFromQuote(lookupQuote(books, row.ce_key, row.ce_token)), ts };
    if (row.pe_token) out[row.pe_token] = { ...bookFromQuote(lookupQuote(books, row.pe_key, row.pe_token)), ts };
    if (row.fut_token) out[row.fut_token] = { ...bookFromQuote(lookupQuote(books, row.fut_key, row.fut_token)), ts };
    if (row.eq_token) out[row.eq_token] = { ...bookFromQuote(lookupQuote(books, row.eq_key, row.eq_token)), ts };
  }
  return out;
}

module.exports = {
  optionRvUniverse,
  applySeedBooks,
  bookFromQuote,
  buildRvUniverse,
  INDEX_SPOT,
};
