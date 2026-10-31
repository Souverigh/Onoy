import Link from "next/link";
import { plural } from "@/components/dashboard";
import { paymentLabelWithSide, type PaymentKind } from "@/lib/entry-labels";
import { getContext } from "@/lib/context";
import { firstPaymentHref } from "@/lib/duplicates";
import { debtMoney, money } from "@/lib/format";
import { memberLabels } from "@/lib/members";
import { NavSelect, NavSelects } from "@/components/nav-select";
import { Icon, type IconName } from "@/components/icon";
import { isNewShop } from "@/lib/new-shop";
import { Teach } from "@/components/teach";
import { mainAction, word } from "@/lib/business";
import { expenseCategoryLabel } from "@/lib/expenses";

type PartyBalance = { id: string; name: string; balance: string; currency: string | null };
/** Контрагент, встроенный в запись (PostgREST по составному FK). */
type PartyName = { name: string; currency: string | null } | null;
type Activity = {
  id: string;
  kind: "purchase" | "sale" | "payment" | "expense" | "day_sale";
  party: string;
  /** У расхода только день, без времени. */
  dateOnly?: boolean;
  amount: string;
  currency: string;
  occurred_at: string;
  /** Когда запись внесли — для сортировки «Недавно внесённые». */
  created_at: string;
  direction?: "incoming" | "outgoing";
  paymentKind?: PaymentKind;
  reversed: boolean;
  opening?: boolean;
  reversalComment?: string;
  /** Кто внёс запись (имя сотрудника); старые записи и чужие для продавца — нет. */
  author?: string;
  /** Куда ведёт строка: документ с фото, иначе карточка контрагента. */
  href: string;
};

type Tab = "ops" | "customers" | "suppliers";
type OpType = "sale" | "purchase" | "payment" | "expense";
const TABS: [Tab, string][] = [
  ["ops", "Операции"],
  ["customers", "Клиенты"],
  ["suppliers", "Поставщики"],
];
const OP_TYPES: [OpType | null, string][] = [
  [null, "Все операции"],
  ["sale", "Продажи"],
  ["purchase", "Товар от поставщика"],
  ["payment", "Оплаты"],
  ["expense", "Расходы"],
];
const kindIcon: Record<Activity["kind"], IconName> = { sale: "cart", purchase: "truck", payment: "wallet", expense: "coin", day_sale: "cart" };

/** Для поиска по имени: без знаков, которые ломают фильтр PostgREST. */
const searchText = (value: string | undefined) => (value ?? "").replace(/[%,()*\\]/g, " ").trim().slice(0, 60);

// «28 октября, 10:21».
const dayTime = (value: string) => {
  const d = new Date(value);
  const day = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "Asia/Bishkek" }).format(d);
  const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bishkek" }).format(d);
  return `${day}, ${time}`;
};
const dayOnly = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "Asia/Bishkek" }).format(new Date(value));

export default async function Money({
  searchParams,
}: {
  searchParams: Promise<{
    created?: string;
    error?: string;
    duplicate?: string;
    sale?: string;
    part?: string;
    by?: string;
    order?: string;
    tab?: string;
    q?: string;
    type?: string;
  }>;
}) {
  const { db, organizationId, isOwner, user, currency: shopCurrency, shopCreatedAt, business, modules } = await getContext();
  const params = await searchParams;
  // Владелец: «Кто внёс» — все записи или одного участника магазина.
  const by = isOwner && params.by && /^[0-9a-f-]{36}$/i.test(params.by) ? params.by : null;
  // Вкладка, поиск по имени клиента/поставщика и вид операции (макет 29.10.2026).
  const tab: Tab = params.tab === "customers" || params.tab === "suppliers" ? params.tab : "ops";
  const q = searchText(params.q);
  const opType: OpType | null = OP_TYPES.find(([type]) => type && type === params.type)?.[0] ?? null;
  const filtered = Boolean(by || q || opType);
  const limit = filtered ? 30 : 15;
  const author = by ? { created_by: by } : {};
  // Продажи и приход — чья запись (maker_id): исправление владельцем остаётся за продавцом.
  const maker = by ? { maker_id: by } : {};
  // «Недавно внесённые» (по умолчанию): запись задним числом — всё равно сверху.
  // «По дате операции» — по дате, на которую запись сделана.
  const byDate = params.order === "date";
  const orderColumn = byDate ? "occurred_at" : "created_at";
  const membersRequest = memberLabels(db, organizationId);
  const pattern = `%${q}%`;
  // Поиск: сначала id клиентов и поставщиков с таким именем, потом их записи.
  const [matchedCustomers, matchedSuppliers] =
    q && tab === "ops"
      ? await Promise.all([
          db.from("customers").select("id").eq("organization_id", organizationId).ilike("name", pattern).limit(100),
          db.from("suppliers").select("id").eq("organization_id", organizationId).ilike("name", pattern).limit(100),
        ])
      : [null, null];
  const customerIds = (matchedCustomers?.data ?? []).map((r) => r.id as string);
  const supplierIds = (matchedSuppliers?.data ?? []).map((r) => r.id as string);
  const wants = (kind: OpType) => tab === "ops" && (!opType || opType === kind);
  const none = Promise.resolve({ data: [], error: null });
  const balances = (view: "customer_balances" | "supplier_balances") => {
    const query = db
      .from(view)
      .select("id,name,balance,currency")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .is("merged_into_id", null);
    return (q ? query.ilike("name", pattern) : query).order("name").limit(100);
  };
  const paymentParties = [
    customerIds.length ? `customer_id.in.(${customerIds.join(",")})` : "",
    supplierIds.length ? `supplier_id.in.(${supplierIds.join(",")})` : "",
  ].filter(Boolean);
  // Расходы: владельцу все, продавцу — свои (общий список расходов только у владельца).
  // У расхода нет клиента или поставщика — при поиске по имени не показываем.
  const expenseAuthor = isOwner ? author : { created_by: user.id };
  const [customerResult, supplierResult, purchaseResult, saleResult, paymentResult, claimsResult, expenseResult, daySaleResult] =
    await Promise.all([
      // Архивные и объединённые — не здесь (задача 25).
      tab === "customers" ? balances("customer_balances") : none,
      tab === "suppliers" ? balances("supplier_balances") : none,
      wants("purchase") && !(q && !supplierIds.length)
        ? (() => {
            const query = db
              .from("purchases")
              .select("id,supplier_id,total,occurred_at,reversed_at,reversal_comment,is_opening,document_id,created_by:maker_id,created_at,suppliers(name,currency)")
              .eq("organization_id", organizationId)
              .eq("status", "posted")
              .match(maker);
            return (q ? query.in("supplier_id", supplierIds) : query).order(orderColumn, { ascending: false }).limit(limit);
          })()
        : none,
      wants("sale") && !(q && !customerIds.length)
        ? (() => {
            const query = db
              .from("sales")
              .select("id,customer_id,total,occurred_at,reversed_at,reversal_comment,is_opening,document_id,created_by:maker_id,created_at,customers(name,currency)")
              .eq("organization_id", organizationId)
              .eq("status", "posted")
              .match(maker);
            return (q ? query.in("customer_id", customerIds) : query).order(orderColumn, { ascending: false }).limit(limit);
          })()
        : none,
      wants("payment") && !(q && !paymentParties.length)
        ? (() => {
            const query = db
              .from("payments")
              .select("id,customer_id,supplier_id,direction,amount,occurred_at,reversed_at,reversal_comment,is_opening,kind,document_id,created_by,created_at,customers(name,currency),suppliers(name,currency)")
              .eq("organization_id", organizationId)
              .eq("status", "confirmed")
              .match(author);
            return (q ? query.or(paymentParties.join(",")) : query).order(orderColumn, { ascending: false }).limit(limit);
          })()
        : none,
      db
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("status", "pending"),
      wants("expense") && !q
        ? db
            .from("expenses")
            .select("id,spent_on,amount,currency,category,note,reversed_at,reversal_comment,created_by,created_at")
            .eq("organization_id", organizationId)
            .match(expenseAuthor)
            .order(byDate ? "spent_on" : "created_at", { ascending: false })
            .limit(limit)
        : none,
      // Продажи кафе за день (модуль «kitchen») — среди продаж; без клиента, поиску по имени не подходят.
      modules.includes("kitchen") && wants("sale") && !q
        ? db
            .from("day_sales")
            .select("id,sale_date,received,reversed_at,reversal_comment,created_by,created_at")
            .eq("organization_id", organizationId)
            .match(author)
            .order(byDate ? "sale_date" : "created_at", { ascending: false })
            .limit(limit)
        : none,
    ]);
  if (
    customerResult.error ||
    supplierResult.error ||
    purchaseResult.error ||
    saleResult.error ||
    paymentResult.error ||
    expenseResult.error ||
    daySaleResult.error
  )
    throw new Error("Не удалось загрузить деньги и историю операций");

  const members = await membersRequest;
  const customers = (customerResult.data ?? []) as PartyBalance[];
  const suppliers = (supplierResult.data ?? []) as PartyBalance[];
  const pendingClaims = claimsResult.count ?? 0;
  const purchases = (purchaseResult.data ?? []) as unknown as {
    id: string;
    supplier_id: string;
    total: string;
    occurred_at: string;
    reversed_at: string | null;
    is_opening?: boolean;
    reversal_comment: string | null;
    document_id: string | null;
    created_by: string | null;
    created_at: string;
    suppliers: PartyName;
  }[];
  const sales = (saleResult.data ?? []) as unknown as {
    id: string;
    customer_id: string;
    total: string;
    occurred_at: string;
    reversed_at: string | null;
    is_opening?: boolean;
    reversal_comment: string | null;
    document_id: string | null;
    created_by: string | null;
    created_at: string;
    customers: PartyName;
  }[];
  const payments = (paymentResult.data ?? []) as unknown as {
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
    created_by: string | null;
    created_at: string;
    customers: PartyName;
    suppliers: PartyName;
  }[];
  const daySales = (daySaleResult.data ?? []) as unknown as {
    id: string;
    sale_date: string;
    received: string;
    reversed_at: string | null;
    reversal_comment: string | null;
    created_by: string | null;
    created_at: string;
  }[];
  const expenses = (expenseResult.data ?? []) as unknown as {
    id: string;
    spent_on: string;
    amount: string;
    currency: string;
    category: string;
    note: string | null;
    reversed_at: string | null;
    reversal_comment: string | null;
    created_by: string | null;
    created_at: string;
  }[];
  // Имя и валюта долга контрагента пришли вместе с записью — без второго запроса.
  const currencyOf = (party: PartyName) => party?.currency ?? shopCurrency;
  const authorOf = (id: string | null) => (id ? members.get(id)?.name : undefined);
  const activities: Activity[] = [
    ...purchases.map((row) => ({
      id: row.id,
      kind: "purchase" as const,
      party: row.suppliers?.name ?? "Поставщик",
      amount: row.total,
      currency: currencyOf(row.suppliers),
      occurred_at: row.occurred_at,
      created_at: row.created_at,
      reversed: Boolean(row.reversed_at),
      reversalComment: row.reversal_comment ?? undefined,
      opening: Boolean(row.is_opening),
      author: authorOf(row.created_by),
      href: row.document_id ? `/documents/${row.document_id}` : `/suppliers/${row.supplier_id}`,
    })),
    ...sales.map((row) => ({
      id: row.id,
      kind: "sale" as const,
      party: row.customers?.name ?? "Клиент",
      amount: row.total,
      currency: currencyOf(row.customers),
      occurred_at: row.occurred_at,
      created_at: row.created_at,
      reversed: Boolean(row.reversed_at),
      reversalComment: row.reversal_comment ?? undefined,
      opening: Boolean(row.is_opening),
      author: authorOf(row.created_by),
      // Продажа товарами со склада (без фото) — её накладная на экране отправки.
      href: row.document_id
        ? `/documents/${row.document_id}`
        : row.is_opening
          ? `/customers/${row.customer_id}`
          : `/money/send/${row.id}`,
    })),
    ...payments.map((row) => ({
      id: row.id,
      kind: "payment" as const,
      party:
        row.direction === "incoming"
          ? (row.customers?.name ?? "Клиент")
          : (row.suppliers?.name ?? "Поставщик"),
      amount: row.amount,
      currency: currencyOf(row.customers ?? row.suppliers),
      occurred_at: row.occurred_at,
      created_at: row.created_at,
      direction: row.direction,
      paymentKind: row.kind,
      reversed: Boolean(row.reversed_at),
      reversalComment: row.reversal_comment ?? undefined,
      opening: Boolean(row.is_opening),
      author: authorOf(row.created_by),
      // Без чека — строка оплаты в истории контрагента (якорь pay-<id>).
      href:
        firstPaymentHref(row) ??
        (row.direction === "incoming" ? "/customers" : "/suppliers"),
    })),
    ...expenses.map((row) => ({
      id: row.id,
      kind: "expense" as const,
      // Вместо клиента — на что потратили.
      party: row.note ? `${expenseCategoryLabel(row.category)} · ${row.note}` : expenseCategoryLabel(row.category),
      amount: row.amount,
      currency: row.currency,
      // У расхода только день — полдень по Бишкеку, чтобы не съехал на соседние сутки.
      occurred_at: `${row.spent_on}T12:00:00+06:00`,
      dateOnly: true,
      created_at: row.created_at,
      reversed: Boolean(row.reversed_at),
      reversalComment: row.reversal_comment ?? undefined,
      author: authorOf(row.created_by),
      href: `/money/expense/${row.id}`,
    })),
    ...daySales.map((row) => ({
      id: row.id,
      kind: "day_sale" as const,
      party: "Кафе за день",
      amount: row.received,
      currency: shopCurrency,
      occurred_at: `${row.sale_date}T12:00:00+06:00`,
      dateOnly: true,
      created_at: row.created_at,
      reversed: Boolean(row.reversed_at),
      reversalComment: row.reversal_comment ?? undefined,
      author: authorOf(row.created_by),
      href: `/day-sales/${row.id}`,
    })),
  ].sort(
    (a, b) =>
      new Date(byDate ? b.occurred_at : b.created_at).getTime() - new Date(byDate ? a.occurred_at : a.created_at).getTime(),
  );
  const activityLabel = (activity: Activity) =>
    activity.opening
      ? activity.kind === "payment"
        ? "Аванс из тетради"
        : "Долг из тетради"
      : activity.kind === "purchase"
        ? "Товар от поставщика"
        : activity.kind === "sale"
          ? "Продажа"
          : activity.kind === "expense"
            ? "Расход"
            : activity.kind === "day_sale"
              ? "Продажи за день"
              : paymentLabelWithSide(activity.paymentKind, activity.direction ?? "incoming");
  const recentActivities = activities.slice(0, limit);
  // Адрес списка с заменой одного из отборов; остальные сохраняются.
  const recordsHref = (change: { by?: string | null; date?: boolean; tab?: Tab; type?: OpType | null }) => {
    const query = new URLSearchParams();
    const t = change.tab ?? tab;
    if (t !== "ops") query.set("tab", t);
    if (q) query.set("q", q);
    if (t === "ops") {
      const author = change.by === undefined ? by : change.by;
      const type = change.type === undefined ? opType : change.type;
      if (author) query.set("by", author);
      if (type) query.set("type", type);
      if (change.date ?? byDate) query.set("order", "date");
    }
    const text = query.toString();
    return `/money${text ? `?${text}` : ""}`;
  };
  // Фильтр «Кто внёс» — когда в магазине больше одного участника.
  const people = isOwner && members.size > 1 ? [...members.entries()] : [];
  const successText =
    params.created === "purchase"
      ? "Товар от поставщика записан. Долг перед поставщиком обновлён."
      : params.created === "sale"
        ? "Продажа записана. Долг клиента обновлён."
        : params.created === "payment"
          ? "Оплата подтверждена. Долг пересчитан."
          : params.created === "reversed"
            ? "Запись отменена. Долг пересчитан, история сохранена."
            : undefined;

  return (
    <>
      <div className="page-heading rec-heading">
        <div>
          <h1>Все записи</h1>
          <p className="muted">История операций и расчёты</p>
        </div>
        <details className="more-menu rec-new">
          <summary className="button primary">
            <Icon name="plus" />
            <span className="rec-new-long">Новая запись</span>
            <span className="rec-new-short">Запись</span>
            <span className="rec-new-caret" aria-hidden="true" />
          </summary>
          <div className="more-menu-list">
            {modules.includes("kitchen") && (
              <Link href="/day-sales">
                Продажи за день
                <small className="muted">Сколько блюд продали, продукты спишутся сами</small>
              </Link>
            )}
            <Link href="/money/new?type=sale">
              Продажа
              <small className="muted">Продали клиенту</small>
            </Link>
            <Link href="/money/new?type=purchase">
              Товар от поставщика
              <small className="muted">Получили товар, долг поставщику растёт</small>
            </Link>
            <Link href="/money/new?type=payment&direction=incoming">
              Клиент принёс деньги
              <small className="muted">Наличными или переводом</small>
            </Link>
            <Link href="/money/new?type=payment&direction=outgoing">
              Я заплатил поставщику
              <small className="muted">Наличными или переводом</small>
            </Link>
            <Link href="/money/expense">
              Расход
              <small className="muted">Аренда, зарплата, свет</small>
            </Link>
            {isOwner && (
              <Link href="/money/adjustment">
                Скидка / возврат
                <small className="muted">Уменьшить долг, с комментарием</small>
              </Link>
            )}
          </div>
        </details>
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
          Товар записан, но оплату поставщику записать не удалось. Внесите её через «Я заплатил поставщику».
        </p>
      )}
      {params.created === "purchase" && params.part && /^\d+(\.\d{1,2})?$/.test(params.part) && (
        <p className="notice success" role="status">
          Оплата поставщику {money(params.part)} записана - долг вырос только на остаток.
        </p>
      )}
      {successText && params.duplicate === "1" && (
        <p className="notice" role="status">
          Внимание: это фото накладной уже приложено к другой записи. Если запись
          задвоилась - отмените лишнюю.
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
      <nav className="doc-tabs rec-tabs" aria-label="Все записи">
        {TABS.map(([t, label]) => (
          <Link key={t} href={recordsHref({ tab: t })} className={t === tab ? "active" : undefined} aria-current={t === tab ? "page" : undefined}>
            {label}
          </Link>
        ))}
      </nav>
      <div className="rec-filters">
        <form className="doc-search rec-search" action="/money" role="search">
          {tab !== "ops" && <input type="hidden" name="tab" value={tab} />}
          {by && <input type="hidden" name="by" value={by} />}
          {opType && <input type="hidden" name="type" value={opType} />}
          {byDate && <input type="hidden" name="order" value="date" />}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="m21 21-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" />
          </svg>
          <input name="q" type="search" defaultValue={q} placeholder="Клиент или поставщик" aria-label="Клиент или поставщик" autoComplete="off" />
        </form>
        {tab === "ops" && (
          <NavSelects>
            <NavSelect
              label="Вид операции"
              className="rec-type"
              icon={<Icon name="menu" />}
              options={OP_TYPES.map(([type, label]) => ({ label, href: recordsHref({ type }), selected: opType === type }))}
            />
            {people.length > 0 && (
              <NavSelect
                label="Кто внёс"
                className="rec-people"
                icon={<Icon name="user" />}
                options={[
                  { label: "Все сотрудники", href: recordsHref({ by: null }), selected: !by },
                  ...people.map(([id, m]) => ({ label: id === user.id ? "Я" : m.name, href: recordsHref({ by: id }), selected: by === id })),
                ]}
              />
            )}
            <NavSelect
              label="Сначала"
              className="rec-order"
              icon={<Icon name="sort" />}
              options={[
                { label: "Недавно внесённые", href: recordsHref({ date: false }), selected: !byDate },
                { label: "По дате операции", href: recordsHref({ date: true }), selected: byDate },
              ]}
            />
          </NavSelects>
        )}
      </div>

      {tab === "ops" &&
        (recentActivities.length ? (
          <section className="panel rec-panel">
            <div className="rec-row rec-row-head" aria-hidden="true">
              <span>Операция</span>
              <span>Клиент / поставщик</span>
              <span className="rec-sum">Сумма</span>
              <span>Дата</span>
              <span>Кто внёс</span>
            </div>
            <ul className="rec-rows">
              {recentActivities.map((activity) => (
                <li key={`${activity.kind}-${activity.id}`} className={activity.reversed ? "rec-row reversed" : "rec-row"}>
                  <span className="rec-icon" aria-hidden="true">
                    <Icon name={kindIcon[activity.kind]} />
                  </span>
                  <span className="rec-op">
                    <Link className="rec-title" href={activity.href}>
                      {activityLabel(activity)}
                    </Link>
                    {activity.reversed && <span className="tag rec-reversed-tag">Отменена</span>}
                  </span>
                  <span className="rec-party">
                    {activity.party}
                    {activity.reversed && activity.reversalComment && <small className="muted">{activity.reversalComment}</small>}
                  </span>
                  <strong className="rec-sum">{money(activity.amount, activity.currency)}</strong>
                  {/* На компьютере — две колонки, на телефоне — одна строка «дата • кто внёс». */}
                  <span className="rec-meta">
                    <span className="rec-date">{activity.dateOnly ? dayOnly(activity.occurred_at) : dayTime(activity.occurred_at)}</span>
                    <span className={activity.author ? "rec-author" : "rec-author none"}>{activity.author ?? "-"}</span>
                  </span>
                  <details className="more-menu record-menu rec-menu">
                    <summary className="record-menu-toggle" aria-label={`Действия: ${activityLabel(activity)}, ${activity.party}`}>
                      <Icon name="more" />
                    </summary>
                    <div className="more-menu-list">
                      <Link href={activity.href}>Открыть</Link>
                      {!activity.reversed && isOwner && (
                        <Link
                          className="danger-link"
                          href={
                            activity.kind === "expense"
                              ? `/money/expense/${activity.id}?cancel=1`
                              : activity.kind === "day_sale"
                                ? `/day-sales/${activity.id}?cancel=1`
                                : `/money/reverse/${activity.kind}/${activity.id}`
                          }
                        >
                          Отменить
                        </Link>
                      )}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </section>
        ) : !filtered && isNewShop(shopCreatedAt) ? (
          <section className="panel">
            <Teach
              title="Здесь - всё, что записано"
              text="Продажи, оплаты, товар от поставщиков и расходы - одним списком: когда, сколько и кто записал."
              rows={[
                { name: "Продажа в долг", note: "Айгуль · 30 октября", value: money(12500, shopCurrency) },
                { name: "Клиент принёс деньги", note: "Нурлан · 30 октября", value: money(3000, shopCurrency) },
                { name: word(business, "purchase"), note: "Оптовка «Дордой» · 29 октября", value: money(45000, shopCurrency) },
                { name: "Расход", note: "аренда · 28 октября", value: money(15000, shopCurrency) },
              ]}
            >
              <Link className="button primary" href={mainAction(business, modules).href}>
                <Icon name="plus" />
                {mainAction(business, modules).label}
              </Link>
            </Teach>
          </section>
        ) : (
          <div className="empty">
            <h2>{filtered ? "Ничего не нашлось" : "Операций пока нет"}</h2>
            <p>{filtered ? "Попробуйте другое имя или уберите отбор." : "После проведения первая операция появится в этой истории."}</p>
          </div>
        ))}

      {tab !== "ops" && (
        <section className="panel">
          <div className="section-title">
            <h2>{tab === "customers" ? "Мне должны" : "Я должен поставщикам"}</h2>
            <Link className="text-button" href={tab === "customers" ? "/customers" : "/suppliers"}>
              {tab === "customers" ? "Все клиенты" : "Все поставщики"}
            </Link>
          </div>
          {(tab === "customers" ? customers : suppliers).length ? (
            <div className="balance-list">
              {(tab === "customers" ? customers : suppliers).map((party) => (
                <Link className="balance-row" href={`/${tab}/${party.id}`} key={party.id}>
                  <span>{party.name}</span>
                  <strong>{debtMoney(party.balance, party.currency ?? shopCurrency)}</strong>
                </Link>
              ))}
            </div>
          ) : (
            <p className="muted">
              {q
                ? "С таким именем никого нет."
                : tab === "customers"
                  ? "Добавьте клиентов, чтобы вести расчёты."
                  : "Добавьте поставщиков, чтобы вести расчёты."}
            </p>
          )}
        </section>
      )}
    </>
  );
}
