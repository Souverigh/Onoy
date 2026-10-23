"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/context";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const back = (code: string) => `/stock/catalog?${code}`;

/** Включить каталог: действующая ссылка остаётся, выключенная — заменяется новой. */
export async function openCatalog() {
  const { db, organizationId } = await requireOwner();
  const result = await db.rpc("open_catalog_link", { p_org: organizationId });
  if (result.error) {
    console.error("openCatalog failed", { message: result.error.message });
    redirect(back("error=link"));
  }
  revalidatePath("/stock/catalog");
  redirect(back("opened=1"));
}

/** Выключить: ссылка перестаёт открываться у всех, кому её отправили. */
export async function closeCatalog() {
  const { db, organizationId } = await requireOwner();
  const result = await db.rpc("close_catalog_link", { p_org: organizationId });
  if (result.error) {
    console.error("closeCatalog failed", { message: result.error.message });
    redirect(back("error=link"));
  }
  revalidatePath("/stock/catalog");
  redirect(back("closed=1"));
}

/** Список id из поля формы (JSON); мусор отбрасываем. */
function ids(form: FormData, name: string): string[] {
  const raw = JSON.parse(String(form.get(name) ?? "[]")) as unknown;
  if (!Array.isArray(raw)) throw new Error(name);
  return raw.filter((id): id is string => typeof id === "string" && uuidPattern.test(id)).slice(0, 10000);
}

/**
 * Галочки каталога: только изменённые товары — скрыть (hide) и показать
 * (show). Товары, которых не было на странице (архив, больше 5000), не трогаем.
 */
export async function saveCatalogProducts(form: FormData) {
  let hide: string[];
  let show: string[];
  try {
    hide = ids(form, "hide");
    show = ids(form, "show").filter((id) => !hide.includes(id));
  } catch {
    redirect(back("error=save"));
  }
  const { db, organizationId } = await requireOwner();
  const result = await db.rpc("set_catalog_visibility", { p_org: organizationId, p_hide: hide, p_show: show });
  if (result.error) {
    console.error("saveCatalogProducts failed", { message: result.error.message });
    redirect(back("error=save"));
  }
  revalidatePath("/stock/catalog");
  redirect(back("saved=1"));
}
