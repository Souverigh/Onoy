import Link from "next/link";
import { getContext } from "@/lib/context";
import { money, quantity, decimalLessThan } from "@/lib/format";
import { Icon } from "@/components/icon";

type Row = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  sale_price: string;
  min_stock: string;
  stock: string;
  archived_at: string | null;
};

const PAGE = 50;

/** Мало: остаток ниже минимума или закончился (≤ 0). */
const isLow = (row: Pick<Row, "stock" | "min_stock">) =>
  !decimalLessThan("0", row.stock) || decimalLessThan(row.stock, row.min_stock);

// Склад (просьба пользователя 30.09.2026): товары, остатки, импорт прайса.
// Менять товары и цены могут все участники магазина.
export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; page?: string; archived_one?: string }>;
}) {
  const { q = "", filter: rawFilter, page = "1", archived_one } = await searchParams;
  const filter = rawFilter === "low" || rawFilter === "archive" ? rawFilter : "all";
  const query = q.trim().slice(0, 100);
  const current = Math.max(1, Math.min(1000, parseInt(page) || 1));
  const { db, organizationId, currency } = await getContext();

  let request = db
    .from("product_balances")
    .select("id,name,sku,unit,sale_price,min_stock,stock,archived_at", { count: "exact" })
    .eq("organization_id", organizationId)
    .order("name")
    .order("id");
  request = filter === "archive" ? request.not("archived_at", "is", null) : request.is("archived_at", null);
  if (query) {
    // Запятые и скобки — синтаксис фильтра or() в PostgREST.
    const like = `%${query.replace(/[\\%_]/g, "\\$&").replace(/[,()]/g, " ")}%`;
    request = request.or(`name.ilike.${like},sku.ilike.${like}`);
  }
  // «Мало» считается по остатку из вида — фильтруем здесь (товаров в магазине сотни).
  const { data, error, count } =
    filter === "low" ? await request.range(0, 4999) : await request.range((current - 1) * PAGE, current * PAGE - 1);
  if (error) throw new Error("Не удалось загрузить склад");
  let rows = (data ?? []) as Row[];
  if (filter === "low") rows = rows.filter(isLow);
  const total = filter === "low" ? rows.length : (count ?? 0);
  const pages = filter === "low" ? 1 : Math.max(1, Math.ceil(total / PAGE));

  const href = (extra: Record<string, string | number>) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (filter !== "all") params.set("filter", filter);
    for (const [key, value] of Object.entries(extra)) params.set(key, String(value));
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
          <p className="muted">Остатки, цены и коды. Продажа товарами списывает остаток сама.</p>
        </div>
        <div className="heading-actions">
          <Link className="button" href="/stock/import">
            Из Excel
          </Link>
          <Link className="button primary" href="/stock/new">
            <Icon name="plus" />
            Товар
          </Link>
        </div>
      </div>
      {archived_one && (
        <p className="notice success" role="status">
          Товар убран в архив — в продаже его больше не видно. Вернуть можно из «Архива».
        </p>
      )}
      <nav className="overdue-filter" aria-label="Фильтр">
        <Link className={filter === "all" ? "selected" : ""} href="/stock">
          Все
        </Link>
        <Link className={filter === "low" ? "selected" : ""} href="/stock?filter=low">
          Мало на складе
        </Link>
        <Link className={filter === "archive" ? "selected" : ""} href="/stock?filter=archive">
          Архив
        </Link>
      </nav>
      <section className="panel">
        <form className="search" action="/stock">
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
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
                  {money(row.sale_price, currency)} за {row.unit}
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
                    : "Добавьте товары по одному или загрузите прайс из Excel — потом продажу можно оформлять накладной прямо в приложении."}
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
    </>
  );
}
