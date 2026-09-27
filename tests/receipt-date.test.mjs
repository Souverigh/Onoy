import { test } from "node:test";
import assert from "node:assert/strict";
import { receiptDateTime, bishkekDateTime } from "../src/lib/receipt-date.ts";

test("receiptDateTime reads the formats a bank receipt shows", () => {
  assert.equal(receiptDateTime("26.09.2026 14:35"), "2026-09-26T14:35");
  assert.equal(receiptDateTime("26.09.2026, 14:35:10"), "2026-09-26T14:35");
  assert.equal(receiptDateTime("6.9.26 9:05"), "2026-09-06T09:05");
  assert.equal(receiptDateTime("26.09.2026"), "2026-09-26T00:00");
  assert.equal(receiptDateTime("2026-09-26 14:35:10"), "2026-09-26T14:35");
  assert.equal(receiptDateTime("2026-09-26T14:35"), "2026-09-26T14:35");
});

test("receiptDateTime converts a zoned ISO time to Bishkek", () => {
  assert.equal(receiptDateTime("2026-09-26T20:30:00Z"), "2026-09-27T02:30");
  assert.equal(receiptDateTime("2026-09-26T14:35:00+06:00"), "2026-09-26T14:35");
});

test("receiptDateTime rejects garbage and impossible dates", () => {
  for (const raw of [null, "", "вчера", "31.02.2026 10:00", "26.09.2026 25:00", "2026-13-01"])
    assert.equal(receiptDateTime(raw), null, String(raw));
});

test("bishkekDateTime adds the +06:00 zone and validates the input", () => {
  assert.equal(bishkekDateTime("2026-09-26T14:35"), "2026-09-26T14:35:00+06:00");
  assert.equal(bishkekDateTime("2026-02-30T10:00"), null);
  assert.equal(bishkekDateTime("26.09.2026"), null);
});
