import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileInvoice } from "../src/lib/adre/reconcile.ts";
import { normalizeInvoiceResult } from "../src/lib/adre/normalize.ts";

const line = (n, name_raw, qty, price, sum) => ({ n, name_raw, qty, unit: "шт", price, sum, confidence: 1 });
const invoice = (lines, total_declared) =>
  normalizeInvoiceResult({
    document_type: "invoice_out",
    counterparty: { name_raw: "Тест", phone: null, confidence: 1 },
    date: null,
    number: null,
    lines,
    total_declared,
    total_computed: 0,
    currency: "KGS",
    warnings: [],
  });

// Накладная из ТЗ-скриншота: 850 + 600 + 0 − 200 = 1250, на бумаге «Итого: 1250».
const discountLines = [
  line(1, "Розетка", "10", "85", "850"),
  line(2, "Автомат", "5", "120", "600"),
  line(3, "Изолента", "2", "0", "0"),
  line(4, "Скидка", "", "", "-200"),
];

test("reconcileInvoice: all three sums agree → ok", () => {
  const r = reconcileInvoice(invoice(discountLines, 1250), 1250);
  assert.equal(r.computed, 1250);
  assert.equal(r.paper, 1250);
  assert.deepEqual(r.badLines, []);
  assert.equal(r.ok, true);
});

test("reconcileInvoice: a missed line — seller typed the lines' sum, only the paper total catches it", () => {
  const missed = discountLines.filter((l) => l.n !== 2); // модель пропустила «Автомат» (600)
  const r = reconcileInvoice(invoice(missed, 1250), 650);
  assert.equal(r.computed, 650);
  assert.equal(r.enteredMismatch, false);
  assert.equal(r.paperMismatch, true);
  assert.equal(r.ok, false);
});

test("reconcileInvoice: arithmetic slip on paper and a bad line are reported", () => {
  const r = reconcileInvoice(invoice([line(1, "Щит", "4", "240", "900")], 1000), 960);
  assert.deepEqual(r.badLines, [1]); // 4×240 = 960, а на бумаге 900
  assert.equal(r.paperMismatch, true); // строки 960, итог на бумаге 1000
  assert.equal(r.enteredMismatch, false);
});

test("reconcileInvoice: no paper total → checked as before; within 1 som tolerance is fine", () => {
  assert.equal(reconcileInvoice(invoice(discountLines, null), 1250).ok, true);
  assert.equal(reconcileInvoice(invoice(discountLines, 0), 1250).paper, null);
  assert.equal(reconcileInvoice(invoice(discountLines, 1251), 1250.5).ok, true);
  assert.equal(reconcileInvoice(invoice(discountLines, 1250), 1300).enteredMismatch, true);
  assert.equal(reconcileInvoice(invoice(discountLines, 1250), null).ok, true);
});
