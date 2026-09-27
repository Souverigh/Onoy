import { test } from "node:test";
import assert from "node:assert/strict";
import { period, change, niceMax } from "../src/lib/periods.ts";

test("period: current week runs Monday–Sunday, compared with the same weekdays last week", () => {
  const p = period("week", "2026-09-27"); // воскресенье
  assert.equal(p.start, "2026-09-21");
  assert.equal(p.end, "2026-09-27");
  assert.equal(p.through, "2026-09-27");
  assert.equal(p.days.length, 7);
  assert.deepEqual(p.previous, { start: "2026-09-14", through: "2026-09-20" });

  const wed = period("week", "2026-09-23");
  assert.equal(wed.start, "2026-09-21");
  assert.equal(wed.through, "2026-09-23");
  assert.deepEqual(wed.previous, { start: "2026-09-14", through: "2026-09-16" });
});

test("period: current month is compared with the same days of the previous month", () => {
  const p = period("month", "2026-09-27");
  assert.equal(p.start, "2026-09-01");
  assert.equal(p.end, "2026-09-30");
  assert.equal(p.through, "2026-09-27");
  assert.equal(p.days.length, 30);
  assert.deepEqual(p.previous, { start: "2026-08-01", through: "2026-08-27" });

  // 31 марта против февраля: прошлый период не выходит за свой конец.
  assert.deepEqual(period("month", "2026-03-31").previous, { start: "2026-02-01", through: "2026-02-28" });
});

test("period: past periods are whole, offsets walk back across years", () => {
  const aug = period("month", "2026-09-27", -1);
  assert.equal(aug.start, "2026-08-01");
  assert.equal(aug.through, "2026-08-31");
  assert.deepEqual(aug.previous, { start: "2026-07-01", through: "2026-07-31" });
  assert.equal(period("month", "2026-01-15", -1).start, "2025-12-01");
  assert.equal(period("week", "2026-09-27", 3).start, "2026-09-21"); // будущее не открываем
});

test("change and niceMax", () => {
  assert.equal(change(120, 100), 20);
  assert.equal(change(50, 100), -50);
  assert.equal(change(10, 0), null);
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(54270), 100000);
  assert.equal(niceMax(18000), 20000);
  assert.equal(niceMax(2100), 2500);
});
