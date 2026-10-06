import { test } from "node:test";
import assert from "node:assert/strict";
import { cashbox, paymentMethod } from "../src/lib/cashbox.ts";

const user = "11111111-1111-4111-8111-111111111111";

test("cash left for the day: transfers and claims are not in the till", () => {
  // Пример из задачи 1: 5 000 наличными от клиента, 1 500 переводом, заявка
  // 1 000, 3 000 сом Хорозу (долг в $), расход 200 → 1 800 сом.
  const box = cashbox({
    shopCurrency: "KGS",
    cashSales: [],
    payments: [
      { direction: "incoming", amount: "5000.00", currency: "KGS", method: "cash", created_by: user },
      { direction: "incoming", amount: "1500.00", currency: "KGS", method: "transfer", created_by: user },
      { direction: "incoming", amount: "1000.00", currency: "KGS", created_by: null },
      {
        direction: "outgoing",
        amount: "34.17",
        original_amount: "3000.00",
        original_currency: "KGS",
        currency: "USD",
        created_by: user,
      },
    ],
    expenses: 200,
  });
  assert.equal(box.left, 1800);
  assert.equal(box.cashIn, 5000);
  assert.equal(box.cashOut, 3000);
  assert.equal(box.transferIn, 2500);
});

test("dollar payments and dollar sales do not enter the som till", () => {
  const box = cashbox({
    shopCurrency: "KGS",
    cashSales: [
      { amount: "1000.00", currency: "KGS" },
      { amount: "10.00", currency: "USD" },
    ],
    payments: [{ direction: "outgoing", amount: "10.00", currency: "USD", created_by: user }],
    expenses: 0,
  });
  assert.equal(box.cashIn, 1000);
  assert.equal(box.cashOut, 0);
  assert.equal(box.left, 1000);
});

test("old payments without a method: reference, receipt or claim means transfer", () => {
  assert.equal(paymentMethod({ direction: "incoming", amount: 1, created_by: user }), "cash");
  assert.equal(paymentMethod({ direction: "incoming", amount: 1, created_by: user, bank_reference: "A1" }), "transfer");
  assert.equal(paymentMethod({ direction: "incoming", amount: 1, created_by: user, document_id: "d" }), "transfer");
  assert.equal(paymentMethod({ direction: "incoming", amount: 1, created_by: null }), "transfer");
  assert.equal(paymentMethod({ direction: "incoming", amount: 1, created_by: null, method: "cash" }), "cash");
});
