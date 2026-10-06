"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { bishkekDate, computeDaySummary } from "@/lib/day-summary";
import { decimalInput } from "@/lib/validation";

/**
 * «Закрыть день»: итоги считаются на сервере в момент закрытия и сохраняются
 * снимком вместе с «В кассе по факту» (по желанию) — разница видна в итоге.
 */
export async function closeDay(form: FormData) {
  const date = String(form.get("date") ?? "");
  const today = bishkekDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) redirect("/day?error=close");
  const back = date === today ? "/day" : `/day?date=${date}`;
  const join = back.includes("?") ? "&" : "?";
  let counted: number | null = null;
  const rawCounted = String(form.get("counted") ?? "").trim();
  if (rawCounted) {
    try {
      counted = Number(decimalInput(rawCounted, 2));
    } catch {
      redirect(`${back}${join}error=counted`);
    }
  }
  const { db, organizationId } = await getContext();
  const summary = await computeDaySummary(db, organizationId, date);
  const { error } = await db.rpc("close_day", {
    p_org: organizationId,
    p_day: date,
    p_snapshot: { ...summary, counted },
  });
  if (error) {
    console.error("closeDay: close_day failed", error);
    redirect(`${back}${join}error=close`);
  }
  revalidatePath("/day");
  redirect(`${back}${join}closed=1`);
}
