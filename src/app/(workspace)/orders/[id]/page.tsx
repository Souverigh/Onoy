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

/** Строка клиента в выборе: имя и телефон слева, долг справа — видно, что это тот самый. */
function CustomerLine({ customer, card, shopCurrency }: { customer: OrderCustomer; card?: CustomerCard; shopCurrency: string }) {
  return (
    <>
      <span className="order-choice-main">
        <strong>{customer.name}</strong>
        {card?.phone && <small>{phoneText(card.phone)}</small>}
      </span>
      {card && (
        <span className="order-choice-side">
          <small>{card.balance < 0 ? "аванс" : "долг"}</small>
          <strong>
            {card.balance === 0 ? "нет" : debtMoney(Math.abs(card.balance).toFixed(2), card.currency ?? shopCurrency)}
          </strong>
        </span>
      )}
    </>
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
      <div className="page-heading order-heading">
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
 * «На кого продажа» (customer в makeSaleFromOrder) — список в одной рамке,
 * как выбор в мобильных приложениях: узнанный клиент (с галочкой); несколько
 * с этим телефоном — выбрать строкой; новый — клиент из имени и телефона
 * заказа. «Другой клиент» (other) — выбрать в форме продажи.
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
  const phone = order.buyer_phone ? phoneText(normalizePhone(order.buyer_phone)) : "";
  const newName = order.buyer_name?.trim() || phone;
  const hint =
    match.kind === "one"
      ? match.byLink
        ? "Заказ отправлен с личной страницы клиента."
        : "Телефон из заказа уже есть у клиента магазина."
      : match.kind === "many"
        ? "Этот телефон есть у нескольких клиентов - выберите нужного."
        : newName
          ? "Такого клиента в магазине ещё нет - создадим его из заказа. Следующий заказ с этого номера узнается сам."
          : "Покупатель не оставил телефон - выберите клиента в форме продажи.";
  const submitLabel =
    match.kind === "none" ? (newName ? "Создать клиента и продать" : "Выбрать клиента и продать") : "Сделать продажу";
  return (
    <section className="panel order-customer">
      <div className="order-customer-head">
        <h2>На кого продажа</h2>
        <p className="muted">{hint}</p>
      </div>
      <form action={makeSaleFromOrder} className="order-customer-form">
        <input type="hidden" name="id" value={order.id} />
        {match.kind === "one" && <input type="hidden" name="customer" value={match.customer.id} />}
        {match.kind === "none" && <input type="hidden" name="customer" value={newName ? "new" : "pick"} />}
        {(match.kind !== "none" || newName) && (
          <div className="order-choice-list" role={match.kind === "many" ? "radiogroup" : undefined} aria-label="Клиент">
            {match.kind === "one" && (
              <div className="order-choice is-selected">
                <span className="order-choice-mark" aria-hidden="true">
                  ✓
                </span>
                <CustomerLine customer={match.customer} card={cards.get(match.customer.id)} shopCurrency={shopCurrency} />
              </div>
            )}
            {match.kind === "many" &&
              match.customers.map((c) => (
                <label key={c.id} className="order-choice">
                  <input type="radio" name="customer" value={c.id} required />
                  <CustomerLine customer={c} card={cards.get(c.id)} shopCurrency={shopCurrency} />
                </label>
              ))}
            {match.kind === "none" && (
              <div className="order-choice is-new">
                <span className="order-choice-mark" aria-hidden="true">
                  +
                </span>
                <span className="order-choice-main">
                  <strong>{newName}</strong>
                  {phone && phone !== newName && <small>{phone}</small>}
                </span>
                <span className="order-choice-side">
                  <small>новый</small>
                  <strong>клиент</strong>
                </span>
              </div>
            )}
          </div>
        )}
        <div className="order-actions">
          <Submit>{submitLabel}</Submit>
          {(match.kind !== "none" || newName) && (
            // Без проверки «выберите клиента»: другой клиент выбирается в форме продажи.
            <button type="submit" name="other" value="1" formNoValidate className="text-button">
              {match.kind === "none" ? "Это постоянный клиент" : "Другой клиент"}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
