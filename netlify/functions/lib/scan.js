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

function pricedRow(row, books, closes) {
  const spotBook = lookupQuote(books, row.spotKey, row.spotToken);
  const futBook = lookupQuote(books, row.futKey, row.futToken);
  const spot = (spotBook && spotBook.ltp) || closes[String(row.spotToken)] || 0;
  const future = (futBook && futBook.ltp) || closes[String(row.futToken)] || 0;
  const basis = future && spot ? future - spot : 0;
  return {
    symbol: row.symbol,
    name: row.name,
    expiry: row.expiry,
    lot_size: row.lot_size,
    spot,
    future,
    basis,
    basis_pct: spot ? (basis / spot) * 100 : 0,
    spot_token: row.spotToken || "",
    fut_token: row.futToken || "",
    spot_key: row.spotKey,
    fut_key: row.futKey,
  };
}

async function liveScan(accessToken) {
  const { nse, nfo } = await loadInstruments(accessToken);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const futExpiries = upcomingExpiries(nfo, today, "FUT");
  const nearestFut = futExpiries[0] || null;
  const nextFut = futExpiries[1] || null;

  const equity = new Map();
  for (const row of nse) {
    if (!isCashEquity(row) || !row.tradingsymbol) continue;
    if (!equity.has(row.tradingsymbol)) equity.set(row.tradingsymbol, row);
  }

  const futs = [];
  for (const row of nfo) {
    if (row.instrument_type !== "FUT" || isIndex(row.name)) continue;
    const exp = (row.expiry || "").slice(0, 10);
    if (exp !== nearestFut) continue;
    const equityRow = equity.get(row.name) || {};
    futs.push({
      symbol: row.name,
      name: row.name,
      expiry: exp,
      lot_size: Number(row.lot_size) || 1,
      futKey: `NFO:${row.tradingsymbol}`,
      futToken: rowToken(row),
      spotKey: `NSE:${row.name}`,
      spotToken: rowToken(equityRow),
    });
  }

  const quoteKeys = futs.flatMap((row) => [row.spotKey, row.futKey]);
  const quoted = await quoteMany(accessToken, quoteKeys.slice(0, 2));
  let books = quoted.books || {};
  let priceError = quoted.error || "";
  if (!priceError) {
    const rest = await quoteMany(accessToken, quoteKeys.slice(2));
    books = { ...books, ...(rest.books || {}) };
    priceError = rest.error || "";
  }

  const needTokens = [];
  for (const row of futs) {
    const spotBook = lookupQuote(books, row.spotKey, row.spotToken);
    const futBook = lookupQuote(books, row.futKey, row.futToken);
    if (!(spotBook && spotBook.ltp) && row.spotToken) needTokens.push(row.spotToken);
    if (!(futBook && futBook.ltp) && row.futToken) needTokens.push(row.futToken);
  }

  let closes = {};
  let histError = "";
  if (needTokens.length) {
    const hist = await historicalCloses(accessToken, needTokens.slice(0, 12));
    closes = hist.closes || {};
    histError = hist.error || "";
  }

  const underlyings = futs
    .map((row) => pricedRow(row, books, closes))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  const spots = underlyings.filter((row) => row.spot > 0).length;
  const futures = underlyings.filter((row) => row.future > 0).length;
  const tokensReady = underlyings.filter((row) => row.spot_token && row.fut_token).length;

  return {
    stocks_scanned: underlyings.length,
    spots_priced: spots,
    futures_priced: futures,
    tokens_ready: tokensReady,
    price_source: spots || futures ? (Object.keys(books).length ? "quote" : "historical") : "",
    price_error: priceError,
    hist_error: histError,
    needs_historical: Boolean(needTokens.length),
    expiries: futExpiries.slice(0, 2),
    nearest_expiry: nearestFut,
    next_expiry: nextFut,
    underlyings,
    opportunities: [],
    pairs_checked: underlyings.length,
    pairs_priced: spots,
  };
}

module.exports = { liveScan };
