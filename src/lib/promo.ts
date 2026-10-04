import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Рекламный QR на накладной: /r/<код магазина> считает переход (только для
// админки) и ведёт на сайт. Миграция не применена — QR без счётчика.

export async function shopPromoUrl(db: SupabaseClient, origin: string, organizationId: string) {
  const { data, error } = await db.rpc("promo_ref", { p_org: organizationId });
  return !error && typeof data === "string" ? `${origin}/r/${data}` : null;
}

export async function promoUrlByToken(db: SupabaseClient, origin: string, token: string) {
  const { data, error } = await db.rpc("promo_ref_by_token", { p_token: token });
  return !error && typeof data === "string" ? `${origin}/r/${data}` : null;
}
