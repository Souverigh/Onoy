import Link from "next/link";
import { getContext } from "@/lib/context";
import { money, phoneText } from "@/lib/format";
import { normalizePhone } from "@/lib/contacts";
import { memberLabels } from "@/lib/members";
import { linkedCustomers, matchOrder, ORDER_COLUMNS, phoneBook, type CatalogOrder, type OrderMatch } from "@/lib/catalog-orders";
import { navLabel } from "@/lib/business";
import { setOrderDismissed } from "./actions";
import { goodsCount, ORDER_ERRORS, orderDateTime } from "./order-text";
import { isNewShop } from "@/lib/new-shop";
import { Teach } from "@/components/teach";

/** Метка покупателя в списке: знаем ли его. */
function matchTag(match: OrderMatch) {
  if (match.kind === "one") return <span className="tag green">Клиент магазина</span>;
  if (match.kind === "many") return <span className="tag green">Номер у нескольких клиентов - выберите в заказе</span>;
  return <span className="tag">Новый покупатель</span>;
}

/**
 * Заказы из каталога (задача № 12): таблицей — когда, кто (клиент магазина
 * или новый), сколько товаров, сумма, что с заказом. Строка открывает заказ:
 * товары и «Сделать продажу». Видят все в магазине: продажу по заказу делает
 * и продавец.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; dismissed?: string }>;
}) {
  const { error, dismissed } = await searchParams;
  const { db, organizationId, currency, user, business, modules, isOwner, shopCreatedAt } = await getContext();
  const stockLabel = navLabel(business, "/stock", "Склад");
  const [openResult, doneResult, members] = await Promise.all([
    db
      .from("catalog_orders")
      .select(ORDER_COLUMNS)
      .eq("organization_id", organizationId)
      .in("status", ["new", "accepted"])
      .order("created_at", { ascending: false })
      .limit(100),
    db
      .from("catalog_orders")
      .select(ORDER_COLUMNS)
      .eq("organization_id", organizationId)
      .in("status", ["sold", "dismissed"])
      .order("handled_at", { ascending: false })
      .limit(30),
    memberLabels(db, organizationId),
  ]);
  if (openResult.error) console.error("OrdersPage: orders failed", { message: openResult.error.message });
  const open = (openResult.data ?? []) as CatalogOrder[];
  const done = (doneResult.data ?? []) as CatalogOrder[];
  const all = [...open, ...done];

  // Кто заказал: с личной страницы — этот клиент; из общего каталога — клиент
  // магазина с этим телефоном (номер сравниваем по цифрам: в тетради он мог
  // быть «0555 12-34-56»); несколько — выбирает продавец; нет — новый.
  const ids = [...new Set(all.map((o) => o.customer_id).filter((id): id is string => Boolean(id)))];
  const [book, linked] = await Promise.all([
    all.some((o) => !o.customer_id && o.buyer_phone) ? phoneBook(db, organizationId) : new Map(),
    linkedCustomers(db, organizationId, ids),
  ]);
  const who = (id: string | null) => (id ? (id === user.id ? "вы" : members.get(id)?.name ?? "продавец") : "");
  const rows = (list: CatalogOrder[]) =>
    list.map((o) => {
      const match = matchOrder(o, book, linked);
      const name = match.kind === "one" ? match.customer.name : o.buyer_name || (o.buyer_phone ? phoneText(normalizePhone(o.buyer_phone)) : "Покупатель");
      const status =
        o.status === "new" ? (
          <span className="tag green">Новый</span>
        ) : o.status === "accepted" ? (
          <span className="tag">{who(o.handled_by) === "вы" ? "Вы начали продажу" : `Продажу начал(а) ${who(o.handled_by) || "продавец"}`}</span>
        ) : o.status === "sold" ? (
          <span className="tag green">Продан</span>
        ) : (
          <span className="tag">Убран</span>
        );
      return { o, match, name, status, href: `/orders/${o.id}` };
    });

  const table = (list: ReturnType<typeof rows>) => (
    <>
      {/* Телефон: список вместо широкой таблицы. */}
      <ul className="op-list-mobile">
        {list.map(({ o, match, name, status, href }) => (
          <li key={o.id} className="op-list-item">
            <Link className="op-list-main" href={href}>
              <strong>{name}</strong>
            </Link>
            <strong className="op-list-amount">{money(o.total, currency)}</strong>
            <span className="op-list-meta muted">
              {orderDateTime(o.created_at)} · {goodsCount(o.items.length)} {matchTag(match)} {status}
            </span>
          </li>
        ))}
      </ul>
      <div className="table-wrap op-table">
        <table>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Покупатель</th>
              <th>Товаров</th>
              <th>Сумма</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {/* Строка нажимается целиком: ссылка с даты растянута на всю строку. */}
            {list.map(({ o, match, name, status, href }) => (
              <tr key={o.id} className="record-row">
                <td>
                  <Link className="record-row-link" href={href}>
                    {orderDateTime(o.created_at)}
                  </Link>
                </td>
                <td>
                  {name} {matchTag(match)}
                </td>
                <td>{o.items.length}</td>
                <td>{money(o.total, currency)}</td>
                <td>{status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Заказы</h1>
          <p className="muted">Клиенты отправляют их из каталога. Откройте заказ - там товары и «Сделать продажу».</p>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {ORDER_ERRORS[error] ?? ORDER_ERRORS.save}
        </p>
      )}
      {dismissed && done.some((o) => o.id === dismissed && o.status === "dismissed") && (
        <form className="notice orders-undo" action={setOrderDismissed}>
          <span>Заказ убран.</span>
          <input type="hidden" name="id" value={dismissed} />
          <input type="hidden" name="dismissed" value="false" />
          <button type="submit" className="text-button">
            Вернуть
          </button>
        </form>
      )}

      {/* Новый магазин, заказов ещё не было — как это работает и пример. */}
      {!all.length && isNewShop(shopCreatedAt) ? (
        <section className="panel">
          <Teach
            title="Здесь - заказы из вашего каталога"
            text="Клиенты сами выбирают товары по ссылке, без звонков и переписки."
            steps={[
              "Отправьте клиенту ссылку на каталог в WhatsApp",
              "Он отмечает товары и нажимает «Отправить заказ»",
              "Заказ появляется здесь - соберите его и сделайте продажу",
            ]}
            rows={[
              { name: "Айгуль", note: `Сахар 10 кг, Масло 5 л · ${goodsCount(2)}`, value: money(2150, currency) },
              { name: "Магазин «Береке»", note: `Мука 50 кг · ${goodsCount(1)}`, value: money(3800, currency) },
            ]}
          >
            {isOwner && modules.includes("stock") && (
              <Link className="button primary" href="/stock/catalog">
                Включить каталог для клиентов
              </Link>
            )}
          </Teach>
        </section>
      ) : (
        <section className="panel operation-history">
          <div className="section-title">
            <h2>Новые</h2>
            <span className="muted">{open.length}</span>
          </div>
          {open.length ? (
            table(rows(open))
          ) : (
            <p className="muted">
              Новых заказов нет.{" "}
              {modules.includes("stock") ? (
                <>
                  Ссылку на каталог для клиентов можно включить на{" "}
                  <Link href="/stock/catalog">«{stockLabel} → Каталог для клиентов»</Link>.
                </>
              ) : (
                // Каталог показывает товары склада: без «Склада» ссылку не включить.
                <>
                  Каталог показывает товары со склада - чтобы его включить, включите «Склад» в{" "}
                  <Link href="/settings#business">Настройках</Link>.
                </>
              )}
            </p>
          )}
        </section>
      )}

      {done.length > 0 && (
        <section className="panel operation-history">
          <div className="section-title">
            <h2>Обработанные</h2>
            <span className="muted">Последние {done.length}</span>
          </div>
          {table(rows(done))}
        </section>
      )}
    </>
  );
}
