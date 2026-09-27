import Link from "next/link";
import { getContext } from "@/lib/context";
import { money } from "@/lib/format";
import { Submit } from "@/components/submit";
import {
  afterClosing,
  bishkekDate,
  computeDaySummary,
  dayBounds,
  dayClosure,
  dayHistory,
  type PartyAmount,
  unclosedDays,
} from "@/lib/day-summary";
import { closeDay } from "./actions";
import { UnclosedDays } from "@/components/unclosed-days";

const HISTORY_DAYS = 14;

function PartyList({ items, empty }: { items: PartyAmount[]; empty: string }) {
  if (!items.length) return <p className="muted">{empty}</p>;
  return (
    <div className="balance-list">
      {items.map((item) => (
        <Link className="balance-row" href={`/customers/${item.id}`} key={item.id}>
          <span>{item.name}</span>
          <strong>{money(item.amount)}</strong>
        </Link>
      ))}
    </div>
  );
}

export default async function DayClose({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; closed?: string; error?: string }>;
}) {
  const { db, organizationId } = await getContext();
  const { date: rawDate, closed, error } = await searchParams;
  const today = bishkekDate();
  // Будущие дни не показываем — сразу сегодняшний.
  const date =
    rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && rawDate <= today ? rawDate : today;
  const isToday = date === today;

  const historyFrom = new Date(
    new Date(dayBounds(today).start).getTime() - (HISTORY_DAYS - 1) * 86400000,
  );
  const [closure, history, closedDays, pending, unclosed] = await Promise.all([
    dayClosure(db, organizationId, date),
    dayHistory(db, organizationId, HISTORY_DAYS),
    db
      .from("day_closures")
      .select("day,snapshot")
      .eq("organization_id", organizationId)
      .gte("day", bishkekDate(historyFrom)),
    db
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "pending"),
    unclosedDays(db, organizationId),
  ]);
  // Закрытый день — снимок на момент закрытия; открытый — считаем сейчас.
  const summary = closure?.snapshot ?? (await computeDaySummary(db, organizationId, date));
  const after = closure ? await afterClosing(db, organizationId, date, closure.closedAt) : null;
  // У закрытых дней в таблице — цифры снимка, как и на странице самого дня.
  const snapshots = new Map(
    ((closedDays.data ?? []) as { day: string; snapshot: typeof summary }[]).map((row) => [
      row.day,
      row.snapshot,
    ]),
  );
  const rows = history.map((row) => {
    const snap = snapshots.get(row.date);
    return snap
      ? { ...row, sold: snap.sold.total, collected: snap.collected.total, purchased: snap.suppliers.purchased }
      : row;
  });

  const shift = (days: number) =>
    bishkekDate(new Date(new Date(`${date}T12:00:00+06:00`).getTime() + days * 86400000));
  const dateLabel = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Bishkek",
    day: "numeric",
    month: "long",
    weekday: "long",
  }).format(new Date(`${date}T12:00:00+06:00`));
  const dayShort = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Bishkek",
    day: "numeric",
    month: "long",
  }).format(new Date(`${date}T12:00:00+06:00`));
  const time = (iso: string) =>
    new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Asia/Bishkek",
      ...(bishkekDate(iso) === date ? { timeStyle: "short" } : { dateStyle: "short", timeStyle: "short" }),
    }).format(new Date(iso));
  const pdfHref = isToday ? "/day/pdf" : `/day/pdf?date=${date}`;
  const afterCount = (after?.added.length ?? 0) + (after?.reversed.length ?? 0);

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ВЕЧЕРНЯЯ СВЕРКА</span>
          <h1>Итог дня</h1>
          <p className="muted">{dateLabel}</p>
        </div>
        <div className="day-nav">
          <Link className="button" href={`/day?date=${shift(-1)}`}>
            ← Вчера
          </Link>
          {!isToday && (
            <Link className="button" href={shift(1) === today ? "/day" : `/day?date=${shift(1)}`}>
              Завтра →
            </Link>
          )}
        </div>
      </div>
      <form className="day-picker" action="/day">
        <label>
          Итог за другой день
          <input type="date" name="date" defaultValue={date} max={today} />
        </label>
        <button className="button" type="submit">
          Показать итог за эту дату
        </button>
        {!isToday && (
          <Link className="text-button" href="/day">
            Сегодня
          </Link>
        )}
      </form>

      {/* Открытый сейчас день и так помечен «День не закрыт» ниже. */}
      <UnclosedDays days={unclosed.filter((day) => day !== date)} />
      {closed && (
        <p className="notice success" role="status">
          День закрыт. Итоги сохранены — PDF можно скачать и отправить.
        </p>
      )}
      {error === "close" && (
        <p className="form-error" role="alert">
          Не удалось закрыть день. Обновите страницу и попробуйте снова.
        </p>
      )}

      {closure ? (
        <section className="panel day-status day-status-closed">
          <div>
            <strong>✓ День закрыт {time(closure.closedAt)}</strong>
            <p className="muted">
              Цифры ниже зафиксированы на момент закрытия
              {afterCount > 0 ? `; изменения после закрытия — отдельно внизу (${afterCount}).` : "."}
            </p>
          </div>
          <a className="button" href={pdfHref}>
            Скачать PDF
          </a>
        </section>
      ) : (
        <section className="panel day-status">
          <div>
            <strong>{isToday ? "День идёт" : "День не закрыт"}</strong>
            <p className="muted">
              {isToday
                ? "Цифры обновляются с каждой записью. Вечером проверьте незакрытое, сверьте «наличными» с кассой и закройте день — итоги сохранятся."
                : "Итоги посчитаны сейчас по действующим записям. Закройте день, чтобы сохранить их."}
            </p>
          </div>
          <div className="day-status-actions">
            <a className="button" href={pdfHref}>
              PDF на сейчас
            </a>
            <form action={closeDay}>
              <input type="hidden" name="date" value={date} />
              <Submit>Закрыть день</Submit>
            </form>
          </div>
        </section>
      )}

      <div className="day-grid">
        <section className="panel">
          <h2>Продано за день</h2>
          <p className="day-number">{money(summary.sold.total)}</p>
          <p className="muted">
            Накладных: {summary.sold.count} · В долг: {money(summary.sold.credit)} · Наличными:{" "}
            {money(summary.sold.cash)}
          </p>
        </section>
        <section className="panel">
          <h2>Собрано денег</h2>
          <p className="day-number">{money(summary.collected.total)}</p>
          <p className="muted">
            Наличными: {money(summary.collected.cash)} · Переводом: {money(summary.collected.transfer)}
          </p>
        </section>
        <section className="panel">
          <h2>Долг клиентов</h2>
          <p className="muted">Было утром: {money(summary.receivable.morning)}</p>
          <p className="day-number">Стало вечером: {money(summary.receivable.evening)}</p>
        </section>
        <section className="panel">
          <h2>Поставщики</h2>
          <p className="muted">Приход за день: {money(summary.suppliers.purchased)}</p>
          <p className="muted">Оплачено: {money(summary.suppliers.paid)}</p>
          <p className="day-number">Долг на конец дня: {money(summary.suppliers.evening)}</p>
        </section>
      </div>
      <div className="day-grid">
        <section className="panel">
          <h2>Кому продал в долг</h2>
          <PartyList items={summary.creditByCustomer} empty="Продаж в долг не было." />
        </section>
        <section className="panel">
          <h2>Кто оплатил</h2>
          <PartyList items={summary.paidByCustomer} empty="Оплат от клиентов не было." />
        </section>
      </div>

      {after && afterCount > 0 && (
        <section className="panel day-after">
          <h2>После закрытия</h2>
          <p className="muted">
            Эти записи за {dayShort} внесены или отменены после закрытия — в сохранённые итоги
            выше они не вошли.
          </p>
          <ul className="day-after-list">
            {after.added.map((item, i) => (
              <li key={`a${i}`}>
                <span>
                  + {item.label} · {item.party}
                  <small className="muted"> · внесена {time(item.at)}</small>
                </span>
                <strong>{money(item.amount)}</strong>
              </li>
            ))}
            {after.reversed.map((item, i) => (
              <li key={`r${i}`} className="day-after-reversed">
                <span>
                  Отменена: {item.label} · {item.party}
                  <small className="muted"> · {time(item.at)}</small>
                </span>
                <strong>{money(item.amount)}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <h2>Незакрытое</h2>
        <p className="muted">
          Заявок ждут подтверждения: {pending.count ?? 0}
          {pending.count ? (
            <>
              {" "}
              — <Link href="/claims">открыть заявки →</Link>
            </>
          ) : null}
        </p>
      </section>

      <section className="panel">
        <h2>По дням</h2>
        <div className="table-wrap">
          <table className="day-history">
            <thead>
              <tr>
                <th>День</th>
                <th>Продано</th>
                <th>Собрано</th>
                <th>Приход</th>
                <th>Закрыт</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.date} className={row.date === date ? "day-history-current" : ""}>
                  <td>
                    <Link href={row.date === today ? "/day" : `/day?date=${row.date}`}>
                      {row.date === today
                        ? "Сегодня"
                        : new Intl.DateTimeFormat("ru-RU", {
                            timeZone: "Asia/Bishkek",
                            day: "numeric",
                            month: "short",
                            weekday: "short",
                          }).format(new Date(`${row.date}T12:00:00+06:00`))}
                    </Link>
                  </td>
                  <td>{money(row.sold)}</td>
                  <td>{money(row.collected)}</td>
                  <td>{money(row.purchased)}</td>
                  <td>{snapshots.has(row.date) ? "✓" : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
