const { readAccessCookie, kitePost } = require("./lib/kite");

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}

function asOrder(row) {
  return {
    exchange: row.exchange || "NFO",
    tradingsymbol: row.tradingsymbol,
    transaction_type: String(row.transaction_type || "BUY").toUpperCase(),
    variety: row.variety || "regular",
    product: row.product || "NRML",
    order_type: row.order_type || "LIMIT",
    quantity: Number(row.quantity) || 0,
    price: Number(row.price) || 0,
  };
}

function moneyOf(block) {
  if (!block || typeof block !== "object") return 0;
  return Number(block.total || block.final || block.span || 0);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const access = readAccessCookie(event.headers.cookie || event.headers.Cookie || "");
  if (!access) return json(401, { error: "Connect Zerodha first.", uncertain: true });

  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (_err) {
    return json(400, { error: "Invalid JSON", uncertain: true });
  }
  const orders = (payload.orders || []).map(asOrder).filter((row) => row.tradingsymbol && row.quantity > 0);
  if (!orders.length) return json(400, { error: "orders required", uncertain: true });

  try {
    const basket = await kitePost("/margins/basket?consider_positions=false", access, orders);
    const data = basket.data || basket;
    const required = moneyOf(data.final) || moneyOf(data.initial) || Number(data.final_margin || data.initial_margin || 0);
    const standalone = [];
    for (const order of orders) {
      try {
        const one = await kitePost("/margins/orders", access, [order]);
        const block = (one.data && (one.data.equity || one.data.commodity || one.data)) || one.data || {};
        standalone.push({
          tradingsymbol: order.tradingsymbol,
          transaction_type: order.transaction_type,
          required: moneyOf(block) || Number(block.total || 0),
        });
      } catch (_err) {
        standalone.push({ tradingsymbol: order.tradingsymbol, transaction_type: order.transaction_type, required: 0 });
      }
    }
    const standaloneFuture = (standalone.find((row) => /FUT/i.test(row.tradingsymbol)) || {}).required || 0;
    const standaloneShortPut = (standalone.find((row) => row.transaction_type === "SELL" && /PE$/i.test(row.tradingsymbol)) || {}).required || 0;
    const standaloneShortCall = (standalone.find((row) => row.transaction_type === "SELL" && /CE$/i.test(row.tradingsymbol)) || {}).required || 0;
    return json(200, {
      uncertain: !(required > 0),
      source: required > 0 ? "kite" : "kite-empty",
      required,
      combined: required,
      standaloneFuture,
      standaloneShortPut,
      standaloneShortCall,
      benefit: Math.max(0, standaloneFuture + standaloneShortPut + standaloneShortCall - required),
      standalone,
    });
  } catch (error) {
    return json(200, { uncertain: true, source: "error", error: error.message, required: 0 });
  }
};
