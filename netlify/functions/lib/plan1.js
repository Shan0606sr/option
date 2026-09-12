const { loadInstruments, quoteMany, historicalCloses, lookupQuote, isIndex, rowToken } = require("./kite");

function upcomingExpiries(rows, today, type) {
  const found = new Set();
  for (const row of rows) {
    if (row.instrument_type !== type) continue;
    const exp = (row.expiry || "").slice(0, 10);
    if (exp && exp >= today) found.add(exp);
  }
  return [...found].sort();
}

function isCashEquity(row) {
  if (row.exchange !== "NSE") return false;
  const kind = row.instrument_type || "";
  return kind === "EQ" || kind === "BE" || kind === "";
}

function ltpOf(book, token, closes) {
  if (book && book.ltp) return book.ltp;
  if (token && closes[String(token)]) return closes[String(token)];
  return 0;
}

function buildOptionPairs(nfo, expiry) {
  const byKey = new Map();
  for (const row of nfo) {
    if (row.instrument_type !== "CE" && row.instrument_type !== "PE") continue;
    if (isIndex(row.name)) continue;
    const exp = (row.expiry || "").slice(0, 10);
    if (exp !== expiry) continue;
    const strike = Number(row.strike);
    if (!strike) continue;
    const key = `${row.name}|${strike}`;
    const cur = byKey.get(key) || {
      name: row.name,
      strike,
      lot_size: Number(row.lot_size) || 1,
      ce: null,
      pe: null,
    };
    if (row.instrument_type === "CE") cur.ce = row;
    else cur.pe = row;
    byKey.set(key, cur);
  }
  const byName = new Map();
  for (const pair of byKey.values()) {
    if (!pair.ce || !pair.pe) continue;
    if (!byName.has(pair.name)) byName.set(pair.name, []);
    byName.get(pair.name).push(pair);
  }
  for (const list of byName.values()) list.sort((a, b) => a.strike - b.strike);
  return byName;
}

function pickDeepItm(spot, pairs) {
  const target = spot * 0.9;
  const preferred = pairs.filter((pair) => pair.strike < spot && pair.strike >= spot * 0.8);
  const fallback = pairs.filter((pair) => pair.strike < spot && pair.strike >= spot * 0.7);
  const pool = preferred.length ? preferred : fallback;
  if (!pool.length) return null;
  return pool.reduce((best, pair) => (
    Math.abs(pair.strike - target) < Math.abs(best.strike - target) ? pair : best
  ));
}

function pricedPlanRow(row, books, closes) {
  const spot = ltpOf(lookupQuote(books, row.spotKey, row.spotToken), row.spotToken, closes);
  const ce = ltpOf(lookupQuote(books, row.ceKey, row.ceToken), row.ceToken, closes);
  const pe = ltpOf(lookupQuote(books, row.peKey, row.peToken), row.peToken, closes);
  const synthetic = strikeSynthetic(row.strike, ce, pe);
  const edge = spot && synthetic ? synthetic - spot : 0;
  return {
    symbol: row.symbol,
    name: row.name,
    expiry: row.expiry,
    lot_size: row.lot_size,
    spot,
    strike: row.strike,
    itm_pct: spot ? ((spot - row.strike) / spot) * 100 : 0,
    ce,
    pe,
    synthetic,
    edge,
    edge_pct: spot ? (edge / spot) * 100 : 0,
    hit: Boolean(spot && synthetic && synthetic > spot),
    spot_token: row.spotToken || "",
    ce_token: row.ceToken || "",
    pe_token: row.peToken || "",
    spot_key: row.spotKey,
    ce_key: row.ceKey,
    pe_key: row.peKey,
  };
}

function strikeSynthetic(strike, ce, pe) {
  if (!strike || !ce || pe == null || pe < 0) return 0;
  return strike + ce - pe;
}

async function plan1Scan(accessToken) {
  const { nse, nfo } = await loadInstruments(accessToken);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const optExpiries = upcomingExpiries(nfo, today, "CE");
  const nearest = optExpiries[0] || null;
  const pairsByName = buildOptionPairs(nfo, nearest);

  const equity = new Map();
  for (const row of nse) {
    if (!isCashEquity(row) || !row.tradingsymbol) continue;
    if (!equity.has(row.tradingsymbol)) equity.set(row.tradingsymbol, row);
  }

  const candidates = [];
  for (const [name, pairs] of pairsByName.entries()) {
    const equityRow = equity.get(name) || {};
    candidates.push({
      symbol: name,
      name,
      expiry: nearest,
      lot_size: pairs[0].lot_size,
      pairs,
      spotKey: `NSE:${name}`,
      spotToken: rowToken(equityRow),
    });
  }

  const spotKeys = candidates.map((row) => row.spotKey);
  const quoted = await quoteMany(accessToken, spotKeys);
  let books = quoted.books || {};
  let priceError = quoted.error || "";

  const needSpotTokens = candidates
    .filter((row) => !ltpOf(lookupQuote(books, row.spotKey, row.spotToken), row.spotToken, {}))
    .map((row) => row.spotToken)
    .filter(Boolean);
  let closes = {};
  if (needSpotTokens.length) {
    const hist = await historicalCloses(accessToken, needSpotTokens.slice(0, 12));
    closes = hist.closes || {};
  }

  const selected = [];
  for (const row of candidates) {
    const spot = ltpOf(lookupQuote(books, row.spotKey, row.spotToken), row.spotToken, closes);
    if (!spot) continue;
    const pair = pickDeepItm(spot, row.pairs);
    if (!pair) continue;
    selected.push({
      symbol: row.symbol,
      name: row.name,
      expiry: row.expiry,
      lot_size: pair.lot_size,
      strike: pair.strike,
      spotKey: row.spotKey,
      spotToken: row.spotToken,
      ceKey: `NFO:${pair.ce.tradingsymbol}`,
      peKey: `NFO:${pair.pe.tradingsymbol}`,
      ceToken: rowToken(pair.ce),
      peToken: rowToken(pair.pe),
    });
  }

  const rows = selected
    .map((row) => pricedPlanRow(row, books, closes))
    .sort((a, b) => (b.edge || 0) - (a.edge || 0) || a.symbol.localeCompare(b.symbol));

  return {
    nearest_expiry: nearest,
    expiries: optExpiries.slice(0, 2),
    stocks_scanned: rows.length,
    pairs_priced: rows.filter((row) => row.ce > 0 && row.pe > 0).length,
    hits: rows.filter((row) => row.hit).length,
    price_error: priceError,
    rows,
  };
}

module.exports = { plan1Scan, pricedPlanRow, strikeSynthetic };
