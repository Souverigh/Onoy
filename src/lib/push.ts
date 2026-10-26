import "server-only";
import webpush from "web-push";
import { createAnonClient } from "./supabase/server";
import { pushMessage, type PushFacts, type PushMessage } from "./push-message";
import { SITE_URL } from "./site";
import { money } from "./format";

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

/**
 * Push-уведомления (миграция 20261031100000). Ключи — в Vercel:
 * NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (подпись уведомлений) и
 * PUSH_SECRET (сервер берёт по нему список телефонов магазина). Нет ключей —
 * уведомления молча не отправляются, всё остальное работает.
 */
function keys() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const secret = process.env.PUSH_SECRET;
  return publicKey && privateKey && secret ? { publicKey, privateKey, secret } : null;
}

/** Отправить на телефоны; отписавшиеся (404/410) — убрать из базы. Ошибка — только лог. */
export async function sendPush(targets: PushTarget[], message: PushMessage): Promise<number> {
  const k = keys();
  if (!k || !targets.length) return 0;
  webpush.setVapidDetails(SITE_URL, k.publicKey, k.privateKey);
  const payload = JSON.stringify(message);
  const results = await Promise.all(
    targets.map(async (t) => {
      try {
        // Сутки: телефон выключен — уведомление придёт, когда включат.
        await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, payload, {
          TTL: 60 * 60 * 24,
          urgency: "high",
        });
        return 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          const dropped = await createAnonClient().rpc("drop_push_subscription", { p_secret: k.secret, p_endpoint: t.endpoint });
          if (dropped.error) console.error("drop_push_subscription failed", { message: dropped.error.message });
        } else console.error("push failed", { status });
        return 0;
      }
    }),
  );
  return results.reduce<number>((a, b) => a + b, 0);
}

/**
 * Магазину — о событии клиента: 'order' — новый заказ из каталога (всем
 * сотрудникам), 'claim' — «Я оплатил» (владельцу). Вызывать в after():
 * клиенту не ждать отправки.
 */
export async function notifyShop(kind: "order" | "claim", id: string) {
  const k = keys();
  if (!k) return;
  try {
    const { data, error } = await createAnonClient().rpc("push_targets", { p_secret: k.secret, p_kind: kind, p_id: id });
    if (error) {
      console.error("push_targets failed", { message: error.message });
      return;
    }
    if (!data) return;
    const { targets, ...facts } = data as PushFacts & { targets: PushTarget[] };
    await sendPush(targets ?? [], pushMessage(facts as PushFacts, id, money));
  } catch (error) {
    console.error("notifyShop failed", error);
  }
}
