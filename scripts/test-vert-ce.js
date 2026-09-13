const charges = require("../frontend/charges.js");
const { strikeCombos } = require("../netlify/functions/lib/box-arb");

function assertClose(actual, expected, label, tol = 0.02) {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

const k1 = 140000;
const k2 = 141000;
const width = charges.boxPayoff(k1, k2);
assertClose(width, 1000, "Gold call-spread width");

const sanity = charges.callVerticalSanity(k1, k2);
if (!sanity.ok) throw new Error(`call vertical sanity failed: ${JSON.stringify(sanity.samples)}`);
assertClose(charges.callSpreadValue(139000, k1, k2), 0, "OTM both Calls");
assertClose(charges.callSpreadValue(140500, k1, k2), 500, "between strikes");
assertClose(charges.callSpreadValue(142000, k1, k2), 1000, "max spread value = width");
if (charges.callSpreadValue(150000, k1, k2) > width + 1e-9) {
  throw new Error("Call spread value cannot exceed K2 − K1");
}

const credit = charges.callVerticalCredit(13158, 11571);
assertClose(credit, 1587, "Gold executable credit");
assertClose(credit - width, 587, "Gold gross edge");
assertClose((credit - width) * 1, 587, "per share");

const bill = charges.twoLegCallVerticalCharges({
  k1Ce: 13158,
  k2Ce: 11571,
  qty: 1,
  rates: charges.DEFAULT_RATES,
});
if (bill.legs.length !== 2) throw new Error("call vertical is two option legs only");
if (bill.legs[0].side !== "SELL" || bill.legs[1].side !== "BUY") {
  throw new Error(`expected SELL K1 / BUY K2, got ${bill.legs.map((leg) => `${leg.side} ${leg.name}`).join(", ")}`);
}
if (!(bill.total > 0)) throw new Error("two-leg charges must be computed");

const combos = strikeCombos([140000, 140500, 141000, 142000, 143000]);
if (combos.length !== 10) throw new Error(`expected 10 pairs including 500-wide, got ${combos.length}`);
if (!combos.some((row) => row.k1 === 140000 && row.k2 === 140500)) throw new Error("must include 140000-140500");
if (!combos.some((row) => row.k1 === 140000 && row.k2 === 143000)) throw new Error("must include non-adjacent 140000-143000");

console.log("vert-ce: Gold credit>width identity, payoff cap, and 2-leg charges OK");
