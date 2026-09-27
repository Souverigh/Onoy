"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { decimalInput } from "@/lib/validation";
import { safeBackPath } from "@/lib/back-path";
import { isDuplicatePhoto, uploadOperationPhoto, uploadOperationPhotos } from "@/lib/storage";
import { MAX_PAGES, documentMimeType } from "@/lib/pages";
import {
  recognizeDocument,
  finalizeInvoiceRecognition,
  recognizeInvoiceCached,
  recognizeReceiptCached,
} from "@/lib/adre/recognize";
import type { InvoiceResult } from "@/lib/adre/types";
import { bestMatches } from "@/lib/match";
import { bishkekDateTime, receiptDateTime } from "@/lib/receipt-date";
import { isAdjustmentKind } from "@/lib/entry-labels";
import { normalizePhone, phoneKey } from "@/lib/contacts";

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

export async function commitOperation(form: FormData) {
  const rawKind = form.get("kind");
  const kind = typeof rawKind === "string" ? rawKind : "";
  if (!["purchase", "sale", "payment"].includes(kind))
    redirect("/money?error=invalid");

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
  const hasExistingDocument = uuidPattern.test(existingDocumentId);
  if (operation !== "payment" && !photo && !hasExistingDocument)
    redirect(`/money/new?type=${operation}&error=photo`);
  // Чек оплаты — всегда одно фото; накладная — до MAX_PAGES страниц.
  if (photos.length > (operation === "payment" ? 1 : MAX_PAGES))
    redirect(`/money/new?type=${operation}&error=photo_upload`);
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
        else if (Number(paidNow) > Number(amount))
          redirect(`/money/new?type=purchase&party=${party}&error=part`);
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
        if (!occurredAt) throw new Error("invalid_input");
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
      redirect(`/money/new?type=${operation}&error=invalid`);
    }
    throw error;
  }

  const { db, organizationId } = await getContext();
  let documentId: string | null = hasExistingDocument ? existingDocumentId : null;
  if (photo && !hasExistingDocument) {
    try {
      documentId = await uploadOperationPhotos(db, organizationId, operation, photos);
    } catch (error) {
      const used = error instanceof Error && error.message === "document_in_use";
      redirect(`/money/new?type=${operation}&error=${used ? "photo_used" : "photo_upload"}`);
    }
  }
  const result =
    operation === "purchase"
      ? await db.rpc("commit_purchase", {
          p_org: organizationId,
          p_supplier: party,
          p_amount: amount,
          p_idempotency_key: idempotencyKey,
          p_document: documentId,
        })
      : operation === "sale"
        ? await db.rpc("commit_sale", {
            p_org: organizationId,
            p_customer: party,
            p_amount: amount,
            p_paid_immediately: paidImmediately,
            p_idempotency_key: idempotencyKey,
            p_document: documentId,
          })
        : await db.rpc("commit_payment", {
            p_org: organizationId,
            p_direction: direction,
            p_party: party,
            p_amount: amount,
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
    redirect(
      `/money/new?type=${operation}&error=${failureCode(result.error?.message ?? "save")}`,
    );
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
  // После продажи — ссылка «Отправить клиенту» (накладная и долг в WhatsApp).
  const sent = operation === "sale" ? `&sale=${result.data}` : "";
  redirect(`/money?created=${operation}${sent}${part}${duplicate ? "&duplicate=1" : ""}`);
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
): Promise<
  | { ok: true; documentId: string; result: InvoiceResult; duplicate: boolean }
  | { ok: false; error: string; documentId?: string; duplicate?: boolean }
> {
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
  // Без ключа распознавания фото всё равно уже загружены — форма отправит
  // document_id, и страницы не придётся грузить ещё раз.
  if (!process.env.GEMINI_API_KEY)
    return { ok: false, error: "no_provider", documentId, duplicate };
  try {
    const { result } = await recognizeInvoiceCached({
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
    return { ok: true, documentId, result, duplicate };
  } catch (error) {
    console.error("recognizeInvoicePhoto: recognition failed", error);
    return { ok: false, error: "recognition_failed", documentId, duplicate };
  }
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

/**
 * ТЗ §4, сценарий В.2: квитанция → распознаём сразу (не в фоне, это часть
 * диалога) → предлагаем клиента по имени отправителя, прежде чем продавец
 * подтвердит оплату. Сам платёж ещё не проводится — только подготавливает
 * форму `/money/new?type=payment`.
 */
export async function prepareReceiptPayment(form: FormData) {
  const photo = form.get("photo");
  if (!(photo instanceof File) || photo.size === 0)
    redirect("/money/new?type=payment&error=photo");

  const { db, organizationId } = await getContext();
  let documentId: string;
  try {
    documentId = await uploadOperationPhoto(db, organizationId, "payment", photo);
  } catch (error) {
    const used = error instanceof Error && error.message === "document_in_use";
    redirect(`/money/new?type=payment&error=${used ? "photo_used" : "photo_upload"}`);
  }

  const params = new URLSearchParams({ type: "payment", documentId });
  const key = process.env.GEMINI_API_KEY;
  if (key) {
    try {
      // Результат кешируется: фоновая оцифровка после подтверждения оплаты
      // возьмёт его отсюда, а не вызовет Gemini второй раз.
      const { result } = await recognizeReceiptCached({
        db,
        organizationId,
        documentId,
        loadPhoto: async () => [
          { photo: Buffer.from(await photo.arrayBuffer()), mimeType: documentMimeType(photo) },
        ],
      });
      if (result.amount) params.set("amount", String(result.amount));
      if (result.operation_id) params.set("bankRef", result.operation_id);
      const paidAt = receiptDateTime(result.datetime);
      if (paidAt) params.set("date", paidAt);
      if (result.sender_name) {
        const customers = await db
          .from("customers")
          .select("id,name,aliases")
          .eq("organization_id", organizationId);
        const suggestions = bestMatches(
          result.sender_name,
          (customers.data ?? []) as { id: string; name: string; aliases?: string[] }[],
        );
        if (suggestions.length)
          params.set("suggest", suggestions.map((s) => s.candidate.id).join(","));
      }
    } catch (error) {
      console.error("prepareReceiptPayment: recognition failed", error);
      // Распознавание не удалось — продавец заполнит форму вручную, фото уже приложено.
    }
  }
  redirect(`/money/new?${params.toString()}`);
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
