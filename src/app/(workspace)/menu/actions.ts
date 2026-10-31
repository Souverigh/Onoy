"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { stockNumber } from "@/lib/stock";
import { DISH_ERROR_TEXT } from "@/lib/dish";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

/** Код ошибки базы → код для формы (тексты — DISH_ERROR_TEXT). */
const failure = (message = "") =>
  Object.keys(DISH_ERROR_TEXT).find((code) => message.includes(code)) ?? (message.includes("shop_blocked") ? "blocked" : "save");

/** Блюдо меню (миграция 20261112100000): новое или правка, состав целиком. */
export async function saveDish(form: FormData) {
  const id = text(form, "id");
  if (id && !uuidPattern.test(id)) redirect("/menu");
  const back = (error: string): never => redirect(`/menu/${id || "new"}?error=${error}`);
  const price = stockNumber(text(form, "price") || "0", 2);
  if (price === null) back("invalid_price");
  let lines: unknown = null;
  try {
    lines = JSON.parse(text(form, "lines") || "[]");
  } catch {
    back("invalid_lines");
  }
  if (!Array.isArray(lines)) back("invalid_lines");

  const { db, organizationId, modules } = await getContext();
  if (!modules.includes("kitchen")) redirect("/");
  const result = await db.rpc("save_dish", {
    p_org: organizationId,
    p_id: id || null,
    p_name: text(form, "name"),
    p_price: price,
    p_category: text(form, "category"),
    p_lines: lines,
  });
  if (result.error || !result.data) {
    console.error("saveDish failed", { message: result.error?.message });
    back(failure(result.error?.message));
  }
  revalidatePath("/menu");
  redirect(`/menu?saved=${result.data}`);
}

/** В архив (больше не готовят) или обратно в меню. */
export async function archiveDish(form: FormData) {
  const id = text(form, "id");
  if (!uuidPattern.test(id)) redirect("/menu");
  const archived = form.get("archived") === "true";
  const { db, organizationId } = await getContext();
  const result = await db.rpc("set_dish_archived", { p_org: organizationId, p_id: id, p_archived: archived });
  if (result.error) redirect(`/menu/${id}?error=${failure(result.error.message)}`);
  revalidatePath("/menu");
  redirect(archived ? "/menu?archived_one=1" : `/menu/${id}`);
}
