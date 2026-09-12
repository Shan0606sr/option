const { loadInstruments, quoteMany, historicalCloses, lookupQuote, isIndex, rowToken } = require("./kite");

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

function strikeSynthetic(strike, ce, pe) {
  if (!strike || !ce) return 0;
  return strike + ce - (pe || 0);
}

function listFoStocks(nfo, today) {
  const expiriesByName = new Map();
  for (const row of nfo) {
    if (row.instrument_type !== "CE" && row.instrument_type !== "PE") continue;
    if (isIndex(row.name) || !row.name) continue;
    const exp = (row.expiry || "").slice(0, 10);
    if (!exp || exp < today) continue;
    if (!expiriesByName.has(row.name)) expiriesByName.set(row.name, new Set());
    expiriesByName.get(row.name).add(exp);
  }
  return [...expiriesByName.keys()].sort().map((name) => {
    const expiries = [...expiriesByName.get(name)].sort();
    return { symbol: name, expiry: expiries[0], expiries };
  });
}

function pairsForStock(nfo, symbol, expiry) {
  const byStrike = new Map();
  for (const row of nfo) {
    if (row.name !== symbol) continue;
    if (row.instrument_type !== "CE" && row.instrument_type !== "PE") continue;
    const exp = (row.expiry || "").slice(0, 10);
    if (exp !== expiry) continue;
    const strike = Number(row.strike);
    if (!strike) continue;
    const cur = byStrike.get(strike) || {
      name: symbol,
      strike,
      expiry,
      lot_size: Number(row.lot_size) || 1,
      ce: null,
      pe: null,
    };
    if (row.instrument_type === "CE") cur.ce = row;
    else cur.pe = row;
    byStrike.set(strike, cur);
  }
  return [...byStrike.values()]
    .filter((pair) => pair.ce && pair.pe)
    .sort((a, b) => a.strike - b.strike);
}

function pricedPlanRow(row, books, closes) {
  const spot = ltpOf(lookupQuote(books, row.spotKey, row.spotToken), row.spotToken, closes);
  const ce = ltpOf(lookupQuote(books, row.ceKey, row.ceToken), row.ceToken, closes);
  const pe = ltpOf(lookupQuote(books, row.peKey, row.peToken), row.peToken, closes);
  const synthetic = strikeSynthetic(row.strike, ce, pe);
  const edge = spot && synthetic ? synthetic - spot : 0;
  const edgePct = spot && synthetic ? (edge / spot) * 100 : 0;
  let side = "";
  if (spot && synthetic) {
    if (edge > 0) side = "positive";
    else if (edge < 0) side = "negative";
    else side = "flat";
  }
  return {
    symbol: row.symbol,
    name: row.name,
    expiry: row.expiry,
    lot_size: row.lot_size,
    spot,
    strike: row.strike,
    ce,
    pe,
    synthetic,
    edge,
    edge_pct: edgePct,
    side,
    hit: side === "positive",
    spot_token: row.spotToken || "",
    ce_token: row.ceToken || "",
    pe_token: row.peToken || "",
    spot_key: row.spotKey,
    ce_key: row.ceKey,
    pe_key: row.peKey,
  };
}

async function plan1Universe(accessToken) {
  const { nfo } = await loadInstruments(accessToken);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const stocks = listFoStocks(nfo, today);
  return {
    stocks,
    nearest_expiry: stocks[0] ? stocks[0].expiry : null,
    rows: [],
    stocks_scanned: stocks.length,
    pairs_priced: 0,
    hits: 0,
  };
}

async function plan1Stock(accessToken, symbol) {
  const { nse, nfo } = await loadInstruments(accessToken);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const universe = listFoStocks(nfo, today);
  const chosen = universe.find((row) => row.symbol === symbol);
  if (!chosen) {
    return {
      stocks: universe,
      symbol,
      rows: [],
      stocks_scanned: universe.length,
      pairs_priced: 0,
      hits: 0,
      price_error: `${symbol} has no listed stock options.`,
    };
  }

  const equity = new Map();
  for (const row of nse) {
    if (!isCashEquity(row) || !row.tradingsymbol) continue;
    if (!equity.has(row.tradingsymbol)) equity.set(row.tradingsymbol, row);
  }
  const equityRow = equity.get(symbol) || {};
  const pairs = pairsForStock(nfo, symbol, chosen.expiry);
  const selected = pairs.map((pair) => ({
    symbol,
    name: symbol,
    expiry: chosen.expiry,
    lot_size: pair.lot_size,
    strike: pair.strike,
    spotKey: `NSE:${symbol}`,
    spotToken: rowToken(equityRow),
    ceKey: `NFO:${pair.ce.tradingsymbol}`,
    peKey: `NFO:${pair.pe.tradingsymbol}`,
    ceToken: rowToken(pair.ce),
    peToken: rowToken(pair.pe),
  }));

  const keys = [selected[0] && selected[0].spotKey, ...selected.flatMap((row) => [row.ceKey, row.peKey])].filter(Boolean);
  const quoted = await quoteMany(accessToken, keys);
  const books = quoted.books || {};
  let closes = {};
  const missing = [];
  for (const row of selected) {
    if (!ltpOf(lookupQuote(books, row.spotKey, row.spotToken), row.spotToken, {})) missing.push(row.spotToken);
    if (!ltpOf(lookupQuote(books, row.ceKey, row.ceToken), row.ceToken, {})) missing.push(row.ceToken);
    if (!ltpOf(lookupQuote(books, row.peKey, row.peToken), row.peToken, {})) missing.push(row.peToken);
  }
  if (missing.filter(Boolean).length) {
    const hist = await historicalCloses(accessToken, [...new Set(missing.filter(Boolean))].slice(0, 24));
    closes = hist.closes || {};
  }

  const rows = selected.map((row) => pricedPlanRow(row, books, closes));
  return {
    stocks: universe,
    symbol,
    nearest_expiry: chosen.expiry,
    expiries: chosen.expiries,
    stocks_scanned: rows.length,
    pairs_priced: rows.filter((row) => row.ce > 0).length,
    hits: rows.filter((row) => row.side === "positive").length,
    price_error: quoted.error || "",
    rows,
  };
}

async function plan1Scan(accessToken, symbol) {
  if (symbol) return plan1Stock(accessToken, symbol);
  return plan1Universe(accessToken);
}

module.exports = { plan1Scan, pricedPlanRow, strikeSynthetic };
