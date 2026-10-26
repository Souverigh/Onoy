import { test } from "node:test";
import assert from "node:assert/strict";
import { CHANGELOG, newestNews, newsFor, unreadNews } from "../src/lib/changelog.ts";
import { MODULE_IDS } from "../src/lib/business.ts";

test("changelog: newest first, numbers unique and growing, real dates and modules", () => {
  const numbers = CHANGELOG.map((e) => e.n);
  assert.deepEqual(numbers, [...numbers].sort((a, b) => b - a), "newest entry on top");
  assert.equal(new Set(numbers).size, numbers.length, "numbers are unique");
  for (const e of CHANGELOG) {
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!Number.isNaN(Date.parse(e.date)), e.date);
    assert.ok(e.title && e.text, `entry ${e.n} has a title and a text`);
    if (e.module) assert.ok(MODULE_IDS.includes(e.module), `entry ${e.n}: unknown module ${e.module}`);
    if (e.link) assert.match(e.link.href, /^\//);
  }
  const dates = CHANGELOG.map((e) => e.date);
  assert.deepEqual(dates, [...dates].sort().reverse(), "dates go down with the numbers");
});

const entries = [
  { n: 3, date: "2026-10-26", title: "c", text: "c", module: "variants" },
  { n: 2, date: "2026-10-20", title: "b", text: "b", ownerOnly: true },
  { n: 1, date: "2026-09-01", title: "a", text: "a" },
];

test("changelog: a seller and a shop without the module do not see what is not theirs", () => {
  assert.deepEqual(newsFor(entries, true, ["stock", "catalog", "variants"]).map((e) => e.n), [3, 2, 1]);
  assert.deepEqual(newsFor(entries, false, ["stock", "catalog", "variants"]).map((e) => e.n), [3, 1]);
  assert.deepEqual(newsFor(entries, true, ["stock", "catalog"]).map((e) => e.n), [2, 1]);
});

test("changelog: unread is newer than what was seen; first time only fresh news, not older than the shop", () => {
  assert.deepEqual(unreadNews(entries, 2, "2026-10-26", null).map((e) => e.n), [3]);
  assert.deepEqual(unreadNews(entries, 3, "2026-10-26", null), []);
  // Не видел ничего: только за 14 дней.
  assert.deepEqual(unreadNews(entries, null, "2026-10-26", "2026-01-01T00:00:00Z").map((e) => e.n), [3, 2]);
  // Магазин открыт 22.10 — новости до этого ему не новость.
  assert.deepEqual(unreadNews(entries, null, "2026-10-26", "2026-10-22T08:00:00Z").map((e) => e.n), [3]);
  // Магазин открыт сегодня — окна нет.
  assert.deepEqual(unreadNews(entries, null, "2026-10-26", "2026-10-26T08:00:00Z"), []);
  assert.equal(newestNews(entries), 3);
  assert.equal(newestNews([]), 0);
});
