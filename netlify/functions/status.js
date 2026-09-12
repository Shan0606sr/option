const { readAccessCookie, marketOpen } = require("./lib/kite");

exports.handler = async (event) => {
  const connected = Boolean(readAccessCookie(event.headers.cookie || event.headers.Cookie || ""));
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({
      connected,
      market_open: marketOpen(),
      mode: "live",
      login_url: "/api/login",
    }),
  };
};
