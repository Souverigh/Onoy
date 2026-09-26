// ADRE: фоновое распознавание фото (Gemini). Ключ живёт только здесь — в
// секретах Supabase (`supabase secrets set GEMINI_API_KEY=...`), Next.js его
// никогда не видит. Next.js вызывает эту функцию через
// `supabase.functions.invoke("recognize-document", {...})` внутри `after()`,
// не блокируя ответ пользователю.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createGeminiProvider } from "../_shared/gemini.ts";
import type { InvoiceResult } from "../_shared/types.ts";

const PROMPT_VERSION = "v1";
const TOLERANCE = 1; // сом, как в ТЗ §6

function invoiceMatches(result: InvoiceResult, declaredTotal: number | null): boolean {
  const linesOk = result.lines.every(
    (line) => Math.abs(Number(line.qty) * Number(line.price) - Number(line.sum)) <= TOLERANCE,
  );
  if (!linesOk) return false;
  if (declaredTotal == null) return true;
  return Math.abs(result.total_computed - declaredTotal) <= TOLERANCE;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  let body: {
    organizationId?: string;
    documentId?: string;
    kind?: "purchase" | "sale" | "payment";
    declaredTotal?: number | null;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const { organizationId, documentId, kind, declaredTotal } = body;
  if (!organizationId || !documentId || !kind) return json({ error: "invalid_input" }, 400);

  // Клиент со session-токеном вызывающего — auth.uid() внутри Postgres RPC
  // видит того же пользователя, RLS/членство проверяются как обычно.
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });

  const started = await db.rpc("start_recognition", { p_org: organizationId, p_document: documentId });
  if (started.error) return json({ ok: false, reason: "already_running" });

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    await db.rpc("fail_recognition", {
      p_org: organizationId,
      p_document: documentId,
      p_error: "no_provider_configured",
    });
    return json({ ok: false, reason: "no_provider_configured" });
  }
  const provider = createGeminiProvider(apiKey, Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash");

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
    const photo = new Uint8Array(await download.data.arrayBuffer());
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
      return json({ ok: true, status });
    }

    const { result, costUsd, raw } = await provider.recognizeInvoice(photo, mimeType);
    const latencyMs = Date.now() - startedAt;
    const status = invoiceMatches(result, declaredTotal ?? null) ? "digitized" : "review";
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
    return json({ ok: true, status });
  } catch (error) {
    await db.rpc("fail_recognition", {
      p_org: organizationId,
      p_document: documentId,
      p_error: error instanceof Error ? error.message : "unknown_error",
    });
    return json({ ok: false, reason: "recognition_failed" });
  }
});
