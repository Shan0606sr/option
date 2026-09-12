const { loadInstruments, quoteMany, lookupQuote, isIndex } = require("./kite");

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
      futDump: Number(row.last_price) || 0,
      spotKey: `NSE:${row.name}`,
      spotToken: (equity.get(row.name) || {}).instrument_token,
      spotDump: Number((equity.get(row.name) || {}).last_price) || 0,
    });
  }

  const keys = futs.flatMap((row) => [row.spotKey, row.spotToken, row.futKey, row.futToken]);
  const books = await quoteMany(accessToken, keys);

  const underlyings = futs.map((row) => {
    const spotBook = lookupQuote(books, row.spotKey, row.spotToken);
    const futBook = lookupQuote(books, row.futKey, row.futToken);
    const spot = (spotBook && spotBook.ltp) || row.spotDump || 0;
    const future = (futBook && futBook.ltp) || row.futDump || 0;
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

  const spotsPriced = underlyings.filter((row) => row.spot > 0).length;
  const futsPriced = underlyings.filter((row) => row.future > 0).length;

  return {
    stocks_scanned: underlyings.length,
    spots_priced: spotsPriced,
    futures_priced: futsPriced,
    expiries: futExpiries.slice(0, 2),
    nearest_expiry: nearestFut,
    next_expiry: nextFut,
    underlyings,
    opportunities: [],
    pairs_checked: underlyings.length,
    pairs_priced: spotsPriced,
  };
}

module.exports = { liveScan };
