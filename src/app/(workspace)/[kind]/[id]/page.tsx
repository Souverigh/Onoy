import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { isDirectory } from "@/lib/validation";
import { directoryMeta, type Entry } from "@/lib/directory";
import { EntryForm } from "@/components/entry-form";
import { money, originalAmountText, quantity } from "@/lib/format";
import { partyCurrency } from "@/lib/currency";
import { creditLimitExceeded } from "@/lib/credit-limit";
import { createLink, revokeLink, setPromisedDate } from "@/app/(workspace)/[kind]/actions";
import { dayMonth, promiseStatus } from "@/lib/promise";
import { paymentLabel } from "@/lib/entry-labels";
import { firstPaymentHref } from "@/lib/duplicates";
import { checkReceipt, receiptAmounts, receiptDiffers } from "@/lib/claim-receipt";
import { officialRates } from "@/lib/fx";
import { CURRENCIES } from "@/lib/currency";
import { memberLabels } from "@/lib/members";
import { PartyManage } from "@/components/party-manage";
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
  }>;
}) {
  const { kind, id } = await params;
  if (!isDirectory(kind)) notFound();
  const { db, organizationId, organizationName, isOwner, currency: shopCurrency } = await getContext();
  const { error, saved, linked, revoked, reversed, promised, adjusted, archived, restored, merged, unmerged } =
    await searchParams;
  let entry: Entry | undefined;
  if (id !== "new") {
    if (!/^[a-f0-9-]{36}$/i.test(id)) notFound();
    const result = await db
      .from(directoryMeta[kind].view)
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", id)
      .maybeSingle();
    if (result.error) throw new Error("Не удалось открыть запись");
    if (!result.data) notFound();
    entry = result.data as Entry;
  }

  const isParty = kind === "customers" || kind === "suppliers";
  let activeLink: ShareLink | undefined;
  let origin = "";
  let aging: Aging | null = null;
  if (entry && kind === "customers") {
    const agingResult = await db
      .from("customer_debt_aging")
      .select("due_0_30,due_31_60,due_61_90,due_over_90,oldest_days")
      .eq("organization_id", organizationId)
      .eq("customer_id", entry.id)
      .maybeSingle();
    aging = (agingResult.data as Aging | null) ?? null;
    const links = await db
      .from("share_links")
      .select("id,token,revoked_at")
      .eq("organization_id", organizationId)
      .eq("customer_id", entry.id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
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
  };
  let history: HistoryRow[] = [];
  if (entry && isParty) {
    const partyColumn = kind === "customers" ? "customer_id" : "supplier_id";
    const invoiceTable = kind === "customers" ? "sales" : "purchases";
    const [invoices, pays] = await Promise.all([
      db
        .from(invoiceTable)
        .select("id,total,occurred_at,reversed_at,reversal_comment,document_id,is_opening,created_by,reversed_by,original_amount,original_currency,fx_rate")
        .eq("organization_id", organizationId)
        .eq(partyColumn, entry.id)
        .eq("status", "posted")
        .order("occurred_at", { ascending: false })
        .limit(20),
      db
        .from("payments")
        .select("id,amount,occurred_at,reversed_at,reversal_comment,document_id,status,is_opening,kind,note,created_by,reversed_by,original_amount,original_currency,fx_rate,duplicate_of")
        .eq("organization_id", organizationId)
        .eq(partyColumn, entry.id)
        .eq("direction", kind === "customers" ? "incoming" : "outgoing")
        .neq("status", "rejected")
        .order("occurred_at", { ascending: false })
        .limit(20),
    ]);
    const firstIds = [...new Set((pays.data ?? []).map((p) => p.duplicate_of).filter(Boolean) as string[])];
    const firsts = firstIds.length
      ? (
          await db
            .from("payments")
            .select("id,document_id,customer_id,supplier_id")
            .eq("organization_id", organizationId)
            .in("id", firstIds)
        ).data ?? []
      : [];
    const firstHrefs = new Map(firsts.map((f) => [f.id, firstPaymentHref(f)]));
    // Заявки на проверке: сумма с чека против суммы заявки — видно и продавцу.
    const pendingPays = (pays.data ?? []).filter((p) => p.status === "pending" && p.document_id);
    const receipts = await receiptAmounts(db, organizationId, pendingPays.map((p) => p.document_id as string));
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
        label: r.is_opening ? "Долг из тетради" : kind === "customers" ? "Продажа" : "Приход",
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
  const members = isOwner && entry && isParty ? await memberLabels(db, organizationId) : new Map();
  const showAuthors = [...members.values()].some((m) => m.role === "staff");
  const who = (id: string | null) => (id ? (members.get(id)?.name ?? "бывший сотрудник") : null);

  // Управление контрагентом: есть ли записи (включая отменённые и заявки),
  // с кем можно объединить, недавние объединения (отмена в течение суток).
  let manage: React.ComponentProps<typeof PartyManage> | null = null;
  if (entry && isParty) {
    const partyColumn = kind === "customers" ? "customer_id" : "supplier_id";
    const [docs, pays, others, merges, into] = await Promise.all([
      db
        .from(kind === "customers" ? "sales" : "purchases")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq(partyColumn, entry.id),
      db
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq(partyColumn, entry.id),
      isOwner
        ? db
            .from(kind)
            .select("id,name")
            .eq("organization_id", organizationId)
            .is("merged_into_id", null)
            .is("archived_at", null)
            .neq("id", entry.id)
            .order("name")
            .range(0, 999)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      isOwner
        ? db
            .from("party_merges")
            .select("id,from_id")
            .eq("organization_id", organizationId)
            .eq("into_id", entry.id)
            .is("undone_at", null)
            .gt("created_at", new Date(Date.now() - 86400000).toISOString())
        : Promise.resolve({ data: [] as { id: string; from_id: string }[] }),
      entry.merged_into_id
        ? db.from(kind).select("id,name").eq("organization_id", organizationId).eq("id", entry.merged_into_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const mergeRows = (merges.data ?? []) as { id: string; from_id: string }[];
    const fromNames = mergeRows.length
      ? new Map(
          ((await db.from(kind).select("id,name").in("id", mergeRows.map((m) => m.from_id))).data ?? []).map((p) => [
            p.id as string,
            p.name as string,
          ]),
        )
      : new Map<string, string>();
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
      recentMerges: mergeRows.map((m) => ({ id: m.id, fromName: fromNames.get(m.from_id) ?? "контрагент" })),
    };
  }

  const newOperationHref = (type: string) =>
    `/money/new?type=${["sale", "purchase", "payment"].includes(type) ? type : "payment"}&party=${entry?.id ?? ""}`;

  const today = bishkekDate();
  const promise =
    entry && kind === "customers"
      ? promiseStatus(entry.promised_date, Number(entry.balance ?? 0), today)
      : ({ kind: "none" } as const);
  const promiseLine =
    promise.kind === "broken"
      ? ` Вы обещали оплатить до ${dayMonth(promise.date)}.`
      : promise.kind === "upcoming"
        ? ` Срок оплаты — ${dayMonth(promise.date)}.`
        : "";
  // Аудит ТЗ 15.1 п. 14: название магазина, без «долг в», страница не «оплатить», а посмотреть.
  const reminderText =
    entry && kind === "customers"
      ? `Магазин «${organizationName}»: ваш долг ${money(entry.balance ?? 0, cur)}.${promiseLine}${
          activeLink ? ` Накладные и история: ${origin}/c/${activeLink.token}` : ""
        }`
      : "";
  const waHref =
    entry?.phone && reminderText
      ? `https://wa.me/${waPhone(entry.phone)}?text=${encodeURIComponent(reminderText)}`
      : undefined;

  return (
    <>
      <Link className="back-link" href={`/${kind}`}>
        ← {directoryMeta[kind].title}
      </Link>
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
                : `Долг / аванс: ${money(entry.balance ?? 0, cur)}`
              : "Заполните основные данные."}
            {entry?.credit_limit != null && ` · лимит ${money(entry.credit_limit, cur)}`}
            {overLimit && <span className="tag reversed-tag">больше лимита</span>}
          </p>
        </div>
      </div>
      {saved && (
        <p className="notice success" role="status">
          Изменения сохранены.
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
          <Link className="button" href={newOperationHref(reversed)}>
            Записать правильно
          </Link>
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
      {entry && isParty && (
        <section className="panel party-actions">
          {waHref && (
            <a className="button primary" href={waHref} target="_blank" rel="noreferrer">
              Напомнить в WhatsApp
            </a>
          )}
          <Link className="button" href={`/${kind}/${entry.id}/statement`}>
            Акт сверки
          </Link>
          <Link className="button" href={newOperationHref(kind === "customers" ? "sale" : "purchase")}>
            {kind === "customers" ? "Продажа" : "Приход"}
          </Link>
          <Link className="button" href={newOperationHref("payment")}>
            Оплата
          </Link>
          {isOwner && (
            <Link className="button" href={`/money/adjustment?party=${entry.id}`}>
              Скидка / возврат
            </Link>
          )}
        </section>
      )}
      {entry && kind === "customers" && (
        <section className="panel debt-terms">
          <h2>Срок и давность долга</h2>
          {promise.kind === "broken" ? (
            <p className="form-error">
              Обещал оплатить до {dayMonth(promise.date)} — прошло {promise.daysLate} дн.
            </p>
          ) : promise.kind === "upcoming" ? (
            <p>
              Обещал оплатить до <strong>{dayMonth(promise.date)}</strong>
              {promise.daysLeft === 0 ? " — сегодня" : ` — через ${promise.daysLeft} дн.`}
            </p>
          ) : (
            <p className="muted">Обещанной даты нет.</p>
          )}
          <form action={setPromisedDate} className="promise-form">
            <input type="hidden" name="customer_id" value={entry.id} />
            <label>
              Обещал оплатить до
              <input
                type="date"
                name="promised_date"
                min={today}
                defaultValue={entry.promised_date ?? ""}
              />
            </label>
            <button className="button" type="submit">
              Сохранить
            </button>
          </form>
          {aging ? (
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
          ) : (
            <p className="muted">Долга нет — давность не считается.</p>
          )}
        </section>
      )}
      {entry && kind === "customers" && (
        <section className="panel share-link-panel">
          <h2>Страница клиента без входа</h2>
          {activeLink ? (
            <>
              <p className="muted">
                {origin}/c/{activeLink.token}
              </p>
              <form action={revokeLink} className="simple-operation-actions">
                <input type="hidden" name="customer_id" value={entry.id} />
                <input type="hidden" name="link_id" value={activeLink.id} />
                <button className="button" type="submit">
                  Отозвать ссылку
                </button>
              </form>
            </>
          ) : (
            <form action={createLink} className="simple-operation-actions">
              <input type="hidden" name="customer_id" value={entry.id} />
              <button className="button primary" type="submit">
                Создать ссылку для клиента
              </button>
            </form>
          )}
        </section>
      )}
      {entry && isParty && (
        <section className="panel">
          <h2>История</h2>
          {history.length ? (
            <ul className="history-list">
              {history.map((row) => (
                <li
                  key={row.kind + row.id}
                  id={row.kind === "payment" ? `pay-${row.id}` : undefined}
                  className={`history-item${row.reversed ? " reversed-row" : row.duplicate && row.pending ? " duplicate-row" : ""}`}
                >
                  <div className="history-main">
                    <span className="history-kind">
                      {row.label}
                      {row.reversed && <span className="tag reversed-tag">отменена</span>}
                      {!row.reversed && row.duplicate && row.pending && <span className="tag duplicate-tag">дубликат</span>}
                    </span>
                    <strong className="history-amount">
                      {money(row.amount, cur)}
                      {row.original && <small className="muted history-original">{row.original}</small>}
                    </strong>
                  </div>
                  <div className="history-meta">
                    <span className="muted">
                      {new Intl.DateTimeFormat("ru-RU", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: "Asia/Bishkek",
                      }).format(new Date(row.occurred_at))}
                    </span>
                    <span className="history-actions">
                      {row.kind === "sale" && !row.reversed && !row.opening && (
                        <Link className="text-button" href={`/money/send/${row.id}`}>
                          Отправить
                        </Link>
                      )}
                      {row.documentId && (
                        <Link className="text-button" href={`/documents/${row.documentId}`}>
                          Фото
                        </Link>
                      )}
                      {!isOwner ? null : row.pending ? (
                        <Link className="text-button" href="/claims">
                          Рассмотреть
                        </Link>
                      ) : (
                        !row.reversed && (
                          <Link
                            className="text-button"
                            href={`/money/reverse/${row.kind}/${row.id}?back=${encodeURIComponent(`/${kind}/${entry.id}`)}`}
                          >
                            Отменить
                          </Link>
                        )
                      )}
                    </span>
                  </div>
                  {row.note && <p className="history-comment muted">{row.note}</p>}
                  {!row.reversed && row.pending && row.receiptNote && (
                    <p className={`history-comment ${row.receiptNote.differs ? "receipt-differs" : "muted"}`}>
                      {row.receiptNote.text}
                    </p>
                  )}
                  {!row.reversed && row.duplicate && row.pending && row.firstHref && (
                    <p className="history-comment">
                      <Link className="duplicate-link" href={row.firstHref}>
                        Первая запись →
                      </Link>
                    </p>
                  )}
                  {showAuthors && (who(row.createdBy) || (row.reversed && who(row.reversedBy))) && (
                    <p className="history-comment muted">
                      {who(row.createdBy) && <>Внёс: {who(row.createdBy)}</>}
                      {row.reversed && who(row.reversedBy) && <> · отменил: {who(row.reversedBy)}</>}
                    </p>
                  )}
                  {row.reversed && row.reversalComment && (
                    <p className="history-comment muted">Причина отмены: {row.reversalComment}</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Операций пока нет.</p>
          )}
        </section>
      )}
      {manage && <PartyManage {...manage} />}
      <section className="panel form-panel">
        <EntryForm
          kind={kind}
          entry={entry}
          shopCurrency={shopCurrency}
          error={
            error && ["link", "reversal", "promise", "has_records", "party", "merge", "merge_opening", "merge_expired", "merge_currency"].includes(error)
              ? undefined
              : error
          }
        />
      </section>
    </>
  );
}
