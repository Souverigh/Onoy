import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dayBounds } from "./day-summary";

/**
 * Прибыль и лидеры продаж за период (просьба пользователя 17.10.2026).
 *
 * Себестоимость на момент продажи база не хранит, поэтому себестоимость
 * товара — средняя закупочная цена всех его приходов на склад до конца
 * периода (взвешенная по количеству; отменённые приходы не считаются), а
 * если приходов с ценой нет — закупочная цена из карточки товара. Только в
 * валюте магазина: доллары с сомами не складываются.
 *
 * Прибыль = выручка строк с товаром склада − их себестоимость − скидки −
 * возвраты (возврат уменьшает и выручку, и себестоимость). Продажи одной
 * суммой и строки без товара склада в прибыль не входят — `coverage`
 * говорит, по какой доле продаж она посчитана.
 */
export type ProfitProduct = { id: string; name: string; unit: string; qty: number; revenue: number; profit: number | null };
export type ProfitCustomer = { id: string; name: string; sold: number; count: number };
export type PeriodProfit = {
  /** Продано за период в валюте магазина (все продажи, как в отчёте). */
  sold: number;
  /** Выручка строк, у которых известна себестоимость. */
  revenue: number;
  cost: number;
  discounts: number;
  /** Возвраты: сколько вернули клиентам и себестоимость вернувшегося товара. */
  returns: { revenue: number; cost: number };
  profit: number;
  /** Доля продаж (по сумме), по которой посчитана прибыль: 0..1. */
  coverage: number;
  /** Товаров склада без закупочной цены среди проданных. */
  withoutCost: { id: string; name: string }[];
  topProducts: ProfitProduct[];
  topCustomers: ProfitCustomer[];
};

const CHUNK = 150;
const round = (n: number) => Math.round(n * 100) / 100;
const chunks = <T>(items: T[]) => Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, i) => items.slice(i * CHUNK, (i + 1) * CHUNK));

/** Запрос по списку id частями — длинный список не влезает в адрес запроса. */
async function byIds<T>(ids: string[], load: (part: string[]) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  if (!ids.length) return [];
  const results = await Promise.all(chunks(ids).map((part) => load(part)));
  return results.flatMap((r) => (r.error ? [] : ((r.data ?? []) as T[])));
}

/**
 * Себестоимость единицы товара в валюте магазина: средняя цена его приходов
 * на склад до `to` (взвешенная по количеству, без отменённых приходов и
 * приходов в другой валюте), а если таких нет — цена закупки из карточки.
 * Товар без цены — не в карте. Ещё — названия товаров.
 */
export async function averageUnitCosts(
  db: SupabaseClient,
  organizationId: string,
  shopCurrency: string,
  productIds: string[],
  to: string,
): Promise<{ unitCost: Map<string, number>; names: Map<string, string> }> {
  const [products, incoming] = await Promise.all([
    byIds<{ id: string; name: string; purchase_price: string; purchase_currency: string | null }>(productIds, (part) =>
      db.from("products").select("id,name,purchase_price,purchase_currency").eq("organization_id", organizationId).in("id", part),
    ),
    byIds<{
      product_id: string;
      qty_delta: string;
      unit_cost: string;
      cost_currency: string | null;
      purchases: { reversed_at: string | null } | null;
    }>(productIds, (part) =>
      db
        .from("inventory_movements")
        .select("product_id,qty_delta,unit_cost,cost_currency,purchases(reversed_at)")
        .eq("organization_id", organizationId)
        .in("product_id", part)
        .gt("qty_delta", 0)
        .not("unit_cost", "is", null)
        .lt("created_at", to)
        .range(0, 49999),
    ),
  ]);
  const weighted = new Map<string, { qty: number; cost: number }>();
  for (const m of incoming) {
    if (m.purchases?.reversed_at) continue;
    if ((m.cost_currency ?? shopCurrency) !== shopCurrency) continue;
    const w = weighted.get(m.product_id) ?? { qty: 0, cost: 0 };
    w.qty += Number(m.qty_delta);
    w.cost += Number(m.qty_delta) * Number(m.unit_cost);
    weighted.set(m.product_id, w);
  }
  const unitCost = new Map<string, number>();
  for (const p of products) {
    const w = weighted.get(p.id);
    if (w && w.qty > 0) unitCost.set(p.id, w.cost / w.qty);
    else if (Number(p.purchase_price) > 0 && (p.purchase_currency ?? shopCurrency) === shopCurrency)
      unitCost.set(p.id, Number(p.purchase_price));
  }
  return { unitCost, names: new Map(products.map((p) => [p.id, p.name])) };
}

export async function periodProfit(
  db: SupabaseClient,
  organizationId: string,
  shopCurrency: string,
  startDay: string,
  endDay: string,
): Promise<PeriodProfit> {
  const from = dayBounds(startDay).start;
  const to = dayBounds(endDay).end;
  const salesResult = await db
    .from("sales")
    .select("id,customer_id,total,document_id,original_currency,customers(name,currency)")
    .eq("organization_id", organizationId)
    .eq("status", "posted")
    .is("reversed_at", null)
    .eq("is_opening", false)
    .gte("occurred_at", from)
    .lt("occurred_at", to)
    .range(0, 9999);
  if (salesResult.error) throw new Error("Не удалось посчитать прибыль");
  type Sale = {
    id: string;
    customer_id: string;
    total: string;
    document_id: string | null;
    original_currency: string | null;
    customers: { name: string; currency: string | null } | null;
  };
  // Только клиенты в валюте магазина — как основные цифры отчёта.
  const sales = ((salesResult.data ?? []) as unknown as Sale[]).filter((s) => (s.customers?.currency ?? shopCurrency) === shopCurrency);
  const sold = round(sales.reduce((t, s) => t + Number(s.total), 0));

  // Лучшие клиенты — по сумме продаж.
  const customers = new Map<string, ProfitCustomer>();
  for (const s of sales) {
    const c = customers.get(s.customer_id) ?? { id: s.customer_id, name: s.customers?.name ?? "Клиент", sold: 0, count: 0 };
    c.sold += Number(s.total);
    c.count += 1;
    customers.set(s.customer_id, c);
  }
  const topCustomers = [...customers.values()]
    .map((c) => ({ ...c, sold: round(c.sold) }))
    .sort((a, b) => b.sold - a.sold)
    .slice(0, 10);

  // Строки продаж: товары со склада, иначе — строки фото, привязанные к товару склада.
  type Line = { product_id: string | null; name: string; unit: string; qty: number; revenue: number };
  const items = await byIds<{ sale_id: string; product_id: string; name_snapshot: string; unit: string | null; qty: string; line_total: string }>(
    sales.map((s) => s.id),
    (part) =>
      db
        .from("sale_items")
        .select("sale_id,product_id,name_snapshot,unit,qty,line_total")
        .eq("organization_id", organizationId)
        .in("sale_id", part),
  );
  const withItems = new Set(items.map((i) => i.sale_id));
  // Строки фото — в валюте накладной; берём только накладные в валюте магазина.
  const photoSales = sales.filter((s) => !withItems.has(s.id) && s.document_id && (s.original_currency ?? shopCurrency) === shopCurrency);
  const docLines = await byIds<{ document_id: string; product_id: string | null; name_raw: string; unit: string | null; qty: string; price: string }>(
    photoSales.map((s) => s.document_id as string),
    (part) =>
      db
        .from("document_lines")
        .select("document_id,product_id,name_raw,unit,qty,price")
        .eq("organization_id", organizationId)
        .in("document_id", part),
  );
  const lines: Line[] = [
    ...items.map((i) => ({ product_id: i.product_id, name: i.name_snapshot, unit: i.unit ?? "шт", qty: Number(i.qty), revenue: Number(i.line_total) })),
    ...docLines.map((l) => ({
      product_id: l.product_id,
      name: l.name_raw,
      unit: l.unit ?? "шт",
      qty: Number(l.qty),
      revenue: round(Number(l.qty) * Number(l.price)),
    })),
  ];

  // Возвраты за период: строки возврата с товаром склада.
  const returnPayments = await db
    .from("payments")
    .select("id,customer_id,customers(currency)")
    .eq("organization_id", organizationId)
    .eq("kind", "return")
    .eq("status", "confirmed")
    .is("reversed_at", null)
    .gte("occurred_at", from)
    .lt("occurred_at", to)
    .range(0, 9999);
  const returnIds = ((returnPayments.data ?? []) as unknown as { id: string; customers: { currency: string | null } | null }[])
    .filter((p) => (p.customers?.currency ?? shopCurrency) === shopCurrency)
    .map((p) => p.id);
  const returned = await byIds<{ product_id: string | null; qty: string; price: string }>(returnIds, (part) =>
    db.from("return_items").select("product_id,qty,price").eq("organization_id", organizationId).in("payment_id", part),
  );

  // Себестоимость: средняя цена приходов на склад до конца периода, иначе — из карточки.
  const productIds = [...new Set([...lines, ...returned].map((l) => l.product_id).filter((id): id is string => Boolean(id)))];
  const { unitCost, names } = await averageUnitCosts(db, organizationId, shopCurrency, productIds, to);

  let revenue = 0;
  let cost = 0;
  const byProduct = new Map<string, ProfitProduct & { known: boolean }>();
  const without = new Map<string, string>();
  for (const l of lines) {
    if (!l.product_id) continue;
    const unit = unitCost.get(l.product_id);
    const p = byProduct.get(l.product_id) ?? {
      id: l.product_id,
      name: names.get(l.product_id) ?? l.name,
      unit: l.unit,
      qty: 0,
      revenue: 0,
      profit: 0,
      known: unit !== undefined,
    };
    p.qty += l.qty;
    p.revenue += l.revenue;
    if (unit !== undefined) {
      revenue += l.revenue;
      cost += l.qty * unit;
      p.profit = (p.profit ?? 0) + l.revenue - l.qty * unit;
    } else without.set(l.product_id, p.name);
    byProduct.set(l.product_id, p);
  }
  let returnRevenue = 0;
  let returnCost = 0;
  for (const r of returned) {
    const unit = r.product_id ? unitCost.get(r.product_id) : undefined;
    if (unit === undefined) continue;
    returnRevenue += Number(r.qty) * Number(r.price);
    returnCost += Number(r.qty) * unit;
  }

  const discountResult = await db
    .from("payments")
    .select("amount,customers(currency)")
    .eq("organization_id", organizationId)
    .eq("kind", "discount")
    .eq("direction", "incoming")
    .eq("status", "confirmed")
    .is("reversed_at", null)
    .gte("occurred_at", from)
    .lt("occurred_at", to)
    .range(0, 9999);
  const discounts = round(
    ((discountResult.data ?? []) as unknown as { amount: string; customers: { currency: string | null } | null }[])
      .filter((d) => (d.customers?.currency ?? shopCurrency) === shopCurrency)
      .reduce((t, d) => t + Number(d.amount), 0),
  );

  return {
    sold,
    revenue: round(revenue),
    cost: round(cost),
    discounts,
    returns: { revenue: round(returnRevenue), cost: round(returnCost) },
    profit: round(revenue - cost - discounts - (returnRevenue - returnCost)),
    coverage: sold > 0 ? Math.min(1, revenue / sold) : 0,
    withoutCost: [...without.entries()].map(([id, name]) => ({ id, name })).slice(0, 20),
    topProducts: [...byProduct.values()]
      .map(({ known, ...p }) => ({ ...p, qty: Math.round(p.qty * 1000) / 1000, revenue: round(p.revenue), profit: known ? round(p.profit ?? 0) : null }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10),
    topCustomers,
  };
}
