const { readAccessCookie, marketOpen, historicalCloses } = require("./lib/kite");

exports.handler = async (event) => {
  const access = readAccessCookie(event.headers.cookie || event.headers.Cookie || "");
  if (!access) {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Connect Zerodha first.", closes: {} }),
    };
  }

  const params = event.queryStringParameters || {};
  const tokens = String(params.tokens || "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 12);

  try {
    const result = await historicalCloses(access, tokens);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({
        connected: true,
        market_open: marketOpen(),
        closes: result.closes || {},
        error: result.error || "",
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: error.message, closes: {} }),
    };
  }
};
