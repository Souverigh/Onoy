import { test } from "node:test";
import assert from "node:assert/strict";
import { dishImpact, itemStats, priceRises } from "../src/lib/kitchen-stats.ts";

const recipes = new Map([
  ["plov", [{ product_id: "rice", qty: "0.15" }, { product_id: "meat", qty: "0.12" }]],
  ["tea", []],
]);
const names = new Map([["plov", "Плов"], ["tea", "Чай"], ["fanta", "Fanta"]]);

test("kitchen stats: dishes cost their recipe, goods themselves; profit and share; unknown cost stays unknown", () => {
  const unitCost = new Map([["rice", 120], ["meat", 650], ["fanta", 100]]);
  const rows = itemStats(
    [
      { dish_id: "plov", product_id: null, qty: "40", price: "350" },
      { dish_id: "plov", product_id: null, qty: "2", price: "350" },
      { dish_id: null, product_id: "fanta", qty: "8", price: "150" },
      { dish_id: "tea", product_id: null, qty: "64", price: "80" },
    ],
    recipes,
    unitCost,
    names,
  );
  assert.deepEqual(
    rows.map((r) => [r.name, r.qty, r.revenue, r.cost, r.profit, r.share]),
    [
      ["Плов", 42, 14700, 4032, 10668, 27],
      ["Fanta", 8, 1200, 800, 400, 67],
      ["Чай", 64, 5120, null, null, null],
    ],
  );
  // У продукта нет цены — себестоимость блюда неизвестна, не ноль.
  assert.equal(itemStats([{ dish_id: "plov", product_id: null, qty: 1, price: 350 }], recipes, new Map([["rice", 120]]), names)[0].cost, null);
});

test("kitchen stats: price rise is the last purchase in the period against the last one before it", () => {
  const rises = priceRises(
    [
      { product_id: "meat", at: "2026-09-10", price: 560 },
      { product_id: "meat", at: "2026-09-25", price: 580 },
      { product_id: "meat", at: "2026-10-05", price: 640 },
      { product_id: "meat", at: "2026-10-29", price: 650 },
      { product_id: "rice", at: "2026-09-20", price: 125 },
      { product_id: "rice", at: "2026-10-15", price: 120 },
      { product_id: "tomato", at: "2026-10-03", price: 60 },
      { product_id: "oil", at: "2026-09-01", price: 165 },
      { product_id: "oil", at: "2026-11-02", price: 200 },
    ],
    "2026-10-01",
    "2026-10-31",
  );
  // Рис подешевел, помидоров до периода не покупали, масло подорожало уже после.
  assert.deepEqual(rises, [{ product_id: "meat", before: 580, now: 650, percent: 12 }]);
  assert.deepEqual(dishImpact(rises[0], recipes, names), [{ id: "plov", name: "Плов", plus: 8.4 }]);
});
