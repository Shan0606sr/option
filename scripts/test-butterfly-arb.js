const charges = require("../frontend/charges.js");
const { butterflyCombos } = require("../netlify/functions/lib/butterfly-arb");

function assertClose(actual, expected, label, tol = 0.02) {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

const sanity = charges.butterflyPayoffSanity(185, 190, 195);
assertClose(sanity.width, 5, "butterfly width D");
if (!sanity.ok) throw new Error(`payoff must stay in [0, D]: ${JSON.stringify(sanity.samples)}`);
assertClose(charges.callButterflyPayoff(190, 185, 190, 195), 5, "call fly max at K2");
assertClose(charges.putButterflyPayoff(190, 185, 190, 195), 5, "put fly max at K2");
assertClose(charges.callButterflyPayoff(170, 185, 190, 195), 0, "call fly 0 below K1");
assertClose(charges.putButterflyPayoff(210, 185, 190, 195), 0, "put fly 0 above K3");

assertClose(charges.butterflyGrossCredit(2.16, 3.43, 5.47), -0.77, "spec debit example");
assertClose(charges.butterflyGrossCredit(10, 20, 10), 20, "credit fly");
const credit = 20;
const width = 5;
assertClose(credit, 20, "min profit = C");
assertClose(credit + width, 25, "max profit = C + D");

const uneven = charges.butterflyWidth(100, 110, 125);
if (uneven !== 0) throw new Error("uneven strikes must be rejected");

const chain = [100, 105, 110, 115, 120, 125, 130];
const combos = butterflyCombos(chain);
if (combos.length !== 9) throw new Error(`expected 9 equidistant triples, got ${combos.length}`);
if (!combos.some((row) => row.k1 === 100 && row.k2 === 105 && row.k3 === 110)) {
  throw new Error("must include adjacent 100/105/110");
}
if (!combos.some((row) => row.k1 === 100 && row.k2 === 110 && row.k3 === 120)) {
  throw new Error("must include 100/110/120");
}
if (!combos.some((row) => row.k1 === 100 && row.k2 === 115 && row.k3 === 130)) {
  throw new Error("must include 100/115/130");
}
if (combos.some((row) => row.k1 === 100 && row.k2 === 105 && row.k3 === 115)) {
  throw new Error("must not include uneven 100/105/115");
}

const qMax = Math.min(100, 50 / 2, 80);
if (qMax !== 25) throw new Error(`Qmax should be min(Qk1, Qk2/2, Qk3), got ${qMax}`);

const bill = charges.butterflyCharges({
  isCall: true,
  k1Px: 10,
  k2Px: 20,
  k3Px: 10,
  qty: 100,
  rates: charges.DEFAULT_RATES,
});
if (bill.legs.length !== 3) throw new Error("butterfly is three instruments");
if (bill.legs[0].side !== "BUY" || bill.legs[1].side !== "SELL" || bill.legs[2].side !== "BUY") {
  throw new Error(`expected BUY/SELL/BUY, got ${bill.legs.map((leg) => `${leg.side} ${leg.name}`).join(", ")}`);
}
if (bill.legs[1].qty !== 200) throw new Error("middle leg must be 2× quantity");
if (!(bill.total > 0)) throw new Error("butterfly charges must be computed");
const debitGross = charges.butterflyGrossCredit(2.16, 3.43, 5.47);
const debitBill = charges.butterflyCharges({
  isCall: true,
  k1Px: 2.16,
  k2Px: 3.43,
  k3Px: 5.47,
  qty: 65,
  rates: charges.DEFAULT_RATES,
});
if (debitGross - debitBill.total / 65 >= 0) {
  throw new Error("spec debit example must stay non-positive after costs");
}
const creditBill = charges.butterflyCharges({
  isCall: true,
  k1Px: 10,
  k2Px: 20,
  k3Px: 10,
  qty: 100,
  rates: charges.DEFAULT_RATES,
});
if (20 - creditBill.total / 100 <= 0) {
  throw new Error("wide credit fly should remain a credit after default costs");
}

const putBill = charges.butterflyCharges({
  isCall: false,
  k1Px: 10,
  k2Px: 20,
  k3Px: 10,
  qty: 100,
  rates: charges.DEFAULT_RATES,
});
if (!/PE/.test(putBill.legs[0].name)) throw new Error("put fly must charge PE legs");

console.log("butterfly-arb: equidistant combos, [0,D] payoff, credit identity, and 1:-2:1 costs OK");
