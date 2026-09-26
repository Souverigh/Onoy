import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeInvoiceResult } from "../src/lib/adre/normalize.ts";

function invoiceWith(lines) {
  return {
    document_type: "invoice_in",
    counterparty: { name_raw: "Тест", phone: null, confidence: 0.9 },
    date: null,
    number: null,
    lines,
    total_declared: null,
    total_computed: 0,
    currency: "KGS",
    warnings: [],
  };
}

test("normalizeInvoiceResult converts comma decimals to dot so qty*price can be checked", () => {
  const result = normalizeInvoiceResult(
    invoiceWith([
      { n: 1, name_raw: "Щит-4", qty: "4,000", unit: "шт", price: "240,00", sum: "960,00", confidence: 0.9 },
    ]),
  );
  const line = result.lines[0];
  assert.equal(line.qty, "4.000");
  assert.equal(line.price, "240.00");
  assert.equal(line.sum, "960.00");
  assert.equal(Number(line.qty) * Number(line.price), Number(line.sum));
});

test("normalizeInvoiceResult unifies unit spelling variants to the canonical set", () => {
  const result = normalizeInvoiceResult(
    invoiceWith([
      { n: 1, name_raw: "a", qty: "1", unit: "Штук", price: "1", sum: "1", confidence: 1 },
      { n: 2, name_raw: "b", qty: "1", unit: "кг.", price: "1", sum: "1", confidence: 1 },
      { n: 3, name_raw: "c", qty: "1", unit: "Упаковка", price: "1", sum: "1", confidence: 1 },
      { n: 4, name_raw: "d", qty: "1", unit: "коробка", price: "1", sum: "1", confidence: 1 },
    ]),
  );
  assert.deepEqual(
    result.lines.map((l) => l.unit),
    ["шт", "кг", "упак", "коробка"],
  );
});

test("normalizeInvoiceResult trims and collapses whitespace in names", () => {
  const result = normalizeInvoiceResult(
    invoiceWith([
      { n: 1, name_raw: "  Кабель   ВВГ  ", qty: "1", unit: "м", price: "1", sum: "1", confidence: 1 },
    ]),
  );
  assert.equal(result.lines[0].name_raw, "Кабель ВВГ");
});
