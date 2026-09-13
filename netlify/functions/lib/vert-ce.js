const { loadInstruments, quoteMany, lookupQuote, rowToken } = require("./kite");
const {
  pickStrikes,
  buildStockUniverse,
  upcomingExpiries,
  bookFromQuote,
  targetExpiry,
} = require("./call-arb");
const { strikeCombos } = require("./box-arb");

const TOKEN_CAP = 2800;

function vertCeRecord(low, high, fut) {
  return {
    symbol: low.name,
    expiry: low.expiry,
    k1: low.strike,
    k2: high.strike,
    width: high.strike - low.strike,
    lot_size: low.lot_size || high.lot_size || (fut && fut.lot_size) || 1,
    k1_ce_key: `NFO:${low.ce.tradingsymbol}`,
    k2_ce_key: `NFO:${high.ce.tradingsymbol}`,
    k1_ce_token: rowToken(low.ce),
    k2_ce_token: rowToken(high.ce),
    k1_ce_symbol: low.ce.tradingsymbol,
    k2_ce_symbol: high.ce.tradingsymbol,
    settlement: "same-expiry",
  };
}

function vertCeTokens(row) {
  return [Number(row.k1_ce_token), Number(row.k2_ce_token)].filter(Boolean);
}

async function vertCeUniverse(accessToken, {
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
    const calls = [...(built.pairsByName.get(stock.symbol) || []).values()]
      .filter((pair) => pair.expiry === exp && pair.ce);
    if (calls.length < 2) continue;
    if (fut) futRows.push(fut);
    pending.push({ stock, exp, fut, calls });
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
    const q = item.fut ? lookupQuote(books, item.fut.key, item.fut.token) : null;
    const futPx = Number((q && (q.last_price || q.ltp)) || 0);
    const keep = new Set(pickStrikes(
      item.calls.map((pair) => pair.strike),
      futPx,
      oneStock && Number(bandPct) <= 0 ? 0 : bandPct,
      strikeCap,
    ));
    const byStrike = new Map();
    for (const pair of item.calls) {
      if (keep.size && !keep.has(pair.strike)) continue;
      if (!byStrike.has(pair.strike)) byStrike.set(pair.strike, pair);
    }
    for (const combo of strikeCombos([...byStrike.keys()])) {
      pairs.push(vertCeRecord(byStrike.get(combo.k1), byStrike.get(combo.k2), item.fut));
    }
  }

  pairs.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.expiry.localeCompare(b.expiry) || a.k1 - b.k1 || a.k2 - b.k2);

  let trimmed = pairs;
  let tokens = [...new Set(trimmed.flatMap(vertCeTokens))];
  if (tokens.length > TOKEN_CAP) {
    const byStock = new Map();
    for (const row of trimmed) {
      if (!byStock.has(row.symbol)) byStock.set(row.symbol, []);
      byStock.get(row.symbol).push(row);
    }
    const next = [];
    for (const list of byStock.values()) {
      list.sort((a, b) => a.width - b.width || a.k1 - b.k1);
      next.push(...list.slice(0, 8));
    }
    trimmed = next.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.k1 - b.k1 || a.k2 - b.k2);
    tokens = [...new Set(trimmed.flatMap(vertCeTokens))];
  }

  const seedBooks = {};
  for (const row of trimmed) {
    for (const token of vertCeTokens(row)) seedBooks[token] = bookFromQuote(null);
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
    methodology: "same underlying + same expiry + every K1<K2 Call pair",
  };
}

function applyVertCeSeedBooks(pairs, books, ts = Date.now()) {
  const out = {};
  for (const row of pairs) {
    out[row.k1_ce_token] = { ...bookFromQuote(lookupQuote(books, row.k1_ce_key, row.k1_ce_token)), ts };
    out[row.k2_ce_token] = { ...bookFromQuote(lookupQuote(books, row.k2_ce_key, row.k2_ce_token)), ts };
  }
  return out;
}

module.exports = { vertCeUniverse, applyVertCeSeedBooks, strikeCombos };
