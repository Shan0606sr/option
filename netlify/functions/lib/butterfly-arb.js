const { loadInstruments, quoteMany, lookupQuote, rowToken } = require("./kite");
const { pickStrikes, upcomingExpiries, targetExpiry } = require("./call-arb");
const { buildRvUniverse } = require("./option-rv");

function bookFromQuote(q) {
  if (!q) return { ltp: 0, bid: 0, ask: 0, bid_qty: 0, ask_qty: 0, bid_depth: 0, ask_depth: 0, ts: 0 };
  const ltp = Number(q.last_price || q.ltp || 0) || Number(q.close || 0);
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

const TOKEN_CAP = 2800;

function butterflyCombos(strikes) {
  const unique = [...new Set(strikes.map(Number).filter((n) => n > 0))].sort((a, b) => a - b);
  const have = new Set(unique);
  const out = [];
  for (let i = 0; i < unique.length; i += 1) {
    for (let j = i + 1; j < unique.length; j += 1) {
      const k1 = unique[i];
      const k2 = unique[j];
      const k3 = k2 + (k2 - k1);
      if (!have.has(k3)) continue;
      out.push({ k1, k2, k3, width: k2 - k1 });
    }
  }
  return out;
}

function flyRecord(low, mid, high, fut, stock) {
  const hasCe = Boolean(low.ce && mid.ce && high.ce);
  const hasPe = Boolean(low.pe && mid.pe && high.pe);
  if (!hasCe && !hasPe) return null;
  const lot = low.lot_size || mid.lot_size || high.lot_size || (fut && fut.lot_size) || 1;
  return {
    exchange: "NSE",
    segment: "NFO",
    symbol: low.name,
    index: Boolean(stock && stock.index),
    expiry: low.expiry,
    k1: low.strike,
    k2: mid.strike,
    k3: high.strike,
    width: mid.strike - low.strike,
    lot_size: lot,
    k1_ce_key: hasCe ? `NFO:${low.ce.tradingsymbol}` : "",
    k2_ce_key: hasCe ? `NFO:${mid.ce.tradingsymbol}` : "",
    k3_ce_key: hasCe ? `NFO:${high.ce.tradingsymbol}` : "",
    k1_pe_key: hasPe ? `NFO:${low.pe.tradingsymbol}` : "",
    k2_pe_key: hasPe ? `NFO:${mid.pe.tradingsymbol}` : "",
    k3_pe_key: hasPe ? `NFO:${high.pe.tradingsymbol}` : "",
    k1_ce_token: hasCe ? rowToken(low.ce) : 0,
    k2_ce_token: hasCe ? rowToken(mid.ce) : 0,
    k3_ce_token: hasCe ? rowToken(high.ce) : 0,
    k1_pe_token: hasPe ? rowToken(low.pe) : 0,
    k2_pe_token: hasPe ? rowToken(mid.pe) : 0,
    k3_pe_token: hasPe ? rowToken(high.pe) : 0,
    k1_ce_symbol: hasCe ? low.ce.tradingsymbol : "",
    k2_ce_symbol: hasCe ? mid.ce.tradingsymbol : "",
    k3_ce_symbol: hasCe ? high.ce.tradingsymbol : "",
    k1_pe_symbol: hasPe ? low.pe.tradingsymbol : "",
    k2_pe_symbol: hasPe ? mid.pe.tradingsymbol : "",
    k3_pe_symbol: hasPe ? high.pe.tradingsymbol : "",
  };
}

function flyTokens(row) {
  return [
    row.k1_ce_token, row.k2_ce_token, row.k3_ce_token,
    row.k1_pe_token, row.k2_pe_token, row.k3_pe_token,
  ].map(Number).filter(Boolean);
}

async function butterflyArbUniverse(accessToken, {
  expiry = "nearest",
  symbol = "",
  bandPct = 6,
  maxStrikes = 5,
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
    const chain = [...(built.pairsByName.get(stock.symbol) || []).values()]
      .filter((pair) => pair.expiry === exp && (pair.ce || pair.pe));
    if (chain.length < 3) continue;
    if (fut) futRows.push(fut);
    pending.push({ stock, exp, fut, chain });
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
    const futPx = Number((q && (q.last_price || q.ltp || q.close)) || 0);
    const keep = new Set(pickStrikes(
      item.chain.map((pair) => pair.strike),
      futPx,
      oneStock && Number(bandPct) <= 0 ? 0 : bandPct,
      strikeCap,
    ));
    const selected = item.chain
      .filter((pair) => !keep.size || keep.has(pair.strike))
      .sort((a, b) => a.strike - b.strike);
    const byStrike = new Map(selected.map((pair) => [pair.strike, pair]));
    for (const combo of butterflyCombos(selected.map((pair) => pair.strike))) {
      const rec = flyRecord(byStrike.get(combo.k1), byStrike.get(combo.k2), byStrike.get(combo.k3), item.fut, item.stock);
      if (rec) pairs.push(rec);
    }
  }

  pairs.sort((a, b) => Number(b.index) - Number(a.index) || a.symbol.localeCompare(b.symbol)
    || a.expiry.localeCompare(b.expiry) || a.width - b.width || a.k1 - b.k1);

  let trimmed = pairs;
  let tokens = [...new Set(trimmed.flatMap(flyTokens))];
  if (tokens.length > TOKEN_CAP) {
    const byStock = new Map();
    for (const row of trimmed) {
      if (!byStock.has(row.symbol)) byStock.set(row.symbol, []);
      byStock.get(row.symbol).push(row);
    }
    const next = [];
    for (const list of byStock.values()) {
      list.sort((a, b) => a.width - b.width || a.k1 - b.k1);
      next.push(...list.slice(0, 4));
    }
    trimmed = next.sort((a, b) => Number(b.index) - Number(a.index) || a.symbol.localeCompare(b.symbol) || a.width - b.width);
    tokens = [...new Set(trimmed.flatMap(flyTokens))];
  }

  const seedBooks = {};
  for (const row of trimmed) {
    for (const token of flyTokens(row)) seedBooks[token] = bookFromQuote(null);
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
    methodology: "same exchange + underlying + expiry; every equidistant K1<K2<K3 Call and Put butterfly",
  };
}

function applyButterflySeedBooks(pairs, books, ts = Date.now()) {
  const out = {};
  const fields = [
    ["k1_ce_token", "k1_ce_key"], ["k2_ce_token", "k2_ce_key"], ["k3_ce_token", "k3_ce_key"],
    ["k1_pe_token", "k1_pe_key"], ["k2_pe_token", "k2_pe_key"], ["k3_pe_token", "k3_pe_key"],
  ];
  for (const row of pairs) {
    for (const [tokenField, keyField] of fields) {
      if (!row[tokenField]) continue;
      out[row[tokenField]] = { ...bookFromQuote(lookupQuote(books, row[keyField], row[tokenField])), ts };
    }
  }
  return out;
}

module.exports = {
  butterflyArbUniverse,
  applyButterflySeedBooks,
  butterflyCombos,
  flyTokens,
};
