const { loadInstruments, quoteMany, lookupQuote, rowToken } = require("./kite");

function upcoming(rows, today, type, name) {
  const found = new Set();
  for (const row of rows) {
    if (row.name !== name || row.instrument_type !== type) continue;
    const exp = (row.expiry || "").slice(0, 10);
    if (exp && exp >= today) found.add(exp);
  }
  return [...found].sort();
}

function matchFuture(futs, expiry) {
  return futs.find((row) => row.expiry === expiry) || futs[0] || null;
}

function buildNiftyUniverse(nfo, today) {
  const futs = nfo
    .filter((row) => row.name === "NIFTY" && row.instrument_type === "FUT")
    .map((row) => ({
      expiry: (row.expiry || "").slice(0, 10),
      token: rowToken(row),
      key: `NFO:${row.tradingsymbol}`,
      tradingsymbol: row.tradingsymbol,
      lot_size: Number(row.lot_size) || 65,
    }))
    .filter((row) => row.expiry && row.expiry >= today)
    .sort((a, b) => a.expiry.localeCompare(b.expiry));

  const byPair = new Map();
  for (const row of nfo) {
    if (row.name !== "NIFTY" || (row.instrument_type !== "CE" && row.instrument_type !== "PE")) continue;
    const expiry = (row.expiry || "").slice(0, 10);
    if (!expiry || expiry < today) continue;
    const strike = Number(row.strike);
    if (!strike) continue;
    const key = `${expiry}|${strike}`;
    const cur = byPair.get(key) || { expiry, strike, ce: null, pe: null, lot_size: Number(row.lot_size) || 65 };
    if (row.instrument_type === "CE") cur.ce = row;
    else cur.pe = row;
    byPair.set(key, cur);
  }

  const pairs = [];
  for (const pair of byPair.values()) {
    if (!pair.ce || !pair.pe) continue;
    const fut = matchFuture(futs, pair.expiry);
    if (!fut) continue;
    pairs.push({
      expiry: pair.expiry,
      strike: pair.strike,
      lot_size: pair.lot_size || fut.lot_size,
      ce_key: `NFO:${pair.ce.tradingsymbol}`,
      pe_key: `NFO:${pair.pe.tradingsymbol}`,
      fut_key: fut.key,
      ce_token: rowToken(pair.ce),
      pe_token: rowToken(pair.pe),
      fut_token: fut.token,
      ce_symbol: pair.ce.tradingsymbol,
      pe_symbol: pair.pe.tradingsymbol,
      fut_symbol: fut.tradingsymbol,
    });
  }
  pairs.sort((a, b) => a.expiry.localeCompare(b.expiry) || a.strike - b.strike);

  const expiries = upcoming(nfo, today, "CE", "NIFTY");
  return {
    expiries,
    nearest_expiry: expiries[0] || null,
    next_expiry: expiries[1] || null,
    futures: futs,
    pairs,
    tokens: [...new Set(pairs.flatMap((row) => [Number(row.ce_token), Number(row.pe_token), Number(row.fut_token)].filter(Boolean)))],
  };
}

async function synthUniverse(accessToken, { seed = false, expiry = "" } = {}) {
  const { nfo } = await loadInstruments(accessToken);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const universe = buildNiftyUniverse(nfo, today);
  let pairs = universe.pairs;
  if (expiry === "all") {
    /* keep every upcoming expiry */
  } else if (expiry === "next") {
    pairs = pairs.filter((row) => row.expiry === universe.next_expiry);
  } else {
    const target = expiry && expiry !== "nearest" ? expiry : universe.nearest_expiry;
    pairs = pairs.filter((row) => row.expiry === target);
  }

  let books = {};
  let priceError = "";
  if (seed && pairs.length) {
    const seedPairs = expiry === "all"
      ? pairs.filter((row) => row.expiry === universe.nearest_expiry)
      : pairs;
    const keys = [...new Set(seedPairs.flatMap((row) => [row.ce_key, row.pe_key, row.fut_key]))];
    const quoted = await quoteMany(accessToken, keys);
    books = quoted.books || {};
    priceError = quoted.error || "";
  }

  return {
    ...universe,
    pairs,
    tokens: [...new Set(pairs.flatMap((row) => [Number(row.ce_token), Number(row.pe_token), Number(row.fut_token)].filter(Boolean)))],
    books,
    price_error: priceError,
  };
}

function bookFromQuote(q) {
  if (!q) return { ltp: 0, bid: 0, ask: 0, bid_qty: 0, ask_qty: 0 };
  return {
    ltp: Number(q.ltp || q.last_price || 0),
    bid: Number(q.bid || 0),
    ask: Number(q.ask || 0),
    bid_qty: Number(q.bid_qty || 0),
    ask_qty: Number(q.ask_qty || 0),
  };
}

function seedBooks(pairs, books) {
  const out = {};
  for (const row of pairs) {
    out[row.ce_token] = bookFromQuote(lookupQuote(books, row.ce_key, row.ce_token));
    out[row.pe_token] = bookFromQuote(lookupQuote(books, row.pe_key, row.pe_token));
    out[row.fut_token] = bookFromQuote(lookupQuote(books, row.fut_key, row.fut_token));
  }
  return out;
}

module.exports = { synthUniverse, seedBooks };
