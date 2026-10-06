import Link from "next/link";
import { requireOwner } from "@/lib/context";
import { money } from "@/lib/format";
import { CURRENCY_SIGN, type Currency } from "@/lib/currency";
import { Submit } from "@/components/submit";
import {
  afterClosing,
  bishkekDate,
  computeDaySummary,
  dayBounds,
  dayClosure,
  dayHistory,
  dayIsEmpty,
  dayNet,
  type DayMoney,
  type DaySummary,
  type PartyAmount,
  unclosedDays,
} from "@/lib/day-summary";
import { closeDay } from "./actions";
import { UnclosedDays } from "@/components/unclosed-days";
import { expenseCategoryLabel } from "@/lib/expenses";

const HISTORY_DAYS = 14;

function PartyList({ items, empty, currency }: { items: PartyAmount[]; empty: string; currency: string }) {
  if (!items.length) return <p className="muted">{empty}</p>;
  return (
    <div className="balance-list">
      {items.map((item) => (
        <Link className="balance-row" href={`/customers/${item.id}`} key={item.id}>
          <span>{item.name}</span>
          <strong>{money(item.amount, currency)}</strong>
        </Link>
      ))}
    </div>
  );
}

/** Цифры дня в одной валюте: основная валюта магазина или отдельный блок (доллары Хороза). */
function DayMoneyPanels({ m, cur }: { m: DayMoney; cur: string }) {
  return (
    <>
        <div className="day-grid">
          <section className="panel">
            <h2>Продано за день</h2>
            <p className="day-number">{money(m.sold.total, cur)}</p>
            <p className="muted">
              Накладных: {m.sold.count} · В долг: {money(m.sold.credit, cur)} · Наличными:{" "}
              {money(m.sold.cash, cur)}
            </p>
          </section>
          <section className="panel">
            <h2>Собрано денег</h2>
            <p className="day-number">{money(m.collected.total, cur)}</p>
            <p className="muted">
              Наличными: {money(m.collected.cash, cur)} · Переводом: {money(m.collected.transfer, cur)}
            </p>
          </section>
          <section className="panel">
            <h2>Долг клиентов</h2>
            <p className="muted">Было утром: {money(m.receivable.morning, cur)}</p>
            <p className="day-number">Стало вечером: {money(m.receivable.evening, cur)}</p>
          </section>
          <section className="panel">
            <h2>Поставщики</h2>
            <p className="muted">Товар от поставщиков за день: {money(m.suppliers.purchased, cur)}</p>
            <p className="muted">Оплачено: {money(m.suppliers.paid, cur)}</p>
            <p className="day-number">Долг на конец дня: {money(m.suppliers.evening, cur)}</p>
          </section>
        </div>
        <div className="day-grid">
          <section className="panel">
            <h2>Кому продал в долг</h2>
            <PartyList items={m.creditByCustomer} currency={cur} empty="Продаж в долг не было." />
          </section>
          <section className="panel">
            <h2>Кто оплатил</h2>
            <PartyList items={m.paidByCustomer} currency={cur} empty="Оплат от клиентов не было." />
          </section>
        </div>
    </>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Первый экран (задача 32): продал, из них в долг, получил денег (наличными и
 * переводом), сколько наличных должно быть в кассе. Скидки и возвраты —
 * отдельно, это не деньги.
 */
function DayTop({ summary }: { summary: DaySummary }) {
  const cur = summary.currency ?? "KGS";
  const net = dayNet(summary);
  const transfer = net.transferIn ?? summary.collected.transfer;
  const cashIn = net.transferIn == null ? round(summary.sold.cash + summary.collected.cash) : net.income;
  const adjust = summary.adjustments;
  return (
    <section className="panel day-top" aria-label="Итог дня коротко">
      <div className="day-line">
        <span>Продал за день</span>
        <strong>{money(summary.sold.total, cur)}</strong>
      </div>
      <div className="day-line day-line-sub">
        <span>из них в долг</span>
        <strong>{money(summary.sold.credit, cur)}</strong>
      </div>
      <div className="day-line">
        <span>
          Получил денег
          <small className="muted">
            наличными {money(cashIn, cur)} · переводом {money(transfer, cur)}
          </small>
        </span>
        <strong>{money(round(cashIn + transfer), cur)}</strong>
      </div>
      <div className="day-line day-line-main">
        <span>В кассе должно быть наличных</span>
        <strong>{money(net.left, cur)}</strong>
      </div>
      {adjust && (adjust.discount > 0 || adjust.return > 0) && (
        <div className="day-line day-line-sub">
          <span>Скидки и возвраты клиентам — не деньги</span>
          <strong>
            {[
              adjust.discount > 0 ? `скидки ${money(adjust.discount, cur)}` : "",
              adjust.return > 0 ? `возвраты ${money(adjust.return, cur)}` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </strong>
        </div>
      )}
    </section>
  );
}

/** «В кассе по факту» против «должно быть» — словами, без минуса. */
function CountedLine({ summary }: { summary: DaySummary }) {
  if (summary.counted == null) return null;
  const cur = summary.currency ?? "KGS";
  const diff = round(summary.counted - dayNet(summary).left);
  return (
    <p className="muted">
      В кассе по факту: {money(summary.counted, cur)} ·{" "}
      {diff === 0 ? "сходится" : diff < 0 ? `не хватает ${money(-diff, cur)}` : `лишние ${money(diff, cur)}`}
    </p>
  );
}

/** Расходы и касса за день — в валюте магазина. */
function DayExpensesPanels({ summary, date }: { summary: DaySummary; date: string }) {
  const cur = summary.currency ?? "KGS";
  const net = dayNet(summary);
  const expenses = summary.expenses;
  return (
    <div className="day-grid">
      <section className="panel">
        <h2>Расходы за день</h2>
        <p className="day-number">{money(net.expenses, cur)}</p>
        {expenses && expenses.byCategory.length > 0 ? (
          <div className="balance-list">
            {expenses.byCategory.map((c) => (
              <div className="balance-row" key={c.category}>
                <span>{expenseCategoryLabel(c.category)}</span>
                <strong>{money(c.amount, cur)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Расходов не было.</p>
        )}
        <p className="muted">
          <Link href={`/money/expenses?month=${date.slice(0, 7)}`}>Все расходы →</Link>
        </p>
      </section>
      <section className="panel">
        <h2>Осталось за день</h2>
        {net.transferIn == null ? (
          <p className="muted">Пришло (наличные продажи + собрано): {money(net.income, cur)}</p>
        ) : (
          <p className="muted">Наличными от клиентов и продаж: {money(net.income, cur)}</p>
        )}
        <p className="muted">Наличными поставщикам: − {money(net.paid, cur)}</p>
        <p className="muted">Расходы: − {money(net.expenses, cur)}</p>
        <p className="day-number">{money(net.left, cur)}</p>
        {net.transferIn != null && (net.transferIn > 0 || (net.transferOut ?? 0) > 0) && (
          <p className="muted">
            Переводом — не в кассе: получено {money(net.transferIn, cur)}
            {(net.transferOut ?? 0) > 0 && <> · отправлено {money(net.transferOut ?? 0, cur)}</>}
          </p>
        )}
      </section>
    </div>
  );
}

export default async function DayClose({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; closed?: string; error?: string }>;
}) {
  const { db, organizationId, currency: shopCurrency } = await requireOwner();
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
      ? {
          ...row,
          sold: snap.sold.total,
          collected: snap.collected.total,
          purchased: snap.suppliers.purchased,
          expenses: snap.expenses?.total ?? 0,
        }
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
      {error === "counted" && (
        <p className="form-error" role="alert">
          «В кассе по факту» — только число, например 12 500.
        </p>
      )}

      <DayTop summary={summary} />

      {closure ? (
        <section className="panel day-status day-status-closed">
          <div>
            <strong>✓ День закрыт {time(closure.closedAt)}</strong>
            <CountedLine summary={closure.snapshot} />
            <p className="muted">
              Цифры зафиксированы на момент закрытия
              {afterCount > 0 ? `; изменения после закрытия — отдельно внизу (${afterCount}).` : "."}
            </p>
          </div>
          <a className="button" href={pdfHref}>
            Скачать PDF
          </a>
        </section>
      ) : dayIsEmpty(summary) ? (
        <section className="panel day-status">
          <div>
            <strong>{isToday ? "Записей пока нет" : "В этот день записей нет"}</strong>
            <p className="muted">Закрывать нечего.</p>
          </div>
        </section>
      ) : (
        <section className="panel day-status">
          <div>
            <strong>{isToday ? "День идёт" : "День не закрыт"}</strong>
            <p className="muted">
              {isToday
                ? "Цифры обновляются с каждой записью. Вечером пересчитайте наличные, впишите сумму и закройте день — итоги сохранятся."
                : "Итоги посчитаны сейчас по действующим записям. Пересчитайте кассу и закройте день, чтобы сохранить их."}
            </p>
          </div>
          <div className="day-status-actions">
            <form action={closeDay} className="day-close-form">
              <input type="hidden" name="date" value={date} />
              <label>
                В кассе по факту
                <input
                  name="counted"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={`должно быть ${money(dayNet(summary).left, summary.currency ?? "KGS")}`}
                />
              </label>
              <Submit>Закрыть день</Submit>
            </form>
            <a className="button" href={pdfHref}>
              PDF на сейчас
            </a>
          </div>
        </section>
      )}

      {/* Открытый сейчас день и так помечен «День не закрыт» выше. */}
      <UnclosedDays days={unclosed.filter((day) => day !== date)} />
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

      <DayMoneyPanels m={summary} cur={summary.currency ?? "KGS"} />
      <DayExpensesPanels summary={summary} date={date} />
      {summary.foreign?.map((part) => (
        <section key={part.currency} className="day-foreign">
          <h2 className="day-foreign-title">
            В валюте {CURRENCY_SIGN[part.currency as Currency] ?? part.currency} — отдельно, не складывается с основными
          </h2>
          <DayMoneyPanels m={part} cur={part.currency} />
        </section>
      ))}

      {/* По продавцам — когда в магазине работают сотрудники. */}
      {summary.bySeller?.some((s) => s.role === "staff") && (
        <section className="panel">
          <h2>По продавцам</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Кто</th>
                  <th>Продаж</th>
                  <th>Продано</th>
                  <th>Собрано</th>
                </tr>
              </thead>
              <tbody>
                {summary.bySeller.map((s) => (
                  <tr key={s.id ?? "none"}>
                    <td>{s.name}</td>
                    <td>{s.count}</td>
                    <td>{money(s.sold, summary.currency ?? "KGS")}</td>
                    <td>{money(s.collected, summary.currency ?? "KGS")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

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
                  + {item.label}
                  {item.party ? ` · ${item.party}` : ""}
                  <small className="muted"> · внесена {time(item.at)}</small>
                </span>
                <strong>{money(item.amount, item.currency)}</strong>
              </li>
            ))}
            {after.reversed.map((item, i) => (
              <li key={`r${i}`} className="day-after-reversed">
                <span>
                  Отменена: {item.label}
                  {item.party ? ` · ${item.party}` : ""}
                  <small className="muted"> · {time(item.at)}</small>
                </span>
                <strong>{money(item.amount, item.currency)}</strong>
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
          <table className="day-history card-table">
            <thead>
              <tr>
                <th>День</th>
                <th>Продано</th>
                <th>Собрано</th>
                <th>Товар от поставщика</th>
                <th>Расходы</th>
                <th>Закрыт</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.date} className={row.date === date ? "day-history-current" : ""}>
                  <td className="card-title">
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
                  <td data-label="Продано">{money(row.sold, shopCurrency)}</td>
                  <td data-label="Собрано">{money(row.collected, shopCurrency)}</td>
                  <td data-label="Товар от поставщика">{money(row.purchased, shopCurrency)}</td>
                  <td data-label="Расходы">{money(row.expenses, shopCurrency)}</td>
                  <td data-label="Закрыт">{snapshots.has(row.date) ? "✓" : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
