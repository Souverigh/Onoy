import Link from "next/link";
import { plural } from "@/components/dashboard";
import { paymentLabelWithSide, type PaymentKind } from "@/lib/entry-labels";
import { getContext } from "@/lib/context";
import { firstPaymentHref } from "@/lib/duplicates";
import { money } from "@/lib/format";

type PartyBalance = { id: string; name: string; balance: string; currency: string | null };
type PartyName = { id: string; name: string; currency: string | null };
type Activity = {
  id: string;
  kind: "purchase" | "sale" | "payment";
  party: string;
  amount: string;
  currency: string;
  occurred_at: string;
  direction?: "incoming" | "outgoing";
  paymentKind?: PaymentKind;
  reversed: boolean;
  opening?: boolean;
  reversalComment?: string;
  /** Куда ведёт строка: документ с фото, иначе карточка контрагента. */
  href: string;
};

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bishkek",
  }).format(new Date(value));
// «28.09, 16:15» — для списка на телефоне.
const shortDateTime = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bishkek",
  }).format(new Date(value));

export default async function Money({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; error?: string; duplicate?: string; sale?: string; part?: string }>;
}) {
  const { db, organizationId, isOwner, currency: shopCurrency } = await getContext();
  const [customerResult, supplierResult, purchaseResult, saleResult, paymentResult, claimsResult] =
    await Promise.all([
      db
        .from("customer_balances")
        .select("id,name,balance,currency")
        .eq("organization_id", organizationId)
        .order("name")
        .limit(8),
      db
        .from("supplier_balances")
        .select("id,name,balance,currency")
        .eq("organization_id", organizationId)
        .order("name")
        .limit(8),
      db
        .from("purchases")
        .select("id,supplier_id,total,occurred_at,reversed_at,reversal_comment,is_opening,document_id")
        .eq("organization_id", organizationId)
        .eq("status", "posted")
        .order("occurred_at", { ascending: false })
        .limit(8),
      db
        .from("sales")
        .select("id,customer_id,total,occurred_at,reversed_at,reversal_comment,is_opening,document_id")
        .eq("organization_id", organizationId)
        .eq("status", "posted")
        .order("occurred_at", { ascending: false })
        .limit(8),
      db
        .from("payments")
        .select("id,customer_id,supplier_id,direction,amount,occurred_at,reversed_at,reversal_comment,is_opening,kind,document_id")
        .eq("organization_id", organizationId)
        .eq("status", "confirmed")
        .order("occurred_at", { ascending: false })
        .limit(8),
      db
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("status", "pending"),
    ]);
  if (
    customerResult.error ||
    supplierResult.error ||
    purchaseResult.error ||
    saleResult.error ||
    paymentResult.error
  )
    throw new Error("Не удалось загрузить деньги и историю операций");

  const customers = (customerResult.data ?? []) as PartyBalance[];
  const suppliers = (supplierResult.data ?? []) as PartyBalance[];
  const pendingClaims = claimsResult.count ?? 0;
  const purchases = (purchaseResult.data ?? []) as {
    id: string;
    supplier_id: string;
    total: string;
    occurred_at: string;
    reversed_at: string | null;
    is_opening?: boolean;
    reversal_comment: string | null;
    document_id: string | null;
  }[];
  const sales = (saleResult.data ?? []) as {
    id: string;
    customer_id: string;
    total: string;
    occurred_at: string;
    reversed_at: string | null;
    is_opening?: boolean;
    reversal_comment: string | null;
    document_id: string | null;
  }[];
  const payments = (paymentResult.data ?? []) as {
    id: string;
    customer_id: string | null;
    supplier_id: string | null;
    direction: "incoming" | "outgoing";
    amount: string;
    occurred_at: string;
    reversed_at: string | null;
    is_opening?: boolean;
    reversal_comment: string | null;
    kind: PaymentKind;
    document_id: string | null;
  }[];
  const customerIds = [
    ...new Set([
      ...sales.map((row) => row.customer_id),
      ...payments.flatMap((row) =>
        row.direction === "incoming" && row.customer_id ? [row.customer_id] : [],
      ),
    ]),
  ];
  const supplierIds = [
    ...new Set([
      ...purchases.map((row) => row.supplier_id),
      ...payments.flatMap((row) =>
        row.direction === "outgoing" && row.supplier_id ? [row.supplier_id] : [],
      ),
    ]),
  ];
  const [customerLookup, supplierLookup] = await Promise.all([
    customerIds.length
      ? db
          .from("customers")
          .select("id,name,currency")
          .eq("organization_id", organizationId)
          .in("id", customerIds)
      : Promise.resolve({ data: [], error: null }),
    supplierIds.length
      ? db
          .from("suppliers")
          .select("id,name,currency")
          .eq("organization_id", organizationId)
          .in("id", supplierIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (customerLookup.error || supplierLookup.error)
    throw new Error("Не удалось загрузить участников операций");
  const customerNames = new Map(
    ((customerLookup.data ?? []) as PartyName[]).map((entry) => [
      entry.id,
      entry.name,
    ]),
  );
  const supplierNames = new Map(
    ((supplierLookup.data ?? []) as PartyName[]).map((entry) => [
      entry.id,
      entry.name,
    ]),
  );
  // Валюта долга контрагента — в суммах журнала.
  const partyCurrencies = new Map(
    [...((customerLookup.data ?? []) as PartyName[]), ...((supplierLookup.data ?? []) as PartyName[])].map((p) => [
      p.id,
      p.currency ?? shopCurrency,
    ]),
  );
  const currencyOf = (id: string | null) => (id && partyCurrencies.get(id)) || shopCurrency;
  const activities: Activity[] = [
    ...purchases.map((row) => ({
      id: row.id,
      kind: "purchase" as const,
      party: supplierNames.get(row.supplier_id) ?? "Поставщик",
      amount: row.total,
      currency: currencyOf(row.supplier_id),
      occurred_at: row.occurred_at,
      reversed: Boolean(row.reversed_at),
      reversalComment: row.reversal_comment ?? undefined,
      opening: Boolean(row.is_opening),
      href: row.document_id ? `/documents/${row.document_id}` : `/suppliers/${row.supplier_id}`,
    })),
    ...sales.map((row) => ({
      id: row.id,
      kind: "sale" as const,
      party: customerNames.get(row.customer_id) ?? "Клиент",
      amount: row.total,
      currency: currencyOf(row.customer_id),
      occurred_at: row.occurred_at,
      reversed: Boolean(row.reversed_at),
      reversalComment: row.reversal_comment ?? undefined,
      opening: Boolean(row.is_opening),
      href: row.document_id ? `/documents/${row.document_id}` : `/customers/${row.customer_id}`,
    })),
    ...payments.map((row) => ({
      id: row.id,
      kind: "payment" as const,
      party:
        row.direction === "incoming"
          ? (customerNames.get(row.customer_id ?? "") ?? "Клиент")
          : (supplierNames.get(row.supplier_id ?? "") ?? "Поставщик"),
      amount: row.amount,
      currency: currencyOf(row.customer_id ?? row.supplier_id),
      occurred_at: row.occurred_at,
      direction: row.direction,
      paymentKind: row.kind,
      reversed: Boolean(row.reversed_at),
      reversalComment: row.reversal_comment ?? undefined,
      opening: Boolean(row.is_opening),
      // Без чека — строка оплаты в истории контрагента (якорь pay-<id>).
      href:
        firstPaymentHref(row) ??
        (row.direction === "incoming" ? "/customers" : "/suppliers"),
    })),
  ].sort(
    (a, b) =>
      new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
  );
  const activityLabel = (activity: Activity) =>
    activity.opening
      ? activity.kind === "payment"
        ? "Аванс из тетради"
        : "Долг из тетради"
      : activity.kind === "purchase"
        ? "Приход"
        : activity.kind === "sale"
          ? "Продажа"
          : paymentLabelWithSide(activity.paymentKind, activity.direction ?? "incoming");
  const recentActivities = activities.slice(0, 15);
  const params = await searchParams;
  const successText =
    params.created === "purchase"
      ? "Приход записан. Долг перед поставщиком обновлён."
      : params.created === "sale"
        ? "Продажа записана. Долг клиента обновлён."
        : params.created === "payment"
          ? "Оплата подтверждена. Долг пересчитан."
          : params.created === "reversed"
            ? "Запись отменена. Долг пересчитан, история сохранена."
            : undefined;

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ОПЕРАЦИИ И РАСЧЁТЫ</span>
          <h1>Деньги</h1>
          <p className="muted">
            Приход, продажи, оплаты и текущие долги магазина.
          </p>
        </div>
      </div>
      {successText && (
        <p className="notice success" role="status">
          {successText}
          {params.created === "sale" && params.sale && /^[a-f0-9-]{36}$/i.test(params.sale) && (
            <>
              {" "}
              <Link className="text-button" href={`/money/send/${params.sale}`}>
                Отправить клиенту в WhatsApp →
              </Link>
            </>
          )}
        </p>
      )}
      {params.created === "purchase" && params.part === "failed" && (
        <p className="form-error" role="alert">
          Приход записан, но оплату поставщику записать не удалось. Внесите её через «Оплата».
        </p>
      )}
      {params.created === "purchase" && params.part && /^\d+(\.\d{1,2})?$/.test(params.part) && (
        <p className="notice success" role="status">
          Оплата поставщику {money(params.part)} записана — долг вырос только на остаток.
        </p>
      )}
      {successText && params.duplicate === "1" && (
        <p className="notice" role="status">
          Внимание: это фото накладной уже приложено к другой записи. Если запись
          задвоилась — отмените лишнюю.
        </p>
      )}
      {params.error === "invalid" && (
        <p className="form-error" role="alert">
          Не удалось открыть операцию. Обновите страницу и попробуйте снова.
        </p>
      )}
      {params.error === "reversal" && (
        <p className="form-error" role="alert">
          Не удалось отменить запись. Возможно, она уже отменена.
        </p>
      )}
      {isOwner && pendingClaims > 0 && (
        <Link className="notice claims-notice" href="/claims">
          Ждут подтверждения: {pendingClaims} {plural(pendingClaims, "заявка", "заявки", "заявок")} на оплату →
        </Link>
      )}
      <section className="operation-actions" aria-label="Новая операция">
        <Link className="operation-action" href="/money/new?type=purchase">
          <span>＋</span>
          <div>
            <strong>Приход</strong>
            <small>Получили товар от поставщика</small>
          </div>
        </Link>
        <Link className="operation-action" href="/money/new?type=sale">
          <span>−</span>
          <div>
            <strong>Продажа</strong>
            <small>Продали клиенту</small>
          </div>
        </Link>
        <Link className="operation-action" href="/money/new?type=payment">
          <span>₸</span>
          <div>
            <strong>Оплата</strong>
            <small>От клиента или поставщику</small>
          </div>
        </Link>
        {isOwner && (
          <Link className="operation-action" href="/money/adjustment">
            <span>%</span>
            <div>
              <strong>Скидка / возврат</strong>
              <small>Уменьшить долг, с комментарием</small>
            </div>
          </Link>
        )}
      </section>
      <div className="money-columns">
        <section className="panel">
          <div className="section-title">
            <h2>Мне должны</h2>
            <Link className="text-button" href="/customers">
              Все клиенты
            </Link>
          </div>
          {customers.length ? (
            <div className="balance-list">
              {customers.map((customer) => (
                <Link
                  className="balance-row"
                  href={`/customers/${customer.id}`}
                  key={customer.id}
                >
                  <span>{customer.name}</span>
                  <strong>{money(customer.balance, customer.currency ?? shopCurrency)}</strong>
                </Link>
              ))}
            </div>
          ) : (
            <p className="muted">Добавьте клиентов, чтобы вести расчёты.</p>
          )}
        </section>
        <section className="panel">
          <div className="section-title">
            <h2>Я должен поставщикам</h2>
            <Link className="text-button" href="/suppliers">
              Все поставщики
            </Link>
          </div>
          {suppliers.length ? (
            <div className="balance-list">
              {suppliers.map((supplier) => (
                <Link
                  className="balance-row"
                  href={`/suppliers/${supplier.id}`}
                  key={supplier.id}
                >
                  <span>{supplier.name}</span>
                  <strong>{money(supplier.balance, supplier.currency ?? shopCurrency)}</strong>
                </Link>
              ))}
            </div>
          ) : (
            <p className="muted">Добавьте поставщиков, чтобы вести расчёты.</p>
          )}
        </section>
      </div>
      <section className="panel operation-history">
        <div className="section-title">
          <h2>Последние операции</h2>
          <span className="tag">Недавние</span>
        </div>
        {activities.length ? (
          <>
          {/* Телефон: список вместо широкой таблицы — всё видно без прокрутки вбок. */}
          <ul className="op-list-mobile">
            {recentActivities.map((activity) => (
              <li
                key={`${activity.kind}-${activity.id}`}
                className={activity.reversed ? "op-list-item reversed" : "op-list-item"}
              >
                <Link className="op-list-main" href={activity.href}>
                  <strong>{activityLabel(activity)}</strong>
                  {" · "}
                  {activity.party}
                </Link>
                <strong className="op-list-amount">{money(activity.amount, activity.currency)}</strong>
                <span className="op-list-meta muted">
                  {shortDateTime(activity.occurred_at)}
                  {activity.reversed && <span className="tag reversed-tag">отменена</span>}
                </span>
                {!activity.reversed && isOwner && (
                  <Link
                    className="op-list-action"
                    href={`/money/reverse/${activity.kind}/${activity.id}`}
                  >
                    Отменить
                  </Link>
                )}
                {activity.reversed && activity.reversalComment && (
                  <span className="op-list-note muted">Причина: {activity.reversalComment}</span>
                )}
              </li>
            ))}
          </ul>
          <div className="table-wrap op-table">
            <table>
              <thead>
                <tr>
                  <th>Операция</th>
                  <th>Контрагент</th>
                  <th>Сумма</th>
                  <th>Дата</th>
                  <th>
                    <span className="sr-only">Действия</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentActivities.map((activity) => (
                  <tr
                    key={`${activity.kind}-${activity.id}`}
                    className={activity.reversed ? "reversed-row" : ""}
                  >
                    <td>
                      <Link className="entry-link" href={activity.href}>
                        {activityLabel(activity)}
                      </Link>
                      {activity.reversed && (
                        <span className="tag reversed-tag">отменена</span>
                      )}
                    </td>
                    <td>{activity.party}</td>
                    <td>{money(activity.amount, activity.currency)}</td>
                    <td>{dateTime(activity.occurred_at)}</td>
                    <td>
                      {activity.reversed ? (
                        <span className="muted" title={activity.reversalComment}>
                          {activity.reversalComment}
                        </span>
                      ) : isOwner ? (
                        <Link
                          className="text-button"
                          href={`/money/reverse/${activity.kind}/${activity.id}`}
                        >
                          Отменить
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        ) : (
          <div className="empty">
            <h2>Операций пока нет</h2>
            <p>После проведения первая операция появится в этой истории.</p>
          </div>
        )}
      </section>
    </>
  );
}
