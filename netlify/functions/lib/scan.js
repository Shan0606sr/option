const { loadInstruments, quoteMany, historicalCloses, lookupQuote, isIndex } = require("./kite");

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
    futs.push({
      symbol: row.name,
      name: row.name,
      expiry: exp,
      lot_size: Number(row.lot_size) || 1,
      futKey: `NFO:${row.tradingsymbol}`,
      futToken: row.instrument_token,
      spotKey: `NSE:${row.name}`,
      spotToken: (equity.get(row.name) || {}).instrument_token,
    });
  }

  const quoted = await quoteMany(accessToken, futs.flatMap((row) => [row.spotKey, row.futKey]));
  const books = quoted.books || {};
  let priceSource = "quote";
  let priceError = quoted.error || "";

  const needTokens = [];
  for (const row of futs) {
    const spotBook = lookupQuote(books, row.spotKey, row.spotToken);
    const futBook = lookupQuote(books, row.futKey, row.futToken);
    if (!(spotBook && spotBook.ltp) && row.spotToken) needTokens.push(row.spotToken);
    if (!(futBook && futBook.ltp) && row.futToken) needTokens.push(row.futToken);
  }

  let closes = {};
  if (needTokens.length) {
    const hist = await historicalCloses(accessToken, needTokens);
    closes = hist.closes || {};
    if (Object.keys(closes).length) priceSource = quoted.error ? "historical" : "quote+historical";
    if (hist.error && !Object.keys(closes).length) priceError = hist.error;
    else if (!quoted.error) priceError = "";
  }

  const underlyings = futs.map((row) => {
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
    };
  }).sort((a, b) => a.symbol.localeCompare(b.symbol));

  return {
    stocks_scanned: underlyings.length,
    spots_priced: underlyings.filter((row) => row.spot > 0).length,
    futures_priced: underlyings.filter((row) => row.future > 0).length,
    price_source: priceSource,
    price_error: priceError,
    expiries: futExpiries.slice(0, 2),
    nearest_expiry: nearestFut,
    next_expiry: nextFut,
    underlyings,
    opportunities: [],
    pairs_checked: underlyings.length,
    pairs_priced: underlyings.filter((row) => row.spot > 0).length,
  };
}

module.exports = { liveScan };
