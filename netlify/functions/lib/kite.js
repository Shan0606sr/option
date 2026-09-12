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
    const route = path.split("?")[0];
    throw new Error(`Kite ${route} failed: ${res.status} ${text.slice(0, 160)}`);
  }
  return res;
}

function splitCsvLine(line) {
  const cols = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      cols.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

function parseCsv(text) {
  const lines = String(text).replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((header) => header.replace(/^\uFEFF/, "").trim());
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row = {};
    headers.forEach((header, i) => {
      row[header] = (cols[i] || "").trim();
    });
    return row;
  });
}

function rowToken(row) {
  return String(row.instrument_token || row["instrument_token"] || "").trim();
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
  const close = (q.ohlc || {}).close || 0;
  const last = Number(q.last_price || close || 0);
  return {
    last_price: last,
    ltp: last,
    volume: q.volume || 0,
    oi: q.oi || 0,
    bid: buy.price || 0,
    bid_qty: buy.quantity || 0,
    ask: sell.price || 0,
    ask_qty: sell.quantity || 0,
    instrument_token: q.instrument_token,
  };
}

function indexQuote(out, key, q) {
  const parsed = parseQuote(q);
  const aliases = new Set([String(key)]);
  if (key && String(key).includes(":")) {
    const [ex, sym] = String(key).split(":");
    aliases.add(`${ex.toUpperCase()}:${sym}`);
    aliases.add(sym);
  }
  if (q.instrument_token) aliases.add(String(q.instrument_token));
  for (const alias of aliases) {
    if (alias) out[alias] = parsed;
  }
}

function lookupQuote(books, ...keys) {
  for (const key of keys) {
    if (key == null || key === "") continue;
    if (books[key]) return books[key];
    if (books[String(key)]) return books[String(key)];
    const asStr = String(key);
    if (asStr.includes(":")) {
      const sym = asStr.split(":")[1];
      if (books[sym]) return books[sym];
      const upper = `${asStr.split(":")[0].toUpperCase()}:${sym}`;
      if (books[upper]) return books[upper];
    }
  }
  return null;
}

async function yahooLast(symbolNs) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbolNs)}?interval=1d&range=10d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 OptionParity/1.0" },
  });
  if (!res.ok) throw new Error(`Yahoo ${symbolNs} failed: ${res.status}`);
  const json = await res.json();
  const result = ((json.chart || {}).result || [])[0] || {};
  const meta = result.meta || {};
  const closes = ((((result.indicators || {}).quote || [])[0] || {}).close || []).filter((n) => n != null);
  return Number(meta.regularMarketPrice || meta.previousClose || closes[closes.length - 1] || 0);
}

function yahooFutSymbol(name, expiry) {
  if (!name || !expiry || expiry.length < 7) return "";
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const year = expiry.slice(2, 4);
  const month = months[Number(expiry.slice(5, 7)) - 1];
  if (!month) return "";
  return `${name}${year}${month}FUT.NS`;
}

async function quoteMany(accessToken, keys) {
  const out = {};
  let error = "";
  const unique = [...new Set(keys.filter((key) => key && String(key).includes(":")))];
  const chunk = 40;
  for (let i = 0; i < unique.length; i += chunk) {
    const slice = unique.slice(i, i + chunk);
    const qs = slice.map((key) => `i=${key}`).join("&");
    try {
      const res = await kiteGet(`/quote?${qs}`, accessToken);
      const json = await res.json();
      const data = json.data || {};
      for (const [key, q] of Object.entries(data)) {
        indexQuote(out, key, q);
      }
    } catch (err) {
      error = err.message;
      break;
    }
  }
  return { books: out, error };
}

function istYmd(daysBack = 0) {
  const when = new Date(Date.now() - daysBack * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(when);
}

async function historicalClose(accessToken, token) {
  const path = `/instruments/historical/${token}/day?from=${istYmd(21)}&to=${istYmd(0)}`;
  const res = await kiteGet(path, accessToken);
  const json = await res.json();
  const candles = (json.data && json.data.candles) || [];
  if (!candles.length) return 0;
  return Number(candles[candles.length - 1][4]) || 0;
}

const closeCache = { day: "", closes: {} };

async function historicalCloses(accessToken, tokens) {
  const day = istYmd(0);
  if (closeCache.day !== day) {
    closeCache.day = day;
    closeCache.closes = {};
  }
  const closes = {};
  let error = "";
  const unique = [...new Set(tokens.filter(Boolean).map(String))];
  const missing = unique.filter((token) => {
    if (closeCache.closes[token]) {
      closes[token] = closeCache.closes[token];
      return false;
    }
    return true;
  });
  const chunk = 3;
  for (let i = 0; i < missing.length; i += chunk) {
    const slice = missing.slice(i, i + chunk);
    const results = await Promise.all(slice.map(async (token) => {
      try {
        return [token, await historicalClose(accessToken, token)];
      } catch (err) {
        error = err.message;
        return [token, 0];
      }
    }));
    for (const [token, close] of results) {
      if (close) {
        closes[token] = close;
        closeCache.closes[token] = close;
      }
    }
    if (error && Object.keys(closes).length === 0) break;
  }
  return { closes, error };
}

async function historicalDayCloses(accessToken, token) {
  const path = `/instruments/historical/${token}/day?from=${istYmd(21)}&to=${istYmd(0)}`;
  const res = await kiteGet(path, accessToken);
  const json = await res.json();
  const candles = (json.data && json.data.candles) || [];
  return candles.map((candle) => Number(candle[4]) || 0).filter((n) => n > 0);
}

async function fetchNifty(accessToken) {
  const NIFTY_TOKEN = 256265;
  let live = 0;
  let previousClose = 0;
  let source = "";
  let error = "";

  try {
    const res = await kiteGet("/quote?i=NSE:NIFTY%2050", accessToken);
    const json = await res.json();
    const data = json.data || {};
    const quote = data["NSE:NIFTY 50"] || data["NSE:NIFTY50"] || Object.values(data)[0] || {};
    live = Number(quote.last_price || 0);
    previousClose = Number((quote.ohlc || {}).close || 0);
    source = "quote";
  } catch (err) {
    error = err.message;
  }

  if (!live || !previousClose) {
    try {
      const closes = await historicalDayCloses(accessToken, NIFTY_TOKEN);
      if (closes.length) {
        if (!live) live = closes[closes.length - 1];
        if (!previousClose) previousClose = closes.length > 1 ? closes[closes.length - 2] : closes[closes.length - 1];
        source = source ? `${source}+historical` : "historical";
        if (closes.length) error = "";
      }
    } catch (err) {
      if (!live) error = err.message;
    }
  }

  const change = live && previousClose ? live - previousClose : 0;
  return {
    symbol: "NIFTY 50",
    live,
    previous_close: previousClose,
    change,
    change_pct: previousClose ? (change / previousClose) * 100 : 0,
    source,
    error,
  };
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

function clearAccessCookie() {
  return [
    "kite_access=",
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
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
  fetchNifty,
  historicalCloses,
  yahooLast,
  yahooFutSymbol,
  rowToken,
  lookupQuote,
  isIndex,
  accessCookie,
  clearAccessCookie,
  readAccessCookie,
  marketOpen,
};
