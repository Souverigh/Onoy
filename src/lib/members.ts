import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type MemberLabel = { name: string; role: "owner" | "staff" };

/**
 * Имена участников магазина для журнала «кто внёс» и итога по продавцам.
 * Владелец видит всех (RLS), продавец — только себя. Старые записи без автора
 * (до сотрудников) — null.
 */
export async function memberLabels(db: SupabaseClient, organizationId: string): Promise<Map<string, MemberLabel>> {
  const { data } = await db
    .from("organization_members")
    .select("user_id,role,display_name,email")
    .eq("organization_id", organizationId);
  return new Map(
    (data ?? []).map((m) => [
      m.user_id as string,
      {
        role: m.role as "owner" | "staff",
        name: (m.display_name as string | null) || (m.role === "owner" ? "Владелец" : (m.email as string | null) || "Продавец"),
      },
    ]),
  );
}

/**
 * Оплаты по заявке клиента создаёт сам клиент по ссылке — автора нет. В отчётах
 * «кто собрал» они идут за того, кто подтвердил (журнал payment.claim_confirmed;
 * после «Вернуть» и нового подтверждения — последний). id оплаты → id участника.
 */
export async function claimConfirmers(
  db: SupabaseClient,
  organizationId: string,
  paymentIds: string[],
): Promise<Map<string, string>> {
  const confirmers = new Map<string, string>();
  for (let i = 0; i < paymentIds.length; i += 200) {
    const { data, error } = await db
      .from("audit_events")
      .select("entity_id,actor_id")
      .eq("organization_id", organizationId)
      .eq("action", "payment.claim_confirmed")
      .in("entity_id", paymentIds.slice(i, i + 200))
      .order("created_at", { ascending: true });
    if (error) throw new Error("Не удалось загрузить, кто подтвердил оплаты");
    for (const e of data ?? []) if (e.actor_id) confirmers.set(e.entity_id as string, e.actor_id as string);
  }
  return confirmers;
}
