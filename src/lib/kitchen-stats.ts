/**
 * Отчёты кафе (модуль «kitchen», макет 31.10.2026): блюда за период и
 * подорожавшие продукты. Только расчёт — данные готовит kitchen-report.ts.
 * Без импортов — файл читают тесты напрямую.
 */

export type SoldLine = { dish_id: string | null; product_id: string | null; qty: string | number; price: string | number };
export type RecipeLine = { product_id: string; qty: string | number };

export type ItemStat = {
  kind: "dish" | "product";
  id: string;
  name: string;
  qty: number;
  /** По ценам меню. */
  revenue: number;
  /** Продукты по средней цене закупки; null — не у всех продуктов есть цена. */
  cost: number | null;
  profit: number | null;
  /** Доля продуктов в выручке, %. */
  share: number | null;
};

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Блюда и товары за период: сколько продали, выручка, продукты, заработок.
 * Продукты блюда — по его нынешнему составу × средняя цена; товар — сам.
 */
export function itemStats(
  lines: readonly SoldLine[],
  recipes: ReadonlyMap<string, readonly RecipeLine[]>,
  unitCost: ReadonlyMap<string, number>,
  names: ReadonlyMap<string, string>,
): ItemStat[] {
  const byItem = new Map<string, { kind: ItemStat["kind"]; id: string; qty: number; revenue: number }>();
  for (const l of lines) {
    const kind = l.dish_id ? "dish" : "product";
    const id = (l.dish_id ?? l.product_id)!;
    const s = byItem.get(`${kind}:${id}`) ?? { kind, id, qty: 0, revenue: 0 };
    s.qty += Number(l.qty);
    s.revenue += Number(l.qty) * Number(l.price);
    byItem.set(`${kind}:${id}`, s);
  }
  const portion = (s: { kind: ItemStat["kind"]; id: string }): number | null => {
    if (s.kind === "product") return unitCost.get(s.id) ?? null;
    const recipe = recipes.get(s.id) ?? [];
    if (!recipe.length) return null;
    let sum = 0;
    for (const r of recipe) {
      const c = unitCost.get(r.product_id);
      if (c === undefined) return null;
      sum += Number(r.qty) * c;
    }
    return sum;
  };
  return [...byItem.values()]
    .map((s) => {
      const one = portion(s);
      const revenue = round(s.revenue);
      const cost = one === null ? null : round(one * s.qty);
      return {
        kind: s.kind,
        id: s.id,
        name: names.get(s.id) ?? (s.kind === "dish" ? "Блюдо" : "Товар"),
        qty: Math.round(s.qty * 1000) / 1000,
        revenue,
        cost,
        profit: cost === null ? null : round(revenue - cost),
        share: cost !== null && revenue > 0 ? Math.round((cost / revenue) * 100) : null,
      };
    })
    .sort((a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity) || b.revenue - a.revenue);
}

/** Цена закупки одной поставки: когда (дата закупки) и почём за единицу. */
export type PurchasePrice = { product_id: string; at: string; price: number };

export type PriceRise = { product_id: string; before: number; now: number; percent: number };

/**
 * Подорожало за период: последняя цена закупки в периоде против последней
 * до него. Только подорожания, сильнее — выше.
 */
export function priceRises(prices: readonly PurchasePrice[], start: string, end: string): PriceRise[] {
  const before = new Map<string, PurchasePrice>();
  const now = new Map<string, PurchasePrice>();
  for (const p of prices) {
    const into = p.at < start ? before : p.at <= end ? now : null;
    if (!into) continue;
    const last = into.get(p.product_id);
    if (!last || p.at >= last.at) into.set(p.product_id, p);
  }
  return [...now.values()]
    .flatMap((n) => {
      const b = before.get(n.product_id);
      if (!b || !(b.price > 0) || n.price <= b.price) return [];
      return [{ product_id: n.product_id, before: b.price, now: n.price, percent: Math.round(((n.price - b.price) / b.price) * 100) }];
    })
    .sort((a, b) => b.percent - a.percent);
}

/**
 * На сколько подорожала порция блюд из-за продукта: блюда, где он есть в
 * составе, и прибавка к продуктам порции. Больше — выше.
 */
export function dishImpact(
  rise: PriceRise,
  recipes: ReadonlyMap<string, readonly RecipeLine[]>,
  names: ReadonlyMap<string, string>,
): { id: string; name: string; plus: number }[] {
  const out: { id: string; name: string; plus: number }[] = [];
  for (const [dish, recipe] of recipes) {
    const line = recipe.find((r) => r.product_id === rise.product_id);
    if (line) out.push({ id: dish, name: names.get(dish) ?? "Блюдо", plus: round(Number(line.qty) * (rise.now - rise.before)) });
  }
  return out.filter((d) => d.plus > 0).sort((a, b) => b.plus - a.plus);
}
