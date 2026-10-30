import Link from "next/link";
import { navLabel, word } from "@/lib/business";
import { onHand } from "@/lib/rental-data";
import { dayMonth } from "@/lib/promise";
import { Fragment } from "react";
import { getContext } from "@/lib/context";
import { money, quantity, decimalLessThan } from "@/lib/format";
import { Icon } from "@/components/icon";
import { NavSelect, NavSelects } from "@/components/nav-select";
import { InfoTip } from "@/components/info-tip";
import { CURRENCIES } from "@/lib/currency";
import { stockValue, type StockValueRow } from "@/lib/stock";
import { loadCategories } from "@/lib/category-data";
import { categoryGroups, categoryLabel, categoryTree, categoryWithChildren, suggestCategory } from "@/lib/category";
import { CategoryChip } from "@/components/category-helper";
import { loadVariants } from "@/lib/model-data";
import { groupByModel, sortVariants, variantLabel } from "@/lib/product-model";
import { isNewShop } from "@/lib/new-shop";
import { Teach } from "@/components/teach";

type Row = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  sale_price: string;
  purchase_price: string;
  purchase_currency: string | null;
  min_stock: string;
  stock: string;
  archived_at: string | null;
  category_id: string | null;
  sold_count?: number | null;
  last_received_at?: string | null;
};

const PAGE = 50;

type SortKey = "name" | "low" | "popular" | "received" | "new";
/** Сортировка склада; «Мало осталось» и «Недавно приходили» — из product_list (миграция 20261013110000). */
const SORTS: [SortKey, string][] = [
  ["name", "Название: А-Я"],
  ["low", "Мало осталось"],
  ["popular", "Ходовые"],
  ["received", "Недавно приходили"],
  ["new", "Новые"],
];
const shortDate = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "numeric", month: "short" }).format(new Date(value));

/** «1 товар», «3 товара», «192 товара». */
const goodsWord = (n: number) =>
  `${n} ${n % 10 === 1 && n % 100 !== 11 ? "товар" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "товара" : "товаров"}`;

/** «1 размер», «3 размера», «12 размеров». */
const sizesWord = (n: number) =>
  `${n} ${n % 10 === 1 && n % 100 !== 11 ? "размер" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "размера" : "размеров"}`;

/** Мало: остаток ниже минимума или закончился (≤ 0). */
const isLow = (row: Pick<Row, "stock" | "min_stock">) =>
  !decimalLessThan("0", row.stock) || decimalLessThan(row.stock, row.min_stock);

/** В наличии, а цены закупки нет — в стоимость склада не вошёл. */
const noCost = (row: Pick<Row, "stock" | "purchase_price">) =>
  decimalLessThan("0", row.stock) && !decimalLessThan("0", row.purchase_price ?? "0");

/** Остаток × цена для строки списка (до копеек; для показа float хватает). */
const lineValue = (stock: string, price: string) => (Math.round(Number(stock) * Number(price) * 100) / 100).toFixed(2);

// Склад (просьба пользователя 30.09.2026): товары, остатки, импорт прайса.
// Менять товары и цены могут все участники магазина.
export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; page?: string; archived_one?: string; sort?: string; category?: string }>;
}) {
  const { q = "", filter: rawFilter, page = "1", archived_one, sort: rawSort, category: rawCategory } = await searchParams;
  const sort: SortKey = SORTS.some(([key]) => key === rawSort) ? (rawSort as SortKey) : "name";
  const filter = rawFilter === "low" || rawFilter === "nocost" || rawFilter === "archive" ? rawFilter : "all";
  // «Мало» и «Без цены закупки» считаются по остатку из вида — фильтруем здесь, без страниц.
  const wide = filter === "low" || filter === "nocost";
  const query = q.trim().slice(0, 100);
  const current = Math.max(1, Math.min(1000, parseInt(page) || 1));
  const { db, organizationId, currency, isOwner, business, modules, shopCreatedAt } = await getContext();
  // Название — как пункт меню («Продукты» у кафе, «Вещи» у проката); каталог — только с модулем.
  const stockLabel = navLabel(business, "/stock", "Склад");
  const catalogOn = isOwner && modules.includes("catalog");
  // Категории (миграция 20261023100000): отбор, подпись в строке и подсказка.
  // Категории и модели с размерами (собрать их товары в одну строку) — параллельно.
  // Прокат: что сейчас на руках — «на руках до 28 октября · Айбек» у вещи.
  const [{ categories, products: named, hints }, { variants, models }, out] = await Promise.all([
    loadCategories(db, organizationId),
    loadVariants(db, organizationId),
    modules.includes("rental") ? onHand(db, organizationId) : Promise.resolve(new Map<string, { count: number; due: string; who: string }>()),
  ]);
  const outText = (id: string) => {
    const o = out.get(id);
    return o ? ` · на руках${o.count > 1 ? ` ${o.count} шт.` : ""} до ${dayMonth(o.due)}${o.who ? ` · ${o.who}` : ""}` : "";
  };
  const category =
    rawCategory === "none" || categories.some((c) => c.id === rawCategory) ? (rawCategory as string) : null;

  // Витрина (просьба пользователя 14.10.2026): весь действующий склад —
  // остаток × цена закупки и продажи. Запрос идёт параллельно со списком.
  // Только владельцу (просьба пользователя 15.10.2026): продавцу деньги склада не показываем.
  const summaryPromise =
    !isOwner || filter === "archive"
      ? null
      : db
          .from("product_balances")
          .select("stock,purchase_price,purchase_currency,sale_price,min_stock")
          .eq("organization_id", organizationId)
          .is("archived_at", null)
          .range(0, 4999);

  // product_list — с остатком числом и датой прихода; без миграции — product_balances.
  const load = (withList: boolean) => {
    let request = db
      .from(withList ? "product_list" : "product_balances")
      .select(
        `id,name,sku,unit,sale_price,purchase_price,purchase_currency,min_stock,stock,archived_at,category_id,sold_count${withList ? ",last_received_at" : ""}`,
        { count: "exact" },
      )
      .eq("organization_id", organizationId);
    request = filter === "archive" ? request.not("archived_at", "is", null) : request.is("archived_at", null);
    if (category === "none") request = request.is("category_id", null);
    else if (category) request = request.in("category_id", categoryWithChildren(categories, category));
    if (query) {
      // Запятые и скобки — синтаксис фильтра or() в PostgREST.
      const like = `%${query.replace(/[\\%_]/g, "\\$&").replace(/[,()]/g, " ")}%`;
      request = request.or(`name.ilike.${like},sku.ilike.${like}`);
    }
    if (withList && sort === "low") request = request.order("stock_value", { ascending: true });
    else if (withList && sort === "received") request = request.order("last_received_at", { ascending: false, nullsFirst: false });
    else if (sort === "popular") request = request.order("sold_count", { ascending: false });
    else if (sort === "new") request = request.order("created_at", { ascending: false });
    request = request.order("name").order("id");
    // Товаров в магазине сотни — для «Мало» и «Без цены закупки» берём все.
    return wide ? request.range(0, 4999) : request.range((current - 1) * PAGE, current * PAGE - 1);
  };
  const needsList = sort === "low" || sort === "received";
  let result = await load(needsList);
  // Миграция 20261013110000 ещё не применена — прежний список по имени.
  if (result.error && needsList) result = await load(false);
  const { data, error, count } = result;
  if (error) throw new Error("Не удалось загрузить склад");
  let rows = (data ?? []) as unknown as Row[];
  if (filter === "low") rows = rows.filter(isLow);
  if (filter === "nocost") rows = rows.filter(noCost);
  const total = wide ? rows.length : (count ?? 0);
  // Новый магазин, товаров нет и без отборов — вместо поиска и «Склад пока пуст» пример.
  const teaching = isNewShop(shopCreatedAt) && !rows.length && !query && !category && filter === "all" && current === 1;
  const pages = wide ? 1 : Math.max(1, Math.ceil(total / PAGE));

  // Закупка — в тех валютах, в которых закупали, без пересчёта (решение
  // пользователя 14.10.2026): сначала валюта магазина, потом остальные.
  const summaryResult = summaryPromise ? await summaryPromise : null;
  const summaryRows =
    summaryResult && !summaryResult.error ? (summaryResult.data as unknown as (StockValueRow & { min_stock: string })[]) : null;
  const summary = summaryRows ? stockValue(summaryRows, currency) : null;
  const lowCount = summaryRows ? summaryRows.filter(isLow).length : 0;
  // Итоги склада — целыми: «2 765 842,4 сом» читается как ошибка, копейки тут не нужны.
  const whole = (value: string | number) => String(Math.round(Number(value)));
  const costLines = summary
    ? [currency, ...CURRENCIES.filter((c) => c !== currency)].filter((c) => summary.cost[c]).map((c) => money(whole(summary.cost[c]!), c))
    : [];
  const shopOnly = summary ? CURRENCIES.every((c) => c === currency || !summary.cost[c]) : false;
  // Наценка — только когда всё в валюте магазина и у всех есть обе цены: иначе она врёт.
  const markup =
    summary && shopOnly && !summary.noCost && !summary.noSale
      ? Number(summary.sale) - Number(summary.cost[currency] ?? 0)
      : null;

  const href = (extra: Record<string, string | number>) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (filter !== "all") params.set("filter", filter);
    if (sort !== "name") params.set("sort", sort);
    if (category) params.set("category", category);
    for (const [key, value] of Object.entries(extra)) params.set(key, String(value));
    const text = params.toString();
    return `/stock${text ? `?${text}` : ""}`;
  };

  // Адрес варианта «Показать» / «Сначала»: поиск сохраняем, страницу — с первой.
  const viewHref = (nextFilter: string, nextSort: SortKey, nextCategory: string | null = category) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (nextFilter !== "all") params.set("filter", nextFilter);
    if (nextSort !== "name") params.set("sort", nextSort);
    if (nextCategory) params.set("category", nextCategory);
    const text = params.toString();
    return `/stock${text ? `?${text}` : ""}`;
  };
  // Отбор по категории: верхние, под ними подкатегории, «Без категории» и настройка.
  const categoryOptions = [
    { label: "Все категории", href: viewHref(filter, sort, null), selected: !category },
    ...categoryTree(categories).flatMap(({ category: top, children }) => [
      { label: top.name, href: viewHref(filter, sort, top.id), selected: category === top.id },
      ...children.map((c) => ({ label: `- ${c.name}`, href: viewHref(filter, sort, c.id), selected: category === c.id })),
    ]),
    { label: "Без категории", href: viewHref(filter, sort, "none"), selected: category === "none" },
    { label: categories.length ? "Изменить категории…" : "Создать категории…", href: "/stock/categories" },
  ];
  // Категорий ещё нет, а товары есть — предлагаем разложить (категории подобраны по названиям).
  const offered = !categories.length && named.length >= 4 ? categoryGroups(named).length : 0;
  // «Получил товар» у магазина; у других видов бизнеса — их слово («Закупка продуктов»).
  const receiveLabel = stockLabel === "Склад" ? "Получил товар" : word(business, "purchase");
  // Подпись под остатком: минус — продали больше, чем было записано; «нет на складе» тут непонятно.
  const lowText = (row: Row) =>
    decimalLessThan("0", row.stock) ? "Мало" : decimalLessThan(row.stock, "0") ? "Продано больше, чем было" : "Нет на складе";
  const categoryCell = (row: Row) => {
    const label = row.category_id ? categoryLabel(categories, row.category_id) : null;
    if (label) return label;
    if (filter === "archive") return <span className="muted">-</span>;
    // Подсказка по названию: нажали — категория поставлена.
    const hint = suggestCategory(row.name, hints);
    const hintLabel = categoryLabel(categories, hint);
    return hint && hintLabel ? <CategoryChip productId={row.id} categoryId={hint} label={hintLabel} /> : <span className="muted">-</span>;
  };
  const rowMenu = (open: string, name: string) => (
    <details className="more-menu record-menu stk-menu">
      <summary className="record-menu-toggle" aria-label={`Действия: ${name}`}>
        <Icon name="more" />
      </summary>
      <div className="more-menu-list">
        <Link href={open}>Открыть</Link>
        <Link href="/money/new?type=purchase&mode=items">{receiveLabel}</Link>
      </div>
    </details>
  );
  const productRow = (row: Row) => {
    const low = isLow(row) && filter !== "archive";
    const extra = [
      decimalLessThan("0", row.stock) && Number(row.purchase_price) > 0
        ? `На складе на ${money(lineValue(row.stock, row.purchase_price), row.purchase_currency ?? currency)}`
        : "",
      sort === "popular" ? `продаж за 90 дн.: ${row.sold_count ?? 0}` : "",
      sort === "received" ? (row.last_received_at ? `приход ${shortDate(row.last_received_at)}` : "приходов не было") : "",
    ].filter(Boolean);
    return (
      <li key={row.id} className="stk-row">
        <span className="stk-name">
          <Link href={`/stock/${row.id}`}>{row.name}</Link>
          <small className="muted">
            {[row.sku ? `Код ${row.sku}` : "", ...extra].filter(Boolean).join(" · ")}
            {outText(row.id)}
          </small>
        </span>
        <span className={low ? "stk-qty low" : "stk-qty"}>
          <strong>
            {quantity(row.stock)} {row.unit}
          </strong>
          {low && <small>{lowText(row)}</small>}
        </span>
        <span className="stk-price">
          {Number(row.sale_price) > 0 ? `${money(row.sale_price, currency)}/${row.unit}` : <span className="muted">Не указана</span>}
        </span>
        <span className="stk-category">{categoryCell(row)}</span>
        {rowMenu(`/stock/${row.id}`, row.name)}
      </li>
    );
  };
  // Размеры и цвета одной модели — одной строкой: всего, по размерам по порядку.
  const modelRow = (modelId: string, items: Row[]) => {
    const model = models[modelId];
    if (!model) return <Fragment key={modelId}>{items.map(productRow)}</Fragment>;
    const sorted = sortVariants(items, model.axes, (row) => variants[row.id]?.attrs);
    const total = items.reduce((sum, row) => sum + Number(row.stock), 0);
    const prices = [...new Set(items.map((row) => Number(row.sale_price)))].sort((a, b) => a - b);
    const low = filter !== "archive" && items.some(isLow);
    return (
      <li key={modelId} className="stk-row stock-model">
        <span className="stk-name">
          <Link href={`/stock/model/${modelId}`}>{model.name}</Link>
          <small className="muted">{sizesWord(items.length)}</small>
        </span>
        <span className={low ? "stk-qty low" : "stk-qty"}>
          <strong>{quantity(String(Math.round(total * 1000) / 1000))} шт</strong>
          {low && <small>Мало по размерам</small>}
        </span>
        <span className="stk-price">
          {prices[0] > 0 ? (
            prices.length > 1 ? (
              `${money(String(prices[0]), currency)} - ${money(String(prices[prices.length - 1]), currency)}`
            ) : (
              `${money(String(prices[0]), currency)}/шт`
            )
          ) : (
            <span className="muted">Не указана</span>
          )}
        </span>
        <span className="stk-category">
          {items[0].category_id && categoryLabel(categories, items[0].category_id) ? (
            categoryLabel(categories, items[0].category_id)
          ) : (
            <span className="muted">-</span>
          )}
        </span>
        {rowMenu(`/stock/model/${modelId}`, model.name)}
        <span className="stock-variants stk-variants">
          {sorted.map((row) => (
            <Link key={row.id} href={`/stock/${row.id}`} className={isLow(row) && filter !== "archive" ? "stock-variant low" : "stock-variant"}>
              {variantLabel(model.axes, variants[row.id]?.attrs)} <b>{quantity(row.stock)}</b>
              {out.has(row.id) && <small> · на руках</small>}
            </Link>
          ))}
        </span>
      </li>
    );
  };
  return (
    <>
      <div className="page-heading stk-heading">
        <div>
          <h1>
            {stockLabel === "Склад" ? "Товары" : stockLabel} <span className="count">{total}</span>
          </h1>
          <p className="muted">Остатки и цены</p>
        </div>
        <div className="stk-actions">
          <Link className="button primary" href="/stock/new">
            <Icon name="plus" />
            <span className="stk-long">Добавить товар</span>
            <span className="stk-short">Товар</span>
          </Link>
          <Link className="button" href="/money/new?type=purchase&mode=items">
            <Icon name="file" />
            {receiveLabel}
          </Link>
          <details className="more-menu stk-more">
            <summary className="button">
              Ещё <span className="rec-new-caret" aria-hidden="true" />
            </summary>
            <div className="more-menu-list">
              {catalogOn && (
                <Link href="/stock/catalog">
                  Каталог для клиентов
                  <small className="muted">Ссылка с ценами и фото для WhatsApp</small>
                </Link>
              )}
              <Link href="/stock/categories">Категории</Link>
              {isOwner && <Link href="/stock/import">Загрузить из Excel</Link>}
              <Link href={viewHref("archive", sort)}>Архив</Link>
            </div>
          </details>
        </div>
      </div>
      {archived_one && (
        <p className="notice success" role="status">
          Товар убран в архив - в продаже его больше не видно. Вернуть можно из «Архива».
        </p>
      )}
      {offered > 0 && (
        <Link className="stock-catalog-mobile stock-categories-offer" href="/stock/categories">
          <span>
            <strong>Разложить товары по категориям</strong>
            <small className="muted">Подобрали по названиям: {offered} кат. - выберите нужные одним нажатием</small>
          </span>
          <span aria-hidden="true">→</span>
        </Link>
      )}
      {summary && summary.inStock > 0 && (
        // На телефоне — сворачивается под «Стоимость остатков ▾».
        <details className="panel stk-value" open>
          <summary>Стоимость остатков</summary>
          <div className="stk-value-row">
            <div className="stk-value-col">
              <span className="label-with-tip">
                <span>
                  <span className="stk-long">Стоимость по закупке</span>
                  <span className="stk-short">По закупке</span>
                </span>
                <InfoTip>
                  Остаток × цена закупки по всем товарам в наличии ({summary.inStock}) - в той валюте, в которой
                  закупали.
                  {summary.noCost ? ` Без цены закупки - ${summary.noCost} тов., они не вошли.` : ""}
                </InfoTip>
              </span>
              <strong className="stock-tile-sums">
                {costLines.length ? costLines.map((line) => <span key={line}>{line}</span>) : <span>{money("0", currency)}</span>}
              </strong>
            </div>
            <div className="stk-value-col">
              <span className="label-with-tip">
                По ценам продажи
                <InfoTip>
                  Остаток × цена продажи.
                  {summary.noSale ? ` Без цены продажи - ${summary.noSale} тов., они не вошли.` : ""}
                  {markup === null
                    ? shopOnly
                      ? " Наценку покажем, когда у всех товаров в наличии будут обе цены."
                      : " Наценку не считаем: часть товара закуплена в другой валюте."
                    : ` Наценка ${markup < 0 ? "−" : ""}${money(whole(Math.abs(markup)), currency)}.`}
                </InfoTip>
              </span>
              <strong>{money(whole(summary.sale), currency)}</strong>
              <small className="muted">По текущим ценам</small>
            </div>
            <div className="stk-value-col stk-instock">
              <span>В наличии:</span>
              <strong>{goodsWord(summary.inStock)}</strong>
            </div>
          </div>
        </details>
      )}
      {summary && (lowCount > 0 || summary.noCost > 0) && (
        <p className="stk-check">
          <span className="stk-check-icon" aria-hidden="true">
            !
          </span>
          {lowCount > 0 && <Link href={viewHref("low", sort)}>Мало или нет: {lowCount} →</Link>}
          {summary.noCost > 0 && <Link href={viewHref("nocost", sort)}>Без цены закупки: {summary.noCost} →</Link>}
        </p>
      )}
      <section className="panel stk-panel">
        {!teaching && (
          <>
            <form className="doc-search stk-search" action="/stock" role="search">
              {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
              {sort !== "name" && <input type="hidden" name="sort" value={sort} />}
              {category && <input type="hidden" name="category" value={category} />}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="m21 21-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" />
              </svg>
              <input
                id="stock-search"
                name="q"
                type="search"
                placeholder="Название или код товара"
                aria-label="Поиск по названию или коду"
                defaultValue={query}
                maxLength={100}
                autoComplete="off"
              />
            </form>
            <NavSelects>
              <NavSelect
                label="Показать"
                className="stk-show"
                options={[
                  { label: "Все товары", href: viewHref("all", sort), selected: filter === "all" },
                  { label: "Мало на складе", href: viewHref("low", sort), selected: filter === "low" },
                  { label: "Без цены закупки", href: viewHref("nocost", sort), selected: filter === "nocost" },
                  { label: "Архив", href: viewHref("archive", sort), selected: filter === "archive" },
                ]}
              />
              <NavSelect label="Категория" className="stk-cat" options={categoryOptions} />
              <NavSelect
                label="Сортировка"
                className="stk-sort"
                options={SORTS.map(([key, label]) => ({ label, href: viewHref(filter, key), selected: sort === key }))}
              />
            </NavSelects>
          </>
        )}
        {rows.length ? (
          <>
            <div className="stk-row stk-row-head" aria-hidden="true">
              <span>Товар</span>
              <span>Остаток</span>
              <span>
                <span className="stk-long">Цена продажи</span>
                <span className="stk-short">Цена</span>
              </span>
              <span className="stk-category">Категория</span>
            </div>
            <ul className="stk-rows">
              {groupByModel(rows, (row) => variants[row.id]?.model).map((g) =>
                g.kind === "item" ? productRow(g.item) : modelRow(g.model, g.items),
              )}
            </ul>
          </>
        ) : teaching ? (
          <Teach
            title="Здесь - что есть в наличии и сколько осталось"
            text="Получили товар - остаток прибавится, продали - убавится. Что заканчивается, Depter покажет сам."
            rows={
              modules.includes("variants")
                ? [
                    { name: "Платье вечернее, M", note: `цена ${money(3500, currency)}`, value: "2 шт" },
                    { name: "Костюм мужской, 50", note: "мало осталось", value: "1 шт" },
                    { name: "Туфли женские, 38", note: `цена ${money(2800, currency)}`, value: "4 шт" },
                  ]
                : [
                    { name: "Сахар 1 кг", note: `цена ${money(95, currency)}`, value: "24 шт" },
                    { name: "Масло подсолнечное 1 л", note: "мало осталось", value: "3 шт" },
                    { name: "Мука 50 кг", note: `цена ${money(1900, currency)}`, value: "12 шт" },
                  ]
            }
          >
            {isOwner && (
              <Link className="button primary" href="/stock/import">
                Загрузить из Excel
              </Link>
            )}
            <Link className={isOwner ? "button" : "button primary"} href="/stock/new">
              <Icon name="plus" />
              Добавить товар
            </Link>
          </Teach>
        ) : (
          <div className="empty">
            <span className="empty-icon">
              <Icon name="box" />
            </span>
            <h2>
              {query || category
                ? "Ничего не найдено"
                : filter === "low"
                  ? "Всего хватает"
                  : filter === "nocost"
                    ? "У всех есть цена закупки"
                  : filter === "archive"
                    ? "Архив пуст"
                    : "Склад пока пуст"}
            </h2>
            <p>
              {query || category
                ? category
                  ? "В этой категории товаров нет - выберите другую."
                  : "Попробуйте другое название или код."
                : filter === "low"
                  ? "Нет товаров с остатком ниже минимума."
                  : filter === "nocost"
                    ? "Все товары в наличии учтены в стоимости склада."
                  : filter === "archive"
                    ? "Сюда попадают товары, которые больше не продаёте."
                    : isOwner
                      ? "Добавьте товары по одному или загрузите прайс из Excel - потом продажу можно оформлять накладной прямо в приложении."
                      : "Добавьте товары по одному - потом продажу можно оформлять накладной прямо в приложении."}
            </p>
            {!query && !category && filter === "all" && (
              <div className="simple-operation-actions">
                {isOwner && (
                  <Link className="button primary" href="/stock/import">
                    Загрузить из Excel
                  </Link>
                )}
                <Link className="button" href="/stock/new">
                  Добавить товар
                </Link>
              </div>
            )}
          </div>
        )}
        {pages > 1 && (
          <nav className="pagination" aria-label="Страницы">
            {current > 1 && <Link href={href({ page: current - 1 })}>← Назад</Link>}
            <span className="muted">
              {current} из {pages}
            </span>
            {current < pages && <Link href={href({ page: current + 1 })}>Дальше →</Link>}
          </nav>
        )}
      </section>
    </>
  );
}
