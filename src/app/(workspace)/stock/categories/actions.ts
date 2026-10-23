"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { refreshCatalog } from "@/lib/catalog-cache";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Код ошибки базы → ключ CATEGORY_ERROR_TEXT. */
function failureCode(message: string | undefined): string {
  const text = message ?? "";
  for (const code of ["category_taken", "invalid_category", "owner_only"]) if (text.includes(code)) return code;
  if (text.includes("shop_blocked") || text.includes("member_disabled")) return "blocked";
  return "save";
}

function text(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Категории поменялись — склад и каталог клиентов (там отбор по категориям). */
async function changed(db: Awaited<ReturnType<typeof getContext>>["db"], organizationId: string) {
  await refreshCatalog(db, organizationId);
  revalidatePath("/", "layout");
}

/** Новая категория (parent — подкатегория в ней) или новое имя (id). */
export async function saveCategory(form: FormData) {
  const id = text(form, "id");
  const parent = text(form, "parent");
  if ((id && !uuidPattern.test(id)) || (parent && !uuidPattern.test(parent))) redirect("/stock/categories?error=invalid_category");
  const { db, organizationId } = await getContext();
  const result = await db.rpc("save_product_category", {
    p_org: organizationId,
    p_id: id || null,
    p_name: text(form, "name").slice(0, 60),
    p_parent: parent || null,
  });
  if (result.error) {
    console.error("saveCategory failed", { message: result.error.message });
    redirect(`/stock/categories?error=${failureCode(result.error.message)}`);
  }
  await changed(db, organizationId);
  redirect(`/stock/categories?saved=${id ? "renamed" : "created"}`);
}

export async function deleteCategory(form: FormData) {
  const id = text(form, "id");
  if (!uuidPattern.test(id)) redirect("/stock/categories?error=invalid_category");
  const { db, organizationId } = await getContext();
  const result = await db.rpc("delete_product_category", { p_org: organizationId, p_id: id });
  if (result.error) {
    console.error("deleteCategory failed", { message: result.error.message });
    redirect(`/stock/categories?error=${failureCode(result.error.message)}`);
  }
  await changed(db, organizationId);
  redirect("/stock/categories?saved=deleted");
}

export type CategoryActionResult = { changed: number } | { error: string };

/** Поставить категорию товарам (null — без категории): подсказка, выбор в списке. */
export async function setProductsCategory(productIds: string[], categoryId: string | null): Promise<CategoryActionResult> {
  try {
    const ids = [...new Set(productIds)].filter((id) => uuidPattern.test(id));
    if (!ids.length || ids.length > 5000 || (categoryId !== null && !uuidPattern.test(categoryId))) return { error: "invalid_category" };
    const { db, organizationId } = await getContext();
    const result = await db.rpc("set_products_category", { p_org: organizationId, p_products: ids, p_category: categoryId });
    if (result.error) {
      console.error("setProductsCategory failed", { message: result.error.message });
      return { error: failureCode(result.error.message) };
    }
    await changed(db, organizationId);
    return { changed: Number(result.data) || 0 };
  } catch (error) {
    unstable_rethrow(error);
    console.error("setProductsCategory failed", error);
    return { error: "save" };
  }
}

/** Предложенные категории, которые отметил человек: создать и разложить товары. */
export async function applyCategoryGroups(groups: { name: string; products: string[] }[]): Promise<CategoryActionResult> {
  try {
    const clean = (Array.isArray(groups) ? groups : [])
      .map((g) => ({
        name: String(g?.name ?? "").trim().slice(0, 60),
        products: (Array.isArray(g?.products) ? g.products : []).filter((id) => uuidPattern.test(String(id))).slice(0, 5000),
      }))
      .filter((g) => g.name && g.products.length);
    if (!clean.length || clean.length > 200) return { error: "invalid_category" };
    const { db, organizationId } = await getContext();
    const result = await db.rpc("apply_category_groups", { p_org: organizationId, p_groups: clean });
    if (result.error) {
      console.error("applyCategoryGroups failed", { message: result.error.message });
      return { error: failureCode(result.error.message) };
    }
    await changed(db, organizationId);
    return { changed: Number(result.data) || 0 };
  } catch (error) {
    unstable_rethrow(error);
    console.error("applyCategoryGroups failed", error);
    return { error: "save" };
  }
}
