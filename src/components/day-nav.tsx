"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { DatePicker } from "./date-picker";

const dayHref = (day: string, today: string) => (day === today ? "/day" : `/day?date=${day}`);

/** Итог дня: ‹ день › и календарь по иконке — вместо отдельного поля даты. */
export function DayNav({ date, today, prev, next }: { date: string; today: string; prev: string; next: string }) {
  const router = useRouter();
  return (
    <div className="day-nav">
      <Link className="day-nav-arrow" href={dayHref(prev, today)} aria-label="Предыдущий день">
        ‹
      </Link>
      <DatePicker
        label="День"
        value={date === today ? "" : date}
        maxDaysBack={3650}
        onChange={(day) => router.push(day ? dayHref(day, today) : "/day")}
      />
      {date !== today ? (
        <Link className="day-nav-arrow" href={dayHref(next, today)} aria-label="Следующий день">
          ›
        </Link>
      ) : (
        <span className="day-nav-arrow disabled" aria-hidden="true">
          ›
        </span>
      )}
    </div>
  );
}

/**
 * Календарь в отчёте за период (продажи продавцов): выбрал день — отчёт за
 * этот день (?date=), «Сегодня» — за сегодня. `base` — адрес без даты.
 */
export function PeriodDayPicker({ value, base }: { value: string; base: string }) {
  const router = useRouter();
  return (
    <DatePicker
      label="День"
      value={value}
      emptyLabel="Выбрать день"
      maxDaysBack={3650}
      onChange={(day) => router.push(day ? `${base}${base.includes("?") ? "&" : "?"}date=${day}` : base)}
    />
  );
}
