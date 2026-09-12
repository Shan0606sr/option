const { clearAccessCookie } = require("./lib/kite");

exports.handler = async () => {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Set-Cookie": clearAccessCookie(),
    },
    body: JSON.stringify({ connected: false }),
  };
};
