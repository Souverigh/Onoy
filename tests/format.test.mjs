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
test("phone is printed with spaces", async () => {
  const { phoneText } = await import("../src/lib/format.ts");
  assert.equal(phoneText("+996773033399"), "+996 773 033 399");
  assert.equal(phoneText("996 773-03-33-99"), "+996 773 033 399");
  assert.equal(phoneText("0773033399"), "0773 033 399");
  assert.equal(phoneText("773033399"), "+996 773 033 399");
  assert.equal(phoneText(""), "");
  assert.equal(phoneText("+7 999 123 45 67"), "+7 999 123 45 67");
});
test("debt is shown in words, never with a minus", async () => {
  const { debtMoney } = await import("../src/lib/format.ts");
  assert.equal(debtMoney("-3229.99", "RUB").replace(/\s/g, " "), "аванс 3 229,99 ₽");
  assert.equal(debtMoney("4150.00").replace(/\s/g, " "), "4 150 сом");
  assert.equal(debtMoney("-0.00").replace(/\s/g, " "), "0 сом");
});
