import { bishkekDate } from "./day-summary";

/**
 * Адрес формы «Исправить» для записи по фото: копия фото, клиент или
 * поставщик, сумма и дата отменённой записи; строки и выбор товаров склада
 * форма берёт из неё же по `from` (money/new/page.tsx).
 */
export function correctionHref(
  kind: "sale" | "purchase",
  old: {
    id: string;
    party_id: string;
    total: string | number;
    original_amount: string | number | null;
    original_currency: string | null;
    occurred_at: string;
  },
  documentId: string,
  /** Приход: «Сразу оплатили поставщику», отменённая вместе с ним. */
  paid?: string | number | null,
  /** Отменённая раньше запись открыта снова («Открыть заново»), а не исправляется. */
  restored = false,
  /** Исправление: старая запись ещё действует — заменится при записи новой. */
  replacing = false,
) {
  const params = new URLSearchParams({
    type: kind,
    party: old.party_id,
    amount: String(Number(old.original_amount ?? old.total)),
    documentId,
    ...(restored ? { restored: "1" } : replacing ? { replace: "1" } : { redo: "1" }),
    fix: "1",
    from: old.id,
  });
  if (old.original_currency) params.set("currency", old.original_currency);
  const day = bishkekDate(old.occurred_at);
  if (day !== bishkekDate()) params.set("day", day);
  if (kind === "purchase" && paid != null && Number(paid) > 0) params.set("paid", String(Number(paid)));
  return `/money/new?${params.toString()}`;
}
