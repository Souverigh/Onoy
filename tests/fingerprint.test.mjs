import { test } from "node:test";
import assert from "node:assert/strict";
import { contentFingerprint } from "../src/lib/adre/fingerprint.ts";

function invoice(lines, total) {
  return {
    document_type: "invoice_out",
    counterparty: { name_raw: "Маликнур", phone: null, confidence: 0.9 },
    date: null,
    number: null,
    lines: lines.map(([name_raw, qty, price], i) => ({
      n: i + 1,
      name_raw,
      qty,
      unit: "шт",
      price,
      sum: String(Number(qty) * Number(price)),
      confidence: 0.9,
    })),
    total_declared: null,
    total_computed: total,
    currency: "KGS",
    warnings: [],
  };
}

test("contentFingerprint ignores spelling noise and line order of the same invoice", () => {
  const first = invoice(
    [
      ["Щит - 4", "4", "240.00"],
      ["Хомуты 150", "10", "60"],
    ],
    1560,
  );
  const rephotographed = invoice(
    [
      ["хомуты  150", "10.000", "60.00"],
      ["ЩИТ-4", "4", "240"],
    ],
    1560,
  );
  assert.match(contentFingerprint(first), /^[0-9a-f]{64}$/);
  assert.equal(contentFingerprint(rephotographed), contentFingerprint(first));
});

test("contentFingerprint differs when quantity, price or total differs", () => {
  const base = contentFingerprint(invoice([["Щит - 4", "4", "240"]], 960));
  assert.notEqual(contentFingerprint(invoice([["Щит - 4", "5", "240"]], 1200)), base);
  assert.notEqual(contentFingerprint(invoice([["Щит - 4", "4", "250"]], 1000)), base);
  assert.notEqual(contentFingerprint(invoice([["Щит - 8", "4", "240"]], 960)), base);
});

test("contentFingerprint is null for an invoice without readable lines", () => {
  assert.equal(contentFingerprint(invoice([], 0)), null);
  assert.equal(contentFingerprint(invoice([["", "1", "10"]], 10)), null);
});
