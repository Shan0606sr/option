const charges = require("../frontend/charges.js");
const { strikeCombos } = require("../netlify/functions/lib/box-arb");

function assertClose(actual, expected, label, tol = 0.02) {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

const sanity = charges.boxPayoffSanity(1300, 1400);
assertClose(sanity.width, 100, "box width");
if (!sanity.ok) throw new Error(`payoff identity failed: ${JSON.stringify(sanity.samples)}`);
for (const sample of sanity.samples) {
  assertClose(sample.payoff, 100, `payoff at S=${sample.spot}`);
}

assertClose(charges.longBoxCost(150, 80, 120, 60), 130, "no-arb long box cost");
assertClose(100 - 130, -30, "no-arb long gross");
assertClose(charges.longBoxCost(120, 70, 90, 55), 85, "arb long box cost");
assertClose(100 - 85, 15, "arb long gross");
assertClose(15 * 400, 6000, "arb long gross / lot");

assertClose(charges.shortBoxCredit(80, 150, 60, 120), -130, "short of expensive box is a debit");
assertClose(charges.shortBoxCredit(70, 120, 55, 90), -85, "short of cheap box");

const combos = strikeCombos([1300, 1320, 1340, 1360, 1380, 1400, 1420]);
if (combos.length !== 21) throw new Error(`expected 21 strike pairs, got ${combos.length}`);
if (!combos.some((row) => row.k1 === 1300 && row.k2 === 1420)) throw new Error("must include non-adjacent 1300-1420");
if (!combos.some((row) => row.k1 === 1400 && row.k2 === 1420)) throw new Error("must include adjacent 1400-1420");

const longBill = charges.fourLegBoxCharges({
  longBox: true,
  k1Ce: 120,
  k2Ce: 70,
  k2Pe: 90,
  k1Pe: 55,
  qty: 400,
  rates: charges.DEFAULT_RATES,
});
if (longBill.legs.length !== 4) throw new Error("box needs four legs");
if (longBill.legs[0].side !== "BUY" || longBill.legs[1].side !== "SELL" || longBill.legs[2].side !== "BUY" || longBill.legs[3].side !== "SELL") {
  throw new Error(`long box sides ${longBill.legs.map((leg) => `${leg.side} ${leg.name}`).join(", ")}`);
}
if (!(longBill.total > 0)) throw new Error("four-leg charges must be computed");

const shortBill = charges.fourLegBoxCharges({
  longBox: false,
  k1Ce: 70,
  k2Ce: 120,
  k2Pe: 55,
  k1Pe: 90,
  qty: 400,
  rates: charges.DEFAULT_RATES,
});
if (shortBill.legs[0].side !== "SELL" || shortBill.legs[2].side !== "SELL") {
  throw new Error("short box must sell K1 CE and K2 PE");
}

console.log("box-arb: payoff identity, every K1/K2 pair, and 4-leg charges OK");
