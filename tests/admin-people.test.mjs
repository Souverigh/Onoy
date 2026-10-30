import { test } from "node:test";
import assert from "node:assert/strict";
import { actionLabel, agoText, extendPaidUntil, stageOf, whenText } from "../src/lib/admin-people.ts";

const shop = (over = {}) => ({
  kind: "shop",
  email_confirmed_at: "2026-10-01T00:00:00Z",
  records_7d: 0,
  first_record_at: null,
  trial: false,
  ...over,
});

test("stageOf: from what blocks work (email, block, payment) to activity", () => {
  assert.equal(stageOf({ kind: "account", email_confirmed_at: null }, null).key, "unconfirmed");
  assert.equal(stageOf({ kind: "account", email_confirmed_at: "2026-10-27T02:20:00Z" }, null).key, "no_shop");
  assert.equal(stageOf(shop(), { kind: "blocked", reason: "спам" }).key, "blocked");
  assert.deepEqual(stageOf(shop(), { kind: "expired", paidUntil: "2026-10-01" }), { key: "unpaid", note: "только просмотр" });
  assert.equal(stageOf(shop({ records_7d: 9 }), { kind: "grace", paidUntil: "2026-10-20", graceUntil: "2026-10-27" }).key, "unpaid");
  assert.deepEqual(stageOf(shop({ trial: true }), { kind: "ending", paidUntil: "2026-11-01", daysLeft: 3 }), {
    key: "ending",
    note: "пробный кончается через 3 дн.",
  });
  assert.equal(stageOf(shop({ records_7d: 3, trial: true }), { kind: "ok" }).key, "active");
  assert.deepEqual(stageOf(shop({ trial: true }), { kind: "ok" }), { key: "trial", note: "ни одной записи" });
  assert.deepEqual(stageOf(shop({ first_record_at: "2026-10-02T00:00:00Z" }), { kind: "ok" }), {
    key: "quiet",
    note: "7+ дней без записей",
  });
  assert.deepEqual(stageOf(shop({ records_7d: 1, first_record_at: "2026-10-02T00:00:00Z" }), { kind: "ok" }), {
    key: "active",
    note: "мало записей",
  });
});

test("actionLabel: known actions, prefixes, fallback", () => {
  assert.equal(actionLabel("sale.posted"), "продажа");
  assert.equal(actionLabel("payment.claim_confirmed"), "заявка «Я оплатил»");
  assert.equal(actionLabel("product.photo_set"), "товары");
  assert.equal(actionLabel("auth.login"), "вход");
  assert.equal(actionLabel("something.new"), "действие");
});

test("whenText and agoText use Bishkek time (UTC+6)", () => {
  const now = new Date("2026-10-29T08:44:00Z"); // 14:44 в Бишкеке
  assert.equal(whenText("2026-10-29T08:32:00Z", now), "сегодня, 14:32");
  assert.equal(whenText("2026-10-28T13:05:00Z", now), "вчера, 19:05");
  assert.equal(whenText("2026-10-22T05:47:00Z", now), "22 окт, 11:47");
  assert.equal(whenText("2026-10-28T19:00:00Z", now), "сегодня, 01:00"); // после полуночи по Бишкеку
  assert.equal(agoText("2026-10-29T08:32:00Z", now), "12 мин назад");
  assert.equal(agoText("2026-10-29T05:00:00Z", now), "3 ч назад");
  assert.equal(agoText("2026-10-27T05:00:00Z", now), null);
});

test("extendPaidUntil counts from today or from a later paid date", () => {
  assert.equal(extendPaidUntil(null, "2026-10-29", { days: 7 }), "2026-11-05");
  assert.equal(extendPaidUntil("2026-10-01", "2026-10-29", { days: 14 }), "2026-11-12"); // прошедшая — от сегодня
  assert.equal(extendPaidUntil("2026-11-13", "2026-10-29", { months: 1 }), "2026-12-13");
  assert.equal(extendPaidUntil("2026-01-31", "2026-01-10", { months: 1 }), "2026-02-28");
  assert.equal(extendPaidUntil("2026-11-30", "2026-10-29", { months: 3 }), "2027-02-28");
});
