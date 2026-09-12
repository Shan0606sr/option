const { loadInstruments, quoteMany, isIndex } = require("./kite");
const { buildOpportunity, rankOpportunities } = require("./parity");

function upcomingExpiries(nfo, today) {
  const found = new Set();
  for (const row of nfo) {
    if (row.instrument_type !== "CE" && row.instrument_type !== "PE") continue;
    const exp = (row.expiry || "").slice(0, 10);
    if (exp && exp >= today) found.add(exp);
  }
  return [...found].sort();
}

function nearestStrikes(strikes, spot, count) {
  return [...strikes]
    .sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot))
    .slice(0, count)
    .sort((a, b) => a - b);
}

async function liveScan(accessToken, { minReturn = 0, strategyA = true, strategyB = true } = {}) {
  const { nse, nfo } = await loadInstruments(accessToken);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const expiries = upcomingExpiries(nfo, today).slice(0, 2);
  const equity = new Map();
  for (const row of nse) {
    if (row.instrument_type !== "EQ" || row.exchange !== "NSE") continue;
    equity.set(row.tradingsymbol, row);
  }

  const chains = new Map();
  for (const row of nfo) {
    if ((row.instrument_type !== "CE" && row.instrument_type !== "PE") || isIndex(row.name)) continue;
    if (!expiries.includes((row.expiry || "").slice(0, 10))) continue;
    if (!equity.has(row.name)) continue;
    const key = `${row.name}|${row.expiry.slice(0, 10)}|${Number(row.strike)}`;
    if (!chains.has(key)) {
      chains.set(key, {
        symbol: row.name,
        name: row.name,
        expiry: row.expiry.slice(0, 10),
        strike: Number(row.strike),
        lot_size: Number(row.lot_size) || 1,
        ceKey: null,
        peKey: null,
      });
    }
    const pair = chains.get(key);
    const qkey = `NFO:${row.tradingsymbol}`;
    if (row.instrument_type === "CE") pair.ceKey = qkey;
    if (row.instrument_type === "PE") pair.peKey = qkey;
  }

  const symbols = [...new Set([...chains.values()].map((p) => p.symbol))];
  const spotKeys = symbols.map((sym) => `NSE:${sym}`);
  const spots = await quoteMany(accessToken, spotKeys);

  const selected = [];
  for (const symbol of symbols) {
    const spot = (spots[`NSE:${symbol}`] || {}).last_price || 0;
    if (spot <= 0) continue;
    const byExpiry = new Map();
    for (const pair of chains.values()) {
      if (pair.symbol !== symbol || !pair.ceKey || !pair.peKey) continue;
      if (!byExpiry.has(pair.expiry)) byExpiry.set(pair.expiry, []);
      byExpiry.get(pair.expiry).push(pair);
    }
    for (const pairs of byExpiry.values()) {
      const keep = new Set(nearestStrikes(pairs.map((p) => p.strike), spot, 3));
      for (const pair of pairs) {
        if (keep.has(pair.strike)) selected.push({ ...pair, spot });
      }
    }
  }

  const optionKeys = selected.flatMap((p) => [p.ceKey, p.peKey]);
  const books = await quoteMany(accessToken, optionKeys);
  const strategies = [];
  if (strategyA) strategies.push("A");
  if (strategyB) strategies.push("B");

  const quotes = selected.map((pair) => ({
    symbol: pair.symbol,
    name: pair.name,
    expiry: pair.expiry,
    strike: pair.strike,
    spot: pair.spot,
    lot_size: pair.lot_size,
    ce: { ltp: 0, volume: 0, oi: 0, bid: 0, ask: 0, bid_qty: 0, ask_qty: 0, ...(books[pair.ceKey] || {}) },
    pe: { ltp: 0, volume: 0, oi: 0, bid: 0, ask: 0, bid_qty: 0, ask_qty: 0, ...(books[pair.peKey] || {}) },
  }));

  const rows = [];
  let priced = 0;
  for (const quote of quotes) {
    if ((quote.ce.ltp || quote.ce.bid || quote.ce.ask) && (quote.pe.ltp || quote.pe.bid || quote.pe.ask)) {
      priced += 1;
    }
    for (const strategy of strategies) {
      const opp = buildOpportunity(quote, strategy);
      if (!opp) continue;
      if (!opp.used_ltp && opp.gross_return < minReturn) continue;
      rows.push(opp);
    }
  }

  return {
    stocks_scanned: symbols.length,
    expiries,
    nearest_expiry: expiries[0] || null,
    next_expiry: expiries[1] || null,
    opportunities: rankOpportunities(rows),
    pairs_checked: selected.length,
    pairs_priced: priced,
  };
}

module.exports = { liveScan };
