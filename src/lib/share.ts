import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone } from "./contacts";

/**
 * Ссылка клиента для сообщений. Не было ни одной — создаём (как кнопкой в
 * карточке). Магазин её отзывал — сами не создаём: null, сообщение без ссылки.
 */
export async function ensureShareToken(
  db: SupabaseClient,
  organizationId: string,
  customerId: string,
): Promise<{ token: string | null; revoked: boolean }> {
  const links = await db
    .from("share_links")
    .select("token,revoked_at")
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  const rows = links.data ?? [];
  const active = rows.find((l) => !l.revoked_at)?.token ?? null;
  if (active) return { token: active, revoked: false };
  if (rows.length) return { token: null, revoked: true };
  const created = await db.rpc("create_share_link", { p_org: organizationId, p_customer: customerId });
  return { token: typeof created.data === "string" ? created.data : null, revoked: false };
}

/** Номер для wa.me: только цифры с кодом страны (0555… → 996555…). */
export function waPhone(raw: string | null | undefined): string {
  return normalizePhone(String(raw ?? "")).replace(/\D/g, "");
}
