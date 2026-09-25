import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { isDirectory } from "@/lib/validation";
import { directoryMeta, type Entry } from "@/lib/directory";
import { money, quantity, decimalLessThan } from "@/lib/format";
import { Icon } from "@/components/icon";
export default async function DirectoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { kind } = await params;
  if (!isDirectory(kind)) notFound();
  const meta = directoryMeta[kind];
  const { q = "", page = "1" } = await searchParams;
  const current = Math.max(1, Math.min(10000, parseInt(page) || 1));
  const query = q.trim().slice(0, 100);
  const { db, organizationId } = await getContext();
  let request = db
    .from(meta.view)
    .select("*", { count: "exact" })
    .eq("organization_id", organizationId)
    .order("name")
    .order("id")
    .range((current - 1) * 25, current * 25 - 1);
  if (query)
    request = request.ilike(
      "name",
      "%" + query.replace(/[\\%_]/g, "\\$&") + "%",
    );
  const { data, error, count } = await request;
  if (error) throw new Error("Не удалось загрузить справочник");
  const entries = (data ?? []) as Entry[];
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
        <Link className="button primary" href={`/${kind}/new`}>
          <Icon name="plus" />
          Добавить
        </Link>
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
      <section className="panel">
        <form className="search" action={`/${kind}`}>
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
                        money(item.balance ?? 0)
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
            <h2>{query ? "Ничего не найдено" : "Список пока пуст"}</h2>
            <p>
              {query
                ? "Попробуйте другое название."
                : "Добавьте первую запись, чтобы подготовить магазин к работе."}
            </p>
            {!query && (
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
              <Link
                className="button"
                href={`/${kind}?q=${encodeURIComponent(query)}&page=${current - 1}`}
              >
                Назад
              </Link>
            )}
            {current * 25 < (count ?? 0) && (
              <Link
                className="button"
                href={`/${kind}?q=${encodeURIComponent(query)}&page=${current + 1}`}
              >
                Далее
              </Link>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
