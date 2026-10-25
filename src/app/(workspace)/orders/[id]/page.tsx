import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { debtMoney, money, phoneText } from "@/lib/format";
import { normalizePhone } from "@/lib/contacts";
import { memberLabels } from "@/lib/members";
import {
  customerCards,
  linkedCustomers,
  matchCustomers,
  matchOrder,
  ORDER_COLUMNS,
  phoneBook,
  type CatalogOrder,
  type CustomerCard,
  type OrderCustomer,
  type OrderMatch,
} from "@/lib/catalog-orders";
import { ConfirmButton } from "@/components/confirm-button";
import { Submit } from "@/components/submit";
import { makeSaleFromOrder, setOrderDismissed } from "../actions";
import { ORDER_ERRORS, orderDateTime, qtyText } from "../order-text";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Карточка клиента в выборе: имя, телефон, долг — видно, что это тот самый. */
function CustomerLine({ customer, card, shopCurrency }: { customer: OrderCustomer; card?: CustomerCard; shopCurrency: string }) {
  const details = [
    card?.phone ? phoneText(card.phone) : null,
    card ? (card.balance === 0 ? "долга нет" : `долг ${debtMoney(card.balance.toFixed(2), card.currency ?? shopCurrency)}`) : null,
  ].filter(Boolean);
  return (
    <span className="order-customer-text">
      <strong>{customer.name}</strong>
      {details.length > 0 && <small className="muted">{details.join(" · ")}</small>}
    </span>
  );
}

/**
 * Заказ из каталога (задача № 12): товары таблицей, на кого продажа и
 * действия. Блок «На кого продажа» говорит прямо: клиент магазина (с долгом
 * и телефоном), несколько клиентов с этим телефоном (выбрать карточкой) или
 * новый покупатель (создать клиента одним нажатием).
 */
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  if (!uuidPattern.test(id)) notFound();
  const { db, organizationId, currency, user } = await getContext();
  const result = await db.from("catalog_orders").select(ORDER_COLUMNS).eq("organization_id", organizationId).eq("id", id).maybeSingle();
  const order = result.data as CatalogOrder | null;
  if (!order) notFound();

  const [book, linked, members, myDraft] = await Promise.all([
    order.buyer_phone && !order.customer_id ? phoneBook(db, organizationId) : new Map(),
    linkedCustomers(db, organizationId, order.customer_id ? [order.customer_id] : []),
    memberLabels(db, organizationId),
    // Черновик видит только его автор: нашёлся — это мой.
    order.status === "accepted" && order.draft_id
      ? db.from("record_drafts").select("id").eq("organization_id", organizationId).eq("id", order.draft_id).maybeSingle()
      : null,
  ]);
  const match = matchOrder(order, book, linked);
  const cards = await customerCards(db, organizationId, matchCustomers(match).map((c) => c.id));
  const phone = order.buyer_phone ? normalizePhone(order.buyer_phone) : "";
  const digits = phone.replace(/\D/g, "");
  const open = order.status === "new" || order.status === "accepted";
  const mineDraft = Boolean(myDraft?.data);
  const who = (userId: string | null) => (userId ? (userId === user.id ? "вы" : members.get(userId)?.name ?? "продавец") : "");
  const title = match.kind === "one" ? match.customer.name : order.buyer_name || (phone ? phoneText(phone) : "Покупатель");

  return (
    <>
      <Link className="back-link" href="/orders">
        ← Заказы
      </Link>
      <div className="page-heading">
        <div>
          <h1>{title}</h1>
          <p className="muted">
            Заказ из каталога · {orderDateTime(order.created_at)}
            {order.buyer_name && match.kind === "one" && order.buyer_name !== match.customer.name ? ` · назвался «${order.buyer_name}»` : ""}
          </p>
        </div>
        {digits && (
          <div className="page-heading-actions">
            <a className="button" href={`tel:+${digits}`}>
              {phoneText(phone)}
            </a>
            <a className="button" href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer">
              WhatsApp
            </a>
          </div>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {ORDER_ERRORS[error] ?? ORDER_ERRORS.save}
        </p>
      )}

      {order.status === "sold" && (
        <p className="notice success" role="status">
          Продан{order.handled_by ? ` (${who(order.handled_by)})` : ""}.{" "}
          {order.sale_id && <Link href={`/money/send/${order.sale_id}`}>Открыть продажу →</Link>}
        </p>
      )}
      {order.status === "dismissed" && (
        <form className="notice orders-undo" action={setOrderDismissed}>
          <span>Заказ убран{order.handled_by ? ` (${who(order.handled_by)})` : ""}.</span>
          <input type="hidden" name="id" value={order.id} />
          <input type="hidden" name="dismissed" value="false" />
          <button type="submit" className="text-button">
            Вернуть в новые
          </button>
        </form>
      )}
      {order.status === "accepted" && (
        <p className="notice" role="status">
          Продажу начал{who(order.handled_by) === "вы" ? "и вы" : `(а) ${who(order.handled_by)}`}
          {order.handled_at ? ` ${orderDateTime(order.handled_at)}` : ""} - ещё не записана.
        </p>
      )}

      {open && !mineDraft && <SaleChoice order={order} match={match} cards={cards} shopCurrency={currency} />}
      {open && mineDraft && (
        <section className="panel order-customer">
          <Link className="button primary" href={`/money/new?type=sale&mode=items&draft=${order.draft_id}`}>
            Продолжить продажу
          </Link>
        </section>
      )}

      <section className="panel">
        <div className="section-title">
          <h2>Товары</h2>
          <span className="muted">{order.items.length}</span>
        </div>
        <div className="table-wrap">
          <table className="order-table">
            <thead>
              <tr>
                <th>Товар</th>
                <th>Кол-во</th>
                <th>Цена</th>
                <th>Сумма</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((i) => (
                <tr key={i.product_id}>
                  <td>{i.name}</td>
                  <td>
                    {qtyText(i.qty)} {i.unit}
                  </td>
                  <td>{money(i.price, currency)}</td>
                  <td>{money((Math.round(Number(i.qty) * Number(i.price) * 100) / 100).toFixed(2), currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Итого</td>
                <td>{money(order.total, currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {order.note && <p className="order-note">Комментарий клиента: «{order.note}»</p>}
      </section>

      {open && (
        <form action={setOrderDismissed} className="order-dismiss">
          <input type="hidden" name="id" value={order.id} />
          <input type="hidden" name="dismissed" value="true" />
          <ConfirmButton
            className="text-button"
            message="Убрать заказ?"
            text="Он уйдёт из новых в «Обработанные». Вернуть можно со страницы заказа."
            confirmLabel="Убрать"
            cancelLabel="Оставить"
          >
            Убрать заказ
          </ConfirmButton>
        </form>
      )}
    </>
  );
}

/**
 * «На кого продажа» (customer в makeSaleFromOrder): узнанный клиент; один из
 * нескольких с этим телефоном; новый — клиент из имени и телефона заказа.
 * «Другой клиент» — выбрать в форме продажи.
 */
function SaleChoice({
  order,
  match,
  cards,
  shopCurrency,
}: {
  order: CatalogOrder;
  match: OrderMatch;
  cards: Map<string, CustomerCard>;
  shopCurrency: string;
}) {
  const other = (label: string) => (
    <form action={makeSaleFromOrder}>
      <input type="hidden" name="id" value={order.id} />
      <input type="hidden" name="customer" value="pick" />
      <button type="submit" className="text-button">
        {label}
      </button>
    </form>
  );
  const newName = order.buyer_name?.trim() || (order.buyer_phone ? phoneText(normalizePhone(order.buyer_phone)) : "");
  return (
    <section className="panel order-customer">
      <div className="section-title">
        <h2>На кого продажа</h2>
        <span className={match.kind === "none" ? "tag" : "tag green"}>
          {match.kind === "none" ? "Новый покупатель" : match.kind === "many" ? "Несколько клиентов" : "Клиент магазина"}
        </span>
      </div>
      {match.kind === "one" && (
        <>
          <p className="muted">
            {match.byLink ? "Заказ отправлен с личной страницы клиента." : "Этот телефон уже есть у клиента магазина."}
          </p>
          <div className="order-customer-found">
            <CustomerLine customer={match.customer} card={cards.get(match.customer.id)} shopCurrency={shopCurrency} />
          </div>
          <div className="order-actions">
            <form action={makeSaleFromOrder}>
              <input type="hidden" name="id" value={order.id} />
              <input type="hidden" name="customer" value={match.customer.id} />
              <Submit>Сделать продажу на этого клиента</Submit>
            </form>
            {other("Это другой клиент")}
          </div>
        </>
      )}
      {match.kind === "many" && (
        <form action={makeSaleFromOrder} className="order-pick">
          <input type="hidden" name="id" value={order.id} />
          <p className="muted">Этот телефон есть у нескольких клиентов магазина. Выберите, на кого записать продажу.</p>
          <fieldset>
            <legend className="sr-only">Клиент</legend>
            {match.customers.map((c) => (
              <label key={c.id} className="order-customer-option">
                <input type="radio" name="customer" value={c.id} required />
                <CustomerLine customer={c} card={cards.get(c.id)} shopCurrency={shopCurrency} />
              </label>
            ))}
          </fieldset>
          <div className="order-actions">
            <Submit>Сделать продажу</Submit>
          </div>
        </form>
      )}
      {match.kind === "many" && <div className="order-actions">{other("Другой клиент - выбрать в форме")}</div>}
      {match.kind === "none" && (
        <>
          <p className="muted">
            {newName
              ? `Клиента с этим телефоном в магазине нет. Создадим клиента «${newName}» с телефоном из заказа - следующий заказ с этого номера узнается сам.`
              : "Покупатель не оставил телефон - выберите клиента в форме продажи."}
          </p>
          <div className="order-actions">
            {newName ? (
              <>
                <form action={makeSaleFromOrder}>
                  <input type="hidden" name="id" value={order.id} />
                  <input type="hidden" name="customer" value="new" />
                  <Submit>Создать клиента и сделать продажу</Submit>
                </form>
                {other("Это постоянный клиент - выбрать")}
              </>
            ) : (
              <form action={makeSaleFromOrder}>
                <input type="hidden" name="id" value={order.id} />
                <input type="hidden" name="customer" value="pick" />
                <Submit>Сделать продажу</Submit>
              </form>
            )}
          </div>
        </>
      )}
    </section>
  );
}
