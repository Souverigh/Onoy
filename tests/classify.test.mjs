import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDocument, documentSides, ownNameMatcher } from "../src/lib/adre/classify.ts";
import { similarity } from "../src/lib/match.ts";

const isOwn = ownNameMatcher(["Маликнур", "D MALIKNUR SATAROV", "СКЛАД №1 JLD HOROZ ELECTRIC"], similarity);
const invoice = (seller, buyer, extra = {}) => ({
  document_class: "invoice",
  seller: seller == null ? null : { name_raw: seller, phone: null },
  buyer: buyer == null ? null : { name_raw: buyer, phone: null },
  lines: [],
  total_declared: null,
  total_computed: 0,
  currency: "KGS",
  warnings: [],
  date: null,
  number: null,
  ...extra,
});

test("ownNameMatcher: shop names from settings, whole or as a word inside the header", () => {
  assert.equal(isOwn("Маликнур"), true);
  assert.equal(isOwn("маликнур"), true);
  assert.equal(isOwn("ИП D Maliknur Satarov"), true);
  assert.equal(isOwn("Склад №1 JLD Horoz Electric"), true);
  assert.equal(isOwn("Медербек"), false);
  assert.equal(isOwn("HOROZ ELECTRIC KG"), false);
  assert.equal(isOwn(""), false);
  // Короткие варианты («ИП») словом не ищем — иначе совпадёт с кем угодно.
  assert.equal(ownNameMatcher(["ИП"], similarity)("ИП Асанов"), false);
});

test("documentSides: our shop is the seller → sale to the buyer, the buyer → purchase from the seller", () => {
  assert.deepEqual(documentSides(invoice("Маликнур", "Медербек"), isOwn), { direction: "out", counterparty: "Медербек" });
  assert.deepEqual(documentSides(invoice("HOROZ ELECTRIC", "D MALIKNUR SATAROV"), isOwn), {
    direction: "in",
    counterparty: "HOROZ ELECTRIC",
  });
  assert.deepEqual(documentSides(invoice("Асан", "Медербек"), isOwn), { direction: null, counterparty: null });
  assert.deepEqual(documentSides(invoice(null, null), isOwn), { direction: null, counterparty: null });
});

test("checkDocument: a supplier's invoice in the sale form suggests a purchase", () => {
  assert.deepEqual(checkDocument(invoice("HOROZ ELECTRIC", "Маликнур"), "sale", isOwn), {
    ok: false,
    reason: "direction",
    suggestedKind: "purchase",
    counterparty: "HOROZ ELECTRIC",
    fragment: false,
  });
  assert.deepEqual(checkDocument(invoice("Маликнур", "Медербек"), "purchase", isOwn), {
    ok: false,
    reason: "direction",
    suggestedKind: "sale",
    counterparty: "Медербек",
    fragment: false,
  });
  assert.deepEqual(checkDocument(invoice("HOROZ ELECTRIC", "Маликнур"), "purchase", isOwn), {
    ok: true,
    counterparty: "HOROZ ELECTRIC",
    fragment: false,
  });
});

test("checkDocument: unknown sides fall back to the form's choice, never to our own name", () => {
  // Покупатель не написан, продавец — наш магазин: продажа, контрагента нет.
  assert.deepEqual(checkDocument(invoice("Маликнур", null), "sale", isOwn), {
    ok: true,
    counterparty: null,
    fragment: false,
  });
  assert.deepEqual(checkDocument(invoice("Асан", "Медербек"), "sale", isOwn), {
    ok: true,
    counterparty: "Медербек",
    fragment: false,
  });
  assert.deepEqual(checkDocument(invoice("Асан", "Медербек"), "purchase", isOwn), {
    ok: true,
    counterparty: "Асан",
    fragment: false,
  });
});

test("checkDocument: not an invoice — statement, receipt, price list, notebook, no document; fragments flagged", () => {
  for (const reason of ["statement", "receipt", "price_list", "notebook", "not_document"])
    assert.deepEqual(checkDocument(invoice(null, null, { document_class: reason }), "purchase", isOwn), {
      ok: false,
      reason,
      counterparty: null,
      fragment: false,
    });
  assert.equal(checkDocument(invoice("HOROZ", "Маликнур", { fragment: true }), "purchase", isOwn).fragment, true);
});

test("checkDocument: answers before v2 (no class, no sides) stay valid invoices", () => {
  const legacy = {
    document_type: "invoice_out",
    counterparty: { name_raw: "Тимур", phone: null, confidence: 0.9 },
    lines: [],
    total_declared: null,
    total_computed: 0,
    currency: "KGS",
    warnings: [],
    date: null,
    number: null,
  };
  assert.deepEqual(checkDocument(legacy, "purchase", isOwn), { ok: true, counterparty: "Тимур", fragment: false });
});
