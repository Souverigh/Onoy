/**
 * Обещанная дата оплаты и просрочка (ТЗ §3). Даты — строки YYYY-MM-DD по
 * Бишкеку. Без server-only: используется и в тестах.
 */
export type PromiseStatus =
  | { kind: "none" }
  | { kind: "upcoming"; date: string; daysLeft: number }
  | { kind: "broken"; date: string; daysLate: number };

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86400000;

/** Обещание имеет смысл, только пока есть долг. */
export function promiseStatus(promised: string | null | undefined, balance: number, today: string): PromiseStatus {
  if (!promised || !(balance > 0)) return { kind: "none" };
  const diff = dayNumber(promised) - dayNumber(today);
  return diff >= 0
    ? { kind: "upcoming", date: promised, daysLeft: diff }
    : { kind: "broken", date: promised, daysLate: -diff };
}

/** Пороги списков «Просрочено 30 / 60 / 90». */
export const OVERDUE_THRESHOLDS = [30, 60, 90] as const;
export type OverdueThreshold = (typeof OVERDUE_THRESHOLDS)[number];

export function overdueThreshold(raw: string | undefined): OverdueThreshold | null {
  const n = Number(raw);
  return (OVERDUE_THRESHOLDS as readonly number[]).includes(n) ? (n as OverdueThreshold) : null;
}

/** Обещанную дату можно поставить на сегодня и до года вперёд; пусто — убрать. */
export function promisedDateInput(raw: string, today: string): string | null | undefined {
  const value = raw.trim();
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(dayNumber(value))) return undefined;
  if (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) return undefined;
  const diff = dayNumber(value) - dayNumber(today);
  return diff >= 0 && diff <= 366 ? value : undefined;
}

/** «5 октября» — для подписей и текста напоминания. */
export function dayMonth(date: string): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "numeric", month: "long" }).format(
    new Date(`${date}T12:00:00+06:00`),
  );
}
