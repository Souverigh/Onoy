import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { partyCurrency } from "@/lib/currency";
import { isDirectory } from "@/lib/validation";
import { directoryMeta, type Entry } from "@/lib/directory";
import { money, quantity, decimalLessThan } from "@/lib/format";
import { Icon } from "@/components/icon";
import { OVERDUE_THRESHOLDS, overdueThreshold, promiseStatus } from "@/lib/promise";
import { bishkekDate } from "@/lib/day-summary";
export default async function DirectoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{ q?: string; page?: string; overdue?: string; archived?: string; deleted?: string }>;
}) {
  const { kind } = await params;
  if (!isDirectory(kind)) notFound();
  const meta = directoryMeta[kind];
  const { q = "", page = "1", overdue: rawOverdue, archived: rawArchived, deleted } = await searchParams;
  // Архив (ТЗ §15.2): по умолчанию скрыт, отдельный фильтр «Архив».
  const archived = kind !== "products" && rawArchived === "1";
  // «Просрочено 30 / 60 / 90» — клиенты, у которых неоплачен долг старше N дней.
  const overdue = kind === "customers" ? overdueThreshold(rawOverdue) : null;
  const current = Math.max(1, Math.min(10000, parseInt(page) || 1));
  const query = q.trim().slice(0, 100);
  const { db, organizationId, currency: shopCurrency } = await getContext();
  let overdueIds: string[] | null = null;
  if (overdue) {
    const late = await db
      .from("customer_debt_aging")
      .select("customer_id")
      .eq("organization_id", organizationId)
      .gt("oldest_days", overdue)
      .range(0, 4999);
    if (late.error) throw new Error("Не удалось загрузить просроченные долги");
    overdueIds = (late.data ?? []).map((row) => row.customer_id as string);
  }
  let request = db
    .from(meta.view)
    .select("*", { count: "exact" })
    .eq("organization_id", organizationId)
    .order("name")
    .order("id")
    .range((current - 1) * 25, current * 25 - 1);
  if (kind !== "products") request = archived ? request.not("archived_at", "is", null) : request.is("archived_at", null);
  if (overdueIds)
    request = request.in("id", overdueIds.length ? overdueIds : ["00000000-0000-0000-0000-000000000000"]);
  if (query)
    request = request.ilike(
      "name",
      "%" + query.replace(/[\\%_]/g, "\\$&") + "%",
    );
  const { data, error, count } = await request;
  if (error) throw new Error("Не удалось загрузить справочник");
  const entries = (data ?? []) as Entry[];
  // Давность долга для строк этой страницы — одним запросом.
  const oldestDays = new Map<string, number>();
  if (kind === "customers" && entries.length) {
    const aging = await db
      .from("customer_debt_aging")
      .select("customer_id,oldest_days")
      .eq("organization_id", organizationId)
      .in("customer_id", entries.map((e) => e.id));
    for (const row of aging.data ?? []) oldestDays.set(row.customer_id as string, row.oldest_days as number);
  }
  const today = bishkekDate();
  const listHref = (extra: Record<string, string | number>) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (overdue) params.set("overdue", String(overdue));
    if (archived) params.set("archived", "1");
    for (const [key, value] of Object.entries(extra)) params.set(key, String(value));
    const text = params.toString();
    return `/${kind}${text ? `?${text}` : ""}`;
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">СПРАВОЧНИК МАГАЗИНА</span>
          <h1>
            {meta.title} <span className="count">{count ?? 0}</span>
          </h1>
          <p className="muted">{meta.description}</p>
        </div>
        <div className="heading-actions">
          {kind !== "products" && (
            <Link className="button" href={`/import?kind=${kind}`}>
              Из тетради
            </Link>
          )}
          <Link className="button primary" href={`/${kind}/new`}>
            <Icon name="plus" />
            Добавить
          </Link>
        </div>
      </div>
      {kind !== "products" && (
        <div className="tabs">
          <Link
            className={kind === "customers" ? "selected" : ""}
            href="/customers"
          >
            Клиенты
          </Link>
          <Link
            className={kind === "suppliers" ? "selected" : ""}
            href="/suppliers"
          >
            Поставщики
          </Link>
        </div>
      )}
      {deleted && (
        <p className="notice success" role="status">
          Удалено.
        </p>
      )}
      {kind !== "products" && (
        <nav className="overdue-filter" aria-label="Фильтр">
          <Link className={overdue || archived ? "" : "selected"} href={`/${kind}`}>
            Все
          </Link>
          {kind === "customers" && OVERDUE_THRESHOLDS.map((days) => (
            <Link
              key={days}
              className={overdue === days ? "selected" : ""}
              href={`/customers?overdue=${days}`}
            >
              Просрочено {days}+ дн.
            </Link>
          ))}
          <Link className={archived ? "selected" : ""} href={`/${kind}?archived=1`}>
            Архив
          </Link>
        </nav>
      )}
      <section className="panel">
        <form className="search" action={`/${kind}`}>
          {overdue && <input type="hidden" name="overdue" value={overdue} />}
          {archived && <input type="hidden" name="archived" value="1" />}
          <label htmlFor="search-name" className="sr-only">
            Поиск по названию
          </label>
          <input
            id="search-name"
            name="q"
            placeholder="Поиск по названию…"
            defaultValue={query}
            maxLength={100}
          />
          <button className="button">Найти</button>
          {query && (
            <Link className="text-button" href={`/${kind}`}>
              Сбросить
            </Link>
          )}
        </form>
        {entries.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Название</th>
                  <th>{kind === "products" ? "Цена продажи" : "Телефон"}</th>
                  <th>{kind === "products" ? "Остаток" : "Долг / аванс"}</th>
                  <th>
                    <span className="sr-only">Действия</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link className="entry-link" href={`/${kind}/${item.id}`}>
                        {item.name}
                      </Link>
                      {item.sku && <small>{item.sku}</small>}
                      {kind === "customers" && (oldestDays.get(item.id) ?? 0) > 30 && (
                        <span className="tag reversed-tag">долг {oldestDays.get(item.id)} дн.</span>
                      )}
                      {kind === "customers" &&
                        promiseStatus(item.promised_date, Number(item.balance ?? 0), today).kind ===
                          "broken" && <span className="tag reversed-tag">нарушил срок</span>}
                    </td>
                    <td>
                      {kind === "products"
                        ? money(item.sale_price ?? 0)
                        : item.phone || "Не указан"}
                    </td>
                    <td>
                      {kind === "products" ? (
                        <span
                          className={
                            decimalLessThan(
                              item.stock ?? "0",
                              item.min_stock ?? "0",
                            )
                              ? "warning"
                              : ""
                          }
                        >
                          {quantity(item.stock ?? 0)} {item.unit}
                        </span>
                      ) : (
                        money(item.balance ?? 0, partyCurrency(item, shopCurrency))
                      )}
                    </td>
                    <td>
                      <Link
                        href={`/${kind}/${item.id}`}
                        aria-label={`Открыть ${item.name}`}
                      >
                        <Icon name="arrow" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <span className="empty-icon">
              <Icon name={kind === "products" ? "box" : "people"} />
            </span>
            <h2>
              {archived ? "Архив пуст" : overdue ? "Просроченных долгов нет" : query ? "Ничего не найдено" : "Список пока пуст"}
            </h2>
            <p>
              {overdue
                ? `Ни у кого нет неоплаченных продаж старше ${overdue} дней.`
                : query
                ? "Попробуйте другое название."
                : "Добавьте первую запись, чтобы подготовить магазин к работе."}
            </p>
            {!query && !overdue && !archived && (
              <Link className="button primary" href={`/${kind}/new`}>
                Добавить
              </Link>
            )}
          </div>
        )}
        <div className="pagination">
          <span className="muted">Страница {current} · По 25 записей</span>
          <div className="actions">
            {current > 1 && (
              <Link className="button" href={listHref({ page: current - 1 })}>
                Назад
              </Link>
            )}
            {current * 25 < (count ?? 0) && (
              <Link className="button" href={listHref({ page: current + 1 })}>
                Далее
              </Link>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
