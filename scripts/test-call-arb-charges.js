const charges = require("../frontend/charges.js");
const { pickStrikes } = require("../netlify/functions/lib/call-arb");

function assertClose(actual, expected, label, tol = 0.02) {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

const strike = 49000;
const callAsk = 775.95;
const putBid = 1134.25;
const futBid = 48715;
const lot = 25;

const synth = charges.syntheticCall(futBid, putBid, strike, 1);
assertClose(synth, 849.25, "BOSCH synthetic Call sell");
assertClose(synth - callAsk, 73.30, "BOSCH gross edge");
assertClose((synth - callAsk) * lot, 1832.50, "BOSCH gross / lot");

const method = charges.methodology(1);
if (method.id !== "simple") throw new Error("df=1 must be simple methodology");
if (charges.methodology(0.98).id !== "carry") throw new Error("df!=1 must be carry methodology");

const bill = charges.threeLegCharges({
  strategy: "A",
  callPx: callAsk,
  putPx: putBid,
  futPx: futBid,
  strike,
  qty: lot,
  rates: charges.DEFAULT_RATES,
});

if (!(bill.total > 400)) {
  throw new Error(`charges should be computed from turnover, not a flat buffer. got ${bill.total}`);
}
if (bill.legs.length !== 3) throw new Error("need three legs");
if (bill.legs[2].stt < 500) {
  throw new Error(`future sell STT should dominate (0.05% of notional). got ${bill.legs[2].stt}`);
}

const slip = charges.slippagePerShare({
  callBid: 770,
  callAsk,
  putBid,
  putAsk: 1140,
  futBid,
  futAsk: 48725,
  rates: charges.DEFAULT_RATES,
});
const netLot = (synth - callAsk - bill.total / lot - slip) * lot;
if (!(netLot > 0)) throw new Error(`BOSCH net/lot should stay positive after real charges. got ${netLot}`);

console.log(JSON.stringify({
  synth,
  gross: synth - callAsk,
  grossLot: (synth - callAsk) * lot,
  charges: bill.total,
  futureStt: bill.legs[2].stt,
  slip,
  netLot: Math.round(netLot * 100) / 100,
  method: method.label,
}, null, 2));
const kept = pickStrikes([47000, 48000, 48500, 49000, 50000, 52000], 48715, 6, 5);
if (!kept.includes(49000)) throw new Error(`ATM band must keep 49000, got ${kept}`);

console.log("call-arb charges: BOSCH identity and rate-card engine OK");
