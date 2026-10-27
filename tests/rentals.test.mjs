import { test } from "node:test";
import assert from "node:assert/strict";
import { collateralText, daysWord, dueDay, extraCharge, overdueDays, rentalTotal } from "../src/lib/rentals.ts";

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
