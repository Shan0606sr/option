const { loginUrl } = require("./lib/kite");

exports.handler = async () => {
  try {
    return {
      statusCode: 302,
      headers: { Location: loginUrl(), "Cache-Control": "no-store" },
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/plain" },
      body: error.message,
    };
  }
};
