const { readAccessCookie, marketOpen } = require("./lib/kite");
const { synthUniverse, seedBooks } = require("./lib/synth");

exports.handler = async (event) => {
  const access = readAccessCookie(event.headers.cookie || event.headers.Cookie || "");
  if (!access) {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connected: false, error: "Connect Zerodha first.", pairs: [] }),
    };
  }

  const params = event.queryStringParameters || {};
  try {
    const snapshot = await synthUniverse(access, {
      seed: params.seed !== "false",
      expiry: params.expiry || "nearest",
    });
    const now = new Date().toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" });
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({
        connected: true,
        market_open: marketOpen(),
        last_update: now,
        pair_count: snapshot.pairs.length,
        message: snapshot.pairs.length
          ? `NIFTY synthetic universe: ${snapshot.pairs.length} CE/PE pairs on ${snapshot.pairs[0] && snapshot.pairs[0].expiry}.`
          : (snapshot.price_error || "No NIFTY option pairs found."),
        ...snapshot,
        books: seedBooks(snapshot.pairs, snapshot.books),
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connected: true, error: error.message, pairs: [] }),
    };
  }
};
