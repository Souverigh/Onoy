/**
 * «Продажи за день» кафе (модуль «kitchen», миграция 20261113100000): что
 * продали — блюда и товары склада — и что спишется со склада. База считает
 * то же при записи; здесь — для формы, до записи. Без импортов — файл
 * читают тесты напрямую.
 */

/** Что продали: блюдо (списывает свой состав) или товар (списывает сам себя). */
export type SoldItem = { kind: "dish" | "product"; id: string; qty: number; price: number };

export type Recipe = { product_id: string; qty: string | number }[];

/** Сумма по ценам меню, сом с копейками. */
export const menuTotal = (items: readonly SoldItem[]) =>
  Math.round(items.reduce((s, i) => s + Math.round(i.qty * i.price * 100), 0)) / 100;

/**
 * Что спишется со склада: продукт → сколько (в его единице). Блюдо × его
 * состав, товар — сам; продукты из разных блюд складываются. До 3 знаков,
 * как остатки склада.
 */
export function writeOff(items: readonly SoldItem[], recipes: ReadonlyMap<string, Recipe>): Map<string, number> {
  const need = new Map<string, number>();
  const add = (id: string, qty: number) => need.set(id, (need.get(id) ?? 0) + qty);
  for (const item of items) {
    if (!(item.qty > 0)) continue;
    if (item.kind === "product") add(item.id, item.qty);
    else for (const line of recipes.get(item.id) ?? []) add(line.product_id, item.qty * Number(line.qty));
  }
  for (const [id, qty] of need) {
    const rounded = Math.round(qty * 1000) / 1000;
    if (rounded > 0) need.set(id, rounded);
    else need.delete(id);
  }
  return need;
}

/** Код ошибки базы → текст для «Продаж за день». */
export const DAY_SALE_ERROR_TEXT: Record<string, string> = {
  invalid_date: "Выберите день не позже сегодняшнего и не старше года.",
  invalid_amount: "Проверьте суммы: «Получили» - число, а переводом - не больше полученного.",
  invalid_lines: "Отметьте, сколько продали, хотя бы одно блюдо или товар.",
  invalid_item: "Одно из блюд или товаров убрали из меню или склада - обновите страницу.",
  day_taken: "За этот день продажи уже записаны.",
  owner_only: "Отменить продажи за день может только владелец.",
  comment_required: "Напишите, почему отменяете.",
  invalid_day_sale: "Запись не найдена или уже отменена.",
  blocked: "Магазин в режиме «только просмотр» - изменения не сохраняются. Продлите оплату.",
  save: "Не удалось записать. Проверьте данные и попробуйте снова.",
};
