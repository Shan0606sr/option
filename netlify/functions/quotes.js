const { readAccessCookie, marketOpen, quoteMany, historicalCloses, lookupQuote } = require("./lib/kite");

exports.handler = async (event) => {
  const access = readAccessCookie(event.headers.cookie || event.headers.Cookie || "");
  if (!access) {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Connect Zerodha first.", books: {}, closes: {} }),
    };
  }

  const params = event.queryStringParameters || {};
  const keys = String(params.keys || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean)
    .slice(0, 40);
  const tokens = String(params.tokens || "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 40);

  try {
    const quoted = await quoteMany(access, keys);
    const books = quoted.books || {};
    const skipHist = params.hist === "false";
    const missing = skipHist ? [] : tokens.filter((token) => !lookupQuote(books, token));
    const hist = missing.length ? await historicalCloses(access, missing.slice(0, 12)) : { closes: {} };
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({
        connected: true,
        market_open: marketOpen(),
        books,
        closes: hist.closes || {},
        error: Object.keys(books).length || Object.keys(hist.closes || {}).length
          ? ""
          : (quoted.error || hist.error || ""),
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: error.message, books: {}, closes: {} }),
    };
  }
};
