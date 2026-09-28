import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient, configured } from "./supabase/server";
import { isCurrency, type Currency } from "./currency";
export const getUserContext = cache(async () => {
  if (!configured()) redirect("/login");
  const db = await createClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) redirect("/login");
  return { db, user: data.user };
});
export const getContext = cache(async () => {
  const { db, user } = await getUserContext();
  const { data, error } = await db
    .from("organization_members")
    .select("organization_id,role,organizations(name,plan,paid_until,blocked_at,blocked_reason,currency)")
    .eq("user_id", user.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error)
    throw new Error(
      "Не удалось открыть организацию. Проверьте подключение базы.",
    );
  if (!data) redirect("/onboarding");
  const org = data.organizations as unknown as {
    name: string;
    plan: "basic" | "business";
    paid_until: string | null;
    blocked_at: string | null;
    blocked_reason: string | null;
    currency: string | null;
  };
  return {
    db,
    user,
    organizationId: data.organization_id as string,
    organizationName: org.name,
    /** Владелец видит итоги, отменяет, делает скидки, подтверждает заявки, закрывает день. */
    isOwner: data.role === "owner",
    /** Тариф и оплату отмечает админ Depter; «Бизнес» открывает сотрудников. */
    plan: org.plan,
    paidUntil: org.paid_until,
    /** Заблокирован админом: читать можно, вносить — нет (триггер в базе). */
    blocked: org.blocked_at ? { reason: org.blocked_reason ?? "" } : null,
    /** Базовая валюта магазина (сом или рубль); у контрагента может быть своя. */
    currency: (isCurrency(org.currency) ? org.currency : "KGS") as Currency,
  };
});

/**
 * Хозяйская страница или действие. Продавцу — на главную с пояснением;
 * сама база всё равно отказывает (private.is_owner в RPC).
 */
export async function requireOwner() {
  const ctx = await getContext();
  if (!ctx.isOwner) redirect("/?error=owner");
  return ctx;
}
