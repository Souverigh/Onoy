import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createGeminiProvider } from "./gemini";
import type { RecognitionProvider, InvoiceResult, ReceiptResult, PhotoPage } from "./types";
import { documentPages } from "@/lib/storage";
import { normalizeInvoiceResult } from "./normalize";
import { contentFingerprint } from "./fingerprint";

const PROMPT_VERSION = "v1";
const TOLERANCE = 1; // сом, как в ТЗ §6

const MODEL = () => process.env.GEMINI_MODEL || "gemini-3.8-flash";

function getProvider(): RecognitionProvider | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  return createGeminiProvider(key, MODEL());
}

function invoiceMatches(result: InvoiceResult, declaredTotal: number | null): boolean {
  const linesOk = result.lines.every(
    (line) => Math.abs(Number(line.qty) * Number(line.price) - Number(line.sum)) <= TOLERANCE,
  );
  if (!linesOk) return false;
  if (declaredTotal == null) return true;
  return Math.abs(result.total_computed - declaredTotal) <= TOLERANCE;
}

function linesOf(result: InvoiceResult) {
  return result.lines.map((line) => ({
    n: line.n,
    name_raw: line.name_raw,
    qty: line.qty,
    unit: line.unit,
    price: line.price,
    confidence: line.confidence,
  }));
}

/** Страницы документа по порядку; у чека и обычной накладной — одна. */
type PhotoSource = () => Promise<PhotoPage[]>;
type ExtractionKind = "invoice" | "receipt";

async function cachedExtraction<T>(
  db: SupabaseClient,
  organizationId: string,
  documentId: string,
  kind: ExtractionKind,
): Promise<T | null> {
  // Ищем по самому фото, а не по документу: когда повторы фото разрешены,
  // у одной накладной может быть несколько документов — распознаём один раз.
  const self = await db
    .from("documents")
    .select("file_hash")
    .eq("organization_id", organizationId)
    .eq("id", documentId)
    .maybeSingle();
  if (self.error || !self.data) return null;
  const siblings = await db
    .from("documents")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("file_hash", self.data.file_hash)
    .limit(50);
  if (siblings.error || !siblings.data?.length) return null;
  const { data, error } = await db
    .from("document_extractions")
    .select("payload")
    .eq("organization_id", organizationId)
    .in(
      "document_id",
      siblings.data.map((d: { id: string }) => d.id),
    )
    .eq("prompt_version", PROMPT_VERSION)
    .eq("payload->>kind", kind)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("cachedExtraction: lookup failed", error);
    return null;
  }
  return ((data?.payload as { extracted?: T } | undefined)?.extracted ?? null) as T | null;
}

/**
 * Один вызов Gemini на одно фото: одинаковое фото create_document сводит к
 * одному документу, а готовый ответ лежит в document_extractions. Повторный
 * выбор того же фото, фоновая оцифровка после подтверждения и квитанция,
 * распознанная до оплаты, берут результат отсюда.
 */
async function recognizeWithCache<T>({
  db,
  organizationId,
  documentId,
  kind,
  loadPhoto,
  normalize,
}: {
  db: SupabaseClient;
  organizationId: string;
  documentId: string;
  kind: ExtractionKind;
  loadPhoto: PhotoSource;
  normalize: (result: T) => T;
}): Promise<{ result: T; cached: boolean }> {
  const cached = await cachedExtraction<T>(db, organizationId, documentId, kind);
  if (cached) return { result: normalize(cached), cached: true };

  const provider = getProvider();
  if (!provider) throw new Error("no_provider_configured");
  const pages = await loadPhoto();
  if (pages.length === 0) throw new Error("document_not_found");
  const startedAt = Date.now();
  const call =
    kind === "invoice"
      ? await provider.recognizeInvoice(pages)
      : await provider.recognizeReceipt(pages[0].photo, pages[0].mimeType);
  const latencyMs = Date.now() - startedAt;
  const result = normalize(call.result as T);
  const save = await db.rpc("cache_extraction", {
    p_org: organizationId,
    p_document: documentId,
    p_provider: provider.name,
    p_model: provider.model,
    p_prompt_version: PROMPT_VERSION,
    p_raw_json: { kind, extracted: result, response: call.raw },
    p_latency_ms: latencyMs,
    p_cost: call.costUsd,
  });
  // Не удалось закешировать — результат всё равно отдаём, в худшем случае
  // следующий раз заплатим за повторный вызов.
  if (save.error) console.error("recognizeWithCache: cache_extraction failed", save.error);
  return { result, cached: false };
}

type CachedArgs = {
  db: SupabaseClient;
  organizationId: string;
  documentId: string;
  loadPhoto: PhotoSource;
};

export async function recognizeInvoiceCached(args: CachedArgs) {
  const recognized = await recognizeWithCache<InvoiceResult>({
    ...args,
    kind: "invoice",
    normalize: normalizeInvoiceResult,
  });
  await saveFingerprint(args.db, args.organizationId, args.documentId, recognized.result);
  return recognized;
}

/** Отпечаток содержимого — для поиска похожих записей (find_similar_records). */
async function saveFingerprint(
  db: SupabaseClient,
  organizationId: string,
  documentId: string,
  result: InvoiceResult,
) {
  const fingerprint = contentFingerprint(result);
  if (!fingerprint) return;
  const { error } = await db.rpc("set_document_fingerprint", {
    p_org: organizationId,
    p_document: documentId,
    p_fingerprint: fingerprint,
  });
  // Без отпечатка просто не будет предупреждения о похожей записи.
  if (error) console.error("saveFingerprint: set_document_fingerprint failed", error);
}

export function recognizeReceiptCached(args: CachedArgs) {
  return recognizeWithCache<ReceiptResult>({ ...args, kind: "receipt", normalize: (r) => r });
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

  const loadPhoto: PhotoSource = async () => {
    const pages = await documentPages(db, organizationId, documentId);
    if (pages.length === 0) throw new Error("document_not_found");
    return Promise.all(
      pages.map(async (page) => {
        const download = await db.storage.from("receipts").download(page.storage_path);
        if (download.error || !download.data) throw new Error("photo_download_failed");
        return {
          photo: Buffer.from(await download.data.arrayBuffer()),
          mimeType: page.mime_type || "image/jpeg",
        };
      }),
    );
  };

  try {
    // Стоимость и задержка уже записаны в строке кеша (cache_extraction) —
    // здесь их не дублируем, чтобы сумма cost по document_extractions
    // оставалась реальными расходами.
    const common = {
      p_org: organizationId,
      p_document: documentId,
      p_provider: "gemini",
      p_model: MODEL(),
      p_prompt_version: PROMPT_VERSION,
      p_latency_ms: null,
      p_cost: null,
    };
    if (kind === "payment") {
      const { result } = await recognizeReceiptCached({ db, organizationId, documentId, loadPhoto });
      const save = await db.rpc("save_recognition", {
        ...common,
        p_raw_json: { kind: "receipt", extracted: result, response: null },
        p_lines: [],
        p_status: result.confidence >= 0.8 ? "digitized" : "review",
      });
      if (save.error) throw new Error(save.error.message);
      return;
    }

    const { result } = await recognizeInvoiceCached({ db, organizationId, documentId, loadPhoto });
    const save = await db.rpc("save_recognition", {
      ...common,
      p_raw_json: { kind: "invoice", extracted: result, response: null },
      p_lines: linesOf(result),
      p_status: invoiceMatches(result, declaredTotal) ? "digitized" : "review",
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
  await saveFingerprint(db, organizationId, documentId, result);
  const status = invoiceMatches(result, declaredTotal) ? "digitized" : "review";
  const save = await db.rpc("save_recognition", {
    p_org: organizationId,
    p_document: documentId,
    p_provider: "gemini",
    p_model: MODEL(),
    p_prompt_version: PROMPT_VERSION,
    p_raw_json: { kind: "invoice", extracted: result, response: null },
    p_lines: linesOf(result),
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
