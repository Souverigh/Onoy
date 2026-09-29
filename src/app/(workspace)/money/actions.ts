"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { getContext } from "@/lib/context";
import { decimalInput } from "@/lib/validation";
import { safeBackPath } from "@/lib/back-path";
import { isDuplicatePhoto, uploadOperationPhoto, uploadOperationPhotos } from "@/lib/storage";
import { expenseDateInput, isExpenseCategory } from "@/lib/expenses";
import { bishkekDate } from "@/lib/day-summary";
import { MAX_PAGES, documentMimeType } from "@/lib/pages";
import {
  recognizeDocument,
  finalizeInvoiceRecognition,
  recognizeInvoiceCached,
  recognizeReceiptCached,
  recognizeExpenseCached,
  storagePhotoSource,
} from "@/lib/adre/recognize";
import type { ExpenseResult, InvoiceResult, PhotoPage } from "@/lib/adre/types";
import { checkDocument, ownNameMatcher, type DocumentVerdict } from "@/lib/adre/classify";
import { bestMatches, similarity } from "@/lib/match";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bishkekDateTime, receiptDateTime } from "@/lib/receipt-date";
import { isAdjustmentKind } from "@/lib/entry-labels";
import { normalizePhone, phoneKey } from "@/lib/contacts";
import { isCurrency, rateInput, type Currency } from "@/lib/currency";

type Operation = "purchase" | "sale" | "payment";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function field(form: FormData, name: string) {
  const value = form.get(name);
  if (typeof value !== "string") throw new Error("invalid_input");
  return value.trim();
}

function failureCode(message: string) {
  if (message.includes("idempotency_conflict")) return "retry";
  if (message.includes("invalid_date")) return "date";
  if (message.includes("shop_blocked")) return "blocked";
  if (message.includes("invalid_currency")) return "currency";
  // unique(organization_id,document_id): это фото уже основание другой записи.
  if (message.includes("document_id")) return "photo_used";
  if (message.includes("invalid_") || message.includes("not_a_member"))
    return "invalid";
  if (message.includes("23505")) return "duplicate";
  return "save";
}

/** Страницы накладной по порядку (одно фото — одна страница). */
function photosOf(form: FormData) {
  return form
    .getAll("photo")
    .filter((file): file is File => file instanceof File && file.size > 0);
}

/**
 * Итог подтверждения формы, если запись не прошла (ТЗ §15.5: ошибка не
 * сбрасывает форму). Успех — редирект на экран результата. `documentId` —
 * фото уже загружены: повторная отправка возьмёт их, а не загрузит заново.
 */
export type CommitState = { error?: string; documentId?: string; attempt?: number };

export async function commitOperation(
  previous: CommitState,
  form: FormData,
): Promise<CommitState> {
  const attempt = (previous.attempt ?? 0) + 1;
  try {
    const failure = await commitOperationOrRedirect(form);
    return { ...failure, attempt };
  } catch (error) {
    // redirect() на экран результата — не ошибка.
    unstable_rethrow(error);
    console.error("commitOperation: unexpected failure", error);
    return { error: "save", attempt };
  }
}

async function commitOperationOrRedirect(
  form: FormData,
): Promise<{ error: string; documentId?: string }> {
  const rawKind = form.get("kind");
  const kind = typeof rawKind === "string" ? rawKind : "";
  if (!["purchase", "sale", "payment"].includes(kind)) return { error: "invalid" };

  const operation = kind as Operation;
  let idempotencyKey = "";
  let party = "";
  let direction = "";
  let amount = "";
  let bankReference = "";
  let occurredAt: string | null = null;
  let paidNow: string | null = null;
  let partPaymentKey = "";
  let paidImmediately = false;
  const photos = photosOf(form);
  const photo = photos.length > 0;
  const existingDocumentId = String(form.get("document_id") ?? "").trim();
  // Сумма в другой валюте, чем долг контрагента: база пересчитает по курсу.
  const rawOriginalCurrency = String(form.get("original_currency") ?? "");
  const originalCurrency = isCurrency(rawOriginalCurrency) ? rawOriginalCurrency : null;
  const fxRate = originalCurrency ? rateInput(String(form.get("fx_rate") ?? "")) : null;
  if (originalCurrency && !fxRate) return { error: "rate" };
  const hasExistingDocument = uuidPattern.test(existingDocumentId);
  if (operation !== "payment" && !photo && !hasExistingDocument) return { error: "photo" };
  // Чек оплаты — всегда одно фото; накладная — до MAX_PAGES страниц.
  if (photos.length > (operation === "payment" ? 1 : MAX_PAGES)) return { error: "photo_upload" };
  try {
    idempotencyKey = field(form, "idempotency_key");
    if (!uuidPattern.test(idempotencyKey)) throw new Error("invalid_input");
    if (operation === "purchase") {
      party = field(form, "supplier_id");
      amount = decimalInput(field(form, "total"), 2);
      if (!uuidPattern.test(party)) throw new Error("invalid_input");
      // «Оплатить часть» сразу при приходе (ТЗ §4 А): не больше суммы прихода.
      const rawPaid = String(form.get("paid_now") ?? "").trim();
      if (rawPaid) {
        paidNow = decimalInput(rawPaid, 2);
        partPaymentKey = field(form, "part_payment_key");
        if (!uuidPattern.test(partPaymentKey)) throw new Error("invalid_input");
        if (Number(paidNow) === 0) paidNow = null;
        // Сумма прихода в другой валюте — сравниваем после пересчёта в базе
        // (ниже, по итоговой сумме записи).
        else if (!originalCurrency && Number(paidNow) > Number(amount)) return { error: "part" };
      }
    } else if (operation === "sale") {
      party = field(form, "customer_id");
      amount = decimalInput(field(form, "total"), 2);
      paidImmediately = form.get("paid_immediately") === "true";
      if (!uuidPattern.test(party)) throw new Error("invalid_input");
    } else {
      direction = field(form, "direction");
      party = field(form, "party_id");
      amount = decimalInput(field(form, "amount"), 2);
      bankReference = field(form, "bank_reference");
      // Дата перевода (из чека или вручную); пусто — «сейчас».
      const rawDate = String(form.get("occurred_at") ?? "").trim();
      if (rawDate) {
        occurredAt = bishkekDateTime(rawDate);
        if (!occurredAt) return { error: "date" };
      }
      if (
        !["incoming", "outgoing"].includes(direction) ||
        !uuidPattern.test(party) ||
        bankReference.length > 200
      )
        throw new Error("invalid_input");
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "invalid_input" ||
        error.message.startsWith("Введите неотрицательное число"))
    ) {
      console.error("commitOperation: field validation failed", {
        operation,
        reason: error.message,
        hasParty: uuidPattern.test(party),
        rawAmount: operation === "payment" ? form.get("amount") : form.get("total"),
      });
      return { error: uuidPattern.test(party) || operation === "payment" ? "amount" : "party" };
    }
    throw error;
  }
  if (!(Number(amount) > 0)) return { error: "amount" };

  const { db, organizationId } = await getContext();
  // Исходная сумма и курс — только если валюта суммы не валюта долга.
  const original = originalCurrency
    ? { p_amount: null, p_original_amount: amount, p_original_currency: originalCurrency, p_fx_rate: fxRate }
    : { p_amount: amount };
  let documentId: string | null = hasExistingDocument ? existingDocumentId : null;
  if (photo && !hasExistingDocument) {
    try {
      documentId = await uploadOperationPhotos(db, organizationId, operation, photos);
    } catch (error) {
      const used = error instanceof Error && error.message === "document_in_use";
      return { error: used ? "photo_used" : "photo_upload" };
    }
  }
  const result =
    operation === "purchase"
      ? await db.rpc("commit_purchase", {
          p_org: organizationId,
          p_supplier: party,
          ...original,
          p_idempotency_key: idempotencyKey,
          p_document: documentId,
        })
      : operation === "sale"
        ? await db.rpc("commit_sale", {
            p_org: organizationId,
            p_customer: party,
            ...original,
            p_paid_immediately: paidImmediately,
            p_idempotency_key: idempotencyKey,
            p_document: documentId,
          })
        : await db.rpc("commit_payment", {
            p_org: organizationId,
            p_direction: direction,
            p_party: party,
            ...original,
            p_bank_reference: bankReference || null,
            p_idempotency_key: idempotencyKey,
            p_document: documentId,
            ...(occurredAt ? { p_occurred_at: occurredAt } : {}),
          });
  if (result.error || !result.data) {
    console.error("commitOperation: RPC failed", {
      operation,
      amount,
      message: result.error?.message,
    });
    const error = failureCode(result.error?.message ?? "save");
    // Фото уже загружены — при исправлении формы не грузим их второй раз.
    // Кроме случая, когда само фото занято другой записью.
    return error === "photo_used" || !documentId ? { error } : { error, documentId };
  }
  if (documentId) {
    const declaredTotal = operation === "payment" ? null : Number(amount);
    const recognizedRaw = form.get("recognized_result");
    let recognizedResult: InvoiceResult | null = null;
    if (typeof recognizedRaw === "string" && recognizedRaw) {
      try {
        recognizedResult = JSON.parse(recognizedRaw) as InvoiceResult;
      } catch {
        recognizedResult = null;
      }
    }
    if (recognizedResult && operation !== "payment") {
      // Продавец уже проверил фото до подтверждения — записываем готовый
      // результат, повторный вызов Gemini не нужен.
      after(() =>
        finalizeInvoiceRecognition({
          db,
          organizationId,
          documentId,
          result: recognizedResult,
          declaredTotal,
        }),
      );
    } else {
      after(() =>
        recognizeDocument({
          db,
          organizationId,
          documentId,
          kind: operation,
          declaredTotal,
        }),
      );
    }
  }
  // Оплата части прихода — отдельная запись оплаты поставщику. Приход уже
  // записан: если оплата не прошла, говорим об этом, а не теряем приход.
  let part = "";
  if (operation === "purchase" && paidNow && originalCurrency) {
    // Приход в другой валюте: оплата части — не больше суммы после пересчёта.
    const posted = await db.from("purchases").select("total").eq("organization_id", organizationId).eq("id", result.data).maybeSingle();
    if (posted.data && Number(paidNow) > Number(posted.data.total)) {
      paidNow = null;
      part = "&part=failed";
    }
  }
  if (operation === "purchase" && paidNow) {
    const payment = await db.rpc("commit_payment", {
      p_org: organizationId,
      p_direction: "outgoing",
      p_party: party,
      p_amount: paidNow,
      p_bank_reference: null,
      p_idempotency_key: partPaymentKey,
    });
    if (payment.error) {
      console.error("commitOperation: part payment failed", { message: payment.error.message });
      part = "&part=failed";
    } else part = `&part=${paidNow}`;
  }
  // Повторы фото разрешены в настройках — запись прошла, но предупреждаем.
  const duplicate =
    documentId !== null && (await isDuplicatePhoto(db, organizationId, documentId));
  revalidatePath("/", "layout");
  // Экран результата (ТЗ §15.2): продажа — сразу отправка клиенту, приход и
  // оплата — «Записано» с долгом до → после.
  const extra = `${part}${duplicate ? "&duplicate=1" : ""}`;
  redirect(
    operation === "sale"
      ? `/money/send/${result.data}?done=1${extra}`
      : `/money/done/${operation}/${result.data}?done=1${extra}`,
  );
}

/** Похожий клиент или поставщик по имени с документа. */
export type PartySuggestion = { id: string; name: string; score: number };

export type InvoiceCheck =
  | {
      ok: true;
      documentId: string;
      result: InvoiceResult;
      duplicate: boolean;
      verdict: DocumentVerdict;
      /** Для прихода — поставщики, для продажи — клиенты; при «direction» — из другого списка. */
      suggestions: PartySuggestion[];
    }
  | { ok: false; error: string; documentId?: string; duplicate?: boolean };

/**
 * Тип документа и сторона магазина (classify.ts) + похожие контрагенты.
 * Названия магазина — из настроек (organizations.name + document_names).
 */
async function documentVerdict(
  db: SupabaseClient,
  organizationId: string,
  kind: "purchase" | "sale",
  result: InvoiceResult,
): Promise<{ verdict: DocumentVerdict; suggestions: PartySuggestion[] }> {
  const org = await db
    .from("organizations")
    .select("name,document_names")
    .eq("id", organizationId)
    .maybeSingle();
  const ownNames = [org.data?.name ?? "", ...((org.data?.document_names as string[] | null) ?? [])];
  const verdict = checkDocument(result, kind, ownNameMatcher(ownNames, similarity));
  if (!verdict.counterparty) return { verdict, suggestions: [] };
  const partyKind = verdict.ok ? kind : verdict.reason === "direction" ? verdict.suggestedKind : kind;
  const parties = await db
    .from(partyKind === "purchase" ? "suppliers" : "customers")
    .select("id,name,aliases")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .is("merged_into_id", null)
    .range(0, 999);
  const suggestions = bestMatches(
    verdict.counterparty,
    (parties.data ?? []) as { id: string; name: string; aliases?: string[] }[],
    3,
    0.45,
  ).map((m) => ({ id: m.candidate.id, name: m.candidate.name, score: m.score }));
  return { verdict, suggestions };
}

async function checkInvoice(
  db: SupabaseClient,
  organizationId: string,
  kind: "purchase" | "sale",
  documentId: string,
  duplicate: boolean,
  loadPhoto: () => Promise<PhotoPage[]>,
): Promise<InvoiceCheck> {
  // Без ключа распознавания фото всё равно уже загружены — форма отправит
  // document_id, и страницы не придётся грузить ещё раз.
  if (!process.env.GEMINI_API_KEY)
    return { ok: false, error: "no_provider", documentId, duplicate };
  try {
    const { result } = await recognizeInvoiceCached({ db, organizationId, documentId, loadPhoto });
    const { verdict, suggestions } = await documentVerdict(db, organizationId, kind, result);
    return { ok: true, documentId, result, duplicate, verdict, suggestions };
  } catch (error) {
    console.error("checkInvoice: recognition failed", error);
    return { ok: false, error: "recognition_failed", documentId, duplicate };
  }
}

/**
 * Проверка фото прихода/продажи до подтверждения — без перезагрузки страницы:
 * вызывается прямо с клиента (см. operation-form.tsx), возвращает результат,
 * а не редиректит. Фото уже загружается в Storage здесь же, чтобы при
 * итоговом подтверждении не грузить его повторно.
 */
export async function recognizeInvoicePhoto(
  kind: "purchase" | "sale",
  form: FormData,
): Promise<InvoiceCheck> {
  if (kind !== "purchase" && kind !== "sale") return { ok: false, error: "no_photo" };
  const photos = photosOf(form);
  if (photos.length === 0) return { ok: false, error: "no_photo" };
  if (photos.length > MAX_PAGES) return { ok: false, error: "upload_failed" };

  const { db, organizationId } = await getContext();
  let documentId: string;
  try {
    documentId = await uploadOperationPhotos(db, organizationId, kind, photos);
  } catch (error) {
    const used = error instanceof Error && error.message === "document_in_use";
    return { ok: false, error: used ? "photo_used" : "upload_failed" };
  }
  const duplicate = await isDuplicatePhoto(db, organizationId, documentId);
  return checkInvoice(db, organizationId, kind, documentId, duplicate, async () =>
    Promise.all(
      photos.map(async (photo) => ({
        photo: Buffer.from(await photo.arrayBuffer()),
        mimeType: documentMimeType(photo),
      })),
    ),
  );
}

/**
 * Та же проверка для документа, уже загруженного раньше — форма открыта
 * кнопкой «Записать как приход/продажу» (switchDocumentKind). Распознавание
 * обычно берётся из кеша, Gemini второй раз не вызывается.
 */
export async function checkExistingDocument(
  kind: "purchase" | "sale",
  documentId: string,
): Promise<InvoiceCheck> {
  if ((kind !== "purchase" && kind !== "sale") || !uuidPattern.test(documentId))
    return { ok: false, error: "invalid" };
  const { db, organizationId } = await getContext();
  const duplicate = await isDuplicatePhoto(db, organizationId, documentId);
  return checkInvoice(
    db,
    organizationId,
    kind,
    documentId,
    duplicate,
    storagePhotoSource(db, organizationId, documentId),
  );
}

/**
 * Документ не того вида, что выбран в форме (накладная поставщика в продаже,
 * чек в приходе): тот же документ переводится в нужный вид — create_document
 * переиспользует свободный документ с тем же фото — и открывается нужная
 * форма. Фото заново не загружается.
 */
export async function switchDocumentKind(documentId: string, kind: string, party?: string) {
  if (!uuidPattern.test(documentId) || !["purchase", "sale", "payment"].includes(kind))
    redirect("/money?error=invalid");
  const { db, organizationId } = await getContext();
  const doc = await db
    .from("documents")
    .select("storage_path,file_hash,mime_type")
    .eq("organization_id", organizationId)
    .eq("id", documentId)
    .maybeSingle();
  if (doc.error || !doc.data) redirect(`/money/new?type=${kind}&error=photo_upload`);
  const switched = await db.rpc("create_document", {
    p_org: organizationId,
    p_kind: kind,
    p_storage_path: doc.data.storage_path,
    p_file_hash: doc.data.file_hash,
    p_mime_type: doc.data.mime_type,
  });
  if (switched.error || !switched.data)
    redirect(
      `/money/new?type=${kind}&error=${switched.error?.message.includes("document_in_use") ? "photo_used" : "photo_upload"}`,
    );
  const newId = String(switched.data);
  if (kind === "payment") {
    // Чек: сумму, дату и клиента подставим, как при «Распознать квитанцию».
    const params = await receiptParams(db, organizationId, newId, storagePhotoSource(db, organizationId, newId));
    redirect(`/money/new?${params.toString()}`);
  }
  const params = new URLSearchParams({ type: kind, documentId: newId });
  if (party && uuidPattern.test(party)) params.set("party", party);
  redirect(`/money/new?${params.toString()}`);
}

export type SimilarRecord = {
  kind: "purchase" | "sale";
  id: string;
  occurredAt: string;
  total: string;
  party: string;
  documentId: string | null;
  reason: "content" | "party_amount";
};

/**
 * Похожие действующие записи — только для предупреждения, не блокирует.
 * Вызывается из формы, когда известно фото (та же накладная) или выбраны
 * контрагент и сумма (то же за 30 дней). Поиск по индексам в базе, без
 * перебора записей.
 */
export async function findSimilarRecords(
  kind: "purchase" | "sale",
  documentId: string | null,
  partyId: string | null,
  rawAmount: string | null,
): Promise<SimilarRecord[]> {
  if (kind !== "purchase" && kind !== "sale") return [];
  const document = documentId && uuidPattern.test(documentId) ? documentId : null;
  const party = partyId && uuidPattern.test(partyId) ? partyId : null;
  let amount: string | null = null;
  if (rawAmount) {
    try {
      amount = decimalInput(rawAmount, 2);
    } catch {
      amount = null;
    }
  }
  if (!document && !(party && amount)) return [];
  const { db, organizationId } = await getContext();
  const { data, error } = await db.rpc("find_similar_records", {
    p_org: organizationId,
    p_kind: kind,
    p_document: document,
    p_party: party,
    p_amount: amount,
  });
  if (error) {
    console.error("findSimilarRecords: RPC failed", error);
    return [];
  }
  return (
    (data ?? []) as {
      r_kind: "purchase" | "sale";
      r_id: string;
      r_occurred_at: string;
      r_total: string;
      r_party: string;
      r_document: string | null;
      r_reason: "content" | "party_amount";
    }[]
  ).map((row) => ({
    kind: row.r_kind,
    id: row.r_id,
    occurredAt: row.r_occurred_at,
    total: String(row.r_total),
    party: row.r_party,
    documentId: row.r_document,
    reason: row.r_reason,
  }));
}

/** Что взяли с чека для формы оплаты. */
export type ReceiptFields = {
  amount?: string;
  currency?: Currency;
  bankRef?: string;
  /** Дата и время перевода по Бишкеку, "ГГГГ-ММ-ДДTчч:мм". */
  date?: string;
  /** Похожие клиенты — по отправителю, поставщики — по получателю. */
  customerIds: string[];
  supplierIds: string[];
};

/** Распознать чек (кеш — один платный вызов на фото) и найти похожих контрагентов. */
async function receiptFields(
  db: SupabaseClient,
  organizationId: string,
  documentId: string,
  loadPhoto: () => Promise<PhotoPage[]>,
): Promise<ReceiptFields> {
  const fields: ReceiptFields = { customerIds: [], supplierIds: [] };
  if (!process.env.GEMINI_API_KEY) return fields;
  // Результат кешируется: фоновая оцифровка после подтверждения оплаты
  // возьмёт его отсюда, а не вызовет Gemini второй раз.
  const { result } = await recognizeReceiptCached({ db, organizationId, documentId, loadPhoto });
  if (result.amount) fields.amount = String(result.amount);
  if (result.currency && isCurrency(result.currency)) fields.currency = result.currency;
  if (result.operation_id) fields.bankRef = String(result.operation_id).slice(0, 200);
  const paidAt = receiptDateTime(result.datetime);
  if (paidAt) fields.date = paidAt;
  const lookup = async (table: "customers" | "suppliers", name: string | null) => {
    if (!name) return [];
    const rows = await db
      .from(table)
      .select("id,name,aliases")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .is("merged_into_id", null)
      .range(0, 999);
    return bestMatches(name, (rows.data ?? []) as { id: string; name: string; aliases?: string[] }[]).map(
      (m) => m.candidate.id,
    );
  };
  [fields.customerIds, fields.supplierIds] = await Promise.all([
    lookup("customers", result.sender_name),
    lookup("suppliers", result.receiver_name),
  ]);
  return fields;
}

/** Параметры формы оплаты по чеку — для перехода из другой формы (switchDocumentKind). */
async function receiptParams(
  db: SupabaseClient,
  organizationId: string,
  documentId: string,
  loadPhoto: () => Promise<PhotoPage[]>,
) {
  const params = new URLSearchParams({ type: "payment", documentId });
  try {
    const f = await receiptFields(db, organizationId, documentId, loadPhoto);
    if (f.amount) params.set("amount", f.amount);
    if (f.currency) params.set("currency", f.currency);
    if (f.bankRef) params.set("bankRef", f.bankRef);
    if (f.date) params.set("date", f.date);
    if (f.customerIds.length) params.set("suggest", f.customerIds.join(","));
  } catch (error) {
    console.error("receiptParams: recognition failed", error);
    // Распознавание не удалось — продавец заполнит форму вручную, фото уже приложено.
  }
  return params;
}

export type ReceiptCheck =
  | ({ ok: true; documentId: string; duplicate: boolean } & ReceiptFields)
  | { ok: false; error: string; documentId?: string; duplicate?: boolean };

/**
 * Чек оплаты выбран в форме — загружаем и сразу распознаём, без
 * перезагрузки: форма подставит сумму, номер перевода, дату и клиента.
 */
export async function recognizeReceiptPhoto(form: FormData): Promise<ReceiptCheck> {
  const photo = photosOf(form)[0];
  if (!photo) return { ok: false, error: "no_photo" };
  const { db, organizationId } = await getContext();
  let documentId: string;
  try {
    documentId = await uploadOperationPhoto(db, organizationId, "payment", photo);
  } catch (error) {
    const used = error instanceof Error && error.message === "document_in_use";
    return { ok: false, error: used ? "photo_used" : "upload_failed" };
  }
  const duplicate = await isDuplicatePhoto(db, organizationId, documentId);
  if (!process.env.GEMINI_API_KEY) return { ok: false, error: "no_provider", documentId, duplicate };
  try {
    const fields = await receiptFields(db, organizationId, documentId, async () => [
      { photo: Buffer.from(await photo.arrayBuffer()), mimeType: documentMimeType(photo) },
    ]);
    return { ok: true, documentId, duplicate, ...fields };
  } catch (error) {
    console.error("recognizeReceiptPhoto: recognition failed", error);
    return { ok: false, error: "recognition_failed", documentId, duplicate };
  }
}

export async function reverseOperation(form: FormData) {
  const kind = String(form.get("kind"));
  const id = String(form.get("id") ?? "");
  const comment = String(form.get("comment") ?? "").trim();
  // Отмена из карточки клиента/поставщика возвращает туда же.
  const back = safeBackPath(String(form.get("back") ?? ""));
  if (!["sale", "purchase", "payment"].includes(kind) || !uuidPattern.test(id))
    redirect("/money?error=invalid");
  const { db, organizationId } = await getContext();
  const rpcName =
    kind === "sale"
      ? "reverse_sale"
      : kind === "purchase"
        ? "reverse_purchase"
        : "reverse_payment";
  const paramName =
    kind === "sale" ? "p_sale" : kind === "purchase" ? "p_purchase" : "p_payment";
  const result = await db.rpc(rpcName, {
    p_org: organizationId,
    [paramName]: id,
    p_comment: comment,
  });
  if (result.error) redirect(back ? `${back}?error=reversal` : "/money?error=reversal");
  revalidatePath("/", "layout");
  redirect(back ? `${back}?reversed=${kind}` : "/money?created=reversed");
}

/** Скидка или возврат товара — уменьшает долг, только с комментарием. */
export async function commitAdjustment(form: FormData) {
  const [side, party] = String(form.get("party") ?? "").split(":");
  const kind = String(form.get("kind") ?? "");
  const note = String(form.get("note") ?? "").trim();
  const idempotencyKey = String(form.get("idempotency_key") ?? "");
  const back = `/money/adjustment?party=${uuidPattern.test(party ?? "") ? party : ""}`;
  if (
    (side !== "customers" && side !== "suppliers") ||
    !uuidPattern.test(party ?? "") ||
    !isAdjustmentKind(kind) ||
    !uuidPattern.test(idempotencyKey)
  )
    redirect(`${back}&error=invalid`);
  if (!note || note.length > 500) redirect(`${back}&error=note`);
  let amount: string;
  try {
    amount = decimalInput(form.get("amount"), 2);
  } catch {
    redirect(`${back}&error=invalid`);
  }
  if (Number(amount) <= 0) redirect(`${back}&error=invalid`);
  const { db, organizationId } = await getContext();
  const result = await db.rpc("commit_adjustment", {
    p_org: organizationId,
    p_direction: side === "customers" ? "incoming" : "outgoing",
    p_party: party,
    p_kind: kind,
    p_amount: amount,
    p_note: note,
    p_idempotency_key: idempotencyKey,
  });
  if (result.error) {
    const message = result.error.message;
    redirect(
      `${back}&error=${message.includes("idempotency_conflict") ? "retry" : message.includes("invalid_note") ? "note" : "invalid"}`,
    );
  }
  revalidatePath("/", "layout");
  redirect(`/${side}/${party}?adjusted=${kind}`);
}

/**
 * Клиент из контактов телефона для формы продажи (ТЗ §4 Б: «из списка,
 * контактов телефона или новый в одно касание»). Есть клиент с тем же
 * номером — возвращаем его; нет — создаём. Без перезагрузки формы.
 */
export async function customerFromContact(
  rawName: string,
  rawPhone: string,
): Promise<{ id: string; name: string; balance: string; created: boolean } | { error: string }> {
  const name = String(rawName ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  const phone = normalizePhone(String(rawPhone ?? "")).slice(0, 40);
  const key = phoneKey(phone);
  if (!name && !key) return { error: "empty" };
  const { db, organizationId } = await getContext();
  if (key) {
    const existing = await db
      .from("customer_balances")
      .select("id,name,phone,balance")
      .eq("organization_id", organizationId)
      .neq("phone", "")
      .is("merged_into_id", null)
      .range(0, 999); // номер хранится как ввели («0555 12-34-56») — сравниваем нормализованно
    const match = (existing.data ?? []).find((c) => phoneKey(c.phone) === key);
    if (match) return { id: match.id, name: match.name, balance: String(match.balance), created: false };
  }
  if (!name) return { error: "name" };
  const inserted = await db
    .from("customers")
    .insert({ organization_id: organizationId, name, phone })
    .select("id,name")
    .single();
  if (inserted.error || !inserted.data) return { error: "save" };
  revalidatePath("/customers");
  return { id: inserted.data.id, name: inserted.data.name, balance: "0.00", created: true };
}

/** «Отменить — ошиблись» на экране результата: автор, первые 2 минуты. */
export async function undoRecent(form: FormData) {
  const kind = String(form.get("kind") ?? "");
  const id = String(form.get("id") ?? "");
  if (!["sale", "purchase", "payment", "expense"].includes(kind) || !uuidPattern.test(id)) redirect("/money?error=invalid");
  const { db, organizationId } = await getContext();
  const result = await db.rpc("undo_recent", { p_org: organizationId, p_kind: kind, p_id: id });
  if (result.error)
    redirect(
      kind === "sale"
        ? `/money/send/${id}?done=1&undo=expired`
        : kind === "expense"
          ? `/money/expense/${id}?undo=expired`
          : `/money/done/${kind}/${id}?undo=expired`,
    );
  revalidatePath("/", "layout");
  redirect(kind === "expense" ? "/money/expense?undone=1" : `/money/new?type=${kind}&undone=1`);
}

/** Итог записи расхода, если не прошла (успех — редирект на экран результата). */
export type ExpenseState = { error?: string; documentId?: string; attempt?: number };

/** Распознанный чек расхода — для подстановки в форму до записи. */
export type ExpenseCheck =
  | { ok: true; documentId: string; result: ExpenseResult; duplicate: boolean; date: string | null }
  | { ok: false; error: string; documentId?: string; duplicate?: boolean };

/**
 * Фото чека расхода выбрано — загружаем как документ и сразу распознаём:
 * форма подставит сумму, дату, категорию и комментарий. Без перезагрузки;
 * запись расхода потом берёт этот document_id.
 */
export async function recognizeExpensePhoto(form: FormData): Promise<ExpenseCheck> {
  const photos = photosOf(form);
  if (photos.length === 0) return { ok: false, error: "no_photo" };
  if (photos.length > MAX_PAGES) return { ok: false, error: "upload_failed" };
  const { db, organizationId } = await getContext();
  let documentId: string;
  try {
    documentId = await uploadOperationPhotos(db, organizationId, "expense", photos);
  } catch (error) {
    const used = error instanceof Error && error.message === "document_in_use";
    return { ok: false, error: used ? "photo_used" : "upload_failed" };
  }
  const duplicate = await isDuplicatePhoto(db, organizationId, documentId);
  if (!process.env.GEMINI_API_KEY) return { ok: false, error: "no_provider", documentId, duplicate };
  try {
    const { result } = await recognizeExpenseCached({
      db,
      organizationId,
      documentId,
      loadPhoto: async () =>
        Promise.all(
          photos.map(async (photo) => ({
            photo: Buffer.from(await photo.arrayBuffer()),
            mimeType: documentMimeType(photo),
          })),
        ),
    });
    // Дата чека → день расхода, если он не в будущем и не старше года.
    const paidAt = receiptDateTime(result.datetime);
    const date = paidAt ? expenseDateInput(paidAt.slice(0, 10), bishkekDate()) : null;
    return { ok: true, documentId, result, duplicate, date };
  } catch (error) {
    console.error("recognizeExpensePhoto: recognition failed", error);
    return { ok: false, error: "recognition_failed", documentId, duplicate };
  }
}

/**
 * Расход магазина: сумма, категория, комментарий, день (по умолчанию
 * сегодня), фото чека по желанию — оно становится документом и
 * распознаётся. Вносит любой участник. Ошибка возвращается в форму —
 * введённое не пропадает.
 */
export async function commitExpense(previous: ExpenseState, form: FormData): Promise<ExpenseState> {
  const attempt = (previous.attempt ?? 0) + 1;
  try {
    const idempotencyKey = String(form.get("idempotency_key") ?? "");
    const category = String(form.get("category") ?? "");
    const note = String(form.get("note") ?? "").trim();
    if (!uuidPattern.test(idempotencyKey) || !isExpenseCategory(category)) return { error: "invalid", attempt };
    let amount: string;
    try {
      amount = decimalInput(form.get("amount"), 2);
    } catch {
      return { error: "amount", attempt };
    }
    if (!(Number(amount) > 0)) return { error: "amount", attempt };
    if (note.length > 500 || (category === "other" && !note)) return { error: "note", attempt };
    const day = expenseDateInput(String(form.get("spent_on") ?? ""), bishkekDate());
    if (!day) return { error: "date", attempt };
    const files = photosOf(form);
    if (files.length > MAX_PAGES) return { error: "photo_upload", attempt };
    const existing = String(form.get("document_id") ?? "").trim();

    const { db, organizationId } = await getContext();
    let documentId: string | null = uuidPattern.test(existing) ? existing : null;
    if (!documentId && files.length) {
      try {
        documentId = await uploadOperationPhotos(db, organizationId, "expense", files);
      } catch (error) {
        const used = error instanceof Error && error.message === "document_in_use";
        return { error: used ? "photo_used" : "photo_upload", attempt };
      }
    }
    const result = await db.rpc("commit_expense", {
      p_org: organizationId,
      p_amount: amount,
      p_category: category,
      p_note: note || null,
      p_spent_on: day,
      p_document: documentId,
      p_idempotency_key: idempotencyKey,
    });
    if (result.error || !result.data) {
      console.error("commitExpense: RPC failed", { message: result.error?.message });
      const message = result.error?.message ?? "";
      const error = message.includes("invalid_note")
        ? "note"
        : message.includes("invalid_date")
          ? "date"
          : failureCode(message);
      // Фото уже загружены — повтор возьмёт этот документ, а не загрузит заново.
      return error === "photo_used" || !documentId ? { error, attempt } : { error, documentId, attempt };
    }
    if (documentId) {
      const docId = documentId;
      // Распознавание обычно уже в кеше (проверка при выборе фото) — здесь
      // только статус документа: «Оцифрована» или «Расхождение» с суммой.
      after(() =>
        recognizeDocument({ db, organizationId, documentId: docId, kind: "expense", declaredTotal: Number(amount) }),
      );
    }
    revalidatePath("/", "layout");
    redirect(`/money/expense/${result.data}?done=1`);
  } catch (error) {
    unstable_rethrow(error);
    console.error("commitExpense: unexpected failure", error);
    return { error: "save", attempt };
  }
}

/** Отмена расхода владельцем — с причиной, запись остаётся в истории. */
export async function reverseExpense(form: FormData) {
  const id = String(form.get("id") ?? "");
  const comment = String(form.get("comment") ?? "").trim();
  if (!uuidPattern.test(id)) redirect("/money/expenses?error=invalid");
  if (!comment) redirect(`/money/expense/${id}?error=comment`);
  const { db, organizationId } = await getContext();
  const result = await db.rpc("reverse_expense", { p_org: organizationId, p_expense: id, p_comment: comment });
  if (result.error) redirect(`/money/expense/${id}?error=reversal`);
  revalidatePath("/", "layout");
  redirect(`/money/expense/${id}?reversed=1`);
}
