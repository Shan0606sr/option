const crypto = require("crypto");

const INDEX_NAMES = new Set([
  "NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50",
  "SENSEX", "BANKEX", "SENSEX50",
]);

function apiKey() {
  const key = process.env.KITE_API_KEY || "";
  if (!key) throw new Error("KITE_API_KEY is missing in Netlify environment variables.");
  return key;
}

function apiSecret() {
  const secret = process.env.KITE_API_SECRET || "";
  if (!secret) throw new Error("KITE_API_SECRET is missing in Netlify environment variables.");
  return secret;
}

function loginUrl() {
  return `https://kite.zerodha.com/connect/login?v=3&api_key=${encodeURIComponent(apiKey())}`;
}

function checksum(requestToken) {
  return crypto
    .createHash("sha256")
    .update(apiKey() + requestToken + apiSecret())
    .digest("hex");
}

function authHeader(accessToken) {
  return `token ${apiKey()}:${accessToken}`;
}

async function exchangeRequestToken(requestToken) {
  const body = new URLSearchParams({
    api_key: apiKey(),
    request_token: requestToken,
    checksum: checksum(requestToken),
  });
  const res = await fetch("https://api.kite.trade/session/token", {
    method: "POST",
    headers: {
      "X-Kite-Version": "3",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = await res.json();
  if (!res.ok || !json.data || !json.data.access_token) {
    throw new Error(json.message || "Kite login failed. Try Connect Zerodha again.");
  }
  return json.data.access_token;
}

async function kiteGet(path, accessToken) {
  const res = await fetch(`https://api.kite.trade${path}`, {
    headers: {
      "X-Kite-Version": "3",
      Authorization: authHeader(accessToken),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kite ${path} failed: ${res.status} ${text.slice(0, 180)}`);
  }
  return res;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    const row = {};
    headers.forEach((header, i) => {
      row[header] = cols[i] || "";
    });
    return row;
  });
}

let instrumentCache = { day: "", nse: null, nfo: null };

async function loadInstruments(accessToken) {
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  if (instrumentCache.day === day && instrumentCache.nse && instrumentCache.nfo) {
    return instrumentCache;
  }
  const [nseRes, nfoRes] = await Promise.all([
    kiteGet("/instruments/NSE", accessToken),
    kiteGet("/instruments/NFO", accessToken),
  ]);
  instrumentCache = {
    day,
    nse: parseCsv(await nseRes.text()),
    nfo: parseCsv(await nfoRes.text()),
  };
  return instrumentCache;
}

function parseQuote(q) {
  const depth = q.depth || {};
  const buy = (depth.buy || [])[0] || {};
  const sell = (depth.sell || [])[0] || {};
  const last = q.last_price || 0;
  return {
    last_price: last,
    ltp: last,
    volume: q.volume || 0,
    oi: q.oi || 0,
    bid: buy.price || 0,
    bid_qty: buy.quantity || 0,
    ask: sell.price || 0,
    ask_qty: sell.quantity || 0,
  };
}

async function quoteMany(accessToken, keys) {
  const out = {};
  const chunk = 400;
  for (let i = 0; i < keys.length; i += chunk) {
    const slice = keys.slice(i, i + chunk);
    const qs = slice.map((key) => `i=${encodeURIComponent(key)}`).join("&");
    const res = await kiteGet(`/quote?${qs}`, accessToken);
    const json = await res.json();
    const data = json.data || {};
    for (const [key, q] of Object.entries(data)) {
      out[key] = parseQuote(q);
    }
    if (i + chunk < keys.length) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return out;
}

function isIndex(name) {
  return INDEX_NAMES.has(String(name || "").toUpperCase());
}

function accessCookie(token) {
  return [
    `kite_access=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${20 * 60 * 60}`,
  ].join("; ");
}

function readAccessCookie(cookieHeader) {
  if (!cookieHeader) return "";
  const match = cookieHeader.match(/(?:^|;\s*)kite_access=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function marketOpen(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday").value;
  const hour = Number(parts.find((p) => p.type === "hour").value);
  const minute = Number(parts.find((p) => p.type === "minute").value);
  if (weekday === "Sat" || weekday === "Sun") return false;
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}

module.exports = {
  apiKey,
  loginUrl,
  exchangeRequestToken,
  loadInstruments,
  quoteMany,
  isIndex,
  accessCookie,
  readAccessCookie,
  marketOpen,
};
