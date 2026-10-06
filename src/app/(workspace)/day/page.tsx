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
import { DayNav } from "@/components/day-nav";
import { InfoTip } from "@/components/info-tip";
import { expenseCategoryLabel } from "@/lib/expenses";

const HISTORY_DAYS = 14;

const dayName = (day: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "numeric", month: "long" }).format(
    new Date(`${day}T12:00:00+06:00`),
  );

function PartyList({ items, currency }: { items: PartyAmount[]; currency: string }) {
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

/** «Кто взял в долг» / «Кто оплатил» — свёрнуто и только когда есть кто. */
function PartyLists({ m, cur }: { m: DayMoney; cur: string }) {
  if (!m.creditByCustomer.length && !m.paidByCustomer.length) return null;
  return (
    <div className="day-lists">
      {m.creditByCustomer.length > 0 && (
        <details className="panel day-fold">
          <summary>
            Кто взял в долг <span className="muted">({m.creditByCustomer.length})</span>
          </summary>
          <PartyList items={m.creditByCustomer} currency={cur} />
        </details>
      )}
      {m.paidByCustomer.length > 0 && (
        <details className="panel day-fold">
          <summary>
            Кто оплатил <span className="muted">({m.paidByCustomer.length})</span>
          </summary>
          <PartyList items={m.paidByCustomer} currency={cur} />
        </details>
      )}
    </div>
  );
}

/** «было → стало»; не изменилось — одна сумма. */
function FromTo({ from, to, cur }: { from: number; to: number; cur: string }) {
  return (
    <strong>
      {from !== to && <span className="muted day-debt-from">{money(from, cur)} → </span>}
      {money(to, cur)}
    </strong>
  );
}

function SupplierTip({ m, cur }: { m: DayMoney; cur: string }) {
  return (
    <>
      Сколько вы должны поставщикам: утром {money(m.suppliers.morning, cur)}, вечером{" "}
      {money(m.suppliers.evening, cur)}. За день товар от поставщиков — {money(m.suppliers.purchased, cur)},
      оплачено — {money(m.suppliers.paid, cur)}.
    </>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Главная карточка (задача 32): сколько наличных должно быть в кассе,
 * откуда эта сумма и закрытие дня. Пояснения — в «!».
 */
function CashCard({
  summary,
  date,
  isToday,
  closure,
  closedTime,
  afterCount,
  pdfHref,
}: {
  summary: DaySummary;
  date: string;
  isToday: boolean;
  closure: boolean;
  closedTime: string | null;
  afterCount: number;
  pdfHref: string;
}) {
  const cur = summary.currency ?? "KGS";
  const net = dayNet(summary);
  const diff = summary.counted != null ? round(summary.counted - net.left) : null;
  return (
    <section className={`panel day-cash${closure ? " day-cash-closed" : ""}`}>
      <div className="day-cash-head">
        <span className="label-with-tip">
          В кассе должно быть
          <InfoTip>
            Наличные за день: пришло наличными (продажи и оплаты клиентов) минус наличные поставщикам и
            расходы. Переводы в кассу не входят.
          </InfoTip>
        </span>
        <strong className="day-cash-sum">{money(net.left, cur)}</strong>
      </div>
      <details className="day-cash-from">
        <summary>Откуда эта сумма</summary>
        <div className="day-line day-line-sub">
          <span>Пришло наличными</span>
          <strong>+ {money(net.income, cur)}</strong>
        </div>
        <div className="day-line day-line-sub">
          <span>Наличными поставщикам</span>
          <strong>− {money(net.paid, cur)}</strong>
        </div>
        <div className="day-line day-line-sub">
          <span>Расходы</span>
          <strong>− {money(net.expenses, cur)}</strong>
        </div>
        {net.transferIn != null && (net.transferIn > 0 || (net.transferOut ?? 0) > 0) && (
          <div className="day-line day-line-sub">
            <span>Переводом — не в кассе</span>
            <strong>
              получено {money(net.transferIn, cur)}
              {(net.transferOut ?? 0) > 0 && <> · отправлено {money(net.transferOut ?? 0, cur)}</>}
            </strong>
          </div>
        )}
      </details>

      {closure ? (
        <div className="day-cash-status">
          <span className="label-with-tip">
            <strong>✓ День закрыт {closedTime}</strong>
            <InfoTip>
              Цифры зафиксированы на момент закрытия
              {afterCount > 0 ? `; изменения после закрытия — отдельно внизу (${afterCount}).` : "."}
            </InfoTip>
          </span>
          {summary.counted != null && diff != null && (
            <span className="muted">
              По факту {money(summary.counted, cur)} ·{" "}
              {diff === 0 ? "сходится" : diff < 0 ? `не хватает ${money(-diff, cur)}` : `лишние ${money(diff, cur)}`}
            </span>
          )}
          <a className="button" href={pdfHref}>
            Скачать PDF
          </a>
        </div>
      ) : dayIsEmpty(summary) ? (
        <p className="muted day-cash-status">
          {isToday ? "Записей пока нет — закрывать нечего." : "В этот день записей нет."}
        </p>
      ) : (
        <form action={closeDay} className="day-close-form">
          <input type="hidden" name="date" value={date} />
          <label>
            <span className="label-with-tip">
              В кассе по факту
              <InfoTip>
                {isToday
                  ? "Цифры обновляются с каждой записью. Вечером пересчитайте наличные, впишите сумму и закройте день — итоги сохранятся."
                  : "Итоги посчитаны сейчас по действующим записям. Пересчитайте кассу и закройте день, чтобы сохранить их."}
              </InfoTip>
            </span>
            <input name="counted" inputMode="decimal" autoComplete="off" placeholder={money(net.left, cur)} />
          </label>
          <Submit>Закрыть день</Submit>
          <a className="text-button" href={pdfHref}>
            PDF на сейчас
          </a>
        </form>
      )}
    </section>
  );
}

/** Три плитки: продал, получил, расходы — каждая цифра один раз. */
function DayTiles({ summary, date }: { summary: DaySummary; date: string }) {
  const cur = summary.currency ?? "KGS";
  const net = dayNet(summary);
  const transfer = net.transferIn ?? summary.collected.transfer;
  const cashIn = net.transferIn == null ? round(summary.sold.cash + summary.collected.cash) : net.income;
  const expenses = summary.expenses;
  return (
    <div className="day-tiles">
      <section className="panel day-tile">
        <span className="label-with-tip">
          Продал
          <InfoTip>
            Накладных за день: {summary.sold.count}. Из суммы — в долг {money(summary.sold.credit, cur)}, сразу
            наличными {money(summary.sold.cash, cur)}.
          </InfoTip>
        </span>
        <strong>{money(summary.sold.total, cur)}</strong>
        <small className="muted">в долг {money(summary.sold.credit, cur)}</small>
      </section>
      <section className="panel day-tile">
        <span className="label-with-tip">
          Получил
          <InfoTip>Деньги за день: наличные продажи и оплаты долгов от клиентов — наличными и переводом.</InfoTip>
        </span>
        <strong>{money(round(cashIn + transfer), cur)}</strong>
        <small className="muted">
          нал. {money(cashIn, cur)} · перев. {money(transfer, cur)}
        </small>
      </section>
      <section className="panel day-tile">
        <span className="label-with-tip">
          Расходы
          <InfoTip>
            {expenses && expenses.byCategory.length > 0
              ? `${expenses.byCategory.map((c) => `${expenseCategoryLabel(c.category)} — ${money(c.amount, cur)}`).join("; ")}.`
              : "Расходов за день не было."}
          </InfoTip>
        </span>
        <strong>{money(net.expenses, cur)}</strong>
        <small>
          <Link href={`/money/expenses?month=${date.slice(0, 7)}`}>все расходы →</Link>
        </small>
      </section>
    </div>
  );
}

/** Долги клиентов и поставщиков — строками «было → стало». */
function DebtLines({ summary }: { summary: DaySummary }) {
  const cur = summary.currency ?? "KGS";
  const adjust = summary.adjustments;
  return (
    <section className="panel day-debts">
      <div className="day-line">
        <span className="label-with-tip">
          Долг клиентов
          <InfoTip>Сколько вам должны все клиенты: утром → вечером.</InfoTip>
        </span>
        <FromTo from={summary.receivable.morning} to={summary.receivable.evening} cur={cur} />
      </div>
      <div className="day-line">
        <span className="label-with-tip">
          Мой долг поставщикам
          <InfoTip>
            <SupplierTip m={summary} cur={cur} />
          </InfoTip>
        </span>
        <FromTo from={summary.suppliers.morning} to={summary.suppliers.evening} cur={cur} />
      </div>
      {adjust && (adjust.discount > 0 || adjust.return > 0) && (
        <div className="day-line">
          <span className="label-with-tip">
            Скидки и возвраты
            <InfoTip>Скидки и возвраты клиентам уменьшают долг, но это не деньги — в кассу не входят.</InfoTip>
          </span>
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

/** Другая валюта (доллары Хороза) — одной карточкой, только ненулевые строки. */
function ForeignPart({ m }: { m: DayMoney & { currency: string } }) {
  const cur = m.currency;
  const sign = CURRENCY_SIGN[cur as Currency] ?? cur;
  const hasClients = Boolean(m.receivable.morning || m.receivable.evening);
  const hasSuppliers = Boolean(m.suppliers.morning || m.suppliers.evening || m.suppliers.purchased || m.suppliers.paid);
  const hasLists = m.creditByCustomer.length > 0 || m.paidByCustomer.length > 0;
  if (!m.sold.total && !m.collected.total && !hasClients && !hasSuppliers && !hasLists) return null;
  return (
    <>
      <section className="panel day-debts">
        <h2 className="day-foreign-title label-with-tip">
          В {sign}
          <InfoTip>Записи в {sign} считаются отдельно и не складываются с основными суммами.</InfoTip>
        </h2>
        {m.sold.total > 0 && (
          <div className="day-line">
            <span>Продал</span>
            <strong>{money(m.sold.total, cur)}</strong>
          </div>
        )}
        {m.collected.total > 0 && (
          <div className="day-line">
            <span>Получил</span>
            <strong>{money(m.collected.total, cur)}</strong>
          </div>
        )}
        {hasClients && (
          <div className="day-line">
            <span>Долг клиентов</span>
            <FromTo from={m.receivable.morning} to={m.receivable.evening} cur={cur} />
          </div>
        )}
        {hasSuppliers && (
          <div className="day-line">
            <span className="label-with-tip">
              Мой долг поставщикам
              <InfoTip>
                <SupplierTip m={m} cur={cur} />
              </InfoTip>
            </span>
            <FromTo from={m.suppliers.morning} to={m.suppliers.evening} cur={cur} />
          </div>
        )}
      </section>
      <PartyLists m={m} cur={cur} />
    </>
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

  const attentionDays = unclosed.filter((day) => day !== date);
  const pendingCount = pending.count ?? 0;

  return (
    <>
      <div className="page-heading day-heading">
        <h1 className="label-with-tip">
          Итог дня
          <InfoTip>Вечерняя сверка: сколько продали, сколько денег пришло и сколько наличных должно быть в кассе.</InfoTip>
        </h1>
        <DayNav date={date} today={today} prev={shift(-1)} next={shift(1)} />
      </div>
      <p className="muted day-date">{dateLabel}</p>
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

      {(attentionDays.length > 0 || pendingCount > 0) && (
        <div className="notice claims-notice unclosed-days day-attention" role="status">
          {attentionDays.length > 0 && (
            <p className="label-with-tip">
              <span>
                Не закрыты:{" "}
                {attentionDays.map((day, i) => (
                  <span key={day}>
                    {i > 0 && ", "}
                    <Link href={`/day?date=${day}`}>{dayName(day)}</Link>
                  </span>
                ))}
              </span>
              <InfoTip>Дни с записями, которые не закрыли. Откройте каждый, проверьте и закройте.</InfoTip>
            </p>
          )}
          {pendingCount > 0 && (
            <p>
              <Link href="/claims">Заявок ждут подтверждения: {pendingCount} →</Link>
            </p>
          )}
        </div>
      )}

      <CashCard
        summary={summary}
        date={date}
        isToday={isToday}
        closure={Boolean(closure)}
        closedTime={closure ? time(closure.closedAt) : null}
        afterCount={afterCount}
        pdfHref={pdfHref}
      />
      <DayTiles summary={summary} date={date} />
      <DebtLines summary={summary} />
      <PartyLists m={summary} cur={summary.currency ?? "KGS"} />
      {summary.foreign?.map((part) => <ForeignPart key={part.currency} m={part} />)}

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
          <h2 className="label-with-tip">
            После закрытия
            <InfoTip>
              Эти записи за {dayShort} внесены или отменены после закрытия — в сохранённые итоги выше они не
              вошли.
            </InfoTip>
          </h2>
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

      <details className="panel day-fold day-history-fold">
        <summary>История за {HISTORY_DAYS} дней</summary>
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
      </details>
    </>
  );
}
