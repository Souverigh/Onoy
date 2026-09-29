import { test } from "node:test";
import assert from "node:assert/strict";
import { expenseDateInput, expensesByCategory, expenseCategoryLabel } from "../src/lib/expenses.ts";

test("expenseDateInput: today and past days within a year, not future or garbage", () => {
  assert.equal(expenseDateInput("2026-09-28", "2026-09-28"), "2026-09-28");
  assert.equal(expenseDateInput(" 2026-09-01 ", "2026-09-28"), "2026-09-01");
  assert.equal(expenseDateInput("2026-09-29", "2026-09-28"), null);
  assert.equal(expenseDateInput("2025-09-27", "2026-09-28"), "2025-09-27");
  assert.equal(expenseDateInput("2025-09-26", "2026-09-28"), null);
  assert.equal(expenseDateInput("2026-02-30", "2026-09-28"), null);
  assert.equal(expenseDateInput("28.09.2026", "2026-09-28"), null);
  assert.equal(expenseDateInput("", "2026-09-28"), null);
});

test("expensesByCategory: exact sums, largest first", () => {
  assert.deepEqual(
    expensesByCategory([
      { category: "food", amount: "0.10" },
      { category: "rent", amount: "15000.00" },
      { category: "food", amount: "0.20" },
    ]),
    [
      { category: "rent", amount: 15000 },
      { category: "food", amount: 0.3 },
    ],
  );
  assert.equal(expenseCategoryLabel("rent"), "Аренда");
  assert.equal(expenseCategoryLabel("???"), "Расход");
});

test("normalizeExpenseResult and expenseMatches: safe values, amount within 1 som", async () => {
  const { normalizeExpenseResult, expenseMatches } = await import("../src/lib/adre/expense.ts");
  const r = normalizeExpenseResult({
    document_class: "receipt", vendor: "  АЗС Газпром ", datetime: "2026-09-27T10:15", amount: 1499.999,
    currency: "KGS", description: "Бензин", category: "fuel", confidence: 0.9,
  });
  assert.equal(r.amount, 1500);
  assert.equal(r.category, "other");
  assert.equal(r.vendor, "АЗС Газпром");
  assert.equal(expenseMatches(r, 1500.5), true);
  assert.equal(expenseMatches(r, 1600), false);
  assert.equal(expenseMatches(r, null), true);
  assert.equal(expenseMatches({ ...r, confidence: 0.3 }, 1500), false);
  assert.equal(expenseMatches({ ...r, document_class: "not_document" }, 1500), false);
  assert.equal(normalizeExpenseResult({ ...r, amount: -5 }).amount, 0);
});
