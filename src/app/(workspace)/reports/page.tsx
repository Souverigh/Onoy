import Link from "next/link";
import { requireOwner } from "@/lib/context";
import { money } from "@/lib/format";
import { bishkekDate } from "@/lib/day-summary";
import { period, type PeriodKind } from "@/lib/periods";
import { periodReport } from "@/lib/period-report";
import { periodProfit } from "@/lib/profit";
import { quantity } from "@/lib/format";
import { sellersDebtTotals, sellersOverview } from "@/lib/seller-sales";
import { DayColumns } from "@/components/day-columns";
import { InfoTip } from "@/components/info-tip";
import { Icon } from "@/components/icon";
import { ReportTabs } from "@/components/report-tabs";
import { DownloadMenu } from "@/components/download-menu";
import { ForeignSums } from "@/components/foreign-sums";
import { CURRENCY_SIGN } from "@/lib/currency";
import { debtTotalsByCurrency, foreignBlocks } from "@/lib/debt-totals";

/** Сколько периодов назад предлагает список «Октябрь 2026 ▾». */
const PERIOD_MENU = 12;

const fmt = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", ...options }).format(
    new Date(`${date}T12:00:00+06:00`),
  );

/** «21–27 сентября», «29 сентября – 5 октября». */
function range(start: string, end: string) {
  if (start === end) return fmt(start, { day: "numeric", month: "long" });
  return start.slice(0, 7) === end.slice(0, 7)
    ? `${Number(start.slice(8))} – ${fmt(end, { day: "numeric", month: "long" })}`
    : `${fmt(start, { day: "numeric", month: "long" })} – ${fmt(end, { day: "numeric", month: "long" })}`;
}

/** «Октябрь 2026». */
const monthName = (date: string) => {
  const text = fmt(date, { month: "long", year: "numeric" }).replace(/ г\.$/, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Отчёт за месяц / неделю (макет 29.10.2026): три карточки сверху, пояснение,
 * прибыль и поставщики рядом, ниже — разделы, которые раскрываются: товары,
 * клиенты, графики и таблица по дням, другие валюты.
 */
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
    // Долги в других валютах на сейчас — для раздела «Другие валюты».
    debtTotalsByCurrency(db, organizationId, shopCurrency).catch(() => []),
  ]);

  const word = kind === "week" ? "неделю" : "месяц";
  const href = (k: PeriodKind, o: number) => `/reports?period=${k}${o ? `&offset=${o}` : ""}`;
  // Название периода на кнопке: «Октябрь 2026» или «21 – 27 октября».
  const periodName = (o: number) => {
    const q = period(kind, today, o);
    return kind === "month" ? monthName(q.start) : range(q.start, q.end);
  };
  const subtitle = `${range(p.start, p.through)} ${p.through.slice(0, 4)}`;
  const { current } = report;
  const cur = report.currency;
  const foreign = foreignBlocks(report.foreign, debts, report.currency);
  // Деньги от клиентов: продажи «сразу наличными» и оплаты долгов — как «Получено» в итоге дня.
  const received = round(current.soldCash + current.collected);
  const partial = Boolean(profit && profit.revenue > 0 && profit.coverage < 0.995);
  const afterExpenses = profit ? round(profit.profit - current.expenses) : 0;

  return (
    <>
      <ReportTabs current="month" />
      <div className="page-heading day-heading report-heading">
        <div>
          <h1>{kind === "week" ? "Отчёт за неделю" : "Отчёт за месяц"}</h1>
          <p className="muted day-date">{subtitle}</p>
        </div>
        <div className="day-nav report-nav">
          {/* На телефоне «Месяц / Неделя» — отдельной строкой под датой, по центру. */}
          <div className="report-switch-row">
            <nav className="pill-switch report-switch" aria-label="Период">
              <Link className={kind === "month" ? "selected" : ""} href={href("month", 0)}>
                Месяц
              </Link>
              <Link className={kind === "week" ? "selected" : ""} href={href("week", 0)}>
                Неделя
              </Link>
            </nav>
          </div>
          <details className="more-menu report-period">
            <summary className="report-period-button">
              <Icon name="calendar" />
              <span>{periodName(offset)}</span>
              <span aria-hidden="true">▾</span>
            </summary>
            <div className="more-menu-list">
              {Array.from({ length: PERIOD_MENU }, (_, i) => -i).map((o) => (
                <Link key={o} href={href(kind, o)} className={o === offset ? "selected" : undefined}>
                  {periodName(o)}
                </Link>
              ))}
            </div>
          </details>
          <Link className="day-nav-arrow" href={href(kind, offset - 1)} aria-label={kind === "week" ? "Прошлая неделя" : "Прошлый месяц"}>
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
          <DownloadMenu href={`/reports/export?period=${kind}${offset ? `&offset=${offset}` : ""}`} label="Скачать" />
        </div>
      </div>

      <section className="report-kpis" aria-label="Итоги">
        <article className="panel report-kpi">
          <span className="report-kpi-icon" aria-hidden="true">
            <Icon name="box" />
          </span>
          <div>
            <span>Продано</span>
            <strong>{money(current.sold, cur)}</strong>
            <small>В долг: {money(current.soldCredit, cur)}</small>
          </div>
        </article>
        <article className="panel report-kpi">
          <span className="report-kpi-icon" aria-hidden="true">
            <Icon name="people" />
          </span>
          <div>
            <span>Получено от клиентов</span>
            <strong>{money(received, cur)}</strong>
            <small>
              {current.soldCash > 0
                ? `Сразу при продаже ${money(current.soldCash, cur)} · оплаты долгов ${money(current.collected, cur)}`
                : "Включая оплату прошлых продаж"}
            </small>
          </div>
        </article>
        <article className="panel report-kpi">
          <span className="report-kpi-icon" aria-hidden="true">
            <Icon name="wallet" />
          </span>
          <div>
            <span>Расходы</span>
            <strong>{money(current.expenses, cur)}</strong>
            <small>
              <Link className="report-kpi-link" href={`/money/expenses?month=${p.start.slice(0, 7)}`}>
                Все расходы →
              </Link>
            </small>
          </div>
        </article>
      </section>

      {(current.sold > 0 || received > 0) && (
        <p className="report-note">
          <span className="day-attention-icon" aria-hidden="true">
            !
          </span>
          <span>
            Продажи и полученные деньги - разные показатели.
            {current.sold > 0 && current.soldCash === 0 && ` Все продажи за ${word} оформлены в долг.`} Полученные деньги
            могут относиться к предыдущим периодам.
          </span>
        </p>
      )}

      <div className="report-pair">
        {profit && (
          <section className="panel report-profit">
            <h2 className="report-card-title">
              <Icon name="chart" />
              Прибыль по учтённым товарам
              {partial && <span className="report-partial">Неполный расчёт</span>}
            </h2>
            {profit.revenue > 0 ? (
              <>
                <strong className={profit.profit < 0 ? "report-profit-value negative" : "report-profit-value"}>
                  {money(profit.profit, cur)}
                </strong>
                {partial && (
                  <p className="report-warn">
                    <span className="day-attention-icon" aria-hidden="true">
                      !
                    </span>
                    Учтено {Math.round(profit.coverage * 100)}% продаж: {quantity(round(profit.revenue))} из{" "}
                    {money(profit.sold, cur)}.
                  </p>
                )}
                <dl className="report-profit-lines">
                  <dt>Выручка учтённых товаров</dt>
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
                      <dd>− {money(round(profit.returns.revenue - profit.returns.cost), cur)}</dd>
                    </>
                  )}
                  <dt>Наценка</dt>
                  <dd>{profit.cost > 0 ? `${Math.round(((profit.revenue - profit.cost) / profit.cost) * 100)}%` : "-"}</dd>
                  {current.expenses > 0 && (
                    <>
                      <dt>После вычета расходов магазина</dt>
                      <dd>
                        <strong>{money(afterExpenses, cur)}</strong>
                      </dd>
                    </>
                  )}
                </dl>
                {partial && current.expenses > 0 && (
                  <p className="report-warn">
                    <span className="day-attention-icon" aria-hidden="true">
                      !
                    </span>
                    Также неполный расчёт.
                  </p>
                )}
                {partial && (
                  <p className="muted">Не учтены продажи одной суммой, строки без товара склада и товары без закупочной цены.</p>
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
                {profit.withoutCost.slice(0, 5).map((item, i) => (
                  <span key={item.id}>
                    {i > 0 && ", "}
                    <Link href={`/stock/${item.id}`}>{item.name}</Link>
                  </span>
                ))}
                {profit.withoutCost.length > 5 && ` и ещё ${profit.withoutCost.length - 5}`}. Укажите цену закупки - они
                войдут в прибыль.
              </p>
            )}
          </section>
        )}
        <section className="panel report-suppliers">
          <h2 className="report-card-title">
            <Icon name="truck" />
            Поставщики за период
          </h2>
          <div className="day-line">
            <span>Получено товара</span>
            <strong>{money(current.purchased, cur)}</strong>
          </div>
          <div className="day-line">
            <span>Оплачено поставщикам</span>
            <strong>{money(current.paidSuppliers, cur)}</strong>
          </div>
          <p className="report-hint">
            <span className="report-hint-icon" aria-hidden="true">
              i
            </span>
            <span>
              Это движение товаров и оплат за период.
              <br />
              Не является текущим долгом поставщикам.
            </span>
          </p>
        </section>
      </div>

      {profit && profit.topProducts.length > 0 && (
        <details className="panel report-section" open>
          <summary>
            <span className="report-section-title">
              <Icon name="chart" />
              Товары · что продаётся лучше всего
            </span>
            <Link className="report-section-link" href="/stock">
              Все товары →
            </Link>
          </summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Товар</th>
                  <th>Кол-во</th>
                  <th>Продажи</th>
                  <th>Прибыль</th>
                </tr>
              </thead>
              <tbody>
                {profit.topProducts.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link href={`/stock/${item.id}`}>{item.name}</Link>
                    </td>
                    <td className="nowrap">
                      {quantity(item.qty)} {item.unit}
                    </td>
                    <td className="nowrap">{money(item.revenue, cur)}</td>
                    <td className="nowrap">
                      {item.profit == null ? <span className="muted">Нет закупочной цены</span> : money(item.profit, cur)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted report-section-foot">Показаны первые позиции. Полный список - в разделе товаров.</p>
        </details>
      )}

      <details className="panel report-section">
        <summary>
          <span className="report-section-title">
            <Icon name="people" />
            Клиенты · покупки и текущие долги
          </span>
          <span className="report-section-desc">Продажи за период и текущие долги клиентов (отдельно от полученных оплат)</span>
        </summary>
        <div className="report-section-body">
          {profit && profit.topCustomers.length > 0 && (
            <div>
              <h3 className="label-with-tip">
                Лучшие клиенты
                <InfoTip>Кто больше всех купил за период - в долг и за наличные.</InfoTip>
              </h3>
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
            </div>
          )}
          <div>
            <h3 className="label-with-tip">
              Больше всего должны
              <InfoTip>Долг на сейчас, а не за выбранный период.</InfoTip>
            </h3>
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
          </div>
        </div>
      </details>

      {/* По продавцам — когда в магазине работают сотрудники. */}
      {sellers.some((s) => s.role === "staff") && (
        <details className="panel report-section">
          <summary>
            <span className="report-section-title">
              <Icon name="user" />
              Продавцы · продажи за период
            </span>
            <span className="report-section-desc">Нажмите на имя - продажи продавца по дням и по клиентам</span>
          </summary>
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
        </details>
      )}

      <details className="panel report-section">
        <summary>
          <span className="report-section-title">
            <Icon name="chart" />
            Графики и таблица по дням
          </span>
          <span className="report-section-desc">Ежедневные продажи и полученные оплаты</span>
        </summary>
        <div className="report-charts">
          <DayColumns
            title={`Продано по дням, ${CURRENCY_SIGN[cur]}`}
            currency={cur}
            through={p.through}
            points={report.days.map((d) => ({ date: d.date, value: d.sold }))}
          />
          <DayColumns
            title={`Оплаты долгов по дням, ${CURRENCY_SIGN[cur]}`}
            currency={cur}
            through={p.through}
            points={report.days.map((d) => ({ date: d.date, value: d.collected }))}
          />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>День</th>
                <th>Продано</th>
                <th>Оплаты долгов</th>
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

      {foreign.length > 0 && (
        <details className="panel report-section">
          <summary>
            <span className="report-section-title">
              <Icon name="coin" />
              Другие валюты
            </span>
            <span className="report-section-desc">
              Продажи и оплаты за период · текущие долги отдельно ({foreign.map((f) => CURRENCY_SIGN[f.currency]).join(", ")})
            </span>
          </summary>
          <div className="report-section-body">
            {foreign.map((f) => (
              <div key={f.currency}>
                <h3 className="label-with-tip">
                  В {CURRENCY_SIGN[f.currency]}
                  <InfoTip>
                    Записи в {CURRENCY_SIGN[f.currency]} считаются отдельно и не складываются с основными суммами. Долги - на
                    сейчас, а не за период.
                  </InfoTip>
                </h3>
                {f.lines.map((line) => (
                  <div className="day-line" key={line.label}>
                    <span>{line.label}</span>
                    <strong>{money(line.value, f.currency)}</strong>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
