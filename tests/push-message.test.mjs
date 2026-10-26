import { test } from "node:test";
import assert from "node:assert/strict";
import { pushMessage } from "../src/lib/push-message.ts";
import { money } from "../src/lib/format.ts";

test("push: a new order says who, how many goods and how much, and opens the order", () => {
  const m = pushMessage({ kind: "order", name: "Айгуль", total: "4500.00", lines: 3, currency: "KGS" }, "o-1", money);
  assert.equal(m.title, "Новый заказ из каталога");
  assert.match(m.body, /^Айгуль · 3 товара · 4\s500 сом$/);
  assert.equal(m.url, "/orders/o-1");
  assert.equal(m.tag, "order-o-1");
  assert.match(pushMessage({ kind: "order", name: " ", total: "100", lines: 11, currency: "KGS" }, "x", money).body, /^Клиент · 11 товаров/);
});

test("push: a client's «I paid» goes to the claims to confirm", () => {
  const m = pushMessage({ kind: "claim", name: "Асан", amount: "2000.00", currency: "KGS" }, "p-1", money);
  assert.equal(m.title, "Клиент оплатил - подтвердите");
  assert.match(m.body, /^Асан: 2\s000 сом$/);
  assert.equal(m.url, "/claims");
});
