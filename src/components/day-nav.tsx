"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { DatePicker } from "./date-picker";

const dayHref = (day: string, today: string) => (day === today ? "/day" : `/day?date=${day}`);

/** Итог дня: ‹ [📅 дата] › — кнопка с датой открывает календарь; `extra` — справа («Скачать»). */
export function DayNav({
  date,
  today,
  prev,
  next,
  extra,
}: {
  date: string;
  today: string;
  prev: string;
  next: string;
  extra?: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <div className="day-nav">
      <Link className="day-nav-arrow" href={dayHref(prev, today)} aria-label="Предыдущий день">
        ‹
      </Link>
      <DatePicker
        variant="field"
        label="День"
        // Сегодня — словом «Сегодня», другой день — датой «20.10.2026».
        value={date === today ? "" : date}
        emptyLabel="Сегодня"
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
      {extra}
    </div>
  );
}

/**
 * Календарь в отчёте за период (продажи продавцов): выбрал день — отчёт за
 * этот день (?date=), «Сегодня» — за сегодня. `base` — адрес без даты.
 */
export function PeriodDayPicker({ value, base, periodText }: { value: string; base: string; periodText: string }) {
  const router = useRouter();
  return (
    // Как в итоге дня: кнопка «📅 01.10.2026 – 21.10.2026» (или выбранный день).
    <DatePicker
      variant="field"
      label="День"
      value={value}
      emptyLabel={periodText}
      maxDaysBack={3650}
      onChange={(day) => router.push(day ? `${base}${base.includes("?") ? "&" : "?"}date=${day}` : base)}
    />
  );
}
