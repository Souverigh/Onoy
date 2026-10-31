import { test } from "node:test";
import assert from "node:assert/strict";
import { menuTotal, writeOff } from "../src/lib/day-sale.ts";

test("day sale: menu total adds qty × price of dishes and goods", () => {
  assert.equal(
    menuTotal([
      { kind: "dish", id: "plov", qty: 42, price: 350 },
      { kind: "product", id: "fanta", qty: 8, price: 150 },
      { kind: "dish", id: "tea", qty: 3, price: 80.5 },
    ]),
    16141.5,
  );
  assert.equal(menuTotal([]), 0);
});

test("day sale: dishes write off their recipe, goods themselves, the same product adds up", () => {
  const recipes = new Map([
    ["plov", [{ product_id: "rice", qty: "0.15" }, { product_id: "oil", qty: "0.03" }]],
    ["lagman", [{ product_id: "oil", qty: "0.02" }]],
  ]);
  const off = writeOff(
    [
      { kind: "dish", id: "plov", qty: 42, price: 350 },
      { kind: "dish", id: "lagman", qty: 30, price: 320 },
      { kind: "product", id: "fanta", qty: 8, price: 150 },
      { kind: "dish", id: "tea", qty: 5, price: 80 },
      { kind: "dish", id: "plov-zero", qty: 0, price: 1 },
    ],
    recipes,
  );
  assert.deepEqual(Object.fromEntries(off), { rice: 6.3, oil: 1.86, fanta: 8 });
});
