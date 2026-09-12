const { readAccessCookie, marketOpen } = require("./lib/kite");
const { liveScan } = require("./lib/scan");

exports.handler = async (event) => {
  const access = readAccessCookie(event.headers.cookie || event.headers.Cookie || "");
  if (!access) {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connected: false,
        market_open: marketOpen(),
        error: "Connect Zerodha first.",
        opportunities: [],
      }),
    };
  }

  const params = event.queryStringParameters || {};
  try {
    const snapshot = await liveScan(access, {
      minReturn: Number(params.min_return || 0),
      strategyA: params.strategy_a !== "false",
      strategyB: params.strategy_b !== "false",
    });
    const now = new Date().toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" });
    const open = marketOpen();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({
        mode: "live",
        connected: true,
        market_open: open,
        last_update: now,
        message: open
          ? null
          : `NSE is closed. LTP estimates — checked ${snapshot.pairs_checked || 0} pairs, priced ${snapshot.pairs_priced || 0}, spots ${snapshot.spots_priced || 0}. Negative returns are included. Not executable until Monday 09:15 IST.`,
        alerts: snapshot.opportunities.filter((row) => row.alert),
        ...snapshot,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connected: true,
        market_open: marketOpen(),
        error: error.message,
        opportunities: [],
      }),
    };
  }
};
