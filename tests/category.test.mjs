import { test } from "node:test";
import assert from "node:assert/strict";
import {
  categoryGroups,
  categoryHints,
  categoryLabel,
  categoryTree,
  categoryWithChildren,
  nameKeys,
  stem,
  suggestCategory,
} from "../src/lib/category.ts";

test("nameKeys: the kind of product from the start or the end of the name, codes and adjectives skipped", () => {
  assert.equal(nameKeys("Светильник CARLA-18").first, "светильник");
  assert.equal(nameKeys("CARLA-18 светильник").first, "светильник");
  assert.equal(nameKeys("Светодиодная лампа E27 10W").first, "ламп");
  assert.equal(nameKeys("Розетка двойная белая").first, "розетк");
  assert.equal(nameKeys("Кабель ВВГнг 3х2,5").first, "кабел");
  assert.equal(nameKeys("Кабель медный бухта").last, "бухт");
  assert.equal(nameKeys("Philips лампа").first, "ламп");
  assert.equal(nameKeys("12345"), null);
  assert.equal(stem("Лампы"), stem("лампа"));
  assert.equal(stem("светильники"), "светильник");
  assert.equal(stem("чай"), "чай");
});

const products = [
  { id: "1", name: "Светильник CARLA-18", category_id: null },
  { id: "2", name: "CARLA-20 светильник", category_id: null },
  { id: "3", name: "Светильник потолочный", category_id: null },
  { id: "4", name: "Розетка двойная", category_id: null },
  { id: "5", name: "Розетки наружные", category_id: null },
  { id: "6", name: "Цемент М400", category_id: null },
  { id: "7", name: "Лампа LED 10W", category_id: "cat-light" },
];

test("categoryGroups: products of one kind become a suggested category, single ones stay without", () => {
  const groups = categoryGroups(products);
  assert.deepEqual(
    groups.map((g) => [g.name, g.products.map((p) => p.id).sort()]),
    [
      ["Светильник", ["1", "2", "3"]],
      ["Розетка", ["4", "5"]],
    ],
  );
});

test("categoryHints: learns from products already put into a category and from category names", () => {
  const categories = [
    { id: "cat-light", name: "Освещение", parent_id: null },
    { id: "cat-socket", name: "Розетки", parent_id: null },
  ];
  const hints = categoryHints(categories, products);
  assert.equal(suggestCategory("Лампа накаливания", hints), "cat-light");
  assert.equal(suggestCategory("Розетка с заземлением", hints), "cat-socket");
  assert.equal(suggestCategory("Цемент М500", hints), null);
  // Есть подсказка — в новые группы товар не идёт.
  assert.ok(!categoryGroups(products, hints).some((g) => g.name === "Розетка"));
});

test("category tree, labels and a category with its subcategories", () => {
  const categories = [
    { id: "s", name: "Светильники", parent_id: "o" },
    { id: "o", name: "Освещение", parent_id: null },
    { id: "k", name: "Кабель", parent_id: null },
  ];
  assert.equal(categoryLabel(categories, "s"), "Освещение / Светильники");
  assert.equal(categoryLabel(categories, null), null);
  assert.deepEqual(
    categoryTree(categories).map((t) => [t.category.id, t.children.map((c) => c.id)]),
    [
      ["k", []],
      ["o", ["s"]],
    ],
  );
  assert.deepEqual(categoryWithChildren(categories, "o"), ["o", "s"]);
});
