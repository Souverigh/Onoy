"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { stockNumber } from "@/lib/stock";
import { DAY_SALE_ERROR_TEXT } from "@/lib/day-sale";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

/** Код ошибки базы → код для экрана (тексты — DAY_SALE_ERROR_TEXT). */
const failure = (message = "") =>
  Object.keys(DAY_SALE_ERROR_TEXT).find((code) => message.includes(code)) ?? (message.includes("shop_blocked") ? "blocked" : "save");

/** Продажи за день (миграция 20261113100000): строки, сколько получили, из них переводом. */
export async function commitDaySale(form: FormData) {
  const date = text(form, "date");
  if (!datePattern.test(date)) redirect("/day-sales");
  const back = (error: string): never => redirect(`/day-sales?date=${date}&error=${error}`);
  let lines: unknown = null;
  try {
    lines = JSON.parse(text(form, "lines") || "[]");
  } catch {
    back("invalid_lines");
  }
  if (!Array.isArray(lines) || !lines.length) back("invalid_lines");
  // Пусто в «Получили» — как по меню.
  const received = stockNumber(text(form, "received") || text(form, "menu_total") || "0", 2);
  const transfer = stockNumber(text(form, "transfer") || "0", 2);
  if (received === null || transfer === null) back("invalid_amount");

  const { db, organizationId, modules } = await getContext();
  if (!modules.includes("kitchen")) redirect("/");
  const result = await db.rpc("commit_day_sale", {
    p_org: organizationId,
    p_date: date,
    p_lines: lines,
    p_received: received,
    p_transfer: transfer,
  });
  if (result.error || !result.data) {
    const code = failure(result.error?.message);
    console.error("commitDaySale failed", { message: result.error?.message });
    // Уже записано (двойное нажатие или второй телефон) — показываем запись дня.
    if (code === "day_taken") {
      const existing = await db
        .from("day_sales")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("sale_date", date)
        .is("reversed_at", null)
        .maybeSingle();
      if (existing.data) redirect(`/day-sales/${existing.data.id}?taken=1`);
    }
    back(code);
  }
  revalidatePath("/", "layout");
  redirect(`/day-sales/${result.data}?done=1`);
}

/** Отменить продажи за день (владелец, с причиной): продукты вернутся на склад. */
export async function reverseDaySale(form: FormData) {
  const id = text(form, "id");
  if (!uuidPattern.test(id)) redirect("/day-sales");
  const { db, organizationId } = await getContext();
  const result = await db.rpc("reverse_day_sale", { p_org: organizationId, p_id: id, p_comment: text(form, "comment") });
  if (result.error) redirect(`/day-sales/${id}?cancel=1&error=${failure(result.error.message)}`);
  revalidatePath("/", "layout");
  redirect(`/day-sales/${id}?reversed=1`);
}
