import { test } from "node:test";
import assert from "node:assert/strict";
import { dishCost, portionInput, portionQty, productShare, shareLevel } from "../src/lib/dish.ts";

test("dish: portions are typed in grams and millilitres, stored in kg and l", () => {
  assert.equal(portionQty("150", "кг"), "0.15");
  assert.equal(portionQty("2", "кг"), "0.002");
  assert.equal(portionQty("30", "л"), "0.03");
  assert.equal(portionQty("1,5", "шт"), "1.5");
  assert.equal(portionQty("0", "кг"), null);
  assert.equal(portionQty("", "кг"), null);
  assert.equal(portionQty("abc", "кг"), null);
  assert.equal(portionInput("0.15", "кг"), "150");
  assert.equal(portionInput("0.0025", "кг"), "2,5");
  assert.equal(portionInput("2", "шт"), "2");
});

test("dish: cost counts only priced products in the shop currency, and says what is missing", () => {
  const lines = [
    { qty: "0.15", purchase_price: "120", purchase_currency: null },
    { qty: "0.12", purchase_price: "650", purchase_currency: "KGS" },
    { qty: "0.03", purchase_price: "180", purchase_currency: null },
  ];
  assert.deepEqual(dishCost(lines, "KGS"), { cost: 101.4, noPrice: 0, foreign: 0, complete: true });
  assert.deepEqual(dishCost([...lines, { qty: "1", purchase_price: "0", purchase_currency: null }], "KGS"), {
    cost: 101.4,
    noPrice: 1,
    foreign: 0,
    complete: false,
  });
  assert.equal(dishCost([{ qty: "1", purchase_price: "2", purchase_currency: "USD" }], "KGS").foreign, 1);
  assert.equal(dishCost([], "KGS").complete, false);
});

test("dish: share of products in the price and its level", () => {
  assert.equal(productShare(106, "350"), 30);
  assert.equal(productShare(0, "350"), null);
  assert.equal(productShare(100, "0"), null);
  assert.deepEqual([30, 35, 43, 45, 60].map(shareLevel), ["ok", "ok", "high", "high", "bad"]);
});
