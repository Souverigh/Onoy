import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAxes, type ModelInfo, type VariantAttrs, type VariantOf } from "./product-model";

/**
 * Модели магазина и их товары (миграция 20261029100000) — для склада и
 * формы продажи: собрать размеры одной модели в одну строку. Без моделей
 * (и без миграции) — пусто, всё показывается как раньше.
 */
export async function loadVariants(
  db: SupabaseClient,
  organizationId: string,
): Promise<{ variants: Record<string, VariantOf>; models: Record<string, ModelInfo> }> {
  const empty = { variants: {}, models: {} };
  const products = await db
    .from("products")
    .select("id,model_id,variant_attrs")
    .eq("organization_id", organizationId)
    .not("model_id", "is", null)
    .range(0, 4999);
  if (products.error || !products.data?.length) return empty;
  const variants: Record<string, VariantOf> = {};
  for (const p of products.data as { id: string; model_id: string; variant_attrs: VariantAttrs | null }[])
    variants[p.id] = { model: p.model_id, attrs: p.variant_attrs ?? {} };
  const ids = [...new Set(Object.values(variants).map((v) => v.model))];
  const models = await db.from("product_models").select("id,name,axes").eq("organization_id", organizationId).in("id", ids);
  if (models.error) return empty;
  return {
    variants,
    models: Object.fromEntries(
      (models.data as { id: string; name: string; axes: unknown }[]).map((m) => [m.id, { id: m.id, name: m.name, axes: parseAxes(m.axes) }]),
    ),
  };
}
