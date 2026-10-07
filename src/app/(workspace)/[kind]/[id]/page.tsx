import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { isDirectory } from "@/lib/validation";
import { directoryMeta, type Entry } from "@/lib/directory";
import { EntryForm } from "@/components/entry-form";
import { debtMoney, money, originalAmountText, phoneText, quantity } from "@/lib/format";
import { partyCurrency } from "@/lib/currency";
import { creditLimitExceeded } from "@/lib/credit-limit";
import { createLink, revokeLink, setPromisedDate } from "@/app/(workspace)/[kind]/actions";
import { redoRecord } from "@/app/(workspace)/money/actions";
import { dayMonth, promiseStatus } from "@/lib/promise";
import { reminderMessage } from "@/lib/reminder";
import { paymentLabel } from "@/lib/entry-labels";
import { firstPaymentHref } from "@/lib/duplicates";
import { checkReceipt, receiptAmounts, receiptDiffers } from "@/lib/claim-receipt";
import { officialRates } from "@/lib/fx";
import { CURRENCIES } from "@/lib/currency";
import { memberLabels } from "@/lib/members";
import { PartyManage } from "@/components/party-manage";
import { CopyButton } from "@/components/copy-button";
import { ConfirmButton } from "@/components/confirm-button";
import { waPhone } from "@/lib/share";
import { bishkekDate } from "@/lib/day-summary";

type ShareLink = { id: string; token: string; revoked_at: string | null };
type Aging = {
  due_0_30: string;
  due_31_60: string;
  due_61_90: string;
  due_over_90: string;
  oldest_days: number;
};

export default async function EntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<{
    error?: string;
    saved?: string;
    linked?: string;
    revoked?: string;
    reversed?: string;
    promised?: string;
    adjusted?: string;
    archived?: string;
    restored?: string;
    merged?: string;
    unmerged?: string;
    rid?: string;
    added?: string;
    dup?: string;
    name?: string;
    phone?: string;
  }>;
}) {
  const { kind, id } = await params;
  if (!isDirectory(kind)) notFound();
  const { db, organizationId, organizationName, isOwner, currency: shopCurrency } = await getContext();
  const { error, saved, linked, revoked, reversed, promised, adjusted, archived, restored, merged, unmerged, rid, added, dup, name: draftName, phone: draftPhone } =
    await searchParams;
  const isParty = kind === "customers" || kind === "suppliers";
  const known = id !== "new";
  if (known && !/^[a-f0-9-]{36}$/i.test(id)) notFound();
  const partyColumn = kind === "customers" ? "customer_id" : "supplier_id";
  // Всё, что зависит только от id из адреса, — одним кругом вместе с самой
  // записью (раньше ~7 запросов подряд). Запрос supabase-js уходит только
  // при then/await — Promise.resolve запускает его сразу; ниже их ждут.
  const start = <T,>(query: PromiseLike<T>) => Promise.resolve(query);
  const skip = <T,>(value: T) => Promise.resolve(value);
  const entryRequest = known
    ? start(db.from(directoryMeta[kind].view).select("*").eq("organization_id", organizationId).eq("id", id).maybeSingle())
    : null;
  const agingRequest =
    known && kind === "customers"
      ? start(
          db
            .from("customer_debt_aging")
            .select("due_0_30,due_31_60,due_61_90,due_over_90,oldest_days")
            .eq("organization_id", organizationId)
            .eq("customer_id", id)
            .maybeSingle(),
        )
      : skip({ data: null });
  const linksRequest =
    known && kind === "customers"
      ? start(
          db
            .from("share_links")
            .select("id,token,revoked_at")
            .eq("organization_id", organizationId)
            .eq("customer_id", id)
            .is("revoked_at", null)
            .order("created_at", { ascending: false })
            .limit(1),
        )
      : skip({ data: [] as ShareLink[] });
  const invoicesRequest =
    known && isParty
      ? start(
          db
            .from(kind === "customers" ? "sales" : "purchases")
            .select("id,total,occurred_at,reversed_at,reversal_comment,document_id,is_opening,created_by,reversed_by,original_amount,original_currency,fx_rate")
            .eq("organization_id", organizationId)
            .eq(partyColumn, id)
            .eq("status", "posted")
            .order("occurred_at", { ascending: false })
            .limit(20),
        )
      : null;
  const paysRequest =
    known && isParty
      ? start(
          db
            .from("payments")
            .select("id,amount,occurred_at,reversed_at,reversal_comment,document_id,status,is_opening,kind,note,created_by,reversed_by,original_amount,original_currency,fx_rate,duplicate_of")
            .eq("organization_id", organizationId)
            .eq(partyColumn, id)
            .eq("direction", kind === "customers" ? "incoming" : "outgoing")
            .neq("status", "rejected")
            .order("occurred_at", { ascending: false })
            .limit(20),
        )
      : null;
  const membersRequest = known && isOwner && isParty ? memberLabels(db, organizationId) : null;
  const manageRequest =
    known && isParty
      ? Promise.all([
          start(
            db
              .from(kind === "customers" ? "sales" : "purchases")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .eq(partyColumn, id),
          ),
          start(
            db
              .from("payments")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .eq(partyColumn, id),
          ),
          isOwner
            ? start(
                db
                  .from(kind)
                  .select("id,name")
                  .eq("organization_id", organizationId)
                  .is("merged_into_id", null)
                  .is("archived_at", null)
                  .neq("id", id)
                  .order("name")
                  .range(0, 999),
              )
            : skip({ data: [] as { id: string; name: string }[] }),
          isOwner
            ? start(
                db
                  .from("party_merges")
                  .select("id,from_id")
                  .eq("organization_id", organizationId)
                  .eq("into_id", id)
                  .is("undone_at", null)
                  .gt("created_at", new Date(Date.now() - 86400000).toISOString()),
              )
            : skip({ data: [] as { id: string; from_id: string }[] }),
        ])
      : null;

  let entry: Entry | undefined;
  if (entryRequest) {
    const result = await entryRequest;
    if (result.error) throw new Error("Не удалось открыть запись");
    if (!result.data) notFound();
    entry = result.data as Entry;
  }

  let activeLink: ShareLink | undefined;
  let origin = "";
  let aging: Aging | null = null;
  if (entry && kind === "customers") {
    const [agingResult, links] = await Promise.all([agingRequest, linksRequest]);
    aging = (agingResult.data as Aging | null) ?? null;
    activeLink = (links.data ?? [])[0] as ShareLink | undefined;
    const h = await headers();
    origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  }

  // Валюта долга этого контрагента — во всех суммах карточки.
  const cur = partyCurrency(entry, shopCurrency);
  type HistoryRow = {
    kind: "sale" | "purchase" | "payment";
    id: string;
    label: string;
    amount: string;
    occurred_at: string;
    reversed: boolean;
    reversalComment: string | null;
    documentId: string | null;
    pending: boolean;
    /** Дубликат оплаты (тот же номер перевода / то же фото чека) — на проверке у владельца. */
    duplicate?: boolean;
    /** Ссылка «первая запись» у дубликата. */
    firstHref?: string | null;
    /** Заявка на проверке: что на чеке и сходится ли с суммой заявки. */
    receiptNote?: { text: string; differs: boolean } | null;
    opening: boolean;
    /** Комментарий скидки/возврата. */
    note?: string | null;
    /** Запись в другой валюте: «87 800 сом по 87,8». */
    original: string | null;
    /** Кто внёс и кто отменил (журнал для владельца). */
    createdBy: string | null;
    reversedBy: string | null;
    /** Товары продажи со склада (sale_items) — первые названия и сколько всего. */
    items?: { names: string[]; count: number } | null;
  };
  let history: HistoryRow[] = [];
  if (entry && invoicesRequest && paysRequest) {
    const [invoices, pays] = await Promise.all([invoicesRequest, paysRequest]);
    const firstIds = [...new Set((pays.data ?? []).map((p) => p.duplicate_of).filter(Boolean) as string[])];
    // Заявки на проверке: сумма с чека против суммы заявки — видно и продавцу.
    const pendingPays = (pays.data ?? []).filter((p) => p.status === "pending" && p.document_id);
    const invoiceIds = (invoices.data ?? []).filter((r) => !r.document_id).map((r) => r.id);
    // Первые записи дубликатов, чеки заявок и товары продаж/приходов — вместе, вторым кругом.
    const [firsts, receipts, saleItems] = await Promise.all([
      firstIds.length
        ? start(
            db
              .from("payments")
              .select("id,document_id,customer_id,supplier_id")
              .eq("organization_id", organizationId)
              .in("id", firstIds),
          ).then((result) => result.data ?? [])
        : skip([]),
      receiptAmounts(db, organizationId, pendingPays.map((p) => p.document_id as string)),
      invoiceIds.length
        ? start(
            db
              .from(kind === "customers" ? "sale_items" : "purchase_items")
              .select(`${kind === "customers" ? "sale_id" : "purchase_id"},name_snapshot`)
              .eq("organization_id", organizationId)
              .in(kind === "customers" ? "sale_id" : "purchase_id", invoiceIds)
              .order("n"),
          ).then((result) =>
            ((result.data ?? []) as unknown as Record<string, string>[]).map((row) => ({
              owner: row.sale_id ?? row.purchase_id,
              name: row.name_snapshot,
            })),
          )
        : skip([] as { owner: string; name: string }[]),
    ]);
    const itemsBySale = new Map<string, { names: string[]; count: number }>();
    for (const item of saleItems) {
      const entry = itemsBySale.get(item.owner) ?? { names: [], count: 0 };
      if (entry.names.length < 2) entry.names.push(item.name);
      entry.count += 1;
      itemsBySale.set(item.owner, entry);
    }
    const firstHrefs = new Map(firsts.map((f) => [f.id, firstPaymentHref(f)]));
    const needRates = pendingPays.some((p) => {
      const r = receipts.get(p.document_id as string);
      return r && r.currency !== cur && p.original_currency !== r.currency;
    });
    const rates = needRates ? await officialRates([...CURRENCIES]) : {};
    const receiptNotes = new Map<string, { text: string; differs: boolean }>();
    for (const p of pendingPays) {
      const r = receipts.get(p.document_id as string);
      if (!r) continue;
      const check = checkReceipt(p, cur, r, rates);
      const differs = receiptDiffers(check);
      const approx = check.inDebt != null && r.currency !== cur ? ` ≈ ${money(check.inDebt, cur)}` : "";
      receiptNotes.set(p.id, {
        differs,
        text:
          `По чеку: ${money(r.amount, r.currency)}${approx}` +
          (check.diff == null
            ? " — другая валюта, проверьте сумму"
            : !differs
              ? " — совпадает"
              : ` — на ${money(Math.abs(check.diff), cur)} ${check.diff > 0 ? "больше" : "меньше"}, чем в заявке`),
      });
    }
    history = [
      ...(invoices.data ?? []).map((r) => ({
        kind: (kind === "customers" ? "sale" : "purchase") as HistoryRow["kind"],
        id: r.id,
        label: r.is_opening ? "Долг из тетради" : kind === "customers" ? "Продажа" : "Товар от поставщика",
        amount: r.total,
        original: originalAmountText(r),
        occurred_at: r.occurred_at,
        reversed: Boolean(r.reversed_at),
        reversalComment: r.reversal_comment,
        documentId: r.document_id,
        pending: false,
        opening: Boolean(r.is_opening),
        createdBy: r.created_by,
        reversedBy: r.reversed_by,
        items: itemsBySale.get(r.id) ?? null,
      })),
      ...(pays.data ?? []).map((p) => ({
        kind: "payment" as const,
        id: p.id,
        // Заявка клиента (created_by пустой) остаётся «Заявкой»; метка «дубликат» — у обеих.
        label: paymentLabel(p.kind, {
          opening: p.is_opening,
          pending: p.status === "pending",
          duplicate: Boolean(p.duplicate_of) && p.created_by !== null,
        }),
        note: p.note,
        amount: p.amount,
        original: originalAmountText(p),
        occurred_at: p.occurred_at,
        reversed: Boolean(p.reversed_at),
        reversalComment: p.reversal_comment,
        documentId: p.document_id,
        pending: p.status === "pending",
        duplicate: Boolean(p.duplicate_of),
        firstHref: p.duplicate_of ? firstHrefs.get(p.duplicate_of) ?? null : null,
        receiptNote: receiptNotes.get(p.id) ?? null,
        opening: Boolean(p.is_opening),
        createdBy: p.created_by,
        reversedBy: p.reversed_by,
      })),
    ]
      .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
      .slice(0, 20);
  }

  const overLimit =
    entry && kind === "customers"
      ? creditLimitExceeded(entry.balance ?? 0, entry.credit_limit, 0, false)
      : null;

  // Журнал «кто внёс, кто отменил» — владельцу, когда есть сотрудники.
  const members = (membersRequest ? await membersRequest : null) ?? new Map();
  const showAuthors = [...members.values()].some((m) => m.role === "staff");
  const who = (id: string | null) => (id ? (members.get(id)?.name ?? "бывший сотрудник") : null);
  // «1 окт., 09:28»; год — только если не текущий.
  const historyDate = (iso: string) => {
    const d = new Date(iso);
    const year = new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Bishkek" }).format(d);
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "short",
      ...(year !== bishkekDate().slice(0, 4) ? { year: "numeric" } : {}),
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Bishkek",
    }).format(d);
  };

  // Управление контрагентом: есть ли записи (включая отменённые и заявки),
  // с кем можно объединить, недавние объединения (отмена в течение суток).
  let manage: React.ComponentProps<typeof PartyManage> | null = null;
  if (entry && isParty && manageRequest) {
    const [docs, pays, others, merges] = await manageRequest;
    const mergeRows = (merges.data ?? []) as { id: string; from_id: string }[];
    // Куда объединили и имена объединённых — зависят от ответов выше.
    const [into, fromNames] = await Promise.all([
      entry.merged_into_id
        ? start(db.from(kind).select("id,name").eq("organization_id", organizationId).eq("id", entry.merged_into_id).maybeSingle())
        : skip({ data: null }),
      mergeRows.length
        ? start(db.from(kind).select("id,name").in("id", mergeRows.map((m) => m.from_id))).then(
            (result) => new Map((result.data ?? []).map((p) => [p.id as string, p.name as string])),
          )
        : skip(new Map<string, string>()),
    ]);
    manage = {
      kind: kind as "customers" | "suppliers",
      id: entry.id,
      name: entry.name,
      balance: Number(entry.balance ?? 0),
      currency: cur,
      hasRecords: (docs.count ?? 0) + (pays.count ?? 0) > 0,
      archived: Boolean(entry.archived_at),
      mergedInto: (into.data as { id: string; name: string } | null) ?? null,
      isOwner,
      others: (others.data ?? []) as { id: string; name: string }[],
      recentMerges: mergeRows.map((m) => ({ id: m.id, fromName: fromNames.get(m.from_id) ?? (kind === "customers" ? "клиент" : "поставщик") })),
    };
  }

  // «Похоже, это Айбек» после «Добавить» (задача 24).
  const twin =
    !known && isParty && dup && /^[a-f0-9-]{36}$/i.test(dup)
      ? ((await db.from(kind).select("id,name").eq("organization_id", organizationId).eq("id", dup).maybeSingle()).data as
          | { id: string; name: string }
          | null)
      : null;

  const newOperationHref = (type: string) =>
    `/money/new?type=${["sale", "purchase", "payment"].includes(type) ? type : "payment"}&party=${entry?.id ?? ""}`;

  const today = bishkekDate();
  const promise =
    entry && kind === "customers"
      ? promiseStatus(entry.promised_date, Number(entry.balance ?? 0), today)
      : ({ kind: "none" } as const);
  // Аудит ТЗ 15.1 п. 14: название магазина, без «долг в», страница не «оплатить», а посмотреть.
  // Минус — клиент заплатил вперёд: не «ваш долг -3 000», а аванс (как в invoiceMessage).
  const reminderBalance = Number(entry?.balance ?? 0);
  const reminderText =
    entry && kind === "customers"
      ? reminderMessage({
          shopName: organizationName,
          balance: reminderBalance,
          currency: cur,
          promisedDate: entry.promised_date,
          today,
          link: activeLink ? `${origin}/c/${activeLink.token}` : null,
        })
      : "";
  const waHref =
    entry?.phone && reminderText
      ? `https://wa.me/${waPhone(entry.phone)}?text=${encodeURIComponent(reminderText)}`
      : undefined;
  // Подпись к балансу словами, без минуса: плюс — долг, минус — аванс.
  const balanceLabel =
    reminderBalance > 0
      ? kind === "customers"
        ? "Должен вам"
        : "Вы должны"
      : reminderBalance < 0
        ? kind === "customers"
          ? "Аванс клиента"
          : "Ваш аванс у поставщика"
        : "Долга нет";
  const balanceTone = reminderBalance > 0 ? (overLimit || promise.kind === "broken" ? "late" : "debt") : "clear";
  // Ошибка формы данных или управления — раскрываем свёрнутый блок, чтобы её было видно.
  const formError = error && !["link", "reversal", "promise", "has_records", "party", "merge", "merge_opening", "merge_expired", "merge_currency"].includes(error);

  return (
    <>
      <Link className="back-link" href={`/${kind}`}>
        ← {directoryMeta[kind].title}
      </Link>
      {entry && isParty ? (
        <section className="panel party-hero">
          <div className="party-hero-top">
            <div className="party-hero-who">
              <span className="eyebrow">
                {kind === "customers" ? "КЛИЕНТ" : "ПОСТАВЩИК"}
                {entry.archived_at ? " · В АРХИВЕ" : ""}
              </span>
              <h1>{entry.name}</h1>
              {entry.phone ? (
                <a className="party-hero-phone" href={`tel:${entry.phone}`}>
                  {phoneText(entry.phone)}
                </a>
              ) : (
                <span className="muted party-hero-phone">Телефон не указан</span>
              )}
              {entry.notes && <p className="muted party-hero-notes">{entry.notes}</p>}
            </div>
            <div className={`party-hero-balance ${balanceTone}`}>
              <span>{balanceLabel}</span>
              <strong>{money(Math.abs(reminderBalance), cur)}</strong>
              {entry.credit_limit != null && (
                <small>
                  лимит {money(entry.credit_limit, cur)}
                  {overLimit && <span className="party-hero-over"> · превышен</span>}
                </small>
              )}
              {promise.kind === "broken" ? (
                <small className="party-hero-late">
                  обещал до {dayMonth(promise.date)} — просрочено {promise.daysLate} дн.
                </small>
              ) : promise.kind === "upcoming" ? (
                <small>
                  обещал до {dayMonth(promise.date)}
                  {promise.daysLeft === 0 ? " — сегодня" : ` — через ${promise.daysLeft} дн.`}
                </small>
              ) : null}
            </div>
          </div>
          <div className="party-hero-actions">
            <Link className="button primary" href={newOperationHref(kind === "customers" ? "sale" : "purchase")}>
              + {kind === "customers" ? "Продажа" : "Товар от поставщика"}
            </Link>
            <Link
              className="button primary"
              href={`${newOperationHref("payment")}&direction=${kind === "customers" ? "incoming" : "outgoing"}`}
            >
              {kind === "customers" ? "Клиент принёс деньги" : "Я заплатил поставщику"}
            </Link>
            {waHref && (
              <a className="button whatsapp" href={waHref} target="_blank" rel="noreferrer">
                {reminderBalance > 0 && kind === "customers" ? "Напомнить в WhatsApp" : "WhatsApp"}
              </a>
            )}
            {entry.phone && (
              <a className="button" href={`tel:${entry.phone.replace(/[^\d+]/g, "")}`}>
                Позвонить
              </a>
            )}
            <Link className="button" href={`/${kind}/${entry.id}/statement`}>
              Акт сверки
            </Link>
            {isOwner && (
              <Link className="button" href={`/money/adjustment?party=${entry.id}`}>
                Скидка / возврат
              </Link>
            )}
          </div>
        </section>
      ) : (
        <div className="page-heading">
          <div>
            <h1>
              {entry?.name ??
                `Добавить: ${directoryMeta[kind].single.toLowerCase()}`}
            </h1>
            <p className="muted">
              {entry
                ? kind === "products"
                  ? `Остаток: ${quantity(entry.stock ?? 0)} ${entry.unit}`
                  : `Долг: ${debtMoney(entry.balance ?? 0, cur)}`
                : "Заполните основные данные."}
            </p>
          </div>
        </div>
      )}
      {saved && (
        <p className="notice success" role="status">
          Изменения сохранены.
        </p>
      )}
      {added && (
        <p className="notice success" role="status">
          {kind === "customers" ? "Клиент добавлен." : kind === "suppliers" ? "Поставщик добавлен." : "Товар добавлен."}
        </p>
      )}
      {linked && (
        <p className="notice success" role="status">
          Ссылка для клиента готова — можно отправить в WhatsApp.
        </p>
      )}
      {revoked && (
        <p className="notice success" role="status">
          Ссылка отозвана, старая ссылка больше не откроется.
        </p>
      )}
      {entry && isParty && reversed && (
        <div className="notice success" role="status">
          <p>Запись отменена. Долг пересчитан, история сохранена.</p>
          {rid && /^[a-f0-9-]{36}$/i.test(rid) && ["sale", "purchase", "payment"].includes(reversed) ? (
            <form action={redoRecord}>
              <input type="hidden" name="kind" value={reversed} />
              <input type="hidden" name="id" value={rid} />
              <button className="button" type="submit">
                Записать правильно
              </button>
            </form>
          ) : (
            <Link className="button" href={newOperationHref(reversed)}>
              Записать правильно
            </Link>
          )}
        </div>
      )}
      {entry && isParty && error === "reversal" && (
        <p className="form-error" role="alert">
          Не удалось отменить запись. Возможно, она уже отменена.
        </p>
      )}
      {(archived || restored || merged || unmerged) && (
        <p className="notice success" role="status">
          {archived
            ? "Убран в архив: его нет в списках и формах, история и ссылка сохранены."
            : restored
              ? "Возвращён из архива."
              : merged
                ? "Объединено: записи и ссылка перенесены сюда, второе имя стало синонимом. Отменить можно в течение суток — ниже, в «Управлении»."
                : "Объединение отменено."}
        </p>
      )}
      {entry?.archived_at && !entry.merged_into_id && (
        <p className="notice" role="status">
          В архиве — не показывается в списках и формах.
        </p>
      )}
      {error && ["has_records", "party", "merge", "merge_opening", "merge_expired", "merge_currency"].includes(error) && (
        <p className="form-error" role="alert">
          {error === "has_records"
            ? "Удалить нельзя: есть записи. Можно убрать в архив."
            : error === "merge_opening"
              ? "У обоих есть перенос из тетради — сначала отмените один из них, потом объединяйте."
              : error === "merge_currency"
                ? "Объединить нельзя: у них разная валюта долга."
              : error === "merge_expired"
                ? "Отменить объединение можно только в течение суток."
                : "Не удалось выполнить действие. Обновите страницу и попробуйте снова."}
        </p>
      )}
      {adjusted && (
        <p className="notice success" role="status">
          {adjusted === "return" ? "Возврат товара записан" : "Скидка записана"} — долг уменьшен.
        </p>
      )}
      {promised && (
        <p className="notice success" role="status">
          {promised === "1" ? "Обещанная дата сохранена." : "Обещанная дата убрана."}
        </p>
      )}
      {error === "promise" && (
        <p className="form-error" role="alert">
          Дата должна быть не раньше сегодняшней и не дальше чем через год.
        </p>
      )}
      {error === "link" && (
        <p className="form-error" role="alert">
          Не удалось выполнить действие со ссылкой.
        </p>
      )}
      {entry && isParty ? (
        <div className="party-layout">
          <div className="party-main">
            <section className="panel">
              <div className="section-title party-history-title">
                <h2>История</h2>
                <span className="muted party-history-legend">
                  <span className="up">+</span> долг вырос · <span className="down">−</span> долг уменьшился
                </span>
              </div>
              {history.length ? (
                <ul className="party-history">
                  {history.map((row) => {
                    // Продажа/приход увеличивают долг, оплата, скидка и возврат — уменьшают.
                    const up = row.kind !== "payment";
                    // Что открыть по нажатию: продажа — накладная и отправка, остальное — фото документа.
                    const open =
                      row.kind === "sale" && !row.opening
                        ? { href: `/money/send/${row.id}`, label: row.items || row.documentId ? "Накладная" : "Открыть" }
                        : row.documentId
                          ? { href: `/documents/${row.documentId}`, label: row.kind === "payment" ? "Фото чека" : "Фото накладной" }
                          : null;
                    const extraPhoto = row.kind === "sale" && !row.opening && row.documentId && !row.items;
                    const author = showAuthors ? who(row.createdBy) : null;
                    const reverser = showAuthors && row.reversed ? who(row.reversedBy) : null;
                    const status = row.reversed
                      ? { text: "отменена", className: "reversed" }
                      : row.duplicate && row.pending
                        ? { text: "дубликат", className: "duplicate" }
                        : row.pending
                          ? { text: "на проверке", className: "pending" }
                          : null;
                    const head = (
                      <>
                        <span className={`party-history-icon ${up ? "up" : "down"}`} aria-hidden="true">
                          {up ? "+" : "−"}
                        </span>
                        <span className="party-history-what">
                          <strong>
                            {row.label}
                            {status && " · "}
                            {status && <span className={`party-history-status ${status.className}`}>{status.text}</span>}
                          </strong>
                          <small className="muted">
                            {historyDate(row.occurred_at)}
                            {author ? ` · ${author}` : ""}
                          </small>
                        </span>
                        <span className="party-history-sum">
                          <strong className={up ? "up" : "down"}>
                            {up ? "+" : "−"}
                            {money(row.amount, cur)}
                          </strong>
                          {row.original && <small className="muted">{row.original}</small>}
                        </span>
                      </>
                    );
                    return (
                      <li
                        key={row.kind + row.id}
                        id={row.kind === "payment" ? `pay-${row.id}` : undefined}
                        className={`history-item party-history-item${row.reversed ? " reversed-row" : row.duplicate && row.pending ? " duplicate-row" : ""}`}
                      >
                        {open ? (
                          <Link className="party-history-head" href={open.href}>
                            {head}
                          </Link>
                        ) : (
                          <div className="party-history-head">{head}</div>
                        )}
                        {/* Ни фото, ни товаров — записали одну сумму («Накладной нет»). */}
                        {row.kind !== "payment" && !row.opening && !row.documentId && !row.items && (
                          <p className="party-history-note muted">без накладной</p>
                        )}
                        {row.items && (
                          <p className="party-history-note muted">
                            {row.items.names.join(", ")}
                            {row.items.count > row.items.names.length ? ` и ещё ${row.items.count - row.items.names.length}` : ""}
                          </p>
                        )}
                        {row.note && <p className="party-history-note muted">{row.note}</p>}
                        {!row.reversed && row.pending && row.receiptNote && (
                          <p className={`party-history-note ${row.receiptNote.differs ? "receipt-differs" : "muted"}`}>
                            {row.receiptNote.text}
                          </p>
                        )}
                        {row.reversed && (reverser || row.reversalComment) && (
                          <p className="party-history-note muted">
                            {reverser ? `Отменил: ${reverser}` : "Отменена"}
                            {row.reversalComment ? ` · причина: ${row.reversalComment}` : ""}
                          </p>
                        )}
                        {(open || extraPhoto || (!row.reversed && row.duplicate && row.pending && row.firstHref) || isOwner) && (
                          <div className="party-history-actions">
                            {open && (
                              <Link className="party-history-chip primary" href={open.href}>
                                {open.label}
                              </Link>
                            )}
                            {extraPhoto && (
                              <Link className="party-history-chip" href={`/documents/${row.documentId}`}>
                                Фото
                              </Link>
                            )}
                            {!row.reversed && row.duplicate && row.pending && row.firstHref && (
                              <Link className="party-history-chip duplicate-link" href={row.firstHref}>
                                Первая запись →
                              </Link>
                            )}
                            {!isOwner ? null : row.pending ? (
                              <Link className="party-history-chip" href="/claims">
                                Рассмотреть
                              </Link>
                            ) : (
                              !row.reversed && (
                                <Link
                                  className="party-history-chip danger"
                                  href={`/money/reverse/${row.kind}/${row.id}?back=${encodeURIComponent(`/${kind}/${entry.id}`)}`}
                                >
                                  Отменить
                                </Link>
                              )
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="muted">Операций пока нет.</p>
              )}
            </section>
          </div>
          <aside className="party-side">
            {kind === "customers" && (reminderBalance > 0 || entry.promised_date) && (
              <section className="panel debt-terms">
                <h2>Срок оплаты</h2>
                {promise.kind === "broken" && (
                  <p className="form-error">
                    Обещал оплатить до {dayMonth(promise.date)} — прошло {promise.daysLate} дн.
                  </p>
                )}
                <form action={setPromisedDate} className="promise-form">
                  <input type="hidden" name="customer_id" value={entry.id} />
                  <span>Обещал оплатить</span>
                  <div className="promise-presets">
                    <button className="button" type="submit" name="preset" value="tomorrow">
                      Завтра
                    </button>
                    <button className="button" type="submit" name="preset" value="week">
                      Через неделю
                    </button>
                    {entry.promised_date && (
                      <button className="text-button" type="submit" name="preset" value="clear">
                        Убрать срок
                      </button>
                    )}
                  </div>
                  <details className="promise-date" open={false}>
                    <summary>Дата</summary>
                    <label>
                      Обещал оплатить до
                      <input type="date" name="promised_date" min={today} defaultValue={entry.promised_date ?? ""} />
                    </label>
                    <button className="button" type="submit">
                      Сохранить дату
                    </button>
                  </details>
                </form>
                {aging && (
                  <>
                    <h3>Давность долга</h3>
                    <dl className="aging">
                      <div>
                        <dt>до 30 дней</dt>
                        <dd>{money(aging.due_0_30, cur)}</dd>
                      </div>
                      <div className={Number(aging.due_31_60) > 0 ? "aging-late" : ""}>
                        <dt>31–60 дней</dt>
                        <dd>{money(aging.due_31_60, cur)}</dd>
                      </div>
                      <div className={Number(aging.due_61_90) > 0 ? "aging-late" : ""}>
                        <dt>61–90 дней</dt>
                        <dd>{money(aging.due_61_90, cur)}</dd>
                      </div>
                      <div className={Number(aging.due_over_90) > 0 ? "aging-late" : ""}>
                        <dt>больше 90 дней</dt>
                        <dd>{money(aging.due_over_90, cur)}</dd>
                      </div>
                    </dl>
                  </>
                )}
              </section>
            )}
            {kind === "customers" && (
              <section className="panel share-link-panel">
                <h2>Ссылка для клиента</h2>
                <span className="muted share-link-hint">
                  Без входа: клиент видит свой долг и накладные и может сообщить об оплате.
                </span>
                {activeLink ? (
                  <>
                    <code className="share-link-url">
                      {origin}/c/{activeLink.token}
                    </code>
                    <div className="share-link-actions">
                      <CopyButton text={`${origin}/c/${activeLink.token}`} />
                      <a className="button" href={`/c/${activeLink.token}`} target="_blank" rel="noreferrer">
                        Открыть
                      </a>
                      <form action={revokeLink}>
                        <input type="hidden" name="customer_id" value={entry.id} />
                        <input type="hidden" name="link_id" value={activeLink.id} />
                        <ConfirmButton
                          className="text-button danger-text"
                          danger={false}
                          confirmLabel="Да, отозвать"
                          message="Отозвать ссылку?"
                          text="Старая ссылка и QR на уже отданных накладных перестанут открываться. Клиент увидит «Ссылка больше не действует»."
                        >
                          Отозвать
                        </ConfirmButton>
                      </form>
                    </div>
                  </>
                ) : (
                  <form action={createLink}>
                    <input type="hidden" name="customer_id" value={entry.id} />
                    <button className="button primary" type="submit">
                      Создать ссылку
                    </button>
                  </form>
                )}
              </section>
            )}
            <details className="panel party-fold" open={Boolean(formError)}>
              <summary>
                <span>
                  <strong>Данные {kind === "customers" ? "клиента" : "поставщика"}</strong>
                  <small className="muted">
                    Имя, телефон, валюта{kind === "customers" ? ", лимит долга" : ""}, заметка
                  </small>
                </span>
              </summary>
              <EntryForm kind={kind} entry={entry} shopCurrency={shopCurrency} error={formError ? error : undefined} />
            </details>
            {manage && <PartyManage {...manage} />}
          </aside>
        </div>
      ) : (
        <section className="panel form-panel">
          {twin && (
            <div className="notice lookalike" role="alert">
              <p>
                Похоже, это <strong>{twin.name}</strong>. Открыть его?
              </p>
              <Link className="button primary" href={`/${kind}/${twin.id}`}>
                Да, открыть {twin.name}
              </Link>
            </div>
          )}
          <EntryForm
            kind={kind}
            entry={entry}
            shopCurrency={shopCurrency}
            error={formError ? error : undefined}
            draft={twin ? { name: draftName ?? "", phone: draftPhone ?? "" } : undefined}
          />
        </section>
      )}
    </>
  );
}
