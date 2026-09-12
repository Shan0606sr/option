const { exchangeRequestToken, accessCookie } = require("./lib/kite");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  try {
    const payload = JSON.parse(event.body || "{}");
    if (!payload.request_token) {
      return { statusCode: 400, body: JSON.stringify({ error: "request_token required" }) };
    }
    const token = await exchangeRequestToken(payload.request_token);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": accessCookie(token),
      },
      body: JSON.stringify({ connected: true }),
    };
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ error: error.message }) };
  }
};
