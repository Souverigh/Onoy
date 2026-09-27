import Link from "next/link";

const dayLabel = (day: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "numeric", month: "long" }).format(
    new Date(`${day}T12:00:00+06:00`),
  );

/** Напоминание: прошлые дни с записями, которые не закрыли. */
export function UnclosedDays({ days }: { days: string[] }) {
  if (!days.length) return null;
  if (days.length === 1)
    return (
      <Link className="notice claims-notice" href={`/day?date=${days[0]}`}>
        Не закрыт день {dayLabel(days[0])} — проверьте и закройте →
      </Link>
    );
  return (
    <div className="notice claims-notice unclosed-days" role="status">
      Не закрыты дни:{" "}
      {days.map((day, i) => (
        <span key={day}>
          {i > 0 && ", "}
          <Link href={`/day?date=${day}`}>{dayLabel(day)}</Link>
        </span>
      ))}
      . Откройте каждый, проверьте и закройте.
    </div>
  );
}
