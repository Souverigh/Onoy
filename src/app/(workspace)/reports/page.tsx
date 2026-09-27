import Link from "next/link";
import { requireOwner } from "@/lib/context";
import { money } from "@/lib/format";
import { bishkekDate } from "@/lib/day-summary";
import { change, period, type PeriodKind } from "@/lib/periods";
import { periodReport } from "@/lib/period-report";
import { DayColumns } from "@/components/day-columns";

const fmt = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", ...options }).format(
    new Date(`${date}T12:00:00+06:00`),
  );

/** «21–27 сентября», «29 сентября – 5 октября». */
function range(start: string, end: string) {
  if (start === end) return fmt(start, { day: "numeric", month: "long" });
  return start.slice(0, 7) === end.slice(0, 7)
    ? `${Number(start.slice(8))}–${fmt(end, { day: "numeric", month: "long" })}`
    : `${fmt(start, { day: "numeric", month: "long" })} – ${fmt(end, { day: "numeric", month: "long" })}`;
}

function Delta({ current, previous, against }: { current: number; previous: number; against: string }) {
  const pct = change(current, previous);
  if (pct === null)
    return <small className="muted">{current > 0 ? `За ${against} — 0 сом` : `Нет данных за ${against}`}</small>;
  return (
    <small className="muted">
      {pct > 0 ? "▲" : pct < 0 ? "▼" : "="} {pct > 0 ? "+" : ""}
      {pct}% к {against} ({money(previous)})
    </small>
  );
}

export default async function Reports({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; offset?: string }>;
}) {
  const params = await searchParams;
  const kind: PeriodKind = params.period === "month" ? "month" : "week";
  const offset = Math.min(0, Math.max(-120, parseInt(params.offset ?? "0") || 0));
  const today = bishkekDate();
  const p = period(kind, today, offset);
  const { db, organizationId } = await requireOwner();
  const report = await periodReport(db, organizationId, p);

  const title =
    kind === "month"
      ? fmt(p.start, { month: "long", year: "numeric" }).replace(/ г\.$/, "")
      : range(p.start, p.end);
  const against = range(p.previous.start, p.previous.through);
  const href = (k: PeriodKind, o: number) => `/reports?period=${k}${o ? `&offset=${o}` : ""}`;
  const { current, previous } = report;

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ИТОГИ ПЕРИОДА</span>
          <h1>Итоги</h1>
          <p className="muted">
            {title}
            {offset === 0 && p.through < p.end ? ` · по ${fmt(p.through, { day: "numeric", month: "long" })}` : ""}
          </p>
        </div>
        <div className="day-nav">
          <Link className="button" href={href(kind, offset - 1)}>
            ← {kind === "week" ? "Прошлая неделя" : "Прошлый месяц"}
          </Link>
          {offset < 0 && (
            <Link className="button" href={href(kind, offset + 1)}>
              {kind === "week" ? "Следующая" : "Следующий"} →
            </Link>
          )}
        </div>
      </div>
      <nav className="pill-switch" aria-label="Период">
        <Link className={kind === "week" ? "selected" : ""} href={href("week", 0)}>
          Неделя
        </Link>
        <Link className={kind === "month" ? "selected" : ""} href={href("month", 0)}>
          Месяц
        </Link>
      </nav>

      <section className="report-tiles" aria-label="Итоги">
        <article className="panel report-tile">
          <h2>Продано</h2>
          <p className="day-number">{money(current.sold)}</p>
          <small className="muted">
            в долг {money(current.soldCredit)} · наличными {money(current.soldCash)} · продаж: {current.salesCount}
          </small>
          <Delta current={current.sold} previous={previous.sold} against={against} />
        </article>
        <article className="panel report-tile">
          <h2>Собрано с клиентов</h2>
          <p className="day-number">{money(current.collected)}</p>
          <small className="muted">оплаты долгов, без продаж за наличные</small>
          <Delta current={current.collected} previous={previous.collected} against={against} />
        </article>
        <article className="panel report-tile">
          <h2>Приход от поставщиков</h2>
          <p className="day-number">{money(current.purchased)}</p>
          <Delta current={current.purchased} previous={previous.purchased} against={against} />
        </article>
        <article className="panel report-tile">
          <h2>Оплачено поставщикам</h2>
          <p className="day-number">{money(current.paidSuppliers)}</p>
          <Delta current={current.paidSuppliers} previous={previous.paidSuppliers} against={against} />
        </article>
      </section>

      <section className="report-charts">
        <div className="panel">
          <DayColumns
            title="Продано по дням, сом"
            through={p.through}
            points={report.days.map((d) => ({ date: d.date, value: d.sold }))}
          />
        </div>
        <div className="panel">
          <DayColumns
            title="Собрано с клиентов по дням, сом"
            through={p.through}
            points={report.days.map((d) => ({ date: d.date, value: d.collected }))}
          />
        </div>
      </section>

      <section className="panel">
        <h2>Больше всего должны</h2>
        {report.topDebtors.length ? (
          <ol className="top-debtors">
            {report.topDebtors.map((d) => (
              <li key={d.id}>
                <Link href={`/customers/${d.id}`}>{d.name}</Link>
                {d.oldestDays != null && d.oldestDays > 30 && (
                  <span className="tag reversed-tag">долг {d.oldestDays} дн.</span>
                )}
                <strong>{money(d.balance)}</strong>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">Никто не должен.</p>
        )}
        <p className="muted">Долг на сейчас, не за период.</p>
      </section>

      <details className="panel report-table">
        <summary>Таблица по дням</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>День</th>
                <th>Продано</th>
                <th>Собрано</th>
              </tr>
            </thead>
            <tbody>
              {report.days
                .filter((d) => d.date <= p.through)
                .map((d) => (
                  <tr key={d.date}>
                    <td>
                      <Link href={`/day?date=${d.date}`}>{fmt(d.date, { day: "numeric", month: "long", weekday: "short" })}</Link>
                    </td>
                    <td>{money(d.sold)}</td>
                    <td>{money(d.collected)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
