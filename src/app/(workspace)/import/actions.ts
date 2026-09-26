"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { decimalInput } from "@/lib/validation";
import { recognizeNotebook } from "@/lib/adre/recognize";
import { MAX_PAGES, documentMimeType, isAcceptedDocument } from "@/lib/pages";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type NotebookRowDraft = { name: string; phone: string; amount: number; confidence: number };

/** Фото страниц тетради → список «имя — сумма» для проверки продавцом. Ничего не записывает. */
export async function recognizeNotebookPhotos(
  form: FormData,
): Promise<{ ok: true; rows: NotebookRowDraft[]; warnings: string[] } | { ok: false; error: string }> {
  const photos = form
    .getAll("photo")
    .filter((file): file is File => file instanceof File && file.size > 0);
  if (photos.length === 0) return { ok: false, error: "no_photo" };
  if (photos.length > MAX_PAGES) return { ok: false, error: "too_many" };
  if (photos.some((file) => !isAcceptedDocument(file)))
    return { ok: false, error: "recognition_failed" };
  if (!process.env.GEMINI_API_KEY) return { ok: false, error: "no_provider" };
  await getContext(); // только участник магазина
  try {
    const pages = await Promise.all(
      photos.map(async (photo) => ({
        photo: Buffer.from(await photo.arrayBuffer()),
        mimeType: documentMimeType(photo),
      })),
    );
    const result = await recognizeNotebook(pages);
    return { ok: true, ...result };
  } catch (error) {
    console.error("recognizeNotebookPhotos: recognition failed", error);
    return { ok: false, error: "recognition_failed" };
  }
}

export type OpeningInput = {
  key: string;
  partyId: string | null;
  name: string;
  phone: string;
  amount: string;
};
export type OpeningResult = { key: string; ok: boolean; partyId?: string; error?: string };

/** «-3 000,50» → "-3000.50": минус — аванс. */
function signedAmount(raw: string): string {
  const trimmed = raw.trim();
  const negative = /^[-−–]/.test(trimmed);
  const value = decimalInput(trimmed.replace(/^[-−–+]\s*/, ""), 2);
  return negative ? `-${value}` : value;
}

/**
 * Каждая строка — отдельная запись import_opening_balance: одна неудачная
 * строка не отменяет остальные, а повтор (тот же key) ничего не задвоит.
 */
export async function importOpenings(
  kind: "customers" | "suppliers",
  rows: OpeningInput[],
): Promise<OpeningResult[]> {
  if (kind !== "customers" && kind !== "suppliers") return [];
  const { db, organizationId } = await getContext();
  const results: OpeningResult[] = [];
  for (const row of rows.slice(0, 300)) {
    if (!uuidPattern.test(row.key)) {
      results.push({ key: String(row.key), ok: false, error: "invalid" });
      continue;
    }
    let amount: string;
    try {
      amount = signedAmount(String(row.amount ?? ""));
    } catch {
      results.push({ key: row.key, ok: false, error: "amount" });
      continue;
    }
    const partyId = row.partyId && uuidPattern.test(row.partyId) ? row.partyId : null;
    const { data, error } = await db.rpc("import_opening_balance", {
      p_org: organizationId,
      p_kind: kind === "customers" ? "customer" : "supplier",
      p_party: partyId,
      p_name: partyId ? null : String(row.name ?? "").trim(),
      p_phone: String(row.phone ?? ""),
      p_amount: amount,
      p_idempotency_key: row.key,
    });
    if (error || !data) {
      const message = error?.message ?? "";
      results.push({
        key: row.key,
        ok: false,
        error: message.includes("opening_exists")
          ? "exists"
          : message.includes("invalid_opening")
            ? "amount"
            : "save",
      });
      if (!message.includes("opening_exists") && !message.includes("invalid_opening"))
        console.error("importOpenings: import_opening_balance failed", message);
      continue;
    }
    results.push({ key: row.key, ok: true, partyId: data as string });
  }
  revalidatePath("/", "layout");
  return results;
}
