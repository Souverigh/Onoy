import Link from "next/link";
import { getContext } from "@/lib/context";
import { debtMoney, money } from "@/lib/format";
import { bishkekDate } from "@/lib/day-summary";
import { period } from "@/lib/periods";
import { memberLabels } from "@/lib/members";
import { sellerCustomerDebts, sellerDetail, sellersDebtTotals, sellersOverview } from "@/lib/seller-sales";
import { InfoTip } from "@/components/info-tip";
import { PeriodDayPicker } from "@/components/day-nav";
import { DownloadMenu } from "@/components/download-menu";
import { ruDate } from "@/lib/ru-date";
import { ReportTabs } from "@/components/report-tabs";

const fmt = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", ...options }).format(
    new Date(`${date}T12:00:00+06:00`),
  );
const time = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Продажи по продавцам. Владелец — список продавцов за месяц (или день) и
 * каждый отдельно: по дням, по клиентам, список продаж. Продавец видит
 * только свои продажи.
 */
export default async function Sellers({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; offset?: string; date?: string }>;
}) {
  const params = await searchParams;
  const { db, organizationId, user, isOwner, currency: cur } = await getContext();
  const today = bishkekDate();
  // ?date=YYYY-MM-DD — один день (из итога дня), иначе месяц со сдвигом.
  const day = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) && params.date <= today ? params.date : null;
  const offset = Math.min(0, Math.max(-120, parseInt(params.offset ?? "0") || 0));
  const p = period("month", today, offset);
  const start = day ?? p.start;
  const end = day ?? p.through;
  const sellerId = isOwner ? (params.id && uuidPattern.test(params.id) ? params.id : null) : user.id;

  const query = (o: { id?: string | null; offset?: number; date?: string | null }) => {
    const q = new URLSearchParams();
    const id = o.id === undefined ? (isOwner ? sellerId : null) : o.id;
    if (id) q.set("id", id);
    if (o.date) q.set("date", o.date);
    else if (o.offset) q.set("offset", String(o.offset));
    const s = q.toString();
    return `/sellers${s ? `?${s}` : ""}`;
  };
  const title = day ? fmt(day, { day: "numeric", month: "long", year: "numeric" }) : fmt(p.start, { month: "long", year: "numeric" }).replace(/ г\.$/, "");

  // Период датами: «01.10.2026 – 21.10.2026» (один день — одной датой).
  const periodText = start === end ? ruDate(start) : `${ruDate(start)} – ${ruDate(end)}`;
  const nav = (
    <div className="day-nav">
      {day ? (
        <Link className="button" href={query({ offset: 0 })}>
          Весь месяц
        </Link>
      ) : (
        <Link className="day-nav-arrow" href={query({ offset: offset - 1 })} aria-label="Прошлый месяц">
          ‹
        </Link>
      )}
      <span className="day-nav-period">{periodText}</span>
      <PeriodDayPicker value={day ?? ""} base={query({ offset: 0 })} />
      {!day &&
        (offset < 0 ? (
          <Link className="day-nav-arrow" href={query({ offset: offset + 1 })} aria-label="Следующий месяц">
            ›
          </Link>
        ) : (
          <span className="day-nav-arrow disabled" aria-hidden="true">
            ›
          </span>
        ))}
      <DownloadMenu href={query({ date: day, offset }).replace(/^\/sellers/, "/sellers/export")} />
    </div>
  );

  if (!sellerId) {
    const [rows, owed] = await Promise.all([
      sellersOverview(db, organizationId, start, end, cur),
      sellersDebtTotals(db, organizationId, cur),
    ]);
    return (
      <>
        <ReportTabs current="sellers" />
        <div className="page-heading day-heading">
          <h1 className="label-with-tip">
            Продажи продавцов
            <InfoTip>Кто сколько оформил продаж и собрал оплат. Продажа считается за того, кто её внёс.</InfoTip>
          </h1>
          {nav}
        </div>
        <p className="muted day-date">{title}</p>
        <section className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Кто</th>
                  <th>Продаж</th>
                  <th>Клиентов</th>
                  <th>Продано</th>
                  <th>Собрано</th>
                  <th>
                    <span className="label-with-tip">
                      Должны клиенты
                      <InfoTip>Долг на сейчас клиентов, которым продавец хоть раз продавал. Нажмите на имя - по каждому клиенту.</InfoTip>
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id ?? "none"}>
                    <td>
                      {r.id ? <Link href={query({ id: r.id, offset, date: day })}>{r.name}</Link> : r.name}
                      <small className="muted"> · {r.role === "owner" ? "владелец" : r.role === "staff" ? "продавец" : "нет в магазине"}</small>
                    </td>
                    <td>{r.count}</td>
                    <td>{r.customers}</td>
                    <td>{money(r.sold, cur)}</td>
                    <td>{money(r.collected, cur)}</td>
                    <td>
                      {r.id ? <Link href={`${query({ id: r.id, offset, date: day })}#debts`}>{debtMoney(owed.get(r.id) ?? 0, cur)}</Link> : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </>
    );
  }

  const [detail, members, debts] = await Promise.all([
    sellerDetail(db, organizationId, sellerId, start, end, cur),
    memberLabels(db, organizationId),
    sellerCustomerDebts(db, organizationId, sellerId, cur),
  ]);
  const name = isOwner ? (members.get(sellerId)?.name ?? "Продавец") : "Мои продажи";

  return (
    <>
      {isOwner && <ReportTabs current="sellers" />}
      <div className="page-heading day-heading">
        <h1>{name}</h1>
        {nav}
      </div>
      <p className="muted day-date">
        {isOwner && (
          <>
            <Link href={query({ id: null, offset, date: day })}>← Все продавцы</Link> ·{" "}
          </>
        )}
        {title}
      </p>

      <section className="day-tiles" aria-label="Итог">
        <article className="panel day-tile">
          <span>Продано</span>
          <strong>{money(detail.sold, cur)}</strong>
          <small className="muted">
            продаж: {detail.count} · в долг {money(detail.credit, cur)}
          </small>
        </article>
        <article className="panel day-tile">
          <span>Сразу оплатили</span>
          <strong>{money(detail.cash, cur)}</strong>
        </article>
        <article className="panel day-tile">
          <span className="label-with-tip">
            Собрано
            <InfoTip>Оплаты долгов от клиентов, которые внёс этот продавец.</InfoTip>
          </span>
          <strong>{money(detail.collected, cur)}</strong>
        </article>
      </section>
      {detail.foreign.map((f) => (
        <p key={f.currency} className="muted">
          Продажи в другой валюте: {money(f.sold, f.currency)} ({f.count})
        </p>
      ))}

      {!detail.count && !detail.foreign.length ? (
        <p className="muted">Продаж за этот период нет.</p>
      ) : (
        <>
          {!day && (
            <section className="panel">
              <h2>По дням</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>День</th>
                      <th>Продаж</th>
                      <th>Клиентов</th>
                      <th>Продано</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.days.map((d) => (
                      <tr key={d.date}>
                        <td>
                          <Link href={query({ date: d.date })}>{fmt(d.date, { day: "numeric", month: "long", weekday: "short" })}</Link>
                        </td>
                        <td>{d.count}</td>
                        <td>{d.customers}</td>
                        <td>{money(d.sold, cur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="panel">
            <h2>По клиентам</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Клиент</th>
                    <th>Продаж</th>
                    <th>Продано</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.customers.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/customers/${c.id}`}>{c.name}</Link>
                      </td>
                      <td>{c.count}</td>
                      <td>{money(c.sold, cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <details className="panel day-fold report-table" open={Boolean(day)}>
            <summary>Все продажи{detail.sales.length >= 200 ? " (последние 200)" : ""}</summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Когда</th>
                    <th>Клиент</th>
                    <th>Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.sales.map((s) => (
                    <tr key={s.id}>
                      <td>{time(s.date)}</td>
                      <td>
                        {s.customerId ? <Link href={`/customers/${s.customerId}`}>{s.customerName}</Link> : s.customerName}
                      </td>
                      <td>
                        {money(s.total, s.currency)}
                        {s.paid && <small className="muted"> · оплачено</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}

      <section className="panel" id="debts">
        <h2 className="label-with-tip">
          {isOwner ? "Должны клиенты продавца" : "Мне должны"}: {debtMoney(debts.total, cur)}
          <InfoTip>
            Клиенты, которым {isOwner ? "продавец" : "вы"} хоть раз оформляли продажу, и их долг магазину на сейчас - не
            за выбранный период.
          </InfoTip>
        </h2>
        {debts.foreign.map((f) => (
          <p key={f.currency} className="muted">
            И в другой валюте: {debtMoney(f.total, f.currency)}
          </p>
        ))}
        {debts.customers.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Клиент</th>
                  <th>Долг</th>
                </tr>
              </thead>
              <tbody>
                {debts.customers.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/customers/${c.id}`}>{c.name}</Link>
                    </td>
                    <td>{debtMoney(c.balance, c.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Никто не должен.</p>
        )}
      </section>
    </>
  );
}
