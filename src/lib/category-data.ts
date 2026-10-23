import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { categoryHints, type Category, type NamedProduct } from "./category";

/**
 * Категории магазина и названия действующих товаров — для подсказок.
 * Нет таблицы (миграция 20261023100000 не применена) — пусто, склад
 * работает как раньше.
 */
export async function loadCategories(
  db: SupabaseClient,
  organizationId: string,
): Promise<{ categories: Category[]; products: NamedProduct[]; hints: Record<string, string> }> {
  const [categories, products] = await Promise.all([
    db.from("product_categories").select("id,name,parent_id").eq("organization_id", organizationId).range(0, 999),
    db
      .from("products")
      .select("id,name,category_id")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .order("name")
      .range(0, 4999),
  ]);
  if (categories.error || products.error) return { categories: [], products: [], hints: {} };
  const list = (categories.data ?? []) as Category[];
  const named = (products.data ?? []) as NamedProduct[];
  return { categories: list, products: named, hints: categoryHints(list, named) };
}
