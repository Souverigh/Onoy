import Link from "next/link";
import { requireOwner } from "@/lib/context";
import { money } from "@/lib/format";
import { bishkekDate } from "@/lib/day-summary";
import { change, period, type PeriodKind } from "@/lib/periods";
import { periodReport } from "@/lib/period-report";
import { periodProfit } from "@/lib/profit";
import { quantity } from "@/lib/format";
import { sellersDebtTotals, sellersOverview } from "@/lib/seller-sales";
import { DayColumns } from "@/components/day-columns";
import { InfoTip } from "@/components/info-tip";
import { ReportTabs } from "@/components/report-tabs";
import { DownloadMenu } from "@/components/download-menu";
import { ForeignSums } from "@/components/foreign-sums";
import { CURRENCY_SIGN } from "@/lib/currency";
import { debtTotalsByCurrency, foreignBlocks } from "@/lib/debt-totals";

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

/** Прошлый период словами (задача 37): «прошлая неделя», а не «28 сентября». */
type Against = { to: string; during: string };

/** Сравнение с прошлым периодом — значком «▲ 12%»; без прошлых данных — ничего. */
function Delta({ current, previous, bad }: { current: number; previous: number; bad?: boolean }) {
  const pct = change(current, previous);
  if (pct === null) return null;
  const tone = pct === 0 ? "" : (pct > 0) !== Boolean(bad) ? " up" : " down";
  return (
    <span className={`report-delta${tone}`}>
      {pct > 0 ? "▲" : pct < 0 ? "▼" : "="} {pct > 0 ? "+" : ""}
      {pct}%
    </span>
  );
}

/** Прошлый период — для текста в «!». */
function previousText(current: number, previous: number, against: Against, cur: string) {
  if (previous === 0) return current > 0 ? `${against.during} - ${money(0, cur)}.` : `${against.during} - нет данных.`;
  return `${against.during} за те же дни - ${money(previous, cur)}.`;
}

export default async function Reports({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; offset?: string }>;
}) {
  const params = await searchParams;
  const kind: PeriodKind = params.period === "week" ? "week" : "month";
  const offset = Math.min(0, Math.max(-120, parseInt(params.offset ?? "0") || 0));
  const today = bishkekDate();
  const p = period(kind, today, offset);
  const { db, organizationId, currency: shopCurrency } = await requireOwner();
  const [report, sellers, owed, profit, debts] = await Promise.all([
    periodReport(db, organizationId, p),
    sellersOverview(db, organizationId, p.start, p.through, shopCurrency),
    sellersDebtTotals(db, organizationId, shopCurrency).catch(() => new Map<string, number>()),
    // Прибыль не посчиталась — остальной отчёт всё равно показываем.
    periodProfit(db, organizationId, shopCurrency, p.start, p.through).catch((error) => {
      console.error("Reports: profit failed", error);
      return null;
    }),
    // Долги в других валютах на сейчас — для блоков «В $», «В ₽».
    debtTotalsByCurrency(db, organizationId, shopCurrency).catch(() => []),
  ]);

  const title =
    kind === "month"
      ? fmt(p.start, { month: "long", year: "numeric" }).replace(/ г\.$/, "")
      : range(p.start, p.end);
  // Те же дни прошлого периода — словами.
  const against: Against =
    kind === "week"
      ? { to: "прошлой неделе", during: "Прошлая неделя" }
      : { to: "прошлому месяцу", during: "Прошлый месяц" };
  const href = (k: PeriodKind, o: number) => `/reports?period=${k}${o ? `&offset=${o}` : ""}`;
  const { current, previous } = report;
  const cur = report.currency;
  const foreign = foreignBlocks(report.foreign, debts, report.currency);

  return (
    <>
      <ReportTabs current="month" />
      <div className="page-heading day-heading">
        <h1 className="label-with-tip">
          {kind === "week" ? "Отчёт за неделю" : "Отчёт за месяц"}
          <InfoTip>
            Сколько продали, собрали и потратили за {kind === "week" ? "неделю" : "месяц"}. Проценты - сравнение с теми
            же днями {kind === "week" ? "прошлой недели" : "прошлого месяца"}.
          </InfoTip>
        </h1>
        <div className="day-nav">
          <nav className="pill-switch report-switch" aria-label="Период">
            <Link className={kind === "month" ? "selected" : ""} href={href("month", 0)}>
              Месяц
            </Link>
            <Link className={kind === "week" ? "selected" : ""} href={href("week", 0)}>
              Неделя
            </Link>
          </nav>
          <Link
            className="day-nav-arrow"
            href={href(kind, offset - 1)}
            aria-label={kind === "week" ? "Прошлая неделя" : "Прошлый месяц"}
          >
            ‹
          </Link>
          {offset < 0 ? (
            <Link
              className="day-nav-arrow"
              href={href(kind, offset + 1)}
              aria-label={kind === "week" ? "Следующая неделя" : "Следующий месяц"}
            >
              ›
            </Link>
          ) : (
            <span className="day-nav-arrow disabled" aria-hidden="true">
              ›
            </span>
          )}
          <DownloadMenu href={`/reports/export?period=${kind}${offset ? `&offset=${offset}` : ""}`} />
        </div>
      </div>
      <p className="muted day-date">
        {title}
        {offset === 0 && p.through < p.end ? ` · по ${fmt(p.through, { day: "numeric", month: "long" })}` : ""}
      </p>

      <section className="day-tiles" aria-label="Отчёт">
        <article className="panel day-tile">
          <span className="label-with-tip">
            Продано
            <InfoTip>
              Продаж: {current.salesCount}. В долг - {money(current.soldCredit, cur)}, сразу наличными -{" "}
              {money(current.soldCash, cur)}. {previousText(current.sold, previous.sold, against, cur)}
            </InfoTip>
          </span>
          <strong>{money(current.sold, cur)}</strong>
          <small className="muted">
            в долг {money(current.soldCredit, cur)} <Delta current={current.sold} previous={previous.sold} />
          </small>
        </article>
        <article className="panel day-tile">
          <span className="label-with-tip">
            Собрано
            <InfoTip>
              Оплаты долгов от клиентов - без продаж за наличные.{" "}
              {previousText(current.collected, previous.collected, against, cur)}
            </InfoTip>
          </span>
          <strong>{money(current.collected, cur)}</strong>
          <small className="muted">
            с клиентов <Delta current={current.collected} previous={previous.collected} />
          </small>
        </article>
        <article className="panel day-tile">
          <span className="label-with-tip">
            Расходы
            <InfoTip>
              Аренда, зарплата, доставка и другие расходы магазина.{" "}
              {previousText(current.expenses, previous.expenses, against, cur)}
            </InfoTip>
          </span>
          <strong>{money(current.expenses, cur)}</strong>
          <small>
            <Link href="/money/expenses">все расходы →</Link>{" "}
            <Delta current={current.expenses} previous={previous.expenses} bad />
          </small>
        </article>
      </section>

      <section className="panel day-debts">
        <div className="day-line">
          <span className="label-with-tip">
            Товар от поставщиков
            <InfoTip>{previousText(current.purchased, previous.purchased, against, cur)}</InfoTip>
          </span>
          <strong>{money(current.purchased, cur)}</strong>
        </div>
        <div className="day-line">
          <span className="label-with-tip">
            Оплачено поставщикам
            <InfoTip>{previousText(current.paidSuppliers, previous.paidSuppliers, against, cur)}</InfoTip>
          </span>
          <strong>{money(current.paidSuppliers, cur)}</strong>
        </div>
      </section>


      {/* Прибыль и лидеры (просьба пользователя 17.10.2026). */}
      {profit && (
        <section className="panel report-profit">
          <h2 className="label-with-tip">
            Прибыль
            <InfoTip>
              Выручка по товарам склада минус их закупочная цена (средняя по приходам), минус скидки и возвраты. Расходы
              магазина - отдельно, выше.
            </InfoTip>
          </h2>
          {profit.revenue > 0 ? (
            <>
              <strong className={profit.profit < 0 ? "report-profit-value negative" : "report-profit-value"}>
                {money(profit.profit, cur)}
              </strong>
              <dl className="report-profit-lines">
                <dt>Выручка по товарам</dt>
                <dd>{money(profit.revenue, cur)}</dd>
                <dt>Себестоимость (закупка)</dt>
                <dd>− {money(profit.cost, cur)}</dd>
                {profit.discounts > 0 && (
                  <>
                    <dt>Скидки клиентам</dt>
                    <dd>− {money(profit.discounts, cur)}</dd>
                  </>
                )}
                {profit.returns.revenue > 0 && (
                  <>
                    <dt>Возвраты товара</dt>
                    <dd>− {money(Math.round((profit.returns.revenue - profit.returns.cost) * 100) / 100, cur)}</dd>
                  </>
                )}
                <dt>Наценка</dt>
                <dd>{profit.cost > 0 ? `${Math.round(((profit.revenue - profit.cost) / profit.cost) * 100)}%` : "-"}</dd>
                {current.expenses > 0 && (
                  <>
                    <dt>Прибыль минус расходы магазина</dt>
                    <dd>
                      <strong>{money(Math.round((profit.profit - current.expenses) * 100) / 100, cur)}</strong>
                    </dd>
                  </>
                )}
              </dl>
              {profit.coverage < 0.995 && (
                <p className="muted">
                  Посчитано по {Math.round(profit.coverage * 100)}% продаж ({money(profit.revenue, cur)} из{" "}
                  {money(profit.sold, cur)}). Не входят продажи одной суммой, строки без товара склада и товары без
                  закупочной цены.
                </p>
              )}
            </>
          ) : (
            <p className="muted">
              {profit.sold > 0
                ? "Прибыль считается по товарам склада с закупочной ценой. В этом периоде таких продаж нет - продажи записаны суммой или без закупочной цены."
                : "Продаж в этом периоде нет."}
            </p>
          )}
          {profit.withoutCost.length > 0 && (
            <p className="muted">
              Без закупочной цены:{" "}
              {profit.withoutCost.slice(0, 5).map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ", "}
                  <Link href={`/stock/${p.id}`}>{p.name}</Link>
                </span>
              ))}
              {profit.withoutCost.length > 5 && ` и ещё ${profit.withoutCost.length - 5}`}. Укажите цену закупки - они
              войдут в прибыль.
            </p>
          )}
        </section>
      )}

      {profit && (profit.topProducts.length > 0 || profit.topCustomers.length > 0) && (
        <div className="report-leaders">
          {profit.topProducts.length > 0 && (
            <section className="panel">
              <h2 className="label-with-tip">
                Что продаётся лучше всего
                <InfoTip>Товары склада по выручке за период. Прибыль - выручка минус закупочная цена.</InfoTip>
              </h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Товар</th>
                      <th>Продано</th>
                      <th>Выручка</th>
                      <th>Прибыль</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profit.topProducts.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/stock/${p.id}`}>{p.name}</Link>
                        </td>
                        <td className="nowrap">
                          {quantity(p.qty)} {p.unit}
                        </td>
                        <td className="nowrap">{money(p.revenue, cur)}</td>
                        <td className="nowrap">{p.profit == null ? <span className="muted">нет закупки</span> : money(p.profit, cur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {profit.topCustomers.length > 0 && (
            <section className="panel">
              <h2 className="label-with-tip">
                Лучшие клиенты
                <InfoTip>Кто больше всех купил за период - в долг и за наличные.</InfoTip>
              </h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Клиент</th>
                      <th>Продаж</th>
                      <th>Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profit.topCustomers.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <Link href={`/customers/${c.id}`}>{c.name}</Link>
                        </td>
                        <td>{c.count}</td>
                        <td className="nowrap">{money(c.sold, cur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}

      {foreign.map((f) => {
        const sign = CURRENCY_SIGN[f.currency];
        const lines = f.lines;
        return (
          <section key={f.currency} className="panel day-debts">
            <h2 className="day-foreign-title label-with-tip">
              В {sign}
              <InfoTip>
                Записи в {sign} считаются отдельно и не складываются с основными суммами. Долги - на сейчас, а не за
                период.
              </InfoTip>
            </h2>
            {lines.map((line) => (
              <div className="day-line" key={line.label}>
                <span>{line.label}</span>
                <strong>{money(line.value, f.currency)}</strong>
              </div>
            ))}
          </section>
        );
      })}

      <section className="report-charts">
        <div className="panel">
          <DayColumns
            title={`Продано по дням, ${CURRENCY_SIGN[cur]}`}
            currency={cur}
            through={p.through}
            points={report.days.map((d) => ({ date: d.date, value: d.sold }))}
          />
        </div>
        <div className="panel">
          <DayColumns
            title={`Собрано с клиентов по дням, ${CURRENCY_SIGN[cur]}`}
            currency={cur}
            through={p.through}
            points={report.days.map((d) => ({ date: d.date, value: d.collected }))}
          />
        </div>
      </section>

      <section className="panel report-debtors">
        <h2 className="label-with-tip">
          Больше всего должны
          <InfoTip>Долг на сейчас, а не за выбранный период.</InfoTip>
        </h2>
        {report.topDebtors.length ? (
          <ol className="top-debtors">
            {report.topDebtors.map((d) => (
              <li key={d.id}>
                <Link href={`/customers/${d.id}`}>{d.name}</Link>
                {d.oldestDays != null && d.oldestDays > 30 && (
                  <span className="tag reversed-tag">долг {d.oldestDays} дн.</span>
                )}
                <strong>{money(d.balance, cur)}</strong>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">Никто не должен.</p>
        )}
      </section>

      {/* По продавцам — когда в магазине работают сотрудники. */}
      {sellers.some((s) => s.role === "staff") && (
        <section className="panel">
          <h2 className="label-with-tip">
            По продавцам
            <InfoTip>Нажмите на имя - продажи продавца по дням и по клиентам.</InfoTip>
          </h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Кто</th>
                  <th>Продаж</th>
                  <th>Клиентов</th>
                  <th>Продано</th>
                  <th>Собрано</th>
                  <th>Должны клиенты</th>
                </tr>
              </thead>
              <tbody>
                {sellers.map((s) => (
                  <tr key={s.id ?? "none"}>
                    <td>
                      {s.id && kind === "month" ? (
                        <Link href={`/sellers?id=${s.id}${offset ? `&offset=${offset}` : ""}`}>{s.name}</Link>
                      ) : s.id ? (
                        <Link href={`/sellers?id=${s.id}`}>{s.name}</Link>
                      ) : (
                        s.name
                      )}
                    </td>
                    <td>{s.count}</td>
                    <td>{s.customers}</td>
                    <td>
                      {money(s.sold, cur)}
                      <ForeignSums items={s.foreign} pick="sold" />
                    </td>
                    <td>
                      {money(s.collected, cur)}
                      <ForeignSums items={s.foreign} pick="collected" />
                    </td>
                    <td>{s.id ? <Link href={`/sellers?id=${s.id}#debts`}>{money(owed.get(s.id) ?? 0, cur)}</Link> : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <details className="panel day-fold report-table">
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
                    <td>{money(d.sold, cur)}</td>
                    <td>{money(d.collected, cur)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
