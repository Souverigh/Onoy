import { test } from "node:test";
import assert from "node:assert/strict";
import { bishkekNow, isoDate, isoTime, maskDate, maskTime, ruDate } from "../src/lib/ru-date.ts";

test("ru-date: dd.mm.yyyy <-> ISO, only real dates", () => {
  assert.equal(ruDate("2026-09-28"), "28.09.2026");
  assert.equal(ruDate("2026-09-28T14:35"), "28.09.2026");
  assert.equal(isoDate("28.09.2026"), "2026-09-28");
  assert.equal(isoDate("31.02.2026"), null);
  assert.equal(isoDate("28.9.2026"), null);
  assert.equal(isoTime("9:05"), "09:05");
  assert.equal(isoTime("24:00"), null);
  assert.equal(isoTime("14:60"), null);
});

test("ru-date: typing masks and Bishkek now", () => {
  assert.equal(maskDate("28092026"), "28.09.2026");
  assert.equal(maskDate("2809"), "28.09");
  assert.equal(maskDate("28.09.20261"), "28.09.2026");
  assert.equal(maskTime("1435"), "14:35");
  assert.equal(maskTime("14"), "14");
  // 20:30 UTC = 02:30 следующего дня в Бишкеке.
  assert.equal(bishkekNow(Date.UTC(2026, 8, 28, 20, 30)), "2026-09-29T02:30");
});
