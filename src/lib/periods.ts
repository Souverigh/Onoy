/**
 * Периоды для итогов недели и месяца (ТЗ: «итог за неделю и месяц,
 * сравнение с прошлым периодом»). Даты — YYYY-MM-DD по Бишкеку; неделя с
 * понедельника, месяц календарный. Текущий период ещё идёт, поэтому
 * сравниваем с тем же числом дней прошлого: 1–27 сентября против 1–27 августа.
 */
export type PeriodKind = "week" | "month";

export type Period = {
  kind: PeriodKind;
  /** Первый день периода. */
  start: string;
  /** Последний день периода (включительно). */
  end: string;
  /** Последний день, который уже наступил (для текущего периода — сегодня). */
  through: string;
  /** Дни с start по end — ось графика. */
  days: string[];
  /** Прошлый период, урезанный до того же числа дней, что прошло в этом. */
  previous: { start: string; through: string };
};

const DAY = 86400000;
const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (date: string, days: number) => fromMs(toMs(date) + days * DAY);

function bounds(kind: PeriodKind, date: string): { start: string; end: string } {
  if (kind === "week") {
    const weekday = (new Date(toMs(date)).getUTCDay() + 6) % 7; // пн = 0
    const start = addDays(date, -weekday);
    return { start, end: addDays(start, 6) };
  }
  const [y, m] = date.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = fromMs(Date.UTC(y, m, 0)); // последний день месяца
  return { start, end };
}

/** offset 0 — текущий период, -1 — прошлый и т. д. Будущие периоды не открываем. */
export function period(kind: PeriodKind, today: string, offset = 0): Period {
  let { start, end } = bounds(kind, today);
  const stepsBack = Math.min(Math.max(-offset, 0), 120);
  for (let i = 0; i < stepsBack; i++) ({ start, end } = bounds(kind, addDays(start, -1)));
  const through = end < today ? end : today;
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);

  const prev = bounds(kind, addDays(start, -1));
  const elapsed = Math.round((toMs(through) - toMs(start)) / DAY);
  const prevThrough = addDays(prev.start, elapsed);
  return {
    kind,
    start,
    end,
    through,
    days,
    previous: { start: prev.start, through: prevThrough < prev.end ? prevThrough : prev.end },
  };
}

/** Изменение к прошлому периоду в процентах; null — сравнивать не с чем. */
export function change(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Круглый верх оси: 1 / 2 / 2.5 / 5 × 10^n, не меньше максимума. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= value) return step * power;
  return 10 * power;
}
