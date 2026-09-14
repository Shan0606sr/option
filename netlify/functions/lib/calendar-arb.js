const { loadInstruments, quoteMany, lookupQuote, rowToken } = require("./kite");
const { pickStrikes, upcomingExpiries } = require("./call-arb");
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

function expiryPairs(expiries, mode) {
  const xs = [...new Set((expiries || []).map((row) => String(row || "").slice(0, 10)).filter(Boolean))].sort();
  if (xs.length < 2) return [];
  if (mode === "next-far") {
    if (xs.length >= 3) return [{ near: xs[1], far: xs[2], kind: "next-far" }];
    return [{ near: xs[0], far: xs[1], kind: "near-next" }];
  }
  if (mode === "adjacent") {
    const out = [];
    for (let i = 0; i < xs.length - 1; i += 1) {
      out.push({ near: xs[i], far: xs[i + 1], kind: i === 0 ? "near-next" : "adjacent" });
    }
    return out;
  }
  return [{ near: xs[0], far: xs[1], kind: "near-next" }];
}

function calRecord(nearPair, farPair, nearFut, farFut, stock, kind) {
  if (!nearPair || !farPair || !nearPair.ce || !nearPair.pe || !farPair.ce || !farPair.pe) return null;
  const lot = nearPair.lot_size || farPair.lot_size || (nearFut && nearFut.lot_size) || 1;
  return {
    exchange: "NSE",
    segment: "NFO",
    symbol: nearPair.name,
    index: Boolean(stock && stock.index),
    strike: nearPair.strike,
    lot_size: lot,
    pair_kind: kind || "near-next",
    near_expiry: nearPair.expiry,
    far_expiry: farPair.expiry,
    near_ce_key: `NFO:${nearPair.ce.tradingsymbol}`,
    near_pe_key: `NFO:${nearPair.pe.tradingsymbol}`,
    far_ce_key: `NFO:${farPair.ce.tradingsymbol}`,
    far_pe_key: `NFO:${farPair.pe.tradingsymbol}`,
    near_fut_key: nearFut ? nearFut.key : "",
    far_fut_key: farFut ? farFut.key : "",
    eq_key: (stock && stock.eq_key) || "",
    near_ce_token: rowToken(nearPair.ce),
    near_pe_token: rowToken(nearPair.pe),
    far_ce_token: rowToken(farPair.ce),
    far_pe_token: rowToken(farPair.pe),
    near_fut_token: nearFut ? nearFut.token : 0,
    far_fut_token: farFut ? farFut.token : 0,
    eq_token: (stock && stock.eq_token) || 0,
    near_ce_symbol: nearPair.ce.tradingsymbol,
    near_pe_symbol: nearPair.pe.tradingsymbol,
    far_ce_symbol: farPair.ce.tradingsymbol,
    far_pe_symbol: farPair.pe.tradingsymbol,
  };
}

function calTokens(row) {
  return [
    row.near_ce_token, row.near_pe_token, row.far_ce_token, row.far_pe_token,
    row.near_fut_token, row.far_fut_token, row.eq_token,
  ].map(Number).filter(Boolean);
}

async function calendarArbUniverse(accessToken, {
  pairMode = "near-next",
  symbol = "",
  bandPct = 6,
  maxStrikes = 3,
  seed = true,
} = {}) {
  const { nfo, nse } = await loadInstruments(accessToken);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const built = buildRvUniverse(nfo, nse, today);
  const wanted = String(symbol || "").toUpperCase();
  const stocks = wanted
    ? built.stocks.filter((row) => row.symbol === wanted)
    : built.stocks;

  const seedKeys = [];
  const pending = [];
  for (const stock of stocks) {
    const combos = expiryPairs(stock.expiries, pairMode);
    if (!combos.length) continue;
    const futs = built.futsByName.get(stock.symbol) || [];
    const chain = [...(built.pairsByName.get(stock.symbol) || []).values()];
    for (const combo of combos) {
      if (stock.eq_key) seedKeys.push(stock.eq_key);
      const nearFut = futs.find((row) => row.expiry === combo.near);
      const farFut = futs.find((row) => row.expiry === combo.far);
      if (nearFut) seedKeys.push(nearFut.key);
      if (farFut) seedKeys.push(farFut.key);
      pending.push({ stock, combo, nearFut, farFut, chain });
    }
  }

  let books = {};
  let priceError = "";
  if (seed && seedKeys.length) {
    const quoted = await quoteMany(accessToken, [...new Set(seedKeys)]);
    books = quoted.books || {};
    priceError = quoted.error || "";
  }

  const oneStock = Boolean(wanted);
  const requested = Number(maxStrikes);
  const strikeCap = requested > 0 ? requested : (oneStock ? 0 : 3);
  const pairs = [];
  for (const item of pending) {
    const nearQ = item.nearFut ? lookupQuote(books, item.nearFut.key, item.nearFut.token) : null;
    const eqQ = item.stock.eq_key ? lookupQuote(books, item.stock.eq_key, item.stock.eq_token) : null;
    const px = Number((nearQ && (nearQ.last_price || nearQ.ltp || nearQ.close))
      || (eqQ && (eqQ.last_price || eqQ.ltp || eqQ.close)) || 0);
    const nearChain = item.chain.filter((row) => row.expiry === item.combo.near && row.ce && row.pe);
    const farByStrike = new Map(
      item.chain.filter((row) => row.expiry === item.combo.far && row.ce && row.pe).map((row) => [row.strike, row]),
    );
    const shared = nearChain.filter((row) => farByStrike.has(row.strike)).map((row) => row.strike);
    const keep = new Set(pickStrikes(
      shared,
      px,
      oneStock && Number(bandPct) <= 0 ? 0 : bandPct,
      strikeCap,
    ));
    for (const strike of shared) {
      if (keep.size && !keep.has(strike)) continue;
      const rec = calRecord(
        nearChain.find((row) => row.strike === strike),
        farByStrike.get(strike),
        item.nearFut,
        item.farFut,
        item.stock,
        item.combo.kind,
      );
      if (rec) pairs.push(rec);
    }
  }

  pairs.sort((a, b) => Number(b.index) - Number(a.index) || a.symbol.localeCompare(b.symbol)
    || a.near_expiry.localeCompare(b.near_expiry) || a.strike - b.strike);

  let trimmed = pairs;
  let tokens = [...new Set(trimmed.flatMap(calTokens))];
  if (tokens.length > TOKEN_CAP) {
    const byStock = new Map();
    for (const row of trimmed) {
      if (!byStock.has(row.symbol)) byStock.set(row.symbol, []);
      byStock.get(row.symbol).push(row);
    }
    const next = [];
    for (const list of byStock.values()) {
      list.sort((a, b) => a.strike - b.strike);
      next.push(...list.slice(0, 2));
    }
    trimmed = next.sort((a, b) => Number(b.index) - Number(a.index) || a.symbol.localeCompare(b.symbol) || a.strike - b.strike);
    tokens = [...new Set(trimmed.flatMap(calTokens))];
  }

  const seedBooks = {};
  for (const row of trimmed) {
    for (const token of calTokens(row)) seedBooks[token] = bookFromQuote(null);
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
    methodology: "same strike CE+PE synthetic future, near vs far expiry; carry fair spread; executable bid/ask",
  };
}

function applyCalendarSeedBooks(pairs, books, ts = Date.now()) {
  const out = {};
  const fields = [
    ["near_ce_token", "near_ce_key"], ["near_pe_token", "near_pe_key"],
    ["far_ce_token", "far_ce_key"], ["far_pe_token", "far_pe_key"],
    ["near_fut_token", "near_fut_key"], ["far_fut_token", "far_fut_key"],
    ["eq_token", "eq_key"],
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
  calendarArbUniverse,
  applyCalendarSeedBooks,
  expiryPairs,
  calTokens,
};
