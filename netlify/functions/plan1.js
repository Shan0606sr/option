const { readAccessCookie, marketOpen } = require("./lib/kite");
const { plan1Scan } = require("./lib/plan1");

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
        stocks: [],
        rows: [],
      }),
    };
  }

  const symbol = String((event.queryStringParameters || {}).symbol || "").trim();
  try {
    const snapshot = await plan1Scan(access, symbol);
    const now = new Date().toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" });
    const open = marketOpen();
    let message = "";
    if (symbol && snapshot.rows.length) {
      message = `${symbol}: ${snapshot.rows.length} strikes · ${snapshot.hits} positive · ${snapshot.rows.length - snapshot.hits} negative/flat${open ? "" : " (weekend last price OK)"}.`;
    } else if (symbol) {
      message = snapshot.price_error || `No strikes returned for ${symbol}.`;
    } else {
      message = `Select a stock. ${snapshot.stocks_scanned || 0} F&O names loaded.`;
    }
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({
        connected: true,
        market_open: open,
        last_update: now,
        message,
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
        stocks: [],
        rows: [],
      }),
    };
  }
};
