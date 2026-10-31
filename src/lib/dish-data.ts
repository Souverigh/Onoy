import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dishCost, productShare } from "./dish";

/** Продукт склада для состава блюда: единица и цена последней закупки. */
export type KitchenProduct = {
  id: string;
  name: string;
  unit: string;
  sku: string | null;
  aliases: string[];
  purchase_price: string;
  purchase_currency: string | null;
};

export type DishLine = { product_id: string; qty: string };

export type MenuDish = {
  id: string;
  name: string;
  price: string;
  category: string | null;
  archived: boolean;
  lines: DishLine[];
  /** Себестоимость порции в валюте магазина (что посчиталось). */
  cost: number;
  /** Продукты без цены закупки или в другой валюте — себестоимость неполная. */
  complete: boolean;
  /** Доля продуктов в цене, %; null — нечего считать. */
  share: number | null;
};

/** Продукты склада, из которых готовят (не в архиве, не объединённые). */
export async function kitchenProducts(db: SupabaseClient, organizationId: string): Promise<KitchenProduct[]> {
  const { data, error } = await db
    .from("products")
    .select("id,name,unit,sku,aliases,purchase_price,purchase_currency")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .is("merged_into_id", null)
    .order("name")
    .range(0, 4999);
  if (error) throw new Error("Не удалось загрузить продукты");
  return (data ?? []) as KitchenProduct[];
}

/**
 * Меню: блюда с составом и себестоимостью. archived — показать архив
 * вместо меню; id — одно блюдо (карточка).
 */
export async function loadMenu(
  db: SupabaseClient,
  organizationId: string,
  currency: string,
  options: { archived?: boolean; id?: string } = {},
): Promise<{ dishes: MenuDish[]; products: KitchenProduct[]; archivedProducts: KitchenProduct[] }> {
  let query = db.from("dishes").select("id,name,price,category,archived_at").eq("organization_id", organizationId);
  if (options.id) query = query.eq("id", options.id);
  else query = options.archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  const [dishes, products] = await Promise.all([query.order("name").range(0, 999), kitchenProducts(db, organizationId)]);
  if (dishes.error) throw new Error("Не удалось загрузить меню");
  const rows = (dishes.data ?? []) as { id: string; name: string; price: string; category: string | null; archived_at: string | null }[];
  const lines = new Map<string, DishLine[]>();
  for (let i = 0; i < rows.length; i += 200) {
    const part = await db
      .from("dish_ingredients")
      .select("dish_id,product_id,qty")
      .eq("organization_id", organizationId)
      .in("dish_id", rows.slice(i, i + 200).map((d) => d.id))
      .order("position")
      .range(0, 9999);
    if (part.error) throw new Error("Не удалось загрузить состав блюд");
    for (const l of (part.data ?? []) as { dish_id: string; product_id: string; qty: string }[])
      lines.set(l.dish_id, [...(lines.get(l.dish_id) ?? []), { product_id: l.product_id, qty: l.qty }]);
  }
  // Цена продукта — и у тех, что уже в архиве: состав старого блюда всё равно посчитать.
  const byId = new Map(products.map((p) => [p.id, p]));
  const missing = [...new Set([...lines.values()].flat().map((l) => l.product_id))].filter((id) => !byId.has(id));
  if (missing.length) {
    const extra = await db
      .from("products")
      .select("id,name,unit,sku,aliases,purchase_price,purchase_currency")
      .eq("organization_id", organizationId)
      .in("id", missing.slice(0, 500));
    for (const p of (extra.data ?? []) as KitchenProduct[]) byId.set(p.id, p);
  }
  return {
    products,
    // Продукты из состава, которых нет среди действующих (архив, объединены).
    archivedProducts: [...byId.values()].filter((p) => !products.includes(p)),
    dishes: rows.map((d) => {
      const own = lines.get(d.id) ?? [];
      const priced = own.flatMap((l) => {
        const p = byId.get(l.product_id);
        return p ? [{ qty: l.qty, purchase_price: p.purchase_price, purchase_currency: p.purchase_currency }] : [];
      });
      const { cost, complete } = dishCost(priced, currency);
      return {
        id: d.id,
        name: d.name,
        price: d.price,
        category: d.category,
        archived: Boolean(d.archived_at),
        lines: own,
        cost,
        complete: complete && priced.length === own.length,
        share: productShare(cost, d.price),
      };
    }),
  };
}


/** Категории меню, что уже есть, — подсказки в форме блюда. */
export async function menuCategories(db: SupabaseClient, organizationId: string): Promise<string[]> {
  const { data } = await db
    .from("dishes")
    .select("category")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .not("category", "is", null)
    .range(0, 999);
  return [...new Set(((data ?? []) as { category: string }[]).map((d) => d.category))].sort((a, b) => a.localeCompare(b, "ru"));
}
