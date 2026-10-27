import { test } from "node:test";
import assert from "node:assert/strict";
import { collateralText, daysWord, dueDay, extraCharge, overdueDays, rentalTotal, unpaidOf } from "../src/lib/rentals.ts";

test("rentalTotal: prices per day of all things times days", () => {
  assert.equal(rentalTotal([1000, 400], 2), 2800);
  assert.equal(rentalTotal([333.33], 3), 999.99);
  assert.equal(rentalTotal([], 5), 0);
});

test("dueDay and overdueDays: across month ends, nothing before the due day", () => {
  assert.equal(dueDay("2026-10-30", 3), "2026-11-02");
  assert.equal(overdueDays("2026-10-28", "2026-10-28"), 0);
  assert.equal(overdueDays("2026-10-28", "2026-10-27"), 0);
  assert.equal(overdueDays("2026-10-28", "2026-11-01"), 4);
});

test("extraCharge: late days at the same price per day, nothing when on time", () => {
  assert.equal(extraCharge([1000, 400], 2), 2800);
  assert.equal(extraCharge([1000], 0), 0);
});

test("collateralText and daysWord read naturally", () => {
  assert.equal(collateralText("passport", "Медина"), "Паспорт · Медина");
  assert.equal(collateralText("license", null), "Права");
  assert.equal(collateralText("none", null), null);
  assert.deepEqual([1, 2, 5, 11, 21, 22].map(daysWord), ["1 день", "2 дня", "5 дней", "11 дней", "21 день", "22 дня"]);
});

test("unpaidOf: money pays the oldest debt first, the newest sales stay unpaid", () => {
  // Долг магазина 200 (старый), прокат 100 (новый): долг 300.
  const sales = [{ id: "rental", total: 100 }, { id: "shop", total: 200 }];
  assert.equal(unpaidOf("rental", 300, sales), 100);
  // Принёс 200 — старый закрыт, прокат ещё нет.
  assert.equal(unpaidOf("rental", 100, sales), 100);
  assert.equal(unpaidOf("shop", 100, sales), 0);
  // Принёс 250 — от проката осталось 50.
  assert.equal(unpaidOf("rental", 50, sales), 50);
  // Всё отдал или переплатил — оплачено.
  assert.equal(unpaidOf("rental", 0, sales), 0);
  assert.equal(unpaidOf("rental", -30, sales), 0);
  assert.equal(unpaidOf("missing", 300, sales), 0);
});
