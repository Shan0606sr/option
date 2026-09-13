const { loadInstruments, quoteMany, lookupQuote, rowToken } = require("./kite");
const {
  pickStrikes,
  buildStockUniverse,
  upcomingExpiries,
  bookFromQuote,
  targetExpiry,
} = require("./call-arb");

const TOKEN_CAP = 2800;

function strikeCombos(strikes) {
  const unique = [...new Set(strikes.map(Number).filter((n) => n > 0))].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < unique.length; i += 1) {
    for (let j = i + 1; j < unique.length; j += 1) {
      out.push({ k1: unique[i], k2: unique[j] });
    }
  }
  return out;
}

function boxRecord(low, high, fut) {
  return {
    symbol: low.name,
    expiry: low.expiry,
    k1: low.strike,
    k2: high.strike,
    width: high.strike - low.strike,
    lot_size: low.lot_size || high.lot_size || (fut && fut.lot_size) || 1,
    k1_ce_key: `NFO:${low.ce.tradingsymbol}`,
    k1_pe_key: `NFO:${low.pe.tradingsymbol}`,
    k2_ce_key: `NFO:${high.ce.tradingsymbol}`,
    k2_pe_key: `NFO:${high.pe.tradingsymbol}`,
    k1_ce_token: rowToken(low.ce),
    k1_pe_token: rowToken(low.pe),
    k2_ce_token: rowToken(high.ce),
    k2_pe_token: rowToken(high.pe),
    k1_ce_symbol: low.ce.tradingsymbol,
    k1_pe_symbol: low.pe.tradingsymbol,
    k2_ce_symbol: high.ce.tradingsymbol,
    k2_pe_symbol: high.pe.tradingsymbol,
    settlement: "same-expiry",
  };
}

function boxTokens(row) {
  return [Number(row.k1_ce_token), Number(row.k1_pe_token), Number(row.k2_ce_token), Number(row.k2_pe_token)].filter(Boolean);
}

async function boxArbUniverse(accessToken, {
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
    const complete = [...(built.pairsByName.get(stock.symbol) || []).values()]
      .filter((pair) => pair.expiry === exp && pair.ce && pair.pe);
    if (complete.length < 2) continue;
    if (fut) futRows.push(fut);
    pending.push({ stock, exp, fut, complete });
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
  const boxes = [];
  for (const item of pending) {
    const q = item.fut ? lookupQuote(books, item.fut.key, item.fut.token) : null;
    const futPx = Number((q && (q.last_price || q.ltp)) || 0);
    const keep = new Set(pickStrikes(
      item.complete.map((pair) => pair.strike),
      futPx,
      oneStock && Number(bandPct) <= 0 ? 0 : bandPct,
      strikeCap,
    ));
    const selected = item.complete
      .filter((pair) => !keep.size || keep.has(pair.strike))
      .sort((a, b) => a.strike - b.strike);
    for (let i = 0; i < selected.length; i += 1) {
      for (let j = i + 1; j < selected.length; j += 1) {
        boxes.push(boxRecord(selected[i], selected[j], item.fut));
      }
    }
  }

  boxes.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.expiry.localeCompare(b.expiry) || a.k1 - b.k1 || a.k2 - b.k2);

  let trimmed = boxes;
  let tokens = [...new Set(trimmed.flatMap(boxTokens))];
  if (tokens.length > TOKEN_CAP) {
    const byStock = new Map();
    for (const row of trimmed) {
      if (!byStock.has(row.symbol)) byStock.set(row.symbol, []);
      byStock.get(row.symbol).push(row);
    }
    const next = [];
    for (const list of byStock.values()) {
      list.sort((a, b) => a.width - b.width || a.k1 - b.k1);
      next.push(...list.slice(0, 6));
    }
    trimmed = next.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.k1 - b.k1 || a.k2 - b.k2);
    tokens = [...new Set(trimmed.flatMap(boxTokens))];
  }

  const seedBooks = {};
  const now = Date.now();
  for (const row of trimmed) {
    for (const token of boxTokens(row)) seedBooks[token] = bookFromQuote(null);
    if (row.k1_ce_token) seedBooks[row.k1_ce_token] = { ...bookFromQuote(null), ts: 0 };
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
    methodology: "same underlying + same expiry + every K1<K2 strike pair with CE and PE",
  };
}

function applyBoxSeedBooks(pairs, books, ts = Date.now()) {
  const out = {};
  for (const row of pairs) {
    const legs = [
      ["k1_ce_token", "k1_ce_key"],
      ["k1_pe_token", "k1_pe_key"],
      ["k2_ce_token", "k2_ce_key"],
      ["k2_pe_token", "k2_pe_key"],
    ];
    for (const [tokenField, keyField] of legs) {
      out[row[tokenField]] = { ...bookFromQuote(lookupQuote(books, row[keyField], row[tokenField])), ts };
    }
  }
  return out;
}

module.exports = { boxArbUniverse, applyBoxSeedBooks, strikeCombos };
