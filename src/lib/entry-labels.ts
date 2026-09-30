/**
 * Вид записи в payments: оплата деньгами, скидка или возврат товара
 * (adjustment по ТЗ §5). Все три уменьшают долг; деньгами — только оплата.
 */
export type PaymentKind = "payment" | "discount" | "return";
export type Direction = "incoming" | "outgoing";

export const ADJUSTMENT_KINDS = ["discount", "return"] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];
export const isAdjustmentKind = (value: string): value is AdjustmentKind =>
  (ADJUSTMENT_KINDS as readonly string[]).includes(value);

/** Подпись в карточке, акте сверки, на странице клиента — контрагент уже понятен. */
export function paymentLabel(
  kind: PaymentKind | null | undefined,
  opts: { opening?: boolean; pending?: boolean; duplicate?: boolean } = {},
) {
  if (opts.opening) return "Аванс из тетради";
  if (kind === "discount") return "Скидка";
  if (kind === "return") return "Возврат товара";
  if (opts.pending && opts.duplicate) return "Оплата — дубликат, на проверке";
  return opts.pending ? "Заявка на оплату" : "Оплата";
}

/** Подпись в общих списках (Деньги, Итог дня) — с направлением. */
export function paymentLabelWithSide(kind: PaymentKind | null | undefined, direction: Direction, opening = false) {
  if (opening) return "Аванс из тетради";
  if (kind === "discount") return direction === "incoming" ? "Скидка клиенту" : "Скидка от поставщика";
  if (kind === "return") return direction === "incoming" ? "Возврат товара от клиента" : "Возврат товара поставщику";
  return direction === "incoming" ? "Получена оплата" : "Оплата поставщику";
}
