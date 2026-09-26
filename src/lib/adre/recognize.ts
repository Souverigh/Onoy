import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Фоновая оцифровка уже проведённого документа — не меняет долг. Сам вызов
 * Gemini живёт в Supabase Edge Function `recognize-document` (ключ там же, в
 * секретах Supabase — Next.js его не видит); здесь только дёргаем функцию и
 * не даём ошибке всплыть в ответ пользователю (вызывается из `after()`).
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
  try {
    await db.functions.invoke("recognize-document", {
      body: { organizationId, documentId, kind, declaredTotal },
    });
  } catch {
    // Сеть/функция недоступны — документ останется «uploaded», кнопка
    // «Распознать сейчас» на /documents/[id] позволит повторить вручную.
  }
}
