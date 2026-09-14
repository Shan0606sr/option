const { loadInstruments, quoteMany, lookupQuote, rowToken } = require("./kite");
const { bookFromQuote } = require("./call-arb");

const ETF_CATALOG = [
  {
    id: "SILVERBEES",
    symbol: "SILVERBEES",
    exchange: "NSE",
    label: "Nippon India Silver ETF",
    gramsPerUnit: 1,
  },
];

const FUT_CATALOG = [
  {
    id: "SILVERMIC",
    name: "SILVERMIC",
    exchange: "MCX",
    kgPerLot: 1,
    quotePerKg: true,
  },
];

function todayIst() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function daysToExpiry(expiry, today) {
  const a = Date.parse(`${today}T00:00:00+05:30`);
  const b = Date.parse(`${String(expiry).slice(0, 10)}T00:00:00+05:30`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

function findEtf(nse, symbol) {
  const wanted = String(symbol || "").toUpperCase();
  return (nse || []).find((row) => {
    const ts = String(row.tradingsymbol || "").toUpperCase();
    const name = String(row.name || "").toUpperCase();
    const type = String(row.instrument_type || "").toUpperCase();
    return (ts === wanted || name === wanted) && (type === "EQ" || type === "BE" || type === "");
  }) || null;
}

function findFutures(mcx, name, today) {
  const wanted = String(name || "").toUpperCase();
  return (mcx || [])
    .filter((row) => {
      const ts = String(row.tradingsymbol || "").toUpperCase();
      const nm = String(row.name || "").toUpperCase();
      const type = String(row.instrument_type || "").toUpperCase();
      const expiry = String(row.expiry || "").slice(0, 10);
      if (type !== "FUT") return false;
      if (!(nm === wanted || ts.startsWith(wanted))) return false;
      return expiry && expiry >= today;
    })
    .sort((a, b) => String(a.expiry).localeCompare(String(b.expiry)) || String(a.tradingsymbol).localeCompare(String(b.tradingsymbol)));
}

function silverPair(etfMeta, etfRow, futMeta, futRow, today) {
  const expiry = String(futRow.expiry || "").slice(0, 10);
  const lot = Number(futRow.lot_size) || 1;
  return {
    etf_id: etfMeta.id,
    etf_symbol: etfRow.tradingsymbol,
    etf_label: etfMeta.label,
    etf_exchange: etfMeta.exchange,
    etf_key: `${etfMeta.exchange}:${etfRow.tradingsymbol}`,
    etf_token: rowToken(etfRow),
    grams_per_unit: Number(etfMeta.gramsPerUnit) || 1,
    fut_id: futMeta.id,
    fut_name: futMeta.name,
    fut_symbol: futRow.tradingsymbol,
    fut_exchange: futMeta.exchange,
    fut_key: `${futMeta.exchange}:${futRow.tradingsymbol}`,
    fut_token: rowToken(futRow),
    expiry,
    days: daysToExpiry(expiry, today),
    lot_size: lot,
    tick_size: Number(futRow.tick_size) || 1,
    kg_per_lot: Number(futMeta.kgPerLot) || 1,
  };
}

async function silverArbUniverse(accessToken, {
  etf = "SILVERBEES",
  future = "SILVERMIC",
  seed = true,
} = {}) {
  const { nse, mcx } = await loadInstruments(accessToken);
  const today = todayIst();
  const etfMeta = ETF_CATALOG.find((row) => row.id === String(etf || "").toUpperCase()) || ETF_CATALOG[0];
  const futMeta = FUT_CATALOG.find((row) => row.id === String(future || "").toUpperCase()) || FUT_CATALOG[0];
  const etfRow = findEtf(nse, etfMeta.symbol);
  const futs = findFutures(mcx, futMeta.name, today);
  const pairs = etfRow ? futs.map((futRow) => silverPair(etfMeta, etfRow, futMeta, futRow, today)) : [];
  const tokens = [...new Set(pairs.flatMap((row) => [Number(row.etf_token), Number(row.fut_token)].filter(Boolean)))];
  const keys = [...new Set(pairs.flatMap((row) => [row.etf_key, row.fut_key]))];

  let books = {};
  let priceError = "";
  if (seed && keys.length) {
    const quoted = await quoteMany(accessToken, keys);
    books = quoted.books || {};
    priceError = quoted.error || "";
  }

  const seedBooks = {};
  const now = Date.now();
  for (const row of pairs) {
    seedBooks[row.etf_token] = { ...bookFromQuote(lookupQuote(books, row.etf_key, row.etf_token)), ts: now };
    seedBooks[row.fut_token] = { ...bookFromQuote(lookupQuote(books, row.fut_key, row.fut_token)), ts: now };
  }

  return {
    etfs: ETF_CATALOG,
    futures: FUT_CATALOG,
    pairs,
    tokens,
    keys,
    books: seedBooks,
    price_error: priceError,
    mcx_loaded: Array.isArray(mcx) && mcx.length > 0,
    stocks_scanned: etfRow ? 1 : 0,
    pair_count: pairs.length,
    methodology: "SILVERBEES vs every tradable SILVERMIC expiry, ₹/kg",
  };
}

module.exports = {
  silverArbUniverse,
  ETF_CATALOG,
  FUT_CATALOG,
  unitsCatalog: ETF_CATALOG,
  daysToExpiry,
  findEtf,
  findFutures,
};
