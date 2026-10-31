/**
 * Кухня (модуль «kitchen», миграция 20261112100000): блюда меню и их состав
 * из продуктов склада. Себестоимость — здесь, по цене последней закупки
 * продукта; в базе её нет, чтобы не устаревала. Без импортов — файл читают
 * тесты напрямую.
 */

/**
 * Как вписывать количество на порцию: продукт в кг — граммами, в л —
 * миллилитрами; остальные (шт, упак…) — в своей единице.
 */
export function portionUnit(unit: string): { unit: string; factor: number } {
  if (unit === "кг") return { unit: "г", factor: 1000 };
  if (unit === "л") return { unit: "мл", factor: 1000 };
  return { unit, factor: 1 };
}

/** Количество в единице продукта → поле формы: 0.15 кг → «150» (г). */
export function portionInput(qty: string | number, unit: string): string {
  const value = Math.round(Number(qty) * portionUnit(unit).factor * 10000) / 10000;
  return value ? String(value).replace(".", ",") : "";
}

/**
 * Поле формы → количество в единице продукта: «150» г → "0.15" (кг). Пусто,
 * ноль или мусор — null. До 4 знаков после точки, как в базе.
 */
export function portionQty(raw: string, unit: string): string | null {
  const s = raw.replace(/[\s ]/g, "").replace(",", ".");
  if (!/^\d{1,9}(\.\d+)?$/.test(s)) return null;
  const qty = Math.round((Number(s) / portionUnit(unit).factor) * 10000) / 10000;
  return qty > 0 && qty < 1e9 ? String(qty) : null;
}

export type IngredientPrice = {
  qty: string | number;
  /** Цена закупки продукта за его единицу. */
  purchase_price: string | number;
  /** Валюта закупки; null — валюта магазина. */
  purchase_currency: string | null;
};

/** Сумма строки состава в валюте закупки (за порцию). */
export const lineCost = (line: IngredientPrice) => Math.round(Number(line.qty) * Number(line.purchase_price) * 100) / 100;

/**
 * Себестоимость порции в валюте магазина. Продукты без цены закупки и в
 * другой валюте в сумму не входят — их число, чтобы честно сказать «не всё».
 */
export function dishCost(lines: readonly IngredientPrice[], currency: string) {
  let cents = 0;
  let noPrice = 0;
  let foreign = 0;
  for (const line of lines) {
    if (!(Number(line.purchase_price) > 0)) noPrice += 1;
    else if ((line.purchase_currency ?? currency) !== currency) foreign += 1;
    else cents += Math.round(lineCost(line) * 100);
  }
  return { cost: cents / 100, noPrice, foreign, complete: lines.length > 0 && !noPrice && !foreign };
}

/** Доля продуктов в цене, %: 106 из 350 → 30. Нет цены или себестоимости — null. */
export function productShare(cost: number, price: string | number): number | null {
  const p = Number(price);
  return p > 0 && cost > 0 ? Math.round((cost / p) * 100) : null;
}

/** До 35% — нормально, до 45% — многовато, дальше — невыгодно. */
export const SHARE_LIMITS = { ok: 35, high: 45 } as const;

export type ShareLevel = "ok" | "high" | "bad";

export const shareLevel = (share: number): ShareLevel =>
  share <= SHARE_LIMITS.ok ? "ok" : share <= SHARE_LIMITS.high ? "high" : "bad";

/** «Продукты — 30% от цены. Это нормально.» — подпись под суммой. */
export const SHARE_TEXT: Record<ShareLevel, string> = {
  ok: "Это нормально.",
  high: "Многовато - проверьте цену или состав.",
  bad: "Невыгодно - поднимите цену или поменяйте состав.",
};

/** Код ошибки базы → текст для формы блюда. */
export const DISH_ERROR_TEXT: Record<string, string> = {
  invalid_name: "Введите название блюда (до 100 символов).",
  invalid_price: "Цена - число не меньше нуля, до 2 знаков после запятой.",
  invalid_category: "Категория - до 60 символов.",
  invalid_lines: "Проверьте состав: у каждого продукта количество больше нуля, продукты не повторяются.",
  invalid_product: "Один из продуктов удалён или объединён с другим - уберите его из состава.",
  name_taken: "Блюдо с таким названием уже есть в меню.",
  invalid_dish: "Блюдо не найдено - обновите страницу.",
  blocked: "Магазин в режиме «только просмотр» - изменения не сохраняются. Продлите оплату.",
  save: "Не удалось сохранить. Проверьте данные и попробуйте снова.",
};
