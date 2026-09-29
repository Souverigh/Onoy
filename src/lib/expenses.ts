/**
 * Расходы магазина (аренда, зарплата, доставка…). Долги не меняют; в Итоге
 * дня уменьшают деньги за день. Коды категорий — как в check таблицы
 * expenses (миграция 29).
 */
export const EXPENSE_CATEGORIES = {
  rent: "Аренда",
  salary: "Зарплата",
  transport: "Доставка и транспорт",
  utilities: "Свет, вода, связь",
  taxes: "Налоги и сборы",
  supplies: "Хозяйственные нужды",
  food: "Еда, чай",
  other: "Прочее",
} as const;

export type ExpenseCategory = keyof typeof EXPENSE_CATEGORIES;

export const isExpenseCategory = (value: unknown): value is ExpenseCategory =>
  typeof value === "string" && value in EXPENSE_CATEGORIES;

export const expenseCategoryLabel = (value: string) =>
  isExpenseCategory(value) ? EXPENSE_CATEGORIES[value] : "Расход";

/** Не старше года — как в commit_expense. */
export const EXPENSE_MAX_AGE_DAYS = 366;

/**
 * День расхода из <input type="date"> ("2026-09-28"): не в будущем и не
 * старше года (по Бишкеку, `today` — сегодняшняя дата). Иначе null.
 */
export function expenseDateInput(value: string, today: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const probe = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (probe.getUTCFullYear() !== +m[1] || probe.getUTCMonth() !== +m[2] - 1 || probe.getUTCDate() !== +m[3])
    return null;
  const day = value.trim();
  if (day > today) return null;
  const oldest = new Date(Date.parse(`${today}T00:00:00Z`) - EXPENSE_MAX_AGE_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);
  return day < oldest ? null : day;
}

export type ExpensePhoto = { path: string; mime: string };

/** Сумма расходов по категориям, от большей к меньшей (в тийынах — без ошибок float). */
export function expensesByCategory(rows: { category: string; amount: string | number }[]) {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.category, (totals.get(r.category) ?? 0) + Math.round(Number(r.amount) * 100));
  return [...totals.entries()]
    .map(([category, cents]) => ({ category, amount: cents / 100 }))
    .sort((a, b) => b.amount - a.amount);
}
