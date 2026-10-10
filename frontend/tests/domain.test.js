import { test } from "node:test";
import assert from "node:assert/strict";
import { units, decimal, split, equalShares, average, projection } from "../src/domain.js";
test("whole-peso splits preserve the exact amount, including refunds", () => {
  for (const amount of [
    "8897",
    "-8897",
    "0",
    "1000000000",
  ]) {
    for (const p of [0, 33.33, 50, 99.99, 100]) {
      const [a, b] = split(amount, p);
      assert.equal(units(a) + units(b), units(amount));
      assert.match(a, /^-?\d+$/);
    }
    assert.equal(units(decimal(units(amount))), units(amount));
  }
  assert.deepEqual(split("-10", 50), ["-5", "-5"]);
  assert.deepEqual(split("8897", 50), ["4449", "4448"]);
  assert.deepEqual(split("-8897", 50), ["-4449", "-4448"]);
  assert.deepEqual(equalShares("10", 3), ["4", "3", "3"]);
  assert.deepEqual(equalShares("-10", 3), ["-4", "-3", "-3"]);
  assert.throws(() => split("0.5", 50));
  assert.throws(() => equalShares("0.5", 2));
  assert.equal(units(decimal(units("0.123456"))), units("0.123456"));
  assert.throws(() => units("1e6"));
  assert.throws(() => units("1.1234567"));
});
test("projection retains the previous formula and does not fill intermediate gaps", () => {
  const a = [100, null, 200, ...Array(9).fill(null)],
    b = [50, 50, 100, ...Array(9).fill(100)];
  const p = projection(a, b);
  assert.equal(p.rate, 1);
  assert.equal(p.pairs, 2);
  assert.equal(p.forecast[1], null);
  assert.equal(p.forecast[3], 200);
  assert.equal(projection(Array(12).fill(null), b).rate, null);
  assert.equal(projection(a, Array(12).fill(0)).rate, null);
  assert.deepEqual(average([1, 2, 3, null, 5]), [null, null, 2, null, null]);
});
