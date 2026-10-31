import Link from "next/link";
import { money, quantity } from "@/lib/format";
import { change, period } from "@/lib/periods";
import { SHARE_LIMITS, shareLevel } from "@/lib/dish";
import type { ItemStat } from "@/lib/kitchen-stats";
import type { KitchenMonth, ProductRise, ProductUse } from "@/lib/kitchen-report";
import { Icon } from "./icon";
import { DishLists } from "./kitchen-dish-lists";

const fmt = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", ...options }).format(new Date(`${date}T12:00:00+06:00`));

/** «Октябрь 2026». */
export const monthTitle = (date: string) => {
  const text = fmt(date, { month: "long", year: "numeric" }).replace(/ г\.$/, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** «октябрь» — в заголовке «Блюда за октябрь». */
export const monthWord = (date: string) => fmt(date, { month: "long" });

/** Месяц: список «Октябрь 2026 ▾» и стрелки — как в отчёте за месяц. */
export function MonthNav({ base, offset, today }: { base: string; offset: number; today: string }) {
  const href = (o: number) => `${base}${o ? `?offset=${o}` : ""}`;
  return (
    <div className="day-nav report-nav">
      <details className="more-menu report-period">
        <summary className="report-period-button">
          <Icon name="calendar" />
          <span>{monthTitle(period("month", today, offset).start)}</span>
          <span aria-hidden="true">▾</span>
        </summary>
        <div className="more-menu-list">
          {Array.from({ length: 12 }, (_, i) => -i).map((o) => (
            <Link key={o} href={href(o)} className={o === offset ? "selected" : undefined}>
              {monthTitle(period("month", today, o).start)}
            </Link>
          ))}
        </div>
      </details>
      <Link className="day-nav-arrow" href={href(offset - 1)} aria-label="Прошлый месяц">
        ‹
      </Link>
      {offset < 0 ? (
        <Link className="day-nav-arrow" href={href(offset + 1)} aria-label="Следующий месяц">
          ›
        </Link>
      ) : (
        <span className="day-nav-arrow disabled" aria-hidden="true">
          ›
        </span>
      )}
    </div>
  );
}

/**
 * «Кафе за месяц» (макет 31.10.2026): выручка − продукты = заработок на
 * блюдах − расходы = осталось чистыми. Компьютер — в строку, телефон — чеком.
 */
export function KitchenMonthCard({
  title,
  month,
  previous,
  expenses,
  currency,
  word,
}: {
  /** «Кафе за месяц», «Кафе за неделю». */
  title: string;
  month: KitchenMonth;
  /** Выручка прошлого периода — для «+12% к сентябрю». */
  previous: number;
  expenses: number;
  currency: string;
  /** «к прошлому месяцу», «к прошлой неделе». */
  word: string;
}) {
  const earned = Math.round((month.revenue - month.products) * 100) / 100;
  const net = Math.round((earned - expenses) * 100) / 100;
  const diff = change(month.revenue, previous);
  const share = month.revenue > 0 ? Math.round((month.products / month.revenue) * 100) : null;
  return (
    <section className="panel kr-month">
      <h2>
        {title}
        {diff !== null && (
          <span className={diff >= 0 ? "kr-diff up" : "kr-diff down"}>
            {diff >= 0 ? "+" : ""}
            {diff}% {word}
          </span>
        )}
      </h2>
      <div className="kr-flow">
        <div>
          <span>Выручка</span>
          <b>{money(month.revenue, currency)}</b>
          <small>получено за {month.days} дн.</small>
        </div>
        <div className="minus">
          <span>− Продукты</span>
          <b>{money(month.products, currency)}</b>
          <small>{share === null ? "" : `${share}% выручки`}</small>
        </div>
        <div>
          <span>= Заработок на блюдах</span>
          <b>{money(earned, currency)}</b>
          <small>до расходов</small>
        </div>
        <div className="minus">
          <span>− Расходы</span>
          <b>{money(expenses, currency)}</b>
          <small>аренда, зарплата, свет</small>
        </div>
        <div className={net < 0 ? "net loss" : "net"}>
          <span>= Осталось чистыми</span>
          <b>{money(net, currency)}</b>
        </div>
      </div>
      {month.partial && <p className="muted kr-note">Не у всех продуктов есть цена закупки - продукты посчитаны не полностью.</p>}
    </section>
  );
}

/** Вкладка «Блюда»: три коротких списка и таблица (компьютер), переключатель и список (телефон). */
export function DishReport({ items, currency }: { items: ItemStat[]; currency: string }) {
  return (
    <>
      <DishLists items={items} currency={currency} limit={SHARE_LIMITS.high} />
      <section className="panel kr-table">
        <div className="kr-row kr-head" aria-hidden="true">
          <span>Блюдо или товар</span>
          <span>Продано</span>
          <span>Выручка</span>
          <span>Продукты</span>
          <span>Заработок</span>
          <span>Доля продуктов</span>
        </div>
        {items.map((i) => {
          // Товары перепродают с небольшой наценкой — долю не красим.
          const level = i.share === null || i.kind === "product" ? null : shareLevel(i.share);
          return (
            <div key={`${i.kind}:${i.id}`} className="kr-row">
              <span className="kr-name">
                {i.name}
                {i.kind === "product" && <small> · товар</small>}
              </span>
              <span>{quantity(i.qty)} шт</span>
              <span>{money(i.revenue, currency)}</span>
              <span>{i.cost === null ? "нет цены" : money(i.cost, currency)}</span>
              <b className={i.profit !== null && i.profit < 0 ? "kr-loss" : undefined}>{i.profit === null ? "-" : `${i.profit >= 0 ? "+" : ""}${money(i.profit, currency)}`}</b>
              <span className={level ? `kr-share ${level}` : "kr-share"}>{i.share === null ? "-" : `${i.share}%`}</span>
            </div>
          );
        })}
      </section>
    </>
  );
}

/** Вкладка «Продукты»: что подорожало, расход, закупка и остаток. */
export function ProductReport({ products, rises, currency }: { products: ProductUse[]; rises: ProductRise[]; currency: string }) {
  return (
    <>
      {rises.length > 0 && (
        <div className="kr-rises">
          {rises.map((r) => {
            const plus = r.dishes.map((d) => d.plus);
            const names = r.dishes.slice(0, 3).map((d) => d.name.toLowerCase());
            return (
              <article key={r.id} className="kr-rise">
                <b>{r.name} - подорожание</b>
                <p>
                  {money(r.before, currency)} → <em>{money(r.now, currency)}</em>/{r.unit} (+{r.percent}%)
                </p>
                {r.dishes.length > 0 && (
                  <small>
                    {names.join(", ").replace(/^./, (c) => c.toUpperCase())}
                    {r.dishes.length > 3 ? ` и ещё ${r.dishes.length - 3}` : ""}: дороже на{" "}
                    {Math.min(...plus) === Math.max(...plus)
                      ? money(plus[0], currency)
                      : `${quantity(Math.min(...plus))}–${money(Math.max(...plus), currency)}`}{" "}
                    за порцию
                  </small>
                )}
              </article>
            );
          })}
        </div>
      )}
      <section className="panel kr-table kr-products">
        <div className="kr-row kr-head" aria-hidden="true">
          <span>Продукт</span>
          <span>Ушло по техкартам</span>
          <span>На сумму</span>
          <span>Закупили</span>
          <span>Сейчас на складе</span>
        </div>
        {products.map((p) => (
          <Link key={p.id} href={`/stock/${p.id}`} className="kr-row">
            <span className="kr-name">
              {p.name}
              <small>
                ушло {quantity(p.used)} {p.unit} · закупили {quantity(p.bought)} {p.unit}
              </small>
            </span>
            <span>
              {quantity(p.used)} {p.unit}
            </span>
            <b>{p.cost === null ? "нет цены" : money(p.cost, currency)}</b>
            <span>
              {quantity(p.bought)} {p.unit}
            </span>
            <span className={p.stock < 0 ? "kr-stock short" : "kr-stock"}>
              <small>на складе </small>
              {quantity(p.stock)} {p.unit}
            </span>
          </Link>
        ))}
      </section>
    </>
  );
}
