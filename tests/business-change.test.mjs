import { test } from "node:test";
import assert from "node:assert/strict";
import { businessChangeWarnings } from "../src/lib/business.ts";

const quiet = { rentalsOut: 0, deposits: null, catalogOpen: false, openOrders: 0 };

test("business change: nothing to warn about when nothing changes", () => {
  const same = { type: "shop", modules: ["stock", "catalog"] };
  assert.deepEqual(businessChangeWarnings(same, same, quiet), []);
});

test("business change: switching rental off says what is still out and keeps the reminder", () => {
  const from = { type: "clothing_rental", modules: ["stock", "catalog", "variants", "rental"] };
  const to = { type: "clothing_rental", modules: ["stock", "catalog", "variants"] };
  const warnings = businessChangeWarnings(from, to, { ...quiet, rentalsOut: 3, deposits: "4 000 сом" });
  assert.match(warnings[0], /на руках 3 шт\., залоги 4 000 сом/);
  assert.match(warnings.join(" "), /Главная кнопка внизу станет «Продажа» вместо «Выдать»/);
});

test("business change: switching the catalog off warns that the link closes and orders wait", () => {
  const from = { type: "shop", modules: ["stock", "catalog"] };
  const to = { type: "shop", modules: ["stock"] };
  assert.match(businessChangeWarnings(from, to, { ...quiet, catalogOpen: true, openOrders: 2 })[0], /ссылку на каталог закроем.*Не обработано заказов: 2/);
  assert.equal(businessChangeWarnings(from, to, quiet)[0], "Скроются «Каталог» и «Заказы».");
});

test("business change: a new type with the same sections still says it changes the look", () => {
  const warnings = businessChangeWarnings({ type: "shop", modules: ["stock", "catalog"] }, { type: "grocery", modules: ["stock", "catalog"] }, quiet);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Продуктовый магазин/);
});
