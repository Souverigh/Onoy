import { test } from "node:test";
import assert from "node:assert/strict";
import { money, quantity } from "../src/lib/format.ts";
test("format preserves kopeks at full permitted precision", () => {
  assert.equal(
    money("99999999999999.99").replace(/\s/g, ""),
    "99999999999999,99сом",
  );
  assert.equal(money("-0.25").replace(/\s/g, ""), "-0,25сом");
  assert.equal(
    quantity("9999999999999.999").replace(/\s/g, ""),
    "9999999999999,999",
  );
});
test("low stock comparison remains exact at maximum precision", async () => {
  const { decimalLessThan } = await import("../src/lib/format.ts");
  assert.equal(typeof decimalLessThan, "function");
  assert.equal(decimalLessThan("9999999999999.998", "9999999999999.999"), true);
  assert.equal(decimalLessThan("-0.001", "0.000"), true);
  assert.equal(decimalLessThan("12.00", "12"), false);
});
