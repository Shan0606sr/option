const { exchangeRequestToken, accessCookie } = require("./lib/kite");

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const requestToken = params.request_token;
  const site = process.env.URL || "https://celebrated-sunflower-7709a2.netlify.app";
  if (!requestToken || params.status === "error") {
    return { statusCode: 302, headers: { Location: `${site}/?kite=failed` } };
  }
  try {
    const token = await exchangeRequestToken(requestToken);
    return {
      statusCode: 302,
      headers: {
        Location: `${site}/?kite=connected`,
        "Set-Cookie": accessCookie(token),
        "Cache-Control": "no-store",
      },
    };
  } catch (error) {
    return {
      statusCode: 302,
      headers: { Location: `${site}/?kite=failed&reason=${encodeURIComponent(error.message)}` },
    };
  }
};
