const ALERT_NET_RETURN = Number(process.env.ALERT_NET_RETURN || 1);
const ALERT_MIN_EXPIRY_DAYS = Number(process.env.ALERT_MIN_EXPIRY_DAYS || 7);
const NARROW_SPREAD = 0.05;
const WIDE_SPREAD = 0.08;
const VERY_WIDE_SPREAD = 0.15;
const GOOD_VOLUME = 20000;
const GOOD_OI = 100000;
const LOW_VOLUME = 2000;
const LOW_OI = 10000;
const PARTIAL_LOW_FRACTION = 0.1;
const LIQUIDITY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 };

function round2(n) {
  return Math.round(n * 100) / 100;
}

function spreadPct(bid, ask) {
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : Math.max(bid, ask, 0);
  if (mid <= 0 || ask <= 0 || bid <= 0) return 1;
  return Math.max(ask - bid, 0) / mid;
}

function daysToExpiry(expiry) {
  const exp = new Date(`${expiry}T00:00:00+05:30`);
  const today = new Date();
  const ist = new Date(today.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  ist.setHours(0, 0, 0, 0);
  return Math.round((exp - ist) / 86400000);
}

function execQty(strategy, lot, ce, pe) {
  return strategy === "A"
    ? Math.min(lot, ce.bid_qty || 0, pe.ask_qty || 0)
    : Math.min(lot, ce.ask_qty || 0, pe.bid_qty || 0);
}

function fullLot(strategy, lot, ce, pe) {
  return strategy === "A"
    ? ce.bid_qty >= lot && pe.ask_qty >= lot
    : ce.ask_qty >= lot && pe.bid_qty >= lot;
}

function liquidityScore(strategy, lot, ce, pe) {
  const qty = execQty(strategy, lot, ce, pe);
  const worst = Math.max(spreadPct(ce.bid, ce.ask), spreadPct(pe.bid, pe.ask));
  if (qty < lot * PARTIAL_LOW_FRACTION || worst >= VERY_WIDE_SPREAD || ce.volume < LOW_VOLUME || pe.volume < LOW_VOLUME || ce.oi < LOW_OI || pe.oi < LOW_OI) {
    return "LOW";
  }
  const goodVol = ce.volume >= GOOD_VOLUME && pe.volume >= GOOD_VOLUME;
  const goodOi = ce.oi >= GOOD_OI && pe.oi >= GOOD_OI;
  if (!fullLot(strategy, lot, ce, pe)) return "MEDIUM";
  if (worst >= WIDE_SPREAD || !goodVol || !goodOi) return "MEDIUM";
  if (worst <= NARROW_SPREAD && goodVol && goodOi) return "HIGH";
  return "MEDIUM";
}

function equityLeg(turnover, buy) {
  const brokerage = 0;
  const stt = turnover * 0.001;
  const exchange = turnover * 0.0000297;
  const sebi = turnover * 0.000001;
  const stamp = buy ? turnover * 0.00015 : 0;
  const other = turnover * 0.000001;
  const gst = 0.18 * (brokerage + exchange + sebi);
  return { brokerage, stt, exchange, gst, stamp, sebi, other };
}

function optionLeg(turnover, buy) {
  const brokerage = Math.min(20, turnover * 0.0003);
  const stt = buy ? 0 : turnover * 0.001;
  const exchange = turnover * 0.0003503;
  const sebi = turnover * 0.000001;
  const stamp = buy ? turnover * 0.00003 : 0;
  const other = turnover * 0.000005;
  const gst = 0.18 * (brokerage + exchange + sebi);
  return { brokerage, stt, exchange, gst, stamp, sebi, other };
}

function estimateCharges(strategy, spot, cePx, pePx, qty) {
  const empty = { brokerage: 0, stt: 0, exchange: 0, gst: 0, stamp: 0, sebi: 0, other: 0, total: 0 };
  if (qty <= 0) return empty;
  const out = { ...empty };
  for (const leg of [equityLeg(spot * qty, strategy === "A"), optionLeg(cePx * qty, strategy === "B"), optionLeg(pePx * qty, strategy === "A")]) {
    for (const key of Object.keys(leg)) out[key] += leg[key];
  }
  out.total = out.brokerage + out.stt + out.exchange + out.gst + out.stamp + out.sebi + out.other;
  for (const key of Object.keys(out)) out[key] = round2(out[key]);
  return out;
}

function buildOpportunity(quote, strategy) {
  const { spot, strike, lot_size: lot, ce, pe } = quote;
  const cePx = strategy === "A" ? ce.bid : ce.ask;
  const pePx = strategy === "A" ? pe.ask : pe.bid;
  if (cePx <= 0 || pePx <= 0) return null;
  const pps = strategy === "A" ? strike - spot + ce.bid - pe.ask : spot - strike - ce.ask + pe.bid;
  const cps = strategy === "A" ? spot - ce.bid + pe.ask : strike + ce.ask - pe.bid;
  if (cps <= 0) return null;
  const qty = execQty(strategy, lot, ce, pe);
  const isFull = fullLot(strategy, lot, ce, pe);
  const grossReturn = (pps / cps) * 100;
  const capital = cps * qty;
  const grossProfit = pps * qty;
  const charges = estimateCharges(strategy, spot, cePx, pePx, qty);
  const netProfit = grossProfit - charges.total;
  const netReturn = capital ? (netProfit / capital) * 100 : 0;
  const dte = daysToExpiry(quote.expiry);
  return {
    id: `${quote.symbol}-${quote.expiry}-${strike}-${strategy}`,
    symbol: quote.symbol,
    name: quote.name,
    expiry: quote.expiry,
    strike,
    spot,
    lot_size: lot,
    strategy,
    strategy_label: strategy === "A" ? "Buy Stock + Sell CE + Buy PE" : "Sell Stock + Buy CE + Sell PE",
    ce, pe, ce_px: cePx, pe_px: pePx,
    profit_per_share: pps,
    capital_per_share: cps,
    gross_return: grossReturn,
    net_return: netReturn,
    capital,
    gross_profit: grossProfit,
    lot_profit: pps * lot,
    net_profit: netProfit,
    charges,
    executable_qty: qty,
    full_lot: isFull,
    partial: qty > 0 && !isFull,
    liquidity: liquidityScore(strategy, lot, ce, pe),
    days_to_expiry: dte,
    effective_cost: strategy === "A" ? cps : spot - ce.ask + pe.bid,
    guaranteed_value: strike,
    alert: netReturn >= ALERT_NET_RETURN && isFull && dte >= ALERT_MIN_EXPIRY_DAYS,
  };
}

function rankOpportunities(rows) {
  rows.sort((a, b) => {
    const liq = LIQUIDITY_RANK[a.liquidity] - LIQUIDITY_RANK[b.liquidity];
    return liq !== 0 ? liq : b.net_return - a.net_return;
  });
  rows.forEach((row, i) => { row.rank = i + 1; });
  return rows;
}

module.exports = { buildOpportunity, rankOpportunities };
