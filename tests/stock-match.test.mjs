import { test } from "node:test";
import assert from "node:assert/strict";
import { exactProduct, plainName, suggestProduct } from "../src/lib/match.ts";

const product = (id, name, aliases = []) => ({ id, name, sku: null, unit: "шт", stock: "10", aliases, sold_count: 0 });
const products = [
  product("lamp9", "Лампа LED 9W Horoz", ["лампочка 9 ватт"]),
  product("lamp12", "Лампа LED 12W Horoz"),
  product("cable15", "Кабель ВВГ 3х1.5"),
  product("cable25", "Кабель ВВГ 3х2.5"),
  product("socket", "Розетка двойная Horoz"),
  product("ёлка", "Гирлянда ёлочная 5м"),
];

test("plainName ignores case, ё and extra spaces — like private.plain_name", () => {
  assert.equal(plainName("  Лампа   LED 9W "), "лампа led 9w");
  assert.equal(plainName("Ёлочная"), "елочная");
});

test("exactProduct: the name or a learned alias, nothing else", () => {
  assert.equal(exactProduct("лампа  led 9w horoz", products)?.id, "lamp9");
  assert.equal(exactProduct("Лампочка 9 ватт", products)?.id, "lamp9");
  assert.equal(exactProduct("Гирлянда елочная 5м", products)?.id, "ёлка");
  assert.equal(exactProduct("Лампа LED 9W", products), null);
  assert.equal(exactProduct("  ", products), null);
});

test("suggestProduct: same product written differently", () => {
  assert.equal(suggestProduct("Лампа LED 9W", products)?.id, "lamp9");
  assert.equal(suggestProduct("Лампочка 9W Хороз", products)?.id, "lamp9");
  assert.equal(suggestProduct("Кабел ВВГ 3*1,5", products)?.id, "cable15");
  assert.equal(suggestProduct("кабель ввг 3x2.5мм", products)?.id, "cable25");
  assert.equal(suggestProduct("Розетка двойн. Хороз", products)?.id, "socket");
  // «2-ная» — число, которого нет у товара: не предлагаем, лучше спросить.
  assert.equal(suggestProduct("Розетка 2-ная Horoz", products), null);
});

test("suggestProduct: other numbers are another product, unrelated names get nothing", () => {
  assert.equal(suggestProduct("Лампа LED 10W Horoz", products), null);
  assert.equal(suggestProduct("Кабель ВВГ 3х4", products), null);
  assert.equal(suggestProduct("Доставка", products), null);
  assert.equal(suggestProduct("Выключатель Horoz", products), null);
  assert.equal(suggestProduct("", products), null);
});
