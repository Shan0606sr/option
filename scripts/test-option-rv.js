const rv = require("../frontend/option-rv-engine.js");

function assertClose(actual, expected, label, tol = 0.02) {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

const T = 1;
const F = 100;
const K = 100;
const sigma = 0.2;
const call = rv.black76({ F, K, T, sigma, isCall: true, rate: 0 });
const put = rv.black76({ F, K, T, sigma, isCall: false, rate: 0 });
assertClose(call, 7.96557, "ATM Black-76 call", 0.02);
assertClose(put, call, "r=0 ATM put-call parity", 0.0001);

const ivCall = rv.impliedVol({ price: call, F, K, T, isCall: true, rate: 0 });
assertClose(ivCall.iv, 0.2, "IV round-trip from Black-76 call", 0.002);

const ivPut = rv.impliedVol({ price: put, F, K, T, isCall: false, rate: 0 });
assertClose(ivPut.iv, 0.2, "IV round-trip from Black-76 put", 0.002);

const cheap = rv.impliedVol({ price: rv.black76({ F, K, T, sigma: 0.15, isCall: true }), F, K, T, isCall: true });
assertClose((cheap.iv - 0.2) * 100, -5, "cheap call residual vs 20% curve", 0.05);

const fair = rv.black76({ F, K, T, sigma: 0.2, isCall: true });
const mkt = rv.black76({ F, K, T, sigma: 0.16, isCall: true });
assertClose(fair - mkt, 50, "₹ mispricing identity from spec-style IV gap is positive", 100);
if (!(fair > mkt)) throw new Error("lower IV must produce a cheaper option");

const smile = rv.fitSmile([
  { strike: 90, iv: 0.22, weight: 1 },
  { strike: 95, iv: 0.205, weight: 1 },
  { strike: 100, iv: 0.20, weight: 2 },
  { strike: 105, iv: 0.205, weight: 1 },
  { strike: 110, iv: 0.22, weight: 1 },
], 100);
if (!smile.ok) throw new Error("smile fit failed");
assertClose(smile.predict(100), 0.20, "ATM expected IV", 0.015);
const expected110 = smile.predict(110);
if (!(expected110 > 0.20)) throw new Error("wings should be above ATM on this smile");

if (rv.zScore(-5, [1, 2, 0, -1], 20) != null) {
  throw new Error("must not manufacture a Z-score from insufficient history");
}
const hist = Array.from({ length: 30 }, () => 0);
hist.push(-0.1);
const z = rv.zScore(-4.5, hist.concat([-4.4, -4.6, -4.5]), 20);
if (z == null) throw new Error("Z-score should exist once history is sufficient and SD > 0");

const clsCheap = rv.classify({ residualPct: -5, z: null, cfg: rv.DEFAULTS, live: true });
if (!clsCheap.cheap || clsCheap.via !== "residual") throw new Error("V1 cheap signal must use residual when Z is absent");
if (!clsCheap.relativeValue) throw new Error("must be labelled relative value, not arbitrage");

const clsZ = rv.classify({ residualPct: -0.2, z: -3.2, cfg: rv.DEFAULTS, live: true });
if (clsZ.bucket !== "EXTREME_CHEAP" || clsZ.via !== "z") throw new Error("Z-score must drive extreme cheap when present");

const bad = rv.quoteValid({ bid: 0, ask: 1.2, ltp: 1.1 }, rv.DEFAULTS, true);
if (bad.ok) throw new Error("zero bid must be excluded from the live fit");

const crossed = rv.quoteValid({ bid: 2, ask: 1 }, rv.DEFAULTS, true);
if (crossed.ok) throw new Error("crossed market must be excluded");

console.log("option-rv: Black-76 IV, smile fit, residual classification, and Z-history gate OK");
