/**
 * Журнал записей (просьба пользователя 17.10.2026, «как в 1С»): период,
 * отборы, сортировка — всё в адресе страницы, чтобы ссылку можно было
 * открыть снова или выгрузить в Excel с теми же отборами. Без обращений к
 * базе — только разбор адреса и даты по Бишкеку (UTC+6, без перехода на
 * летнее время).
 */

export type JournalPeriod = "today" | "yesterday" | "week" | "month" | "prev_month" | "all" | "custom";
export type JournalSort = "date_desc" | "date_asc" | "sum_desc" | "sum_asc";
/** Продажа: в долг / наличными; приход: действующие. Отменённые — отдельно. */
export type JournalStatus = "all" | "active" | "debt" | "cash" | "reversed";

export type JournalFilters = {
  period: JournalPeriod;
  /** Свой период: с какого и по какой день включительно (ГГГГ-ММ-ДД). */
  from: string;
  to: string;
  /** Часть имени клиента или поставщика. */
  q: string;
  status: JournalStatus;
  /** Кто внёс (id участника) — только у владельца. */
  by: string;
  sort: JournalSort;
  page: number;
};

export const PERIOD_LABELS: Record<Exclude<JournalPeriod, "custom">, string> = {
  today: "Сегодня",
  yesterday: "Вчера",
  week: "Неделя",
  month: "Месяц",
  prev_month: "Прошлый месяц",
  all: "Всё время",
};

const PERIODS = new Set<JournalPeriod>(["today", "yesterday", "week", "month", "prev_month", "all", "custom"]);
const SORTS = new Set<JournalSort>(["date_desc", "date_asc", "sum_desc", "sum_asc"]);
const STATUSES = new Set<JournalStatus>(["all", "active", "debt", "cash", "reversed"]);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DAY = 86400000;
const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (date: string, days: number) => fromMs(toMs(date) + days * DAY);
const validDay = (value: string) => DAY_RE.test(value) && !Number.isNaN(toMs(value)) && fromMs(toMs(value)) === value;

type Params = Partial<Record<keyof JournalFilters, string | undefined>>;

/** Адрес → отборы; непонятное — по умолчанию (этот месяц, сначала новые). */
export function parseJournal(params: Params, { allowBy = false } = {}): JournalFilters {
  const from = params.from && validDay(params.from) ? params.from : "";
  const to = params.to && validDay(params.to) ? params.to : "";
  let period = PERIODS.has(params.period as JournalPeriod) ? (params.period as JournalPeriod) : "month";
  if (period === "custom" && !from && !to) period = "month";
  const page = Math.max(1, Math.min(1000, Number.parseInt(params.page ?? "1", 10) || 1));
  return {
    period,
    from: period === "custom" ? from : "",
    to: period === "custom" ? to : "",
    q: (params.q ?? "").trim().replace(/\s+/g, " ").slice(0, 80),
    status: STATUSES.has(params.status as JournalStatus) ? (params.status as JournalStatus) : "all",
    by: allowBy && params.by && UUID_RE.test(params.by) ? params.by : "",
    sort: SORTS.has(params.sort as JournalSort) ? (params.sort as JournalSort) : "date_desc",
    page,
  };
}

/** Дни периода включительно; null — без границы («Всё время»). */
export function periodDays(f: Pick<JournalFilters, "period" | "from" | "to">, today: string): { from: string | null; to: string | null } {
  switch (f.period) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const day = addDays(today, -1);
      return { from: day, to: day };
    }
    case "week": {
      const weekday = (new Date(toMs(today)).getUTCDay() + 6) % 7; // пн = 0
      return { from: addDays(today, -weekday), to: today };
    }
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "prev_month": {
      const last = addDays(`${today.slice(0, 7)}-01`, -1);
      return { from: `${last.slice(0, 7)}-01`, to: last };
    }
    case "custom": {
      // Перепутали «с» и «по» — меняем местами.
      const [a, b] = f.from && f.to && f.from > f.to ? [f.to, f.from] : [f.from, f.to];
      return { from: a || null, to: b || null };
    }
    default:
      return { from: null, to: null };
  }
}

/** Границы для запроса по occurred_at: [начало дня from; начало дня после to) по Бишкеку. */
export function periodBounds(days: { from: string | null; to: string | null }): { gte: string | null; lt: string | null } {
  return {
    gte: days.from ? new Date(`${days.from}T00:00:00+06:00`).toISOString() : null,
    lt: days.to ? new Date(`${addDays(days.to, 1)}T00:00:00+06:00`).toISOString() : null,
  };
}

/** Адрес журнала с изменёнными отборами; значения по умолчанию в адрес не пишем. Смена отбора — снова первая страница. */
export function journalHref(base: string, f: JournalFilters, patch: Partial<JournalFilters> = {}): string {
  const next = { ...f, ...("page" in patch ? {} : { page: 1 }), ...patch };
  const q = new URLSearchParams();
  if (next.period !== "month") q.set("period", next.period);
  if (next.period === "custom") {
    if (next.from) q.set("from", next.from);
    if (next.to) q.set("to", next.to);
  }
  if (next.q) q.set("q", next.q);
  if (next.status !== "all") q.set("status", next.status);
  if (next.by) q.set("by", next.by);
  if (next.sort !== "date_desc") q.set("sort", next.sort);
  if (next.page > 1) q.set("page", String(next.page));
  const text = q.toString();
  return text ? `${base}?${text}` : base;
}

/** Кнопка периода: «Октябрь 2026» вместо «Месяц» и «Прошлый месяц»; остальное — как в списке. */
export function periodButtonLabel(f: Pick<JournalFilters, "period">, today: string): string | null {
  if (f.period !== "month" && f.period !== "prev_month") return null;
  const day = f.period === "month" ? today : addDays(`${today.slice(0, 7)}-01`, -1);
  const month = new Intl.DateTimeFormat("ru-RU", { month: "long", timeZone: "UTC" }).format(new Date(toMs(day)));
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${day.slice(0, 4)}`;
}

/** «1–17 октября 2026» — подпись периода над итогами. */
export function periodText(days: { from: string | null; to: string | null }): string {
  if (!days.from && !days.to) return "за всё время";
  const fmt = (d: string) =>
    new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(toMs(d)));
  if (days.from && days.to && days.from === days.to) return `за ${fmt(days.from)}`;
  if (days.from && days.to) return `с ${fmt(days.from)} по ${fmt(days.to)}`;
  return days.from ? `с ${fmt(days.from)}` : `по ${fmt(days.to!)}`;
}
