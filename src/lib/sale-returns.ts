import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Есть ли у продажи действующий (не отменённый) возврат товара. Такую продажу
 * нельзя «Исправить»: запись заново полным количеством плюс старый возврат
 * исказили бы долг клиента — сначала отменяют возврат.
 */
export async function hasActiveReturn(db: SupabaseClient, organizationId: string, saleId: string): Promise<boolean> {
  const returns = await db
    .from("return_items")
    .select("payment_id")
    .eq("organization_id", organizationId)
    .eq("sale_id", saleId);
  const ids = [...new Set((returns.data ?? []).map((r) => r.payment_id as string))];
  if (returns.error) return true;
  if (!ids.length) return false;
  const active = await db
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .in("id", ids)
    .is("reversed_at", null);
  return active.error ? true : (active.count ?? 0) > 0;
}
