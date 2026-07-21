import assert from "node:assert/strict";
import { calculateFinalScore, marketPriceAfterNet, residualValueAtPrice } from "../src/game/scoring.ts";

assert.equal(residualValueAtPrice(9), 4);
assert.equal(residualValueAtPrice(8), 4);
assert.equal(residualValueAtPrice(1), 0);
assert.equal(marketPriceAfterNet(8, 1), 9);
assert.equal(marketPriceAfterNet(8, -4), 6);
assert.equal(marketPriceAfterNet(12, 4), 12);
assert.equal(
  calculateFinalScore(
    10,
    { SPICE: 3, IRON: 0, SILK: 0, RELIC: 0 },
    { SPICE: 9, IRON: 4, SILK: 6, RELIC: 8 },
    2,
  ),
  20,
);

console.log("residual value tests passed");
