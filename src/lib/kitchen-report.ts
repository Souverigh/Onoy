import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dayBounds } from "./day-summary";
import { averageUnitCosts } from "./profit";
import { dishImpact, itemStats, priceRises, type ItemStat, type PurchasePrice, type RecipeLine } from "./kitchen-stats";

/**
 * Отчёты кафе (модуль «kitchen», макет 31.10.2026) за дни [start; end]:
 * «Кафе за месяц» в отчёте за месяц, вкладки «Блюда» и «Продукты». Продукты
 * в деньгах — по средней цене закупки (как прибыль магазина, profit.ts).
 */

const round = (n: number) => Math.round(n * 100) / 100;
const CHUNK = 150;
const chunks = <T>(items: T[]) => Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, i) => items.slice(i * CHUNK, (i + 1) * CHUNK));

async function byIds<T>(ids: string[], load: (part: string[]) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  if (!ids.length) return [];
  const results = await Promise.all(chunks(ids).map((part) => load(part)));
  return results.flatMap((r) => (r.error ? [] : ((r.data ?? []) as T[])));
}

/** Действующие продажи за день за период. Таблицы нет (миграция не применена) — пусто. */
async function daySales(db: SupabaseClient, organizationId: string, start: string, end: string) {
  const { data, error } = await db
    .from("day_sales")
    .select("id,received")
    .eq("organization_id", organizationId)
    .is("reversed_at", null)
    .gte("sale_date", start)
    .lte("sale_date", end)
    .range(0, 999);
  if (error) console.error("kitchen report: day_sales failed", error.message);
  return (data ?? []) as { id: string; received: string }[];
}

/** Списано со склада продажами за день: продукт → количество. */
async function writtenOff(db: SupabaseClient, organizationId: string, saleIds: string[]) {
  const moves = await byIds<{ product_id: string; qty_delta: string }>(saleIds, (part) =>
    db
      .from("inventory_movements")
      .select("product_id,qty_delta")
      .eq("organization_id", organizationId)
      .eq("reason", "kitchen")
      .lt("qty_delta", 0)
      .in("day_sale_id", part)
      .range(0, 49999),
  );
  const used = new Map<string, number>();
  for (const m of moves) used.set(m.product_id, (used.get(m.product_id) ?? 0) - Number(m.qty_delta));
  return used;
}

export type KitchenMonth = {
  /** Получено за период (со скидками). */
  revenue: number;
  /** Списанные продукты по средней цене закупки. */
  products: number;
  /** Не у всех списанных продуктов есть цена — продукты посчитаны не полностью. */
  partial: boolean;
  days: number;
};

/** «Кафе за месяц»: выручка и продукты за период. */
export async function kitchenMonth(
  db: SupabaseClient,
  organizationId: string,
  shopCurrency: string,
  start: string,
  end: string,
): Promise<KitchenMonth> {
  const sales = await daySales(db, organizationId, start, end);
  const used = await writtenOff(db, organizationId, sales.map((s) => s.id));
  const { unitCost } = await averageUnitCosts(db, organizationId, shopCurrency, [...used.keys()], dayBounds(end).end);
  let products = 0;
  let partial = false;
  for (const [id, qty] of used) {
    const c = unitCost.get(id);
    if (c === undefined) partial = true;
    else products += qty * c;
  }
  return { revenue: round(sales.reduce((s, r) => s + Number(r.received), 0)), products: round(products), partial, days: sales.length };
}

/** Нынешний состав блюд: блюдо → строки, и названия блюд (вместе с архивными). */
async function recipes(db: SupabaseClient, organizationId: string) {
  const [dishes, lines] = await Promise.all([
    db.from("dishes").select("id,name,archived_at").eq("organization_id", organizationId).range(0, 1999),
    db.from("dish_ingredients").select("dish_id,product_id,qty").eq("organization_id", organizationId).range(0, 49999),
  ]);
  const byDish = new Map<string, RecipeLine[]>();
  for (const l of (lines.data ?? []) as { dish_id: string; product_id: string; qty: string }[])
    byDish.set(l.dish_id, [...(byDish.get(l.dish_id) ?? []), { product_id: l.product_id, qty: l.qty }]);
  const rows = (dishes.data ?? []) as { id: string; name: string; archived_at: string | null }[];
  return { byDish, names: new Map(rows.map((d) => [d.id, d.name])), active: new Set(rows.filter((d) => !d.archived_at).map((d) => d.id)) };
}

/** Вкладка «Блюда»: блюда и товары за период. */
export async function kitchenDishes(
  db: SupabaseClient,
  organizationId: string,
  shopCurrency: string,
  start: string,
  end: string,
): Promise<ItemStat[]> {
  const sales = await daySales(db, organizationId, start, end);
  const [lines, menu] = await Promise.all([
    byIds<{ dish_id: string | null; product_id: string | null; qty: string; price: string }>(
      sales.map((s) => s.id),
      (part) =>
        db.from("day_sale_lines").select("dish_id,product_id,qty,price").eq("organization_id", organizationId).in("day_sale_id", part).range(0, 49999),
    ),
    recipes(db, organizationId),
  ]);
  const productIds = [
    ...new Set([
      ...lines.flatMap((l) => (l.product_id ? [l.product_id] : [])),
      ...lines.flatMap((l) => (l.dish_id ? (menu.byDish.get(l.dish_id) ?? []).map((r) => r.product_id) : [])),
    ]),
  ];
  const { unitCost, names } = await averageUnitCosts(db, organizationId, shopCurrency, productIds, dayBounds(end).end);
  return itemStats(lines, menu.byDish, unitCost, new Map([...names, ...menu.names]));
}

export type ProductUse = {
  id: string;
  name: string;
  unit: string;
  /** Ушло по техкартам и товарами за период. */
  used: number;
  /** На сумму, по средней цене закупки; null — цены нет. */
  cost: number | null;
  /** Закупили за период (приходы с поставщиком). */
  bought: number;
  /** Остаток на складе сейчас. */
  stock: number;
};

export type ProductRise = {
  id: string;
  name: string;
  unit: string;
  before: number;
  now: number;
  percent: number;
  dishes: { name: string; plus: number }[];
};

/** Вкладка «Продукты»: расход и закупка за период, остаток сейчас, что подорожало. */
export async function kitchenProducts(
  db: SupabaseClient,
  organizationId: string,
  shopCurrency: string,
  start: string,
  end: string,
): Promise<{ products: ProductUse[]; rises: ProductRise[] }> {
  const sales = await daySales(db, organizationId, start, end);
  const [used, menu, incoming] = await Promise.all([
    writtenOff(db, organizationId, sales.map((s) => s.id)),
    recipes(db, organizationId),
    // Приходы с поставщиком и ценой — для «закупили» и цены по датам закупки.
    db
      .from("inventory_movements")
      .select("product_id,qty_delta,unit_cost,cost_currency,purchases!inner(occurred_at,reversed_at)")
      .eq("organization_id", organizationId)
      .eq("reason", "purchase")
      .not("unit_cost", "is", null)
      .lt("purchases.occurred_at", dayBounds(end).end)
      .is("purchases.reversed_at", null)
      .range(0, 49999),
  ]);
  const moves = (incoming.data ?? []) as unknown as {
    product_id: string;
    qty_delta: string;
    unit_cost: string;
    cost_currency: string | null;
    purchases: { occurred_at: string; reversed_at: string | null } | null;
  }[];
  const { start: from } = dayBounds(start);
  const bought = new Map<string, number>();
  const prices: PurchasePrice[] = [];
  for (const m of moves) {
    if (!m.purchases || m.purchases.reversed_at) continue;
    // База отдаёт «…+00:00», границы периода — «…Z»: сравниваем в одном виде.
    const at = new Date(m.purchases.occurred_at).toISOString();
    if (at >= from) bought.set(m.product_id, (bought.get(m.product_id) ?? 0) + Number(m.qty_delta));
    if ((m.cost_currency ?? shopCurrency) === shopCurrency) prices.push({ product_id: m.product_id, at, price: Number(m.unit_cost) });
  }
  // Продукты кухни: что ушло за период, что закупили, и всё, что есть в составе блюд.
  const inMenu = new Set([...menu.byDish.values()].flat().map((r) => r.product_id));
  const ids = [...new Set([...used.keys(), ...bought.keys(), ...inMenu])];
  const [{ unitCost }, balances] = await Promise.all([
    averageUnitCosts(db, organizationId, shopCurrency, [...used.keys()], dayBounds(end).end),
    byIds<{ id: string; name: string; unit: string; stock: string }>(ids, (part) =>
      db.from("product_balances").select("id,name,unit,stock").eq("organization_id", organizationId).in("id", part),
    ),
  ]);
  const info = new Map(balances.map((b) => [b.id, b]));
  const products = ids
    .filter((id) => used.has(id) || bought.has(id))
    .map((id) => {
      const qty = Math.round((used.get(id) ?? 0) * 1000) / 1000;
      const c = unitCost.get(id);
      return {
        id,
        name: info.get(id)?.name ?? "Продукт",
        unit: info.get(id)?.unit ?? "",
        used: qty,
        cost: qty ? (c === undefined ? null : round(qty * c)) : 0,
        bought: Math.round((bought.get(id) ?? 0) * 1000) / 1000,
        stock: Number(info.get(id)?.stock ?? 0),
      };
    })
    .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0) || b.used - a.used);
  // Подорожало — только у продуктов кухни; блюда — из меню (без архива).
  const menuRecipes = new Map([...menu.byDish].filter(([dish]) => menu.active.has(dish)));
  const rises = priceRises(
    prices.filter((p) => inMenu.has(p.product_id)),
    from,
    dayBounds(end).end,
  )
    .slice(0, 3)
    .map((r) => ({
      id: r.product_id,
      name: info.get(r.product_id)?.name ?? "Продукт",
      unit: info.get(r.product_id)?.unit ?? "",
      before: r.before,
      now: r.now,
      percent: r.percent,
      dishes: dishImpact(r, menuRecipes, menu.names).map((d) => ({ name: d.name, plus: d.plus })),
    }));
  return { products, rises };
}
