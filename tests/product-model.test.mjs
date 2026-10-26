import { test } from "node:test";
import assert from "node:assert/strict";
import { addAxisValues, attrsKey, combinations, parseAxes, variantName } from "../src/lib/product-model.ts";

test("product model: values are added once, trimmed, case-insensitive", () => {
  assert.deepEqual(addAxisValues(["S"], " m ; L,, s\nXL "), ["S", "m", "L", "XL"]);
  assert.deepEqual(addAxisValues([], "  Тёмно   синий "), ["Тёмно синий"]);
});

test("product model: every combination, first axis changes slowest", () => {
  const axes = [
    { key: "size", values: ["S", "M"] },
    { key: "color", values: ["Чёрный", "Белый"] },
  ];
  assert.deepEqual(combinations(axes), [
    { size: "S", color: "Чёрный" },
    { size: "S", color: "Белый" },
    { size: "M", color: "Чёрный" },
    { size: "M", color: "Белый" },
  ]);
  assert.deepEqual(combinations([]), []);
  assert.deepEqual(combinations([{ key: "size", values: [] }]), []);
  assert.equal(variantName("Футболка Nike", axes, { color: "Белый", size: "M" }), "Футболка Nike (M, Белый)");
  assert.notEqual(attrsKey(axes, { size: "S", color: "M" }), attrsKey(axes, { size: "SM", color: "" }));
});

test("product model: axes from the database, garbage dropped", () => {
  assert.deepEqual(parseAxes([{ key: "size", values: ["S", 1] }, { key: 2 }, null]), [{ key: "size", values: ["S"] }]);
  assert.deepEqual(parseAxes("x"), []);
});
