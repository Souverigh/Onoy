import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { partyCurrency } from "@/lib/currency";
import { isDirectory } from "@/lib/validation";
import { directoryMeta, type Entry } from "@/lib/directory";
import { debtMoney, money, phoneText, quantity, decimalLessThan } from "@/lib/format";
import { InfoTip } from "@/components/info-tip";
import { Icon } from "@/components/icon";
import { OVERDUE_THRESHOLDS, dayMonth, overdueThreshold, promiseStatus } from "@/lib/promise";
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
  // Давность долга > 30 дней — одним запросом на весь магазин: из него и
  // метки «долг N дн.» в строках, и фильтр «Просрочено 30/60/90» (пороги ≥ 30).
  const lateRequest =
    kind === "customers"
      ? db
          .from("customer_debt_aging")
          .select("customer_id,oldest_days")
          .eq("organization_id", organizationId)
          .gt("oldest_days", 30)
          .range(0, 4999)
          .then((late) => {
            // Без фильтра давность — только метки: список покажем и без них.
            if (late.error && overdue) throw new Error("Не удалось загрузить просроченные долги");
            return (late.data ?? []) as { customer_id: string; oldest_days: number }[];
          })
      : Promise.resolve([]);
  const listRequest = (overdueIds: string[] | null) => {
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
    if (query) {
      // Имя — подстрокой; телефон — по цифрам, как бы его ни записали
      // («555 12» находит «0555 12-34-56»). Знаки фильтра PostgREST убираем.
      const name = query.replace(/[\\%_,()"*:]/g, " ").trim();
      const digits = query.replace(/\D/g, "");
      const parts = [name ? `name.ilike.*${name}*` : null];
      if (kind !== "products" && digits.length >= 3)
        parts.push(`phone.imatch.${digits.split("").join("[^0-9]*")}`);
      const filter = parts.filter(Boolean).join(",");
      if (filter) request = request.or(filter);
    }
    return request;
  };
  // Без фильтра «Просрочено» список и давность — параллельно; с фильтром
  // список ждёт id просроченных.
  const [late, { data, error, count }] = overdue
    ? await lateRequest.then(async (rows) => [
        rows,
        await listRequest(rows.filter((row) => row.oldest_days > overdue).map((row) => row.customer_id)),
      ] as const)
    : await Promise.all([lateRequest, listRequest(null)]);
  if (error) throw new Error("Не удалось загрузить справочник");
  const entries = (data ?? []) as Entry[];
  const oldestDays = new Map(late.map((row) => [row.customer_id, row.oldest_days]));
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
          <h1 className="label-with-tip">
            {meta.title} <span className="count">{count ?? 0}</span>
            <InfoTip>{meta.description}</InfoTip>
          </h1>
        </div>
        <div className="heading-actions directory-heading-actions">
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
          <InfoTip>
            {kind === "customers"
              ? "«Просрочено» — клиенты, чей самый старый неоплаченный долг старше стольких дней. "
              : ""}
            «Архив» — скрытые {kind === "customers" ? "клиенты" : "поставщики"}: их нет в списках и при выборе в формах.
          </InfoTip>
        </nav>
      )}
      <section className="panel">
        <form className="search" action={`/${kind}`}>
          {overdue && <input type="hidden" name="overdue" value={overdue} />}
          {archived && <input type="hidden" name="archived" value="1" />}
          <label htmlFor="search-name" className="sr-only">
            {kind === "products" ? "Поиск по названию" : "Поиск по имени или телефону"}
          </label>
          <input
            id="search-name"
            name="q"
            placeholder={kind === "products" ? "Поиск по названию…" : "Имя или телефон…"}
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
            <table className="card-table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>{kind === "products" ? "Цена продажи" : "Телефон"}</th>
                  <th>{kind === "products" ? "Остаток" : "Долг"}</th>
                  <th>
                    <span className="sr-only">Действия</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((item) => (
                  <tr key={item.id}>
                    <td className="card-title">
                      <Link className="entry-link" href={`/${kind}/${item.id}`}>
                        {item.name}
                      </Link>
                      {item.sku && <small>{item.sku}</small>}
                      {kind === "customers" && (oldestDays.get(item.id) ?? 0) > 30 && (
                        <span className="tag reversed-tag">долг {oldestDays.get(item.id)} дн.</span>
                      )}
                      {kind === "customers" && <PromiseTag item={item} today={today} />}
                    </td>
                    <td data-label={kind === "products" ? "Цена" : "Телефон"}>
                      {kind === "products"
                        ? money(item.sale_price ?? 0)
                        : phoneText(item.phone) || "Не указан"}
                    </td>
                    <td data-label={kind === "products" ? "Остаток" : "Долг"} className="card-amount">
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
                        debtMoney(item.balance ?? 0, partyCurrency(item, shopCurrency))
                      )}
                    </td>
                    <td className="card-arrow">
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
                ? kind === "products" ? "Попробуйте другое название." : "Попробуйте другое имя или часть номера."
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
      {/* На телефоне кнопки — внизу, над нижней панелью: под большим пальцем и не теснят заголовок. */}
      <div className="directory-bottom-actions">
        {kind !== "products" && (
          <Link className="button" href={`/import?kind=${kind}`}>
            Из тетради
          </Link>
        )}
        <Link className="button primary" href={`/${kind}/new`}>
          <Icon name="plus" />
          {meta.single}
        </Link>
      </div>
    </>
  );
}

/** Обещание оплатить — в списке клиентов: «обещал сегодня», «обещал до 7 октября», «нарушил срок». */
function PromiseTag({ item, today }: { item: Entry; today: string }) {
  const status = promiseStatus(item.promised_date, Number(item.balance ?? 0), today);
  if (status.kind === "broken") return <span className="tag reversed-tag">нарушил срок</span>;
  if (status.kind === "upcoming")
    return (
      <span className="tag promise-tag">
        {status.daysLeft === 0 ? "обещал сегодня" : `обещал до ${dayMonth(status.date)}`}
      </span>
    );
  return null;
}
