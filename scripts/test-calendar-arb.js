const engine = require("../frontend/calendar-engine.js");
const charges = require("../frontend/charges.js");
const rv = require("../frontend/option-rv-engine.js");

function assertClose(actual, expected, label, tol = 0.02) {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

assertClose(engine.syntheticFuture(25000, 180, 100, 0, 0.08), 25080, "DF=1 synthetic");
assertClose(engine.syntheticFuture(25000, 200, 75, 0, 0.16), 25125, "far DF=1 synthetic");
assertClose(engine.currentSpread(25125, 25080), 45, "current calendar spread");

const fair = engine.fairSpread(25000, 0, 0, 30 / 365.25, 61 / 365.25);
assertClose(fair, 0, "zero carry fair spread");
assertClose(engine.mispricing(45, 0), 45, "mispricing vs zero fair");

const fairCarry = engine.fairSpread(25000, 0.065, 0, 30 / 365.25, 61 / 365.25);
if (!(fairCarry > 0)) throw new Error("positive funding must produce a positive fair calendar");

const exec = engine.executableSynthetics({
  strike: 25000, rate: 0, tNear: 0.08, tFar: 0.16,
  nearCeAsk: 181, nearPeBid: 99, nearCeBid: 179, nearPeAsk: 101,
  farCeBid: 198, farPeAsk: 76, farCeAsk: 202, farPeBid: 74,
});
if (!(exec.spreadA < 45)) throw new Error("executable A spread must be worse than mid 45");
if (!(exec.spreadB > 45)) throw new Error("buying the spread must cost more than mid 45");

const picked = engine.pickDirection({
  spreadA: exec.spreadA,
  spreadB: exec.spreadB,
  fair: 28,
  costA: 2,
  costB: 2,
});
if (!picked.id) throw new Error("direction must be selected");

const pairs = engine.expiryPairs(["2026-09-29", "2026-10-27", "2026-11-24"], "near-next");
if (pairs.length !== 1 || pairs[0].near !== "2026-09-29" || pairs[0].far !== "2026-10-27") {
  throw new Error(`near-next pair failed: ${JSON.stringify(pairs)}`);
}
if (engine.expiryPairs(["2026-09-29", "2026-10-27", "2026-11-24"], "adjacent").length !== 2) {
  throw new Error("adjacent mode must emit every consecutive pair");
}

const hist = [1, 2, 2, 3, 4, 5, 8, 12, 12, 17];
assertClose(engine.percentileRank(17, hist), 100, "current 17 is max percentile", 0.1);
assertClose(engine.median(hist), 4.5, "median of even history");

const aPlus = engine.classifyCalendar({
  absMis: 17, netEdge: 8, netDelta: 0.01, live: true, executable: true, qLots: 20, percentile: 97, cfg: engine.DEFAULTS,
});
if (aPlus.grade !== "A+") throw new Error(`expected A+, got ${aPlus.grade}`);
if (engine.actionForGrade("A+").action !== "HIGH-CONFIDENCE") throw new Error("A+ maps to HIGH-CONFIDENCE");
if (engine.actionForGrade("A").action !== "TRADE CANDIDATE") throw new Error("A maps to TRADE CANDIDATE");
if (engine.actionForGrade("B").action !== "WATCH") throw new Error("B maps to WATCH");
if (engine.actionForGrade("IGNORE").action !== "WAIT") throw new Error("IGNORE maps to WAIT");

const ltp = engine.classifyCalendar({
  absMis: 17, netEdge: 8, netDelta: 0.01, live: false, executable: false, qLots: 0, percentile: 97, cfg: engine.DEFAULTS,
});
if (ltp.grade !== "B") throw new Error(`holiday/LTP must be B not ${ltp.grade}`);

const T = 30 / 365.25;
const callD = rv.black76Delta({ F: 25080, K: 25000, T, sigma: 0.12, isCall: true, rate: 0 });
const putD = rv.black76Delta({ F: 25080, K: 25000, T, sigma: 0.12, isCall: false, rate: 0 });
const synthD = rv.syntheticDelta(callD, putD);
assertClose(synthD, 1, "synthetic future delta ≈ +1 when r=0", 0.02);

const billA = charges.calendarCharges({
  buyNear: true, nearCe: 181, nearPe: 99, farCe: 198, farPe: 76, qty: 65, rates: charges.DEFAULT_RATES,
});
if (billA.legs.length !== 4) throw new Error("calendar is four option legs");
if (billA.legs.map((leg) => `${leg.side} ${leg.name}`).join(", ") !== "BUY Near CE, SELL Near PE, SELL Far CE, BUY Far PE") {
  throw new Error(`direction A legs: ${billA.legs.map((leg) => `${leg.side} ${leg.name}`).join(", ")}`);
}
const billB = charges.calendarCharges({
  buyNear: false, nearCe: 179, nearPe: 101, farCe: 202, farPe: 74, qty: 65, rates: charges.DEFAULT_RATES,
});
if (billB.legs[0].side !== "SELL" || billB.legs[3].side !== "SELL") {
  throw new Error("direction B must sell near CE and far PE");
}

console.log("calendar-arb: synthetic identity, carry fair, 4-leg costs, delta≈1, and grade mapping OK");
