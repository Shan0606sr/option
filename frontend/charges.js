(function (root) {
  const DEFAULT_RATES = {
    fut: {
      brokeragePct: 0.03,
      brokerageCap: 20,
      sttSellPct: 0.05,
      txnPct: 0.00183,
      stampBuyPct: 0.002,
    },
    opt: {
      brokerage: 20,
      sttSellPct: 0.15,
      sttExercisePct: 0.15,
      txnPct: 0.03553,
      stampBuyPct: 0.003,
    },
    gstPct: 18,
    sebiPerCrore: 10,
    includeExerciseStt: false,
    slippageInr: 0.5,
    slipSpreadFrac: 0.25,
    staleMs: 2500,
    snapMs: 1500,
    maxOptSpreadPct: 8,
    maxFutSpreadPct: 0.2,
    discountFactor: 1,
    lots: 1,
    eq: {
      brokeragePct: 0,
      brokerageCap: 0,
      sttPct: 0.1,
      txnPct: 0.00297,
      stampBuyPct: 0.015,
    },
    mcx: {
      brokeragePct: 0.03,
      brokerageCap: 20,
      cttSellPct: 0.01,
      txnPct: 0.0026,
      stampBuyPct: 0.002,
    },
    silver: {
      gramsPerUnit: 1,
      kgPerFutLot: 1,
      nav: 0,
      minGrossPct: 3,
      targetPct: 5,
      strongPct: 6,
      exceptionalPct: 8,
      maxNavDevPct: 2,
      syncMs: 30000,
      fundingPct: 0,
      marginPct: 6,
      mtmBufferPct: 5,
      slippageInrPerKg: 50,
      slipSpreadFrac: 0.25,
      maxEtfSpreadPct: 1,
      maxFutSpreadPct: 0.5,
    },
  };

  function pct(rate) {
    return Number(rate || 0) / 100;
  }

  function num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function mergeRates(custom) {
    const src = custom && typeof custom === "object" ? custom : {};
    return {
      ...DEFAULT_RATES,
      ...src,
      fut: { ...DEFAULT_RATES.fut, ...(src.fut || {}) },
      opt: { ...DEFAULT_RATES.opt, ...(src.opt || {}) },
      eq: { ...DEFAULT_RATES.eq, ...(src.eq || {}) },
      mcx: { ...DEFAULT_RATES.mcx, ...(src.mcx || {}) },
      silver: { ...DEFAULT_RATES.silver, ...(src.silver || {}) },
    };
  }

  function sebiCharge(turnover, sebiPerCrore) {
    return Math.max(0, num(turnover)) * (num(sebiPerCrore) / 1e7);
  }

  function gstOn(brokerage, sebi, txn, gstPct) {
    return (num(brokerage) + num(sebi) + num(txn)) * pct(gstPct);
  }

  function round2(value) {
    return Math.round((num(value) + Number.EPSILON) * 100) / 100;
  }

  function emptyLeg(name) {
    return {
      name,
      side: "",
      price: 0,
      qty: 0,
      turnover: 0,
      brokerage: 0,
      stt: 0,
      txn: 0,
      sebi: 0,
      stamp: 0,
      gst: 0,
      total: 0,
    };
  }

  function finishLeg(leg) {
    leg.total = round2(leg.brokerage + leg.stt + leg.txn + leg.sebi + leg.stamp + leg.gst);
    return leg;
  }

  function optionLeg({ name, side, premium, qty, intrinsic, rates }) {
    const r = mergeRates(rates);
    const price = num(premium);
    const size = num(qty);
    const turnover = price * size;
    const buy = String(side).toUpperCase() === "BUY";
    const brokerage = num(r.opt.brokerage);
    const sttSell = buy ? 0 : turnover * pct(r.opt.sttSellPct);
    const sttEx = buy && r.includeExerciseStt && num(intrinsic) > 0
      ? num(intrinsic) * size * pct(r.opt.sttExercisePct)
      : 0;
    const txn = turnover * pct(r.opt.txnPct);
    const sebi = sebiCharge(turnover, r.sebiPerCrore);
    const stamp = buy ? turnover * pct(r.opt.stampBuyPct) : 0;
    const gst = gstOn(brokerage, sebi, txn, r.gstPct);
    return finishLeg({
      name,
      side: buy ? "BUY" : "SELL",
      price,
      qty: size,
      turnover: round2(turnover),
      brokerage: round2(brokerage),
      stt: round2(sttSell + sttEx),
      txn: round2(txn),
      sebi: round2(sebi),
      stamp: round2(stamp),
      gst: round2(gst),
      total: 0,
    });
  }

  function futureLeg({ name, side, price, qty, rates }) {
    const r = mergeRates(rates);
    const px = num(price);
    const size = num(qty);
    const turnover = px * size;
    const buy = String(side).toUpperCase() === "BUY";
    const brokerage = Math.min(turnover * pct(r.fut.brokeragePct), num(r.fut.brokerageCap));
    const stt = buy ? 0 : turnover * pct(r.fut.sttSellPct);
    const txn = turnover * pct(r.fut.txnPct);
    const sebi = sebiCharge(turnover, r.sebiPerCrore);
    const stamp = buy ? turnover * pct(r.fut.stampBuyPct) : 0;
    const gst = gstOn(brokerage, sebi, txn, r.gstPct);
    return finishLeg({
      name: name || "FUTURE",
      side: buy ? "BUY" : "SELL",
      price: px,
      qty: size,
      turnover: round2(turnover),
      brokerage: round2(brokerage),
      stt: round2(stt),
      txn: round2(txn),
      sebi: round2(sebi),
      stamp: round2(stamp),
      gst: round2(gst),
      total: 0,
    });
  }

  function sumLegs(legs) {
    const keys = ["brokerage", "stt", "txn", "sebi", "stamp", "gst", "total", "turnover"];
    const out = { legs };
    for (const key of keys) {
      out[key] = round2(legs.reduce((sum, leg) => sum + num(leg[key]), 0));
    }
    return out;
  }

  function syntheticCall(future, put, strike, discountFactor) {
    const df = num(discountFactor, 1);
    return num(put) + (num(future) - num(strike)) * df;
  }

  function syntheticPut(call, future, strike, discountFactor) {
    const df = num(discountFactor, 1);
    return num(call) + (num(strike) - num(future)) * df;
  }

  function methodology(discountFactor) {
    const df = num(discountFactor, 1);
    if (Math.abs(df - 1) < 1e-9) {
      return {
        id: "simple",
        label: "Simple: Future + Put − Strike",
        discountFactor: 1,
      };
    }
    return {
      id: "carry",
      label: `Carry-adjusted: Put + (Future − Strike) × ${df}`,
      discountFactor: df,
    };
  }

  function putMethodology(discountFactor) {
    const df = num(discountFactor, 1);
    if (Math.abs(df - 1) < 1e-9) {
      return {
        id: "simple",
        label: "Simple: Strike + Call − Future",
        discountFactor: 1,
      };
    }
    return {
      id: "carry",
      label: `Carry-adjusted: Call + (Strike − Future) × ${df}`,
      discountFactor: df,
    };
  }

  function threeLegCharges({ strategy, callPx, putPx, futPx, strike, qty, rates, kind }) {
    const r = mergeRates(rates);
    const size = num(qty);
    const putKind = String(kind || "call").toLowerCase() === "put";
    const a = String(strategy).toUpperCase() !== "B";
    const buyCall = putKind ? !a : a;
    const buyPut = putKind ? a : !a;
    const buyFut = putKind ? a : !a;
    const futureRef = num(futPx);
    const callIntrinsic = Math.max(futureRef - num(strike), 0);
    const putIntrinsic = Math.max(num(strike) - futureRef, 0);
    const call = optionLeg({
      name: "CALL",
      side: buyCall ? "BUY" : "SELL",
      premium: callPx,
      qty: size,
      intrinsic: buyCall ? callIntrinsic : 0,
      rates: r,
    });
    const put = optionLeg({
      name: "PUT",
      side: buyPut ? "BUY" : "SELL",
      premium: putPx,
      qty: size,
      intrinsic: buyPut ? putIntrinsic : 0,
      rates: r,
    });
    const fut = futureLeg({
      name: "FUTURE",
      side: buyFut ? "BUY" : "SELL",
      price: futPx,
      qty: size,
      rates: r,
    });
    return sumLegs([call, put, fut]);
  }

  function slippagePerShare({ callBid, callAsk, putBid, putAsk, futBid, futAsk, rates }) {
    const r = mergeRates(rates);
    const callSpread = Math.max(0, num(callAsk) - num(callBid));
    const putSpread = Math.max(0, num(putAsk) - num(putBid));
    const futSpread = Math.max(0, num(futAsk) - num(futBid));
    const fromBook = (callSpread + putSpread + futSpread) * num(r.slipSpreadFrac);
    return num(r.slippageInr) + fromBook;
  }

  function estimateMargins({ strategy, callPx, putPx, futPx, strike, lot, lots, kind }) {
    const qty = num(lot) * num(lots, 1);
    const futNotional = num(futPx) * qty;
    const standaloneFuture = futNotional * 0.12;
    const putKind = String(kind || "call").toLowerCase() === "put";
    const a = String(strategy).toUpperCase() !== "B";
    const shortPut = putKind ? !a : a;
    const standaloneShortPut = shortPut
      ? Math.max(num(putPx) * qty * 3, num(strike) * qty * 0.04)
      : 0;
    const standaloneShortCall = shortPut
      ? 0
      : Math.max(num(callPx) * qty * 3, num(strike) * qty * 0.04);
    const premiumOutlay = shortPut ? num(callPx) * qty : num(putPx) * qty;
    const combined = premiumOutlay + futNotional * 0.05;
    const extraShort = putKind ? standaloneShortCall : 0;
    const benefit = Math.max(0, standaloneFuture + standaloneShortPut + extraShort - combined);
    return {
      standaloneFuture: round2(standaloneFuture),
      standaloneShortPut: round2(standaloneShortPut),
      standaloneShortCall: round2(standaloneShortCall),
      combined: round2(combined),
      benefit: round2(benefit),
      required: round2(combined),
      uncertain: true,
      source: "estimate",
    };
  }

  function boxPayoff(k1, k2) {
    return num(k2) - num(k1);
  }

  function longBoxExpiryPayoff(spot, k1, k2) {
    const s = num(spot);
    const low = num(k1);
    const high = num(k2);
    return Math.max(s - low, 0) - Math.max(s - high, 0) + Math.max(high - s, 0) - Math.max(low - s, 0);
  }

  function boxPayoffSanity(k1, k2) {
    const width = boxPayoff(k1, k2);
    if (!(width > 0)) return { ok: false, width, samples: [] };
    const samples = [num(k1) - Math.max(10, width), (num(k1) + num(k2)) / 2, num(k2) + Math.max(10, width)]
      .map((spot) => ({
        spot,
        payoff: round2(longBoxExpiryPayoff(spot, k1, k2)),
      }));
    const ok = samples.every((row) => Math.abs(row.payoff - width) < 1e-6);
    return { ok, width, samples };
  }

  function longBoxCost(k1CeAsk, k2CeBid, k2PeAsk, k1PeBid) {
    return num(k1CeAsk) - num(k2CeBid) + num(k2PeAsk) - num(k1PeBid);
  }

  function shortBoxCredit(k1CeBid, k2CeAsk, k2PeBid, k1PeAsk) {
    return num(k1CeBid) - num(k2CeAsk) + num(k2PeBid) - num(k1PeAsk);
  }

  function fourLegBoxCharges({ longBox, k1Ce, k2Ce, k2Pe, k1Pe, qty, rates }) {
    const r = mergeRates(rates);
    const size = num(qty);
    const long = Boolean(longBox);
    const legs = [
      optionLeg({ name: "K1 CE", side: long ? "BUY" : "SELL", premium: k1Ce, qty: size, intrinsic: 0, rates: r }),
      optionLeg({ name: "K2 CE", side: long ? "SELL" : "BUY", premium: k2Ce, qty: size, intrinsic: 0, rates: r }),
      optionLeg({ name: "K2 PE", side: long ? "BUY" : "SELL", premium: k2Pe, qty: size, intrinsic: 0, rates: r }),
      optionLeg({ name: "K1 PE", side: long ? "SELL" : "BUY", premium: k1Pe, qty: size, intrinsic: 0, rates: r }),
    ];
    return sumLegs(legs);
  }

  function boxSlippagePerShare({
    k1CeBid, k1CeAsk, k2CeBid, k2CeAsk, k2PeBid, k2PeAsk, k1PeBid, k1PeAsk, rates,
  }) {
    const r = mergeRates(rates);
    const spread = (bid, ask) => Math.max(0, num(ask) - num(bid));
    const fromBook = (
      spread(k1CeBid, k1CeAsk) + spread(k2CeBid, k2CeAsk) + spread(k2PeBid, k2PeAsk) + spread(k1PeBid, k1PeAsk)
    ) * num(r.slipSpreadFrac);
    return num(r.slippageInr) + fromBook;
  }

  function estimateBoxMargins({ longBox, k1, k2, k1Ce, k2Ce, k2Pe, k1Pe, lot, lots }) {
    const qty = num(lot) * num(lots, 1);
    const widthNotional = Math.max(0, boxPayoff(k1, k2)) * qty;
    const long = Boolean(longBox);
    const buyPremium = long ? (num(k1Ce) + num(k2Pe)) * qty : (num(k2Ce) + num(k1Pe)) * qty;
    const combined = long
      ? Math.max(buyPremium * 0.2, widthNotional * 0.04)
      : buyPremium * 0.25 + widthNotional * 0.12;
    return {
      combined: round2(combined),
      required: round2(combined),
      uncertain: true,
      source: "estimate",
    };
  }

  function boxMethodology() {
    return {
      id: "box",
      label: "Box: payoff = K2 − K1. Long pays less than width; short receives more than width.",
    };
  }

  function callSpreadValue(spot, k1, k2) {
    return Math.max(num(spot) - num(k1), 0) - Math.max(num(spot) - num(k2), 0);
  }

  function callVerticalCredit(k1CeBid, k2CeAsk) {
    return num(k1CeBid) - num(k2CeAsk);
  }

  function callVerticalSanity(k1, k2) {
    const width = boxPayoff(k1, k2);
    if (!(width > 0)) return { ok: false, width, samples: [] };
    const spots = [num(k1) - Math.max(10, width), (num(k1) + num(k2)) / 2, num(k2) + Math.max(10, width)];
    const samples = spots.map((spot) => ({
      spot,
      value: round2(callSpreadValue(spot, k1, k2)),
      cap: width,
    }));
    const ok = samples.every((row) => row.value <= width + 1e-9 && row.value >= -1e-9)
      && Math.abs(callSpreadValue(num(k2) + width, k1, k2) - width) < 1e-6
      && Math.abs(callSpreadValue(num(k1) - width, k1, k2)) < 1e-6;
    return { ok, width, samples };
  }

  function twoLegCallVerticalCharges({ k1Ce, k2Ce, qty, rates }) {
    const r = mergeRates(rates);
    const size = num(qty);
    return sumLegs([
      optionLeg({ name: "K1 CE", side: "SELL", premium: k1Ce, qty: size, intrinsic: 0, rates: r }),
      optionLeg({ name: "K2 CE", side: "BUY", premium: k2Ce, qty: size, intrinsic: 0, rates: r }),
    ]);
  }

  function verticalSlippagePerShare({ k1Bid, k1Ask, k2Bid, k2Ask, rates }) {
    const r = mergeRates(rates);
    const spread = (bid, ask) => Math.max(0, num(ask) - num(bid));
    return num(r.slippageInr) + (spread(k1Bid, k1Ask) + spread(k2Bid, k2Ask)) * num(r.slipSpreadFrac);
  }

  function estimateCallVerticalMargins({ k1, k2, k1Ce, k2Ce, lot, lots }) {
    const qty = num(lot) * num(lots, 1);
    const widthNotional = Math.max(0, boxPayoff(k1, k2)) * qty;
    const credit = Math.max(0, (num(k1Ce) - num(k2Ce)) * qty);
    const combined = Math.max(widthNotional - credit, widthNotional * 0.25);
    return {
      combined: round2(combined),
      required: round2(combined),
      uncertain: true,
      source: "estimate",
    };
  }

  function callVerticalMethodology() {
    return {
      id: "vert-ce",
      label: "Call vertical: sell K1 CE bid, buy K2 CE ask. Flag credit > K2 − K1.",
    };
  }

  function putSpreadValue(spot, k1, k2) {
    return Math.max(num(k2) - num(spot), 0) - Math.max(num(k1) - num(spot), 0);
  }

  function putVerticalCredit(k2PeBid, k1PeAsk) {
    return num(k2PeBid) - num(k1PeAsk);
  }

  function putVerticalSanity(k1, k2) {
    const width = boxPayoff(k1, k2);
    if (!(width > 0)) return { ok: false, width, samples: [] };
    const spots = [num(k1) - Math.max(10, width), (num(k1) + num(k2)) / 2, num(k2) + Math.max(10, width)];
    const samples = spots.map((spot) => ({
      spot,
      value: round2(putSpreadValue(spot, k1, k2)),
      cap: width,
    }));
    const ok = samples.every((row) => row.value <= width + 1e-9 && row.value >= -1e-9)
      && Math.abs(putSpreadValue(num(k1) - width, k1, k2) - width) < 1e-6
      && Math.abs(putSpreadValue(num(k2) + width, k1, k2)) < 1e-6;
    return { ok, width, samples };
  }

  function twoLegPutVerticalCharges({ k1Pe, k2Pe, qty, rates }) {
    const r = mergeRates(rates);
    const size = num(qty);
    return sumLegs([
      optionLeg({ name: "K1 PE", side: "BUY", premium: k1Pe, qty: size, intrinsic: 0, rates: r }),
      optionLeg({ name: "K2 PE", side: "SELL", premium: k2Pe, qty: size, intrinsic: 0, rates: r }),
    ]);
  }

  function estimatePutVerticalMargins({ k1, k2, k1Pe, k2Pe, lot, lots }) {
    const qty = num(lot) * num(lots, 1);
    const widthNotional = Math.max(0, boxPayoff(k1, k2)) * qty;
    const credit = Math.max(0, (num(k2Pe) - num(k1Pe)) * qty);
    const combined = Math.max(widthNotional - credit, widthNotional * 0.25);
    return {
      combined: round2(combined),
      required: round2(combined),
      uncertain: true,
      source: "estimate",
    };
  }

  function putVerticalMethodology() {
    return {
      id: "vert-pe",
      label: "Put vertical: buy K1 PE ask, sell K2 PE bid. Flag credit > K2 − K1.",
    };
  }

  function butterflyWidth(k1, k2, k3) {
    const d1 = num(k2) - num(k1);
    const d2 = num(k3) - num(k2);
    if (!(d1 > 0) || Math.abs(d1 - d2) > 1e-6) return 0;
    return d1;
  }

  function butterflyGrossCredit(wingAskLow, bodyBid, wingAskHigh) {
    return 2 * num(bodyBid) - num(wingAskLow) - num(wingAskHigh);
  }

  function callButterflyPayoff(spot, k1, k2, k3) {
    return Math.max(num(spot) - num(k1), 0) - 2 * Math.max(num(spot) - num(k2), 0) + Math.max(num(spot) - num(k3), 0);
  }

  function putButterflyPayoff(spot, k1, k2, k3) {
    return Math.max(num(k1) - num(spot), 0) - 2 * Math.max(num(k2) - num(spot), 0) + Math.max(num(k3) - num(spot), 0);
  }

  function butterflyPayoffSanity(k1, k2, k3) {
    const width = butterflyWidth(k1, k2, k3);
    if (!(width > 0)) return { ok: false, width, samples: [] };
    const spots = [num(k1) - width, num(k1), num(k2), num(k3), num(k3) + width, (num(k1) + num(k2)) / 2];
    const samples = spots.map((spot) => ({
      spot,
      call: round2(callButterflyPayoff(spot, k1, k2, k3)),
      put: round2(putButterflyPayoff(spot, k1, k2, k3)),
    }));
    const ok = samples.every((row) => row.call >= -1e-9 && row.call <= width + 1e-9
      && row.put >= -1e-9 && row.put <= width + 1e-9)
      && Math.abs(callButterflyPayoff(k2, k1, k2, k3) - width) < 1e-6
      && Math.abs(putButterflyPayoff(k2, k1, k2, k3) - width) < 1e-6
      && Math.abs(callButterflyPayoff(k1 - width, k1, k2, k3)) < 1e-6
      && Math.abs(putButterflyPayoff(k3 + width, k1, k2, k3)) < 1e-6;
    return { ok, width, samples };
  }

  function butterflyCharges({ isCall, k1Px, k2Px, k3Px, qty, rates }) {
    const r = mergeRates(rates);
    const size = num(qty);
    const kind = isCall ? "CE" : "PE";
    return sumLegs([
      optionLeg({ name: `K1 ${kind}`, side: "BUY", premium: k1Px, qty: size, intrinsic: 0, rates: r }),
      optionLeg({ name: `K2 ${kind}`, side: "SELL", premium: k2Px, qty: size * 2, intrinsic: 0, rates: r }),
      optionLeg({ name: `K3 ${kind}`, side: "BUY", premium: k3Px, qty: size, intrinsic: 0, rates: r }),
    ]);
  }

  function butterflySlippagePerShare({ k1Bid, k1Ask, k2Bid, k2Ask, k3Bid, k3Ask, rates }) {
    const r = mergeRates(rates);
    const spread = (bid, ask) => Math.max(0, num(ask) - num(bid));
    return num(r.slippageInr) + (spread(k1Bid, k1Ask) + 2 * spread(k2Bid, k2Ask) + spread(k3Bid, k3Ask)) * num(r.slipSpreadFrac);
  }

  function estimateButterflyMargins({ k1, k2, k3, credit, lot, lots }) {
    const qty = num(lot) * num(lots, 1);
    const width = butterflyWidth(k1, k2, k3);
    const creditInr = num(credit) * qty;
    const widthNotional = Math.max(0, width) * qty;
    const debit = Math.max(0, -creditInr);
    const combined = debit + Math.max(widthNotional * 0.1, widthNotional * 0.25 - Math.max(0, creditInr));
    return {
      combined: round2(combined),
      required: round2(combined),
      uncertain: true,
      source: "estimate",
    };
  }

  function butterflyMethodology() {
    return {
      id: "butterfly",
      label: "Butterfly: buy K1 ask, sell 2× K2 bid, buy K3 ask. Equidistant strikes. Confirm only net credit after costs.",
    };
  }

  function unitsPerKg(gramsPerUnit) {
    const grams = num(gramsPerUnit);
    return grams > 0 ? 1000 / grams : 0;
  }

  function etfPerKg(pricePerUnit, gramsPerUnit) {
    return num(pricePerUnit) * unitsPerKg(gramsPerUnit);
  }

  function silverHedge({ gramsPerUnit, futLotSize, kgPerFutLot, lots }) {
    const lot = Math.max(1, num(futLotSize, 1));
    const kgEach = num(kgPerFutLot, 1);
    const n = Math.max(1, num(lots, 1));
    const kg = lot * kgEach * n;
    return {
      kg,
      etfUnits: unitsPerKg(gramsPerUnit) * kg,
      futQty: lot * n,
    };
  }

  function annualizeSimple(grossPct, days) {
    if (!(num(days) > 0)) return 0;
    return num(grossPct) * 365 / num(days);
  }

  function annualizeCompound(grossPct, days) {
    if (!(num(days) > 0)) return 0;
    return (Math.pow(1 + num(grossPct) / 100, 365 / num(days)) - 1) * 100;
  }

  function navPremiumPct(price, nav) {
    if (!(num(nav) > 0)) return null;
    return (num(price) - num(nav)) / num(nav) * 100;
  }

  function equityDeliveryLeg({ name, side, price, qty, rates }) {
    const r = mergeRates(rates);
    const px = num(price);
    const size = num(qty);
    const turnover = px * size;
    const buy = String(side).toUpperCase() === "BUY";
    const rawBrok = turnover * pct(r.eq.brokeragePct);
    const brokerage = num(r.eq.brokerageCap) > 0 ? Math.min(rawBrok, num(r.eq.brokerageCap)) : rawBrok;
    const stt = turnover * pct(r.eq.sttPct);
    const txn = turnover * pct(r.eq.txnPct);
    const sebi = sebiCharge(turnover, r.sebiPerCrore);
    const stamp = buy ? turnover * pct(r.eq.stampBuyPct) : 0;
    const gst = gstOn(brokerage, sebi, txn, r.gstPct);
    return finishLeg({
      name: name || "ETF",
      side: buy ? "BUY" : "SELL",
      price: px,
      qty: size,
      turnover: round2(turnover),
      brokerage: round2(brokerage),
      stt: round2(stt),
      txn: round2(txn),
      sebi: round2(sebi),
      stamp: round2(stamp),
      gst: round2(gst),
      total: 0,
    });
  }

  function commodityFutureLeg({ name, side, price, qty, rates }) {
    const r = mergeRates(rates);
    const px = num(price);
    const size = num(qty);
    const turnover = px * size;
    const buy = String(side).toUpperCase() === "BUY";
    const brokerage = Math.min(turnover * pct(r.mcx.brokeragePct), num(r.mcx.brokerageCap));
    const ctt = buy ? 0 : turnover * pct(r.mcx.cttSellPct);
    const txn = turnover * pct(r.mcx.txnPct);
    const sebi = sebiCharge(turnover, r.sebiPerCrore);
    const stamp = buy ? turnover * pct(r.mcx.stampBuyPct) : 0;
    const gst = gstOn(brokerage, sebi, txn, r.gstPct);
    return finishLeg({
      name: name || "MCX FUT",
      side: buy ? "BUY" : "SELL",
      price: px,
      qty: size,
      turnover: round2(turnover),
      brokerage: round2(brokerage),
      stt: round2(ctt),
      txn: round2(txn),
      sebi: round2(sebi),
      stamp: round2(stamp),
      gst: round2(gst),
      total: 0,
    });
  }

  function silverSpreadCharges({ buyEtf, etfPx, futPx, etfQty, futQty, rates }) {
    return sumLegs([
      equityDeliveryLeg({ name: "ETF", side: buyEtf ? "BUY" : "SELL", premium: etfPx, price: etfPx, qty: etfQty, rates }),
      commodityFutureLeg({ name: "MCX FUT", side: buyEtf ? "SELL" : "BUY", price: futPx, qty: futQty, rates }),
    ]);
  }

  function silverSlippagePerKg({ etfBid, etfAsk, futBid, futAsk, gramsPerUnit, rates }) {
    const r = mergeRates(rates);
    const units = unitsPerKg(gramsPerUnit);
    const etfSpreadKg = Math.max(0, num(etfAsk) - num(etfBid)) * units;
    const futSpreadKg = Math.max(0, num(futAsk) - num(futBid));
    return num(r.silver.slippageInrPerKg) + (etfSpreadKg + futSpreadKg) * num(r.silver.slipSpreadFrac);
  }

  function estimateSilverCapital({ etfPx, futPx, etfQty, futQty, kg, rates }) {
    const r = mergeRates(rates);
    const etfCapital = Math.max(0, num(etfPx) * num(etfQty));
    const futNotional = Math.max(0, num(futPx) * num(futQty));
    const futMargin = futNotional * pct(r.silver.marginPct);
    const mtmBuffer = futNotional * pct(r.silver.mtmBufferPct);
    const required = etfCapital + futMargin + mtmBuffer;
    return {
      etfCapital: round2(etfCapital),
      futNotional: round2(futNotional),
      futMargin: round2(futMargin),
      mtmBuffer: round2(mtmBuffer),
      required: round2(required),
      kg: num(kg),
      uncertain: true,
      source: "estimate",
    };
  }

  function silverFundingCost({ capital, days, rates }) {
    const r = mergeRates(rates);
    if (!(num(days) > 0) || !(num(capital) > 0)) return 0;
    return num(capital) * pct(r.silver.fundingPct) * (num(days) / 365);
  }

  function silverMethodology() {
    return {
      id: "silver-etf-mcx",
      label: "Silver ETF vs MCX: compare ₹/kg. V1 BUY ETF / SELL future is a basis trade, not a locked payoff.",
    };
  }

  const api = {
    DEFAULT_RATES,
    mergeRates,
    optionLeg,
    futureLeg,
    threeLegCharges,
    syntheticCall,
    syntheticPut,
    methodology,
    putMethodology,
    slippagePerShare,
    estimateMargins,
    boxPayoff,
    longBoxExpiryPayoff,
    boxPayoffSanity,
    longBoxCost,
    shortBoxCredit,
    fourLegBoxCharges,
    boxSlippagePerShare,
    estimateBoxMargins,
    boxMethodology,
    callSpreadValue,
    callVerticalCredit,
    callVerticalSanity,
    twoLegCallVerticalCharges,
    verticalSlippagePerShare,
    estimateCallVerticalMargins,
    callVerticalMethodology,
    putSpreadValue,
    putVerticalCredit,
    putVerticalSanity,
    twoLegPutVerticalCharges,
    estimatePutVerticalMargins,
    putVerticalMethodology,
    butterflyWidth,
    butterflyGrossCredit,
    callButterflyPayoff,
    putButterflyPayoff,
    butterflyPayoffSanity,
    butterflyCharges,
    butterflySlippagePerShare,
    estimateButterflyMargins,
    butterflyMethodology,
    unitsPerKg,
    etfPerKg,
    silverHedge,
    annualizeSimple,
    annualizeCompound,
    navPremiumPct,
    equityDeliveryLeg,
    commodityFutureLeg,
    silverSpreadCharges,
    silverSlippagePerKg,
    estimateSilverCapital,
    silverFundingCost,
    silverMethodology,
    sebiCharge,
    round2,
  };

  root.CallArbCharges = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
