"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { decimalInput } from "@/lib/validation";
import { uploadOperationPhoto } from "@/lib/storage";
import { recognizeDocument, finalizeInvoiceRecognition } from "@/lib/adre/recognize";
import { createGeminiProvider } from "@/lib/adre/gemini";
import { normalizeInvoiceResult } from "@/lib/adre/normalize";
import type { InvoiceResult } from "@/lib/adre/types";
import { bestMatches } from "@/lib/match";

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
  if (message.includes("invalid_") || message.includes("not_a_member"))
    return "invalid";
  if (message.includes("23505")) return "duplicate";
  return "save";
}

function photoOf(form: FormData) {
  const file = form.get("photo");
  return file instanceof File && file.size > 0 ? file : null;
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
  let paidImmediately = false;
  const photo = photoOf(form);
  const existingDocumentId = String(form.get("document_id") ?? "").trim();
  const hasExistingDocument = uuidPattern.test(existingDocumentId);
  if (operation !== "payment" && !photo && !hasExistingDocument)
    redirect(`/money/new?type=${operation}&error=photo`);
  try {
    idempotencyKey = field(form, "idempotency_key");
    if (!uuidPattern.test(idempotencyKey)) throw new Error("invalid_input");
    if (operation === "purchase") {
      party = field(form, "supplier_id");
      amount = decimalInput(field(form, "total"), 2);
      if (!uuidPattern.test(party)) throw new Error("invalid_input");
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
    )
      redirect(`/money/new?type=${operation}&error=invalid`);
    throw error;
  }

  const { db, organizationId } = await getContext();
  let documentId: string | null = hasExistingDocument ? existingDocumentId : null;
  if (photo && !hasExistingDocument) {
    try {
      documentId = await uploadOperationPhoto(db, organizationId, operation, photo);
    } catch {
      redirect(`/money/new?type=${operation}&error=photo`);
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
          });
  if (result.error || !result.data)
    redirect(
      `/money/new?type=${operation}&error=${failureCode(result.error?.message ?? "save")}`,
    );
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
  revalidatePath("/", "layout");
  redirect(`/money?created=${operation}`);
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
  | { ok: true; documentId: string; result: InvoiceResult }
  | { ok: false; error: string; documentId?: string }
> {
  const photo = form.get("photo");
  if (!(photo instanceof File) || photo.size === 0) return { ok: false, error: "no_photo" };
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: "no_provider" };

  const { db, organizationId } = await getContext();
  let documentId: string;
  try {
    documentId = await uploadOperationPhoto(db, organizationId, kind, photo);
  } catch {
    return { ok: false, error: "upload_failed" };
  }
  try {
    const buffer = Buffer.from(await photo.arrayBuffer());
    const provider = createGeminiProvider(key, process.env.GEMINI_MODEL || "gemini-3.8-flash");
    const { result } = await provider.recognizeInvoice(buffer, photo.type || "image/jpeg");
    return { ok: true, documentId, result: normalizeInvoiceResult(result) };
  } catch {
    return { ok: false, error: "recognition_failed", documentId };
  }
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
  } catch {
    redirect("/money/new?type=payment&error=photo");
  }

  const params = new URLSearchParams({ type: "payment", documentId });
  const key = process.env.GEMINI_API_KEY;
  if (key) {
    try {
      const buffer = Buffer.from(await photo.arrayBuffer());
      const provider = createGeminiProvider(key, process.env.GEMINI_MODEL || "gemini-3.8-flash");
      const { result } = await provider.recognizeReceipt(buffer, photo.type || "image/jpeg");
      if (result.amount) params.set("amount", String(result.amount));
      if (result.operation_id) params.set("bankRef", result.operation_id);
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
    } catch {
      // Распознавание не удалось — продавец заполнит форму вручную, фото уже приложено.
    }
  }
  redirect(`/money/new?${params.toString()}`);
}

export async function reverseOperation(form: FormData) {
  const kind = String(form.get("kind"));
  const id = String(form.get("id") ?? "");
  const comment = String(form.get("comment") ?? "").trim();
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
  if (result.error) redirect("/money?error=reversal");
  revalidatePath("/", "layout");
  redirect("/money?created=reversed");
}
