const { readAccessCookie, marketOpen, quoteMany } = require("./lib/kite");
const { vertPeUniverse, applyVertPeSeedBooks } = require("./lib/vert-pe");

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
    return json(401, { connected: false, error: "Connect Zerodha first.", pairs: [], stocks: [] });
  }

  const params = event.queryStringParameters || {};
  try {
    const snapshot = await vertPeUniverse(access, {
      expiry: params.expiry || "nearest",
      symbol: params.symbol || "",
      bandPct: Number(params.band || 6),
      maxStrikes: params.max_strikes === "" ? 0 : Number(params.max_strikes || 5),
      seed: params.seed !== "false",
    });

    const keys = String(params.keys || "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean)
      .slice(0, 80);
    let extraBooks = {};
    let extraError = "";
    if (keys.length) {
      const quoted = await quoteMany(access, keys);
      extraBooks = applyVertPeSeedBooks(
        snapshot.pairs.filter((row) => keys.includes(row.k1_pe_key) || keys.includes(row.k2_pe_key)),
        quoted.books || {},
      );
      extraError = quoted.error || "";
    }

    const now = new Date().toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" });
    return json(200, {
      connected: true,
      market_open: marketOpen(),
      last_update: now,
      message: snapshot.pairs.length
        ? `Put vertical universe: ${snapshot.stocks_scanned} names, ${snapshot.pair_count} K1/K2 Put pairs.`
        : (snapshot.price_error || "No matching same-expiry Put pairs."),
      ...snapshot,
      books: { ...snapshot.books, ...extraBooks },
      price_error: snapshot.price_error || extraError,
    });
  } catch (error) {
    return json(500, { connected: true, error: error.message, pairs: [], stocks: [] });
  }
};
