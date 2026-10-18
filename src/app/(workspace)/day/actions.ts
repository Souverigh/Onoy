"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { bishkekDate, computeDaySummary } from "@/lib/day-summary";
import { decimalInput } from "@/lib/validation";
import { carriedOver } from "@/lib/cashbox";

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
  // «Забираю с собой» — остальное остаётся в кассе на завтра (остаток на утро).
  let taken = 0;
  const rawTaken = String(form.get("taken") ?? "").trim();
  if (rawTaken) {
    try {
      taken = Number(decimalInput(rawTaken, 2));
    } catch {
      redirect(`${back}${join}error=taken`);
    }
  }
  const { db, organizationId } = await getContext();
  const summary = await computeDaySummary(db, organizationId, date);
  let drawer = summary.drawer;
  if (drawer) {
    const carried = carriedOver(drawer.expected, counted, taken);
    if (carried == null) redirect(`${back}${join}error=taken`);
    drawer = { ...drawer, taken, carried };
  }
  const { error } = await db.rpc("close_day", {
    p_org: organizationId,
    p_day: date,
    p_snapshot: { ...summary, counted, ...(drawer ? { drawer } : {}) },
  });
  if (error) {
    console.error("closeDay: close_day failed", error);
    redirect(`${back}${join}error=close`);
  }
  revalidatePath("/day");
  redirect(`${back}${join}closed=1`);
}

/** «Забрал из кассы» / «Положил в кассу» — только сегодня, только владелец (проверит база). */
export async function addCashMove(form: FormData) {
  const direction = form.get("direction") === "in" ? "in" : "out";
  const key = String(form.get("idempotency_key") ?? "");
  const note = String(form.get("note") ?? "").trim().slice(0, 200);
  let amount: string;
  try {
    amount = decimalInput(form.get("amount"), 2);
  } catch {
    redirect("/day?error=cash_move");
  }
  if (!(Number(amount) > 0) || !/^[0-9a-f-]{36}$/i.test(key)) redirect("/day?error=cash_move");
  const { db, organizationId } = await getContext();
  const { error } = await db.rpc("commit_cash_move", {
    p_org: organizationId,
    p_direction: direction,
    p_amount: amount,
    p_note: note || null,
    p_idempotency_key: key,
  });
  if (error) {
    console.error("addCashMove failed", { message: error.message });
    redirect("/day?error=cash_move");
  }
  revalidatePath("/day");
  redirect(`/day?cash=${direction}`);
}

/** Отменить «Забрал / Положил» — запись остаётся в истории отменённой. */
export async function reverseCashMove(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect("/day?error=cash_move");
  const { db, organizationId } = await getContext();
  const { error } = await db.rpc("reverse_cash_move", { p_org: organizationId, p_id: id });
  if (error) {
    console.error("reverseCashMove failed", { message: error.message });
    redirect("/day?error=cash_move");
  }
  revalidatePath("/day");
  redirect("/day?cash=reversed");
}
