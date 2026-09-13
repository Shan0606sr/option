function u32(view, offset) {
  return view.getUint32(offset);
}

function parseDepthSide(view, start, divisor) {
  const levels = [];
  for (let i = 0; i < 5; i += 1) {
    const o = start + i * 12;
    levels.push({
      qty: u32(view, o),
      price: u32(view, o + 4) / divisor,
      orders: view.getUint16(o + 8),
    });
  }
  return levels;
}

function parsePacket(buffer) {
  const view = new DataView(buffer);
  const len = buffer.byteLength;
  if (len < 8) return null;
  const token = u32(view, 0);
  const segment = token & 0xff;
  const divisor = segment === 3 ? 10000000 : 100;
  const tick = {
    instrument_token: String(token),
    ltp: u32(view, 4) / divisor,
    bid: 0,
    ask: 0,
    bid_qty: 0,
    ask_qty: 0,
  };
  tick.bid_depth = 0;
  tick.ask_depth = 0;
  if (len === 184) {
    const bids = parseDepthSide(view, 64, divisor);
    const asks = parseDepthSide(view, 124, divisor);
    tick.bid = (bids[0] && bids[0].price) || 0;
    tick.ask = (asks[0] && asks[0].price) || 0;
    tick.bid_qty = (bids[0] && bids[0].qty) || 0;
    tick.ask_qty = (asks[0] && asks[0].qty) || 0;
    tick.bid_depth = bids.reduce((sum, level) => sum + (level.qty || 0), 0);
    tick.ask_depth = asks.reduce((sum, level) => sum + (level.qty || 0), 0);
  }
  tick.ts = Date.now();
  return tick;
}

function parseFrame(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 2) return [];
  let offset = 0;
  const count = view.getUint16(offset);
  offset += 2;
  const ticks = [];
  for (let i = 0; i < count && offset + 2 <= buffer.byteLength; i += 1) {
    const size = view.getUint16(offset);
    offset += 2;
    if (offset + size > buffer.byteLength) break;
    const tick = parsePacket(buffer.slice(offset, offset + size));
    if (tick) ticks.push(tick);
    offset += size;
  }
  return ticks;
}

function connectKiteTicker({ wsUrl, tokens, onTicks, onStatus }) {
  let ws = null;
  let closed = false;
  let ping = null;

  function status(text) {
    if (onStatus) onStatus(text);
  }

  function open() {
    if (closed) return;
    ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      status("WebSocket live");
      const nums = tokens.map((token) => Number(token)).filter(Boolean);
      const chunk = 500;
      for (let i = 0; i < nums.length; i += chunk) {
        const slice = nums.slice(i, i + chunk);
        ws.send(JSON.stringify({ a: "subscribe", v: slice }));
        ws.send(JSON.stringify({ a: "mode", v: ["full", slice] }));
      }
      ping = window.setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ a: "ping", v: "" }));
      }, 25000);
    };
    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        if (event.data === "ping") {
          try { ws.send("pong"); } catch (_err) { /* ignore */ }
        }
        return;
      }
      const ticks = parseFrame(event.data);
      if (ticks.length && onTicks) onTicks(ticks);
    };
    ws.onerror = () => status("WebSocket error");
    ws.onclose = () => {
      if (ping) window.clearInterval(ping);
      ping = null;
      if (!closed) {
        status("WebSocket reconnecting…");
        window.setTimeout(open, 1500);
      }
    };
  }

  open();
  return {
    close() {
      closed = true;
      if (ping) window.clearInterval(ping);
      if (ws) ws.close();
    },
  };
}

window.connectKiteTicker = connectKiteTicker;
