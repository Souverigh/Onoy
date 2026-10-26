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

test("product model: variants in the model's order, color first, then size", async () => {
  const { sortVariants, variantLabel } = await import("../src/lib/product-model.ts");
  const axes = [
    { key: "size", values: ["S", "M", "L"] },
    { key: "color", values: ["Чёрный", "Белый"] },
  ];
  const items = [
    { size: "L", color: "Чёрный" },
    { size: "S", color: "Белый" },
    { size: "M", color: "Чёрный" },
    { size: "XL", color: "Чёрный" },
    { size: "S", color: "Чёрный" },
  ];
  assert.deepEqual(
    sortVariants(items, axes, (x) => x).map((x) => variantLabel(axes, x)),
    ["S, Чёрный", "M, Чёрный", "L, Чёрный", "XL, Чёрный", "S, Белый"],
  );
  assert.equal(variantLabel([{ key: "size", values: [] }], { size: "M" }), "M");
  assert.equal(variantLabel(axes, null), "");
});

test("product model: grouping keeps the order and puts a model where its first product was", async () => {
  const { groupByModel } = await import("../src/lib/product-model.ts");
  const rows = [
    { id: "a", m: null },
    { id: "b", m: "x" },
    { id: "c", m: null },
    { id: "d", m: "x" },
    { id: "e", m: "y" },
  ];
  assert.deepEqual(
    groupByModel(rows, (r) => r.m).map((g) => (g.kind === "item" ? g.item.id : `${g.model}:${g.items.map((i) => i.id).join("")}`)),
    ["a", "x:bd", "c", "y:e"],
  );
});
