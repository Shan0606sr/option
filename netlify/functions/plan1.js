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
        rows: [],
      }),
    };
  }

  try {
    const snapshot = await plan1Scan(access);
    const now = new Date().toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" });
    const open = marketOpen();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({
        connected: true,
        market_open: open,
        last_update: now,
        message: snapshot.pairs_priced
          ? `Option plan 1: ${snapshot.pairs_priced} deep-ITM pairs priced, ${snapshot.hits} with LTP < strike + CE − PE${open ? "" : " (weekend last price OK)"}.`
          : (snapshot.stocks_scanned
            ? `Picked ${snapshot.stocks_scanned} deep-ITM strikes. Loading CE and PE premiums next.`
            : (snapshot.price_error || "No F&O spots available to pick deep-ITM strikes.")),
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
        rows: [],
      }),
    };
  }
};
