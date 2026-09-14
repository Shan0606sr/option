const { readAccessCookie, marketOpen, quoteMany } = require("./lib/kite");
const { calendarArbUniverse, applyCalendarSeedBooks } = require("./lib/calendar-arb");

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
    const snapshot = await calendarArbUniverse(access, {
      pairMode: params.pair || "near-next",
      symbol: params.symbol || "",
      bandPct: Number(params.band || 6),
      maxStrikes: params.max_strikes === "" ? 0 : Number(params.max_strikes || 3),
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
      extraBooks = applyCalendarSeedBooks(
        snapshot.pairs.filter((row) => keys.includes(row.near_ce_key) || keys.includes(row.near_pe_key)
          || keys.includes(row.far_ce_key) || keys.includes(row.far_pe_key)
          || keys.includes(row.near_fut_key) || keys.includes(row.far_fut_key) || keys.includes(row.eq_key)),
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
        ? `Calendar universe: ${snapshot.stocks_scanned} names, ${snapshot.pair_count} same-strike near/far synthetics.`
        : (snapshot.price_error || "No near/far option calendars."),
      ...snapshot,
      books: { ...snapshot.books, ...extraBooks },
      price_error: snapshot.price_error || extraError,
    });
  } catch (error) {
    return json(500, { connected: true, error: error.message, pairs: [], stocks: [] });
  }
};
