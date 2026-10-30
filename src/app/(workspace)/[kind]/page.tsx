import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { partyCurrency } from "@/lib/currency";
import { isDirectory } from "@/lib/validation";
import { directoryMeta, type Entry } from "@/lib/directory";
import { debtMoney, money, phoneText, quantity, decimalLessThan } from "@/lib/format";
import { InfoTip } from "@/components/info-tip";
import { Icon } from "@/components/icon";
import { NavSelect, NavSelects } from "@/components/nav-select";
import { OVERDUE_THRESHOLDS, dayMonth, overdueThreshold, promiseStatus } from "@/lib/promise";
import { bishkekDate } from "@/lib/day-summary";
import { memberLabels } from "@/lib/members";
import { isNewShop } from "@/lib/new-shop";
import { Teach } from "@/components/teach";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default async function DirectoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{
    q?: string;
    page?: string;
    overdue?: string;
    archived?: string;
    deleted?: string;
    sort?: string;
    seller?: string;
  }>;
}) {
  const { kind } = await params;
  if (!isDirectory(kind)) notFound();
  const meta = directoryMeta[kind];
  const { q = "", page = "1", overdue: rawOverdue, archived: rawArchived, deleted, sort: rawSort, seller: rawSeller } =
    await searchParams;
  // Клиенты и поставщики: по умолчанию «недавние» — последние изменения сверху.
  const sort: SortKey = kind === "products" ? "name" : SORTS.some(([key]) => key === rawSort) ? (rawSort as SortKey) : "recent";
  // Архив (ТЗ §15.2): по умолчанию скрыт, отдельный фильтр «Архив».
  const archived = kind !== "products" && rawArchived === "1";
  // «Просрочено 30 / 60 / 90» — клиенты, у которых неоплачен долг старше N дней.
  const overdue = kind === "customers" ? overdueThreshold(rawOverdue) : null;
  const current = Math.max(1, Math.min(10000, parseInt(page) || 1));
  const query = q.trim().slice(0, 100);
  const { db, organizationId, currency: shopCurrency, isOwner, shopCreatedAt } = await getContext();
  // «Кто внёс» (просьба пользователя 23.10.2026): клиенты и поставщики, по
  // которым сотрудник записал продажу/приход (maker_id) или оплату (created_by).
  // Владелец выбирает любого сотрудника; продавец видит в списке только себя (RLS).
  const members = kind !== "products" ? await memberLabels(db, organizationId) : new Map();
  const seller = rawSeller && uuidPattern.test(rawSeller) && members.has(rawSeller) ? rawSeller : null;
  const sellerIds = seller
    ? await Promise.all([
        db
          .from(kind === "customers" ? "sales" : "purchases")
          .select(kind === "customers" ? "customer_id" : "supplier_id")
          .eq("organization_id", organizationId)
          .eq("maker_id", seller)
          .range(0, 9999),
        db
          .from("payments")
          .select(kind === "customers" ? "customer_id" : "supplier_id")
          .eq("organization_id", organizationId)
          .eq("created_by", seller)
          .not(kind === "customers" ? "customer_id" : "supplier_id", "is", null)
          .range(0, 9999),
      ]).then((results) => {
        if (results.some((r) => r.error)) throw new Error("Не удалось загрузить записи сотрудника");
        const key = kind === "customers" ? "customer_id" : "supplier_id";
        return [
          ...new Set(results.flatMap((r) => ((r.data ?? []) as unknown as Record<string, string>[]).map((row) => row[key]))),
        ];
      })
    : null;
  /** Оба отбора сразу («Просрочено» и «Кто внёс») — только общие id. */
  const both = (ids: string[] | null) => {
    if (!sellerIds) return ids;
    if (!ids) return sellerIds;
    const mine = new Set(sellerIds);
    return ids.filter((id) => mine.has(id));
  };
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
  const listRequest = (overdueIds: string[] | null, plain = false) => {
    // customer_list / supplier_list — с долгом числом и временем последнего
    // изменения (миграция 20261013100000); без неё — прежний список по имени.
    const sorted = kind !== "products" && !plain;
    let request = db
      .from(sorted ? (kind === "customers" ? "customer_list" : "supplier_list") : meta.view)
      .select("*", { count: "exact" })
      .eq("organization_id", organizationId);
    if (sorted && sort === "recent") request = request.order("last_activity_at", { ascending: false, nullsFirst: false });
    else if (sorted && sort === "debt") request = request.order("balance_value", { ascending: false });
    else if (sorted && sort === "new") request = request.order("created_at", { ascending: false });
    request = request.order("name").order("id").range((current - 1) * 25, current * 25 - 1);
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
  // Список с сортировкой; представления ещё нет — прежний, по имени.
  const loadList = async (overdueIds: string[] | null) => {
    const result = await listRequest(both(overdueIds));
    return result.error && kind !== "products" ? listRequest(both(overdueIds), true) : result;
  };
  const [late, { data, error, count }] = overdue
    ? await lateRequest.then(async (rows) => [
        rows,
        await loadList(rows.filter((row) => row.oldest_days > overdue).map((row) => row.customer_id)),
      ] as const)
    : await Promise.all([lateRequest, loadList(null)]);
  if (error) throw new Error("Не удалось загрузить справочник");
  const entries = (data ?? []) as Entry[];
  const oldestDays = new Map(late.map((row) => [row.customer_id, row.oldest_days]));
  // Новый магазин, список пуст и без отборов — вместо поиска и «Список пока пуст» пример.
  const teaching =
    kind !== "products" && isNewShop(shopCreatedAt) && !entries.length && !query && !overdue && !archived && !seller && current === 1;
  const today = bishkekDate();
  const listHref = (extra: Record<string, string | number>) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (overdue) params.set("overdue", String(overdue));
    if (archived) params.set("archived", "1");
    if (sort !== "recent" && kind !== "products") params.set("sort", sort);
    if (seller) params.set("seller", seller);
    for (const [key, value] of Object.entries(extra)) params.set(key, String(value));
    const text = params.toString();
    return `/${kind}${text ? `?${text}` : ""}`;
  };
  // Адрес варианта «Показать» / «Сначала»: поиск сохраняем, страницу — с первой.
  const viewHref = (v: { overdue?: number; archived?: boolean; sort?: SortKey; seller?: string | null }) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (v.overdue) params.set("overdue", String(v.overdue));
    if (v.archived) params.set("archived", "1");
    const nextSort = v.sort ?? sort;
    if (nextSort !== "recent") params.set("sort", nextSort);
    const nextSeller = v.seller === undefined ? seller : v.seller;
    if (nextSeller) params.set("seller", nextSeller);
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
      <section className="panel">
        {!teaching && (
          <form className="search" action={`/${kind}`}>
            {overdue && <input type="hidden" name="overdue" value={overdue} />}
            {archived && <input type="hidden" name="archived" value="1" />}
            {sort !== "recent" && kind !== "products" && <input type="hidden" name="sort" value={sort} />}
            {seller && <input type="hidden" name="seller" value={seller} />}
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
              <Link className="text-button" href={seller ? `/${kind}?seller=${seller}` : `/${kind}`}>
                Сбросить
              </Link>
            )}
          </form>
        )}
        {kind !== "products" && !teaching && (
          <NavSelects>
            <NavSelect
              label="Показать"
              tip={
                <InfoTip>
                  {kind === "customers"
                    ? "«Просрочено» - клиенты, чей самый старый неоплаченный долг старше стольких дней. "
                    : ""}
                  «Архив» - скрытые {kind === "customers" ? "клиенты" : "поставщики"}: их нет в списках и при выборе в формах.
                  «Недавние» - сверху те, у кого последней была продажа, оплата или правка карточки.
                </InfoTip>
              }
              options={[
                { label: kind === "customers" ? "Все клиенты" : "Все поставщики", href: viewHref({}), selected: !overdue && !archived },
                ...(kind === "customers"
                  ? OVERDUE_THRESHOLDS.map((days) => ({
                      label: `Просрочено ${days}+ дн.`,
                      href: viewHref({ overdue: days }),
                      selected: overdue === days,
                    }))
                  : []),
                { label: "Архив", href: viewHref({ archived: true }), selected: archived },
              ]}
            />
            <NavSelect
              label="Сначала"
              options={SORTS.map(([key, label]) => ({
                label,
                href: viewHref({ overdue: overdue ?? undefined, archived, sort: key }),
                selected: sort === key,
              }))}
            />
            {/* Владельцу — когда в магазине есть продавцы; продавцу — «Все» или «Мои». */}
            {(isOwner ? members.size > 1 : members.size > 0) && (
              <NavSelect
                label="Кто вносил"
                tip={
                  <InfoTip>
                    {kind === "customers" ? "Клиенты" : "Поставщики"}, по которым сотрудник записал{" "}
                    {kind === "customers" ? "продажу" : "приход"} или оплату.
                  </InfoTip>
                }
                options={[
                  { label: "Все сотрудники", href: viewHref({ overdue: overdue ?? undefined, archived, seller: null }), selected: !seller },
                  ...[...members.entries()]
                    .sort(([, x], [, y]) => (x.role === y.role ? x.name.localeCompare(y.name, "ru") : x.role === "owner" ? -1 : 1))
                    .map(([id, m]) => ({
                      label: isOwner ? m.name : "Мои записи",
                      href: viewHref({ overdue: overdue ?? undefined, archived, seller: id }),
                      selected: seller === id,
                    })),
                ]}
              />
            )}
          </NavSelects>
        )}
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
                      {kind !== "products" && sort === "recent" && item.last_activity_at && (
                        <small className="muted">изменён {changedText(item.last_activity_at, today)}</small>
                      )}
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
        ) : teaching && kind === "customers" ? (
          <Teach
            title="Здесь - кто должен вам"
            text="Продали в долг - долг клиента посчитается сам. Одна кнопка - и напоминание с суммой уходит клиенту в WhatsApp."
            rows={[
              { name: "Айгуль", note: "обещала оплатить до 5 ноября", value: debtMoney(12500, shopCurrency) },
              { name: "Нурлан", note: "+996 555 12-34-56", value: debtMoney(3200, shopCurrency) },
              { name: "Магазин «Береке»", note: "всё оплачено", value: debtMoney(0, shopCurrency) },
            ]}
          >
            <Link className="button primary" href="/customers/new">
              <Icon name="plus" />
              Добавить клиента
            </Link>
            <Link className="button" href="/import?kind=customers">
              Перенести из тетради по фото
            </Link>
          </Teach>
        ) : teaching ? (
          <Teach
            title="Здесь - кому должен магазин"
            text="Взяли товар в долг - запишите, и Depter посчитает, сколько вы должны каждому поставщику."
            rows={[
              { name: "Оптовка «Дордой»", note: "товар 28 октября", value: debtMoney(45000, shopCurrency) },
              { name: "Сут-Азия", note: "+996 555 65-43-21", value: debtMoney(8300, shopCurrency) },
              { name: "Нон-Бишкек", note: "всё оплачено", value: debtMoney(0, shopCurrency) },
            ]}
          >
            <Link className="button primary" href="/suppliers/new">
              <Icon name="plus" />
              Добавить поставщика
            </Link>
            <Link className="button" href="/import?kind=suppliers">
              Перенести из тетради по фото
            </Link>
          </Teach>
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
        {!teaching && (
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
        )}
      </section>
      {/* На телефоне кнопки — внизу, над нижней панелью: под большим пальцем и не теснят заголовок.
          С примером те же кнопки уже в панели. */}
      {!teaching && (
        <>
          <div className="bottom-actions-spacer" aria-hidden="true" />
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
      )}
    </>
  );
}

type SortKey = "recent" | "debt" | "name" | "new";
/** Сортировка клиентов и поставщиков. */
const SORTS: [SortKey, string][] = [
  ["recent", "Недавние"],
  ["debt", "Больший долг"],
  ["name", "А-Я"],
  ["new", "Новые"],
];

/** «сегодня, 14:05», «вчера», «7 окт.» — когда клиент или поставщик последний раз менялся. */
function changedText(value: string, today: string) {
  const date = bishkekDate(value);
  if (date === today)
    return `сегодня, ${new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", hour: "2-digit", minute: "2-digit" }).format(new Date(value))}`;
  const yesterday = new Date(`${today}T12:00:00+06:00`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (date === bishkekDate(yesterday)) return "вчера";
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "numeric", month: "short", ...(date.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }) }).format(new Date(value));
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
