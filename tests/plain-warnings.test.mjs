import { test } from "node:test";
import assert from "node:assert/strict";
import { FALLBACK_WARNING, plainWarnings } from "../src/lib/plain-warnings.ts";

test("recognition warnings: Russian kept, English replaced by one plain message", () => {
  assert.deepEqual(plainWarnings(["Год в дате неясен: 28.03.26 или 28.03.2026."]), [
    "Год в дате неясен: 28.03.26 или 28.03.2026.",
  ]);
  assert.deepEqual(
    plainWarnings(["Year in header date is ambiguous", "Row 3 is crossed out", "", null]),
    [FALLBACK_WARNING],
  );
  assert.deepEqual(plainWarnings(["Сумма у  Асана неразборчива", "Сумма у Асана неразборчива"]), [
    "Сумма у Асана неразборчива",
  ]);
  assert.deepEqual(plainWarnings([]), []);
});
