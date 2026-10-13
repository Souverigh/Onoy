import Link from "next/link";
import { getContext } from "@/lib/context";
import { money, quantity, decimalLessThan } from "@/lib/format";
import { Icon } from "@/components/icon";
import { NavSelect, NavSelects } from "@/components/nav-select";

type Row = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  sale_price: string;
  min_stock: string;
  stock: string;
  archived_at: string | null;
  sold_count?: number | null;
  last_received_at?: string | null;
};

const PAGE = 50;

type SortKey = "name" | "low" | "popular" | "received" | "new";
/** Сортировка склада; «Мало осталось» и «Недавно приходили» — из product_list (миграция 20261013110000). */
const SORTS: [SortKey, string][] = [
  ["name", "А-Я"],
  ["low", "Мало осталось"],
  ["popular", "Ходовые"],
  ["received", "Недавно приходили"],
  ["new", "Новые"],
];
const shortDate = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "numeric", month: "short" }).format(new Date(value));

/** Мало: остаток ниже минимума или закончился (≤ 0). */
const isLow = (row: Pick<Row, "stock" | "min_stock">) =>
  !decimalLessThan("0", row.stock) || decimalLessThan(row.stock, row.min_stock);

// Склад (просьба пользователя 30.09.2026): товары, остатки, импорт прайса.
// Менять товары и цены могут все участники магазина.
export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; page?: string; archived_one?: string; sort?: string }>;
}) {
  const { q = "", filter: rawFilter, page = "1", archived_one, sort: rawSort } = await searchParams;
  const sort: SortKey = SORTS.some(([key]) => key === rawSort) ? (rawSort as SortKey) : "name";
  const filter = rawFilter === "low" || rawFilter === "archive" ? rawFilter : "all";
  const query = q.trim().slice(0, 100);
  const current = Math.max(1, Math.min(1000, parseInt(page) || 1));
  const { db, organizationId, currency } = await getContext();

  // product_list — с остатком числом и датой прихода; без миграции — product_balances.
  const load = (withList: boolean) => {
    let request = db
      .from(withList ? "product_list" : "product_balances")
      .select(
        `id,name,sku,unit,sale_price,min_stock,stock,archived_at,sold_count${withList ? ",last_received_at" : ""}`,
        { count: "exact" },
      )
      .eq("organization_id", organizationId);
    request = filter === "archive" ? request.not("archived_at", "is", null) : request.is("archived_at", null);
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
    // «Мало» считается по остатку из вида — фильтруем здесь (товаров в магазине сотни).
    return filter === "low" ? request.range(0, 4999) : request.range((current - 1) * PAGE, current * PAGE - 1);
  };
  const needsList = sort === "low" || sort === "received";
  let result = await load(needsList);
  // Миграция 20261013110000 ещё не применена — прежний список по имени.
  if (result.error && needsList) result = await load(false);
  const { data, error, count } = result;
  if (error) throw new Error("Не удалось загрузить склад");
  let rows = (data ?? []) as unknown as Row[];
  if (filter === "low") rows = rows.filter(isLow);
  const total = filter === "low" ? rows.length : (count ?? 0);
  const pages = filter === "low" ? 1 : Math.max(1, Math.ceil(total / PAGE));

  const href = (extra: Record<string, string | number>) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (filter !== "all") params.set("filter", filter);
    if (sort !== "name") params.set("sort", sort);
    for (const [key, value] of Object.entries(extra)) params.set(key, String(value));
    const text = params.toString();
    return `/stock${text ? `?${text}` : ""}`;
  };

  // Адрес варианта «Показать» / «Сначала»: поиск сохраняем, страницу — с первой.
  const viewHref = (nextFilter: string, nextSort: SortKey) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (nextFilter !== "all") params.set("filter", nextFilter);
    if (nextSort !== "name") params.set("sort", nextSort);
    const text = params.toString();
    return `/stock${text ? `?${text}` : ""}`;
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">СКЛАД</span>
          <h1>
            Товары <span className="count">{total}</span>
          </h1>
          <p className="muted">Остатки, цены и коды. Товар от поставщика прибавляет остаток, продажа - списывает.</p>
        </div>
        <div className="heading-actions stock-heading-actions">
          <Link className="button" href="/stock/import">
            Из Excel
          </Link>
          <Link className="button" href="/money/new?type=purchase&mode=items">
            + Товар от поставщика
          </Link>
          <Link className="button primary" href="/stock/new">
            <Icon name="plus" />
            Товар
          </Link>
        </div>
      </div>
      {archived_one && (
        <p className="notice success" role="status">
          Товар убран в архив - в продаже его больше не видно. Вернуть можно из «Архива».
        </p>
      )}
      <section className="panel">
        <form className="search" action="/stock">
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          {sort !== "name" && <input type="hidden" name="sort" value={sort} />}
          <label htmlFor="stock-search" className="sr-only">
            Поиск по названию или коду
          </label>
          <input id="stock-search" name="q" placeholder="Название или код…" defaultValue={query} maxLength={100} />
          <button className="button">Найти</button>
          {query && (
            <Link className="text-button" href={filter === "all" ? "/stock" : `/stock?filter=${filter}`}>
              Сбросить
            </Link>
          )}
        </form>
        <NavSelects>
          <NavSelect
            label="Показать"
            options={[
              { label: "Все товары", href: viewHref("all", sort), selected: filter === "all" },
              { label: "Мало на складе", href: viewHref("low", sort), selected: filter === "low" },
              { label: "Архив", href: viewHref("archive", sort), selected: filter === "archive" },
            ]}
          />
          <NavSelect
            label="Сначала"
            options={SORTS.map(([key, label]) => ({ label, href: viewHref(filter, key), selected: sort === key }))}
          />
        </NavSelects>
        {rows.length ? (
          <ul className="stock-list">
            {rows.map((row) => (
              <li key={row.id} className="op-list-item">
                <Link className="op-list-main" href={`/stock/${row.id}`}>
                  <strong>{row.name}</strong>
                </Link>
                <span className={`op-list-amount${isLow(row) && filter !== "archive" ? " warning" : ""}`}>
                  {quantity(row.stock)} {row.unit}
                </span>
                <span className="op-list-meta muted">
                  {row.sku ? `Код ${row.sku} · ` : ""}
                  {Number(row.sale_price) > 0 ? `${money(row.sale_price, currency)} за ${row.unit}` : "цена не указана"}
                  {sort === "popular" && ` · продаж за 90 дн.: ${row.sold_count ?? 0}`}
                  {sort === "received" && (row.last_received_at ? ` · приход ${shortDate(row.last_received_at)}` : " · приходов не было")}
                </span>
                {isLow(row) && filter !== "archive" && (
                  <span className="op-list-meta warning stock-low-tag">
                    {decimalLessThan("0", row.stock) ? "мало" : "нет на складе"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty">
            <span className="empty-icon">
              <Icon name="box" />
            </span>
            <h2>
              {query
                ? "Ничего не найдено"
                : filter === "low"
                  ? "Всего хватает"
                  : filter === "archive"
                    ? "Архив пуст"
                    : "Склад пока пуст"}
            </h2>
            <p>
              {query
                ? "Попробуйте другое название или код."
                : filter === "low"
                  ? "Нет товаров с остатком ниже минимума."
                  : filter === "archive"
                    ? "Сюда попадают товары, которые больше не продаёте."
                    : "Добавьте товары по одному или загрузите прайс из Excel - потом продажу можно оформлять накладной прямо в приложении."}
            </p>
            {!query && filter === "all" && (
              <div className="simple-operation-actions">
                <Link className="button primary" href="/stock/import">
                  Загрузить из Excel
                </Link>
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
      {/* Телефон: кнопки внизу, над нижней панелью — под большим пальцем. */}
      <div className="stock-bottom-actions">
        <Link className="button" href="/stock/import">
          Из Excel
        </Link>
        <Link className="button primary" href="/stock/new">
          <Icon name="plus" />
          Товар
        </Link>
      </div>
    </>
  );
}
