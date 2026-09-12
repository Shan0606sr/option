const { readAccessCookie, marketOpen, historicalCloses, yahooLast, yahooFutSymbol } = require("./lib/kite");

exports.handler = async (event) => {
  const access = readAccessCookie(event.headers.cookie || event.headers.Cookie || "");
  if (!access) {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Connect Zerodha first.", closes: {}, spots: {}, futures: {} }),
    };
  }

  const params = event.queryStringParameters || {};
  const tokens = String(params.tokens || "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 12);
  const symbols = String(params.symbols || "")
    .split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean)
    .slice(0, 8);
  const expiry = String(params.expiry || "");

  try {
    const hist = await historicalCloses(access, tokens);
    const closes = hist.closes || {};
    const spots = {};
    const futures = {};
    if (hist.error || tokens.some((token) => !closes[token])) {
      await Promise.all(symbols.map(async (symbol) => {
        try {
          const spot = await yahooLast(`${symbol}.NS`);
          if (spot) spots[symbol] = spot;
        } catch (_err) { /* keep going */ }
        const futName = yahooFutSymbol(symbol, expiry);
        if (!futName) return;
        try {
          const fut = await yahooLast(futName);
          if (fut) futures[symbol] = fut;
        } catch (_err) { /* keep going */ }
      }));
    }
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({
        connected: true,
        market_open: marketOpen(),
        closes,
        spots,
        futures,
        error: Object.keys(closes).length || Object.keys(spots).length
          ? ""
          : (hist.error || "No last close returned."),
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: error.message, closes: {}, spots: {}, futures: {} }),
    };
  }
};
