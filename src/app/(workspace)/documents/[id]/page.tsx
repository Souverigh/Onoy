import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { checkDocument, ownNameMatcher } from "@/lib/adre/classify";
import type { ExpenseResult, InvoiceResult } from "@/lib/adre/types";
import { expenseCategoryLabel } from "@/lib/expenses";
import { money } from "@/lib/format";
import { documentPages, signedPhotoUrl } from "@/lib/storage";
import { DocumentPhotos } from "@/components/document-photos";
import { retryRecognition, confirmDocument, updateLine, saveAlias, addLine, deleteLine } from "../actions";
import { ConfirmButton } from "@/components/confirm-button";
import { similarity } from "@/lib/match";
import { TOLERANCE } from "@/lib/adre/reconcile";
import { firstPaymentHref } from "@/lib/duplicates";
import { partyCurrency } from "@/lib/currency";

const dateTime = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Asia/Bishkek",
});
const when = (iso: string) => dateTime.format(new Date(iso));

type DuplicatePayment = {
  id: string;
  amount: string;
  occurred_at: string;
  created_at: string;
  status: string;
  reversed_at: string | null;
  reject_comment?: string | null;
  created_by: string | null;
  document_id: string | null;
  customer_id: string | null;
  supplier_id: string | null;
  duplicate_of: string | null;
};
const DUPLICATE_COLUMNS =
  "id,amount,occurred_at,created_at,status,reversed_at,created_by,document_id,customer_id,supplier_id,duplicate_of,reject_comment";

type DocRow = {
  id: string;
  storage_path: string;
  status: string;
  kind: "purchase" | "sale" | "payment" | "expense" | null;
  error_message: string | null;
  created_at: string;
};
type Line = {
  id: string;
  n: number;
  name_raw: string;
  qty: string;
  unit: string;
  price: string;
  sum: string;
  confidence: number | null;
};
type Extraction = {
  payload: { extracted?: Record<string, unknown> };
  provider: string;
  model_version: string;
  latency_ms: number | null;
  cost: number | null;
  created_at: string;
};


export default async function DocumentDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    saved?: string;
    confirmed?: string;
    retried?: string;
    aliasSaved?: string;
    error?: string;
  }>;
}) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) notFound();
  const { db, organizationId, organizationName, currency: shopCurrency, isOwner } = await getContext();
  const params2 = await searchParams;

  const docResult = await db
    .from("documents")
    .select("id,storage_path,status,kind,error_message,created_at")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (docResult.error || !docResult.data) notFound();
  const doc = docResult.data as DocRow;

  const [linesResult, extractionResult] = await Promise.all([
    db
      .from("document_lines")
      .select("id,n,name_raw,qty,unit,price,sum,confidence")
      .eq("organization_id", organizationId)
      .eq("document_id", id)
      .order("n"),
    db
      .from("document_extractions")
      .select("payload,provider,model_version,latency_ms,cost,created_at")
      .eq("organization_id", organizationId)
      .eq("document_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  const lines = (linesResult.data ?? []) as Line[];
  // Последняя строка — итог оцифровки; задержка вызова Gemini записана в
  // строке кеша (cache_extraction), поэтому берём её из последней, где она есть.
  const extractions = (extractionResult.data ?? []) as Extraction[];
  const extraction: Extraction | null = extractions[0]
    ? {
        ...extractions[0],
        latency_ms:
          extractions.find((e) => e.latency_ms != null)?.latency_ms ?? null,
      }
    : null;

  let declaredTotal: number | null = null;
  // Валюта накладной: исходная, если запись в другой валюте, иначе — долга контрагента.
  let docCurrency: string = shopCurrency;
  let saleId: string | null = null;
  // Запись, к которой приложен документ, — для блока «Запись» (статус, отмена).
  let record: { kind: "sale" | "purchase"; id: string; reversed: boolean } | null = null;
  // Сверка строк — с суммой в валюте накладной, а не с пересчитанной в долг.
  const recordTotal = (row: { total: string | number; original_amount: string | null; original_currency: string | null }) =>
    row.original_amount != null ? Number(row.original_amount) : Number(row.total);
  let party: { id: string; name: string; aliases: string[]; kind: "customer" | "supplier" } | null = null;
  if (doc.kind === "purchase") {
    const row = await db
      .from("purchases")
      .select("id,total,supplier_id,original_amount,original_currency,reversed_at")
      .eq("organization_id", organizationId)
      .eq("document_id", id)
      .maybeSingle();
    declaredTotal = row.data ? recordTotal(row.data) : null;
    if (row.data) record = { kind: "purchase", id: row.data.id, reversed: Boolean(row.data.reversed_at) };
    if (row.data) {
      const supplier = await db
        .from("suppliers")
        .select("id,name,aliases,currency")
        .eq("organization_id", organizationId)
        .eq("id", row.data.supplier_id)
        .maybeSingle();
      if (supplier.data)
        party = { id: supplier.data.id, name: supplier.data.name, aliases: supplier.data.aliases ?? [], kind: "supplier" };
      docCurrency = row.data.original_currency ?? supplier.data?.currency ?? shopCurrency;
    }
  } else if (doc.kind === "sale") {
    const row = await db
      .from("sales")
      .select("id,total,customer_id,original_amount,original_currency,reversed_at")
      .eq("organization_id", organizationId)
      .eq("document_id", id)
      .maybeSingle();
    declaredTotal = row.data ? recordTotal(row.data) : null;
    saleId = row.data?.id ?? null;
    if (row.data) record = { kind: "sale", id: row.data.id, reversed: Boolean(row.data.reversed_at) };
    if (row.data) {
      const customer = await db
        .from("customers")
        .select("id,name,aliases,currency")
        .eq("organization_id", organizationId)
        .eq("id", row.data.customer_id)
        .maybeSingle();
      if (customer.data)
        party = { id: customer.data.id, name: customer.data.name, aliases: customer.data.aliases ?? [], kind: "customer" };
      docCurrency = row.data.original_currency ?? customer.data?.currency ?? shopCurrency;
    }
  }

  // Расход: сумма в записи — третья сторона сверки с чеком.
  let expense: { id: string; amount: string; currency: string; category: string; note: string | null } | null = null;
  if (doc.kind === "expense") {
    const row = await db
      .from("expenses")
      .select("id,amount,currency,category,note")
      .eq("organization_id", organizationId)
      .eq("document_id", id)
      .maybeSingle();
    if (row.data) {
      expense = row.data;
      declaredTotal = Number(row.data.amount);
      docCurrency = row.data.currency;
    }
  }
  // Оплата-дубликат: какая запись повторена (и когда её чек оцифровали), и
  // обратное — какие записи повторили эту оплату.
  let payment: DuplicatePayment | null = null;
  let firstPayment: DuplicatePayment | null = null;
  let firstDigitizedAt: string | null = null;
  let repeats: DuplicatePayment[] = [];
  let paymentCurrency: string = shopCurrency;
  // Кто записан контрагентом (справочник) и отправитель, как на чеке.
  const partyNames = new Map<string, string>();
  const senders = new Map<string, string>();
  if (doc.kind === "payment") {
    payment =
      ((
        await db.from("payments").select(DUPLICATE_COLUMNS).eq("organization_id", organizationId).eq("document_id", id).maybeSingle()
      ).data as DuplicatePayment | null) ?? null;
    if (payment) {
      const partyId = payment.customer_id ?? payment.supplier_id;
      const [firstResult, repeatsResult, partyResult] = await Promise.all([
        payment.duplicate_of
          ? db.from("payments").select(DUPLICATE_COLUMNS).eq("organization_id", organizationId).eq("id", payment.duplicate_of).maybeSingle()
          : Promise.resolve({ data: null }),
        db
          .from("payments")
          .select(DUPLICATE_COLUMNS)
          .eq("organization_id", organizationId)
          .eq("duplicate_of", payment.id)
          .order("created_at"),
        partyId
          ? db.from(payment.customer_id ? "customers" : "suppliers").select("name,currency").eq("organization_id", organizationId).eq("id", partyId).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      const own = partyResult.data as { name: string } | null;
      if (own && partyId) partyNames.set(partyId, own.name);
      // Повтор мог прислать и другой клиент — имена всех из справочника.
      const otherCustomers = [...new Set(repeats.map((r) => r.customer_id).filter((c): c is string => !!c && !partyNames.has(c)))];
      const otherSuppliers = [...new Set(repeats.map((r) => r.supplier_id).filter((c): c is string => !!c && !partyNames.has(c)))];
      const [moreCustomers, moreSuppliers] = await Promise.all([
        otherCustomers.length
          ? db.from("customers").select("id,name").eq("organization_id", organizationId).in("id", otherCustomers)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        otherSuppliers.length
          ? db.from("suppliers").select("id,name").eq("organization_id", organizationId).in("id", otherSuppliers)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ]);
      for (const p of [...(moreCustomers.data ?? []), ...(moreSuppliers.data ?? [])]) partyNames.set(p.id, p.name);
      firstPayment = (firstResult.data as DuplicatePayment | null) ?? null;
      repeats = (repeatsResult.data ?? []) as DuplicatePayment[];
      paymentCurrency = partyCurrency(partyResult.data as { currency: string | null } | null, shopCurrency);
      // Отправитель с чека у повторов — из их распознавания (одним запросом).
      const repeatDocs = repeats.map((r) => r.document_id).filter(Boolean) as string[];
      if (repeatDocs.length) {
        const { data: repeatExtractions } = await db
          .from("document_extractions")
          .select("document_id,payload")
          .eq("organization_id", organizationId)
          .in("document_id", repeatDocs)
          .order("created_at", { ascending: false });
        for (const e of repeatExtractions ?? []) {
          const sender = (e.payload as { extracted?: { sender_name?: string | null } } | null)?.extracted?.sender_name;
          if (sender && !senders.has(e.document_id)) senders.set(e.document_id, String(sender));
        }
      }
      if (firstPayment?.document_id) {
        firstDigitizedAt =
          (
            await db
              .from("document_extractions")
              .select("created_at")
              .eq("organization_id", organizationId)
              .eq("document_id", firstPayment.document_id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle()
          ).data?.created_at ?? null;
      }
    }
  }
  // «клиент Ержан · по чеку: Тестов Тест» — кто прислал запись.
  const nameOf = (p: DuplicatePayment) => partyNames.get((p.customer_id ?? p.supplier_id) as string) ?? null;
  const whoSent = (p: DuplicatePayment, sender: string | null | undefined) =>
    [
      p.created_by ? "внёс продавец" : null,
      `${p.supplier_id ? "поставщик" : "клиент"}${nameOf(p) ? ` ${nameOf(p)}` : ""}`,
      sender ? `по чеку: ${sender}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  const statusOf = (p: DuplicatePayment) =>
    p.reversed_at
      ? "отменена"
      : p.status === "pending"
        ? "на проверке"
        : p.status === "rejected"
          ? "отклонена"
          : "подтверждена";
  const expenseFields = doc.kind === "expense" ? (extraction?.payload?.extracted as ExpenseResult | undefined) : undefined;

  const pages = await documentPages(db, organizationId, doc.id);
  const photoUrls = await Promise.all(pages.map((page) => signedPhotoUrl(db, page.storage_path)));
  const linesTotal = lines.reduce((sum, line) => sum + Number(line.sum), 0);
  const totalsMismatch =
    declaredTotal != null && Math.abs(linesTotal - declaredTotal) > TOLERANCE;
  const receiptFields = extraction?.payload?.extracted as
    | {
        bank?: string;
        operation_id?: string;
        datetime?: string;
        amount?: number;
        sender_name?: string;
        receiver_name?: string;
        purpose?: string;
        confidence?: number;
      }
    | undefined;
  const invoiceFields =
    doc.kind === "purchase" || doc.kind === "sale"
      ? (extraction?.payload?.extracted as InvoiceResult | undefined)
      : undefined;
  // «Итого», написанное на бумаге, — третья сумма сверки (см. reconcile.ts).
  const paperTotal =
    doc.kind !== "payment" && Number(invoiceFields?.total_declared) > 0
      ? Number(invoiceFields!.total_declared)
      : null;
  const paperMismatch =
    paperTotal != null && lines.length > 0 && Math.abs(linesTotal - paperTotal) > TOLERANCE;
  // Тип документа и сторона магазина — как в форме (classify.ts): контрагент —
  // другая сторона накладной, а не название нашего магазина.
  const org = invoiceFields
    ? await db.from("organizations").select("document_names").eq("id", organizationId).maybeSingle()
    : null;
  const verdict =
    invoiceFields && (doc.kind === "purchase" || doc.kind === "sale")
      ? checkDocument(
          invoiceFields,
          doc.kind,
          ownNameMatcher(
            [organizationName, ...((org?.data?.document_names as string[] | null) ?? [])],
            similarity,
          ),
        )
      : null;
  const recognizedCounterparty = verdict?.counterparty?.trim();
  const counterpartyMismatch =
    party && recognizedCounterparty
      ? Math.max(
          similarity(recognizedCounterparty, party.name),
          ...party.aliases.map((alias) => similarity(recognizedCounterparty, alias)),
          0,
        ) < 0.5
      : false;

  const verdictText =
    verdict && !verdict.ok
      ? verdict.reason === "direction"
        ? verdict.suggestedKind === "purchase"
          ? "По фото это накладная от поставщика вам — похоже на приход, а записано продажей."
          : "По фото это накладная от вашего магазина покупателю — похоже на продажу, а записано приходом."
        : {
            receipt: "По фото это чек или квитанция об оплате, а не накладная.",
            statement: "По фото это выписка или акт сверки, а не накладная.",
            price_list: "По фото это прайс-лист, а не накладная.",
            notebook: "По фото это страница тетради долгов, а не накладная.",
            not_document: "На фото не видно документа.",
          }[verdict.reason]
      : null;

  return (
    <>
      <Link className="back-link" href="/documents">
        ← Документы
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ДОКУМЕНТ</span>
          <h1>
            {doc.kind === "purchase"
              ? "Приход"
              : doc.kind === "sale"
                ? "Продажа"
                : doc.kind === "expense"
                  ? "Расход"
                  : "Оплата"}
          </h1>
        </div>
        {(doc.kind === "purchase" || doc.kind === "sale") && (
          <div className="page-heading-actions">
            {saleId && (
              <Link className="button primary" href={`/money/send/${saleId}`}>
                Отправить клиенту
              </Link>
            )}
            <a className="button" href={`/documents/${doc.id}/pdf`}>
              Скачать PDF
            </a>
          </div>
        )}
      </div>
      {params2.saved && (
        <p className="notice success" role="status">
          Строка сохранена.
        </p>
      )}
      {params2.confirmed && (
        <p className="notice success" role="status">
          Оцифровка подтверждена.
        </p>
      )}
      {params2.retried && (
        <p className="notice success" role="status">
          Запустили распознавание заново — обновите страницу через несколько секунд.
        </p>
      )}
      {params2.aliasSaved && (
        <p className="notice success" role="status">
          Синоним сохранён — в следующий раз это имя узнается сразу.
        </p>
      )}
      {params2.error && (
        <p className="form-error" role="alert">
          Не удалось выполнить действие. Проверьте значения и попробуйте снова.
        </p>
      )}
      {/* Сначала — всё, что требует внимания; ниже фото и позиции рядом. */}
      <section className="panel doc-status">
        <div className="doc-status-row">
          <span
            className={
              doc.status === "digitized"
                ? "tag green"
                : doc.status === "review" || doc.status === "failed"
                  ? "tag reversed-tag"
                  : "tag"
            }
          >
            {doc.status === "uploaded"
              ? "Ожидает"
              : doc.status === "processing"
                ? "Распознаём…"
                : doc.status === "digitized"
                  ? "Оцифрована"
                  : doc.status === "review"
                    ? "Расхождение"
                    : "Ошибка"}
          </span>
          <span className="muted doc-status-model">
            Загружен {when(doc.created_at)}
            {extraction && (doc.status === "digitized" || doc.status === "review") && (
              <> · {doc.status === "digitized" ? "оцифрован" : "распознан"} {when(extraction.created_at)}</>
            )}
          </span>
          {extraction && (
            <span className="muted doc-status-model">
              {extraction.provider} · {extraction.model_version}
              {extraction.latency_ms != null ? ` · ${extraction.latency_ms} мс` : ""}
            </span>
          )}
          {(doc.status === "failed" || doc.status === "uploaded") && doc.kind && (
            <form action={retryRecognition} className="doc-status-retry">
              <input type="hidden" name="id" value={doc.id} />
              <input type="hidden" name="kind" value={doc.kind} />
              {declaredTotal != null && (
                <input type="hidden" name="declared_total" value={declaredTotal} />
              )}
              <button className="button" type="submit">
                {doc.status === "failed" ? "Повторить распознавание" : "Распознать сейчас"}
              </button>
            </form>
          )}
        </div>
        {(payment?.duplicate_of || repeats.length > 0) && (
          <div
            className={`duplicate-warning${payment && (payment.reversed_at || payment.status === "rejected") ? " resolved" : ""}`}
          >
            {payment?.duplicate_of && (
              <>
                <strong>
                  Дубликат{payment.created_by ? "" : ` от клиента${nameOf(payment) ? ` ${nameOf(payment)}` : ""}`}
                </strong>
                {receiptFields?.sender_name && <p>Отправитель по чеку: {receiptFields.sender_name}</p>}
                <p>
                  Этот чек уже учтён в оплате
                  {firstPayment
                    ? ` от ${when(firstPayment.occurred_at)} на ${money(firstPayment.amount, paymentCurrency)} (${statusOf(firstPayment)})`
                    : ""}
                  {firstDigitizedAt ? `; её чек оцифрован ${when(firstDigitizedAt)}` : ""}. Эта запись —{" "}
                  {statusOf(payment)}, внесена {when(payment.created_at)}.
                </p>
                {firstPayment && firstPaymentHref(firstPayment) && (
                  <Link className="duplicate-link" href={firstPaymentHref(firstPayment)!}>
                    Первая запись →
                  </Link>
                )}
              </>
            )}
            {repeats.length > 0 && (
              <>
                {payment?.duplicate_of ? (
                  <p className="duplicate-subtitle">Этот же чек прислали ещё раз: {repeats.length}</p>
                ) : (
                  <strong>Этот чек повторили: {repeats.length}</strong>
                )}
                <ul className="duplicate-repeats">
                  {repeats.map((r) => {
                    const href = firstPaymentHref(r);
                    return (
                      <li key={r.id}>
                        {when(r.created_at)} · {whoSent(r, r.document_id ? senders.get(r.document_id) : null)} ·{" "}
                        {money(r.amount, paymentCurrency)} ·{" "}
                        {statusOf(r)}
                        {href && (
                          <>
                            {" · "}
                            <Link className="duplicate-link" href={href}>
                              открыть →
                            </Link>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        )}
        {(record || payment) && (
          <div className="doc-record">
            <span className="doc-record-status">
              {record
                ? record.reversed
                  ? "Запись отменена — долг пересчитан."
                  : `${record.kind === "sale" ? "Продажа" : "Приход"} записана.`
                : payment!.reversed_at
                  ? "Оплата отменена — долг пересчитан."
                  : payment!.status === "rejected"
                    ? `Заявка отклонена${payment!.reject_comment ? `: «${payment!.reject_comment}»` : ""}. Долг не менялся — отменять нечего.`
                    : payment!.status === "pending"
                      ? "Оплата ждёт проверки владельца — долг ещё не изменился."
                      : "Оплата записана."}
            </span>
            <span className="doc-record-actions">
              {party && (
                <Link className="text-button" href={`/${party.kind === "customer" ? "customers" : "suppliers"}/${party.id}`}>
                  Открыть {party.kind === "customer" ? "клиента" : "поставщика"}
                </Link>
              )}
              {!party && payment && (payment.customer_id ?? payment.supplier_id) && (
                <Link
                  className="text-button"
                  href={`/${payment.customer_id ? "customers" : "suppliers"}/${payment.customer_id ?? payment.supplier_id}`}
                >
                  Открыть {payment.customer_id ? "клиента" : "поставщика"}
                </Link>
              )}
              {isOwner && payment?.status === "pending" && !payment.reversed_at && (
                <Link className="text-button" href="/claims">
                  Рассмотреть в «Заявках»
                </Link>
              )}
              {isOwner &&
                ((record && !record.reversed) || (payment && payment.status === "confirmed" && !payment.reversed_at)) && (
                  <Link
                    className="button danger-outline"
                    href={(() => {
                      const kind = record ? record.kind : "payment";
                      const id = record ? record.id : payment!.id;
                      const partyPath = party
                        ? `/${party.kind === "customer" ? "customers" : "suppliers"}/${party.id}`
                        : payment
                          ? `/${payment.customer_id ? "customers" : "suppliers"}/${payment.customer_id ?? payment.supplier_id}`
                          : null;
                      return `/money/reverse/${kind}/${id}${partyPath ? `?back=${encodeURIComponent(partyPath)}` : ""}`;
                    })()}
                  >
                    Отменить запись
                  </Link>
                )}
            </span>
          </div>
        )}
        {doc.error_message &&
          (doc.error_message.startsWith("Не разобрали") ? (
            <p className="photo-check-mismatch">{doc.error_message}</p>
          ) : (
            // Техническую ошибку не показываем как есть (аудит 15.1 п. 2): человеческий текст + подробности.
            <div className="photo-check-mismatch">
              <p>
                Не получилось распознать фото. Попробуйте ещё раз, переснимите накладную или введите позиции
                вручную ниже.
              </p>
              <details>
                <summary className="muted">Подробности для поддержки</summary>
                <small className="muted">{doc.error_message}</small>
              </details>
            </div>
          ))}
        {verdictText && (
          <p className="photo-check-mismatch">
            {verdictText} Если запись ошибочная — отмените её и запишите правильно.
          </p>
        )}
        {verdict?.fragment && (
          <p className="photo-check-mismatch">
            Похоже, на фото только часть накладной — сумма по строкам может быть неполной.
          </p>
        )}
      </section>

      {counterpartyMismatch && party && recognizedCounterparty && (
        <section className="panel counterparty-mismatch">
          <p>
            На фото написано «{recognizedCounterparty}», а выбран(а) «{party.name}». Долг это не
            меняет — только пометка.
          </p>
          <form action={saveAlias} className="simple-operation-actions">
            <input type="hidden" name="kind" value={party.kind} />
            <input type="hidden" name="party_id" value={party.id} />
            <input type="hidden" name="alias" value={recognizedCounterparty} />
            <input type="hidden" name="document_id" value={doc.id} />
            <button className="button" type="submit">
              Это точно «{party.name}», запомнить как синоним
            </button>
          </form>
        </section>
      )}

      <div className="documents-layout">
        <section className="panel doc-photo-panel">
          <DocumentPhotos
            pages={
              photoUrls.length
                ? photoUrls.map((url, i) => ({ url, mimeType: pages[i].mime_type }))
                : [{ url: null, mimeType: "image/jpeg" }]
            }
          />
        </section>

        {doc.kind === "expense" ? (
          <section className="panel">
            <div className="section-title">
              <h2>Распознанные данные чека</h2>
              {expense && (
                <Link className="text-button" href={`/money/expense/${expense.id}`}>
                  Открыть расход →
                </Link>
              )}
            </div>
            {expenseFields ? (
              <>
                <dl className="details">
                  <dt>Кому заплатили</dt>
                  <dd>{expenseFields.vendor ?? "—"}</dd>
                  <dt>Дата</dt>
                  <dd>{expenseFields.datetime ?? "—"}</dd>
                  <dt>Сумма на чеке</dt>
                  <dd>{expenseFields.amount > 0 ? money(expenseFields.amount, expenseFields.currency ?? docCurrency) : "—"}</dd>
                  <dt>В записи</dt>
                  <dd>{expense ? money(expense.amount, expense.currency) : "—"}</dd>
                  <dt>За что</dt>
                  <dd>{expenseFields.description ?? "—"}</dd>
                  <dt>Категория по чеку</dt>
                  <dd>
                    {expenseCategoryLabel(expenseFields.category)}
                    {expense && expense.category !== expenseFields.category && (
                      <span className="muted"> · в записи: {expenseCategoryLabel(expense.category)}</span>
                    )}
                  </dd>
                </dl>
                {doc.status === "review" && (
                  <>
                    <p className="photo-check-mismatch">
                      {expenseFields.document_class === "not_document"
                        ? "На фото не видно чека."
                        : "Сумма на чеке не совпадает с записью или чек плохо читается. Сверьте с фото."}{" "}
                      Если запись ошибочная — отмените расход и запишите правильно.
                    </p>
                    <form action={confirmDocument} className="simple-operation-actions">
                      <input type="hidden" name="id" value={doc.id} />
                      <button className="button primary" type="submit">
                        Всё верно
                      </button>
                    </form>
                  </>
                )}
              </>
            ) : (
              <p className="muted">
                {expense ? "Данные появятся после распознавания." : "Фото ещё не привязано к расходу."}
              </p>
            )}
          </section>
        ) : doc.kind === "payment" ? (
          <section className="panel">
            <h2>Распознанные данные чека</h2>
            {receiptFields ? (
              <dl className="details">
                <dt>Банк</dt>
                <dd>{receiptFields.bank ?? "—"}</dd>
                <dt>Номер операции</dt>
                <dd>{receiptFields.operation_id ?? "—"}</dd>
                <dt>Дата и время</dt>
                <dd>{receiptFields.datetime ?? "—"}</dd>
                <dt>Сумма</dt>
                <dd>{receiptFields.amount != null ? money(receiptFields.amount) : "—"}</dd>
                <dt>Отправитель</dt>
                <dd>{receiptFields.sender_name ?? "—"}</dd>
                <dt>Получатель</dt>
                <dd>{receiptFields.receiver_name ?? "—"}</dd>
              </dl>
            ) : (
              <p className="muted">Данные появятся после распознавания.</p>
            )}
          </section>
        ) : (
          // Высоту ряда задаёт фото; позиции подстраиваются под неё и
          // прокручиваются, если не помещаются.
          <section className="panel doc-lines-panel">
            <div className="doc-lines-inner">
              <div className="section-title">
                <h2>Позиции</h2>
                {lines.length > 0 && (declaredTotal != null || paperTotal != null) && (
                  <span className={totalsMismatch || paperMismatch ? "tag reversed-tag" : "tag green"}>
                    Строки: {money(linesTotal, docCurrency)}
                    {paperTotal != null && <> · На бумаге: {money(paperTotal, docCurrency)}</>}
                    {declaredTotal != null && <> · В записи: {money(declaredTotal, docCurrency)}</>}
                  </span>
                )}
              </div>
              {paperMismatch && (
                <p className="photo-check-mismatch">
                  «Итого» на бумаге не равно сумме строк — возможно, строка не распозналась или в
                  накладной ошибка в сложении. Сверьте строки с фото.
                </p>
              )}
              {lines.length > 0 ? (
                <>
                  <div className="doc-lines-scroll">
              <ol className="invoice-lines">
                {lines.map((line) => {
                  const computed = Number(line.qty) * Number(line.price);
                  const lineMismatch = Math.abs(computed - Number(line.sum)) > TOLERANCE;
                  const lowConfidence = line.confidence != null && line.confidence < 0.8;
                  return (
                    <li
                      key={line.id}
                      className={`invoice-line${lineMismatch ? " line-mismatch" : lowConfidence ? " line-doubt" : ""}`}
                    >
                      <details>
                        <summary>
                          <span className="invoice-line-n">{line.n}</span>
                          <span className="invoice-line-body">
                            <span className="invoice-line-name">{line.name_raw}</span>
                            <span className="invoice-line-calc">
                              <span className="nowrap">
                                {line.qty} {line.unit} × {money(line.price, docCurrency)}
                              </span>
                              {lineMismatch && (
                                <>
                                  {" "}· по бумаге <span className="nowrap">{money(line.sum, docCurrency)}</span>, должно
                                  быть <span className="nowrap">{money(computed, docCurrency)}</span>
                                </>
                              )}
                              {!lineMismatch && lowConfidence && <> · проверьте, плохо читается</>}
                            </span>
                          </span>
                          <span className="invoice-line-sum">{money(line.sum, docCurrency)}</span>
                        </summary>
                        <form action={updateLine} className="invoice-line-form">
                          <input type="hidden" name="line_id" value={line.id} />
                          <input type="hidden" name="document_id" value={doc.id} />
                          <label className="invoice-line-field-name">
                            Название
                            <input name="name_raw" defaultValue={line.name_raw} maxLength={200} />
                          </label>
                          <label>
                            Кол-во
                            <input name="qty" defaultValue={line.qty} inputMode="decimal" />
                          </label>
                          <label>
                            Ед.
                            <input name="unit" defaultValue={line.unit} />
                          </label>
                          <label>
                            Цена
                            <input name="price" defaultValue={line.price} inputMode="decimal" />
                          </label>
                          <button className="button primary" type="submit">
                            Сохранить
                          </button>
                        </form>
                        <form action={deleteLine} className="invoice-line-delete">
                          <input type="hidden" name="line_id" value={line.id} />
                          <input type="hidden" name="document_id" value={doc.id} />
                          <ConfirmButton className="button danger-outline" message={`Удалить строку ${line.n} «${line.name_raw}»?`}>
                            Удалить строку
                          </ConfirmButton>
                        </form>
                      </details>
                    </li>
                  );
                })}
              </ol>
                  </div>
                  <p className="muted invoice-lines-hint">Нажмите на строку, чтобы исправить.</p>
                  {doc.status === "review" && (
                    <form action={confirmDocument} className="simple-operation-actions">
                      <input type="hidden" name="id" value={doc.id} />
                      <button className="button primary" type="submit">
                        Подтвердить оцифровку
                      </button>
                    </form>
                  )}
                </>
              ) : (
                <p className="muted">
                  {doc.status === "failed" || doc.status === "review"
                    ? "Позиций нет — введите их вручную ниже."
                    : "Позиции появятся после распознавания."}
                </p>
              )}
              <details className="invoice-line-add">
                <summary className="button">+ Добавить строку</summary>
                <form action={addLine} className="invoice-line-form">
                  <input type="hidden" name="document_id" value={doc.id} />
                  <label className="invoice-line-field-name">
                    Название
                    <input name="name_raw" required maxLength={200} />
                  </label>
                  <label>
                    Кол-во
                    <input name="qty" required inputMode="decimal" defaultValue="1" />
                  </label>
                  <label>
                    Ед.
                    <input name="unit" defaultValue="шт" />
                  </label>
                  <label>
                    Цена (скидка — с минусом)
                    <input name="price" required inputMode="decimal" />
                  </label>
                  <button className="button primary" type="submit">
                    Добавить
                  </button>
                </form>
              </details>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
