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
