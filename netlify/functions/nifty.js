const { readAccessCookie, marketOpen, fetchNifty, apiKey } = require("./lib/kite");

exports.handler = async (event) => {
  const access = readAccessCookie(event.headers.cookie || event.headers.Cookie || "");
  if (!access) {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connected: false,
        error: "Connect Zerodha first.",
        live: 0,
        previous_close: 0,
      }),
    };
  }

  let keyTail = "";
  try {
    keyTail = apiKey().slice(-4);
  } catch (_err) {
    keyTail = "";
  }

  try {
    const nifty = await fetchNifty(access);
    const now = new Date().toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" });
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({
        connected: true,
        market_open: marketOpen(),
        last_update: now,
        api_key_tail: keyTail,
        ...nifty,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connected: true,
        market_open: marketOpen(),
        api_key_tail: keyTail,
        error: error.message,
        live: 0,
        previous_close: 0,
      }),
    };
  }
};
