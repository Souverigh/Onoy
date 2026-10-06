import { test } from "node:test";
import assert from "node:assert/strict";
import { notebookDate } from "../src/lib/notebook-date.ts";

test("notebook debt date: day and month as written, year guessed", () => {
  assert.equal(notebookDate("15.09", "2026-10-05"), "2026-09-15");
  assert.equal(notebookDate("15.11", "2026-10-05"), "2025-11-15"); // в будущем — прошлый год
  assert.equal(notebookDate("15.09.26", "2026-10-05"), "2026-09-15");
  assert.equal(notebookDate("3/9/2026", "2026-10-05"), "2026-09-03");
  assert.equal(notebookDate("31.02", "2026-10-05"), "");
  assert.equal(notebookDate("01.12.2026", "2026-10-05"), ""); // будущее с годом — не дата долга
  assert.equal(notebookDate(null, "2026-10-05"), "");
  assert.equal(notebookDate("в долг", "2026-10-05"), "");
});
