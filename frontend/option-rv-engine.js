(function (root) {
  const DEFAULTS = {
    rate: 0,
    minFit: 4,
    maxSpreadPct: 12,
    minQty: 1,
    minIv: 0.03,
    maxIv: 3.5,
    cheapZ: -2,
    extremeCheapZ: -3,
    expensiveZ: 2,
    extremeExpensiveZ: 3,
    cheapResidualPct: 2,
    extremeResidualPct: 3.5,
    minHistory: 20,
    minTimeValue: 0.05,
    minTimeValueFrac: 0.0015,
    minTYears: 15 / (365.25 * 24 * 60),
  };

  function num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function mergeConfig(src) {
    return { ...DEFAULTS, ...(src || {}) };
  }

  function normPdf(x) {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  }

  function normCdf(x) {
    const a1 = 0.319381530;
    const a2 = -0.356563782;
    const a3 = 1.781477937;
    const a4 = -1.821255978;
    const a5 = 1.330274429;
    const p = 0.2316419;
    const t = 1 / (1 + p * Math.abs(x));
    const tail = normPdf(x) * (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t;
    return x >= 0 ? 1 - tail : tail;
  }

  function yearFraction(expiry, now = Date.now()) {
    const end = Date.parse(`${String(expiry).slice(0, 10)}T15:30:00+05:30`);
    if (!Number.isFinite(end)) return 0;
    const ms = Math.max(end - now, 15 * 60 * 1000);
    return ms / (365.25 * 24 * 3600 * 1000);
  }

  function discount(rate, T) {
    return Math.exp(-num(rate) * num(T));
  }

  function intrinsic({ F, K, T, isCall, rate }) {
    const df = discount(rate, T);
    const fwd = isCall ? num(F) - num(K) : num(K) - num(F);
    return df * Math.max(fwd, 0);
  }

  function black76({ F, K, T, sigma, isCall, rate = 0 }) {
    const f = num(F);
    const k = num(K);
    const t = num(T);
    const vol = num(sigma);
    if (!(f > 0) || !(k > 0) || !(t > 0) || !(vol > 0)) return 0;
    const df = discount(rate, t);
    const srt = vol * Math.sqrt(t);
    const d1 = (Math.log(f / k) + 0.5 * vol * vol * t) / srt;
    const d2 = d1 - srt;
    if (isCall) return df * (f * normCdf(d1) - k * normCdf(d2));
    return df * (k * normCdf(-d2) - f * normCdf(-d1));
  }

  function black76Vega({ F, K, T, sigma, rate = 0 }) {
    const f = num(F);
    const k = num(K);
    const t = num(T);
    const vol = num(sigma);
    if (!(f > 0) || !(k > 0) || !(t > 0) || !(vol > 0)) return 0;
    const srt = vol * Math.sqrt(t);
    const d1 = (Math.log(f / k) + 0.5 * vol * vol * t) / srt;
    return discount(rate, t) * f * Math.sqrt(t) * normPdf(d1);
  }

  function impliedVol({ price, F, K, T, isCall, rate = 0, minIv = DEFAULTS.minIv, maxIv = DEFAULTS.maxIv }) {
    const px = num(price);
    const t = Math.max(num(T), DEFAULTS.minTYears);
    if (!(px > 0) || !(num(F) > 0) || !(num(K) > 0)) {
      return { iv: null, reason: "missing price" };
    }
    const floor = intrinsic({ F, K, T: t, isCall, rate });
    if (px + 1e-8 < floor) return { iv: null, reason: "below intrinsic" };
    const cap = discount(rate, t) * (isCall ? num(F) : num(K));
    if (px >= cap - 1e-8) return { iv: null, reason: "impossible premium" };

    let sigma = 0.2;
    for (let i = 0; i < 12; i += 1) {
      const model = black76({ F, K, T: t, sigma, isCall, rate });
      const vega = black76Vega({ F, K, T: t, sigma, rate });
      const diff = model - px;
      if (Math.abs(diff) < 1e-6) {
        if (sigma < minIv || sigma > maxIv) return { iv: null, reason: "IV outside range" };
        return { iv: sigma, reason: "" };
      }
      if (!(vega > 1e-12)) break;
      sigma = Math.min(maxIv * 1.5, Math.max(1e-4, sigma - diff / vega));
    }

    let lo = 1e-4;
    let hi = Math.max(maxIv * 1.5, 1);
    let mid = 0.2;
    for (let i = 0; i < 40; i += 1) {
      mid = 0.5 * (lo + hi);
      const model = black76({ F, K, T: t, sigma: mid, isCall, rate });
      if (model > px) hi = mid;
      else lo = mid;
    }
    if (mid < minIv || mid > maxIv) return { iv: null, reason: "IV outside range" };
    const err = Math.abs(black76({ F, K, T: t, sigma: mid, isCall, rate }) - px);
    if (err > Math.max(0.05, px * 0.02)) return { iv: null, reason: "IV did not converge" };
    return { iv: mid, reason: "" };
  }

  function spreadPct(bid, ask) {
    if (!(num(bid) > 0) || !(num(ask) > 0)) return Infinity;
    return ((num(ask) - num(bid)) / ((num(ask) + num(bid)) / 2)) * 100;
  }

  function quoteValid(book, cfg, live) {
    const bid = num(book && book.bid);
    const ask = num(book && book.ask);
    const ltp = num(book && book.ltp);
    if (bid > 0 && ask > 0 && bid > ask) return { ok: false, reason: "crossed market" };
    if (live) {
      if (!(bid > 0)) return { ok: false, reason: "zero bid" };
      if (!(ask > 0)) return { ok: false, reason: "zero ask" };
      const spr = spreadPct(bid, ask);
      if (spr > cfg.maxSpreadPct) return { ok: false, reason: "wide spread" };
      const qty = Math.min(num(book.bid_qty), num(book.ask_qty));
      if (qty < cfg.minQty) return { ok: false, reason: "insufficient liquidity" };
      return { ok: true, reason: "", mid: (bid + ask) / 2, spr };
    }
    if (ltp > 0) return { ok: true, reason: "", mid: ltp, spr: spreadPct(bid, ask) };
    if (bid > 0 && ask > 0) return { ok: true, reason: "", mid: (bid + ask) / 2, spr: spreadPct(bid, ask) };
    return { ok: false, reason: "missing LTP" };
  }

  function timeValueOk(price, F, K, T, isCall, rate, cfg) {
    const tv = num(price) - intrinsic({ F, K, T, isCall, rate });
    const floor = Math.max(cfg.minTimeValue, num(F) * cfg.minTimeValueFrac);
    return tv >= floor;
  }

  function solve3(A, b) {
    const M = A.map((row, i) => row.concat([b[i]]));
    const n = 3;
    for (let i = 0; i < n; i += 1) {
      let piv = i;
      for (let r = i + 1; r < n; r += 1) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
      if (Math.abs(M[piv][i]) < 1e-12) return null;
      if (piv !== i) { const tmp = M[i]; M[i] = M[piv]; M[piv] = tmp; }
      const div = M[i][i];
      for (let c = i; c <= n; c += 1) M[i][c] /= div;
      for (let r = 0; r < n; r += 1) {
        if (r === i) continue;
        const f = M[r][i];
        for (let c = i; c <= n; c += 1) M[r][c] -= f * M[i][c];
      }
    }
    return [M[0][3], M[1][3], M[2][3]];
  }

  function fitSmile(points, F) {
    const f = num(F);
    const clean = (points || []).filter((row) => row && Number(row.iv) > 0 && Number(row.strike) > 0 && f > 0);
    if (clean.length < 1) {
      return { ok: false, kind: "none", predict: () => null, n: 0, r2: 0, used: [] };
    }
    const rows = clean.map((row) => {
      const k = Math.log(num(row.strike) / f);
      const w = Math.max(num(row.weight, 1), 0.05);
      return { ...row, k, w, iv: num(row.iv) };
    });

    function wls(degree) {
      if (degree === 0) {
        let sw = 0;
        let sy = 0;
        for (const row of rows) { sw += row.w; sy += row.w * row.iv; }
        const a = sw ? sy / sw : 0;
        return {
          predict: () => a,
          coeffs: [a, 0, 0],
        };
      }
      if (degree === 1) {
        let s00 = 0, s10 = 0, s11 = 0, sy0 = 0, sy1 = 0;
        for (const row of rows) {
          s00 += row.w;
          s10 += row.w * row.k;
          s11 += row.w * row.k * row.k;
          sy0 += row.w * row.iv;
          sy1 += row.w * row.k * row.iv;
        }
        const det = s00 * s11 - s10 * s10;
        if (Math.abs(det) < 1e-12) return null;
        const a = (sy0 * s11 - s10 * sy1) / det;
        const b = (s00 * sy1 - s10 * sy0) / det;
        return {
          predict: (strike) => a + b * Math.log(num(strike) / f),
          coeffs: [a, b, 0],
        };
      }
      const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      const b = [0, 0, 0];
      for (const row of rows) {
        const x = [1, row.k, row.k * row.k];
        for (let i = 0; i < 3; i += 1) {
          b[i] += row.w * x[i] * row.iv;
          for (let j = 0; j < 3; j += 1) A[i][j] += row.w * x[i] * x[j];
        }
      }
      const coeffs = solve3(A, b);
      if (!coeffs) return null;
      return {
        predict: (strike) => coeffs[0] + coeffs[1] * Math.log(num(strike) / f) + coeffs[2] * Math.pow(Math.log(num(strike) / f), 2),
        coeffs,
      };
    }

    const degree = rows.length >= 6 ? 2 : rows.length >= 3 ? 1 : 0;
    let model = wls(degree) || wls(Math.max(0, degree - 1)) || wls(0);
    if (!model) {
      return { ok: false, kind: "none", predict: () => null, n: rows.length, r2: 0, used: rows };
    }

    const resid = rows.map((row) => row.iv - model.predict(row.strike));
    const med = median(resid.map(Math.abs));
    const mad = median(resid.map((r) => Math.abs(r - median(resid)))) || med;
    const keep = rows.filter((_, i) => mad <= 0 || Math.abs(resid[i]) <= Math.max(0.04, 2.8 * 1.4826 * mad));
    if (keep.length >= 3 && keep.length < rows.length) {
      const prev = rows.slice();
      rows.length = 0;
      rows.push(...keep);
      const refit = wls(keep.length >= 6 ? 2 : 1) || wls(0);
      if (refit) model = refit;
      else {
        rows.length = 0;
        rows.push(...prev);
      }
    }

    let ssRes = 0;
    let ssTot = 0;
    const mean = rows.reduce((s, row) => s + row.iv, 0) / rows.length;
    for (const row of rows) {
      const yhat = model.predict(row.strike);
      ssRes += row.w * (row.iv - yhat) ** 2;
      ssTot += row.w * (row.iv - mean) ** 2;
    }
    const r2 = ssTot > 1e-12 ? Math.max(0, 1 - ssRes / ssTot) : 1;
    const kind = degree === 2 ? "quadratic" : degree === 1 ? "linear" : "flat";
    return {
      ok: rows.length >= 1,
      kind,
      n: rows.length,
      r2,
      coeffs: model.coeffs,
      used: rows,
      predict(strike) {
        const iv = model.predict(strike);
        if (!Number.isFinite(iv) || iv <= 0) return null;
        return iv;
      },
    };
  }

  function median(values) {
    const xs = values.slice().sort((a, b) => a - b);
    if (!xs.length) return 0;
    const mid = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[mid] : 0.5 * (xs[mid - 1] + xs[mid]);
  }

  function stdev(values) {
    const xs = (values || []).map(Number).filter((n) => Number.isFinite(n));
    if (xs.length < 2) return 0;
    const mean = xs.reduce((s, n) => s + n, 0) / xs.length;
    const varSum = xs.reduce((s, n) => s + (n - mean) ** 2, 0) / (xs.length - 1);
    return Math.sqrt(Math.max(varSum, 0));
  }

  function zScore(residual, history, minN) {
    const xs = (history || []).map(Number).filter((n) => Number.isFinite(n));
    if (xs.length < num(minN, DEFAULTS.minHistory)) return null;
    const sd = stdev(xs);
    if (!(sd > 1e-6)) return null;
    return num(residual) / sd;
  }

  function classify({ z, residualPct, cfg, live }) {
    const c = mergeConfig(cfg);
    const res = num(residualPct);
    let bucket = "NORMAL";
    let via = "residual";
    if (z != null && Number.isFinite(z)) {
      via = "z";
      if (z <= c.extremeCheapZ) bucket = "EXTREME_CHEAP";
      else if (z <= c.cheapZ) bucket = "CHEAP";
      else if (z >= c.extremeExpensiveZ) bucket = "EXTREME_EXPENSIVE";
      else if (z >= c.expensiveZ) bucket = "EXPENSIVE";
      else bucket = "NORMAL";
    } else if (res <= -c.extremeResidualPct) bucket = "EXTREME_CHEAP";
    else if (res <= -c.cheapResidualPct) bucket = "CHEAP";
    else if (res >= c.extremeResidualPct) bucket = "EXTREME_EXPENSIVE";
    else if (res >= c.cheapResidualPct) bucket = "EXPENSIVE";

    const labels = {
      EXTREME_CHEAP: "🔵 EXTREMELY CHEAP",
      CHEAP: "🟢 CHEAP",
      NORMAL: "⚪ NORMAL",
      EXPENSIVE: "🟠 EXPENSIVE",
      EXTREME_EXPENSIVE: "🔴 EXTREMELY EXPENSIVE",
    };
    const cheap = bucket === "CHEAP" || bucket === "EXTREME_CHEAP";
    const expensive = bucket === "EXPENSIVE" || bucket === "EXTREME_EXPENSIVE";
    const note = via === "z"
      ? (live ? "relative value vs own IV curve (Z)" : "LTP relative value vs own IV curve (Z)")
      : (z == null
        ? "relative value vs own IV curve (residual; Z needs history)"
        : "relative value vs own IV curve");
    return {
      bucket,
      label: labels[bucket],
      cheap,
      expensive,
      via,
      relativeValue: true,
      live,
      note,
    };
  }

  function liquidityScore({ bid, ask, bidQty, askQty, volume, oi, lot }) {
    const spr = spreadPct(bid, ask);
    const mid = (num(bid) + num(ask)) / 2;
    const sprOk = Number.isFinite(spr) ? spr : 99;
    const qty = Math.min(num(bidQty), num(askQty));
    const lotSize = Math.max(1, num(lot, 1));
    let score = 0;
    if (sprOk <= 0.8) score += 40;
    else if (sprOk <= 2) score += 32;
    else if (sprOk <= 5) score += 20;
    else if (sprOk <= 10) score += 10;
    if (qty >= lotSize * 5) score += 25;
    else if (qty >= lotSize) score += 18;
    else if (qty > 0) score += 8;
    if (num(volume) >= lotSize * 50) score += 20;
    else if (num(volume) >= lotSize * 10) score += 12;
    else if (num(volume) > 0) score += 6;
    if (num(oi) >= lotSize * 100) score += 15;
    else if (num(oi) >= lotSize * 20) score += 8;
    else if (num(oi) > 0) score += 4;
    score = Math.max(0, Math.min(100, score));
    let quality = "LOW";
    if (score >= 70 && sprOk <= 2) quality = "HIGH";
    else if (score >= 40 && sprOk <= 8) quality = "MEDIUM";
    const sprOfPrem = mid > 0 && Number.isFinite(spr) ? spr : null;
    return { score, quality, spreadPct: Number.isFinite(spr) ? spr : null, spreadOfPremium: sprOfPrem };
  }

  function rvScore({ absResidualPct, z, liquidity, r2, live, stale }) {
    const zAbs = z != null ? Math.abs(z) : num(absResidualPct) / 1.5;
    const zPart = Math.min(40, zAbs * 12);
    const liqPart = Math.min(30, num(liquidity && liquidity.score) * 0.3);
    const fitPart = Math.min(15, num(r2) * 15);
    const freshPart = stale ? 0 : (live ? 15 : 6);
    return Math.round(Math.max(0, Math.min(100, zPart + liqPart + fitPart + freshPart)));
  }

  function ivPoints(iv) {
    return num(iv) * 100;
  }

  const api = {
    DEFAULTS,
    mergeConfig,
    normPdf,
    normCdf,
    yearFraction,
    intrinsic,
    black76,
    black76Vega,
    impliedVol,
    spreadPct,
    quoteValid,
    timeValueOk,
    fitSmile,
    stdev,
    zScore,
    classify,
    liquidityScore,
    rvScore,
    ivPoints,
    methodology() {
      return {
        id: "option-relative-value",
        label: "Option relative value: Black-76 IV vs own Call/Put curve. Not arbitrage.",
      };
    },
  };

  root.OptionRv = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
