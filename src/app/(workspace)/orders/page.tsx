import Link from "next/link";
import { getContext } from "@/lib/context";
import { money, phoneText } from "@/lib/format";
import { normalizePhone } from "@/lib/contacts";
import { memberLabels } from "@/lib/members";
import { linkedCustomers, matchOrder, phoneBook, type CatalogOrder, type OrderMatch } from "@/lib/catalog-orders";
import { ConfirmButton } from "@/components/confirm-button";
import { Submit } from "@/components/submit";
import { makeSaleFromOrder, setOrderDismissed } from "./actions";

const ERRORS: Record<string, string> = {
  handled: "Этот заказ уже продан или убран - список обновлён.",
  products: "Товаров из заказа уже нет на складе. Сделайте продажу вручную.",
  progress:
    "Продажу по этому заказу уже начал другой продавец и ещё не записал. Попросите его записать или удалить черновик. Если черновик забыт - «Убрать» заказ и сразу «Вернуть».",
  customer: "Не получилось создать клиента. Попробуйте ещё раз или выберите клиента в форме.",
  drafts: "Слишком много черновиков. Запишите или удалите старые в «Продажах».",
  save: "Не получилось сохранить. Попробуйте ещё раз.",
};

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bishkek" }).format(
    new Date(value),
  );
const qtyText = (value: string) => String(Number(value)).replace(".", ",");

/** Подпись под именем: откуда знаем, кто это. */
function matchText(match: OrderMatch) {
  if (match.kind === "one") return match.byLink ? "клиент магазина, заказ с его страницы" : "клиент магазина, узнали по телефону";
  if (match.kind === "many") return "с этим телефоном несколько клиентов";
  return "новый покупатель";
}

/**
 * «Сделать продажу» — на кого (customer в makeSaleFromOrder): узнанный
 * клиент; один из нескольких с этим телефоном; новый — клиент из имени и
 * телефона заказа. «Другой клиент» — выбрать в форме продажи.
 */
function SaleChoice({ order, match }: { order: CatalogOrder; match: OrderMatch }) {
  const other = (label: string) => (
    <form action={makeSaleFromOrder}>
      <input type="hidden" name="id" value={order.id} />
      <input type="hidden" name="customer" value="pick" />
      <button type="submit" className="text-button">
        {label}
      </button>
    </form>
  );
  if (match.kind === "one")
    return (
      <>
        <form action={makeSaleFromOrder}>
          <input type="hidden" name="id" value={order.id} />
          <input type="hidden" name="customer" value={match.customer.id} />
          <Submit>Продажа на «{match.customer.name}»</Submit>
        </form>
        {other("Другой клиент")}
      </>
    );
  if (match.kind === "many")
    return (
      <>
        <form action={makeSaleFromOrder} className="order-pick">
          <input type="hidden" name="id" value={order.id} />
          <fieldset>
            <legend>На кого продажа?</legend>
            {match.customers.map((c) => (
              <label key={c.id}>
                <input type="radio" name="customer" value={c.id} required />
                {c.name}
              </label>
            ))}
          </fieldset>
          <Submit>Сделать продажу</Submit>
        </form>
        {other("Другой клиент")}
      </>
    );
  return order.buyer_phone ? (
    <>
      <form action={makeSaleFromOrder}>
        <input type="hidden" name="id" value={order.id} />
        <input type="hidden" name="customer" value="new" />
        <Submit>Создать клиента «{order.buyer_name?.trim() || phoneText(normalizePhone(order.buyer_phone))}» и продажу</Submit>
      </form>
      {other("Это постоянный клиент - выбрать")}
    </>
  ) : (
    <form action={makeSaleFromOrder}>
      <input type="hidden" name="id" value={order.id} />
      <input type="hidden" name="customer" value="pick" />
      <Submit>Сделать продажу</Submit>
    </form>
  );
}

/**
 * Заказы из каталога (задача № 12): клиент выбрал товары в каталоге и
 * нажал «Отправить заказ» — заказ здесь. «Сделать продажу» открывает
 * продажу товарами с этими строками и клиентом; записали — заказ «Продан».
 * Видят все в магазине: продажу по заказу делает и продавец.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; dismissed?: string }>;
}) {
  const { error, dismissed } = await searchParams;
  const { db, organizationId, currency, user } = await getContext();
  const columns = "id,created_at,status,customer_id,buyer_name,buyer_phone,note,items,total,draft_id,sale_id,handled_by,handled_at";
  const [openResult, doneResult, members] = await Promise.all([
    db
      .from("catalog_orders")
      .select(columns)
      .eq("organization_id", organizationId)
      .in("status", ["new", "accepted"])
      .order("created_at", { ascending: false })
      .limit(100),
    db
      .from("catalog_orders")
      .select(columns)
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
  const drafts = [...new Set(open.map((o) => o.draft_id).filter((id): id is string => Boolean(id)))];
  const [book, linked, myDraftsResult] = await Promise.all([
    all.some((o) => !o.customer_id && o.buyer_phone) ? phoneBook(db, organizationId) : new Map(),
    linkedCustomers(db, organizationId, ids),
    // Черновик видит только его автор — здесь только свои.
    drafts.length ? db.from("record_drafts").select("id").eq("organization_id", organizationId).in("id", drafts) : null,
  ]);
  const myDrafts = new Set(((myDraftsResult?.data ?? []) as { id: string }[]).map((d) => d.id));
  const matchOf = (o: CatalogOrder) => matchOrder(o, book, linked);
  const customerOf = (o: CatalogOrder) => {
    const match = matchOf(o);
    return match.kind === "one" ? match.customer : null;
  };
  const who = (id: string | null) => (id ? (id === user.id ? "вы" : members.get(id)?.name ?? "продавец") : "");

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Заказы</h1>
          <p className="muted">Клиенты отправляют их из каталога. «Сделать продажу» откроет продажу с этими товарами.</p>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {ERRORS[error] ?? ERRORS.save}
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

      {open.length === 0 ? (
        <section className="panel">
          <p className="muted">
            Новых заказов нет. Ссылку на каталог для клиентов можно включить на{" "}
            <Link href="/stock/catalog">«Склад → Каталог для клиентов»</Link>.
          </p>
        </section>
      ) : (
        <section className="orders-list" aria-label="Новые заказы">
          {open.map((o) => {
            const match = matchOf(o);
            const customer = match.kind === "one" ? match.customer : null;
            const phone = o.buyer_phone ? normalizePhone(o.buyer_phone) : "";
            const digits = phone.replace(/\D/g, "");
            const mineDraft = o.status === "accepted" && o.draft_id && myDrafts.has(o.draft_id);
            return (
              <article key={o.id} className="panel order-card">
                <header className="order-card-head">
                  <div>
                    <h2>{customer?.name ?? o.buyer_name ?? "Покупатель"}</h2>
                    <p className="muted">
                      {dateTime(o.created_at)} · {matchText(match)}
                      {customer && o.buyer_name && o.buyer_name !== customer.name ? ` · назвался «${o.buyer_name}»` : ""}
                    </p>
                  </div>
                  {digits && (
                    <div className="order-card-contacts">
                      <a className="button" href={`tel:+${digits}`} aria-label={`Позвонить: ${phoneText(phone)}`}>
                        {phoneText(phone)}
                      </a>
                      <a className="button" href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer">
                        WhatsApp
                      </a>
                    </div>
                  )}
                </header>
                <ul className="order-lines">
                  {o.items.map((i) => (
                    <li key={i.product_id}>
                      <span>
                        {i.name}
                        <small className="muted">
                          {" "}
                          · {qtyText(i.qty)} {i.unit} × {money(i.price, currency)}
                        </small>
                      </span>
                      <strong>{money((Math.round(Number(i.qty) * Number(i.price) * 100) / 100).toFixed(2), currency)}</strong>
                    </li>
                  ))}
                </ul>
                <p className="order-total">
                  <span className="muted">Итого</span>
                  <strong>{money(o.total, currency)}</strong>
                </p>
                {o.note && <p className="order-note">«{o.note}»</p>}
                {o.status === "accepted" && (
                  <p className="muted">
                    Продажу начал{who(o.handled_by) === "вы" ? "и вы" : `(а) ${who(o.handled_by)}`}
                    {o.handled_at ? ` ${dateTime(o.handled_at)}` : ""} - ещё не записана.
                  </p>
                )}
                <div className="order-actions">
                  {mineDraft ? (
                    <Link className="button primary" href={`/money/new?type=sale&mode=items&draft=${o.draft_id}`}>
                      Продолжить продажу
                    </Link>
                  ) : (
                    <SaleChoice order={o} match={match} />
                  )}
                  <form action={setOrderDismissed}>
                    <input type="hidden" name="id" value={o.id} />
                    <input type="hidden" name="dismissed" value="true" />
                    <ConfirmButton
                      className="text-button"
                      message="Убрать заказ?"
                      text="Он уйдёт из новых. Вернуть можно ниже, в «Обработанных»."
                      confirmLabel="Убрать"
                      cancelLabel="Оставить"
                    >
                      Убрать
                    </ConfirmButton>
                  </form>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {done.length > 0 && (
        <section className="panel">
          <div className="section-title">
            <h2>Обработанные</h2>
            <span className="muted">Последние {done.length}</span>
          </div>
          <ul className="draft-list">
            {done.map((o) => (
              <li key={o.id} className="draft-row">
                <div className="draft-main">
                  <strong>{customerOf(o)?.name ?? o.buyer_name ?? (o.buyer_phone ? phoneText(normalizePhone(o.buyer_phone)) : "Покупатель")}</strong>
                  <span className="muted">
                    {money(o.total, currency)} · заказ {dateTime(o.created_at)}
                    {o.handled_by ? ` · ${who(o.handled_by)}` : ""}
                  </span>
                </div>
                <div className="draft-actions">
                  {o.status === "sold" ? (
                    <>
                      <span className="tag green">Продан</span>
                      {o.sale_id && (
                        <Link className="button" href={`/money/send/${o.sale_id}`}>
                          Продажа
                        </Link>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="tag">Убран</span>
                      <form action={setOrderDismissed}>
                        <input type="hidden" name="id" value={o.id} />
                        <input type="hidden" name="dismissed" value="false" />
                        <button type="submit" className="text-button">
                          Вернуть
                        </button>
                      </form>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
