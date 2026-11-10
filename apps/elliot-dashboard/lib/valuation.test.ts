// Run with: npm test. Sellers and landlords on the Leads page (0043).
import { test } from "node:test";
import assert from "node:assert/strict";
import { sellerLabel, valuationAddress, valuationOf, valuationRows } from "./valuation";

const answers = { budget: "x", valuation: { intent: "sell", address: "ul. Puławska 10/5", city: "Warszawa", property_type: "apartment", area_m2: 54, rooms: 3, within_3_months: true, timeline: "this spring" } };

test("seller or landlord", () => {
  assert.equal(sellerLabel(null, answers), "Seller");
  assert.equal(sellerLabel("let", answers), "Landlord");
  assert.equal(sellerLabel(null, { budget: "1M" }), null);
  assert.equal(sellerLabel("buy", {}), null);
  assert.equal(valuationOf({ valuation: "nope" }), null);
});

test("only the details Elliot has", () => {
  const v = valuationOf(answers)!;
  assert.equal(valuationAddress(v), "ul. Puławska 10/5, Warszawa");
  assert.deepEqual(valuationRows(v), [
    ["Wants to", "Sell it"],
    ["Address", "ul. Puławska 10/5, Warszawa"],
    ["Type", "Flat"],
    ["Size", "54 m²"],
    ["Rooms", "3"],
    ["When", "this spring (within 3 months)"],
  ]);
  assert.deepEqual(valuationRows({ intent: "let" }), [["Wants to", "Let it"]]);
});
