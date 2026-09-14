(function (root) {
  const DEFAULTS = {
    rate: 0.065,
    divYield: 0,
    deltaWarn: 0.15,
    minWatchMis: 5,
    minTradeEdge: 1,
    aPlusMis: 15,
    minHistory: 20,
    minLots: 1,
  };

  function num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function mergeConfig(src) {
    return { ...DEFAULTS, ...(src || {}) };
  }

  function expiryPairs(expiries, mode) {
    const xs = [...new Set((expiries || []).map((row) => String(row || "").slice(0, 10)).filter(Boolean))].sort();
    if (xs.length < 2) return [];
    if (mode === "next-far") {
      if (xs.length >= 3) return [{ near: xs[1], far: xs[2], kind: "next-far" }];
      return [{ near: xs[0], far: xs[1], kind: "near-next" }];
    }
    if (mode === "adjacent") {
      const out = [];
      for (let i = 0; i < xs.length - 1; i += 1) {
        out.push({ near: xs[i], far: xs[i + 1], kind: i === 0 ? "near-next" : "adjacent" });
      }
      return out;
    }
    return [{ near: xs[0], far: xs[1], kind: "near-next" }];
  }

  function syntheticFuture(strike, callPx, putPx, rate, T) {
    const carry = Math.exp(num(rate) * Math.max(num(T), 0));
    return num(strike) + carry * (num(callPx) - num(putPx));
  }

  function fairForward(spot, rate, divYield, T) {
    return num(spot) * Math.exp((num(rate) - num(divYield)) * Math.max(num(T), 0));
  }

  function fairSpread(spot, rate, divYield, tNear, tFar) {
    return fairForward(spot, rate, divYield, tFar) - fairForward(spot, rate, divYield, tNear);
  }

  function currentSpread(farSynth, nearSynth) {
    return num(farSynth) - num(nearSynth);
  }

  function mispricing(current, fair) {
    return num(current) - num(fair);
  }

  function mispricingPct(current, fair) {
    const f = num(fair);
    if (Math.abs(f) < 1e-9) return Math.abs(num(current)) > 1e-9 ? 100 : 0;
    return (Math.abs(num(current) - f) / Math.abs(f)) * 100;
  }

  function executableSynthetics({
    strike, rate, tNear, tFar,
    nearCeAsk, nearPeBid, nearCeBid, nearPeAsk,
    farCeBid, farPeAsk, farCeAsk, farPeBid,
  }) {
    const k = num(strike);
    const buyNear = syntheticFuture(k, nearCeAsk, nearPeBid, rate, tNear);
    const sellFar = syntheticFuture(k, farCeBid, farPeAsk, rate, tFar);
    const sellNear = syntheticFuture(k, nearCeBid, nearPeAsk, rate, tNear);
    const buyFar = syntheticFuture(k, farCeAsk, farPeBid, rate, tFar);
    return {
      buyNear,
      sellFar,
      sellNear,
      buyFar,
      spreadA: currentSpread(sellFar, buyNear),
      spreadB: currentSpread(buyFar, sellNear),
    };
  }

  function pickDirection({ spreadA, spreadB, fair, costA, costB }) {
    const edgeA = num(spreadA) - num(fair) - num(costA);
    const edgeB = num(fair) - num(spreadB) - num(costB);
    if (edgeB > edgeA) {
      return {
        id: "B",
        label: "SELL near synth / BUY far synth",
        currentSpread: num(spreadB),
        gross: num(fair) - num(spreadB),
        net: edgeB,
        buyNear: false,
      };
    }
    return {
      id: "A",
      label: "BUY near synth / SELL far synth",
      currentSpread: num(spreadA),
      gross: num(spreadA) - num(fair),
      net: edgeA,
      buyNear: true,
    };
  }

  function median(values) {
    const xs = (values || []).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    if (!xs.length) return null;
    const mid = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[mid] : 0.5 * (xs[mid - 1] + xs[mid]);
  }

  function percentileRank(value, history) {
    const xs = (history || []).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    if (xs.length < 8) return null;
    let below = 0;
    for (const x of xs) if (x <= num(value)) below += 1;
    return (100 * below) / xs.length;
  }

  function classifyCalendar({
    absMis,
    netEdge,
    netDelta,
    live,
    executable,
    qLots,
    percentile,
    cfg,
  }) {
    const c = mergeConfig(cfg);
    const deltaOk = netDelta == null ? false : Math.abs(num(netDelta)) <= num(c.deltaWarn);
    const edgeOk = num(netEdge) > 0;
    const lotsOk = num(qLots) >= num(c.minLots);
    const extreme = percentile != null && (percentile >= 95 || percentile <= 5);
    const large = num(absMis) >= num(c.aPlusMis) || extreme;
    const interesting = num(absMis) >= num(c.minWatchMis) || extreme;

    if (live && executable && edgeOk && deltaOk && lotsOk && large && num(netEdge) >= num(c.minTradeEdge)) {
      return { grade: "A+", label: "🟢 A+", note: "Large calendar dislocation, positive net edge, low net delta, executable." };
    }
    if (live && executable && edgeOk && deltaOk && lotsOk && interesting && num(netEdge) >= num(c.minTradeEdge)) {
      return { grade: "A", label: "🟢 A", note: "Positive net edge after costs with low net delta. Manual verification still required." };
    }
    if (interesting) {
      return {
        grade: "B",
        label: "🟡 B",
        note: live && executable
          ? (deltaOk ? "Mispricing exists but net edge is thin after costs." : "Mispricing exists but net delta is not near zero.")
          : "Interesting mispricing but not executable / LTP only.",
      };
    }
    return { grade: "IGNORE", label: "⚪ Ignore", note: "Edge disappears after costs or mispricing is too small." };
  }

  function actionForGrade(grade) {
    if (grade === "A+") return { action: "HIGH-CONFIDENCE", note: "Scanner conditions passed. Not a guaranteed payoff." };
    if (grade === "A") return { action: "TRADE CANDIDATE", note: "Net edge sufficient; verify liquidity, corporate actions and carry assumptions." };
    if (grade === "B") return { action: "WATCH", note: "Interesting but not enough executable edge." };
    return { action: "WAIT", note: "Mispricing insufficient." };
  }

  function methodology() {
    return {
      id: "calendar-mispricing",
      label: "Synthetic calendar: compare executable near vs far CE−PE futures with a carry fair spread. Convergence candidate, not structural arbitrage.",
    };
  }

  const api = {
    DEFAULTS,
    mergeConfig,
    expiryPairs,
    syntheticFuture,
    fairForward,
    fairSpread,
    currentSpread,
    mispricing,
    mispricingPct,
    executableSynthetics,
    pickDirection,
    median,
    percentileRank,
    classifyCalendar,
    actionForGrade,
    methodology,
  };

  root.CalendarEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
