import { test } from "node:test";
import assert from "node:assert/strict";
import { convertAmount, partyCurrency, rateInput, ratePair } from "../src/lib/currency.ts";
import { money, originalAmountText } from "../src/lib/format.ts";

test("convertAmount: the rate is quoted as people say it — strong → weak multiplies, weak → strong divides", () => {
  assert.deepEqual(ratePair("KGS", "USD"), ["USD", "KGS"]);
  assert.deepEqual(ratePair("RUB", "USD"), ["USD", "RUB"]);
  assert.deepEqual(ratePair("KGS", "RUB"), ["RUB", "KGS"]);
  // Оплата Хорозу сомами по 87,80 — в долларах, как в базе (private.converted_amount).
  assert.equal(convertAmount(87800, "KGS", "USD", 87.8), 1000);
  assert.equal(convertAmount(4900645, "KGS", "USD", 87.8), 55816);
  // Долларовая накладная клиенту в сомах.
  assert.equal(convertAmount(100.5, "USD", "KGS", 87.8), 8823.9);
  assert.equal(convertAmount(10, "KGS", "KGS", 1), 10);
  assert.equal(convertAmount(10, "USD", "KGS", 0), 0);
});

test("rateInput and partyCurrency: comma decimals, junk rejected, null currency means the shop's", () => {
  assert.equal(rateInput("87,80"), "87.8");
  assert.equal(rateInput(" 1,0318 "), "1.0318");
  assert.equal(rateInput("0"), null);
  assert.equal(rateInput("abc"), null);
  assert.equal(rateInput("1.1234567"), null);
  assert.equal(partyCurrency({ currency: null }, "KGS"), "KGS");
  assert.equal(partyCurrency({ currency: "USD" }, "KGS"), "USD");
  assert.equal(partyCurrency(undefined, "RUB"), "RUB");
});

test("money shows the currency sign; a converted record shows its original amount and rate", () => {
  assert.equal(money("55816.76", "USD").replace(/\s/g, " "), "55 816,76 $");
  assert.equal(money("100", "RUB").replace(/\s/g, " "), "100 ₽");
  assert.equal(money("100").replace(/\s/g, " "), "100 сом");
  assert.equal(
    originalAmountText({ original_amount: "87800.00", original_currency: "KGS", fx_rate: "87.800000" })?.replace(/\s/g, " "),
    "87 800 сом по 87,8",
  );
  assert.equal(originalAmountText({ original_amount: null, original_currency: null, fx_rate: null }), null);
});
