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
import { ForeignSums } from "@/components/foreign-sums";
import { CURRENCY_SIGN } from "@/lib/currency";
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

/** «1 продажа», «3 продажи», «25 продаж». */
const salesWord = (n: number) => {
  const last = n % 10;
  const teen = n % 100 >= 11 && n % 100 <= 14;
  return `${n} ${!teen && last === 1 ? "продажа" : !teen && last >= 2 && last <= 4 ? "продажи" : "продаж"}`;
};

/** Вкладки «Подробности» у продавца (макет 29.10.2026). */
const TABS = [
  ["days", "По дням"],
  ["customers", "Клиенты"],
  ["sales", "Продажи"],
  ["debts", "Долги"],
] as const;
type Tab = (typeof TABS)[number][0];
const isTab = (value: string | undefined): value is Tab => TABS.some(([t]) => t === value);

/**
 * Продажи по продавцам. Владелец — список продавцов за месяц (или день) и
 * каждый отдельно: по дням, по клиентам, список продаж. Продавец видит
 * только свои продажи.
 */
export default async function Sellers({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; offset?: string; date?: string; tab?: string }>;
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
  // За один день «По дням» не нужно — сразу продажи.
  const defaultTab: Tab = day ? "sales" : "days";
  const tab: Tab = isTab(params.tab) && !(day && params.tab === "days") ? params.tab : defaultTab;

  const query = (o: { id?: string | null; offset?: number; date?: string | null; tab?: Tab | null }) => {
    const q = new URLSearchParams();
    const id = o.id === undefined ? (isOwner ? sellerId : null) : o.id;
    if (id) q.set("id", id);
    if (o.date) q.set("date", o.date);
    else if (o.offset) q.set("offset", String(o.offset));
    // Открытая вкладка остаётся при смене периода; у списка продавцов вкладок нет.
    const t = o.tab === undefined ? (id ? tab : null) : o.tab;
    if (t && t !== (o.date ? "sales" : "days")) q.set("tab", t);
    const s = q.toString();
    return `/sellers${s ? `?${s}` : ""}`;
  };
  const title = day ? fmt(day, { day: "numeric", month: "long", year: "numeric" }) : fmt(p.start, { month: "long", year: "numeric" }).replace(/ г\.$/, "");

  // Период на кнопке: «01.10 – 29.10.2026», один день — «15.10.2026».
  const periodText = start === end ? ruDate(start) : `${ruDate(start).slice(0, 5)} – ${ruDate(end)}`;
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
      <PeriodDayPicker value={day ?? ""} base={query({ offset: 0 })} periodText={periodText} />
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
      <DownloadMenu href={query({ date: day, offset, tab: null }).replace(/^\/sellers/, "/sellers/export")} label="Скачать" />
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
          {/* Телефон: шесть колонок не влезают — каждый продавец карточкой. */}
          <ul className="seller-cards">
            {rows.map((r) => (
              <li key={r.id ?? "none"}>
                <p className="seller-card-who">
                  {r.id ? <Link href={query({ id: r.id, offset, date: day })}>{r.name}</Link> : <strong>{r.name}</strong>}
                  <small className="muted">
                    {" "}
                    · {r.role === "owner" ? "владелец" : r.role === "staff" ? "продавец" : "нет в магазине"} · продаж {r.count}, клиентов{" "}
                    {r.customers}
                  </small>
                </p>
                <div className="day-line">
                  <span>Продано</span>
                  <strong>
                    {money(r.sold, cur)}
                    <ForeignSums items={r.foreign} pick="sold" />
                  </strong>
                </div>
                <div className="day-line">
                  <span>Собрано</span>
                  <strong>
                    {money(r.collected, cur)}
                    <ForeignSums items={r.foreign} pick="collected" />
                  </strong>
                </div>
                <div className="day-line">
                  <span>Должны клиенты</span>
                  <strong>
                    {r.id ? <Link href={`${query({ id: r.id, offset, date: day, tab: "debts" })}#details`}>{debtMoney(owed.get(r.id) ?? 0, cur)}</Link> : "-"}
                  </strong>
                </div>
              </li>
            ))}
          </ul>
          <div className="table-wrap seller-table">
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
                    <td>
                      {money(r.sold, cur)}
                      <ForeignSums items={r.foreign} pick="sold" />
                    </td>
                    <td>
                      {money(r.collected, cur)}
                      <ForeignSums items={r.foreign} pick="collected" />
                    </td>
                    <td>
                      {r.id ? <Link href={`${query({ id: r.id, offset, date: day, tab: "debts" })}#details`}>{debtMoney(owed.get(r.id) ?? 0, cur)}</Link> : "-"}
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
  const tabs = TABS.filter(([t]) => !(day && t === "days"));

  return (
    <>
      {isOwner && <ReportTabs current="sellers" />}
      {isOwner && (
        <Link className="back-link seller-back" href={query({ id: null, offset, date: day })}>
          ← Все продавцы
        </Link>
      )}
      <div className="page-heading day-heading">
        <div>
          <h1>{name}</h1>
          <p className="muted day-date">
            {isOwner ? `Отчёт продавца · ${title}` : title}
          </p>
        </div>
        {nav}
      </div>

      {/* За период: продано, оплата при продаже, собрано (макет 29.10.2026). */}
      <section className="panel seller-stats">
        <h2 className="day-card-title">За выбранный период</h2>
        <div className="seller-stat-row">
          <div className="seller-stat">
            <span>Продано</span>
            <strong>{money(detail.sold, cur)}</strong>
            <small>
              <span>{salesWord(detail.count)}</span>
              <span className="seller-stat-more">В долг: {money(detail.credit, cur)}</span>
            </small>
          </div>
          <div className="seller-stat">
            <span>Оплата при продаже</span>
            <strong>{money(detail.cash, cur)}</strong>
            <small>При оформлении продажи</small>
          </div>
          <div className="seller-stat">
            <span className="label-with-tip">
              Собрано
              <InfoTip>Оплаты долгов от клиентов, которые внёс этот продавец.</InfoTip>
            </span>
            <strong>{money(detail.collected, cur)}</strong>
            <small>Оплаты могут относиться к прошлым продажам</small>
          </div>
        </div>
        {detail.foreign.map((f) => (
          <p key={f.currency} className="seller-foreign">
            <strong>Отдельно в {CURRENCY_SIGN[f.currency]}</strong>: продано <strong>{money(f.sold, f.currency)}</strong>
            <span className="muted"> · {salesWord(f.count)}</span>
          </p>
        ))}
      </section>

      <section className="panel seller-debt">
        <div>
          <h2 className="day-card-title">
            <span className="seller-debt-long">{isOwner ? "Клиенты продавца должны сейчас" : "Мои клиенты должны сейчас"}</span>
            <span className="seller-debt-short">Долг клиентов сейчас</span>
          </h2>
          <strong>{debtMoney(debts.total, cur)}</strong>
          {debts.foreign.map((f) => (
            <small key={f.currency}>И в другой валюте: {debtMoney(f.total, f.currency)}</small>
          ))}
          <small>
            <span className="seller-debt-long">Текущий долг, отдельно от показателей за период</span>
            <span className="seller-debt-short">Отдельно от продаж за период</span>
          </small>
        </div>
        <Link className="seller-debt-link" href={`${query({ tab: "debts" })}#details`}>
          Посмотреть долги →
        </Link>
      </section>

      <section className="panel seller-details" id="details">
        <h2 className="day-card-title">Подробности</h2>
        <nav className="seller-tabs" aria-label="Подробности">
          {tabs.map(([t, label]) => (
            <Link
              key={t}
              href={`${query({ tab: t })}#details`}
              className={t === tab ? "active" : undefined}
              aria-current={t === tab ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>

        {tab === "days" &&
          (detail.days.length ? (
            <div className="table-wrap">
              <table className="seller-table-days">
                <thead>
                  <tr>
                    <th>День</th>
                    <th className="seller-num">Продаж</th>
                    <th className="seller-num">Клиентов</th>
                    <th className="seller-sum">Продано</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.days.map((d) => (
                    <tr key={d.date}>
                      <td>
                        <Link href={query({ date: d.date, tab: null })}>
                          <span className="seller-weekday">{fmt(d.date, { weekday: "short" })}, </span>
                          {fmt(d.date, { day: "numeric", month: "long" })}
                        </Link>
                      </td>
                      <td className="seller-num">{d.count}</td>
                      <td className="seller-num">{d.customers}</td>
                      <td className="seller-sum">{money(d.sold, cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Продаж за этот период нет.</p>
          ))}

        {tab === "customers" &&
          (detail.customers.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Клиент</th>
                    <th className="seller-num">Продаж</th>
                    <th className="seller-sum">Продано</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.customers.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/customers/${c.id}`}>{c.name}</Link>
                      </td>
                      <td className="seller-num">{c.count}</td>
                      <td className="seller-sum">{money(c.sold, cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Продаж за этот период нет.</p>
          ))}

        {tab === "sales" &&
          (detail.sales.length ? (
            <>
              {detail.sales.length >= 200 && <p className="muted">Показаны последние 200 продаж.</p>}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Когда</th>
                      <th>Клиент</th>
                      <th className="seller-sum">Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.sales.map((sale) => (
                      <tr key={sale.id}>
                        <td>{time(sale.date)}</td>
                        <td>
                          {sale.customerId ? (
                            <Link href={`/customers/${sale.customerId}`}>{sale.customerName}</Link>
                          ) : (
                            sale.customerName
                          )}
                        </td>
                        <td className="seller-sum">
                          {money(sale.total, sale.currency)}
                          {sale.paid && <small className="muted"> · оплачено</small>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="muted">Продаж за этот период нет.</p>
          ))}

        {tab === "debts" &&
          (debts.customers.length ? (
            <>
              <p className="muted">
                Клиенты, которым {isOwner ? "продавец" : "вы"} хоть раз оформляли продажу, и их долг магазину на сейчас - не за
                выбранный период.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Клиент</th>
                      <th className="seller-sum">Долг</th>
                    </tr>
                  </thead>
                  <tbody>
                    {debts.customers.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <Link href={`/customers/${c.id}`}>{c.name}</Link>
                        </td>
                        <td className="seller-sum">{debtMoney(c.balance, c.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="muted">Никто не должен.</p>
          ))}
      </section>
    </>
  );
}
