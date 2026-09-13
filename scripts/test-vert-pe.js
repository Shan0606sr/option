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
assertClose(width, 1000, "Gold put-spread width");

const sanity = charges.putVerticalSanity(k1, k2);
if (!sanity.ok) throw new Error(`put vertical sanity failed: ${JSON.stringify(sanity.samples)}`);
assertClose(charges.putSpreadValue(150000, k1, k2), 0, "OTM both Puts");
assertClose(charges.putSpreadValue(140500, k1, k2), 500, "between strikes");
assertClose(charges.putSpreadValue(140000, k1, k2), 1000, "at K1 = width");
assertClose(charges.putSpreadValue(139000, k1, k2), 1000, "ITM both Puts still width");
assertClose(charges.putSpreadValue(130000, k1, k2), 1000, "deep ITM still width");
if (charges.putSpreadValue(100000, k1, k2) > width + 1e-9) {
  throw new Error("Put spread value cannot exceed K2 − K1");
}

const credit = charges.putVerticalCredit(1900, 800);
assertClose(credit, 1100, "Gold executable put credit");
assertClose(credit - width, 100, "Gold put gross edge");

const bill = charges.twoLegPutVerticalCharges({
  k1Pe: 800,
  k2Pe: 1900,
  qty: 1,
  rates: charges.DEFAULT_RATES,
});
if (bill.legs.length !== 2) throw new Error("put vertical is two option legs only");
if (bill.legs[0].side !== "BUY" || bill.legs[1].side !== "SELL") {
  throw new Error(`expected BUY K1 / SELL K2, got ${bill.legs.map((leg) => `${leg.side} ${leg.name}`).join(", ")}`);
}
if (!(bill.total > 0)) throw new Error("two-leg charges must be computed");

const combos = strikeCombos([140000, 140500, 141000, 141500]);
if (combos.length !== 6) throw new Error(`expected 6 pairs including 500-wide, got ${combos.length}`);
if (!combos.some((row) => row.k1 === 140000 && row.k2 === 140500)) throw new Error("must include 140000-140500");
if (!combos.some((row) => row.k1 === 140000 && row.k2 === 141500)) throw new Error("must include non-adjacent 140000-141500");

console.log("vert-pe: Gold credit>width identity, payoff cap, and 2-leg charges OK");
