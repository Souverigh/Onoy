import type { ExpenseResult } from "./types";

const EXPENSE_CATEGORY_CODES = ["rent", "salary", "transport", "utilities", "taxes", "supplies", "food", "other"];

/** Ответ модели → безопасные значения: сумма ≥ 0 с копейками, известная категория. */
export function normalizeExpenseResult(result: ExpenseResult): ExpenseResult {
  const amount = Math.round(Number(result.amount) * 100) / 100;
  return {
    ...result,
    amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
    category: EXPENSE_CATEGORY_CODES.includes(result.category) ? result.category : "other",
    vendor: result.vendor ? String(result.vendor).trim().slice(0, 160) || null : null,
    description: result.description ? String(result.description).trim().slice(0, 200) || null : null,
    confidence: Number(result.confidence) || 0,
  };
}

/** Распознанный чек сходится с записью расхода — сумма в пределах 1 сома. */
export function expenseMatches(result: ExpenseResult, declared: number | null) {
  if (result.document_class === "not_document" || result.confidence < 0.6 || !(result.amount > 0)) return false;
  return declared === null || Math.abs(result.amount - declared) <= 1;
}
