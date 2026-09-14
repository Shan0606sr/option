const { readAccessCookie, marketOpen, quoteMany } = require("./lib/kite");
const { silverArbUniverse } = require("./lib/silver-arb");
const { silverOverlapSession } = require("./lib/nse-session");

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  const access = readAccessCookie(event.headers.cookie || event.headers.Cookie || "");
  if (!access) {
    return json(401, { connected: false, error: "Connect Zerodha first.", pairs: [], etfs: [] });
  }

  const params = event.queryStringParameters || {};
  try {
    const snapshot = await silverArbUniverse(access, {
      etf: params.etf || "SILVERBEES",
      future: params.future || "SILVERMIC",
      seed: params.seed !== "false",
    });

    const keys = String(params.keys || "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean)
      .slice(0, 40);
    let extraBooks = snapshot.books || {};
    let extraError = "";
    if (keys.length) {
      const quoted = await quoteMany(access, keys);
      extraBooks = { ...extraBooks, ...(quoted.books || {}) };
      extraError = quoted.error || "";
    }

    const overlap = silverOverlapSession();
    const now = new Date().toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" });
    return json(200, {
      connected: true,
      market_open: marketOpen(),
      overlap_live: overlap.live,
      overlap_reason: overlap.reason,
      last_update: now,
      message: snapshot.pairs.length
        ? `Silver universe: ${snapshot.pairs[0].etf_symbol} vs ${snapshot.pair_count} ${snapshot.pairs[0].fut_id} expiries.`
        : (snapshot.price_error || (snapshot.mcx_loaded ? "No matching SILVERMIC expiries." : "MCX instrument list unavailable.")),
      ...snapshot,
      books: extraBooks,
      price_error: snapshot.price_error || extraError,
    });
  } catch (error) {
    return json(500, { connected: true, error: error.message, pairs: [], etfs: [] });
  }
};
