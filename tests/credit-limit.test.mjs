import { test } from "node:test";
import assert from "node:assert/strict";
import { amountFromInput, creditLimitExceeded } from "../src/lib/credit-limit.ts";

test("creditLimitExceeded warns only when the debt after a credit sale is above the limit", () => {
  assert.equal(creditLimitExceeded("40000.00", null, 20000, false), null);
  assert.equal(creditLimitExceeded("40000.00", "50000.00", 10000, false), null); // ровно лимит — можно
  assert.deepEqual(creditLimitExceeded("40000.00", "50000.00", 10000.01, false), {
    debtAfter: 50000.01,
    limit: 50000,
    alreadyOver: false,
  });
  assert.equal(creditLimitExceeded("40000.00", "50000.00", 20000, true), null); // за наличные
});

test("creditLimitExceeded flags a debt that is already over the limit", () => {
  assert.deepEqual(creditLimitExceeded("60000.00", "50000.00", 0, false), {
    debtAfter: 60000,
    limit: 50000,
    alreadyOver: true,
  });
  assert.equal(creditLimitExceeded("-500.00", "0.00", 400, false), null); // аванс покрывает
  assert.ok(creditLimitExceeded("0.00", "0.00", 1, false)); // лимит 0 — только за наличные
});

test("amountFromInput reads the sale amount the way the form shows it", () => {
  assert.equal(amountFromInput("54 270"), 54270);
  assert.equal(amountFromInput("1250,5"), 1250.5);
  assert.equal(amountFromInput(""), 0);
  assert.equal(amountFromInput("abc"), 0);
});
