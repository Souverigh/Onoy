import { test } from "node:test";
import assert from "node:assert/strict";
import { differentParties, mergeInvoiceFiles } from "../src/lib/adre/files.ts";

const invoice = (number, buyer, lines, total_declared) => ({
  document_class: "invoice",
  seller: { name_raw: "Свет Маркет", phone: null },
  buyer: buyer ? { name_raw: buyer, phone: null } : null,
  date: "2026-10-27",
  number,
  lines: lines.map(([name_raw, qty, price], i) => ({
    n: i + 1,
    name_raw,
    qty,
    unit: "шт",
    price,
    sum: String(Number(qty) * Number(price)),
    confidence: 0.95,
  })),
  total_declared,
  total_computed: lines.reduce((sum, [, qty, price]) => sum + Number(qty) * Number(price), 0),
  currency: "KGS",
  warnings: [],
});

test("mergeInvoiceFiles: two PDF invoices become one record - lines in a row, totals add up, each file listed", () => {
  const merged = mergeInvoiceFiles([
    invoice("15", "Test", [["Лампа", "3", "1200"], ["Розетка", "4", "600"]], 6000),
    invoice("16", "Test", [["Кабель", "100", "180"]], 18000),
  ]);
  assert.deepEqual(merged.lines.map((l) => [l.n, l.name_raw]), [[1, "Лампа"], [2, "Розетка"], [3, "Кабель"]]);
  assert.equal(merged.total_computed, 24000);
  assert.equal(merged.total_declared, 24000);
  assert.equal(merged.number, "15, 16");
  assert.deepEqual(merged.processing.files.map((f) => [f.number, f.total]), [["15", 6000], ["16", 18000]]);
});

test("mergeInvoiceFiles: a paper total missing on one invoice - no paper total for the sum; currencies differ - a warning", () => {
  const usd = { ...invoice("2", null, [["Кабель", "10", "2"]], null), currency: "USD", warnings: ["Строка 1 неразборчива"] };
  const merged = mergeInvoiceFiles([invoice("1", "Test", [["Лампа", "1", "100"]], 100), usd]);
  assert.equal(merged.total_declared, null);
  assert.equal(merged.processing.files[1].total, 20); // по строкам, раз итога на бумаге нет
  assert.equal(merged.warnings[0], "Накладные в разных валютах - сумма сложена как есть, проверьте её.");
  assert.equal(merged.warnings[1], "Накладная 2: Строка 1 неразборчива");
});

test("differentParties: same buyer in another case or spacing is one; different buyers are named", () => {
  const files = (...buyers) => buyers.map((buyer) => ({ number: null, date: null, total: 1, currency: "KGS", seller: null, buyer }));
  assert.deepEqual(differentParties(files("Test", " test ", null), "buyer"), []);
  assert.deepEqual(differentParties(files("Test", "ТестЕржан"), "buyer"), ["Test", "ТестЕржан"]);
});
