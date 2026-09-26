"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { bishkekDate, computeDaySummary } from "@/lib/day-summary";

/** «Закрыть день»: итоги считаются на сервере в момент закрытия и сохраняются снимком. */
export async function closeDay(form: FormData) {
  const date = String(form.get("date") ?? "");
  const today = bishkekDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) redirect("/day?error=close");
  const back = date === today ? "/day" : `/day?date=${date}`;
  const { db, organizationId } = await getContext();
  const summary = await computeDaySummary(db, organizationId, date);
  const { error } = await db.rpc("close_day", {
    p_org: organizationId,
    p_day: date,
    p_snapshot: summary,
  });
  if (error) {
    console.error("closeDay: close_day failed", error);
    redirect(`${back}${back.includes("?") ? "&" : "?"}error=close`);
  }
  revalidatePath("/day");
  redirect(`${back}${back.includes("?") ? "&" : "?"}closed=1`);
}
