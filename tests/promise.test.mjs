import { test } from "node:test";
import assert from "node:assert/strict";
import { promiseStatus, overdueThreshold, promisedDateInput } from "../src/lib/promise.ts";

test("promiseStatus: upcoming, due today, broken, and nothing without debt", () => {
  assert.deepEqual(promiseStatus("2026-10-05", 1000, "2026-09-27"), {
    kind: "upcoming",
    date: "2026-10-05",
    daysLeft: 8,
  });
  assert.deepEqual(promiseStatus("2026-09-27", 1000, "2026-09-27"), {
    kind: "upcoming",
    date: "2026-09-27",
    daysLeft: 0,
  });
  assert.deepEqual(promiseStatus("2026-09-20", 1000, "2026-09-27"), {
    kind: "broken",
    date: "2026-09-20",
    daysLate: 7,
  });
  assert.deepEqual(promiseStatus("2026-09-20", 0, "2026-09-27"), { kind: "none" });
  assert.deepEqual(promiseStatus(null, 1000, "2026-09-27"), { kind: "none" });
});

test("overdueThreshold accepts only 30, 60 and 90", () => {
  assert.equal(overdueThreshold("30"), 30);
  assert.equal(overdueThreshold("90"), 90);
  assert.equal(overdueThreshold("45"), null);
  assert.equal(overdueThreshold(undefined), null);
});

test("promisedDateInput: empty clears, past and far-future dates are rejected", () => {
  assert.equal(promisedDateInput("", "2026-09-27"), null);
  assert.equal(promisedDateInput("2026-09-27", "2026-09-27"), "2026-09-27");
  assert.equal(promisedDateInput("2026-10-15", "2026-09-27"), "2026-10-15");
  assert.equal(promisedDateInput("2026-09-26", "2026-09-27"), undefined);
  assert.equal(promisedDateInput("2028-01-01", "2026-09-27"), undefined);
  assert.equal(promisedDateInput("2026-02-30", "2026-01-27"), undefined);
  assert.equal(promisedDateInput("27.09.2026", "2026-09-27"), undefined);
});
