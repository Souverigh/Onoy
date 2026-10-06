import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Оплата «Сразу оплатили» при приходе — отдельная запись оплаты поставщику,
 * которую форма вносит сразу за приходом тем же продавцом (money/actions.ts).
 * Ссылки на приход в базе нет: ищем оплату того же автора тому же поставщику
 * в первые полминуты после прихода (задача 6).
 */
export async function partPaymentOf(
  db: SupabaseClient,
  organizationId: string,
  purchase: { supplier_id: string; created_at: string; created_by: string | null },
): Promise<{ id: string; amount: string; created_at: string } | null> {
  if (!purchase.created_by) return null;
  const from = new Date(purchase.created_at);
  const to = new Date(from.getTime() + 30_000);
  const { data } = await db
    .from("payments")
    .select("id,amount,created_at")
    .eq("organization_id", organizationId)
    .eq("supplier_id", purchase.supplier_id)
    .eq("direction", "outgoing")
    .eq("kind", "payment")
    .eq("status", "confirmed")
    .eq("created_by", purchase.created_by)
    .is("reversed_at", null)
    .is("document_id", null)
    .gte("created_at", from.toISOString())
    .lte("created_at", to.toISOString())
    .order("created_at")
    .limit(1);
  const row = data?.[0];
  return row ? { id: row.id as string, amount: String(row.amount), created_at: row.created_at as string } : null;
}
