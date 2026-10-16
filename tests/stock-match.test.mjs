import { test } from "node:test";
import assert from "node:assert/strict";
import { exactProduct, linesWithStockPrices, plainName, suggestProduct } from "../src/lib/match.ts";

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

test("linesWithStockPrices: a line without a price on the photo takes the stock sale price", () => {
  const priced = [
    { ...product("lamp9", "Лампа LED 9W Horoz"), sale_price: "150.00" },
    { ...product("free", "Подарок"), sale_price: "0.00" },
  ];
  const line = (n, name_raw, qty, price) => ({ n, name_raw, qty, unit: "шт", price, sum: "", confidence: 1 });
  const lines = [
    line(1, "лампа led 9w horoz", "3", ""), // точное совпадение, цены нет — 150
    line(2, "Лампа LED 9W Horoz", "2", "140"), // цена с фото важнее склада
    line(3, "Подарок", "1", "0"), // у товара нет цены продажи
    line(4, "Доставка", "1", ""), // не со склада
    line(5, "Лампочка девять", "2", "0"), // продавец выбрал товар сам
  ];
  const filled = linesWithStockPrices(lines, priced, { 5: "lamp9" });
  assert.deepEqual(
    filled.lines.map((l) => [l.price, l.sum]),
    [["150", "450"], ["140", ""], ["0", ""], ["", ""], ["150", "300"]],
  );
  assert.deepEqual(filled.given, { 1: { product: "lamp9", price: "150" }, 5: { product: "lamp9", price: "150" } });
  // Повтор с тем же выбором — менять нечего.
  assert.equal(linesWithStockPrices(filled.lines, priced, { 5: "lamp9" }, filled.given), null);

  // Продавец сменил товар — ставим цену нового; «Не списывать» — нашу цену снимаем.
  const more = [...priced, { ...product("lamp9b", "Лампа LED 9W Feron"), sale_price: "120" }];
  const changed = linesWithStockPrices(filled.lines, more, { 1: "lamp9b", 5: null }, filled.given);
  assert.deepEqual(changed.lines.map((l) => l.price), ["120", "140", "0", "", ""]);
  assert.deepEqual(changed.given, { 1: { product: "lamp9b", price: "120" } });
  // Цену, исправленную продавцом, при смене товара не трогаем.
  const edited = filled.lines.map((l) => (l.n === 1 ? { ...l, price: "155" } : l));
  assert.equal(linesWithStockPrices(edited, more, { 1: "lamp9b", 5: "lamp9" }, filled.given), null);

  // Подставлять нечего — null.
  assert.equal(linesWithStockPrices([lines[0]], priced, { 1: null }), null);
  assert.equal(linesWithStockPrices([lines[1], lines[3]], priced, {}), null);
});
