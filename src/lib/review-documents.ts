import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Сколько накладных ждут проверки: сумма не сошлась или фото не прочиталось,
 * а по нему есть действующая запись. Фото без записи (или с отменённой) в
 * «Документах» — «Без записи» / «Отменена», проверять в них нечего; раньше их
 * считали, и плашка обещала расхождения, которых на экране нет.
 */
export async function reviewDocumentsCount(db: SupabaseClient, organizationId: string): Promise<{ count: number }> {
  const docs = await db
    .from("documents")
    .select("id")
    .eq("organization_id", organizationId)
    .in("status", ["review", "failed"])
    .limit(500);
  const ids = (docs.data ?? []).map((d) => d.id as string);
  if (!ids.length) return { count: 0 };
  const linked = (table: string) =>
    db.from(table).select("document_id").eq("organization_id", organizationId).in("document_id", ids).is("reversed_at", null);
  const results = await Promise.all(["purchases", "sales", "payments", "expenses"].map(linked));
  const withRecord = new Set<string>();
  for (const r of results) for (const row of r.data ?? []) if (row.document_id) withRecord.add(row.document_id as string);
  return { count: withRecord.size };
}
