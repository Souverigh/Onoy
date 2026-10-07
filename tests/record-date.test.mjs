import { test } from "node:test";
import assert from "node:assert/strict";
import { recordDateTime } from "../src/lib/record-date.ts";

test("record date: past day → noon in Bishkek, today or empty → now, future or junk → invalid", () => {
  assert.equal(recordDateTime("2026-10-05", "2026-10-06"), "2026-10-05T06:00:00.000Z");
  assert.equal(recordDateTime("", "2026-10-06"), null);
  assert.equal(recordDateTime("2026-10-06", "2026-10-06"), null);
  assert.equal(recordDateTime("2026-10-07", "2026-10-06"), "invalid");
  assert.equal(recordDateTime("2026-02-31", "2026-10-06"), "invalid");
  assert.equal(recordDateTime("05.10.2026", "2026-10-06"), "invalid");
});
