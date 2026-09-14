#!/usr/bin/env node
/**
 * Local Option Parity: frontend + Netlify function APIs on http://127.0.0.1:8000/
 *
 * Uses the Kite redirect host already configured in the Kite app
 * (http://127.0.0.1:8000/). Stop backend/local_bridge.py first — that process
 * occupies the same port.
 *
 *   node backend/local_web.js
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const ROOT = path.resolve(__dirname, "..");
const FRONTEND = path.join(ROOT, "frontend");
const FUNCTIONS = path.join(ROOT, "netlify", "functions");
const PORT = Number(process.env.LOCAL_WEB_PORT || 8000);
const HOST = "127.0.0.1";

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith("#")) continue;
    const eq = text.indexOf("=");
    if (eq < 0) continue;
    const key = text.slice(0, eq).trim();
    let value = text.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv(path.join(ROOT, ".env"));
process.env.LOCAL_WEB = "1";
process.env.URL = process.env.URL || `http://${HOST}:${PORT}`;

const API = {
  "/api/login": "login",
  "/api/callback": "callback",
  "/api/session": "session",
  "/api/logout": "logout",
  "/api/status": "status",
  "/api/scan": "scan",
  "/api/prices": "prices",
  "/api/nifty": "nifty",
  "/api/plan1": "plan1",
  "/api/quotes": "quotes",
  "/api/synth": "synth",
  "/api/ticker": "ticker",
  "/api/call-arb": "call-arb",
  "/api/put-arb": "put-arb",
  "/api/box-arb": "box-arb",
  "/api/vert-ce": "vert-ce",
  "/api/vert-pe": "vert-pe",
  "/api/silver-arb": "silver-arb",
  "/api/option-rv": "option-rv",
  "/api/butterfly-arb": "butterfly-arb",
  "/api/margins": "margins",
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res, result) {
  const headers = { ...(result.headers || {}) };
  if (!headers["Cache-Control"]) headers["Cache-Control"] = "no-store";
  res.writeHead(result.statusCode || 200, headers);
  res.end(result.body == null ? "" : result.body);
}

function loadHandler(name) {
  const file = path.join(FUNCTIONS, `${name}.js`);
  const resolved = require.resolve(file);
  delete require.cache[resolved];
  const mod = require(file);
  if (!mod || typeof mod.handler !== "function") {
    throw new Error(`Function ${name} has no handler`);
  }
  return mod.handler;
}

async function handleApi(req, res, url) {
  const name = API[url.pathname];
  if (!name) {
    send(res, {
      statusCode: 404,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Unknown API route" }),
    });
    return;
  }
  const handler = loadHandler(name);
  const headers = { ...req.headers };
  headers.cookie = headers.cookie || headers.Cookie || "";
  headers.Cookie = headers.cookie;
  const event = {
    httpMethod: req.method,
    headers,
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
    body: ["POST", "PUT", "PATCH"].includes(req.method) ? await readBody(req) : "",
    path: url.pathname,
  };
  const result = await handler(event);
  send(res, result || { statusCode: 204, body: "" });
}

function handleStatic(req, res, url) {
  const rel = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const full = path.normalize(path.join(FRONTEND, rel));
  if (!full.startsWith(FRONTEND)) {
    send(res, { statusCode: 403, body: "Forbidden" });
    return;
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    send(res, { statusCode: 404, body: "Not found" });
    return;
  }
  const type = MIME[path.extname(full)] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
  fs.createReadStream(full).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (url.searchParams.get("request_token") && !url.pathname.startsWith("/api/")) {
      url.pathname = "/api/callback";
      await handleApi(req, res, url);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    handleStatic(req, res, url);
  } catch (error) {
    send(res, {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: error.message }),
    });
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use.`);
    console.error("Stop backend/local_bridge.py (or whatever is bound to 8000), then run: node backend/local_web.js");
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, HOST, () => {
  console.log(`Local Option Parity at http://${HOST}:${PORT}/`);
  console.log("Connect Zerodha on this page. After login Kite returns here with request_token.");
  console.log("Synthetic CE tab is ready. No orders are sent.");
});
