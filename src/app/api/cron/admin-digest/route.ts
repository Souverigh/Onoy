import { createServiceClient } from "@/lib/supabase/server";
import { digestText, type FunnelRow } from "@/lib/admin-funnel";
import type { PersonRow } from "@/lib/admin-people";
import { bishkekDate } from "@/lib/day-summary";
import { sendTelegram, siteUrl, telegramConfigured } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/**
 * Утренняя сводка команде в Telegram. Vercel Cron (vercel.json) вызывает
 * каждый день около 9:00 по Бишкеку с заголовком Authorization: Bearer
 * CRON_SECRET — без него ничего не читаем и не шлём.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return new Response("unauthorized", { status: 401 });
  if (!telegramConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    return Response.json({ ok: false, reason: "telegram or service key not set" });
  const db = createServiceClient();
  const [people, funnel] = await Promise.all([db.rpc("admin_people"), db.rpc("admin_funnel")]);
  if (people.error || funnel.error) {
    console.warn("admin-digest:", people.error?.message ?? funnel.error?.message);
    return Response.json({ ok: false, reason: "load failed" }, { status: 500 });
  }
  const text = digestText(
    (people.data ?? []) as PersonRow[],
    (funnel.data ?? []) as FunnelRow[],
    new Date(),
    bishkekDate(),
    siteUrl(""),
  );
  return Response.json({ ok: await sendTelegram(text) });
}
