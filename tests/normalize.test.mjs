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

test("normalizeInvoiceResult computes total_computed from qty*price instead of trusting the model", () => {
  const result = normalizeInvoiceResult({
    ...invoiceWith([
      { n: 1, name_raw: "a", qty: "3", unit: "шт", price: "0,1", sum: "0.3", confidence: 1 },
      { n: 2, name_raw: "b", qty: "4", unit: "шт", price: "240", sum: "999", confidence: 1 },
      { n: 3, name_raw: "c", qty: "", unit: "шт", price: "", sum: "50", confidence: 0.5 },
    ]),
    total_computed: 12345,
  });
  assert.equal(result.total_computed, 0.3 + 960 + 50);
});

test("normalizeInvoiceResult keeps model total when there are no lines", () => {
  const result = normalizeInvoiceResult({ ...invoiceWith([]), total_computed: 500 });
  assert.equal(result.total_computed, 500);
});

test("normalizeInvoiceResult restores abbreviated names from the line above", () => {
  const names = (raw) =>
    normalizeInvoiceResult(
      invoiceWith(raw.map((name_raw, i) => ({ n: i + 1, name_raw, qty: "1", unit: "шт", price: "1", sum: "1", confidence: 1 }))),
    ).lines.map((l) => l.name_raw);
  assert.deepEqual(names(["Щит - 4", "-8", "- 12", "Огнетушитель АВТ", "Хомуты 150", "200", "〃 250"]), [
    "Щит - 4",
    "Щит - 8",
    "Щит - 12",
    "Огнетушитель АВТ",
    "Хомуты 150",
    "Хомуты 200",
    "Хомуты 250",
  ]);
  assert.deepEqual(names(["Колодка ок 3й", "2й", "4й", "Удлинитель 3/3", "3/5"]), [
    "Колодка ок 3й",
    "Колодка ок 2й",
    "Колодка ок 4й",
    "Удлинитель 3/3",
    "Удлинитель 3/5",
  ]);
  // Уже полные названия и строка без группы выше не меняются.
  assert.deepEqual(names(["-5", "Щит - 8", "Щит - 12", "-//-", '"', '"Кнауф" гипс']), [
    "-5",
    "Щит - 8",
    "Щит - 12",
    "Щит",
    "Щит",
    '"Кнауф" гипс',
  ]);
});
