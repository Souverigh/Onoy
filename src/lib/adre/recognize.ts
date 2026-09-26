import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createGeminiProvider } from "./gemini";
import type { RecognitionProvider, InvoiceResult } from "./types";
import { normalizeInvoiceResult } from "./normalize";

const PROMPT_VERSION = "v1";
const TOLERANCE = 1; // сом, как в ТЗ §6

function getProvider(): RecognitionProvider | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  return createGeminiProvider(key, process.env.GEMINI_MODEL || "gemini-3.8-flash");
}

function invoiceMatches(result: InvoiceResult, declaredTotal: number | null): boolean {
  const linesOk = result.lines.every(
    (line) => Math.abs(Number(line.qty) * Number(line.price) - Number(line.sum)) <= TOLERANCE,
  );
  if (!linesOk) return false;
  if (declaredTotal == null) return true;
  return Math.abs(result.total_computed - declaredTotal) <= TOLERANCE;
}

/**
 * Фоновая оцифровка уже проведённого документа — не меняет долг. Вызывается
 * из `after()`, поэтому ошибки не должны всплывать в ответ пользователю; все
 * пути заканчиваются либо save_recognition, либо fail_recognition.
 *
 * GEMINI_API_KEY читается из окружения процесса Next.js (в проде — Vercel
 * Environment Variables, локально — .env.local, который не в git).
 */
export async function recognizeDocument({
  db,
  organizationId,
  documentId,
  kind,
  declaredTotal,
}: {
  db: SupabaseClient;
  organizationId: string;
  documentId: string;
  kind: "purchase" | "sale" | "payment";
  declaredTotal: number | null;
}): Promise<void> {
  const started = await db.rpc("start_recognition", {
    p_org: organizationId,
    p_document: documentId,
  });
  if (started.error) return; // уже обрабатывается или недоступен — не мешаем

  const provider = getProvider();
  if (!provider) {
    await db.rpc("fail_recognition", {
      p_org: organizationId,
      p_document: documentId,
      p_error: "no_provider_configured",
    });
    return;
  }

  try {
    const doc = await db
      .from("documents")
      .select("storage_path,mime_type")
      .eq("organization_id", organizationId)
      .eq("id", documentId)
      .single();
    if (doc.error || !doc.data) throw new Error("document_not_found");

    const download = await db.storage.from("receipts").download(doc.data.storage_path);
    if (download.error || !download.data) throw new Error("photo_download_failed");
    const photo = Buffer.from(await download.data.arrayBuffer());
    const mimeType = doc.data.mime_type || "image/jpeg";

    const startedAt = Date.now();
    if (kind === "payment") {
      const { result, costUsd, raw } = await provider.recognizeReceipt(photo, mimeType);
      const latencyMs = Date.now() - startedAt;
      const status = result.confidence >= 0.8 ? "digitized" : "review";
      const save = await db.rpc("save_recognition", {
        p_org: organizationId,
        p_document: documentId,
        p_provider: provider.name,
        p_model: provider.model,
        p_prompt_version: PROMPT_VERSION,
        p_raw_json: { extracted: result, response: raw },
        p_lines: [],
        p_status: status,
        p_latency_ms: latencyMs,
        p_cost: costUsd,
      });
      if (save.error) throw new Error(save.error.message);
      return;
    }

    const { result: rawResult, costUsd, raw } = await provider.recognizeInvoice(photo, mimeType);
    const result = normalizeInvoiceResult(rawResult);
    const latencyMs = Date.now() - startedAt;
    const status = invoiceMatches(result, declaredTotal) ? "digitized" : "review";
    const lines = result.lines.map((line) => ({
      n: line.n,
      name_raw: line.name_raw,
      qty: line.qty,
      unit: line.unit,
      price: line.price,
      confidence: line.confidence,
    }));
    const save = await db.rpc("save_recognition", {
      p_org: organizationId,
      p_document: documentId,
      p_provider: provider.name,
      p_model: provider.model,
      p_prompt_version: PROMPT_VERSION,
      p_raw_json: { extracted: result, response: raw },
      p_lines: lines,
      p_status: status,
      p_latency_ms: latencyMs,
      p_cost: costUsd,
    });
    if (save.error) throw new Error(save.error.message);
  } catch (error) {
    await db.rpc("fail_recognition", {
      p_org: organizationId,
      p_document: documentId,
      p_error: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

/**
 * Итог распознавания уже известен (продавец проверил фото до подтверждения
 * прихода/продажи, см. `recognizeInvoicePhoto` в money/actions.ts) — здесь
 * только записываем результат, повторный вызов Gemini не нужен.
 */
export async function finalizeInvoiceRecognition({
  db,
  organizationId,
  documentId,
  result: rawResult,
  declaredTotal,
}: {
  db: SupabaseClient;
  organizationId: string;
  documentId: string;
  result: InvoiceResult;
  declaredTotal: number | null;
}): Promise<void> {
  const started = await db.rpc("start_recognition", {
    p_org: organizationId,
    p_document: documentId,
  });
  if (started.error) return;

  // Результат мог побывать в браузере (JSON в скрытом поле формы) — нормализуем
  // ещё раз, это идемпотентно и дёшево, зато не полагается на чужой ввод.
  const result = normalizeInvoiceResult(rawResult);
  const status = invoiceMatches(result, declaredTotal) ? "digitized" : "review";
  const lines = result.lines.map((line) => ({
    n: line.n,
    name_raw: line.name_raw,
    qty: line.qty,
    unit: line.unit,
    price: line.price,
    confidence: line.confidence,
  }));
  const save = await db.rpc("save_recognition", {
    p_org: organizationId,
    p_document: documentId,
    p_provider: "gemini",
    p_model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
    p_prompt_version: PROMPT_VERSION,
    p_raw_json: { extracted: result, response: null },
    p_lines: lines,
    p_status: status,
    p_latency_ms: null,
    p_cost: null,
  });
  if (save.error) {
    await db.rpc("fail_recognition", {
      p_org: organizationId,
      p_document: documentId,
      p_error: save.error.message,
    });
  }
}
