const { readAccessCookie, apiKey, marketOpen } = require("./lib/kite");

exports.handler = async (event) => {
  const access = readAccessCookie(event.headers.cookie || event.headers.Cookie || "");
  if (!access) {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connected: false, error: "Connect Zerodha first." }),
    };
  }
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({
      connected: true,
      market_open: marketOpen(),
      api_key: apiKey(),
      access_token: access,
      ws_url: `wss://ws.kite.trade?api_key=${encodeURIComponent(apiKey())}&access_token=${encodeURIComponent(access)}`,
    }),
  };
};
