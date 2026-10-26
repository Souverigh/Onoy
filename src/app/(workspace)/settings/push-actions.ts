"use server";

import { getContext } from "@/lib/context";
import { sendPush, type PushTarget } from "@/lib/push";

export type PushInput = { endpoint: string; p256dh: string; auth: string; userAgent: string };

/** Этот телефон получает уведомления магазина (Настройки → «Уведомления»). */
export async function savePushSubscription(input: PushInput): Promise<{ ok: boolean }> {
  const { db, organizationId } = await getContext();
  const { error } = await db.rpc("save_push_subscription", {
    p_org: organizationId,
    p_endpoint: String(input.endpoint ?? ""),
    p_p256dh: String(input.p256dh ?? ""),
    p_auth: String(input.auth ?? ""),
    p_user_agent: String(input.userAgent ?? "").slice(0, 300) || null,
  });
  if (error) console.error("savePushSubscription failed", { message: error.message });
  return { ok: !error };
}

/** Выключить на этом телефоне. */
export async function removePushSubscription(endpoint: string): Promise<{ ok: boolean }> {
  const { db } = await getContext();
  const { error } = await db.rpc("delete_push_subscription", { p_endpoint: String(endpoint ?? "") });
  if (error) console.error("removePushSubscription failed", { message: error.message });
  return { ok: !error };
}

/** «Проверить»: уведомление на свои телефоны (видны только свои — RLS). */
export async function sendTestPush(): Promise<{ sent: number }> {
  const { db, organizationId } = await getContext();
  const { data, error } = await db
    .from("push_subscriptions")
    .select("endpoint,p256dh,auth")
    .eq("organization_id", organizationId);
  if (error) return { sent: 0 };
  const sent = await sendPush((data ?? []) as PushTarget[], {
    title: "Depter",
    body: "Уведомления работают - сюда придут новые заказы и оплаты.",
    url: "/settings#notifications",
    tag: "test",
  });
  return { sent };
}
