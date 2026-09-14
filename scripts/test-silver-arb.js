const charges = require("../frontend/charges.js");
const { daysToExpiry } = require("../netlify/functions/lib/silver-arb");

function assertClose(actual, expected, label, tol = 0.02) {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

assertClose(charges.unitsPerKg(1), 1000, "1g unit → 1000 units/kg");
assertClose(charges.etfPerKg(222, 1), 222000, "SILVERBEES ₹/kg");

const hedge = charges.silverHedge({ gramsPerUnit: 1, futLotSize: 1, kgPerFutLot: 1, lots: 1 });
assertClose(hedge.etfUnits, 1000, "BUY 1000 SILVERBEES");
assertClose(hedge.futQty, 1, "SELL 1 SILVERMIC");
assertClose(hedge.kg, 1, "1 kg hedge");

const etfKg = charges.etfPerKg(222, 1);
const futKg = 234000;
const gross = futKg - etfKg;
assertClose(gross, 12000, "Gross ₹/kg");
assertClose((gross / etfKg) * 100, 5.405, "Gross %", 0.01);

const days = daysToExpiry("2026-11-30", "2026-09-13");
if (!(days > 60 && days < 90)) throw new Error(`days to Nov 30 from Sep 13 should be ~78, got ${days}`);
const simple = charges.annualizeSimple(5.405, days);
if (!(simple > 0)) throw new Error("simple annualization must be positive");
const cmp = charges.annualizeCompound(5.405, days);
if (!(cmp > simple * 0.5)) throw new Error("compounded annualization should be computed");

const nav = charges.navPremiumPct(222, 220);
assertClose(nav, (222 - 220) / 220 * 100, "NAV premium");

const bill = charges.silverSpreadCharges({
  buyEtf: true,
  etfPx: 222,
  futPx: 234000,
  etfQty: 1000,
  futQty: 1,
  rates: charges.DEFAULT_RATES,
});
if (bill.legs.length !== 2) throw new Error("silver V1 is two legs: ETF + MCX future");
if (bill.legs[0].side !== "BUY" || bill.legs[1].side !== "SELL") {
  throw new Error(`expected BUY ETF / SELL future, got ${bill.legs.map((leg) => `${leg.side} ${leg.name}`).join(", ")}`);
}
if (!(bill.total > 0)) throw new Error("ETF+MCX charges must be computed");

const reverse = charges.silverSpreadCharges({
  buyEtf: false,
  etfPx: 222,
  futPx: 234000,
  etfQty: 1000,
  futQty: 1,
  rates: charges.DEFAULT_RATES,
});
if (reverse.legs[0].side !== "SELL" || reverse.legs[1].side !== "BUY") {
  throw new Error("strategy B must sell ETF and buy future");
}

console.log("silver-arb: ₹/kg identity, hedge 1000/1, annualization, and 2-leg costs OK");
